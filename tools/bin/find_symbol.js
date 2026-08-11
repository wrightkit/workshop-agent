#!/usr/bin/env node
"use strict";
/* find_symbol — locate a symbol/name (definitions and uses) with structured results.
 * Contract: tools/CONTRACTS.md §find_symbol. Backend: ripgrep (grep fallback).
 * Search is case-sensitive by default.
 * Usage: find_symbol <name> [--dir <path>] [--glob <pat>]
 * Output: exactly one JSON document on stdout. Exit codes: 0 ok, 2 usage/backend error. */
const { search } = require("../lib/search.js");
const { emit, fail, parseArgs } = require("../lib/cli.js");

const TOOL = "find_symbol";
const CONTRACT = "find_symbol@1";

const parsed = parseArgs(process.argv.slice(2), {
  dir: { value: true },
  glob: { value: true },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);

const [name] = parsed.positional;
const dir = parsed.options.dir;
const glob = parsed.options.glob;

const r = search({ tool: TOOL, name, dir, glob });
if (r.code) {
  fail(TOOL, CONTRACT, r.code, r.message, r.code === "FILE_NOT_FOUND" ? 3 : 2, r.hint);
} else {
  emit({ ...r, ok: true }, 0);
}
