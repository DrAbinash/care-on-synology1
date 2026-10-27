// Outbox request-signing tests (pure HMAC). DATABASE_URL is set to a dummy so
// outbox.ts's module-level lib/db import doesn't throw; signBody itself does no
// I/O.
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_integration";

let signBody: typeof import("./outbox").signBody;
beforeAll(async () => { signBody = (await import("./outbox")).signBody; });

describe("signBody (CARE→HOPE callback signing)", () => {
  const secret = "shared-secret";
  const body = JSON.stringify({ eventType: "diagnostic_report.finalised", data: { referralUuid: "abc" } });

  it("is deterministic for the same secret + timestamp + body", () => {
    expect(signBody(secret, body, "1700000000")).toBe(signBody(secret, body, "1700000000"));
  });
  it("produces a hex SHA-256 HMAC", () => {
    expect(signBody(secret, body, "1700000000")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("binds the timestamp (replay protection): a different timestamp changes the signature", () => {
    expect(signBody(secret, body, "1700000000")).not.toBe(signBody(secret, body, "1700000001"));
  });
  it("depends on the secret: a wrong secret cannot forge the signature", () => {
    expect(signBody(secret, body, "1700000000")).not.toBe(signBody("wrong-secret", body, "1700000000"));
  });
  it("depends on the body: tampering changes the signature", () => {
    expect(signBody(secret, body, "1700000000")).not.toBe(signBody(secret, body + "x", "1700000000"));
  });
});

// ── PR-I4: what a failed delivery says about itself ─────────────────────────
// `fetch` does not report a transport failure. It rejects with a TypeError whose message
// is the constant string "fetch failed" and puts the reason in `err.cause`. Recording only
// `message` wrote "fetch failed" for every unreachable address, which is why the clinic's
// dead CARE→HOPE route could not be told apart from a DNS failure, a firewall drop, or a
// container recreated under a new IP — the four things an operator can actually check.
describe("deliveryErrorReason (why a delivery really failed)", () => {
  let deliveryErrorReason: typeof import("./outbox").deliveryErrorReason;
  beforeAll(async () => { deliveryErrorReason = (await import("./outbox")).deliveryErrorReason; });

  const transportError = () =>
    Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 192.168.64.1:7080"), { code: "ECONNREFUSED" }),
    });

  it("keeps the cause code, which is the only part an operator can act on", () => {
    expect(deliveryErrorReason(transportError())).toContain("ECONNREFUSED");
  });

  it("does not lose the original message either — a bare code is a different lie", () => {
    expect(deliveryErrorReason(transportError())).toContain("fetch failed");
  });

  it("names a DNS failure as a DNS failure, not as a dead host", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND hope.internal"), { code: "ENOTFOUND" }),
    });
    expect(deliveryErrorReason(err)).toContain("ENOTFOUND");
  });

  it("reads a string cause, because undici does not always hand back an Error", () => {
    expect(deliveryErrorReason(Object.assign(new TypeError("fetch failed"), { cause: "socket hang up" }))).toContain("socket hang up");
  });

  it("records an aborted request as the timeout it is", () => {
    const err = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(deliveryErrorReason(err)).toBe("timeout");
  });

  it("tolerates the shapes that are not errors at all", () => {
    expect(deliveryErrorReason(undefined)).toBe("delivery_error");
    expect(deliveryErrorReason("a string")).toBe("a string");
    expect(deliveryErrorReason(new Error("plain"))).toBe("plain");
  });

  it("never repeats the same reason twice when the message already carried the code", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5000"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5000"), { code: "ECONNREFUSED" }),
    });
    const out = deliveryErrorReason(err);
    expect(out.match(/ECONNREFUSED/g)?.length).toBe(1);
  });

  it("stays inside the column it is written to, whatever the cause chain says", () => {
    const long = new Error("x".repeat(900));
    (long as Error & { cause?: unknown }).cause = { code: "EIO", message: "y".repeat(900) };
    expect(deliveryErrorReason(long).length).toBeLessThanOrEqual(300);
  });
});
