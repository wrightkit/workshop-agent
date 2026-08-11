#!/usr/bin/env node
"use strict";
/* analyze_workshop — M5 Workshop domain analyzer.
 * Portable contract tool (see tools/CONTRACTS.md §analyze_workshop). No model/harness coupling.
 *
 * Composes compile_overpy@1 (subprocess JSON contract) with small source-inspection rules
 * into structured Workshop-specific findings. Rules never re-implement compiler semantics:
 * compiler facts come from compile_overpy@1; structural facts come from the OverPy source
 * model; heuristic risks are flagged explicitly.
 *
 * Usage:
 *   analyze_workshop <entry.opy> [--root <dir>] [--rules <id,id>] [--language <lang>]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 1 analysis/compile failure (fail closed), 2 usage, 3 environment. */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { resolveRules } = require("../lib/analyzer/registry.js");
const { dedupeAndOrder } = require("../lib/analyzer/findings.js");
const { loadProject } = require("../lib/analyzer/source.js");

const TOOL = "analyze_workshop";
const CONTRACT = "analyze_workshop@1";

const parsed = parseArgs(process.argv.slice(2), {
  root: { value: true },
  rules: { value: true },
  language: { value: true },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);

const [entry] = parsed.positional;
if (!entry) fail(TOOL, CONTRACT, "USAGE", "usage: analyze_workshop <entry.opy> [--root <dir>] [--rules <id,id>] [--language <lang>]", 2);
if (!fs.existsSync(entry)) fail(TOOL, CONTRACT, "FILE_NOT_FOUND", `input file not found: ${entry}`, 3);

const root = parsed.options.root || path.dirname(path.resolve(entry));
const language = parsed.options.language || "en-US";

const selected = resolveRules(parsed.options.rules);
if (selected.error) fail(TOOL, CONTRACT, "UNKNOWN_RULE", selected.error, 2);

// ---- compose compile_overpy@1 (deterministic compiler facts) ---------------
const compileBin = path.join(__dirname, "compile_overpy.js");
const comp = spawnSync(process.execPath, [compileBin, entry, "--root", root, "--language", language], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 300000,
});
let compile;
try {
  compile = JSON.parse(comp.stdout);
} catch (e) {
  fail(TOOL, CONTRACT, "COMPILER_OUTPUT", `compile_overpy@1 returned non-JSON output: ${(comp.stderr || comp.stdout || "").slice(0, 200)}`, 3);
}
if (compile.ok !== true) {
  const diag = (compile.errors || []).slice(0, 3).map((e) => `${e.message} @${e.file}:${e.line}`).join("; ");
  fail(TOOL, CONTRACT, "COMPILE_ERROR", `project does not compile: ${diag || "unknown compile failure"}`, 1);
}

// ---- source structure model (fail closed on unrepresentable source) ---------
let source;
try {
  source = loadProject(entry, root);
} catch (e) {
  fail(TOOL, CONTRACT, "ANALYSIS_UNSUPPORTED", `cannot parse source structure: ${e.message}`, 1);
}

// ---- run selected rules -----------------------------------------------------
let findings = [];
for (const rule of selected.rules) {
  let res;
  try {
    res = rule.run({ source, compile, root });
  } catch (e) {
    fail(TOOL, CONTRACT, "ANALYSIS_ERROR", `rule ${rule.id} failed: ${e.message}`, 1);
  }
  findings.push(...((res && res.findings) || []));
}
findings = dedupeAndOrder(findings);

emit({
  tool: TOOL,
  contract: CONTRACT,
  ok: true,
  inputFile: entry,
  root,
  ruleCount: selected.rules.length,
  compile: { ok: true, nbElements: compile.nbElements, warningCount: compile.warningCount },
  findings,
}, 0);
