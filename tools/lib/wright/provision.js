"use strict";
/* Wright provisioning — deterministic, non-interactive fetch of the pinned released
 * Wright binary (see pin.json). Never tracks main or an arbitrary git SHA: the only
 * source is the GitHub Release artifact contract (wrightkit/wright, issue #101):
 *
 *   https://github.com/<owner>/<repo>/releases/download/v<version>/wright-<version>-<target>.{tar.gz,zip}
 *   https://github.com/<owner>/<repo>/releases/download/v<version>/wright-<version>-<target>.{tar.gz,zip}.sha256
 *
 * The archive is checksum-verified before extraction, and the extracted `wright`
 * binary must report the pinned version (`wright --version`). Results are cached
 * deterministically under ~/.cache/wrightkit-wright/<version>/<target>/ so repeat runs
 * are idempotent and offline after the first provisioning.
 *
 * Failure modes are explicit and distinguishable (never a silent fallback):
 *   WRIGHT_UNSUPPORTED_PLATFORM  — platform/arch has no published artifact
 *   WRIGHT_RELEASE_NOT_FOUND     — release asset 404 (release not published?)
 *   WRIGHT_CHECKSUM_MISMATCH     — downloaded archive does not match the published sha256
 *   WRIGHT_PROVISION_FAILED      — download/extract/exec failure
 *   WRIGHT_VERSION_MISMATCH      — binary exists but reports a version != pinned version
 *   WRIGHT_NOT_PROVISIONED       — not cached and provisioning was not allowed
 *
 * The module is model/harness-neutral and uses only Node built-ins plus the platform
 * `tar` (Windows 10+ ships bsdtar; PowerShell Expand-Archive is the fallback). */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { spawnSync } = require("child_process");

const PIN = require("./pin.json");

// ---- platform -> release target -------------------------------------------------

// target triple -> archive extension (per the #101 distribution contract)
const TARGETS = {
  "aarch64-apple-darwin": ".tar.gz",
  "x86_64-apple-darwin": ".tar.gz",
  "x86_64-unknown-linux-gnu": ".tar.gz",
  "x86_64-pc-windows-msvc": ".zip",
};

function detectTarget(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : arch === "x64" ? "x86_64-apple-darwin" : null;
  if (platform === "linux") return arch === "x64" ? "x86_64-unknown-linux-gnu" : null;
  if (platform === "win32") return arch === "x64" ? "x86_64-pc-windows-msvc" : null;
  return null;
}

class WrightProvisionError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = "WrightProvisionError";
    this.code = code;
    this.hint = hint;
  }
}

function releaseBase(version) {
  return `https://github.com/${PIN.releaseOwner}/${PIN.releaseRepo}/releases/download/v${version}`;
}

function artifactName(version, target) {
  return `wright-${version}-${target}`;
}

function artifactUrl(version, target) {
  return `${releaseBase(version)}/${artifactName(version, target)}${TARGETS[target]}`;
}

function checksumUrl(version, target) {
  return `${artifactUrl(version, target)}.sha256`;
}

// WRIGHT_CACHE_DIR overrides the cache root (tests/CI sandboxes); the default is
// ~/.cache/wrightkit-wright/<version>/<target>/.
function cacheDir(version, target, override) {
  const root = override || process.env.WRIGHT_CACHE_DIR || path.join(os.homedir(), ".cache", "wrightkit-wright");
  return path.join(root, version, target);
}

// The published per-asset checksum file is "<hash>  wright-<version>-<target>.<ext>".
function parseChecksum(text) {
  const m = /^([0-9a-fA-F]{64})[\s*]+.+$/m.exec(String(text).trim());
  if (!m) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", "checksum file has an unexpected format");
  return m[1].toLowerCase();
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---- download (Node built-ins, with a system-CA curl fallback) -------------------

function isCertError(e) {
  return /certificate|CERT_|SELF_SIGNED|unable to verify|CA:/i.test(String(e && e.message));
}

// Node's bundled CA store does not cover every corporate/ISP MITM or custom root CA.
// On a certificate error, retry through the platform curl (which uses the system CA
// store; curl ships on macOS, Linux, and Windows 10+). Failures stay explicit.
function fetchViaCurl(url, { timeoutMs = 60000 } = {}) {
  const r = require("child_process").spawnSync("curl", ["-fsSL", "--retry", "1", "--max-time", String(Math.floor(timeoutMs / 1000)), url], {
    encoding: null,
    maxBuffer: 512 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (r.error || r.status !== 0) {
    throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `curl download failed${r.status ? ` (exit ${r.status})` : ""}: ${url}`);
  }
  return Buffer.from(r.stdout);
}

function fetch(url, { timeoutMs = 60000, maxBytes = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "wrightkit-workshop-tools" } }, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        reject(new WrightProvisionError("WRIGHT_RELEASE_NOT_FOUND", `release asset not found: ${url}`));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new WrightProvisionError("WRIGHT_PROVISION_FAILED", `download failed (HTTP ${res.statusCode}): ${url}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new WrightProvisionError("WRIGHT_PROVISION_FAILED", `artifact exceeds ${maxBytes} bytes: ${url}`));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", (e) => {
      if (isCertError(e)) {
        try {
          resolve(fetchViaCurl(url, { timeoutMs }));
          return;
        } catch (curlErr) {
          reject(curlErr);
          return;
        }
      }
      reject(new WrightProvisionError("WRIGHT_PROVISION_FAILED", `download error: ${e.message}`));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new WrightProvisionError("WRIGHT_PROVISION_FAILED", `download timed out after ${timeoutMs}ms: ${url}`));
    });
  });
}

// ---- extraction ----------------------------------------------------------------

function extractArchive(archivePath, dest, target) {
  const ext = TARGETS[target];
  const opts = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 };
  if (ext === ".zip" && process.platform === "win32") {
    const ps = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archivePath}' -DestinationPath '${dest}'`], opts);
    if (ps.status !== 0) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `expand-archive failed: ${(ps.stderr || ps.stdout || "").slice(0, 300)}`);
    return;
  }
  const tar = spawnSync("tar", [ext === ".zip" ? "-xf" : "-xzf", archivePath, "-C", dest], opts);
  if (tar.status !== 0) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `tar extraction failed: ${(tar.stderr || tar.stdout || "").slice(0, 300)}`);
}

// The release archive has a single top-level directory (wright-<version>-<target>/
// containing wright, wright-lsp, version.json). Resolve the executable wherever the
// extraction placed it, so future archive-layout changes do not silently break.
function resolveBin(cache) {
  if (!fs.existsSync(cache)) return null;
  const exe = process.platform === "win32" ? "wright.exe" : "wright";
  const direct = path.join(cache, exe);
  if (fs.existsSync(direct)) return direct;
  for (const en of fs.readdirSync(cache)) {
    const full = path.join(cache, en);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
    const p = path.join(full, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- version / capability detection --------------------------------------------

function readVersion(bin, { timeoutMs = 15000 } = {}) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs });
  if (r.error) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `cannot execute wright: ${r.error.message}`);
  if (r.status !== 0) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `wright --version exited ${r.status}`);
  const m = /^wright\s+([0-9]+\.[0-9]+\.[0-9]+)(?:[+_-][^\s(]*)?\s*\(/.exec((r.stdout || "").trim());
  if (!m) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `unexpected wright --version output: ${(r.stdout || "").slice(0, 120)}`);
  return m[1];
}

// Minimal .opy smoke fed to `wright lint` over stdin for capability detection; keeps the
// probe free of any shipped fixture file (works from the source tree and the public
// package alike). The version banner plus this contract smoke is the pinned release's
// deterministic capability contract.
const SMOKE_SOURCE = 'rule "smoke":\n    @Event global\n    wait(1)\n';

// Deterministic capability probe: the pinned release defines the CLI surface, so the
// version banner plus a `lint` smoke over stdin (explicit --kind opy) is the contract
// check. Returns { version, contract, commands }.
function probeCapabilities(bin) {
  const version = readVersion(bin);
  if (version !== PIN.version) {
    throw new WrightProvisionError("WRIGHT_VERSION_MISMATCH", `provisioned wright reports version ${version}, pinned version is ${PIN.version}`);
  }
  const r = spawnSync(bin, ["lint", "-", "--kind", "opy", "-f", "json"], {
    encoding: "utf8",
    input: SMOKE_SOURCE,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  });
  if (r.status !== 0) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `wright lint capability probe failed: ${(r.stderr || r.stdout || "").slice(0, 300)}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `wright lint probe returned non-JSON: ${(r.stdout || "").slice(0, 200)}`);
  }
  if (out.wright && out.wright.contract !== PIN.contract) {
    throw new WrightProvisionError("WRIGHT_VERSION_MISMATCH", `provisioned wright contract ${out.wright.contract}, pinned contract is ${PIN.contract}`);
  }
  return { version, contract: PIN.contract, commands: ["compile", "check", "analyze", "lint", "inspect", "version"] };
}

// ---- public API ----------------------------------------------------------------

// Cache-only resolution (no network). Returns provisioned info or null. Used by the
// default `auto` backend so a first run never forces a large download.
function provisionCached({ version = PIN.version, cacheDirOverride } = {}) {
  const target = detectTarget();
  if (!target || !TARGETS[target]) return null;
  const cache = cacheDir(version, target, cacheDirOverride);
  const bin = resolveBin(cache);
  if (!bin) return null;
  try {
    const caps = probeCapabilities(bin);
    return { ...caps, bin, cache, target, version };
  } catch (e) {
    // stale/invalid cache -> treat as not provisioned (a later explicit --backend
    // wright re-provisions); never silently use a bad binary.
    return null;
  }
}

async function provision({ version = PIN.version, allowDownload = true, cacheDirOverride } = {}) {
  const target = detectTarget();
  if (!target || !TARGETS[target]) {
    throw new WrightProvisionError("WRIGHT_UNSUPPORTED_PLATFORM", `no published wright ${PIN.version} artifact for ${process.platform}/${process.arch}`);
  }
  const cached = provisionCached({ version, cacheDirOverride });
  if (cached) return cached;
  if (!allowDownload) {
    throw new WrightProvisionError("WRIGHT_NOT_PROVISIONED", `wright ${PIN.version} is not provisioned for ${target}; run with --backend wright to download it`, `cache: ${cacheDir(version, target, cacheDirOverride)}`);
  }

  const cache = cacheDir(version, target, cacheDirOverride);
  fs.mkdirSync(cache, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wright-provision-"));
  try {
    const name = artifactName(version, target);
    const checksumText = (await fetch(checksumUrl(version, target))).toString("utf8");
    const archiveBuf = await fetch(artifactUrl(version, target));
    const expected = parseChecksum(checksumText);
    const actual = sha256(archiveBuf);
    if (actual !== expected) {
      throw new WrightProvisionError("WRIGHT_CHECKSUM_MISMATCH", `sha256 mismatch for ${name} (expected ${expected}, got ${actual})`);
    }
    const archive = path.join(tmpDir, name + TARGETS[target]);
    fs.writeFileSync(archive, archiveBuf);
    extractArchive(archive, cache, target);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const bin = resolveBin(cache);
  if (!bin) throw new WrightProvisionError("WRIGHT_PROVISION_FAILED", `no wright executable found after extraction in ${cache}`);
  const caps = probeCapabilities(bin);
  return { ...caps, bin, cache, target, version };
}

module.exports = {
  PIN,
  TARGETS,
  detectTarget,
  WrightProvisionError,
  releaseBase,
  artifactName,
  artifactUrl,
  checksumUrl,
  cacheDir,
  parseChecksum,
  sha256,
  fetch,
  extractArchive,
  resolveBin,
  readVersion,
  probeCapabilities,
  provisionCached,
  provision,
};
