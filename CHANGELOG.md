# Changelog

## [0.1.4] — 2026-08-15

- **Wright-first deterministic tooling (pre-V1 ownership migration).** The pinned
  released Wright binary (`wrightkit/wright` v0.1.0, `wright-result/v1`, checksum- and
  version-validated, cached under `~/.cache/wrightkit-wright/`) is now the primary
  semantic/compiler/analyzer/inspection backend for the supported OPY surface:
  - `compile_overpy` defaults to `auto` — `wright compile` (+ `wright inspect` for
    variable/subroutine identity) with an explicit OverPy compatibility fallback on
    declared unsupported surfaces; genuine Wright diagnostics fail closed and are never
    converted into fallback success.
  - `analyze_workshop` defaults to `auto` — one composed analyzer: Wright
    `analyze`+`lint` evidence merged with the narrow Agent-local M5 rules the pinned
    release has no counterpart for; findings carry per-finding backend provenance.
  - `inspect_rule` defaults to `auto` — Wright semantic inspection of rule identity and
    variables for single-file inputs, with textual metrics explicitly lexical.
  - `find_symbol`/`find_references` remain fast lexical search (ripgrep/grep), and
    `search_workshop_docs`/`fetch_workshop_doc` remain the routed reference-retrieval
    layer — intentional ownership boundaries.
  - Every migrated tool output carries `backend` and a `provenance` block
    (`requested`/`effective`/`wright`/`compat`/`fallback`/`resultClass`); fallback is
    never silent and Wright provisioning/tool failures stay structured `WRIGHT_*` errors.
- No Rust toolchain or source checkout is required; the first explicit `--backend
  wright` run provisions the pinned binary, while `auto` uses the cache and never forces
  a download.

## [0.1.3] — 2026-08-12

- Enforced a strict publication policy: `workshop-agent` now ships distributable runtime/knowledge assets only. Fixtures, snapshots, and validation harnesses remain in the private source repository and are never published at any path depth — this supersedes the earlier component-local allowance. The exporter filters them recursively under every allowlisted root, an independent staging gate fails closed if any remain, and public `package.json` metadata no longer advertises commands for unshipped assets.
- The distribution boundary is documented as a permanent publication invariant.

## [0.1.1] — 2026-08-11

- Added valid Agent Skills YAML frontmatter (`name` + activation-oriented `description`) to all five canonical Skills, making them installable via `npx skills add wrightkit/workshop-agent`.
- Reframed the README around the product vision — Workshop-native engineering knowledge for any coding agent — with the open Skills CLI as the primary install path.
- Extended the export conformance suite to validate Skill frontmatter, unique names, and name/directory mapping.

## [0.1.0] — 2026-08-11

First public release of the portable Workshop domain layer.

- **skills/** — canonical Workshop Agent Skills: execution & effect semantics, performance & high-frequency design, state & lifecycle design, bot AI & targeting, code review.
- **tools/** — deterministic portable tools: `compile_overpy` (OverPy compile/validate with structured diagnostics and element counts), `find_symbol` / `find_references` (ripgrep-backed search), `inspect_rule` (rule/event/variable structure), with portable JSON contracts.
- **references/** — redistribution-audited curated index.
- **adapters/** — portable consumer-facing integration notes.
