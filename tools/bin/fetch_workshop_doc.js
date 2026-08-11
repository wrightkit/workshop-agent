#!/usr/bin/env node
"use strict";
/* fetch_workshop_doc — exact Markdown retrieval from md.owbastion.codes with bounded
 * output, ETag/hash-aware caching, and fail-closed backend errors.
 * Contract: tools/CONTRACTS.md §fetch_workshop_doc. Model/harness-neutral.
 * Usage:
 *   fetch_workshop_doc <slug> [--manifest <url|file>] [--cache-dir <dir>] [--refresh]
 *       [--max-bytes <n>] [--section <heading>] [--url <markdownUrl>] [--log <file>]
 * Output: exactly one JSON document on stdout. Exit codes: 0 ok, 2 usage, 3 backend error,
 * 4 document not found. */
const { emit, fail, parseArgs } = require("../lib/cli.js");
const { loadManifest, fetchDoc, DEFAULT_MANIFEST_URL, defaultCacheDir } = require("../lib/workshop_docs.js");

const TOOL = "fetch_workshop_doc";
const CONTRACT = "fetch_workshop_doc@1";

const parsed = parseArgs(process.argv.slice(2), {
  manifest: { value: true },
  "cache-dir": { value: true },
  refresh: { value: false },
  "max-bytes": { value: true },
  section: { value: true },
  url: { value: true },
  log: { value: true },
});
if (parsed.unknown) fail(TOOL, CONTRACT, "USAGE", `unknown option: --${parsed.unknown}`, 2);
const [slug] = parsed.positional;
if (!slug) fail(TOOL, CONTRACT, "USAGE", "usage: fetch_workshop_doc <slug> [--manifest <url|file>] [--url <markdownUrl>] [--section <heading>] [--log <file>]", 2);

(async () => {
  let manifest = null;
  if (!parsed.options.url) {
    const source = parsed.options.manifest || DEFAULT_MANIFEST_URL;
    const loaded = await loadManifest({
      source,
      cacheDir: parsed.options["cache-dir"] || defaultCacheDir(),
      refresh: parsed.options.refresh === true,
    });
    if (loaded.error) fail(TOOL, CONTRACT, loaded.error.code, loaded.error.message, 3);
    manifest = loaded.manifest;
  }
  const out = await fetchDoc({
    manifest,
    manifestSource: parsed.options.url ? undefined : (parsed.options.manifest || DEFAULT_MANIFEST_URL),
    slug,
    url: parsed.options.url,
    cacheDir: parsed.options["cache-dir"] || defaultCacheDir(),
    refresh: parsed.options.refresh === true,
    maxBytes: parsed.options["max-bytes"] ? Number(parsed.options["max-bytes"]) : undefined,
    section: parsed.options.section,
    logFile: parsed.options.log,
  });
  if (out.error) {
    fail(TOOL, CONTRACT, out.error.code, out.error.message, out.error.code === "DOC_NOT_FOUND" ? 4 : 3);
  }
  emit({ tool: TOOL, contract: CONTRACT, ok: true, ...out }, 0);
})();
