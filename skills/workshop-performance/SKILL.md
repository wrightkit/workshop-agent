---
name: workshop-performance
description: Use when designing or reviewing Workshop performance and high-frequency execution — ongoing and damage hot paths, repeated distance/radius/array queries, element-count vs frequency vs server-load reasoning, throttling, and player/bot scaling.
license: AGPL-3.0
---

# Workshop Performance and High-Frequency Execution

## When to use

Use this skill for `Ongoing - Each Player` / `Ongoing - Global`, `Player Dealt Damage` / `Player Took Damage`, `Loop` / `While` / `For`, `Distance Between`, `Players Within Radius`, `Filtered Array`, `Sorted Array`, `Mapped Array`, target scans, and logic that scales with players or bots. The goal is to estimate per-second cost on a full server rather than label code vaguely as "slow".

First identify the dimensions in section 0. Damage-instance and suspension semantics are also summarized by this skill; when available, load the optional companion skill `workshop-execution-semantics` for deeper coverage.

## 0. Three separate dimensions

Do not collapse these into one imprecise performance score:

- **Element count:** values and actions in one execution, such as loop iterations, array lengths scanned by `Is True For Any`, or elements rebuilt by `Filtered Array`. This is the `n` in an O(n) query.
- **Execution frequency:** executions per second, determined by the event type and `Wait` cadence. A waitless loop spins within one tick; `wait(0.2)` is roughly five executions per second; `Player Took Damage` frequency equals damage-instance frequency.
- **Server load:** the engine's measured load after all rules overlap (0–255), plus the `getAverageServerLoad()` average reading (0–100).

**Decision rules:**

- Estimate total cost as `single-execution elements × executions per second × parallel instances (players + bots)`.
- An expensive operation at low frequency may be safe; a cheap operation at tick frequency can be dangerous when multiplied by player count.
- A performance finding must state all three dimensions instead of saying only "performance is bad".

## 1. Identify hot paths

### 1.1 Observed frequency facts

- Ongoing rule conditions are evaluated on each server tick (approximately 0.016 seconds, or 62.5 ticks per second). Conditions short-circuit in written order.
- A `Loop`, `While`, or rule loop without `Wait` spins within one tick until it overwhelms the server. This is a common crash source.
- `Player Dealt Damage` and `Player Took Damage` fire once per damage instance. SMGs, damage-over-time, and beam weapons can generate many instances, including tick-level beam events.
- When an array variable changes, conditions referencing the variable are rechecked; the engine does not limit the work to the changed element.
- Native `Filtered Array`, `Sorted Array`, and `Mapped Array` operations are generally cheaper than equivalent `For` loops, but remain O(n) or more expensive and rebuild their result on each call.

### 1.2 Decisions

- Start every review by identifying whether the path runs each tick, per event, per button press, or per cast. For damage events, ask how many instances per second are expected.
- Avoid full-player `Distance Between` scans, filtered/sorted arrays, radius queries, target scans, and large array predicates inside tick-level paths. If they are necessary, throttle or sample them as described below.
- Treat arrays in rule conditions as high risk because any array change can re-evaluate the full condition.
- Prefer a hero or slot `Player Filter` over a `Hero Of` condition when it can exclude non-matching players before the rule runs.

## 2. Order conditions by cost and selectivity

- High selectivity means a condition is unlikely to be true (button, alive state, active event, cooldown, or state flag). Low cost means a simple comparison.
- Put expensive calculations such as `Distance Between`, `Is True For Any`, and array queries late, behind selective conditions that can short-circuit them.
- Avoid starting multiple rules with the same expensive condition; each rule recomputes it every tick.
- Selectivity takes priority over raw complexity: placing `Is True For Any(positions, Distance Between(...) <= 2)` before `Is Button Held` scans every player even when nobody is pressing the button.

## 3. Compute one shared fact once

When multiple consumers need the same target set, distance, position, or state:

1. Find duplicate `Players Within Radius`, `Is True For Any`, `Filtered Array`, and sorting operations.
2. If at least two consumers need an expensive, relatively stable fact, compute it once at a low frequency and have consumers read the cached value.
3. Do not cache by default. Recompute when the query is cheap, the fact changes every tick, or the cache lifetime cannot be managed across death, hero swap, leaving, round reset, and waits.
4. Every cache needs an invalidation and cleanup path. A permanent variable introduced to save one query is a worse trade when nobody can clear it.

## 4. Scaling with players and bots

- A full-player query inside every player's ongoing rule is O(n) × n players = O(n²). Bots are part of n.
- Many bots performing the same expensive scan in one tick create a load spike. Peaks can be more dangerous than the same work spread over time.

**Decision rules:**

- Evaluate against the maximum supported player and bot configuration, not a low-player local test.
- Prefer event-driven work (`Player Took Damage` for the affected player), one radius query, or one centralized target set over a full scan for every player.
- Desynchronize expensive initialization and batch work by slot, for example `Wait(Slot Of(Event Player) * 0.016, Ignore Condition)`.

## 5. Throttling, deduplication, and bounded work

The values below are examples derived from real projects, not universal thresholds:

- **Paced wait:** use `Wait` to set the cadence. `wait(0.016)` yields once per tick; `wait(0.2)` is roughly five times per second. Choose the cadence from the semantic requirement.
- **Batch wait:** yield every N iterations of a `For` loop so a large burst spans several ticks.
- **Load-adaptive wait:** `wait(getAverageServerLoad() / 100 * 0.032)` can stretch the cadence. Sampling server load also costs work, so do not put it in a hot path as a universal safety mechanism.
- **Deduplication window:** retain a bounded recent-event-ID array and trim it after appending.
- **Bounded retry:** a waitless sampling/retry loop must have a hard iteration limit and a fallback result.
- **Desynchronization:** spread multi-player initialization and batches by slot or a small random delay.

Choose these mechanisms from the element/frequency/parallelism analysis above. Do not add `Wait` merely because a path "looks expensive".

## 6. Anti-patterns and correct patterns

| Situation | Anti-pattern | Correct pattern |
| --- | --- | --- |
| Beam hero damage rule | Full-player target scan and sorting for every damage event | Throttle the expensive part or move it outside the event; document any changed same-tick semantics. |
| Several rules need nearby targets | Each rule runs its own radius/distance query | Compute once at a manageable cadence and share the result when its lifetime is clear. |
| Membership test on a large array | Put `Is True For Any(bigArray, ...)` in an ongoing condition | Sample on the action side or place it after selective conditions. |
| Looping | `Loop`/`While` with no `Wait` | Yield at least once per tick or use a bounded `For` with batch waits. |
| Repeated settlement | Resample and stack on every high-frequency trigger | Use a bounded recent-ID window or an iteration limit. |
| Startup initialization | Reinitialize every player on the same first tick | Stagger by slot or initialize on spawn/event. |
| Full-player sorting | `Sorted Array(All Players ...)` every tick | Cache a low-frequency result or operate only on the relevant subset. |

## 7. Observed facts vs heuristic risk estimates

**Observed or documented facts:**

- A waitless loop spins within one tick; `Wait` has a minimum interval of 0.016 seconds.
- Ongoing conditions run every tick and short-circuit in order.
- Damage-event frequency equals damage-instance frequency; beam and damage-over-time heroes can trigger at tick frequency.
- `Filtered`/`Sorted`/`Mapped Array` operations are generally cheaper than equivalent manual loops.
- Disabled rules, disabled conditions, and empty rules do not contribute runtime work.
- Practice-range tick rate can differ from a normal map; a practice-range result is not a full-server performance proof.
- A `Player Dealt Damage` rule with a `Wait` can retain only one same-tick context; `Player Took Damage` runs once per victim.

**Heuristic estimates:**

- There is no universal number of conditions, actions, or distance queries that crashes a server. The threshold depends on event type, action complexity, player count, and current server load.
- Whether a path is dangerous is a measurement or static-analysis question. Compile and inspect the project, then state what remains heuristic.
- Load-adaptive wait coefficients and sampling cost require project-specific measurement.

## 8. Review checklist

1. What is the path frequency, and what controls it?
2. How many elements are processed per execution? Is there a full-player O(n) query?
3. What is the cost at maximum players plus bots?
4. Are low-cost, high-selectivity conditions first?
5. Is one expensive fact computed repeatedly? If cached, who invalidates and cleans it?
6. Are loops waited or bounded? Is the semantic effect of throttling explicit?
7. Is multi-player initialization staggered?

## References

- workshop.codes wiki and Markdown mirror: `https://md.owbastion.codes`
- Optional downstream context: use the target repository's server-stability, loop, or performance guidance when it supplies one; those project documents are not required package files.
- Optional companion skills: `ow-workshop-loops` and `ow-workshop-server-stability`, when the target harness provides them.
