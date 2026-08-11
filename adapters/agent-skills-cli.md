# Adapter: Agent-Skills CLI flow

The standard developer path: any coding agent with shell access installs the Skills with the Agent Skills CLI and the tools from npm, then invokes the commands directly. No wrapper, no per-agent config.

## Setup

```sh
# Skills (one command)
npx skills add OWBastion/workshop-agent

# Deterministic tools (project-local or global)
npm install owbastion-workshop-tools
```

## Invocation

The agent uses its normal shell/bash tool to run the installed commands and reads the single JSON document on stdout:

```sh
compile_overpy src/main.opy --root src          # { "contract": "compile_overpy@1", "ok": true, ... }
analyze_workshop src/main.opy --root src        # { "contract": "analyze_workshop@1", "findings": [...] }
search_workshop_docs "Start Damage Over Time"   # { "contract": "search_workshop_docs@1", "candidates": [...] }
```

For project-local installs, binaries are on the PATH inside the project (e.g. `./node_modules/.bin/compile_overpy`); for global installs they are on the system PATH. If the tools are not installed, the Skills still provide Workshop reasoning — say what a deterministic run would confirm instead of inventing tool output.

## Error semantics

Every tool exits non-zero with a structured `{ "ok": false, "error": { code, message } }` document on failure (usage, missing file, compile error, environment). Do not flatten a non-zero exit into a false success — surface the structured error.

## Materially different from

- **shell/Node subprocess**: this model goes through an agent that decides when to invoke; the subprocess model is agent-free script/CI consumption.
- **Pi**: Pi loads the Skills directory directly (`--skill`) with a controlled non-interactive profile; the Skills-CLI model uses the Skills CLI's installation layout and any harness.
