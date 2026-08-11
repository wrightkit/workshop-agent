"use strict";
/* Shared backend for search tools (find_symbol / find_references).
 * Uses ripgrep; falls back to grep when rg is unavailable (ENOENT only —
 * other spawn failures are genuine backend errors and are reported).
 * Search is case-sensitive by default; matches are textual (confidence: "textual"),
 * definition/reference classification is a labeled heuristic, never proven semantics. */
const { spawnSync } = require("child_process");
const fs = require("fs");

const MAX_MATCHES = 200;
const GREP_DEFAULT_INCLUDES = ["*.opy", "*.md", "*.ts", "*.json"];
const GREP_EXCLUDE_DIRS = ["node_modules", ".git", "build"];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDefinitionLine(line, name) {
  return new RegExp(`^\\s*(def|playervar|globalvar|subroutine)\\s+${escapeRegex(name)}\\b`).test(line) ||
    new RegExp(`#!define\\s+${escapeRegex(name)}\\b`).test(line);
}

// Map a simple extension glob ("*.opy") to grep --include; other patterns unsupported.
function simpleExtGlob(pattern) {
  if (pattern === "*") return { include: null };
  if (/^\*?\.[A-Za-z0-9_-]+$/.test(pattern)) return { include: pattern.startsWith("*") ? pattern : `*${pattern}` };
  return null;
}

function runRg({ name, dir, glob, env }) {
  const args = ["--line-number", "--column", "--no-heading", "--with-filename", "--color", "never", "-g", "!node_modules"];
  if (glob) args.push("-g", glob);
  args.push(`\\b${escapeRegex(name)}\\b`);
  if (dir) args.push(dir);
  const r = spawnSync("rg", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env });
  if (r.error) {
    if (r.error.code === "ENOENT") return { unavailable: true };
    return { error: r.error };
  }
  return { stdout: r.stdout || "", code: r.status };
}

function runGrep({ name, dir, glob, env }) {
  const args = ["-rn"];
  for (const d of GREP_EXCLUDE_DIRS) args.push(`--exclude-dir=${d}`);
  let note = null;
  if (glob) {
    const m = simpleExtGlob(glob);
    if (m && m.include) args.push(`--include=${m.include}`);
    else if (glob !== "*") note = `--glob ${glob} not supported by grep fallback; searched without it`;
  } else {
    for (const inc of GREP_DEFAULT_INCLUDES) args.push(`--include=${inc}`);
  }
  args.push(`\\b${escapeRegex(name)}\\b`, dir || ".");
  const r = spawnSync("grep", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env });
  if (r.error) {
    if (r.error.code === "ENOENT") return { unavailable: true };
    return { error: r.error };
  }
  return { stdout: r.stdout || "", code: r.status, note };
}

function parseRgLine(line) {
  const m = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]), text: m[4] };
}

function parseGrepLine(line) {
  const m = line.match(/^(.+?):(\d+):(.*)$/);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), col: null, text: m[3] };
}

// Returns a success payload, or { code, message, hint? } for usage/backend errors.
function search({ tool, name, dir, glob, env }) {
  const childEnv = env || process.env;
  if (!name) return { code: "USAGE", message: "pass a symbol/name to search for" };
  if (dir && !fs.existsSync(dir)) return { code: "FILE_NOT_FOUND", message: `directory not found: ${dir}` };

  let matches = [];
  let backend = "rg";
  let fallbackNote = null;

  const rg = runRg({ name, dir, glob, env: childEnv });
  if (rg.unavailable) {
    backend = "grep";
    const g = runGrep({ name, dir, glob, env: childEnv });
    if (g.unavailable) {
      return { code: "BACKEND_UNAVAILABLE", message: "neither ripgrep nor grep is available", hint: "install ripgrep or ensure grep is on PATH" };
    }
    if (g.error) return { code: "BACKEND_ERROR", message: `grep failed: ${g.error.message}` };
    matches = g.stdout.split("\n").filter(Boolean).map(parseGrepLine).filter(Boolean);
    fallbackNote = g.note || null;
  } else if (rg.error) {
    return { code: "BACKEND_ERROR", message: `ripgrep failed: ${rg.error.message}` };
  } else if (rg.code === 0 || rg.code === 1) {
    matches = rg.stdout.split("\n").filter(Boolean).map(parseRgLine).filter(Boolean);
  } else {
    return { code: "BACKEND_ERROR", message: `ripgrep exited with code ${rg.code}` };
  }

  const truncated = matches.length > MAX_MATCHES;
  const capped = truncated ? matches.slice(0, MAX_MATCHES) : matches;
  const out = {
    tool,
    contract: `${tool}@1`,
    ok: true,
    query: name,
    dir: dir || ".",
    backend,
    confidence: "textual", // not proven semantic: see tools/CONTRACTS.md
    matchCount: matches.length,
    truncated,
    matches: capped.map((m) => ({
      file: m.file,
      line: m.line,
      col: m.col,
      text: m.text.trim().slice(0, 300),
      kind: isDefinitionLine(m.text, name) ? "definition_likely" : "reference_likely",
    })),
  };
  if (fallbackNote) out.fallbackNote = fallbackNote;
  if (matches.length === 0) out.noMatches = true;
  return out;
}

module.exports = { search };
