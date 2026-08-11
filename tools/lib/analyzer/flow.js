"use strict";
/* Conservative control-flow helpers for loop-safety analysis (#46).
 *
 * allPathsYieldOrExit(nodes): true when every complete path through the statement list
 * either reaches a yield (Wait / waitUntil) or exits (return/break). Computed as a small
 * state machine over path states (FREE = not yet yielded, YIELDED = yielded at least once,
 * EXITED = the path terminated) so that a yield later in a sequence catches earlier
 * bypass paths (e.g. `if c: wait(...)` with no else followed by a later wait still
 * yields on every path).
 *
 *   - wait / waitUntil            -> path becomes YIELDED;
 *   - return / break              -> path EXITS (does not continue repeating);
 *   - if/elif/else                -> each branch (including a missing else as a bypass
 *                                    path) continues the path states;
 *   - nested while / for          -> if the nested body always yields/terminates the path
 *                                    becomes YIELDED, otherwise the state is unchanged;
 *   - loop() / call / other       -> state unchanged (yield-free, continues). */

function branchOptions(n) {
  // The if-true branch is stored in node.body; elif/else branches in node.branches.
  const opts = [n.body || []];
  for (const b of n.branches || []) opts.push(b.body);
  if (!(n.branches || []).some((b) => /^else$/.test(b.cond))) opts.push([]); // missing else = bypass path
  return opts;
}

const FREE = "FREE";
const YIELDED = "YIELDED";

// Advance path states through a statement sequence. Returns the resulting state set
// (empty set = every path exited).
function sequenceStates(nodes, inStates) {
  let states = inStates;
  for (const n of nodes || []) {
    const next = new Set();
    for (const s of states) {
      if (n.type === "wait" || n.type === "waitUntil") {
        next.add(YIELDED);
      } else if (n.type === "return" || n.type === "break") {
        // path exits; no continuation
      } else if (n.type === "if") {
        for (const body of branchOptions(n)) {
          for (const x of sequenceStates(body, new Set([s]))) next.add(x);
        }
      } else if (n.type === "while" || n.type === "for") {
        if (allPathsYieldOrExit(n.body)) next.add(YIELDED);
        else next.add(s);
      } else {
        next.add(s); // loop() / call / continue / other: yield-free, continues
      }
    }
    states = next;
    if (states.size === 0) break; // every path exited
  }
  return states;
}

// True when every complete path through the sequence yields or exits.
function allPathsYieldOrExit(nodes) {
  return !sequenceStates(nodes, new Set([FREE])).has(FREE);
}

// Collect every while statement in a block's tree: { file, line, col, condition, body, block }.
function findWhileLoops(block) {
  const out = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.type === "while") {
        const m = /^while\s+(.*):$/.exec(n.text);
        out.push({
          file: n.file,
          line: n.line,
          col: (n.text || "").indexOf("while") + 1,
          condition: m ? m[1].trim() : n.text,
          body: n.body,
          block,
        });
      }
      walk(n.body);
      for (const br of n.branches || []) walk(br.body);
    }
  })(block.tree);
  return out;
}

module.exports = { allPathsYieldOrExit, findWhileLoops, sequenceStates };
