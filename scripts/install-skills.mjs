#!/usr/bin/env node
"use strict";
/* install-skills — copy the canonical Workshop skills (and optionally tools) from this
 * distribution into a downstream Workshop project. Model/harness-neutral: skills are
 * plain SKILL.md files any Agent Skills-compatible harness can load.
 *
 * Usage:
 *   node scripts/install-skills.mjs <destination-dir> [--tools] [--dry-run]
 *
 * Behavior:
 *   - copies skills/ -> <dest>/skills/ (never overwrites an existing non-empty file set? no:
 *     it mirrors the canonical tree; existing same-named files are overwritten after a
 *     confirmation-free copy, so back up your project first or use --dry-run);
 *   - with --tools, copies tools/ (excluding node_modules) -> <dest>/tools/.
 *   This is a convenience; the repository itself is the canonical source of the skills. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const args = process.argv.slice(2);
const dest = args.find((a) => !a.startsWith("--"));
const withTools = args.includes("--tools");
const dryRun = args.includes("--dry-run");

if (!dest) {
  console.error("usage: node scripts/install-skills.mjs <destination-dir> [--tools] [--dry-run]");
  process.exit(2);
}

const SKIP = new Set(["node_modules", ".git", "build"]);

function copyTree(src, dst, prefix) {
  for (const en of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(en.name)) continue;
    const s = path.join(src, en.name);
    const d = path.join(dst, en.name);
    const rel = path.join(prefix, en.name);
    if (en.isDirectory()) {
      if (!dryRun) fs.mkdirSync(d, { recursive: true });
      copyTree(s, d, rel);
    } else {
      if (dryRun) {
        console.log(`would copy ${rel}`);
      } else {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
        console.log(`copied ${rel}`);
      }
    }
  }
}

if (!fs.existsSync(path.join(ROOT, "skills"))) {
  console.error("skills/ not found next to this script — run from the distribution repository root");
  process.exit(2);
}
fs.mkdirSync(dest, { recursive: true });
copyTree(path.join(ROOT, "skills"), path.join(dest, "skills"), "skills");
if (withTools) copyTree(path.join(ROOT, "tools"), path.join(dest, "tools"), "tools");
if (dryRun) console.log(`(dry run) destination: ${dest}`);
else console.log(`installed skills${withTools ? " + tools" : ""} -> ${dest}`);
