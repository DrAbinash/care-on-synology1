import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Escalation must never claim delivery unless notifyEscalation reports sent:true.
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "usgCriticalAlerts.ts"), "utf8");

function escalateHandlerRegion(): string {
  const start = src.indexOf('router.post("/alerts/:id/escalate"');
  expect(start, "POST /alerts/:id/escalate handler must exist").toBeGreaterThan(-1);
  const end = src.indexOf('router.get("/productivity"', start);
  expect(end, "productivity route (region boundary) must exist").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("POST /alerts/:id/escalate — escalationSent must never be a false positive", () => {
  const region = escalateHandlerRegion();

  test("escalationSent is driven by notify.sent, never hardcoded true", () => {
    expect(region).toContain("escalationSent: notify.sent");
    expect(region).not.toMatch(/escalationSent:\s*true/);
  });

  test("notifyEscalation returns a delivery result object", () => {
    expect(src).toContain("Promise<{ sent: boolean; detail: string }>");
    expect(src).toContain("getTransporter");
  });

  test("the escalation event itself (status + escalatedTo) is still recorded", () => {
    expect(region).toContain('status: "escalated"');
    expect(region).toContain("escalatedTo");
  });
});
