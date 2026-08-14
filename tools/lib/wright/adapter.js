"use strict";
/* Wright adapter — maps the `wright-result/v1` JSON contract (wrightkit/wright, pinned
 * version) into the established Workshop Agent deterministic-tool contracts, preserving
 * provenance. No model/harness coupling.
 *
 * Findings from `wright analyze` / `wright lint` map into the analyze_workshop@1
 * finding envelope (rule, severity, confidence, kind, heuristic, requiresJudgment,
 * reason, locations, evidence, fingerprint). Wright's own evidence class
 * (exact | static-indicator | heuristic | runtime-validated) determines confidence and
 * the heuristic/requiresJudgment flags so agents can rely on the same evidence
 * semantics as the local analyzer rules.
 *
 * Failure classification (never a silent fallback):
 *   WRIGHT_TOOL_FAILURE    — cannot execute / non-JSON / timeout (infrastructure)
 *   WRIGHT_DIAGNOSTIC      — wright ran and reported a semantic/compile failure (ok:false)
 *   WRIGHT_NOT_PROVISIONED / other WrightProvisionError codes — provisioning failures
 */
const { spawnSync } = require("child_process");
const path = require("path");
const { makeFinding, dedupeAndOrder } = require("../analyzer/findings.js");
const { diagClass } = require("./backend.js");

class WrightToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WrightToolError";
    this.code = code;
    this.details = details;
  }
}

// wright severity -> analyze_workshop@1 severity (info is an advisory, never a fact).
const SEVERITY_MAP = { error: "error", warning: "warning", info: "advisory" };

// wright evidence class -> analyze_workshop@1 confidence/kind/heuristic semantics.
const EVIDENCE_MAP = {
  exact: { confidence: "high", kind: "structural", heuristic: false, requiresJudgment: false },
  "static-indicator": { confidence: "high", kind: "structural", heuristic: false, requiresJudgment: false },
  "runtime-validated": { confidence: "high", kind: "structural", heuristic: false, requiresJudgment: false },
  heuristic: { confidence: "medium", kind: "heuristic", heuristic: true, requiresJudgment: true },
};
const DEFAULT_EVIDENCE = { confidence: "medium", kind: "structural", heuristic: false, requiresJudgment: false };

// wright v0.1.0 gaps (upstream): `analyze` findings carry only a numeric span.file index
// while `lint` resolves span.path — and lint's path form is inconsistent (basename for
// absolute inputs, the path-as-given for relative inputs). To keep fingerprints stable
// across the composed analyze+lint commands, normalize file index 0 (always the input
// entry) to the input basename on both sides; higher indices keep the resolved path or
// their numeric index (documented limitation for multi-file projects).
function spanFile(span, input) {
  if (!span) return "";
  const idx = Number.isFinite(Number(span.file)) ? Number(span.file) : null;
  if (idx === 0 && input) return path.basename(input);
  if (typeof span.path === "string" && span.path) return span.path;
  return idx === null ? "" : String(idx);
}

// One wright finding (code/severity/evidence/message/span) -> shared finding envelope.
function mapFinding(f, input) {
  const meta = EVIDENCE_MAP[f.evidence] || DEFAULT_EVIDENCE;
  const start = (f.span && f.span.start) || {};
  const file = spanFile(f.span, input);
  const line = Number.isFinite(Number(start.line)) ? Number(start.line) : null;
  const col = Number.isFinite(Number(start.col)) ? Number(start.col) : null;
  const locations = line === null ? [] : [{ file, line, col }];
  return makeFinding({
    rule: `wright.${f.code}`,
    severity: SEVERITY_MAP[f.severity] || "advisory",
    confidence: meta.confidence,
    kind: meta.kind,
    heuristic: meta.heuristic,
    requiresJudgment: meta.requiresJudgment,
    reason: f.message || f.code,
    locations,
    evidence: [f.message].filter(Boolean),
    fingerprint: `wright.${f.code}:${file}:${line === null ? "" : line}:${col === null ? "" : col}`,
    backend: "wright",
  });
}

// wright diagnostics (ok:false path) -> structured error list for the tool envelope.
// Each entry carries a `class` so agents can distinguish an unsupported source surface
// (declared compatibility boundary; see lib/wright/backend.js) from a genuine
// semantic/diagnostic failure, per the fallback policy: never present either as a
// silent success.
function mapDiagnostics(diags) {
  return (diags || []).map((d) => {
    const start = (d.span && d.span.start) || {};
    return {
      message: d.message || d.code,
      line: Number.isFinite(Number(start.line)) ? Number(start.line) : null,
      col: Number.isFinite(Number(start.col)) ? Number(start.col) : null,
      file: spanFile(d.span),
      code: d.code,
      class: diagClass(d.code),
    };
  });
}

// Run `wright <cmd> <input> ... -f json` and return the parsed wright-result/v1
// envelope. Throws WrightToolError on infrastructure or diagnostic failure.
function runWright(bin, cmd, input, { root, locale, timeoutMs = 120000, env } = {}) {
  const args = [cmd, input];
  if (root) args.push("--root", root);
  if (locale) args.push("--locale", locale);
  args.push("-f", "json");
  const r = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env });
  if (r.error) throw new WrightToolError("WRIGHT_TOOL_FAILURE", `cannot execute wright: ${r.error.message}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    throw new WrightToolError("WRIGHT_TOOL_FAILURE", `wright ${cmd} returned non-JSON output: ${(r.stdout || r.stderr || "").slice(0, 200)}`);
  }
  if (out.ok !== true) {
    const diags = mapDiagnostics(out.diagnostics);
    throw new WrightToolError("WRIGHT_DIAGNOSTIC", diags.length ? `wright ${out.command || cmd} reported ${diags.length} error(s)` : `wright ${out.command || cmd} failed (exit ${out.exit})`, {
      command: out.command || cmd,
      diagnostics: diags,
      exit: out.exit,
    });
  }
  return out;
}

// `wright compile` -> { output } machine evidence for compile_overpy@1 (#71).
// Returns { result, output: { text, sha256, input_identity, locale } }.
function wrightCompile(bin, input, opts = {}) {
  const out = runWright(bin, "compile", input, opts);
  const output = (out.result && out.result.output) || {};
  return { result: out.result, output: { text: output.text || "", sha256: output.sha256 || null, inputIdentity: output.input_identity || null, locale: output.locale || null } };
}

// `wright inspect` -> semantic project model (rules/symbols/references) for
// inspect_rule@1 (#73) and the compile envelope's variable/subroutine lists (#71).
function wrightInspect(bin, input, opts = {}) {
  const out = runWright(bin, "inspect", input, opts);
  const result = out.result || {};
  return {
    program: result.program || null,
    rules: result.rules || [],
    symbols: result.symbols || [],
    references: result.references || [],
  };
}

// Compose wright analyze + lint into deduped findings plus provenance.
function wrightFindings(bin, input, { root, locale, timeoutMs, env } = {}) {
  const analyze = runWright(bin, "analyze", input, { root, locale, timeoutMs, env });
  const lint = runWright(bin, "lint", input, { root, locale, timeoutMs, env });
  const findings = dedupeAndOrder([
    ...((analyze.result && analyze.result.findings) || []).map((f) => mapFinding(f, input)),
    ...((lint.result && lint.result.findings) || []).map((f) => mapFinding(f, input)),
  ]);
  const rules = (lint.result && lint.result.rules) || [];
  return { findings, ruleCount: rules.length, analyze, lint };
}

module.exports = {
  WrightToolError,
  SEVERITY_MAP,
  EVIDENCE_MAP,
  spanFile,
  mapFinding,
  mapDiagnostics,
  runWright,
  wrightCompile,
  wrightInspect,
  wrightFindings,
};
