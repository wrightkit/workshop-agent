"use strict";
/* Shared backend/provenance vocabulary for the migrated deterministic tools (#70).
 *
 * One small vocabulary across compile/analyze/inspect so that no tool invents its own
 * backend semantics. It distinguishes at minimum:
 *   - requested backend and effective backend;
 *   - Wright version/release identity;
 *   - the compatibility/oracle identity when a fallback runs;
 *   - whether a fallback occurred and its reason/category;
 *   - result classification: supported-and-valid, supported-with-diagnostic,
 *     unsupported-surface, wright-infrastructure-failure, explicit-fallback-result.
 *
 * All fields are additive to the existing `@1` contracts; nothing here renames or
 * reshapes an existing consumer-visible field.
 *
 * The declared-unsupported manifest below is the machine-readable encoding of the
 * pinned Wright release's OPY compatibility boundary (see
 * docs/wright-integration.md and docs/dogfood/2026-08-15-wright-migration.md). A
 * Wright diagnostic is treated as a *declared unsupported surface* (the only case
 * where an explicit compatibility fallback may run) when it matches the manifest;
 * every other Wright diagnostic is a real semantic/compile failure and must never
 * be converted into fallback success. The manifest is version-keyed to pin.json,
 * evidence-based, and narrow: entries cite the minimized repro and the upstream
 * wrightkit/wright issue that will close the gap. */
const PIN = require("./pin.json");

const RESULT_CLASS = Object.freeze({
  SUPPORTED_VALID: "supported-and-valid",
  SUPPORTED_DIAGNOSTIC: "supported-with-diagnostic",
  UNSUPPORTED_SURFACE: "unsupported-surface",
  INFRA_FAILURE: "wright-infrastructure-failure",
  EXPLICIT_FALLBACK: "explicit-fallback-result",
});

const FALLBACK_REASON = Object.freeze({
  NOT_PROVISIONED: "wright-not-provisioned",
  UNSUPPORTED_SURFACE: "unsupported-surface",
  LEXICAL_PATH: "wright-inspect-failed",
});

// v0.1.0 declared compatibility boundary (evidence-based; see dogfood record).
// `code` may be a string or RegExp; `message` is a RegExp matched against the
// diagnostic message. A diagnostic matches when both match.
const DECLARED_UNSUPPORTED_SURFACE = [
  // unsupported-* diagnostic codes: the support-matrix boundary (unsupported-directive,
  // unsupported-member, unsupported-construct, ...).
  { code: /^unsupported/, message: /.*/, reason: "support-matrix boundary", upstream: "wrightkit/wright#106" },
  // @Hero/@Team <args>/@Slot directives are outside the v0.1.0 directive surface and are
  // reported as parse errors ("unsupported directive '@Hero'"), e.g. the D.Mon
  // identity/ability probes. OverPy accepts them, so the declared surface is explicit.
  { code: "parse-error", message: /unsupported directive '@/, reason: "rule directive outside the supported surface", upstream: "wrightkit/wright#109" },
  // The createWorkshopSetting* builtin surface misparses in v0.1.0 as a settings block
  // ("settings block must be the first construct in the file"); overpy accepts the
  // same input (D.Mon p2e-settings probe). Minimized repro recorded in the dogfood
  // evidence; the semantic manifest (#109) owns the builtin/settings category.
  { code: "settings-placement", message: /settings block must be the first construct/, reason: "createWorkshopSetting* surface misparse", upstream: "wrightkit/wright#109" },
  // Numeric enum members such as `Team.1` / `Hero.1` (very common in real OPY) fail in
  // v0.1.0 as "expected a member name after '.'". OverPy accepts them, so this is a
  // declared surface gap; the fallback is safe because the overpy oracle decides the
  // outcome (a genuine member-access typo still fails, with both diagnostics visible).
  { code: "parse-error", message: /expected a member name after '\.'/, reason: "numeric enum members (Team.1/Hero.1) outside the v0.1.0 surface", upstream: "wrightkit/wright#109" },
  // Enum members outside the pinned reference table fail explicitly
  // (unknown-enum-member), which is the documented support-matrix boundary. Real-world
  // members absent from the table (e.g. newer hero enums) are a coverage gap, not a
  // user error; overpy resolves them, so the declared surface is explicit.
  { code: "unknown-enum-member", message: /.*/, reason: "enum member outside the pinned reference table", upstream: "wrightkit/wright#109" },
];

// Per-diagnostic class for the error envelope: "unsupported" (declared compatibility
// surface) vs "diagnostic" (genuine Wright semantic/compile failure).
function diagClass(code) {
  return /^unsupported/.test(String(code || "")) ? "unsupported" : "diagnostic";
}

// True when a Wright diagnostic is a *declared* unsupported surface (manifest match).
function isDeclaredUnsupported(diag) {
  const code = String((diag && diag.code) || "");
  const message = String((diag && diag.message) || "");
  for (const entry of DECLARED_UNSUPPORTED_SURFACE) {
    const codeMatch = entry.code instanceof RegExp ? entry.code.test(code) : entry.code === code;
    if (codeMatch && entry.message.test(message)) return true;
  }
  return false;
}

// Classify a WrightToolError (or any error with a `.code`) into the shared vocabulary.
// Returns { resultClass, fallbackAllowed, reason, diagnostics }.
//   - WRIGHT_DIAGNOSTIC with every diagnostic declared-unsupported -> unsupported
//     surface (fallback allowed) — but never when the diagnostic list is empty or
//     mixed with a genuine diagnostic, so a real failure can never be masked.
//   - WRIGHT_DIAGNOSTIC otherwise -> supported-with-diagnostic (no fallback).
//   - anything else -> wright-infrastructure-failure (no fallback).
function classifyWrightFailure(err) {
  if (err && err.code === "WRIGHT_DIAGNOSTIC") {
    const diagnostics = (err.details && err.details.diagnostics) || [];
    const allUnsupported = diagnostics.length > 0 && diagnostics.every(isDeclaredUnsupported);
    return {
      resultClass: allUnsupported ? RESULT_CLASS.UNSUPPORTED_SURFACE : RESULT_CLASS.SUPPORTED_DIAGNOSTIC,
      fallbackAllowed: allUnsupported,
      reason: allUnsupported ? FALLBACK_REASON.UNSUPPORTED_SURFACE : null,
      diagnostics,
    };
  }
  return { resultClass: RESULT_CLASS.INFRA_FAILURE, fallbackAllowed: false, reason: null, diagnostics: [] };
}

// Deterministic additive provenance block for tool envelopes.
//   wright  = { version, contract, commands } | null
//   compat  = { name, version } | null          (the oracle used or available)
//   fallback = { reason, from, to, diagnostics? } | null
// Field order is stable; JSON output is deterministic for identical inputs.
function makeProvenance({ requested, effective, wright = null, compat = null, fallback = null, resultClass }) {
  return {
    requested,
    effective,
    wright,
    compat,
    fallback,
    resultClass,
  };
}

module.exports = {
  PIN,
  RESULT_CLASS,
  FALLBACK_REASON,
  DECLARED_UNSUPPORTED_SURFACE,
  diagClass,
  isDeclaredUnsupported,
  classifyWrightFailure,
  makeProvenance,
};
