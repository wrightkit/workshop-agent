# tools — Deterministic Workshop tools

M2 introduced these deterministic capabilities for any agent harness or model provider. Each tool is a plain Node CLI with JSON input/output and no model or provider coupling. See `CONTRACTS.md` for the schemas.

## Tools

| Contract | Command | Purpose |
| --- | --- | --- |
| `compile_overpy@1` | `bin/compile_overpy.js` | Compile and validate OverPy with structured diagnostics, element counts, variables, and subroutines |
| `find_symbol@1` | `bin/find_symbol.js` | Locate symbol/name occurrences with lexical classification |
| `find_references@1` | `bin/find_references.js` | Locate textual references and likely declarations |
| `inspect_rule@1` | `bin/inspect_rule.js` | Inspect rules, events, variables, and operation counts with explicit heuristic evidence |
| `search_workshop_docs@1` | `bin/search_workshop_docs.js` | Deterministic local search over the md.owbastion.codes document manifest (on demand) |
| `fetch_workshop_doc@1` | `bin/fetch_workshop_doc.js` | Bounded exact Markdown retrieval with ETag/hash caching, section selection, and provenance logging |
| `analyze_workshop@1` | `bin/analyze_workshop.js` | M5 Workshop domain analyzer: structured findings (compiler/structural/heuristic) from `compile_overpy@1` + source inspection rules |

## Install

```sh
cd tools
npm install
```

Node >= 20 is required. OverPy is resolved from this tool's `node_modules`, then from an ancestor or target project. Missing dependencies produce the explicit `OVERPY_NOT_FOUND` error. The tools are verified against their contracts in the private upstream source repository; that verification is not shipped with the distribution.

## Examples

```sh
# Compile a project entry point (JSON output)
node tools/bin/compile_overpy.js src/main.opy

# Find a symbol (case-sensitive by default; falls back from rg to grep)
node tools/bin/find_symbol.js eventEffect --dir src

# Inspect rules in a file or directory
node tools/bin/inspect_rule.js src/events
```

Exit codes are `0` for success (including no matches), `1` for compile/validation failure, `2` for usage or backend errors, and `3` for environment errors. Every path emits exactly one JSON document.

## Consumption paths

- **Agent harness:** any shell-capable agent can call `node tools/bin/<tool>.js ...`; prompt-level loading points to this directory, but the tools do not depend on a harness.
- **Direct contract execution:** CLI consumers and the private validation suite exercise the same implementation and output schemas.
- **Future MCP:** an adapter may expose the same contracts without changing the tool core.

## Boundary

This layer reports deterministic facts: compile status, symbol/reference locations, and lexical rule/operation structure. Semantic judgments such as performance danger and lifecycle correctness remain in the domain skills. Heuristic outputs explicitly say `heuristic` or `confidence: "textual"` and must not be presented as compiler or runtime proof.

Generated artifacts such as `node_modules` and compiler output stay out of version control.
