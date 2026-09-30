// Planted FALSE POSITIVE: SQLi-shaped code in a test file with hardcoded,
// non-attacker-controlled input. A good triage should call this a false positive.
const assert = require("node:assert");

function buildTestQuery() {
  const fixtureId = "42"; // constant test fixture, never user input
  return "SELECT * FROM users WHERE id = " + fixtureId;
}

assert.strictEqual(
  buildTestQuery(),
  "SELECT * FROM users WHERE id = 42",
);
