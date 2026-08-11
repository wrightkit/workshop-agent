#!/usr/bin/env node
"use strict";
/* inspect_rule — structured Workshop rule/event/variable inspection.
 * Contract: tools/CONTRACTS.md §inspect_rule.
 * Extracts rules (name, event, team, hero, conditions, action lines), variable
 * declarations/usages, and counts of selected operations relevant to M1 performance
 * reasoning. Lexical, line-based extraction: output is explicitly labeled heuristic,
 * not compiler-AST-backed semantics, and op counts are not a performance score.
 *
 * Usage: inspect_rule <file.opy | dir> [--glob <pat>]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 2 usage error, 3 environment error. */
const fs = require("fs");
const path = require("path");
const { emit, fail, parseArgs } = require("../lib/cli.js");

const TOOL = "inspect_rule";
const CONTRACT = "inspect_rule@1";
const MAX_FILES = 300;
const MAX_RULES = 2000;

const LIMITATIONS = [
  "rule/event/condition extraction is lexical (line-based), not compiler-AST-backed; validate with compile_overpy",
  "op counts are textual occurrence counts, not a semantic performance score; use with the M1 performance skill",
  "variable classification (playervar/globalvar) is definition-likely; usages are textual member-access counts",
  "disabled rules are marked only when @Disabled follows the rule header directly",
];

const parsed = parseArgs(process.argv.slice(2), { glob: { value: true } });
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);
const [target] = parsed.positional;
const globPat = parsed.options.glob || "*.opy";

if (!target) fail(TOOL, CONTRACT, "USAGE", "usage: inspect_rule <file.opy | dir> [--glob <pat>]", 2);
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

function main() {
  const files = stat.isDirectory() ? listOpyFiles(target) : [target];
  if (files.length === 0) {
    emit({
      tool: TOOL, contract: CONTRACT, ok: true, target, heuristic: true,
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

main();
