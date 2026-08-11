# OWBastion Workshop Agent

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
npx skills add OWBastion/workshop-agent
```

Useful variants:

```sh
# inspect what is available before installing
npx skills add OWBastion/workshop-agent --list

# install for a specific agent
npx skills add OWBastion/workshop-agent -a codex
npx skills add OWBastion/workshop-agent -a claude-code
npx skills add OWBastion/workshop-agent -a gemini-cli
npx skills add OWBastion/workshop-agent -a opencode
npx skills add OWBastion/workshop-agent -a pi
npx skills add OWBastion/workshop-agent -a grok

# global install, where desired
npx skills add OWBastion/workshop-agent -g
```

The Skill content is portable; activation and tool behavior can vary by harness, so don't assume identical behavior across agents.

Manual/offline install (copy the skills and tools into a project without a network or the Skills CLI):

```sh
node scripts/install-skills.mjs <your-workshop-repo> [--tools]
```

## Included capabilities

Five canonical Skills, usable by any Agent Skills–compatible harness:

| Skill | What it gives your agent |
| --- | --- |
| `workshop-execution-semantics` | Event trigger frequency, damage/healing modification vs additional instances, suspension-point and stale-context rules, effect lifetimes |
| `workshop-performance` | Hot-path reasoning, repeated query detection, element-count vs frequency vs server-load, throttling and scaling |
| `workshop-state-lifecycle` | Minimizing variables, binding effect lifetimes to native state, reset/death/hero-swap boundaries, stale-state avoidance |
| `workshop-bot-ai` | Target acquisition vs consumption, target validity/loss/reacquisition, avoiding duplicated target work |
| `workshop-code-review` | A Workshop-specific review pass composing the domain skills, with blocking/non-blocking classification |

## Deterministic tools

Skills give your agent the reasoning; the tools give it deterministic facts. Start with Skills alone; add tools when you need compile/validation and structured inspection:

- `compile_overpy` — compile/validate OverPy source with structured diagnostics and element counts;
- `find_symbol` / `find_references` — locate definitions and uses;
- `inspect_rule` — structured rule/event/variable inspection and operation counts.

All tools expose narrow, portable CLI/JSON contracts (`tools/CONTRACTS.md`) consumable from any harness or a plain shell:

```sh
cd tools && npm install
```

## Compatibility

Works with Agent Skills–compatible harnesses including Codex, Claude Code, Gemini CLI, OpenCode, Pi, and Grok Build. The domain content is model/provider-neutral; no skill requires a specific harness or model.

## Development and contributions

`workshop-agent` is the public distribution repository. Canonical release assets are produced through an internal release process; public GitHub Issues and PRs are welcome for bug reports, compatibility reports, documentation fixes, and improvements. Please keep changes focused; validation runs in the private source repository.

## License

See `LICENSE`. The canonical domain skills/tools are authored by the OWBastion project; external reference material is cited, not included.
