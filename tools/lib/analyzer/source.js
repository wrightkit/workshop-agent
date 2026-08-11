"use strict";
/* OverPy source-structure model for analyzer rules (analyze_workshop@1).
 *
 * Line-based and indentation-aware, deliberately conservative: the parser only claims
 * facts it can read from the structure (rule/subroutine blocks, annotations, statement
 * trees, tokens). It never infers semantics it cannot prove; when source structure is
 * malformed in a way the parser cannot represent, it throws so the CLI fails closed
 * instead of emitting a vacuous clean PASS.
 *
 * Supported OverPy structure:
 *   - `rule "name":` blocks with `@`-prefixed annotations and an indented body;
 *   - `subroutine NAME` / `def name():` blocks;
 *   - `#!include "path"` resolution (relative to the including file);
 *   - indentation-based statement trees for `if/elif/else`, `while`, `for`, plus
 *     statement classification (wait/waitUntil/return/loop/call/other). */
const fs = require("fs");
const path = require("path");

const MAX_INCLUDE_DEPTH = 32;
const MAX_FILES = 1000;

function stripInlineComment(line) {
  // Cut at a '#' that is not inside a double-quoted string.
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (ch === "#" && !inStr) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function isBlockHeader(text) {
  return /^(if|elif|else|while|for)\s+.*:$/.test(text) || /^def\s+\w+\(.*\):$/.test(text);
}

// Bracket-depth delta of a line, ignoring quoted strings and trailing comments. A
// positive running total means the logical statement continues on the next line (OverPy
// allows multi-line parenthesized calls, array literals, and dict literals).
function parenDelta(line) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "#") break; // comment to end of line
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
  }
  return depth;
}

// Join paren-continuation lines (which may carry arbitrary continuation indentation) into
// one logical statement line, returning { text, next }.
function joinLogicalLine(rawLines, index) {
  let text = rawLines[index];
  let j = index + 1;
  let depth = parenDelta(text);
  while (j < rawLines.length && depth > 0) {
    text += "\n" + rawLines[j];
    depth += parenDelta(rawLines[j]);
    j++;
  }
  return { text, next: j };
}

// Classify a single statement line (block-relative text). Multi-line joined statements
// are normalized per line (inline comments stripped, whitespace collapsed) so headers
// like a multi-line `if ...:` are recognized.
function classifyLine(text) {
  const t = String(text)
    .split("\n")
    .map((l) => stripInlineComment(l).trim())
    .filter(Boolean)
    .join(" ");
  if (/^wait\(/i.test(t)) return "wait";
  if (/^waitUntil\(/i.test(t)) return "waitUntil";
  if (/^return\b/.test(t)) return "return";
  if (/^break\b/.test(t)) return "break";
  if (/^continue\b/.test(t)) return "continue";
  if (/^loop\(/i.test(t)) return "loop";
  if (/^if\s+.+:$/.test(t)) return "if";
  if (/^elif\s+.+:$/.test(t)) return "elif";
  if (/^else\s*:$/.test(t)) return "else";
  if (/^while\s+.+:$/.test(t)) return "while";
  if (/^for\s+.+:$/.test(t)) return "for";
  if (/^[a-zA-Z_]\w*\s*\(/.test(t)) return "call";
  return "other";
}

// Parse an indented statement list. `lines` are { indent, text, line } with indent
// measured from column 0; `indent` is the column of this block's statements.
// Throws on structure the parser cannot represent (unexpected indentation).
const parseCtx = [];
function parseStatements(lines, index, indent) {
  parseCtx.push(lines[index] ? `${lines[index].line}@${lines[index].indent}` : "?");
  try {
    return parseStatementsInner(lines, index, indent);
  } finally {
    parseCtx.pop();
  }
}
function parseStatementsInner(lines, index, indent) {
  const nodes = [];
  let i = index;
  while (i < lines.length) {
    const ln = lines[i];
    // Comment and blank lines carry no structure; skip them regardless of indentation
    // (over-indented comments are common in real projects).
    const skipText = stripInlineComment(ln.text).trim();
    if (skipText === "" || skipText.startsWith("#")) {
      i++;
      continue;
    }
    if (ln.indent < indent) break; // dedent: block ended
    if (ln.indent > indent) {
      throw new Error(`unexpected indentation at ${ln.file}:${ln.line} (${ln.indent} > ${indent})${process.env.OWB_PARSE_TRACE ? ` [ctx=${parseCtx.join(" -> ")}]` : ""}`);
    }
    const text = skipText;
    const type = classifyLine(ln.text);
    if (type === "elif" || type === "else") {
      throw new Error(`unexpected ${type} without a preceding if at ${ln.file}:${ln.line}`);
    }
    const node = { type, text, line: ln.line, file: ln.file, body: [], branches: [] };
    nodes.push(node);
    i++;
    if (type === "if" || type === "while" || type === "for") {
      // consume nested body (lines with indent > this line's indent)
      if (i < lines.length && lines[i].indent > ln.indent) {
        const childIndent = lines[i].indent;
        const child = parseStatements(lines, i, childIndent);
        node.body = child.nodes;
        i = child.next;
      }
      if (type === "if") {
        // elif/else at the same indent as the if header belong to this if; comments and
        // blank lines between them are skipped.
        for (;;) {
          while (i < lines.length && lines[i].indent === ln.indent) {
            const c = stripInlineComment(lines[i].text).trim();
            if (c === "" || c.startsWith("#")) i++;
            else break;
          }
          if (i >= lines.length || lines[i].indent !== ln.indent) break;
          const ct = classifyLine(lines[i].text);
          if (ct !== "elif" && ct !== "else") break;
          const br = { cond: stripInlineComment(lines[i].text).replace(/:$/, "").trim(), line: lines[i].line, body: [] };
          i++;
          if (i < lines.length && lines[i].indent > ln.indent) {
            const bi = lines[i].indent;
            const bc = parseStatements(lines, i, bi);
            br.body = bc.nodes;
            i = bc.next;
          }
          node.branches.push(br);
        }
      }
    }
  }
  return { nodes, next: i };
}

// Scan a file for `#!include` targets; returns absolute paths.
function includeTargets(absFile) {
  const dir = path.dirname(absFile);
  const out = [];
  const content = fs.readFileSync(absFile, "utf8");
  for (const line of content.split("\n")) {
    const m = /^\s*#!include\s+"?([^"\s]+)"?\s*$/.exec(line.trim());
    if (m) out.push(path.resolve(dir, m[1]));
  }
  return out;
}

// Resolve the project file set starting from the entry (entry + transitive includes).
// OverPy `#!include` may name a file or a directory; directories expand to every `.opy`
// file inside (recursively, deterministic order). Cycles are broken by the seen set and
// runaway expansion is capped by MAX_FILES.
function resolveFiles(entryAbs) {
  const files = []; // { abs, rel }
  const seen = new Set();
  const queue = [entryAbs];
  while (queue.length) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!fs.existsSync(abs)) throw new Error(`included file not found: ${abs}`);
    let targets;
    if (fs.statSync(abs).isDirectory()) {
      targets = walkOpy(abs);
    } else {
      files.push({ abs });
      targets = includeTargets(abs);
    }
    if (files.length > MAX_FILES) throw new Error(`too many included files (> ${MAX_FILES})`);
    for (const t of targets) {
      if (!seen.has(t)) queue.push(t);
    }
  }
  return files;
}

// Recursively list .opy files under a directory, deterministically sorted.
function walkOpy(dir) {
  const out = [];
  for (const en of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, en.name);
    if (en.isDirectory()) out.push(...walkOpy(p));
    else if (en.isFile() && en.name.endsWith(".opy")) out.push(p);
  }
  return out;
}

// Parse one file into blocks: rule/subroutine headers + annotations + body lines.
function parseBlocks(absFile, relFile) {
  const lines = fs.readFileSync(absFile, "utf8").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const text = line.trim();
    const indent = line.length - line.trimStart().length;
    let kind = null;
    let name = null;
    let m;
    if (indent === 0) {
      if ((m = /^rule\s+"([^"]*)":/.exec(text))) {
        kind = "rule";
        name = m[1];
      } else if ((m = /^def\s+(\w+)\s*\(.*\):/.exec(text))) {
        kind = "subroutine";
        name = m[1];
      }
    }
    if (kind === null) {
      i++;
      continue;
    }
    const block = {
      kind,
      name,
      file: relFile,
      startLine: i + 1,
      annotations: [],
      body: [],
    };
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      const ind = l.length - l.trimStart().length;
      if (ind === 0 && t !== "") break; // next top-level block
      if (t === "") {
        i++;
        continue;
      }
      if (t.startsWith("@")) {
        block.annotations.push({ line: i + 1, text: t });
        i++;
        continue;
      }
      // join multi-line parenthesized statements into one logical line
      const joined = joinLogicalLine(lines, i);
      block.body.push({ indent: ind, text: joined.text, line: i + 1, file: relFile });
      i = joined.next;
    }
    // Normalize indentation onto the 4-space grid relative to the block base: OverPy
    // accepts off-grid indents (e.g. a 5-space `if` under a 4-space block), and floor
    // snapping keeps header/body level ordering intact.
    if (block.body.length) {
      const base = block.body[0].indent;
      for (const e of block.body) e.indent = Math.max(base, base + Math.floor((e.indent - base) / 4) * 4);
    }
    blocks.push(block);
  }
  return blocks;
}

// Load and model a project: entry + includes -> files -> blocks -> statement trees.
// Throws on structure that cannot be represented (CLI fails closed).
function loadProject(entry, root) {
  const entryAbs = path.resolve(entry);
  const rootAbs = path.resolve(root || path.dirname(entryAbs));
  const files = resolveFiles(entryAbs).map((f) => {
    const rel = path.relative(rootAbs, f.abs);
    return { abs: f.abs, rel: rel || path.basename(f.abs) };
  });
  const blocks = [];
  for (const f of files) {
    for (const b of parseBlocks(f.abs, f.rel)) {
      b.tree = parseStatements(b.body, 0, b.body.length ? b.body[0].indent : 0).nodes;
      blocks.push(b);
    }
  }
  const byName = new Map();
  for (const b of blocks) {
    if (b.kind === "subroutine" && !byName.has(b.name)) byName.set(b.name, b);
  }
  return { entry: entryAbs, root: rootAbs, files, blocks, subroutines: byName };
}

// Rule context facts used by context-sensitive rules (#47).
const NO_EVENT_PLAYER_EVENTS = new Set(["global", "ongoingglobal", "ongoingglobal"]);
function ruleEvent(block) {
  const ev = block.annotations.find((a) => /^@Event\b/.test(a.text));
  return ev ? ev.text.replace(/^@Event\s*/, "").trim() : null;
}
// A rule has an event player unless it is an ongoing global rule (no @Event, or an
// explicitly global event). Unknown @Event values are treated as player-bearing
// (conservative: only flag when we can prove there is no event player).
function hasEventPlayer(block) {
  const ev = ruleEvent(block);
  if (ev === null) return false;
  return !NO_EVENT_PLAYER_EVENTS.has(ev.toLowerCase());
}

// Scan a block's full body text for a token regex; returns locations (file, line, col).
function scanTokens(block, re) {
  const out = [];
  for (const ln of block.body) {
    const m = re.exec(ln.text);
    if (m) out.push({ file: ln.file, line: ln.line, col: ln.text.indexOf(m[0]) + 1 });
  }
  return out;
}

// Collect subroutine call targets reachable anywhere in a statement tree.
function collectCalls(nodes, acc = []) {
  for (const n of nodes || []) {
    if (n.type === "call") {
      const m = /^([a-zA-Z_]\w*)\s*\(/.exec(n.text);
      if (m) acc.push({ name: m[1], line: n.line, file: n.file });
    }
    if (n.body && n.body.length) collectCalls(n.body, acc);
    for (const br of n.branches || []) collectCalls(br.body, acc);
  }
  return acc;
}

module.exports = {
  loadProject,
  parseStatements,
  parseBlocks,
  joinLogicalLine,
  parenDelta,
  classifyLine,
  hasEventPlayer,
  ruleEvent,
  scanTokens,
  collectCalls,
  stripInlineComment,
};
