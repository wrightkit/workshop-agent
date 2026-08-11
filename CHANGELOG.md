# Changelog

## [0.1.3] — 2026-08-12

- Enforced a strict publication policy: `workshop-agent` now ships distributable runtime/knowledge assets only. Fixtures, snapshots, and validation harnesses remain in the private source repository and are never published at any path depth — this supersedes the earlier component-local allowance. The exporter filters them recursively under every allowlisted root, an independent staging gate fails closed if any remain, and public `package.json` metadata no longer advertises commands for unshipped assets.
- The distribution boundary is documented as a permanent publication invariant.

## [0.1.1] — 2026-08-11

- Added valid Agent Skills YAML frontmatter (`name` + activation-oriented `description`) to all five canonical Skills, making them installable via `npx skills add OWBastion/workshop-agent`.
- Reframed the README around the product vision — Workshop-native engineering knowledge for any coding agent — with the open Skills CLI as the primary install path.
- Extended the export conformance suite to validate Skill frontmatter, unique names, and name/directory mapping.

## [0.1.0] — 2026-08-11

First public release of the portable Workshop domain layer.

- **skills/** — canonical Workshop Agent Skills: execution & effect semantics, performance & high-frequency design, state & lifecycle design, bot AI & targeting, code review.
- **tools/** — deterministic portable tools: `compile_overpy` (OverPy compile/validate with structured diagnostics and element counts), `find_symbol` / `find_references` (ripgrep-backed search), `inspect_rule` (rule/event/variable structure), with portable JSON contracts.
- **references/** — redistribution-audited curated index.
- **adapters/** — portable consumer-facing integration notes.
