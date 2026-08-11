---
name: workshop-state-lifecycle
description: Use when deciding whether and how to add Workshop variables/effects — reuse native game state, bind temporary effect lifetimes to enclosing state, handle death/reset/hero-swap boundaries, and avoid stale state and post-wait context bugs.
license: AGPL-3.0
---

# Workshop State and Lifecycle Design

## When to use

Use this skill when deciding whether to add or keep a variable, timer, layer, stack, counter, flag, or cleanup rule; when creating or destroying effects; when handling death, hero swaps, rounds, resets, joins, and leaves; and when reviewing stale or duplicated state.

The goal is not to minimize variables. The goal is to decide correctly whether state exists, how long it survives, where it resets, and how lifecycle bugs are detected.

## Core rules

### Rule 1: derive from existing state before adding a variable

Decide from cheap/native sources to explicit state:

1. **Native game state:** `Is Alive`, `Has Spawned`, `Is Holding Button`, `Is Using Ultimate`, `Is In Alternate Form`, hero, team, distance, nearby players, and ultimate charge. The engine maintains these across ticks without custom initialization or cleanup.
2. **Event parameters and existing project state:** the current event context, existing variables, or a combination that already expresses the fact.
3. **Explicit state:** add it only when native state and event context cannot represent information that must survive across events, preserve history, or pass a value between ticks.

The reverse case matters too: if deriving a fact requires an expensive per-tick distance/LOS/array query while one write can cache it safely, explicit state may be the correct choice. This is a cost and lifecycle trade-off, not a ban on variables.

### Rule 2: every explicit state has three responsibilities

Every variable needs matching handling at:

- **Initialization:** join/spawn or the first-use default;
- **Modification:** every write path;
- **Cleanup:** the reset boundary for its legal lifetime.

Adding one variable means maintaining all three locations. Initialization plus modification without cleanup creates stale state.

### Rule 3: choose the lifetime before choosing the storage

Workshop variables have no built-in lifetime. They do not clear automatically on death or round end. Decide whether the state is event-scoped, death-scoped, round-scoped, or persistent, then place it at the matching reset boundary:

- event state belongs to the event cleanup path and its end sentinel;
- state that survives death or a round must not be cleared by event cleanup;
- persistent progress resets only at the project's explicit reset or hero-swap boundary.

Relevant boundaries include `Player Died`, `Player Joined`, `Player Left Match`, round transitions, `Player Changed Hero`, the project's reset path, and `Restart Match`. Do not mix event, progress, and saved state in one reset function.

### Rule 4: bind temporary effects to an existing lifetime

`Create Effect` creates a free object that must be destroyed or given a valid duration. Prefer the enclosing lifecycle:

- gate the effect with an event sentinel such as `eventId != -1`;
- use a centralized cleanup path rather than one timer and cleanup rule per effect;
- bind a placeholder wait to the enclosing sentinel instead of creating a second timer variable.

When a design adds a timer solely to clean up an effect, first check whether the effect can follow the existing event or native-state lifetime.

### Rule 5: treat pre-wait context as invalid after a suspension

During `Wait` or `Wait Until`, event context, targets, attackers, and project state can change. Prefer, in order:

1. bind cancellation to the condition with `Wait(time, Abort When False)`;
2. perform context-dependent actions before the wait;
3. explicitly revalidate state after the wait.

`Wait Until(condition, timeout)` must have a timeout at least as long as the longest valid duration of the awaited state. A shorter timeout resumes with stale context even if a later action happens to be harmless.

### Rule 6: keep history bounded

Arrays, histories, and counters need a bound. Trim after appending and cap retries or counts. An unbounded event or deduplication history is a state leak.

### Rule 7: separate reusable mechanisms from local conventions

Reusable mechanisms include lifecycle end sentinels, ID-aligned parallel arrays, centralized cleanup, and condition-bound countdowns. Sentinel values, variable names, event IDs, array layouts, and project constants belong to the downstream repository and must not be presented as universal rules.

## Anti-patterns

1. **Stale post-wait context:** a timeout shorter than the real event lifetime followed by actions that depend on the old context.
2. **Duplicate state:** two variables represent one fact but only one cleanup path is updated.
3. **Missing boundary:** an effect or buff survives death, round, or hero swap when it should not, or a progress value is cleared by event cleanup.
4. **State created only for cleanup:** a timer and guard duplicate an existing lifecycle.
5. **Unbounded history:** a deduplication or event array grows for the entire match.
6. **Configuration drift:** code behavior changes but project settings and documentation are not updated.

## When explicit state is correct

Explicit state is required when information cannot be derived from native state in one tick and must cross an event boundary: a forced next-event value, an event handoff slot, a bounded recent-event window, or progress that survives death and round transitions. Initialize it at join, keep its lifetime outside event cleanup, and reset it at the correct project boundary.

## When state is redundant

Do not store a respawn timer when `Wait Until(Is Alive, ...)` expresses the native state; do not duplicate an effect-lifetime boolean when an event sentinel already gates it; do not keep a display counter when array length or an existing bounded count provides the same value at an acceptable cost.

## Lifecycle checklist

1. Can native state or event context express the fact at an acceptable cost?
2. What is the legal lifetime and reset boundary?
3. Are initialization, modification, and cleanup all covered?
4. Can death, hero swap, event cleanup, or reset remove too much or too little?
5. After a wait, are context and state revalidated? Is the timeout long enough?
6. Are arrays, histories, and retries bounded?
7. Can concurrent rules perform a non-atomic read-modify-write?
8. Is cleanup bound to an existing lifecycle rather than a new timer?
9. Does a behavior change require project settings or documentation to be synchronized?

## References

- Workshop variables: `https://workshop.codes/wiki/articles/variables-and-how-to-use-them`
- `Wait` and `Wait Until`: `https://workshop.codes/wiki/articles/wait` and `https://workshop.codes/wiki/articles/wait-until`
- Optional downstream context: use the target repository's loop, server-stability, event-allocation, cleanup, effect, and player-state documentation when it supplies one; those project documents are not required package files.
