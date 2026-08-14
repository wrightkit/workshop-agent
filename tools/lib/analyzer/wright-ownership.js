"use strict";
/* V1 ownership audit for the published M5 analyzer rules (issue #72).
 *
 * Every published rule has a documented V1 owner. For the pinned Wright release
 * (v0.1.0, pin.json), all four M5 rules remain Agent-local because Wright v0.1.0 has
 * no counterpart mechanism:
 *
 *   workshop.performance.waitless-loop        — no Wright no-yield loop rule in v0.1.0.
 *     Wright's `min-wait-loop` is a different mechanism (a loop that DOES wait, but at
 *     the Workshop minimum rate). The no-yield loop rule (`while-without-wait`) exists
 *     upstream (wrightkit/wright#103, closed in main) but is not in any released
 *     binary yet; when a release includes it, its `statically-bounded`/`obviously-
 *     unbounded` evidence is narrower than the Agent rule's full control-flow walk.
 *   workshop.performance.unbounded-loop      — same gap; no Wright counterpart in v0.1.0.
 *   workshop.lifecycle.chased-variable-in-condition — consumes OverPy warning codes
 *     (w_ow2_rule_condition_chase); no Wright counterpart in v0.1.0.
 *   workshop.context.invalid-event-player    — consumes OverPy warning codes
 *     (w_mismatched_subroutine_event) plus the Agent source model; no Wright
 *     counterpart in v0.1.0.
 *
 * `supersededBy` maps a local rule id to the Wright rule id that will own the same
 * mechanism once a release provides it. It is empty for v0.1.0; when a future pinned
 * release ships a superseding rule, the mapping is updated and the local duplicate is
 * retired (the compose path automatically skips superseded local rules).
 *
 * This module is data only — the composition logic lives in analyze_workshop@1. */
const SUPERSEDED_BY = {
  "workshop.performance.waitless-loop": null, // upstream wrightkit/wright#103 (unreleased)
  "workshop.performance.unbounded-loop": null,
  "workshop.lifecycle.chased-variable-in-condition": null,
  "workshop.context.invalid-event-player": null,
};

const LOCAL_RULE_IDS = Object.keys(SUPERSEDED_BY);

// The Wright rule id that owns a local rule's mechanism, or null when the local rule
// remains Agent-local for the pinned release.
function wrightSupersedes(localRuleId) {
  return SUPERSEDED_BY[localRuleId] || null;
}

// Local rules that should still run for the pinned release (nothing is superseded in
// v0.1.0; the filter exists so future pins can retire duplicates in one place).
function effectiveLocalRules(ruleIds) {
  return ruleIds.filter((id) => !wrightSupersedes(id));
}

module.exports = { SUPERSEDED_BY, LOCAL_RULE_IDS, wrightSupersedes, effectiveLocalRules };
