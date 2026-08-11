---
name: workshop-reference
description: Use when an exact Overwatch Workshop API/reference fact matters and canonical skills or project context are not authoritative — retrieve the specific wiki document (search_workshop_docs / fetch_workshop_doc) and use its source-backed facts, without bulk-fetching or promoting wiki content into skills.
license: AGPL-3.0
---

# Workshop Reference Retrieval Routing

This skill defines **retrieval routing policy**; it does not store wiki content. When an exact Workshop API/reference fact is needed, retrieve it on demand from `md.owbastion.codes` through the deterministic tools (`search_workshop_docs` / `fetch_workshop_doc`, see `tools/CONTRACTS.md`) and record retrieval provenance.

## When to retrieve

- Exact Action / Value / Event semantics or parameters matter;
- API lifecycle / reevaluation behavior is uncertain (for example ongoing effects);
- a Workshop element is unfamiliar or easily confused with another;
- Workshop ↔ OverPy/OSTW terminology needs source-backed resolution (use only deterministic mappings shipped with the tools; never invent aliases);
- behavior is version-sensitive or a known Workshop caveat may matter.

## When not to retrieve

- Canonical engineering knowledge is sufficient (`workshop-execution-semantics`, `workshop-performance`, `workshop-state-lifecycle`, `workshop-bot-ai`, `workshop-code-review`);
- the answer is primarily project-local architecture/gameplay policy;
- deterministic compiler/repository tools already answer the fact (`compile_overpy`, `inspect_rule`, `find_references`);
- retrieval would not materially change the engineering decision.

## Context precedence

```text
project-local instructions/source        > project authority
deterministic compiler/repository facts  > tool evidence
canonical Workshop skills                > domain reasoning
md.owbastion.codes reference facts       > exact API facts (explain APIs; do not override project abstractions/architecture)
unsupported model inference              > last resort
```

Wiki facts explain what Workshop APIs do; they do not override project-local abstractions or architecture.

## Retrieval flow (deterministic and bounded)

1. `search_workshop_docs "<query>"` → ranked candidates (title/slug/category/sourceUrl/markdownUrl/score).
2. Pick the exact slug → `fetch_workshop_doc <slug> [--section <heading>] [--log <file>]` (output is bounded by default; use `--section` to load only the needed block; `--log` records provenance: query/slug/content_hash/chars loaded/cache hit).
3. Implement/review against the document's parameters and semantics; when document facts conflict with project conventions, follow the project and say so.

## Provenance

Record, when retrieval happens: query, selected slug, content hash/revision, characters loaded, cache hit/miss. In M4 task runs, collect `--log <worktree>/retrieval.log` and include it in run evidence.

## Non-goals

- No bulk wiki fetch into context; fetch only the needed document/section;
- no bulk promotion of wiki content into canonical skills;
- no invented OverPy/OSTW aliases (only deterministic tool mappings);
- no vector/embedding retrieval.
