# Adapter: Pi (controlled reference harness, via opencode-go)

Pi is the controlled reference harness used for reproducible A/B and dogfood runs. It loads the canonical Skills directory directly and calls the deterministic tools through its own bash tool.

## Setup

Install the Skills to a directory and the tools package so `compile_overpy` etc. are on the PATH of the session:

```sh
npx skills add OWBastion/workshop-agent          # installs the six skills
npm install owbastion-workshop-tools             # tools on PATH
```

Point Pi at the installed Skills directory (never at a private source):

```sh
pi --print \
  --no-session --no-context-files --no-extensions --no-prompt-templates \
  --skill <path-to-installed-skills> \
  --system-prompt "You are a Workshop engineering assistant. Read project instructions, inspect code, run the installed workshop tools (compile_overpy, find_symbol, inspect_rule, analyze_workshop, search_workshop_docs, fetch_workshop_doc) to get deterministic facts, edit files, and verify by compiling. Make minimal, focused changes." \
  --provider opencode-go --model deepseek-v4-flash
```

## Invocation notes

- The model reads the one-JSON stdout of each tool and uses the `contract` identity + `ok` flag rather than prose.
- Non-zero exits are real failures — the model must surface the structured error, not invent a pass.
- `analyze_workshop` findings are evidence: deterministic findings may block, heuristic advisories require judgment (see `workshop-code-review`).
- Keep the profile flags identical across comparison arms; the only intended variation is the domain/Skill dimension under test.

## Materially different from

- **Agent-Skills CLI flow**: Pi loads skills via `--skill <dir>` with a pinned non-interactive profile rather than the Skills CLI layout; used for controlled runs.
- **shell/Node subprocess**: Pi has a model in the loop deciding when to invoke tools; the subprocess model is model-free.
