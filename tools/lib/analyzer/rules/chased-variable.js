"use strict";
/* Rule: workshop.lifecycle.chased-variable-in-condition (#45)
 *
 * Promotes OverPy's chased-variable-in-condition warning (w_ow2_rule_condition_chase)
 * into a structured, compiler-authoritative finding. The warning is already emitted by
 * the compiler; this rule makes it visible and consumable without raw-stderr parsing.
 *
 * Boundary (documented): findings are emitted ONLY when the compiler emits the warning.
 * OverPy 9.7.9 emits it for chased variables used in rule conditions; it does NOT emit
 * it for waitUntil conditions, so no heuristic inference is attempted there (the M5
 * non-goals forbid promoting warnings that the compiler does not produce).
 *
 * Dedup: repeated instances for the same chased variable merge into one finding
 * (fingerprint = rule + variable) with all concrete locations/evidence retained. */
const { makeFinding } = require("../findings.js");

const RULE = "workshop.lifecycle.chased-variable-in-condition";
const CHASE_CODE = "w_ow2_rule_condition_chase";

function rel(root, p) {
  if (!p) return null;
  const path = require("path");
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const r = path.relative(root, abs);
  return r && !r.startsWith("..") && r !== "" ? r : p;
}

function run(ctx) {
  const details = ctx.compile && ctx.compile.warningDetails;
  if (!Array.isArray(details)) {
    // Fail closed rather than silently reporting "no finding": the compiler-warning
    // contract changed in a way this rule cannot interpret safely.
    throw new Error("compile_overpy@1 output is missing warningDetails; cannot consume compiler warnings deterministically");
  }
  const byVar = new Map();
  for (const w of details) {
    if (w.code !== CHASE_CODE) continue;
    const m = /global variable '([^']+)' is chased/.exec(w.message || "");
    const variable = m ? m[1] : "?";
    if (!byVar.has(variable)) byVar.set(variable, { variable, locations: [], evidence: [] });
    const entry = byVar.get(variable);
    const loc = { file: rel(ctx.root, w.file), line: w.line, col: w.col };
    if (!entry.locations.some((x) => x.file === loc.file && x.line === loc.line && x.col === loc.col)) {
      entry.locations.push(loc);
    }
    const ev = `${CHASE_CODE}: ${w.message}`;
    if (!entry.evidence.includes(ev)) entry.evidence.push(ev);
  }
  const findings = [];
  for (const entry of byVar.values()) {
    findings.push(
      makeFinding({
        rule: RULE,
        severity: "warning",
        confidence: "high",
        kind: "compiler",
        heuristic: false,
        requiresJudgment: false,
        reason: `variable '${entry.variable}' is chased (chaseOverTime/chaseVariableAtRate) and also used in a rule condition; due to a Workshop engine bug the condition may not trigger as expected`,
        locations: entry.locations,
        evidence: entry.evidence,
        fingerprint: `${RULE}:${entry.variable}`,
      }),
    );
  }
  return { findings };
}

module.exports = {
  id: RULE,
  family: "lifecycle",
  name: "Chased variable in rule condition",
  description:
    "Promotes the OverPy w_ow2_rule_condition_chase warning into a structured finding: a variable being chased is used in a rule condition and may not trigger as expected.",
  run,
};
