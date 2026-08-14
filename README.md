# Wrightkit Workshop Agent

**Workshop-native engineering knowledge for any coding agent.**

Give Codex, Claude Code, Gemini CLI, OpenCode, Pi, Grok Build, and other Agent Skills–compatible tools reusable expertise in Overwatch Workshop / OverPy semantics, performance, lifecycle, bot AI, and code review — without replacing your agent or requiring a specific model.

```text
Your coding agent
      +
Workshop Agent skills
      +
portable deterministic tools
      =
Workshop-aware engineering workflow
```

## Why Workshop Agent

General coding agents usually lack Workshop-native reasoning. Overwatch Workshop is not conventional programming:

- **Execution semantics differ** — damage modifiers vs additional damage instances behave materially differently, with distinct event triggering, attribution, and feedback-loop consequences.
- **High-frequency rules can hurt servers** — ongoing/damage hot paths and repeated distance/radius/array queries scale badly with players and bots.
- **Waits invalidate state** — `wait`/`waitUntil` suspension points can resume with stale player/event context.
- **Lifecycle and bot targeting need Workshop-specific reasoning** — variable lifetimes, reset/death/hero-swap boundaries, target validity and reacquisition.
- **Validation should be deterministic** — OverPy compilation and structured inspection should replace model guesses where possible.

Workshop Agent supplies that reusable domain layer as portable, model/harness-agnostic Skills plus deterministic tools, so your existing coding agent reasons about Workshop correctly instead of guessing.

## Quick start

Install the Skills with the open [Agent Skills](https://agentskills.io) CLI:

```sh
npx skills add wrightkit/workshop-agent
```

Useful variants:

```sh
# inspect what is available before installing
npx skills add wrightkit/workshop-agent --list

# install for a specific agent
npx skills add wrightkit/workshop-agent -a codex
npx skills add wrightkit/workshop-agent -a claude-code
npx skills add wrightkit/workshop-agent -a gemini-cli
npx skills add wrightkit/workshop-agent -a opencode
npx skills add wrightkit/workshop-agent -a pi
npx skills add wrightkit/workshop-agent -a grok

# global install, where desired
npx skills add wrightkit/workshop-agent -g
```

The Skill content is portable; activation and tool behavior can vary by harness, so don't assume identical behavior across agents.

Manual/offline install (copy the skills and tools into a project without a network or the Skills CLI):

```sh
node scripts/install-skills.mjs <your-workshop-repo> [--tools]
```

## Included capabilities

Six canonical Skills, usable by any Agent Skills–compatible harness:

| Skill | What it gives your agent |
| --- | --- |
| `workshop-execution-semantics` | Event trigger frequency, damage/healing modification vs additional instances, suspension-point and stale-context rules, effect lifetimes |
| `workshop-performance` | Hot-path reasoning, repeated query detection, element-count vs frequency vs server-load, throttling and scaling |
| `workshop-state-lifecycle` | Minimizing variables, binding effect lifetimes to native state, reset/death/hero-swap boundaries, stale-state avoidance |
| `workshop-bot-ai` | Target acquisition vs consumption, target validity/loss/reacquisition, avoiding duplicated target work |
| `workshop-code-review` | A Workshop-specific review pass composing the domain skills, with blocking/non-blocking classification |
| `workshop-reference` | Retrieval routing: when an exact Workshop API/reference fact matters, fetch it from the routed docs (see tools below) instead of guessing |

## Deterministic tools

Skills give your agent the reasoning; the tools give it deterministic facts. Start with Skills alone; add the tools package when you need compile/validation, structured inspection, routed docs, or the analyzer:

```sh
# project-local or global npm install of the tools package
npm install wrightkit-workshop-tools
# or: npm install --global wrightkit-workshop-tools
```

The package exposes seven commands with narrow, portable CLI/JSON contracts (`CONTRACTS.md` inside the package):

| Command | Purpose |
| --- | --- |
| `compile_overpy` | Compile/validate OverPy with structured diagnostics, element counts, variables, subroutines |
| `find_symbol` | Locate symbol/name occurrences with lexical classification |
| `find_references` | Locate textual references and likely declarations |
| `inspect_rule` | Structured rule/event/variable inspection and operation counts |
| `search_workshop_docs` | Deterministic local search over the routed Workshop docs manifest (on demand) |
| `fetch_workshop_doc` | Bounded exact Markdown retrieval with hash/cache awareness, section selection, provenance logging |
| `analyze_workshop` | M5 Workshop domain analyzer: structured findings (compiler / structural / heuristic) |

Every tool emits exactly one JSON document on stdout with a stable contract identity (`compile_overpy@1`, `analyze_workshop@1`, ...), and uses non-zero exit codes for structured errors — a harness can rely on that instead of scraping text.

### Semantic backends and provenance

Wright (`wrightkit/wright`) is the primary semantic/compiler/analyzer/inspection backend for the supported OPY surface:

- `compile_overpy`, `inspect_rule`, and `analyze_workshop` default to the pinned released Wright binary (`auto` backend) when it is available, and keep **OverPy only as an explicit compatibility fallback/oracle** where Wright's declared surface does not cover the input (for example `#!extension`, `@Hero` directives, settings builtins, or numeric enum members such as `Team.1`).
- Fast lexical search (`find_symbol` / `find_references`) stays on ripgrep/grep, and Workshop documentation retrieval (`search_workshop_docs` / `fetch_workshop_doc`) stays on the routed `md.owbastion.codes` manifest — these are intentional ownership boundaries.
- Every migrated tool output carries `backend` (the effective backend) and a `provenance` block: `requested`, `effective`, `wright` (pinned version/contract), `compat` (overpy version when a fallback ran), `fallback` (reason/from/to — present exactly when a fallback happened), and `resultClass` (`supported-and-valid`, `supported-with-diagnostic`, `unsupported-surface`, `wright-infrastructure-failure`, `explicit-fallback-result`). `analyze_workshop` findings additionally carry per-finding `backend` provenance.
- **Never silent:** a genuine Wright diagnostic is returned as a diagnostic (exit 1) and is never converted into a successful OverPy result; a Wright provisioning/tool failure is a structured `WRIGHT_*` error (exit 3). Only a *declared unsupported surface* (or the documented `auto` not-provisioned path) triggers an explicit fallback, and the marker is always present.

The pinned Wright release is provisioned automatically from the `wrightkit/wright` GitHub Release contract: checksum-verified, version-pinned, cached under `~/.cache/wrightkit-wright/<version>/<target>/` (override with `WRIGHT_CACHE_DIR`). Supported platforms: macOS (arm64/x64), Linux (x64), Windows (x64). No Rust toolchain or source checkout is required; the first explicit `--backend wright` run downloads the binary, while the default `auto` backend uses a cached binary and never forces a download.

### The engineering loop

For a Workshop engineering task, prefer deterministic evidence over model inference in this order:

```text
inspect / search          find_symbol / find_references / inspect_rule
        ↓
analyze when relevant     analyze_workshop
        ↓
inspect finding evidence  open the finding's locations and verify against source
        ↓
edit
        ↓
compile                   compile_overpy
        ↓
re-run analyzer / review  analyze_workshop / workshop-code-review
```

Analyzer findings are **evidence, not instructions**:

- `kind: compiler` and `kind: structural` findings with `heuristic: false` are deterministic facts — a blocking finding (e.g. `workshop.performance.waitless-loop`) should be treated as a real risk until project context proves otherwise;
- `kind: heuristic` findings with `heuristic: true` / `requiresJudgment: true` (e.g. `workshop.performance.unbounded-loop`) are advisories requiring judgment;
- always open the finding's `locations` and verify against the source before acting.

Project-local instructions remain authoritative for project-specific architecture and design decisions; the tools supply Workshop risk facts, not project policy. When you need an exact Workshop API/reference fact, route it through `search_workshop_docs` / `fetch_workshop_doc` rather than recalling from memory.

The tools are **optional**: every canonical Skill remains useful for Workshop reasoning without them. When the tools are installed, use and recommend them; when they are absent, continue with the Skill's reasoning and say what a deterministic check would confirm.

## Compatibility

Works with Agent Skills–compatible harnesses including Codex, Claude Code, Gemini CLI, OpenCode, Pi, and Grok Build. The domain content is model/provider-neutral; no skill requires a specific harness or model.

## Development and contributions

`workshop-agent` is the public distribution repository. Canonical release assets are produced through an internal release process; public GitHub Issues and PRs are welcome for bug reports, compatibility reports, documentation fixes, and improvements. Please keep changes focused; validation runs in the private source repository.

## License

See `LICENSE`. The canonical domain skills/tools are authored by the Wrightkit project; external reference material is cited, not included.
