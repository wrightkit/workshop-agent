#!/usr/bin/env node
"use strict";
/* analyze_workshop — M5 Workshop domain analyzer, Wright-evidence-first (#72).
 * Portable contract tool (see tools/CONTRACTS.md §analyze_workshop). No model/harness coupling.
 *
 * Backends (explicit, never silent — shared vocabulary in lib/wright/backend.js):
 *   --backend auto   (default) -> one composed analyzer: Wright `analyze` + `lint`
 *                        evidence (when the pinned binary is provisioned) merged with
 *                        the narrow Agent-local M5 rules that the pinned Wright
 *                        release has no counterpart for (see
 *                        lib/analyzer/wright-ownership.js). Findings carry per-finding
 *                        `backend` provenance. A Wright diagnostic on the input is
 *                        recorded in `wright.failure` and the documented local
 *                        compatibility path still runs; a Wright provisioning/tool
 *                        failure is a structured WRIGHT_* failure (exit 3).
 *                        When Wright is not provisioned, the overpy path runs with an
 *                        explicit `fallback` marker.
 *   --backend wright -> Wright-only (analyze + lint), provisioned on first use.
 *   --backend overpy -> legacy compose of compile_overpy@1 (overpy oracle) with the
 *                        local source-inspection rules.
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
const { effectiveLocalRules } = require("../lib/analyzer/wright-ownership.js");
const { provision, provisionCached, WrightProvisionError } = require("../lib/wright/provision.js");
const { wrightFindings, WrightToolError, mapDiagnostics } = require("../lib/wright/adapter.js");
const { PIN, RESULT_CLASS, FALLBACK_REASON, classifyWrightFailure, makeProvenance } = require("../lib/wright/backend.js");

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
  const backend = parsed.options.backend || "auto";
  if (!BACKENDS.has(backend)) fail(TOOL, CONTRACT, "USAGE", `invalid --backend ${backend} (expected wright|overpy|auto)`, 2);
  // --rules selects local analyzer rules; the wright backend runs wright analyze + lint
  // and has no local-rule selection, so an explicit wright backend with --rules is a
  // usage error (unchanged since #68).
  if (parsed.options.rules && backend === "wright") {
    fail(TOOL, CONTRACT, "USAGE", "--rules applies to the local analyzer rules only; the wright backend runs wright analyze + lint", 2);
  }

  // ---- wright-only backend ----------------------------------------------------------
  const runWrightOnly = async (wr) => {
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
            provenance: makeProvenance({
              requested: backend,
              effective: "wright",
              wright: { version: wr.version, contract: wr.contract, commands: ["analyze", "lint"] },
              compat: null,
              fallback: null,
              resultClass: RESULT_CLASS.SUPPORTED_DIAGNOSTIC,
            }),
            wright: { version: wr.version, contract: wr.contract, command: e.details.command, exit: e.details.exit },
            errors: e.details.diagnostics && e.details.diagnostics.length ? e.details.diagnostics : [{ message: e.message }],
          }, 1);
          return;
        }
        emit({
          tool: TOOL,
          contract: CONTRACT,
          ok: false,
          backend: "wright",
          provenance: makeProvenance({
            requested: backend,
            effective: "wright",
            wright: { version: wr.version, contract: wr.contract, commands: ["analyze", "lint"] },
            compat: null,
            fallback: null,
            resultClass: RESULT_CLASS.INFRA_FAILURE,
          }),
          error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) },
        }, 3);
        return;
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
      provenance: makeProvenance({
        requested: backend,
        effective: "wright",
        wright: { version: wr.version, contract: wr.contract, commands: ["analyze", "lint"] },
        compat: null,
        fallback: null,
        resultClass: RESULT_CLASS.SUPPORTED_VALID,
      }),
      wright: { version: wr.version, contract: wr.contract, commands: ["analyze", "lint"] },
      ruleCount: res.ruleCount,
      compile: null,
      findings: res.findings,
    }, 0);
  };

  if (backend === "wright") {
    try {
      const wr = await provision({});
      await runWrightOnly(wr);
      return;
    } catch (e) {
      if (e instanceof WrightProvisionError) fail(TOOL, CONTRACT, e.code, e.message, 3, e.hint);
      throw e;
    }
  }

  // ---- local rule machinery (overpy compile + source model) -------------------------
  // Shared by the `overpy` backend and the composed `auto` backend. The overpy oracle
  // compile is the documented compatibility path for the Agent-local rules; it is
  // requested explicitly so the compile tool never auto-selects Wright for this role.
  const runLocalRules = () => {
    const selected = resolveRules(parsed.options.rules);
    if (selected.error) fail(TOOL, CONTRACT, "UNKNOWN_RULE", selected.error, 2);
    const effective = effectiveLocalRules(selected.rules.map((r) => r.id));
    const ruleObjs = selected.rules.filter((r) => effective.includes(r.id));

    const compileBin = path.join(__dirname, "compile_overpy.js");
    const comp = spawnSync(process.execPath, [compileBin, entry, "--root", root, "--language", language, "--backend", "overpy"], {
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
    for (const rule of ruleObjs) {
      let res;
      try {
        res = rule.run({ source, compile, root });
      } catch (e) {
        fail(TOOL, CONTRACT, "ANALYSIS_ERROR", `rule ${rule.id} failed: ${e.message}`, 1);
      }
      findings.push(...((res && res.findings) || []).map((f) => ({ ...f, backend: "overpy" })));
    }
    return { findings, compile, ruleCount: ruleObjs.length, ruleIds: ruleObjs.map((r) => r.id) };
  };

  // ---- overpy backend ---------------------------------------------------------------
  if (backend === "overpy") {
    const local = runLocalRules();
    const findings = dedupeAndOrder(local.findings);
    emit({
      tool: TOOL,
      contract: CONTRACT,
      ok: true,
      inputFile: entry,
      root,
      backend: "overpy",
      provenance: makeProvenance({
        requested: "overpy",
        effective: "overpy",
        wright: null,
        compat: { name: "overpy", version: (local.compile.version && local.compile.version.overpy) || null },
        fallback: null,
        resultClass: RESULT_CLASS.SUPPORTED_VALID,
      }),
      ruleCount: local.ruleCount,
      compile: { ok: true, nbElements: local.compile.nbElements, warningCount: local.compile.warningCount },
      findings,
    }, 0);
    return;
  }

  // ---- auto backend: composed Wright evidence + Agent-local rules -------------------
  const local = runLocalRules();
  const cached = provisionCached({});
  const wrightMeta = cached ? { version: cached.version, contract: cached.contract, commands: ["analyze", "lint"] } : null;
  let fallback = null;
  let wrightFailure = null;
  let wrightFindingsList = [];

  if (cached) {
    try {
      wrightFindingsList = wrightFindings(cached.bin, entry, { root, locale: language }).findings;
    } catch (e) {
      if (e instanceof WrightToolError) {
        if (e.code === "WRIGHT_DIAGNOSTIC") {
          // Wright ran and reported a diagnostic (unsupported surface or genuine
          // failure). The diagnostic is recorded in wright.failure — never hidden —
          // and the documented local compatibility path continues.
          const cls = classifyWrightFailure(e);
          wrightFailure = {
            code: e.code,
            command: e.details.command,
            resultClass: cls.resultClass,
            diagnostics: (e.details.diagnostics || []).map((d) => ({ code: d.code, class: d.class, message: d.message, line: d.line, col: d.col, file: d.file })),
          };
        } else {
          // Wright provisioning/tool failure -> structured analyzer failure (#70 policy).
          emit({
            tool: TOOL,
            contract: CONTRACT,
            ok: false,
            backend: "auto",
            provenance: makeProvenance({
              requested: "auto",
              effective: "auto",
              wright: wrightMeta,
              compat: { name: "overpy", version: (local.compile.version && local.compile.version.overpy) || null },
              fallback: null,
              resultClass: RESULT_CLASS.INFRA_FAILURE,
            }),
            error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) },
          }, 3);
          return;
        }
      } else {
        throw e;
      }
    }
  } else {
    fallback = { reason: FALLBACK_REASON.NOT_PROVISIONED, from: "wright", to: "overpy" };
  }

  const findings = dedupeAndOrder([...wrightFindingsList, ...local.findings]);
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: true,
    inputFile: entry,
    root,
    backend: "auto",
    provenance: makeProvenance({
      requested: "auto",
      effective: "auto",
      wright: wrightMeta,
      compat: { name: "overpy", version: (local.compile.version && local.compile.version.overpy) || null },
      fallback,
      // When Wright ran and reported a diagnostic, the classification reflects the
      // Wright evidence layer (unsupported surface vs genuine diagnostic); the local
      // compatibility path's findings are still present and the failure is recorded.
      resultClass: fallback ? RESULT_CLASS.EXPLICIT_FALLBACK : wrightFailure ? wrightFailure.resultClass : RESULT_CLASS.SUPPORTED_VALID,
    }),
    ...(cached
      ? { wright: { ...wrightMeta, ...(wrightFailure ? { failure: wrightFailure } : {}) } }
      : { fallback }),
    localRules: { count: local.ruleCount, ids: local.ruleIds },
    ruleCount: local.ruleCount,
    compile: { ok: true, nbElements: local.compile.nbElements, warningCount: local.compile.warningCount },
    findings,
  }, 0);
})().catch((e) => {
  fail(TOOL, CONTRACT, "ANALYSIS_ERROR", `unexpected failure: ${e && e.message ? e.message : e}`, 3);
});
