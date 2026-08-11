# Adapter: plain shell / Node subprocess

The agent-free model: a shell script, CI job, or Node process spawns the tools as subprocesses and consumes the structured output. This validates the deterministic transport itself — one-JSON stdout and non-zero exit codes survive without any agent glue.

## Setup

```sh
npm install owbastion-workshop-tools
# binaries land in ./node_modules/.bin/ (or the system PATH for global installs)
```

## Node example (thin, transparent argument forwarding)

```js
const { spawnSync } = require("node:child_process");
function tool(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  const doc = JSON.parse(r.stdout);          // exactly one JSON document
  return { doc, ok: r.status === 0 && doc.ok === true };
}
const compile = tool("compile_overpy", ["src/main.opy", "--root", "src"]);
const analysis = tool("analyze_workshop", ["src/main.opy", "--root", "src"]);
```

## Shell example

```sh
compile_overpy src/main.opy --root src > out.json
test "$(node -p 'require("./out.json").ok')" = "true" || exit 1
```

## Error semantics

Non-zero exit codes are the machine-readable failure signal: assert them instead of parsing stderr. A compile failure exits 1 with `error.code = "COMPILE_ERROR"`; a missing file exits 3 with `FILE_NOT_FOUND`; a usage error exits 2. Never ignore the exit status.

## Materially different from

- **Agent-Skills CLI flow**: no agent decides when to invoke — this is direct programmatic consumption.
- **Pi**: no model in the loop; proves the JSON/exit contract independent of any harness.
