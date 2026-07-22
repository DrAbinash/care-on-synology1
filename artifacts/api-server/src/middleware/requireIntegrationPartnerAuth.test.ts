// Integration-partner permission-matrix test. Like requireAiCallerAuth.test.ts,
// this verifies a SOURCE-CODE fact: the set of permissions an inter-org partner
// credential may ever hold is a hardcoded allowlist that no admin/data action
// can widen. @workspace/db is mocked because the middleware imports it at module
// top level and lib/db throws at import without DATABASE_URL.
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: async () => undefined }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  integrationPartnersTable: {},
  integrationPartnerAuditLogTable: {},
}));

import { ALLOWED_INTEGRATION_PERMISSIONS, hashApiKey, generateIntegrationKey } from "./requireIntegrationPartnerAuth.js";

describe("ALLOWED_INTEGRATION_PERMISSIONS (least privilege)", () => {
  it("contains only diagnostic referral/result scopes", () => {
    for (const p of ALLOWED_INTEGRATION_PERMISSIONS) {
      expect(p).toMatch(/^diagnostic_(referral|result):/);
    }
  });
  it("never grants any billing / money / destructive capability", () => {
    for (const p of ALLOWED_INTEGRATION_PERMISSIONS) {
      const l = p.toLowerCase();
      for (const forbidden of ["refund", "bill", "payment", "voucher", "delete", "discount", "accounting"]) {
        expect(l).not.toContain(forbidden);
      }
    }
  });
  it("does not allow reading arbitrary patient or billing data", () => {
    expect(ALLOWED_INTEGRATION_PERMISSIONS.has("patients:read")).toBe(false);
    expect(ALLOWED_INTEGRATION_PERMISSIONS.has("bills:read")).toBe(false);
  });
});

describe("hashApiKey / generateIntegrationKey", () => {
  it("hashing is deterministic and one-way (never echoes the raw key)", () => {
    const key = "intgk_deadbeef";
    const h = hashApiKey(key);
    expect(h).toBe(hashApiKey(key));
    expect(h).not.toContain(key);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
  it("mints prefixed, unique keys", () => {
    const a = generateIntegrationKey();
    const b = generateIntegrationKey();
    expect(a.startsWith("intgk_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
