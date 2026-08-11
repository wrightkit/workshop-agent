# Harness adapters

The Workshop domain layer is intentionally split so harness-specific setup stays thin and never duplicates domain knowledge:

```text
canonical Skills          Workshop reasoning; model/harness-neutral
portable CLI/JSON tools   deterministic facts/evidence; model/harness-neutral
        ↑
small adapter / setup guidance   (this directory)
        ↑
your coding-agent harness
```

The tools are plain Node CLIs that emit **exactly one JSON document on stdout** and use non-zero exit codes for structured errors. Every harness below needs the same two install steps and then just runs the commands.

## Common install steps

```sh
# 1. canonical Skills (Agent Skills CLI)
npx skills add OWBastion/workshop-agent

# 2. deterministic tools package
npm install owbastion-workshop-tools     # project-local
# or: npm install --global owbastion-workshop-tools
```

Seven commands are then available: `compile_overpy`, `find_symbol`, `find_references`, `inspect_rule`, `search_workshop_docs`, `fetch_workshop_doc`, `analyze_workshop`. See the package `CONTRACTS.md` for the `@1` JSON contracts.

## Why three adapters

The three adapters below are materially different integration models, validated by M6:

1. **Agent-Skills CLI flow** — the standard developer path: an agent with shell access gets Skills via the Skills CLI and tools via npm; the agent invokes the commands directly.
2. **Plain shell / Node subprocess** — no agent at all: a script or CI job spawns the binaries and consumes one-JSON stdout + exit codes. Proves the transport is deterministic without any agent glue.
3. **Pi (via opencode-go)** — a controlled reference harness that loads the Skills directory directly (`--skill <dir>`) and calls the tools through its own bash tool; used for reproducible A/B and dogfood runs.

See the individual files for each harness's setup and invocation notes.
