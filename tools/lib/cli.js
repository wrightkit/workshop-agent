"use strict";
/* Shared CLI plumbing for Workshop tools (see tools/CONTRACTS.md).
 * - emit(): synchronous stdout write guarantees exactly one JSON document before
 *   process.exit, so failure paths can never fall through into later operations.
 * - fail(): standardized error envelope { tool, contract, ok:false, error:{code,message,hint?} }.
 * - parseArgs(): rejects unknown --options instead of silently ignoring them. */
const fs = require("fs");

function emit(obj, exitCode = 0) {
  try {
    fs.writeSync(1, JSON.stringify(obj, null, 2) + "\n");
  } catch (e) {
    /* stdout closed; nothing more we can do */
  }
  process.exit(exitCode);
}

function fail(tool, contract, code, message, exitCode = 3, hint) {
  emit({
    tool,
    contract,
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}) },
  }, exitCode);
}

// spec: { [name]: { value: true } | { value: false } } (value = consumes an argument)
function parseArgs(argv, spec) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const def = spec[key];
    if (!def) return { unknown: key };
    if (eq !== -1) {
      options[key] = a.slice(eq + 1);
    } else if (def.value) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) return { unknown: key, missingValue: true };
      options[key] = argv[++i];
    } else {
      options[key] = true;
    }
  }
  return { positional, options };
}

module.exports = { emit, fail, parseArgs };
