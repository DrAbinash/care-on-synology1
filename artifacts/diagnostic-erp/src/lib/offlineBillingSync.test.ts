import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ERP_SESSION_KEY } from "./staffSession";
import { HttpError, isAuthHttpError } from "./fetchApi";
import {
  shouldCallAuthenticatedSync,
  nextAuthPauseToken,
  syncPollIntervalMs,
  OFFLINE_QUEUE_POLL_MS,
  OFFLINE_QUEUE_IDLE_POLL_MS,
  OFFLINE_QUEUE_AUTH_PAUSE_POLL_MS,
  isStaffSessionStorageKey,
} from "./offlineBillingSync";

function setStaffToken(token: string | null) {
  if (token === null) {
    globalThis.localStorage?.removeItem(ERP_SESSION_KEY);
    return;
  }
  globalThis.localStorage?.setItem(
    ERP_SESSION_KEY,
    JSON.stringify({ token, user: { id: 1, name: "T", email: "t@x", role: "admin", permissions: [] } }),
  );
}

describe("sync auth gate helpers", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => { memory.set(k, v); },
      removeItem: (k: string) => { memory.delete(k); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips authenticated sync when there is no staff token", () => {
    setStaffToken(null);
    expect(shouldCallAuthenticatedSync(null)).toEqual({
      call: false,
      token: null,
      reason: "no_token",
    });
  });

  it("allows sync when a token is present and not paused", () => {
    setStaffToken("tok-a");
    expect(shouldCallAuthenticatedSync(null)).toEqual({
      call: true,
      token: "tok-a",
      reason: "ok",
    });
  });

  it("pauses while the same rejected token is still in session", () => {
    setStaffToken("tok-bad");
    expect(shouldCallAuthenticatedSync("tok-bad")).toEqual({
      call: false,
      token: "tok-bad",
      reason: "paused_same_token",
    });
  });

  it("resumes when the staff token changes after a 401 pause", () => {
    setStaffToken("tok-new");
    expect(shouldCallAuthenticatedSync("tok-bad")).toEqual({
      call: true,
      token: "tok-new",
      reason: "ok",
    });
  });

  it("nextAuthPauseToken only pauses on 401/403 HttpError", () => {
    expect(nextAuthPauseToken(new HttpError("Staff authentication required", 401), "t1")).toBe("t1");
    expect(nextAuthPauseToken(new HttpError("Forbidden", 403), "t1")).toBe("t1");
    expect(nextAuthPauseToken(new Error("NAS unreachable"), "t1")).toBeNull();
    expect(nextAuthPauseToken(new HttpError("Server error", 500), "t1")).toBeNull();
    expect(nextAuthPauseToken(new HttpError("nope", 401), null)).toBeNull();
  });

  it("isAuthHttpError recognises HttpError 401/403", () => {
    expect(isAuthHttpError(new HttpError("x", 401))).toBe(true);
    expect(isAuthHttpError(new HttpError("x", 403))).toBe(true);
    expect(isAuthHttpError(new HttpError("x", 500))).toBe(false);
    expect(isAuthHttpError(new Error("401 Unauthorized"))).toBe(false);
  });

  it("uses a slower poll interval while auth is paused", () => {
    expect(syncPollIntervalMs({ pendingCount: 3, authPaused: true })).toBe(
      OFFLINE_QUEUE_AUTH_PAUSE_POLL_MS,
    );
    expect(syncPollIntervalMs({ pendingCount: 3, authPaused: false })).toBe(OFFLINE_QUEUE_POLL_MS);
    expect(syncPollIntervalMs({ pendingCount: 0, authPaused: false })).toBe(
      OFFLINE_QUEUE_IDLE_POLL_MS,
    );
  });

  it("recognises the staff session storage key", () => {
    expect(isStaffSessionStorageKey(ERP_SESSION_KEY)).toBe(true);
    expect(isStaffSessionStorageKey("other")).toBe(false);
    expect(isStaffSessionStorageKey(null)).toBe(false);
  });
});
