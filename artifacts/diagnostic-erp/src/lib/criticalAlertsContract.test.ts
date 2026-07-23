/**
 * criticalAlertsContract.test.ts — PR 3 wiring contracts (source-level, per
 * this repo's node-env convention).
 *
 * The bug class under guard: a UI control calling an endpoint that does not
 * exist (the Ack button 404'd forever; Notify had no handler at all). These
 * contracts pin the UI paths to real server routes and keep the honest-
 * notification and session-identity rules in place.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const REPO = resolve(HERE, "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const page = read(resolve(ERP_SRC, "pages/CriticalAlertsManager.tsx"));
const workflowRoute = read(resolve(REPO, "artifacts/api-server/src/routes/radiologyWorkflow.ts"));
const engine = read(resolve(REPO, "artifacts/api-server/src/lib/criticalFindingsAlert.ts"));

describe("critical-alert UI ↔ server parity (no dead handlers)", () => {
  it("the Ack button's endpoint exists on the server", () => {
    expect(page).toContain("/api/radiology-workflow/critical-alerts/${id}/acknowledge");
    expect(workflowRoute).toContain('router.patch("/critical-alerts/:id/acknowledge"');
  });

  it("Notify has a real action wired to a real endpoint (no button without onClick)", () => {
    expect(page).toContain("/api/radiology-workflow/critical-alerts/${vars.id}/notify");
    expect(workflowRoute).toContain('router.post("/critical-alerts/:id/notify"');
    // The old dead pattern — a Notify button with no onClick — must not return:
    expect(page).not.toMatch(/hover:bg-cyan-500\/10">\s*<Send/);
    expect(page).toContain("setNotifyFor(");
  });

  it("ack failure is surfaced to the user (no silent failures)", () => {
    expect(page).toContain("Acknowledge failed");
  });
});

describe("engine rules", () => {
  it("acknowledge is idempotent (first-ack-wins guard) and identity comes from the session at the routes", () => {
    expect(engine).toContain("isNull(radiologyCriticalFindingsTable.acknowledgedAt)");
    expect(engine).toContain("already_acknowledged");
    expect(workflowRoute).toContain("s.subjectName");
    // The workflow ack route never reads a client-supplied clinician name:
    const ackBlock = workflowRoute.slice(
      workflowRoute.indexOf('router.patch("/critical-alerts/:id/acknowledge"'),
      workflowRoute.indexOf('router.post("/critical-alerts/:id/notify"'),
    );
    expect(ackBlock).not.toContain("clinicianName");
  });

  it("notification is recorded honestly — delivery is never defaulted to true", () => {
    expect(engine).toContain("notificationDelivered: input.delivered ?? null");
    expect(engine).not.toContain("delivered: true");
  });

  it("both actions write to the tamper-evident audit chain", () => {
    expect(workflowRoute).toContain('action: "acknowledge"');
    expect(workflowRoute).toContain('action: "notify"');
    expect(workflowRoute).toContain('entityType: "critical_finding"');
  });
});

describe("documented limitations stay documented", () => {
  it("the store audit doc exists with the five-store inventory", () => {
    const doc = read(resolve(REPO, "docs/CRITICAL_FINDINGS_STORE_AUDIT.md"));
    expect(doc).toContain("radiology_critical_findings");
    expect(doc).toContain("critical_findings_alerts");
    expect(doc).toContain("critical_escalation");
    expect(doc).toContain("fetal_usg_critical_alerts");
    expect(doc).toContain("Notification delivered");
  });
});
