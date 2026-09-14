import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSrc = readFileSync(new URL("./emergencyBilling.ts", import.meta.url), "utf8");
const nasSrc = readFileSync(new URL("../lib/emergencyNasClient.ts", import.meta.url), "utf8");
const winSrc = readFileSync(
  new URL("../../../../deploy/windows-emergency/overlay/artifacts/emergency-billing/src/server.ts", import.meta.url),
  "utf8",
);
const uiSrc = readFileSync(
  new URL("../../../diagnostic-erp/src/components/EmergencyBillingReconciliationTab.tsx", import.meta.url),
  "utf8",
);

describe("emergency admin recovery source contract", () => {
  it("exposes CARE admin void + close-session routes", () => {
    expect(routeSrc).toContain('emergencyBillingRouter.post("/void-pending"');
    expect(routeSrc).toContain('emergencyBillingRouter.post("/close-session"');
    expect(routeSrc).toContain("voidEmergencyBillOnNas");
    expect(routeSrc).toContain("endEmergencySessionOnNas");
  });

  it("CARE NAS client calls DS225+ fetch-token internal endpoints", () => {
    expect(nasSrc).toContain('"/api/internal/void-bill"');
    expect(nasSrc).toContain('"/api/internal/end-session"');
  });

  it("DS225+ overlay accepts remote void + end-session with fetch token", () => {
    expect(winSrc).toContain('app.post("/api/internal/void-bill", requireFetchToken');
    expect(winSrc).toContain('app.post("/api/internal/end-session", requireFetchToken');
    expect(winSrc).toContain("voidedRemotelyFromCare");
    expect(winSrc).toContain("session_end_remote");
  });

  it("Emergency Billing UI exposes admin recovery + void actions", () => {
    expect(uiSrc).toContain('data-testid="emergency-admin-recovery"');
    expect(uiSrc).toContain('data-testid="emergency-close-session"');
    expect(uiSrc).toContain('data-testid="emergency-void-dialog"');
    expect(uiSrc).toContain("/api/emergency-billing/void-pending");
    expect(uiSrc).toContain("/api/emergency-billing/close-session");
  });
});
