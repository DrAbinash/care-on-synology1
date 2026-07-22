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
