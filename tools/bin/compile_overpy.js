#!/usr/bin/env node
"use strict";
/* compile_overpy — OverPy compiler adapter, Wright-first for supported OPY (#71).
 * Portable contract tool (see tools/CONTRACTS.md §compile_overpy). No model/harness coupling.
 *
 * Backends (explicit, never silent — shared vocabulary in lib/wright/backend.js):
 *   --backend wright -> pinned released Wright (`wright compile` for the Workshop
 *                       emission evidence + `wright inspect` for variable/subroutine
 *                       identity). On a declared unsupported Wright surface
 *                       (support-matrix boundary) an explicit OverPy compatibility
 *                       fallback runs with a `fallback` marker; on a genuine Wright
 *                       diagnostic the tool fails closed (exit 1); on a Wright
 *                       provisioning/tool failure it fails with a WRIGHT_* code
 *                       (exit 3). Never falls back on a legitimate diagnostic.
 *   --backend overpy -> the legacy OverPy oracle path (direct overpy.compile()).
 *   --backend auto   -> wright when already provisioned in the cache (no download),
 *                       otherwise overpy with an explicit `fallback` marker.
 *
 * Usage:
 *   compile_overpy <file.opy> [--root <path>] [--language <lang>] [--full]
 *                  [--full-warnings] [--backend wright|overpy|auto]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 1 compile error, 2 usage error, 3 environment error. */
const fs = require("fs");
const path = require("path");
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { provision, provisionCached, WrightProvisionError } = require("../lib/wright/provision.js");
const { WrightToolError, wrightCompile, wrightInspect } = require("../lib/wright/adapter.js");
const { PIN, RESULT_CLASS, FALLBACK_REASON, classifyWrightFailure, makeProvenance } = require("../lib/wright/backend.js");

const TOOL = "compile_overpy";
const CONTRACT = "compile_overpy@1";
const WARN_PREVIEW = 50;
const BACKENDS = new Set(["wright", "overpy", "auto"]);

const parsed = parseArgs(process.argv.slice(2), {
  root: { value: true },
  language: { value: true },
  full: { value: false },
  "full-warnings": { value: false },
  backend: { value: true },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);

const [file] = parsed.positional;
const language = parsed.options.language || "en-US";
const root = parsed.options.root || null;
const full = parsed.options.full === true;
const fullWarnings = parsed.options["full-warnings"] === true;
const backend = parsed.options.backend || "auto";
if (!BACKENDS.has(backend)) fail(TOOL, CONTRACT, "USAGE", `invalid --backend ${backend} (expected wright|overpy|auto)`, 2);

if (!file) fail(TOOL, CONTRACT, "USAGE", "usage: compile_overpy <file.opy> [--root <path>] [--language <lang>] [--full] [--full-warnings] [--backend wright|overpy|auto]", 2);
if (!fs.existsSync(file)) fail(TOOL, CONTRACT, "FILE_NOT_FOUND", `input file not found: ${file}`, 3);

// ---- overpy resolution (the compatibility oracle; resolved lazily, only when used) --

function resolveOverpy(fromDir) {
  let dir = path.resolve(fromDir);
  while (true) {
    const candidate = path.join(dir, "node_modules", "overpy");
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return path.dirname(require.resolve("overpy/package.json"));
  } catch (e) {
    return null;
  }
}

const toStr = (x) => (typeof x === "string" ? x : x && typeof x === "object" && "message" in x ? String(x.message) : JSON.stringify(x));
const subName = (s) => (typeof s === "string" ? s : s && typeof s.name === "string" ? s.name : JSON.stringify(s));

// Wright provisioning/tool failures are structured environment failures that still
// carry the shared provenance vocabulary (resultClass: wright-infrastructure-failure)
// so an agent can never mistake them for a clean or fallback result.
function failWright(code, message, hint, wrightMeta) {
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: false,
    backend: "wright",
    provenance: makeProvenance({
      requested: backend,
      effective: "wright",
      wright: wrightMeta || { version: PIN.version, contract: PIN.contract, commands: ["compile"] },
      compat: null,
      fallback: null,
      resultClass: RESULT_CLASS.INFRA_FAILURE,
    }),
    error: { code, message, ...(hint ? { hint } : {}) },
  }, 3);
}

// ---- overpy backend ---------------------------------------------------------------

function runOverpy(fallback) {
  const overpyDir = resolveOverpy(path.dirname(path.resolve(file)));
  if (!overpyDir) {
    fail(TOOL, CONTRACT, "OVERPY_NOT_FOUND", "overpy package not found", 3, "install it in the tools dir (npm install) or ensure node_modules/overpy exists in the target project");
  }
  const overpy = require(overpyDir);
  const overpyVersion = require(path.join(overpyDir, "package.json")).version;
  const compat = { name: "overpy", version: overpyVersion };
  const baseProvenance = makeProvenance({
    requested: backend,
    effective: "overpy",
    wright: fallback && fallback.wright ? { version: fallback.wright.version, contract: PIN.contract, commands: ["compile"] } : null,
    compat,
    fallback,
    resultClass: null, // set at each emit site below
  });

  (async () => {
    try {
      try {
        await overpy.readyPromise;
      } catch (e) {
        fail(TOOL, CONTRACT, "OVERPY_INIT_FAILED", String((e && e.message) || e), 3);
      }
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch (e) {
        fail(TOOL, CONTRACT, "FILE_READ_FAILED", `cannot read input file: ${String((e && e.message) || e)}`, 3);
      }
      const rootPath = root || path.dirname(path.resolve(file));
      let res;
      try {
        res = await overpy.compile(content, language, rootPath, path.basename(file));
      } catch (e) {
        const msg = String((e && e.message) || e);
        const m = msg.match(/line (\d+), col (\d+), at (.+)/);
        emit({
          tool: TOOL,
          contract: CONTRACT,
          ok: false,
          backend: "overpy",
          provenance: { ...baseProvenance, resultClass: fallback ? RESULT_CLASS.EXPLICIT_FALLBACK : RESULT_CLASS.SUPPORTED_DIAGNOSTIC },
          version: { tool: "0.1.0", overpy: overpyVersion, language, wright: null },
          inputFile: file,
          errors: [{
            message: msg.split("\n")[0],
            line: m ? Number(m[1]) : null,
            col: m ? Number(m[2]) : null,
            file: m ? m[3].trim() : file,
          }],
        }, 1);
        return;
      }
      const result = res.result || "";
      const warnings = (res.encounteredWarnings || []).map(toStr).concat((res.hiddenWarnings || []).map(toStr));
      // Structured warning details (uncapped) so consumers like analyze_workshop@1 can
      // recognize warning codes deterministically instead of parsing raw stderr.
      // Each entry: { code, message (without the location stack), severity, file, line, col }
      // where file/line/col come from the innermost fileStack entry (the actual warning site).
      const warningDetails = (res.encounteredWarnings || []).map((w) => {
        const firstLine = String((w && w.message) || "").split("\n")[0];
        const codeMatch = /\(([a-z][a-z0-9_]*)\)\s*$/.exec(firstLine);
        const stack = (w && w.fileStack) || [];
        const innermost = stack[stack.length - 1] || {};
        return {
          code: codeMatch ? codeMatch[1] : null,
          message: codeMatch ? firstLine.slice(0, codeMatch.index).trim() : firstLine,
          severity: String((w && w.severity) || "warning"),
          file: innermost.path || innermost.name || null,
          line: Number.isFinite(innermost.startLine) ? innermost.startLine : null,
          col: Number.isFinite(innermost.startCol) ? innermost.startCol : null,
        };
      });
      emit({
        tool: TOOL,
        contract: CONTRACT,
        ok: true,
        backend: "overpy",
        provenance: { ...baseProvenance, resultClass: fallback ? RESULT_CLASS.EXPLICIT_FALLBACK : RESULT_CLASS.SUPPORTED_VALID },
        version: { tool: "0.1.0", overpy: overpyVersion, language, wright: null },
        inputFile: file,
        warnings: fullWarnings ? warnings : warnings.slice(0, WARN_PREVIEW),
        warningCount: warnings.length,
        warningDetails,
        globalVariables: res.globalVariables || [],
        playerVariables: res.playerVariables || [],
        subroutines: (res.subroutines || []).map(subName),
        nbElements: typeof res.nbElements === "number" ? res.nbElements : null,
        activatedExtensions: res.activatedExtensions || [],
        outputLength: result.length,
        outputPreview: full ? result : result.slice(0, 1000),
      }, 0);
    } catch (e) {
      fail(TOOL, CONTRACT, "INTERNAL_ERROR", String((e && e.stack) || e), 3);
    }
  })();
}

// ---- wright backend ---------------------------------------------------------------

// Variable/subroutine identity from `wright inspect` (semantic spans). The overpy
// envelope exposes globalVariables/playerVariables as { name, ... } objects and
// subroutines as name strings; the wright path keeps those shapes with span evidence.
function variablesFromInspect(insp) {
  const pick = (kind) =>
    (insp.symbols || [])
      .filter((s) => s.kind === kind)
      .map((s) => {
        const start = (s.span && s.span.start) || {};
        const line = Number.isFinite(Number(start.line)) ? Number(start.line) : null;
        const col = Number.isFinite(Number(start.col)) ? Number(start.col) : null;
        return { name: s.name, line, col };
      });
  return {
    globalVariables: pick("globalVariable"),
    playerVariables: pick("playerVariable"),
    subroutines: pick("subroutine").map((s) => s.name),
  };
}

function runWrightBackend(wr) {
  let res;
  try {
    res = wrightCompile(wr.bin, file, { root, locale: language });
  } catch (e) {
    if (e instanceof WrightToolError) {
      const cls = classifyWrightFailure(e);
      if (cls.resultClass === RESULT_CLASS.UNSUPPORTED_SURFACE) {
        // Declared compatibility surface: explicit OverPy fallback with the Wright
        // diagnostics and version in the marker. Never silent.
        runOverpy({
          reason: FALLBACK_REASON.UNSUPPORTED_SURFACE,
          from: "wright",
          to: "overpy",
          wright: { version: wr.version, diagnostics: cls.diagnostics },
        });
        return;
      }
      if (cls.resultClass === RESULT_CLASS.SUPPORTED_DIAGNOSTIC) {
        // Genuine Wright compile/semantic diagnostic: fail closed, never fallback.
        emit({
          tool: TOOL,
          contract: CONTRACT,
          ok: false,
          backend: "wright",
          provenance: makeProvenance({
            requested: backend,
            effective: "wright",
            wright: { version: wr.version, contract: wr.contract, commands: ["compile"] },
            compat: null,
            fallback: null,
            resultClass: RESULT_CLASS.SUPPORTED_DIAGNOSTIC,
          }),
          version: { tool: "0.1.0", language, overpy: null, wright: wr.version },
          inputFile: file,
          errors: (e.details && e.details.diagnostics) || [{ message: e.message }],
        }, 1);
        return;
      }
      // Wright tool/infrastructure failure -> structured environment failure.
      failWright(e.code, e.message, e.hint, { version: wr.version, contract: wr.contract, commands: ["compile"] });
      return;
    }
    throw e;
  }

  // Compile succeeded: enrich with semantic variable/subroutine identity. Defensive —
  // if inspect ever fails on a compiling input, the lists stay empty (documented: no
  // fabricated claims; the compile evidence itself is unchanged).
  let inspected = { globalVariables: [], playerVariables: [], subroutines: [] };
  try {
    inspected = variablesFromInspect(wrightInspect(wr.bin, file, { root, locale: language }));
  } catch (e) {
    /* defensive: keep empty lists */
  }

  const text = res.output.text || "";
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: true,
    backend: "wright",
    provenance: makeProvenance({
      requested: backend,
      effective: "wright",
      wright: { version: wr.version, contract: wr.contract, commands: ["compile", "inspect"] },
      compat: null,
      fallback: null,
      resultClass: RESULT_CLASS.SUPPORTED_VALID,
    }),
    version: { tool: "0.1.0", language, overpy: null, wright: wr.version },
    inputFile: file,
    warnings: [],
    warningCount: 0,
    warningDetails: [],
    globalVariables: inspected.globalVariables,
    playerVariables: inspected.playerVariables,
    subroutines: inspected.subroutines,
    // Wright v0.1.0 does not compute OverPy element counts; explicit null (documented
    // unsupported field), never a fabricated count.
    nbElements: null,
    activatedExtensions: [],
    outputLength: text.length,
    outputPreview: full ? text : text.slice(0, 1000),
    wright: {
      version: wr.version,
      contract: wr.contract,
      commands: ["compile", "inspect"],
      inputIdentity: res.output.inputIdentity,
      outputSha256: res.output.sha256,
    },
  }, 0);
}

// ---- dispatch ---------------------------------------------------------------------

(async () => {
  if (backend === "wright") {
    try {
      const wr = await provision({});
      runWrightBackend(wr);
    } catch (e) {
      if (e instanceof WrightProvisionError) failWright(e.code, e.message, e.hint);
      throw e;
    }
  } else if (backend === "auto") {
    const cached = provisionCached({});
    if (cached) runWrightBackend(cached);
    else runOverpy({ reason: FALLBACK_REASON.NOT_PROVISIONED, from: "wright", to: "overpy", wright: { version: PIN.version, diagnostics: [] } });
  } else {
    runOverpy(null);
  }
})().catch((e) => {
  fail(TOOL, CONTRACT, "INTERNAL_ERROR", String((e && e.message) || e), 3);
});
