import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The frontend "Flag a Critical USG Finding" form claimed "The clinician on
// duty will be notified." but no code path ever notifies anyone: POST /alerts
// never calls a notification function, and the only one that exists
// (notifyEscalation) is an explicit placeholder that just logs — it never
// confirms delivery over any real channel. Worse, POST /alerts/:id/escalate
// unconditionally set escalationSent: true regardless of that, so the DB
// itself recorded a false "notification sent" fact even though the schema
// column (critical_findings_alerts.escalation_sent) defaults to false and
// notifyEscalation() can never flip it.
//
// Source-contract style (no DB): asserts against the handler source region so
// a regression that reintroduces the unconditional `escalationSent: true`
// fails CI, without standing up a DB-mocked integration harness for a single
// boolean.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "usgCriticalAlerts.ts"), "utf8");

/** The body of the POST /alerts/:id/escalate handler, from its declaration to the next route. */
function escalateHandlerRegion(): string {
  const start = src.indexOf('router.post("/alerts/:id/escalate"');
  expect(start, "POST /alerts/:id/escalate handler must exist").toBeGreaterThan(-1);
  // The next route registered after /escalate is the productivity GET.
  const end = src.indexOf('router.get("/productivity"', start);
  expect(end, "productivity route (region boundary) must exist").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("POST /alerts/:id/escalate — escalationSent must never be a false positive", () => {
  const region = escalateHandlerRegion();

  test("escalationSent is set to false, not true, alongside the still-placeholder notifyEscalation() call", () => {
    expect(region).toContain("escalationSent: false");
    expect(region).not.toMatch(/escalationSent:\s*true/);
  });

  test("notifyEscalation is still only a placeholder — this test's premise holds as long as it is", () => {
    // If this ever changes to a real, delivery-confirming implementation,
    // escalationSent should be driven by its actual result instead of a
    // hardcoded false — this assertion is a tripwire for that day, not a
    // permanent requirement.
    const fnStart = src.indexOf("// Placeholder notification hooks");
    expect(fnStart, "notifyEscalation's placeholder comment must exist").toBeGreaterThan(-1);
    const fnEnd = src.indexOf("async function notifyEscalation(");
    expect(fnEnd, "notifyEscalation must exist").toBeGreaterThan(fnStart);
    const fnRegion = src.slice(fnStart, src.indexOf("\n}", fnEnd));
    expect(fnRegion).toContain("Placeholder");
    expect(fnRegion).toContain("no real sending");
  });

  test("the escalation event itself (status + escalatedTo) is still recorded — only the false delivery claim was removed", () => {
    expect(region).toContain('status: "escalated"');
    expect(region).toContain("escalatedTo: b.escalatedTo ?? staffOf(req).subjectName");
  });
});
