// AI Caller permission-matrix automated test.
// Per IMPLEMENTATION_CHECKLIST.md Gate 1: "AI-caller permission-matrix
// automated test exists, runs in CI, and confirms zero refund, delete,
// or radiologist-share-link permissions." This is that test.
//
// Per the design note in requireAiCallerAuth.ts: ALLOWED_AI_CALLER_PERMISSIONS
// is a hardcoded TypeScript constant, not a database row — so this test
// is verifying a source-code fact, not a runtime/database state. That is
// deliberate: the whole point of the design is that this permission set
// cannot be widened by any admin action, only by a code change that
// would have to pass this test, or be an explicit, reviewed edit to it.

import { describe, it, expect, vi } from "vitest";

// requireAiCallerAuth.ts imports `db` from @workspace/db at module top
// level for its database-touching functions (requireAiCallerAuth
// itself, the audit-log writer). None of the tests below exercise those
// — only the pure functions (ALLOWED_AI_CALLER_PERMISSIONS, hashApiKey,
// generateApiKey) — but @workspace/db throws unconditionally at import
// time if DATABASE_URL is unset (see lib/db/src/index.ts), which would
// otherwise make this whole test file unrunnable outside an environment
// with a live database. Mocked here the same way providers.test.ts
// mocks its own DB-touching dependency, so this file tests what it
// actually needs to test without requiring database provisioning.
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: async () => undefined }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

import { ALLOWED_AI_CALLER_PERMISSIONS } from "./requireAiCallerAuth.js";

describe("ALLOWED_AI_CALLER_PERMISSIONS", () => {
  it("never contains any refund permission", () => {
    for (const perm of ALLOWED_AI_CALLER_PERMISSIONS) {
      expect(perm.toLowerCase()).not.toContain("refund");
    }
  });

  it("never contains any delete permission", () => {
    for (const perm of ALLOWED_AI_CALLER_PERMISSIONS) {
      expect(perm.toLowerCase()).not.toContain("delete");
    }
  });

  it("never contains a radiologist-audience report-share permission", () => {
    for (const perm of ALLOWED_AI_CALLER_PERMISSIONS) {
      const lower = perm.toLowerCase();
      const isRadiologistShare = lower.includes("radiologist") && lower.includes("share");
      expect(isRadiologistShare).toBe(false);
    }
  });

  it("never contains a patient edit or write permission beyond register/identify/lookup", () => {
    // Per the implementation blueprint: no patient:edit beyond what
    // register/identify requires. Today's allowlist has no patient
    // permissions at all, only knowledge_base ones, so this test passes
    // trivially now and is written to fail loudly the moment a future
    // edit adds a patient:edit permission without also updating this
    // test to confirm it is properly scoped.
    const patientEditPerms = Array.from(ALLOWED_AI_CALLER_PERMISSIONS).filter(
      (p) => p.startsWith("patient:") && p !== "patient:register" && p !== "patient:identify" && p !== "patient:lookup",
    );
    expect(patientEditPerms).toEqual([]);
  });

  it("contains only permissions in an explicit, reviewed allowlist shape (category:action)", () => {
    // Defends against a future addition like a bare "admin" or "*"
    // permission string slipping in — every entry must be a specific
    // category:action pair, never a wildcard or an unscoped grant.
    for (const perm of ALLOWED_AI_CALLER_PERMISSIONS) {
      expect(perm).toMatch(/^[a-z_]+:[a-z_]+$/);
      expect(perm).not.toContain("*");
    }
  });

  it("is genuinely non-empty (the mechanism is wired to something real)", () => {
    // A test confirming "no dangerous permissions" would pass trivially
    // on an empty set — this guards against that degenerate case,
    // confirming the allowlist actually grants something real (today:
    // the Knowledge Base search/read permissions the external ai_caller
    // route in aiCallerKnowledgeBase.ts actually requires).
    expect(ALLOWED_AI_CALLER_PERMISSIONS.size).toBeGreaterThan(0);
  });
});

describe("hashApiKey / generateApiKey", () => {
  it("generateApiKey produces a key with the expected prefix and sufficient entropy", async () => {
    const { generateApiKey } = await import("./requireAiCallerAuth.js");
    const key = generateApiKey();
    expect(key).toMatch(/^aic_[0-9a-f]{64}$/);
  });

  it("generateApiKey never produces the same key twice across many calls", async () => {
    const { generateApiKey } = await import("./requireAiCallerAuth.js");
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
  });

  it("hashApiKey is deterministic (same input always hashes the same)", async () => {
    const { hashApiKey } = await import("./requireAiCallerAuth.js");
    const key = "aic_test_key_for_determinism_check";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("hashApiKey never returns the original key (it is genuinely one-way, not pass-through)", async () => {
    const { hashApiKey } = await import("./requireAiCallerAuth.js");
    const key = "aic_test_key_should_not_appear_in_hash";
    expect(hashApiKey(key)).not.toBe(key);
    expect(hashApiKey(key)).not.toContain(key);
  });

  it("hashApiKey output is a 64-character hex string (SHA-256)", async () => {
    const { hashApiKey } = await import("./requireAiCallerAuth.js");
    expect(hashApiKey("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
