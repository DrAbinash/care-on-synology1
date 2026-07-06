import { describe, expect, test } from "vitest";
import { shouldForceBootstrapReset } from "./bootstrapAdmin";

// Fix: seedBootstrapAdminIfNeeded() had `const force = true;` hardcoded,
// completely ignoring BOOTSTRAP_ADMIN_FORCE. This meant the bootstrap admin's
// PIN was silently reset to the default on EVERY container restart —
// including routine Synology Container Manager rebuilds — even after the
// doctor had changed it through the UI. shouldForceBootstrapReset is the
// extracted, pure decision logic that replaces the hardcoded value.

describe("shouldForceBootstrapReset", () => {
  test("defaults to false when BOOTSTRAP_ADMIN_FORCE is unset (production-safe default)", () => {
    expect(shouldForceBootstrapReset({})).toBe(false);
  });

  test("returns true when BOOTSTRAP_ADMIN_FORCE=true", () => {
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "true" })).toBe(true);
  });

  test("returns true when BOOTSTRAP_ADMIN_FORCE=1", () => {
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "1" })).toBe(true);
  });

  test("returns false when BOOTSTRAP_ADMIN_FORCE=false", () => {
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "false" })).toBe(false);
  });

  test("returns false for any other/garbage value (fails safe, not open)", () => {
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "yes" })).toBe(false);
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "TRUE" })).toBe(false);
    expect(shouldForceBootstrapReset({ BOOTSTRAP_ADMIN_FORCE: "" })).toBe(false);
  });
});
