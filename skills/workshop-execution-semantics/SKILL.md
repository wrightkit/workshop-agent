---
name: workshop-execution-semantics
description: Use when implementing, explaining, or reviewing Overwatch Workshop execution and effect semantics — event trigger frequency, damage/healing modification vs additional damage instances, reduction/amplification interactions, wait/waitUntil suspension points and stale context, and effect lifetimes.
license: AGPL-3.0
---

# Workshop Execution and Effect Semantics

## When to use

Use this skill for event triggers and frequency, damage or healing creation and modification, `wait`/`waitUntil` suspension points, kill/assist/ultimate state, status effects, and health-pool lifetimes. It answers how code actually executes in the Workshop runtime instead of relying on conventional programming intuition.

## 1. Event execution and trigger frequency

- **Event rules** such as `playerDied`, `playerTookDamage`, `playerDealtDamage`, and button events run once per trigger instance. Frequency comes from the source: `playerTookDamage` fires once per damage instance, and beam or damage-over-time heroes can trigger it every tick.
- **Ongoing rules** such as `eachPlayer` and global ongoing rules behave according to their waits. A `loop`/`while` path without `wait` spins inside one tick and is a common server-crash source; `wait(...)` creates a paced loop.
- Before writing a `took damage` or `dealt damage` rule, ask whether the path is continuous or event-driven and whether one invocation completes. Frequency and element count are separate dimensions; use the optional companion skill `workshop-performance` when it is installed.

## 2. Damage and healing: modification vs additional instances

Workshop has three materially different mechanisms:

| Mechanism | OverPy example | Semantics |
| --- | --- | --- |
| Modify an existing amount | `setDamageDealt(players, pct)`, `setDamageReceived(players, pct)`, `setHealingDealt/Received` | Changes damage or healing passing through the player. It does not create a new damage instance or independently trigger damage events. |
| Create an additional instance | `damage(players, attacker, amount)`, `heal(players, healer, amount)` | Creates a new damage or healing instance with its own events, mitigation/amplification, kill/assist attribution, and cost. |
| Set health directly | `setHealth(players, amount)` | Sets health directly, without damage/healing attribution or statistics. The documented action applies only to living players; use `respawn` for dead players. |

**Decision rules:**

- To make a player's damage dealt or received larger or smaller, use a `setDamageDealt/Received` modifier. To add a separate hit, use `damage()` and accept its separate semantics.
- When creating an additional instance, inspect feedback-loop risk. A `playerTookDamage` rule that calls `damage()` can trigger itself again. The Bastion `share_the_pain` pattern limits the attacker hero and ability and excludes the original player; review equivalent guards in every such path.
- Use `setHealth` when the goal is to adjust health without changing attribution or statistics. It does not create a healing event, so logic depending on healing events will not run.

## 3. Mitigation, amplification, and repeated triggers

- Modifier actions apply to all damage passing through a player, including ability, weapon, and environmental damage. Stacking with game-native mitigation or amplification can be version-sensitive; mark the interaction for verification when the ordering is undocumented.
- An additional instance independently goes through the target's mitigation and amplification. Equal numeric values do not make a modifier and an additional instance equivalent. It is not true damage and not a damage modifier: a `damage()` used for a max-health proc is processed through the target's damage-received chain again, like any other damage.
- When the project's settings document that a hero-specific value (for example a per-hero `damageReceived%`) overrides the general/team value, apply the override rather than assuming the two multipliers compose. Check the project's documented layering semantics before multiplying mitigation values; the answer is often override, not product.
- In repeated-damage scenarios, instance cost and event frequency multiply: ten triggers per second creating five instances each produces fifty damage checks per second.

## 4. `wait`/`waitUntil` and revalidation after suspension

- `wait(seconds)` suspends the current rule instance and resumes it later. `waitUntil(condition, timeout)` resumes when the condition becomes true or the timeout occurs, whichever comes first.
- Context can become stale during a wait: `eventPlayer` can die, change hero, leave the event, or have its state cleared, while another rule can change shared variables. After resuming, revalidate all dependent context, especially event lifetime, `isAlive()`/`hasSpawned()`, and state that another rule may have cleared.
- The real Bastion `heart_of_steel` failure mode used `waitUntil(eventPlayer.isAlive(), 0.5)` even though the configured respawn path can take much longer. A later `Set Health` happened to be a no-op for dead players, but that side effect is not a correctness proof. Fix the wait and revalidate after it.
- A `waitUntil` timeout must cover the longest valid duration of the state being awaited. A shorter timeout is an expected stale-context path, not a reliable safety guard.

## 5. Kills, assists, final blows, and ultimate state

- In `playerDied`, `eventPlayer` is the victim and `attacker` is the killer. `attacker` may be null for environmental or falling deaths; check it before use.
- Damage events provide values such as `eventDamage`, `eventAbility`, critical-hit state, and health-pack origin only while the event is being handled. Do not carry those values across a wait without revalidation.
- An additional `damage()` instance attributes damage to its attacker and can change final-blow, assist, and ultimate-charge results. Use a modifier or `setHealth` when the extra attribution is not intended.
- `isUsingUltimate()` and `ultimateChargePercent()` are native state values. Damage and healing attribution can affect ultimate charge; additional instances and modifiers do so differently.

## 6. Status, effect, and native-action lifetimes

- **Add Health Pool** creates temporary health pools. Each player and pool type (health, armor, or shields) has a maximum of 16 pools, including native and generated pools. Track stacking and use the last-created reference or `removeAllHealthPools()` for cleanup.
- **Set Max Health** applies a percentage of maximum health and clamps current health to the new maximum.
- A status (`hasStatus(Status.X)`) and an effect entity (`createEffect`/`getLastCreatedEntity`) have different lifetimes. Effects can use `EffectReeval` and require explicit cleanup. A centralized cleanup path that destroys effects before marking an event finished is a verified Bastion pattern.
- Damage/healing modifier actions are persistent multipliers until changed or reset. A round-scoped buff must reset the multiplier at the round boundary; it is not equivalent to a one-shot damage instance.

## 7. Handling uncertainty

- For undocumented or version-sensitive behavior such as mitigation ordering, critical-hit interactions, or exact values, state the uncertainty and provide a verification method instead of guessing.
- Prefer traceable sources: workshop.codes and its Markdown mirror, OverPy's built-in action/value definitions, and an optional reference index supplied by the target repository.

## Anti-patterns and correct patterns

| Situation | Anti-pattern | Correct Workshop reasoning |
| --- | --- | --- |
| Double a player's damage | Create half-health extra damage on every hit | Use `setDamageDealt(player, 200)`; if an extra instance is required, account for its events and attribution. |
| Reduce damage in `took damage` | Call `setHealth` or add healing | Use `setDamageReceived` so the incoming instance is modified without a new event. |
| Heal after respawn | `waitUntil(isAlive, 0.5)` and continue unconditionally | Align the timeout with the real respawn path and revalidate `isAlive()` and event state. |
| Temporary round damage buff | Set `setDamageDealt` and forget to reset it | Reset the modifier at the round boundary. |

## Review checklist

1. Is this modifying an existing damage/healing instance or creating a new one? What events, attribution, and feedback loops follow?
2. What is the trigger frequency: every tick, every event, every button press, or every cast?
3. After every `wait`/`waitUntil`, can the event context have changed? Is the timeout long enough?
4. Can `attacker` or another event value be null or invalid?
5. Who cleans up new state or effects? Does the design respect native limits and round/reset boundaries?
