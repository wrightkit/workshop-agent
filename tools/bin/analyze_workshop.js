#!/usr/bin/env node
"use strict";
/* analyze_workshop — M5 Workshop domain analyzer.
 * Portable contract tool (see tools/CONTRACTS.md §analyze_workshop). No model/harness coupling.
 *
 * Backends (explicit, never silent):
 *   --backend wright  -> pinned released Wright (analyze + lint) mapped into the
 *                        analyze_workshop@1 finding envelope; provisions the binary on
 *                        first use (checksum-verified, version-pinned; see lib/wright).
 *   --backend overpy  -> compose compile_overpy@1 with the local source-inspection rules.
 *   --backend auto    -> wright when already provisioned (cached), else overpy with an
 *                        explicit `fallback` marker in the output.
 *
 * Usage:
 *   analyze_workshop <entry.opy> [--root <dir>] [--rules <id,id>] [--language <lang>]
 *                    [--backend wright|overpy|auto]
 * Output: exactly one JSON document on stdout.
 * Exit codes: 0 ok, 1 analysis/compile failure (fail closed), 2 usage, 3 environment. */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { resolveRules } = require("../lib/analyzer/registry.js");
const { dedupeAndOrder } = require("../lib/analyzer/findings.js");
const { loadProject } = require("../lib/analyzer/source.js");
const { provision, provisionCached, WrightProvisionError } = require("../lib/wright/provision.js");
const { wrightFindings, WrightToolError, mapDiagnostics } = require("../lib/wright/adapter.js");

const TOOL = "analyze_workshop";
const CONTRACT = "analyze_workshop@1";
const BACKENDS = new Set(["wright", "overpy", "auto"]);

(async () => {
  const parsed = parseArgs(process.argv.slice(2), {
    root: { value: true },
    rules: { value: true },
    language: { value: true },
    backend: { value: true },
  });
  if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);

  const [entry] = parsed.positional;
  if (!entry) fail(TOOL, CONTRACT, "USAGE", "usage: analyze_workshop <entry.opy> [--root <dir>] [--rules <id,id>] [--language <lang>] [--backend wright|overpy|auto]", 2);
  if (!fs.existsSync(entry)) fail(TOOL, CONTRACT, "FILE_NOT_FOUND", `input file not found: ${entry}`, 3);

  const root = parsed.options.root || path.dirname(path.resolve(entry));
  const language = parsed.options.language || "en-US";
  let backend = parsed.options.backend || "overpy";
  if (!BACKENDS.has(backend)) fail(TOOL, CONTRACT, "USAGE", `invalid --backend ${backend} (expected wright|overpy|auto)`, 2);
  // --rules selects local analyzer rules, which only exist on the overpy backend. Auto
  // with --rules therefore resolves to overpy (observable via the output backend field);
  // an explicit wright backend with --rules is a usage error.
  if (parsed.options.rules && backend === "auto") backend = "overpy";
  if (parsed.options.rules && backend === "wright") {
    fail(TOOL, CONTRACT, "USAGE", "--rules applies to the overpy backend only; the wright backend runs wright analyze + lint", 2);
  }

  // ---- wright backend ------------------------------------------------------------
  const runWrightBackend = async (wr) => {
    let res;
    try {
      res = wrightFindings(wr.bin, entry, { root, locale: language });
    } catch (e) {
      if (e instanceof WrightToolError) {
        if (e.code === "WRIGHT_DIAGNOSTIC") {
          emit({
            tool: TOOL,
            contract: CONTRACT,
            ok: false,
            backend: "wright",
            wright: { version: wr.version, contract: wr.contract, command: e.details.command, exit: e.details.exit },
            errors: e.details.diagnostics && e.details.diagnostics.length ? e.details.diagnostics : [{ message: e.message }],
          }, 1);
          return;
        }
        fail(TOOL, CONTRACT, e.code, e.message, 3);
      }
      throw e;
    }
    emit({
      tool: TOOL,
      contract: CONTRACT,
      ok: true,
      inputFile: entry,
      root,
      backend: "wright",
      wright: { version: wr.version, contract: wr.contract, commands: ["analyze", "lint"] },
      ruleCount: res.ruleCount,
      compile: null,
      findings: res.findings,
    }, 0);
  };

  if (backend === "wright") {
    try {
      const wr = await provision({});
      await runWrightBackend(wr);
      return;
    } catch (e) {
      if (e instanceof WrightProvisionError) fail(TOOL, CONTRACT, e.code, e.message, 3, e.hint);
      throw e;
    }
  }

  // ---- overpy backend ------------------------------------------------------------
  const runOverpyBackend = (fallback) => {
    const selected = resolveRules(parsed.options.rules);
    if (selected.error) fail(TOOL, CONTRACT, "UNKNOWN_RULE", selected.error, 2);

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

    let source;
    try {
      source = loadProject(entry, root);
    } catch (e) {
      fail(TOOL, CONTRACT, "ANALYSIS_UNSUPPORTED", `cannot parse source structure: ${e.message}`, 1);
    }

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
      backend: "overpy",
      ...(fallback ? { fallback } : {}),
      ruleCount: selected.rules.length,
      compile: { ok: true, nbElements: compile.nbElements, warningCount: compile.warningCount },
      findings,
    }, 0);
  };

  // ---- auto: wright when provisioned (cache only, no download), else overpy -------
  if (backend === "auto") {
    const cached = provisionCached({});
    if (cached) {
      await runWrightBackend(cached);
      return;
    }
    runOverpyBackend({ reason: "wright-not-provisioned", from: "wright", to: "overpy" });
    return;
  }

  runOverpyBackend();
})().catch((e) => {
  fail(TOOL, CONTRACT, "ANALYSIS_ERROR", `unexpected failure: ${e && e.message ? e.message : e}`, 3);
});
