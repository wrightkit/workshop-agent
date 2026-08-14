"use strict";
/* Shared finding envelope for the Workshop domain analyzer (analyze_workshop@1).
 *
 * A finding is structured evidence, not an instruction. It always exposes:
 *   - rule:      stable rule identity (workshop.<family>.<rule>);
 *   - severity:  error | warning | advisory  (separate from confidence);
 *   - confidence: high | medium | low;
 *   - kind:      compiler (compiler/parser fact) | structural (deterministic source fact)
 *                | heuristic (risk requiring judgment);
 *   - heuristic / requiresJudgment: explicit flags so advisory findings are never
 *                presented as facts;
 *   - locations: exact source locations for the agent to inspect rather than trust prose;
 *   - evidence:  concrete evidence strings (compiler codes/messages, source snippets);
 *   - fingerprint: stable dedup identity (same underlying issue -> same fingerprint).
 *
 * Rules may pass an explicit fingerprint (e.g. rule + chased variable); otherwise it is
 * derived from the rule id and its locations. dedupeAndOrder() merges findings with the
 * same fingerprint (unioning locations/evidence) and orders them deterministically by
 * rule id, then location. */
const VALID_SEVERITY = new Set(["error", "warning", "advisory"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_KIND = new Set(["compiler", "structural", "heuristic"]);
const VALID_BACKEND = new Set(["wright", "overpy"]);

function normLoc(l) {
  return {
    file: String((l && l.file) || ""),
    line: Number.isFinite(Number(l && l.line)) ? Number(l.line) : null,
    col: Number.isFinite(Number(l && l.col)) ? Number(l.col) : null,
  };
}

function locKey(l) {
  return `${l.file}:${l.line}:${l.col}`;
}

function makeFinding({ rule, severity, confidence, kind, reason, heuristic = false, requiresJudgment = false, locations = [], evidence = [], fingerprint, backend }) {
  if (typeof rule !== "string" || !rule) throw new Error(`invalid rule id: ${JSON.stringify(rule)}`);
  if (!VALID_SEVERITY.has(severity)) throw new Error(`invalid severity: ${JSON.stringify(severity)}`);
  if (!VALID_CONFIDENCE.has(confidence)) throw new Error(`invalid confidence: ${JSON.stringify(confidence)}`);
  if (!VALID_KIND.has(kind)) throw new Error(`invalid kind: ${JSON.stringify(kind)}`);
  if (typeof reason !== "string" || !reason.trim()) throw new Error(`finding ${rule} requires a non-empty reason`);
  if (backend !== undefined && !VALID_BACKEND.has(backend)) throw new Error(`invalid backend: ${JSON.stringify(backend)}`);
  const locs = (locations || []).map(normLoc);
  const fp = fingerprint || [rule, ...locs.map(locKey)].join("|");
  return {
    rule,
    severity,
    confidence,
    kind,
    heuristic: heuristic === true,
    requiresJudgment: requiresJudgment === true,
    reason: reason.trim(),
    locations: locs,
    evidence: (evidence || []).map(String),
    fingerprint: fp,
    // Per-finding evidence provenance (#72): which deterministic backend produced this
    // finding. Additive — not part of the fingerprint or ordering.
    ...(backend ? { backend } : {}),
  };
}

// Merge findings that share a fingerprint (duplicate evidence -> one stable finding with
// unioned locations/evidence) and order deterministically: rule id, then earliest
// location (line, then file, then col).
function dedupeAndOrder(findings) {
  const byFp = new Map();
  for (const f of findings) {
    if (!byFp.has(f.fingerprint)) {
      byFp.set(f.fingerprint, { ...f, locations: [], evidence: [] });
    }
    const t = byFp.get(f.fingerprint);
    for (const l of f.locations || []) {
      const n = normLoc(l);
      if (!t.locations.some((x) => locKey(x) === locKey(n))) t.locations.push(n);
    }
    for (const e of f.evidence || []) {
      if (!t.evidence.includes(e)) t.evidence.push(e);
    }
  }
  const out = [...byFp.values()];
  const minLoc = (f) => {
    if (!f.locations.length) return { line: Infinity, file: "", col: Infinity };
    return f.locations.reduce((a, b) => {
      const ka = `${a.line === null ? 0 : a.line}:${a.file}:${a.col === null ? 0 : a.col}`;
      const kb = `${b.line === null ? 0 : b.line}:${b.file}:${b.col === null ? 0 : b.col}`;
      return ka <= kb ? a : b;
    });
  };
  out.sort((a, b) => {
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    const la = minLoc(a);
    const lb = minLoc(b);
    const laLine = la.line === null ? 0 : la.line;
    const lbLine = lb.line === null ? 0 : lb.line;
    if (laLine !== lbLine) return laLine - lbLine;
    if (la.file !== lb.file) return la.file < lb.file ? -1 : 1;
    return (la.col === null ? 0 : la.col) - (lb.col === null ? 0 : lb.col);
  });
  return out;
}

module.exports = { makeFinding, dedupeAndOrder, normLoc, locKey };
