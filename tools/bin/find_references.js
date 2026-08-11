#!/usr/bin/env node
"use strict";
/* find_references — locate reference occurrences of a symbol/name.
 * Contract: tools/CONTRACTS.md §find_references. Backend: ripgrep (grep fallback).
 * Same textual search as find_symbol; search is case-sensitive by default.
 * See CONTRACTS.md for the definition/reference distinction and confidence semantics.
 * Usage: find_references <name> [--dir <path>] [--glob <pat>]
 * Output: exactly one JSON document on stdout. Exit codes: 0 ok, 2 usage/backend error. */
const { search } = require("../lib/search.js");
const { emit, fail, parseArgs } = require("../lib/cli.js");

const TOOL = "find_references";
const CONTRACT = "find_references@1";

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
