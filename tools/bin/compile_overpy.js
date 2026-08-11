#!/usr/bin/env node
"use strict";
/* compile_overpy — OverPy compiler adapter with structured diagnostics.
 * Portable contract tool (see tools/CONTRACTS.md §compile_overpy). No model/harness coupling.
 *
 * Usage:
 *   compile_overpy <file.opy> [--root <path>] [--language <lang>] [--full] [--full-warnings]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 1 compile error, 2 usage error, 3 environment error. */
const fs = require("fs");
const path = require("path");
const { emit, fail, parseArgs } = require("../lib/cli.js");

const TOOL = "compile_overpy";
const CONTRACT = "compile_overpy@1";
const WARN_PREVIEW = 50;

const parsed = parseArgs(process.argv.slice(2), {
  root: { value: true },
  language: { value: true },
  full: { value: false },
  "full-warnings": { value: false },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);

const [file] = parsed.positional;
const language = parsed.options.language || "en-US";
const root = parsed.options.root || null;
const full = parsed.options.full === true;
const fullWarnings = parsed.options["full-warnings"] === true;

if (!file) fail(TOOL, CONTRACT, "USAGE", "usage: compile_overpy <file.opy> [--root <path>] [--language <lang>] [--full] [--full-warnings]", 2);
if (!fs.existsSync(file)) fail(TOOL, CONTRACT, "FILE_NOT_FOUND", `input file not found: ${file}`, 3);

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

const overpyDir = resolveOverpy(path.dirname(path.resolve(file)));
if (!overpyDir) {
  fail(TOOL, CONTRACT, "OVERPY_NOT_FOUND", "overpy package not found", 3, "install it in the tools dir (npm install) or ensure node_modules/overpy exists in the target project");
}
const overpy = require(overpyDir);
const overpyVersion = require(path.join(overpyDir, "package.json")).version;

const toStr = (x) => (typeof x === "string" ? x : x && typeof x === "object" && "message" in x ? String(x.message) : JSON.stringify(x));
const subName = (s) => (typeof s === "string" ? s : s && typeof s.name === "string" ? s.name : JSON.stringify(s));

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
        version: { tool: "0.1.0", overpy: overpyVersion, language },
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
      version: { tool: "0.1.0", overpy: overpyVersion, language },
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
