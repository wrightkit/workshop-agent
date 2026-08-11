# references — Reference index

This layer stores authoritative or curated material that supports the domain skills. Prefer traceable sources; do not turn undocumented assumptions into rules. Large references stay external and are loaded selectively.

## 1. Workshop runtime semantics

- Workshop.codes wiki: `https://workshop.codes/wiki`
- Agent-friendly Markdown mirror: `https://md.owbastion.codes`, with the article index at `https://md.owbastion.codes/wiki/articles.md`
- Offline copies with the same upstream source live in the public `OWBastion/Bastion` repository:
  - `docs/improve-server-stability.md`
  - `docs/Loops.md`
- High-value topics include `Wait`, `Wait Until`, `Loop`, `While`, `For`, variables, server stability, and loop design.

## 2. OverPy language and compiler facts

- Official compiler repository: `zezombye/overpy` and the `overpy` npm package.
  - `README.md` contains the language overview and function syntax reference.
  - `src/data/actions.ts`, `values.ts`, and `constants.ts` define built-in signatures and semantics.
  - `examples/` contains complete examples; `docs/` describes compiler internals.
- Bastion keeps a full OverPy README copy at `OWBastion/Bastion/docs/overpy.md`.
- Compile with `npx overpy --help`, the relevant downstream build command, or this repository's `tools/bin/compile_overpy.js`.
- Macro and JavaScript preprocessing are compiler behavior. When uncertain, read the compiler source or run a compile check.

## 3. OSTW

- Official repository: `OverTS/Overwatch-Script-To-Workshop`.
- Load OSTW references only for tasks that actually involve OSTW/TypeScript; do not duplicate OverPy-first guidance for it.

## 4. Verified real implementations

- **Bastion:** event allocation, deduplication windows, load-aware waits, bounded retries, effect lifetime sentinels, and centralized cleanup under its event system.
- **Overwatch-AI-PVE:** separated target acquisition and consumption, validity checks, throttled refresh, and filter-before-sort targeting.
- These mechanisms can be generalized, but downstream constants, variable names, and architecture remain local conventions.

## 5. Verification protocol

- For uncertain compiler facts, inspect OverPy definitions and README first, then compile; do not write guesses into a skill.
- For uncertain runtime semantics, inspect the corresponding Workshop wiki article and mark unresolved behavior as requiring reference verification.
- For undocumented or version-sensitive behavior, state the uncertainty and give a reproducible verification method.
