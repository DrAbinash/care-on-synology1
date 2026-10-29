import { beforeEach, describe, expect, it, vi } from "vitest";

// The challenge store is the only thing tying a browser's signature to a request this
// server actually asked for, and three doors now share it: staff sign-in, key
// registration and Super Admin key sign-in. Each hands out a session with it, so a
// challenge must be spendable at exactly one of them.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({
  webauthnCredentialsTable: {},
  usersTable: {},
  portalSessionsTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: () => null, and: () => null, gt: () => null }));

describe("the webauthn challenge store is per-door", () => {
  let storeChallenge: typeof import("./webauthnService")["storeChallenge"];
  let consumeChallenge: typeof import("./webauthnService")["consumeChallenge"];

  beforeEach(async () => {
    vi.resetModules();
    ({ storeChallenge, consumeChallenge } = await import("./webauthnService"));
  });

  it("refuses a Super Admin challenge presented at the staff login", async () => {
    storeChallenge("c-sa", 1, "super_admin_login");
    expect(consumeChallenge("c-sa", "staff_login")).toBeNull();
  });

  it("refuses a staff challenge presented at the Super Admin login", async () => {
    storeChallenge("c-staff", undefined, "staff_login");
    expect(consumeChallenge("c-staff", "super_admin_login")).toBeNull();
  });

  it("refuses a registration challenge presented at either login", async () => {
    storeChallenge("c-reg", 1, "register");
    expect(consumeChallenge("c-reg", "staff_login")).toBeNull();
    expect(consumeChallenge("c-reg", "super_admin_login")).toBeNull();
  });

  it("does not burn a challenge that came to the wrong door", async () => {
    // A stray request must not be able to end somebody's in-flight sign-in: the
    // refusal leaves it live for the door that asked for it.
    storeChallenge("c-sa", 1, "super_admin_login");
    expect(consumeChallenge("c-sa", "staff_login")).toBeNull();
    expect(consumeChallenge("c-sa", "super_admin_login")).toEqual({ userId: 1 });
  });

  it("spends a challenge once at its own door", async () => {
    storeChallenge("c-sa", 1, "super_admin_login");
    expect(consumeChallenge("c-sa", "super_admin_login")).toEqual({ userId: 1 });
    expect(consumeChallenge("c-sa", "super_admin_login")).toBeNull();
  });

  it("treats a challenge stored without a purpose as the staff door's", async () => {
    // The two existing callers do not name a purpose; if that default drifted, a
    // registration challenge would start being spendable as a login.
    storeChallenge("c-old", 4);
    expect(consumeChallenge("c-old")).toEqual({ userId: 4 });
    storeChallenge("c-old2", 4);
    expect(consumeChallenge("c-old2", "super_admin_login")).toBeNull();
  });

  it("still refuses a challenge that has outlived its window", async () => {
    vi.useFakeTimers();
    try {
      storeChallenge("c-early", 1, "super_admin_login");
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(consumeChallenge("c-early", "super_admin_login")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
