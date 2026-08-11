"use strict";
/* Rule: workshop.context.invalid-event-player (#47)
 *
 * Detects `Event Player` use in contexts where Workshop provides no valid event player.
 *
 * Two detection mechanisms:
 *
 * 1. Compiler-warning path (primary, real-world value): OverPy emits
 *    `w_mismatched_subroutine_event` — "Calling subroutine X, which uses event player
 *    variables, from a global rule" — for a global-rule call path into a subroutine that
 *    references event-player variables. This is a PROVEN invalid path (the compiler
 *    authoritatively tracks it), which is exactly the M4 Bastion T4 shape
 *    (createBastionBot from a global rule). Emitted as a high-confidence compiler finding
 *    with the call-site location; requiresJudgment is true because the fix is
 *    project-specific (the subroutine may be valid from player contexts).
 *
 * 2. Source-based direct detection (documented safety net): a direct `eventPlayer` /
 *    `Event Player` (including composed `Slot Of(Event Player)`) reference inside a
 *    global/no-event-player rule body. In practice OverPy rejects such code as a compile
 *    error ("Cannot use 'eventPlayer' with rule event 'global'"), so the analyzer fails
 *    closed with the compiler diagnostic before this detector can fire through the CLI —
 *    that fail-closed behavior IS the deterministic protection. The detector exists and
 *    is tested so the rule still emits the finding when the source model contains the
 *    misuse (e.g. a future compiler change or a composed form it does not reject).
 *
 * Boundary (v1): no interprocedural inference beyond the compiler's own warning. Call
 * chains deeper than one global-rule -> subroutine hop are never inferred; when the
 * compiler does not emit the warning, no finding is produced (no heuristic invalidity). */
const { makeFinding } = require("../findings.js");
const { hasEventPlayer, scanTokens } = require("../source.js");

const RULE = "workshop.context.invalid-event-player";
const MISMATCH_CODE = "w_mismatched_subroutine_event";
const EP_TOKENS = [/\beventPlayer\b/, /\bEvent Player\b/];

function rel(root, p) {
  if (!p) return null;
  const path = require("path");
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const r = path.relative(root, abs);
  return r && !r.startsWith("..") && r !== "" ? r : p;
}

function run(ctx) {
  const findings = [];

  // 1. compiler-warning path: proven global->subroutine invalid call paths
  const details = ctx.compile && ctx.compile.warningDetails;
  if (!Array.isArray(details)) {
    throw new Error("compile_overpy@1 output is missing warningDetails; cannot consume compiler warnings deterministically");
  }
  for (const w of details) {
    if (w.code !== MISMATCH_CODE) continue;
    const m = /Calling subroutine\s+([A-Za-z_]\w*)/.exec(w.message || "");
    const subroutine = m ? m[1] : "?";
    const loc = { file: rel(ctx.root, w.file), line: w.line, col: w.col };
    findings.push(
      makeFinding({
        rule: RULE,
        severity: "warning",
        confidence: "high",
        kind: "compiler",
        heuristic: false,
        requiresJudgment: true, // fix is project-specific (caller context, parameterization)
        reason: `subroutine '${subroutine}' references event-player variables and is called from a global rule at ${loc.file}:${loc.line}; Event Player is undefined in global context, so this call path is invalid`,
        locations: [loc],
        evidence: [`${MISMATCH_CODE}: ${w.message}`],
        fingerprint: `${RULE}:${loc.file}:${loc.line}`,
      }),
    );
  }

  // 2. source-based direct detection (safety net; documented as compiler-enforced in practice)
  for (const block of ctx.source.blocks) {
    if (block.kind !== "rule") continue;
    if (hasEventPlayer(block)) continue; // valid player/event context
    let hits = [];
    for (const re of EP_TOKENS) hits = hits.concat(scanTokens(block, re));
    if (!hits.length) continue;
    findings.push(
      makeFinding({
        rule: RULE,
        severity: "warning",
        confidence: "high",
        kind: "structural",
        heuristic: false,
        requiresJudgment: false,
        reason: `rule '${block.name}' (global context, no event player) references Event Player at ${hits.length} location(s); OverPy normally rejects this as a compile error`,
        locations: hits,
        evidence: hits.map((h) => `Event Player reference at ${h.file}:${h.line}:${h.col}`),
        fingerprint: `${RULE}:${block.file}:${block.startLine}`,
      }),
    );
  }

  return { findings };
}

module.exports = {
  id: RULE,
  family: "context",
  name: "Invalid Event Player context",
  description:
    "Detects Event Player use where Workshop provides no event player: compiler-backed global->subroutine call paths (w_mismatched_subroutine_event) plus a source-based direct global-rule safety net (normally a compile error).",
  run,
};
