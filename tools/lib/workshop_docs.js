"use strict";
/* Shared logic for Workshop documentation retrieval tools (search_workshop_docs,
 * fetch_workshop_doc). Consumer side of the md.owbastion.codes machine contract:
 * manifest discovery, deterministic local lexical search, ETag/hash-aware caching,
 * bounded exact-document fetch. Model/harness-neutral; no embeddings/vector storage. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_MANIFEST_URL = "https://md.owbastion.codes/manifest.json";
const DEFAULT_MAX_BYTES = 20000;
const DEFAULT_MAX_RESULTS = 8;

function defaultCacheDir() {
  return path.join(os.homedir(), ".cache", "owbastion-workshop-docs");
}

// ---- manifest ---------------------------------------------------------------

async function loadManifest({ source, cacheDir, refresh, timeoutMs }) {
  // source may be a URL or a local file path.
  const dir = cacheDir || defaultCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const cacheFile = path.join(dir, "manifest.json");
  const isLocal = /^file:|^\.{0,2}\//.test(source) || !/^https?:\/\//.test(source);
  if (!isLocal && !refresh && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      return { manifest: cached, cacheHit: true, source, from: "cache" };
    } catch (e) { /* fall through to fetch */ }
  }
  if (isLocal) {
    const file = source.replace(/^file:\/\//, "");
    if (!fs.existsSync(file)) return { error: { code: "MANIFEST_NOT_FOUND", message: `manifest file not found: ${file}` } };
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      return { error: { code: "MANIFEST_INVALID", message: `manifest not valid JSON: ${file}` } };
    }
    return { manifest, cacheHit: false, source: file, from: "file" };
  }
  // network fetch
  let res;
  try {
    res = await fetchWithTimeout(source, { timeoutMs });
  } catch (e) {
    return { error: { code: "MANIFEST_FETCH_FAILED", message: String((e && e.message) || e) } };
  }
  if (res.status !== 200 || looksLikeChallenge(res)) {
    return { error: { code: "MANIFEST_FETCH_FAILED", message: `backend returned ${res.status} (challenge/blocked?)` } };
  }
  let manifest;
  try {
    manifest = JSON.parse(await res.text());
  } catch (e) {
    return { error: { code: "MANIFEST_INVALID", message: "backend response not valid JSON" } };
  }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.documents)) {
    return { error: { code: "MANIFEST_INVALID", message: "manifest missing schemaVersion 1 / documents[]" } };
  }
  fs.writeFileSync(cacheFile, JSON.stringify(manifest, null, 2));
  return { manifest, cacheHit: false, source, from: "network" };
}

// ---- search -----------------------------------------------------------------

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(s) {
  return normalize(s).split(/\s+/).filter(Boolean);
}

function docIndex(doc) {
  const fields = [doc.title, doc.slug, ...(doc.aliases || [])].filter(Boolean).map(normalize);
  const all = new Set();
  for (const f of fields) for (const t of f.split(/\s+/)) all.add(t);
  return { fields, all };
}

function scoreDoc(doc, queryTokens) {
  const idx = docIndex(doc);
  const normSlug = normalize(doc.slug);
  const normTitle = normalize(doc.title);
  const q = queryTokens.join(" ");
  let score = 0;
  if (normSlug === q) score = 100;
  else if (normTitle === q) score = 95;
  else {
    for (const f of idx.fields) {
      if (f === q) { score = Math.max(score, 90); break; }
    }
    // token coverage against title+slug
    let hit = 0;
    for (const t of queryTokens) if (idx.all.has(t)) hit++;
    score = Math.max(score, 40 * (hit / queryTokens.length) + Math.min(10, hit));
  }
  return { score, matchedTokens: queryTokens.filter((t) => idx.all.has(t)).length };
}

function search(manifest, query, max) {
  const qt = tokens(query);
  if (qt.length === 0) return { candidates: [], total: 0, queryTokens: [] };
  const scored = (manifest.documents || []).map((doc) => ({ doc, ...scoreDoc(doc, qt) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.doc.slug < b.doc.slug ? -1 : 1));
  const total = scored.length;
  const capped = scored.slice(0, max || DEFAULT_MAX_RESULTS);
  return {
    queryTokens: qt,
    total,
    truncated: total > (max || DEFAULT_MAX_RESULTS),
    candidates: capped.map((s) => ({
      title: s.doc.title,
      slug: s.doc.slug,
      category: s.doc.category,
      sourceUrl: s.doc.sourceUrl,
      markdownUrl: s.doc.markdownUrl,
      aliases: s.doc.aliases || [],
      score: Math.round(s.score),
    })),
  };
}

// ---- document fetch ---------------------------------------------------------

async function resolveDoc(manifest, slug) {
  const norm = normalize(slug);
  if (!manifest || !manifest.documents) return null;
  const found = manifest.documents.find((d) => {
    if (normalize(d.slug) === norm) return true;
    return (d.aliases || []).some((a) => normalize(a) === norm);
  });
  return found || null;
}

async function fetchDoc({ manifest, manifestSource, slug, url, cacheDir, refresh, maxBytes, section, timeoutMs, logFile }) {
  const dir = cacheDir || defaultCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const doc = url ? { slug, markdownUrl: url } : await resolveDoc(manifest, slug);
  if (!doc) return { error: { code: "DOC_NOT_FOUND", message: `slug not found in manifest: ${slug}` } };
  const safeSlug = (doc.slug || slug).replace(/[^a-z0-9-]/gi, "_");
  const cacheFile = path.join(dir, `${safeSlug}.json`);
  const localPath = localDocPath(doc.markdownUrl, manifestSource);

  let cached = null;
  if (!refresh && fs.existsSync(cacheFile)) {
    try { cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (e) { cached = null; }
  }
  if (localPath !== null) {
    if (!fs.existsSync(localPath)) return { error: { code: "DOC_NOT_FOUND", message: `doc file not found: ${localPath}` } };
    const content = fs.readFileSync(localPath, "utf8");
    const record = { slug: doc.slug, etag: null, contentHash: contentHashOf(content), content, fetchedAt: new Date().toISOString() };
    return finalize({ doc, record, cacheFile, maxBytes, section, cacheHit: false, logFile });
  }
  // network fetch with ETag-aware conditional request
  const headers = {};
  if (cached && cached.etag) headers["If-None-Match"] = cached.etag;
  let res;
  try {
    res = await fetchWithTimeout(doc.markdownUrl, { timeoutMs, headers });
  } catch (e) {
    return { error: { code: "DOC_FETCH_FAILED", message: String((e && e.message) || e) } };
  }
  if (res.status === 304 && cached) {
    return finalize({ doc, record: cached, cacheFile, maxBytes, section, cacheHit: true, logFile });
  }
  if (res.status !== 200 || looksLikeChallenge(res)) {
    return { error: { code: "DOC_FETCH_FAILED", message: `backend returned ${res.status} (challenge/blocked?) for ${doc.markdownUrl}` } };
  }
  const content = await res.text();
  const etag = (res.headers.get("etag") || "").replace(/^W\//, "").replace(/"/g, "");
  const record = { slug: doc.slug, etag, contentHash: contentHashOf(content), content, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2));
  return finalize({ doc, record, cacheFile, maxBytes, section, cacheHit: false, logFile });
}

function finalize({ doc, record, maxBytes, section, cacheHit, logFile }) {
  const limit = maxBytes || DEFAULT_MAX_BYTES;
  let content = record.content || "";
  let truncated = false;
  if (content.length > limit) {
    content = content.slice(0, limit);
    truncated = true;
  }
  let sectionText = null;
  if (section) sectionText = extractSection(record.content || "", section);
  const out = {
    tool: "fetch_workshop_doc",
    slug: doc.slug,
    title: doc.title,
    sourceUrl: doc.sourceUrl,
    markdownUrl: doc.markdownUrl,
    contentHash: record.contentHash || null,
    etag: record.etag || null,
    contentLength: (record.content || "").length,
    truncated,
    cacheHit,
    fetchedAt: record.fetchedAt,
    ...(section ? { section: { requested: section, found: sectionText !== null, content: sectionText || null } } : {}),
    content,
  };
  if (logFile) appendLog(logFile, {
    op: "fetch_workshop_doc", slug: doc.slug, contentHash: out.contentHash, charsLoaded: out.contentLength,
    cacheHit, truncated, section: section || null, fetchedAt: out.fetchedAt,
  });
  return out;
}

// Resolve a markdownUrl to a local file path, or null when it is a network URL.
// Supports file:// URLs and relative paths (resolved against the manifest directory).
function localDocPath(markdownUrl, manifestSource) {
  if (!markdownUrl) return null;
  if (/^https?:\/\//.test(markdownUrl)) return null;
  let p = markdownUrl.replace(/^file:\/\//, "");
  if (!path.isAbsolute(p)) {
    if (!manifestSource) return null;
    p = path.resolve(path.dirname(manifestSource), p);
  }
  return p;
}

function contentHashOf(markdown) {
  // Prefer the frontmatter content_hash (backend-provided provenance) when present.
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (m) {
    const hm = /^content_hash:\s*([0-9a-f]{64})$/m.exec(m[1]);
    if (hm) return hm[1];
  }
  return crypto.createHash("sha256").update(markdown).digest("hex");
}

function extractSection(markdown, heading) {
  const target = normalize(heading);
  const lines = markdown.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      if (normalize(m[2]) === target) starts.push({ index: i, level });
    }
  }
  if (starts.length === 0) return null;
  const start = starts[0];
  const endIdx = lines.findIndex((l, i) => {
    if (i <= start.index) return false;
    const m = /^(#{1,6})\s+/.exec(l);
    return m && m[1].length <= start.level;
  });
  return lines.slice(start.index, endIdx === -1 ? lines.length : endIdx).join("\n");
}

function appendLog(file, record) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (e) { /* best effort */ }
}

async function fetchWithTimeout(url, { timeoutMs, headers }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    return await fetch(url, { signal: ctrl.signal, headers, redirect: "follow" });
  } finally {
    clearTimeout(t);
  }
}

function looksLikeChallenge(res) {
  const ct = (res.headers && res.headers.get("content-type")) || "";
  const status = res.status || 0;
  if (status === 403 || status === 406 || status === 503) return true;
  return /html/.test(ct) || /challenge|cloudflare|just a moment/i.test(ct);
}

module.exports = { DEFAULT_MANIFEST_URL, loadManifest, search, fetchDoc, resolveDoc, normalize, tokens, defaultCacheDir };
