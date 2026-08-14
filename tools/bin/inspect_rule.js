#!/usr/bin/env node
"use strict";
/* inspect_rule — structured Workshop rule/event/variable inspection (#73).
 * Contract: tools/CONTRACTS.md §inspect_rule.
 *
 * Backends (explicit, never silent — shared vocabulary in lib/wright/backend.js):
 *   --backend wright -> single-file inputs use the pinned released Wright binary
 *                       (`wright inspect`) as the semantic authority for rule
 *                       identity (name/line), variable declarations, and symbol
 *                       reference evidence. Textual metrics (event/team/hero/
 *                       conditions, action counts, op counts) remain explicitly
 *                       lexical. When Wright reports a diagnostic on the input, the
 *                       tool falls back to the lexical extractor with an explicit
 *                       `fallback` marker (the lexical extractor is the documented
 *                       compatibility path for inspection of unsupported or
 *                       partially invalid source). Wright provisioning/tool failures
 *                       are structured WRIGHT_* errors (exit 3) — never silent.
 *   --backend lexical -> the legacy line-based extractor (unchanged behavior).
 *   --backend auto    -> wright when already provisioned in the cache (no download),
 *                        otherwise lexical with an explicit `fallback` marker.
 *
 * Directory inputs always use the lexical extractor (bulk scan); the provenance
 * records the request and the effective backend.
 *
 * Usage: inspect_rule <file.opy | dir> [--glob <pat>] [--backend wright|lexical|auto]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 2 usage error, 3 environment error. */
const fs = require("fs");
const path = require("path");
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { provision, provisionCached, WrightProvisionError } = require("../lib/wright/provision.js");
const { WrightToolError, wrightInspect } = require("../lib/wright/adapter.js");
const { PIN, RESULT_CLASS, FALLBACK_REASON, classifyWrightFailure, makeProvenance } = require("../lib/wright/backend.js");

const TOOL = "inspect_rule";
const CONTRACT = "inspect_rule@1";
const MAX_FILES = 300;
const MAX_RULES = 2000;
const MAX_REFS = 2000;
const BACKENDS = new Set(["wright", "lexical", "auto"]);

const LIMITATIONS = [
  "event/team/hero/conditions and action counts are lexical (line-based); validate with compile_overpy",
  "op counts are textual occurrence counts, not a semantic performance score; use with the M1 performance skill",
  "rule identity and variable declarations are Wright-semantic when backend=wright; usages are textual member-access counts",
  "disabled rules are marked only when @Disabled follows the rule header directly",
  "Wright semantic inspection applies to single-file inputs; directory scans use the lexical extractor",
];

const parsed = parseArgs(process.argv.slice(2), { glob: { value: true }, backend: { value: true } });
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);
const [target] = parsed.positional;
const globPat = parsed.options.glob || "*.opy";
const backend = parsed.options.backend || "auto";
if (!BACKENDS.has(backend)) fail(TOOL, CONTRACT, "USAGE", `invalid --backend ${backend} (expected wright|lexical|auto)`, 2);

if (!target) fail(TOOL, CONTRACT, "USAGE", "usage: inspect_rule <file.opy | dir> [--glob <pat>] [--backend wright|lexical|auto]", 2);
let stat;
try {
  stat = fs.statSync(target);
} catch (e) {
  fail(TOOL, CONTRACT, "FILE_NOT_FOUND", `target not found: ${target}`, 3);
}

const EVENT_MAP = {
  playerdied: "Player Died",
  playertookdamage: "Player Took Damage",
  playerdealtdamage: "Player Dealt Damage",
  playerjoinedmatch: "Player Joined Match",
  playerleftmatch: "Player Left Match",
  playerdealthealing: "Player Dealt Healing",
  playertookhealing: "Player Took Healing",
  playerdealtknockback: "Player Dealt Knockback",
  playertookknockback: "Player Took Knockback",
  ongoingspecificplayer: "Ongoing - Specific Player",
  eachplayer: "Ongoing - Each Player",
  global: "Ongoing - Global",
  ongoing: "Ongoing - Global",
  "ongoing-eachplayer": "Ongoing - Each Player",
};

const OPS = [
  ["distance", /distance\s*\(/g],
  ["playersInRadius", /getPlayersInRadius\s*\(/g],
  ["livingPlayers", /getLivingPlayers\s*\(/g],
  ["playersInView", /getPlayersInView\s*\(/g],
  ["filteredArray", /\bfilter\s*\(|\bfiltered\s*\(/g],
  ["sortedArray", /\bsorted\s*\(|\bsort\s*\(/g],
  ["mappedArray", /\bmapped\s*\(/g],
  ["arrayPredicate", /isTrueForAny\s*\(|isTrueForAll\s*\(/g],
  ["damage", /\bdamage\s*\(/g],
  ["heal", /\bheal\s*\(/g],
  ["waitUntil", /\bwaitUntil\s*\(/g],
  ["wait", /\bwait\s*\(/g],
  ["loop", /\bloop\s*\(/g],
  ["createEffect", /\bcreateEffect\s*\(/g],
  ["throttleOrFacing", /\bstartThrottleInDirection\s*\(|\bstartFacing\s*\(/g],
  ["serverLoad", /\bgetAverageServerLoad\s*\(/g],
];

function listOpyFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const en of entries) {
      if (en.name === "node_modules" || en.name === "build" || en.name === ".git") continue;
      const p = path.join(d, en.name);
      if (en.isDirectory()) walk(p);
      else if (en.isFile() && (globPat === "*" || en.name.endsWith(globPat.replace("*", "")))) out.push(p);
      if (out.length >= MAX_FILES) return;
    }
  };
  walk(dir);
  return out;
}

function inspectFile(file) {
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch (e) {
    return { file, error: String((e && e.message) || e), rules: [], variables: { playervar: [], globalvar: [] }, opCounts: { byRule: [], total: {} } };
  }
  const rules = [];
  const opCounts = [];
  let cur = null;
  let playervar = [];
  let globalvar = [];
  const usages = new Map();

  const flush = () => {
    if (cur && cur.name) rules.push(cur);
    if (cur) { opCounts.push({ rule: cur.name, line: cur.line, ops: cur.ops, actionCount: cur.actionCount }); }
    cur = null;
  };

  const countUsages = (text) => {
    const re = /\b(eventPlayer|global|target|attacker|victim)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1] === "global" ? `global.${m[2]}` : `${m[2]}`;
      usages.set(key, (usages.get(key) || 0) + 1);
    }
  };

  for (let i = 0; i < lines.length && rules.length < MAX_RULES; i++) {
    const raw = lines[i];
    const text = raw.replace(/\r$/, "");
    const trimmed = text.trim();

    const ruleMatch = text.match(/^rule\s+"([^"]*)"\s*:\s*$/);
    if (ruleMatch && !trimmed.startsWith("#")) {
      flush();
      cur = { name: ruleMatch[1], line: i + 1, disabled: false, event: null, team: null, hero: null, conditions: [], ops: {}, actionCount: 0 };
      if (lines[i + 1] && /^\s*@Disabled/.test(lines[i + 1])) cur.disabled = true;
      continue;
    }
    if (!cur) {
      const vd = text.match(/^\s*(playervar|globalvar)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (vd) (vd[1] === "playervar" ? playervar : globalvar).push({ name: vd[2], line: i + 1 });
      countUsages(text);
      continue;
    }
    if (/^\s*@Event\s+(\S+)/.test(text)) {
      const ev = text.match(/^\s*@Event\s+(.+)$/)[1].trim();
      const key = ev.toLowerCase().replace(/\s+/g, "");
      cur.event = EVENT_MAP[key] || ev;
      continue;
    }
    const team = text.match(/^\s*@Team\s+(.+)$/);
    if (team) { cur.team = team[1].trim(); continue; }
    const hero = text.match(/^\s*@Hero\s+(.+)$/);
    if (hero) { cur.hero = hero[1].trim(); continue; }
    const cond = text.match(/^\s*@Condition\s+(.+)$/);
    if (cond) { cur.conditions.push(cond[1].trim()); continue; }
    if (/^\s*@/.test(text)) continue;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    cur.actionCount++;
    countUsages(text);
    for (const [name, re] of OPS) {
      re.lastIndex = 0;
      const c = (text.match(re) || []).length;
      if (c > 0) cur.ops[name] = (cur.ops[name] || 0) + c;
    }
  }
  flush();

  const total = {};
  for (const r of opCounts) for (const [k, v] of Object.entries(r.ops)) total[k] = (total[k] || 0) + v;

  const variableUsages = [...usages.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return { file, rules, variables: { playervar, globalvar, usages: variableUsages }, opCounts: { byRule: opCounts, total } };
}

// ---- lexical backend --------------------------------------------------------------

function runLexical(fallback, requested = backend) {
  const files = stat.isDirectory() ? listOpyFiles(target) : [target];
  const wrightMeta = fallback && fallback.wright ? { version: fallback.wright.version, contract: PIN.contract, commands: ["inspect"] } : null;
  if (files.length === 0) {
    emit({
      tool: TOOL, contract: CONTRACT, ok: true, target,
      backend: "lexical",
      provenance: makeProvenance({ requested, effective: "lexical", wright: wrightMeta, compat: null, fallback, resultClass: fallback ? RESULT_CLASS.EXPLICIT_FALLBACK : RESULT_CLASS.SUPPORTED_VALID }),
      semantic: false,
      heuristic: true,
      files: [], filesTruncated: false, rules: [],
      total: { opCounts: {}, ruleCount: 0, playervar: 0, globalvar: 0 },
      limitations: LIMITATIONS,
    }, 0);
    return;
  }
  const results = files.map(inspectFile);
  const totalOps = {};
  for (const r of results) for (const [k, v] of Object.entries((r.opCounts && r.opCounts.total) || {})) totalOps[k] = (totalOps[k] || 0) + v;

  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: true,
    target,
    backend: "lexical",
    provenance: makeProvenance({ requested, effective: "lexical", wright: wrightMeta, compat: null, fallback, resultClass: fallback ? RESULT_CLASS.EXPLICIT_FALLBACK : RESULT_CLASS.SUPPORTED_VALID }),
    semantic: false,
    heuristic: true,
    files: results.map((r) => ({
      file: r.file,
      ruleCount: (r.rules || []).length,
      error: r.error || null,
      variables: r.variables || { playervar: [], globalvar: [], usages: [] },
      opCounts: (r.opCounts && r.opCounts.total) || {},
    })),
    filesTruncated: files.length >= MAX_FILES,
    rules: results.flatMap((r) => r.rules || []),
    total: {
      ruleCount: results.reduce((n, r) => n + (r.rules || []).length, 0),
      opCounts: totalOps,
      playervar: results.reduce((n, r) => n + (r.variables && r.variables.playervar ? r.variables.playervar.length : 0), 0),
      globalvar: results.reduce((n, r) => n + (r.variables && r.variables.globalvar ? r.variables.globalvar.length : 0), 0),
    },
    limitations: LIMITATIONS,
  }, 0);
}

// ---- wright semantic backend ------------------------------------------------------

// Merge Wright semantic evidence (rule identity, symbols, references) with the lexical
// extractor's textual metrics. Every field stays in the @1 shape; rule/`variable`
// entries gain `evidence`/`source` markers so an agent can tell semantic facts from
// lexical ones, and the file gains an additive `semantic` block (symbols/references).
function mergeSemantic(insp, file) {
  const lex = inspectFile(file);
  const wrightRulesByLine = new Map();
  for (const r of insp.rules || []) {
    const line = r.span && r.span.start && Number.isFinite(Number(r.span.start.line)) ? Number(r.span.start.line) : null;
    if (line !== null) wrightRulesByLine.set(line, r);
  }
  const rules = (lex.rules || []).map((r) => {
    const wr = wrightRulesByLine.get(r.line);
    return {
      ...r,
      evidence: {
        name: wr ? "semantic" : "lexical",
        line: wr ? "semantic" : "lexical",
        disabled: "lexical",
        event: "lexical",
        team: "lexical",
        hero: "lexical",
        conditions: "lexical",
        actionCount: "lexical",
        ops: "lexical",
      },
    };
  });

  const symbols = insp.symbols || [];
  const gvNames = new Set(symbols.filter((s) => s.kind === "globalVariable").map((s) => s.name));
  const pvNames = new Set(symbols.filter((s) => s.kind === "playerVariable").map((s) => s.name));
  const variables = {
    playervar: (lex.variables.playervar || []).map((v) => ({ ...v, source: pvNames.has(v.name) ? "semantic" : "lexical" })),
    globalvar: (lex.variables.globalvar || []).map((v) => ({ ...v, source: gvNames.has(v.name) ? "semantic" : "lexical" })),
    usages: lex.variables.usages || [],
  };

  const symbolNames = new Map(symbols.map((s, i) => [i, s.name]));
  const references = ((insp.references || []).flatMap((group, i) =>
    (group || []).map((r) => {
      const start = (r.span && r.span.start) || {};
      return {
        symbol: symbolNames.get(i) || String(i),
        kind: r.kind,
        rule: Number.isFinite(Number(r.rule)) ? Number(r.rule) : null,
        line: Number.isFinite(Number(start.line)) ? Number(start.line) : null,
        col: Number.isFinite(Number(start.col)) ? Number(start.col) : null,
      };
    })
  ));
  const referencesTruncated = references.length > MAX_REFS;
  const cappedRefs = referencesTruncated ? references.slice(0, MAX_REFS) : references;

  const semanticSymbols = symbols.map((s) => {
    const start = (s.span && s.span.start) || {};
    return {
      kind: s.kind,
      name: s.name,
      line: Number.isFinite(Number(start.line)) ? Number(start.line) : null,
      col: Number.isFinite(Number(start.col)) ? Number(start.col) : null,
    };
  });

  const totalOps = lex.opCounts.total || {};
  return {
    file,
    files: [{
      file,
      ruleCount: rules.length,
      error: lex.error || null,
      variables,
      opCounts: totalOps,
      semantic: { symbols: semanticSymbols, references: cappedRefs, referencesTruncated },
    }],
    rules,
    total: {
      ruleCount: rules.length,
      opCounts: totalOps,
      playervar: variables.playervar.length,
      globalvar: variables.globalvar.length,
    },
  };
}

function failWright(code, message, hint, wrightMeta) {
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: false,
    backend: "wright",
    provenance: makeProvenance({
      requested: backend,
      effective: "wright",
      wright: wrightMeta || { version: PIN.version, contract: PIN.contract, commands: ["inspect"] },
      compat: null,
      fallback: null,
      resultClass: RESULT_CLASS.INFRA_FAILURE,
    }),
    error: { code, message, ...(hint ? { hint } : {}) },
  }, 3);
}

function runWrightSemantic(wr) {
  // Directory scans are bulk lexical by design (Wright inspect is single-input); the
  // provenance records the request and the effective backend explicitly.
  if (stat.isDirectory()) {
    runLexical({ reason: "directory-input", from: "wright", to: "lexical", wright: { version: wr.version, diagnostics: [] } }, backend);
    return;
  }
  let insp;
  try {
    insp = wrightInspect(wr.bin, target, {});
  } catch (e) {
    if (e instanceof WrightToolError) {
      const cls = classifyWrightFailure(e);
      if (cls.resultClass === RESULT_CLASS.INFRA_FAILURE) {
        failWright(e.code, e.message, e.hint, { version: wr.version, contract: wr.contract, commands: ["inspect"] });
        return;
      }
      // Wright ran and reported a diagnostic: the lexical extractor is the documented
      // compatibility path for inspecting unsupported or partially invalid source.
      // The marker records the Wright evidence — never silent.
      runLexical({
        reason: FALLBACK_REASON.LEXICAL_PATH,
        from: "wright",
        to: "lexical",
        wright: { version: wr.version, diagnostics: cls.diagnostics },
      }, backend);
      return;
    }
    throw e;
  }
  const merged = mergeSemantic(insp, target);
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: true,
    target,
    backend: "wright",
    provenance: makeProvenance({
      requested: backend,
      effective: "wright",
      wright: { version: wr.version, contract: wr.contract, commands: ["inspect"] },
      compat: null,
      fallback: null,
      resultClass: RESULT_CLASS.SUPPORTED_VALID,
    }),
    wright: { version: wr.version, contract: wr.contract, commands: ["inspect"] },
    semantic: true,
    heuristic: true,
    files: merged.files,
    filesTruncated: false,
    rules: merged.rules,
    total: merged.total,
    limitations: LIMITATIONS,
  }, 0);
}

// ---- dispatch ---------------------------------------------------------------------

(async () => {
  if (backend === "wright") {
    try {
      const wr = await provision({});
      runWrightSemantic(wr);
    } catch (e) {
      if (e instanceof WrightProvisionError) failWright(e.code, e.message, e.hint);
      throw e;
    }
  } else if (backend === "auto") {
    const cached = provisionCached({});
    if (cached) runWrightSemantic(cached);
    else runLexical({ reason: FALLBACK_REASON.NOT_PROVISIONED, from: "wright", to: "lexical", wright: { version: PIN.version, diagnostics: [] } });
  } else {
    runLexical(null);
  }
})().catch((e) => {
  fail(TOOL, CONTRACT, "INTERNAL_ERROR", String((e && e.message) || e), 3);
});
