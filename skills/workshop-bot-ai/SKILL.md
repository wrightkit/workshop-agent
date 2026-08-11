---
name: workshop-bot-ai
description: Use when designing or reviewing Workshop bot AI and targeting — target acquisition vs consumption, target validity/loss/reacquisition, avoiding duplicated target/range computation, and high-frequency movement/attack decisions.
license: AGPL-3.0
---

# Workshop Bot AI and Targeting

## When to use

Use this skill for Workshop-controlled bots or dummies, target selection, facing/movement/attack decisions, and designs where several AI consumers share target state. It teaches reusable reasoning and does not depend on one downstream project's architecture.

## 1. Separate target acquisition from consumption

Keep "who is the target?" separate from "what should I do with the target?":

- **Acquisition:** one or a small number of rules evaluate candidates and write shared target state. **Consumption:** facing, movement, and hero rules read that state and make decisions.
- A proven Overwatch-AI-PVE pattern has one line-of-sight target rule that refreshes roughly every 0.5 seconds while movement, aim, and hero modules consume the shared target. A hero-specific module may replace acquisition without changing the consumer boundary.
- If a hero ability rule both selects a target and uses it, or several rules overwrite each other's target, first identify the owner of acquisition.

## 2. Centralize shared facts only when it pays

When several consumers need the same target, distance, or nearby-enemy fact and the query is expensive, compute it once and cache it. A single consumer with a cheap condition can calculate locally.

- A proven movement pattern computes a nearby-enemy flag and target distance once and shares them with strafing, jump/crouch, and hero-control rules.
- Repeated per-tick `sorted(getLivingPlayers(...), distance(...))` calculations in several rules are an anti-pattern: they duplicate filtering, sorting, and distance work and can disagree between consumers.
- Centralized state must be refreshed at a controlled cadence and have a clear invalidation boundary. Do not introduce state merely to avoid one cheap calculation; load the optional companion skill `workshop-state-lifecycle` when it is installed.

## 3. Validate, lose, and reacquire targets

Consumers must not assume a stored target remains valid. Before using it, check:

1. `botTarget == null`;
2. `botTarget.isAlive()` and `hasSpawned()`;
3. line of sight such as `isInLoS`;
4. targetability, including `Status.INVINCIBLE` and `Status.PHASED_OUT`;
5. ability immunity windows such as Genji deflect or Doomfist/Orisa block.

When validation fails, clear the target and let the acquisition rule reacquire it on the next scheduled refresh. Do not continue movement or attacks against stale state.

## 4. Separate decisions from persistent commands

`startFacing`, `startThrottleInDirection`, and `chaseAtRate` are persistent commands that continue until replaced or stopped. Refresh target decisions on a throttled loop; keep the persistent command cheap. Use `Wait(..., Wait.ABORT_WHEN_FALSE)` when a condition becoming false must cancel the rule instance.

Target scans are expensive. Put them on a throttled path, and use a smaller event-driven rule for urgent reactions instead of making the main scan run every tick.

## 5. Filter cheaply before expensive work

Use inexpensive radius, hero, team, and ability-state filters before building full candidate arrays or doing line-of-sight and distance sorting:

- First use a nearby-enemy check such as `getPlayersInRadius(..., 22, LosCheck.SURFACES)`. If no candidate is nearby, exit without constructing a full list.
- Then apply hero and ability eligibility filters.
- Only then build and sort the living-player candidates. A score such as `health * distance` can encode low-health and proximity priorities in one sort.

## Reusable principles vs downstream conventions

Names such as `botTarget`, `botTemp`, and `reset_pvar`, and any hero roster, are downstream project conventions. Shared guidance should teach acquisition/consumption separation, validity checks, throttled refresh, cheap filtering, and bounded lifecycle—not copy a project's variable layout.

## Anti-patterns and correct patterns

| Situation | Anti-pattern | Correct pattern |
| --- | --- | --- |
| Several AI rules need the nearest target | Each rule sorts all living players every tick | One throttled acquisition rule writes a shared target; consumers only read it. |
| Target dies | Keep aiming and moving at the old target | Check null/alive/line-of-sight/targetability and clear immediately. |
| No nearby enemy | Build and sort a full candidate list anyway | Perform a cheap radius check and exit early. |
| Persistent facing | Recompute the full target list every tick | Throttle target acquisition and keep the facing command persistent. |
| Ability target eligibility | Filter only after expensive candidate construction | Apply hero and ability-state filters first. |

## Review checklist

1. Is acquisition separate from consumption, with one clear write owner?
2. How many consumers need the same fact? Is caching cheaper than recomputation?
3. Does every consumer validate null, death, line of sight, targetability, and immunity?
4. Is acquisition throttled while persistent commands remain lightweight?
5. Are cheap radius, hero, and ability filters applied before expensive scans and sorting?
6. Who clears target-related state at death, hero swap, round reset, and player leave?
