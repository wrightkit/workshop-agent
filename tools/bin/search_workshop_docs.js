#!/usr/bin/env node
"use strict";
/* search_workshop_docs — deterministic local search over the md.owbastion.codes manifest.
 * Contract: tools/CONTRACTS.md §search_workshop_docs. Model/harness-neutral; no embeddings.
 * Usage:
 *   search_workshop_docs <query> [--manifest <url|file>] [--cache-dir <dir>] [--refresh] [--max <n>]
 * Output: exactly one JSON document on stdout. Exit codes: 0 ok, 2 usage, 3 backend/manifest error. */
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { loadManifest, search, DEFAULT_MANIFEST_URL, defaultCacheDir } = require("../lib/workshop_docs.js");

const TOOL = "search_workshop_docs";
const CONTRACT = "search_workshop_docs@1";

const parsed = parseArgs(process.argv.slice(2), {
  manifest: { value: true },
  "cache-dir": { value: true },
  refresh: { value: false },
  max: { value: true },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);
const [query] = parsed.positional;
if (!query) fail(TOOL, CONTRACT, "USAGE", "usage: search_workshop_docs <query> [--manifest <url|file>] [--cache-dir <dir>] [--refresh] [--max <n>]", 2);
const source = parsed.options.manifest || DEFAULT_MANIFEST_URL;
const max = parsed.options.max ? Number(parsed.options.max) : undefined;

(async () => {
  const loaded = await loadManifest({
    source,
    cacheDir: parsed.options["cache-dir"] || defaultCacheDir(),
    refresh: parsed.options.refresh === true,
  });
  if (loaded.error) {
    fail(TOOL, CONTRACT, loaded.error.code, loaded.error.message, 3);
  }
  const result = search(loaded.manifest, query, max);
  emit({
    tool: TOOL,
    contract: CONTRACT,
    ok: true,
    query,
    queryTokens: result.queryTokens,
    manifestSource: loaded.source,
    manifestFrom: loaded.from,
    manifestCacheHit: loaded.cacheHit,
    schemaVersion: loaded.manifest.schemaVersion,
    documentCount: (loaded.manifest.documents || []).length,
    totalMatches: result.total,
    truncated: result.truncated,
    candidates: result.candidates,
  }, 0);
})();
