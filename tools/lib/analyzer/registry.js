"use strict";
/* Analyzer rule registry (analyze_workshop@1).
 *
 * A rule is a small inspectable object:
 *   { id, family, name, description, run(ctx) -> { findings: [...] } }
 * ctx = { source, compile, root } where source is the loadProject() model and compile is
 * the parsed compile_overpy@1 output. Rules are pure: they return findings in the shared
 * envelope and never perform I/O beyond what the CLI already provides. Registration is a
 * plain array (no plugin framework); adding a rule never changes the external contract.
 *
 * Rules register here as they are implemented (#45 chased-variable, #46 loop-safety,
 * #47 invalid Event Player). */
const RULES = [];

function register(rule) {
  if (!rule || typeof rule.id !== "string" || typeof rule.run !== "function") {
    throw new Error(`invalid analyzer rule registration: ${JSON.stringify(rule && rule.id)}`);
  }
  if (RULES.some((r) => r.id === rule.id)) throw new Error(`duplicate analyzer rule id: ${rule.id}`);
  RULES.push(rule);
}

register(require("./rules/chased-variable.js"));
const { waitlessRule, unboundedRule } = require("./rules/loop-safety.js");
register(waitlessRule);
register(unboundedRule);
register(require("./rules/event-player.js"));

function resolveRules(ids) {
  if (!ids) return { rules: RULES };
  const wanted = ids.split(",").map((s) => s.trim()).filter(Boolean);
  const byId = new Map(RULES.map((r) => [r.id, r]));
  const missing = wanted.filter((w) => !byId.has(w));
  if (missing.length) return { error: `unknown rule(s): ${missing.join(", ")}` };
  return { rules: wanted.map((w) => byId.get(w)) };
}

module.exports = { RULES, resolveRules };
