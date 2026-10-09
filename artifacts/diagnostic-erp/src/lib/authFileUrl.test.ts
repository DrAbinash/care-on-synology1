import { beforeEach, describe, expect, it } from "vitest";
import { withStaffToken } from "./authFileUrl";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });
});

describe("withStaffToken", () => {
  it("appends the session token so an <img> can load a guarded clinical file", () => {
    store.set("erp_session", JSON.stringify({ token: "abc.jwt" }));
    expect(withStaffToken("/uploads/radiology-key-images/uuid-1.jpg")).toBe(
      "/uploads/radiology-key-images/uuid-1.jpg?staffToken=abc.jwt",
    );
  });

  it("preserves an existing query string instead of overwriting it", () => {
    store.set("erp_session", JSON.stringify({ token: "abc.jwt" }));
    expect(withStaffToken("/uploads/radiology-key-images/uuid-1.jpg?v=2")).toBe(
      "/uploads/radiology-key-images/uuid-1.jpg?v=2&staffToken=abc.jwt",
    );
  });

  it("is idempotent — a re-wrapped prop cannot produce two tokens", () => {
    store.set("erp_session", JSON.stringify({ token: "abc.jwt" }));
    const once = withStaffToken("/uploads/radiology-key-images/uuid-1.jpg");
    expect(withStaffToken(once)).toBe(once);
  });

  it("leaves the path alone when nobody is signed in", () => {
    expect(withStaffToken("/uploads/radiology-key-images/uuid-1.jpg")).toBe(
      "/uploads/radiology-key-images/uuid-1.jpg",
    );
  });

  it("returns empty for empty, and URL-encodes the token", () => {
    expect(withStaffToken(null)).toBe("");
    expect(withStaffToken("   ")).toBe("");
    store.set("erp_session", JSON.stringify({ token: "a b/c" }));
    expect(withStaffToken("/uploads/x.jpg")).toBe("/uploads/x.jpg?staffToken=a%20b%2Fc");
  });
});
