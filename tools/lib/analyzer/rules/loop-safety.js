"use strict";
/* Loop-safety analyzer family (#46).
 *
 * Two distinct findings, never one overloaded warning:
 *
 *   workshop.performance.waitless-loop    (blocking, deterministic, structural)
 *     A while loop whose repeating path can never reach a Wait/waitUntil, or a rule that
 *     restarts via loop() with no Wait on the path. A waitless repeating path spins
 *     within one tick and is a near-certain server-crash mechanism. Emitted only when
 *     the control flow provably has a yield-free path (precision over recall).
 *
 *   workshop.performance.unbounded-loop   (advisory, heuristic)
 *     A while loop that yields (contains a Wait) but has no explicit bound detected by
 *     the v1 bound vocabulary: time bound (getTotalTimeElapsed vs a number), counter
 *     bound (a variable compared to a number and mutated in the body), or count/lifecycle
 *     bound (getNumberOfPlayers/getLivingPlayers/len/getNumberOfHeroes compared).
 *     May be perfectly valid Workshop design; reported as an advisory requiring judgment.
 *
 * Non-goals honored: no exact runtime bound solving, no termination proofs, no loop
 * rewriting, and `for` loops (bounded by the iterated collection) are never escalated. */
const { makeFinding } = require("../findings.js");
const { allPathsYieldOrExit, findWhileLoops } = require("../flow.js");

const WAITLESS = "workshop.performance.waitless-loop";
const UNBOUNDED = "workshop.performance.unbounded-loop";

const COUNT_CALL = /(getNumberOfPlayers|getLivingPlayers|len|getNumberOfHeroes)\s*\(/;
const COMPARE = /\s*(<|<=|>|>=)\s*/;
const NUMBER = /\d/;

// v1 explicit-bound vocabulary (documented, conservative): the loop is considered bounded
// when the condition shows a time bound, a counter bound (a variable compared to a numeric
// literal or named constant, mutated in the body), or a count/lifecycle comparison
// (progress toward a target or drain).
function hasExplicitBound(loop) {
  const cond = loop.condition || "";
  const body = (loop.body || []).map((s) => s.text).join("\n");
  // time bound: getTotalTimeElapsed() compared to a number
  if (/\bgetTotalTimeElapsed\(\)\s*(<=?|>=?)\s*\d/.test(cond)) return true;
  // counter bound: a variable compared to a number literal or named constant, mutated in the body
  for (const m of cond.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    const v = m[1];
    if (/^(true|false|null|self|eventPlayer|victim|attacker|healer|healee|Event Player)$/i.test(v)) continue;
    const compared = new RegExp(`\\b${v}\\b\\s*(<=?|>=?|==|!=)\\s*(\\d|[A-Za-z_]\\w*)`).test(cond) || new RegExp(`(\\d|[A-Za-z_]\\w*)\\s*(<=?|>=?|==|!=)\\s*\\b${v}\\b`).test(cond);
    if (compared) {
      if (new RegExp(`\\b${v}\\s*(\\+=|-=|\\*=|/=|\\+\\+|--)|\\b${v}\\s*=\\s*${v}\\s*[+\\-*/]`).test(body)) return true;
    }
  }
  // count/lifecycle bound: a count call compared to anything (target fill / drain pattern)
  if (COUNT_CALL.test(cond) && COMPARE.test(cond) && /[0-9A-Za-z_]/.test(cond)) return true;
  return false;
}

function runWaitless(ctx) {
  const findings = [];
  for (const block of ctx.source.blocks) {
    // rule-level: an UNCONDITIONAL top-level loop() with a yield-free path from the rule
    // start is a provably waitless restart (the rule re-runs without ever yielding).
    // Conditional loop() (e.g. `if ruleCondition: loop()`) is NOT flagged in v1: the
    // restart re-evaluates rule conditions and may terminate, so waitlessness cannot be
    // proven (concrete case: Bastion halved.opy).
    const firstLoop = (block.tree || []).find((n) => n.type === "loop");
    if (block.kind === "rule" && firstLoop) {
      const prefix = block.tree.slice(0, block.tree.indexOf(firstLoop));
      if (!allPathsYieldOrExit(prefix)) {
        findings.push(
          makeFinding({
            rule: WAITLESS,
            severity: "error",
            confidence: "high",
            kind: "structural",
            heuristic: false,
            requiresJudgment: false,
            reason: `rule '${block.name}' unconditionally restarts via loop() at line ${firstLoop.line} with no Wait on the path from the rule start; the repeating path spins within one tick and can crash the server`,
            locations: [{ file: block.file, line: firstLoop.line, col: 1 }],
            evidence: [`rule '${block.name}' (${block.file}:${block.startLine}) -> loop() at line ${firstLoop.line}`],
          }),
        );
      }
    }
    for (const loop of findWhileLoops(block)) {
      if (!allPathsYieldOrExit(loop.body)) {
        findings.push(
          makeFinding({
            rule: WAITLESS,
            severity: "error",
            confidence: "high",
            kind: "structural",
            heuristic: false,
            requiresJudgment: false,
            reason: `while loop has a repeating path that never reaches a Wait/waitUntil; a waitless loop spins within one tick and can crash the server`,
            locations: [{ file: loop.file, line: loop.line, col: loop.col }],
            evidence: [`while ${loop.condition} (${loop.file}:${loop.line})`],
          }),
        );
      }
    }
  }
  return { findings };
}

function runUnbounded(ctx) {
  const findings = [];
  for (const block of ctx.source.blocks) {
    for (const loop of findWhileLoops(block)) {
      if (allPathsYieldOrExit(loop.body) && !hasExplicitBound(loop)) {
        findings.push(
          makeFinding({
            rule: UNBOUNDED,
            severity: "advisory",
            confidence: "medium",
            kind: "heuristic",
            heuristic: true,
            requiresJudgment: true,
            reason: `while loop yields (contains a Wait) but no explicit iteration/time/count bound was detected; it may run far longer than intended — review whether a bound or de-synchronization is needed`,
            locations: [{ file: loop.file, line: loop.line, col: loop.col }],
            evidence: [`while ${loop.condition} (${loop.file}:${loop.line})`],
          }),
        );
      }
    }
  }
  return { findings };
}

const waitlessRule = {
  id: WAITLESS,
  family: "performance",
  name: "Waitless repeating loop",
  description:
    "Deterministic structural finding: a while loop (or loop()-restarting rule) whose repeating path never reaches a Wait/waitUntil — a near-certain server-crash mechanism.",
  run: runWaitless,
};

const unboundedRule = {
  id: UNBOUNDED,
  family: "performance",
  name: "Yielding loop without an explicit bound",
  description:
    "Heuristic advisory: a while loop that yields but has no detected explicit iteration/time/count bound; valid design possible, requires judgment.",
  run: runUnbounded,
};

module.exports = { waitlessRule, unboundedRule, hasExplicitBound };
