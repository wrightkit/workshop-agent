# Workshop tool contracts

M2 tools expose narrow contracts that are neutral to models, providers, and harnesses. Implementations contain no model/provider behavior. Codex, Claude Code, Gemini CLI, OpenCode, Grok-compatible tools, future MCP clients, and non-LLM automation consume the same inputs and outputs.

## General rules

- **Transport:** a CLI subprocess writes exactly one JSON document to stdout. Errors are represented in JSON and do not require stderr parsing.
- **Capability names:** `compile_overpy`, `find_symbol`, `find_references`, and `inspect_rule` describe capabilities rather than harness-specific verbs.
- **Envelope:** successful output includes `tool`, `contract` such as `compile_overpy@1`, and `ok`. There are two error envelopes:
  - usage/backend/environment error: `{ tool, contract, ok:false, error:{ code, message, hint? } }`;
  - compile/validation failure: `{ tool, contract, ok:false, errors:[{ message, line?, col?, file? }] }`.
- **Exit codes:** `0` success, including no matches; `1` compile/validation failure; `2` usage or backend error, including an unknown option; `3` environment error such as a missing dependency or file.
- Unknown `--` options are rejected with `USAGE` and exit `2`. Removed options must not be silently ignored.
- Every path emits exactly one JSON document and must not leak an uncaught stack trace on an expected failure.
- Partial results are explicit through fields such as `truncated`, `matchCount`, `warningCount`, and `filesTruncated`.
- Textual matching uses `confidence: "textual"`; lexical extraction uses `heuristic: true` plus limitations. Do not present heuristic counts as authoritative performance scores.
- The supported dependency baseline is `overpy ^9.7.9` and Node >= 20. Output includes a version description so callers can interpret diagnostics.
- Missing dependencies return a code such as `OVERPY_NOT_FOUND` and a `hint`; no silent fallback is allowed.

## `compile_overpy@1`

**Input:** `compile_overpy <file.opy> [--root <path>] [--language <lang>] [--full] [--full-warnings] [--backend wright|overpy|auto]`

Compiles the OverPy entry and returns a structured envelope: `ok`, `version`, `nbElements`, `errors` (structured `{message,line,col,file}`), `warnings` (string previews, capped at 50 unless `--full-warnings`), `warningCount`, plus global/player variables and subroutines. Since M5, the envelope also includes `warningDetails` — the full, uncapped, structured warning list: `{ code, message, severity, file, line, col }`, where `file`/`line`/`col` come from the innermost compiler file-stack entry (the actual warning site) and `code` is the OverPy warning code (e.g. `w_ow2_rule_condition_chase`). Consumers use `warningDetails` to recognize warning codes deterministically instead of parsing raw stderr; the `warnings` string previews remain unchanged for backward compatibility.

The target may be a project entry point or a standalone file. `--root` defaults to the input directory, and `#!mainFile` is resolved relative to that root in the same way as the downstream build.

Since #71 the default backend is **`auto`** (Wright-first, see below). Every output carries additive `backend` and `provenance` fields:

- `backend` — the effective backend: `wright` or `overpy`.
- `provenance` — the shared backend/provenance vocabulary (see §Backend and provenance): `requested`, `effective`, `wright`, `compat`, `fallback`, `resultClass`.
- `version` — `{ tool, language, overpy, wright }` (the backend that did not run reports `null`).

Backends:

- `auto` (default) — Wright when the pinned released binary is already provisioned in the cache (no download); otherwise OverPy with an explicit `fallback: { reason: "wright-not-provisioned", from, to }` marker. Never silent.
- `wright` — provisions the pinned released Wright binary (`tools/lib/wright/pin.json`, checksum/version-validated; never `main` or a source checkout) and runs `wright compile` (+ `wright inspect` for variable/subroutine identity). Workshop emission evidence comes from Wright's machine-readable JSON. `nbElements` is an explicit `null` (Wright v0.1.0 does not compute OverPy element counts — a documented unsupported field, never fabricated). `warnings`/`warningDetails` are empty (Wright compile reports diagnostics, not OverPy warnings). On a **declared unsupported Wright surface** (support-matrix boundary, see `lib/wright/backend.js`) the tool runs an explicit OverPy compatibility fallback with `fallback.reason: "unsupported-surface"` and the Wright diagnostics + version in the marker. On a **genuine Wright diagnostic** (e.g. `parse-error`, `unknown-identifier`) the tool fails closed (`ok: false`, `errors[].code`/`class`, exit 1) and never falls back. On a **Wright provisioning/tool failure** it fails with a `WRIGHT_*` code (exit 3).
- `overpy` — the legacy OverPy oracle path (`overpy.compile()`), unchanged behavior plus the additive backend/provenance fields.

Successful output includes `warnings` (up to 50 preview entries plus `warningCount`), `globalVariables`, `playerVariables`, `subroutines`, deterministic `nbElements`, `activatedExtensions`, `outputLength`, and `outputPreview`; `--full` includes the full compiled output. Compile failures include `errors: [{ message, line, col, file }]`, with null line/column when the compiler message cannot be parsed.

OverPy is resolved from the tool's own dependencies or the target project's dependencies. Missing packages return `OVERPY_NOT_FOUND`. Wright diagnostics carry `code` and `class` (`unsupported` | `diagnostic`) so an agent can distinguish a declared compatibility surface from a genuine failure.

## `find_symbol@1`

**Input:** `find_symbol <name> [--dir <path>] [--glob <pat>]`

Search is case-sensitive. The removed `--case-sensitive` option is rejected because it did not change behavior. Output includes `matches: [{ file, line, col, text, kind }]`, where `kind` is `definition_likely` or `reference_likely`, plus `confidence: "textual"`, backend, count, truncation, and no-match fields. The backend is ripgrep with a grep fallback; no index or persistent storage is created.

Errors include `USAGE` for missing arguments, `FILE_NOT_FOUND` for a missing directory, `BACKEND_UNAVAILABLE` when no backend exists, and `BACKEND_ERROR` for a real backend failure.

## `find_references@1`

**Input:** `find_references <name> [--dir <path>] [--glob <pat>]`

It uses the same backend and output structure as `find_symbol`. A declaration is likely only when the line matches patterns such as `def`, `playervar`, `globalvar`, `subroutine`, or `#!define`. Semantic reference relationships cannot be proven and must remain `confidence: "textual"`.

When grep is the fallback, simple extension globs such as `*.opy` map to `--include`. Unsupported glob forms are reported in `fallbackNote` rather than silently changing filtering semantics.

## `inspect_rule@1`

**Input:** `inspect_rule <file.opy | dir> [--glob <pat>] [--backend wright|lexical|auto]`

Output includes `files[]` with per-file `ruleCount`, variables, and `opCounts`; `rules[]` with name, line, disabled, event, team, hero, conditions, action count, and operations; `total`; and `limitations[]`.

Since #73 the default backend is **`auto`** and single-file inspection is Wright-first:

- `auto` (default) — Wright semantic inspection when the pinned released binary is
  already provisioned in the cache (no download); otherwise the lexical extractor with
  an explicit `fallback` marker. Never silent.
- `wright` — provisions the pinned released Wright binary and runs `wright inspect`
  for the supported single-file case. Rule identity (name/line) and variable
  declarations (global/player, plus subroutine symbols) are **Wright-semantic**;
  event/team/hero/conditions, action counts, and op counts remain explicitly lexical.
  Per-rule `evidence` marks each field `semantic` or `lexical`; per-variable `source`
  does the same. An additive per-file `semantic` block carries `symbols` (kind/name/
  span) and `references` (read/write/call/declaration locations with their symbol),
  capped with `referencesTruncated`. When Wright reports a diagnostic on the input,
  the tool falls back to the lexical extractor with an explicit `fallback` marker
  (`reason: "wright-inspect-failed"`, Wright diagnostics + version recorded) — the
  lexical extractor remains the documented compatibility path for unsupported or
  partially invalid source. Wright provisioning/tool failures are structured
  `WRIGHT_*` errors (exit 3), never a silent lexical result.
- `lexical` — the legacy line-based extractor, unchanged, with `backend: "lexical"`.

Directory inputs always use the lexical extractor (bulk scan; Wright inspect is
single-input); `provenance` records `fallback.reason: "directory-input"` when a Wright
backend was requested.

Extraction remains explicitly marked `heuristic: true` where textual: rules, events,
and conditions are parsed by line rather than a compiler AST; operation counts are text
occurrences rather than semantic performance scores. Operation dimensions include
`distance`, `playersInRadius`, `livingPlayers`, `playersInView`, `filteredArray`,
`sortedArray`, `mappedArray`, `arrayPredicate`, `damage`, `heal`, `waitUntil`, `wait`,
`loop`, `createEffect`, `throttleOrFacing`, and `serverLoad`. When the Wright backend
ran, the output additionally carries `backend`, `provenance` (see §Backend and
provenance), `semantic: true`, and a `wright` provenance block.

## `search_workshop_docs@1`

**Input:** `search_workshop_docs <query> [--manifest <url|file>] [--cache-dir <dir>] [--refresh] [--max <n>]`

Fetches/caches the `md.owbastion.codes/manifest.json` metadata manifest (schemaVersion 1), normalizes the query (lowercase, hyphen/space equivalence: `Start Damage Over Time` / `start-damage-over-time` / `start damage over time` hit the same document), and performs **deterministic local lexical/fuzzy lookup** (no embeddings/vector storage). Returns ranked candidates with `title`, `slug`, `category`, `sourceUrl`, `markdownUrl`, `aliases`, `score`, plus explicit `totalMatches`, `truncated`, `manifestCacheHit`, and `documentCount`. Aliases come only from the manifest (`[title, slug]`); no OverPy/OSTW aliases are invented.

Errors: manifest missing/invalid or backend 403/challenge/unreachable → `MANIFEST_NOT_FOUND` / `MANIFEST_INVALID` / `MANIFEST_FETCH_FAILED` (exit 3). A local `--manifest <file>` supports offline/mirror validation.

## `fetch_workshop_doc@1`

**Input:** `fetch_workshop_doc <slug> [--manifest <url|file>] [--url <markdownUrl>] [--cache-dir <dir>] [--refresh] [--max-bytes <n>] [--section <heading>] [--log <file>]`

Resolves the slug through the manifest and fetches the exact Markdown document with **ETag/content-hash-aware local caching** (conditional request; 304 is a cache hit). Returns `sourceUrl`, `markdownUrl`, `contentHash` (frontmatter `content_hash` when present), `etag`, `contentLength`, `truncated`, `cacheHit`, `fetchedAt`, and `content`. Default content bound is 20 KB (`--max-bytes` configurable); `--section` deterministically extracts a heading block without fragile semantic parsing. `--log <file>` appends retrieval-provenance JSONL (query/slug/contentHash/charsLoaded/cacheHit/section) for M4 run evidence.

Errors: backend 403/challenge/unreachable → `DOC_FETCH_FAILED` (exit 3); slug not in manifest or local doc file missing → `DOC_NOT_FOUND` (exit 4). The tool never dumps an entire wiki corpus into context.

## `analyze_workshop@1`

**Input:** `analyze_workshop <entry.opy> [--root <dir>] [--rules <id,id>] [--language <lang>] [--backend wright|overpy|auto]`

Composes `compile_overpy@1` (subprocess JSON contract) with small source-inspection analyzer rules into structured Workshop-specific findings. Rules never re-implement compiler semantics: compiler facts come from `compile_overpy@1`; structural facts come from an OverPy source model (rule/subroutine blocks, annotations, indentation-based statement trees, `#!include` resolution); heuristic risks are flagged explicitly. No network, model, or harness dependency (the default backend).

Since #68 the tool has a Wright-backed path, and since #72 the default is the composed
`auto` backend. `--backend` selects the analysis source:

- `auto` (default, since #72) — **one composed analyzer**: `wright analyze` + `wright
  lint` evidence (when the pinned released binary is already provisioned in the cache;
  no download) merged with the narrow Agent-local M5 rules that the pinned release has
  no counterpart for (ownership recorded in `tools/lib/analyzer/wright-ownership.js`).
  Findings carry per-finding `backend` provenance (`wright` | `overpy`). The overpy
  oracle compile always runs (it supplies the local rules' compiler evidence), so
  `compile` is populated. When Wright reports a diagnostic on the input, it is recorded
  in `wright.failure` (code, resultClass, diagnostics) — never hidden — and the
  documented local compatibility path still runs; a Wright provisioning/tool failure is
  a structured `WRIGHT_*` failure (exit 3). When Wright is not provisioned, the local
  path runs with an explicit `fallback: { reason: "wright-not-provisioned", from, to }`
  marker. `--rules` selects the local rule subset.
- `wright` — provisions the pinned released Wright binary (`tools/lib/wright/pin.json`, checksum/version-validated; never `main`), runs `wright analyze` + `wright lint`, and maps findings into this same envelope. Output carries `backend: "wright"` and `wright: { version, contract, commands }`; `compile` is `null` (no OverPy compile in this path). `--rules` is rejected (it selects local overpy rules only).
- `overpy` — the legacy compose of `compile_overpy@1` (overpy oracle) with the local source-inspection rules; output carries `backend: "overpy"` and per-finding `backend: "overpy"`.

Finding mapping: Wright rule ids become `wright.<code>`; Wright evidence class (`exact | static-indicator | heuristic | runtime-validated`) maps to `confidence`/`kind`/`heuristic`/`requiresJudgment`; Wright severity `error|warning|info` maps to `error|warning|advisory`; spans become `locations` (file index 0 normalizes to the input basename). See `docs/wright-integration.md`.

Output: exactly one JSON document on stdout:
130→
```json
{
  "tool": "analyze_workshop",
  "contract": "analyze_workshop@1",
  "ok": true,
  "inputFile": "...",
  "root": "...",
  "backend": "auto",
  "ruleCount": 3,
  "localRules": { "count": 4, "ids": ["workshop.lifecycle.chased-variable-in-condition", "..."] },
  "compile": { "ok": true, "nbElements": 28600, "warningCount": 4 },
  "findings": [
    {
      "rule": "workshop.performance.waitless-loop",
      "severity": "error",
      "confidence": "high",
      "kind": "structural",
      "heuristic": false,
      "requiresJudgment": false,
      "reason": "...",
      "locations": [{ "file": "src/a.opy", "line": 12, "col": 5 }],
      "evidence": ["..."],
      "fingerprint": "workshop.performance.waitless-loop:src/a.opy:12",
      "backend": "overpy"
    }
  ]
}
```

Finding contract:

- `rule` — stable identity `workshop.<family>.<rule>` (local) or `wright.<code>` (Wright).
- `severity` — `error` (blocking Workshop risk) | `warning` | `advisory`; independent of confidence.
- `confidence` — `high` | `medium` | `low`.
- `kind` — `compiler` (compiler/parser fact) | `structural` (deterministic source fact) | `heuristic` (risk requiring judgment).
- `heuristic` / `requiresJudgment` — explicit booleans; advisory findings are never presented as facts.
- `locations` — exact source locations (paths relative to `root`) for agent inspection.
- `evidence` — concrete evidence (compiler warning codes/messages, source snippets).
- `fingerprint` — stable dedup identity; the CLI merges findings with the same fingerprint (unioning locations/evidence) and orders deterministically (rule id, then location). Repeated runs produce identical output.
- `backend` — per-finding evidence provenance (`wright` | `overpy`); additive since #72.

Errors (fail closed — never an empty PASS): missing/unknown compiler output → `COMPILER_OUTPUT` (exit 3); project compile failure → `COMPILE_ERROR` (exit 1) with the compiler diagnostics; unparseable source structure → `ANALYSIS_UNSUPPORTED` (exit 1); a rule crash → `ANALYSIS_ERROR` (exit 1); unknown `--rules` id → `UNKNOWN_RULE` (exit 2). Rules register through a small inspectable array in `tools/lib/analyzer/registry.js`; adding a rule never changes this external contract.

Wright backend errors (exit 3 unless noted): provisioning failures use the `WRIGHT_*` codes (`WRIGHT_UNSUPPORTED_PLATFORM`, `WRIGHT_RELEASE_NOT_FOUND`, `WRIGHT_CHECKSUM_MISMATCH`, `WRIGHT_PROVISION_FAILED`, `WRIGHT_VERSION_MISMATCH`, `WRIGHT_NOT_PROVISIONED`); a Wright diagnostic/semantic failure returns `ok: false` with `errors` mapped from Wright diagnostics, each carrying the Wright `code` and a `class` of `unsupported` (source surface outside Wright's support matrix — retry with `--backend overpy`) or `diagnostic` (genuine failure), exit 1.

## Backend and provenance

One shared backend/provenance vocabulary (issue #70, `tools/lib/wright/backend.js`) applies
to every migrated semantic/compiler/analyzer/inspection tool. Output carries `backend`
(the effective backend) and a `provenance` object:

- `requested` — the backend the caller asked for (`wright | overpy | lexical | auto`);
- `effective` — the backend that actually produced the result;
- `wright` — `{ version, contract, commands }` when Wright ran; the release identity is
  the single pinned version (`tools/lib/wright/pin.json`), never `main` or an arbitrary SHA;
- `compat` — `{ name, version }` of the compatibility/oracle that ran when a fallback
  occurred (e.g. `overpy 9.7.10`);
- `fallback` — `{ reason, from, to, ... }` present exactly when a fallback happened;
  reasons are `wright-not-provisioned`, `unsupported-surface`, or `wright-inspect-failed`;
- `resultClass` — `supported-and-valid`, `supported-with-diagnostic`,
  `unsupported-surface`, `wright-infrastructure-failure`, or `explicit-fallback-result`.

Fallback policy (deterministic, never silent):

- Wright-supported valid input → Wright result (`supported-and-valid`).
- Wright-supported invalid input → Wright diagnostic (`supported-with-diagnostic`), exit 1.
  **No success fallback.**
- Declared unsupported Wright surface (manifest in `lib/wright/backend.js`) → explicit
  compatibility fallback may run; the marker includes the Wright diagnostics and version.
- Wright binary/provisioning/tool failure → structured `WRIGHT_*` failure
  (`wright-infrastructure-failure`), exit 3. The only documented operational fallback is
  the `auto` backend's "not provisioned" path; a broken or mismatched cached binary is
  never used silently.
- A fallback that itself fails is an explicit failure with the marker still attached —
  never a silent pass.

Wright diagnostics in `errors[]` carry `code` and `class` (`unsupported` | `diagnostic`).

## Portability boundary

- Tool implementations must not import model, provider, or harness dependencies or branch on caller identity.
- Adding a harness requires only an adapter for CLI or MCP transport; the core implementation and output schemas stay unchanged.
- Verified consumers are direct CLI/contract execution and coding-agent harnesses; contract regressions run in the private upstream source repository and are never published with the distribution.

## Contract history

- **2026-08-15 (#70/#71):** one shared backend/provenance vocabulary is frozen
  (`lib/wright/backend.js`); `compile_overpy@1` becomes Wright-first: additive
  `--backend wright|overpy|auto` (default `auto`), additive `backend`/`provenance`
  fields, explicit OverPy compatibility fallback on declared unsupported surfaces,
  fail-closed Wright diagnostics, structured `WRIGHT_*` environment failures, and an
  explicit `null` for `nbElements` on the Wright backend (v0.1.0 has no element count).
- **2026-08-15 (#73):** `inspect_rule@1` becomes Wright-first for single-file inputs —
  additive `--backend wright|lexical|auto` (default `auto`), Wright-semantic rule
  identity/variables with per-field `evidence`/`source` markers, an additive per-file
  `semantic` block (symbols/references), explicit lexical fallback markers, and
  structured `WRIGHT_*` failures. All existing fields keep their shape.
- **2026-08-15 (#72):** `analyze_workshop@1` becomes a single composed analyzer — the
  default backend is now `auto` (Wright `analyze`+`lint` evidence merged with the
  narrow Agent-local M5 rules; per-finding `backend` provenance; `wright.failure`
  records a Wright diagnostic instead of hiding it; local-rule ownership documented in
  `lib/analyzer/wright-ownership.js`). Additive `provenance`, `localRules`, and
  per-finding `backend` fields; `wright`/`overpy` explicit backends unchanged in shape.
- **2026-08-14 (#68):** `analyze_workshop@1` gains an additive `--backend wright|overpy|auto` option and additive output fields — `backend`, `wright` (provenance when the Wright backend ran), and `fallback` (present exactly when a fallback occurred). `compile` is nullable (`null` on the Wright backend). Wright findings map to the same finding envelope with `wright.<code>` rule ids; Wright diagnostics carry `code` + `class` (`unsupported` | `diagnostic`). The default backend is unchanged (`overpy`), so existing consumers see only additive fields.
- **2026-08-11 (#25 hardening):** removed the redundant search option; rejected unknown options; made the grep fallback and glob mapping explicit; returned `FILE_NOT_FOUND` for missing directories; unified error envelopes with `contract` and `error.code`; guaranteed one JSON document on expected failures; added the Node contract regression suite; preserved the successful-path schema.
