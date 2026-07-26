// Webhook signature verification tests. Pure HMAC + no I/O — this class
// touches no DB, so no DATABASE_URL shim is needed (unlike WhatsAppOutbox.test.ts).
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { MetaWhatsAppCloudProvider } from "./MetaWhatsAppCloudProvider";

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("MetaWhatsAppCloudProvider.verifyWebhook", () => {
  const secret = "test-app-secret-value";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [] }] });

  it("accepts a correctly signed body", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const result = await provider.verifyWebhook(body, sign(secret, body), secret);
    expect(result.valid).toBe(true);
  });

  it("rejects when no secret is configured at all (fails closed, not open)", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const result = await provider.verifyWebhook(body, sign(secret, body), undefined);
    expect(result.valid).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const result = await provider.verifyWebhook(body, "", secret);
    expect(result.valid).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const raw = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    const result = await provider.verifyWebhook(body, raw, secret);
    expect(result.valid).toBe(false);
  });

  it("rejects a non-hex payload after the prefix without throwing", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    await expect(provider.verifyWebhook(body, "sha256=not-hex-at-all!!", secret)).resolves.toEqual({ valid: false });
  });

  it("rejects a truncated/wrong-length hex digest without throwing", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    await expect(provider.verifyWebhook(body, "sha256=abcd", secret)).resolves.toEqual({ valid: false });
  });

  it("rejects when the body was tampered with after signing", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const signature = sign(secret, body);
    const result = await provider.verifyWebhook(body + "tampered", signature, secret);
    expect(result.valid).toBe(false);
  });

  it("rejects when signed with the wrong secret", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const result = await provider.verifyWebhook(body, sign("wrong-secret", body), secret);
    expect(result.valid).toBe(false);
  });

  it("is sensitive to single-character tampering (avalanche property, not just presence-of-signature)", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const signature = sign(secret, body);
    const flipped = body.slice(0, -1) + (body.endsWith("}") ? "]" : "}");
    const result = await provider.verifyWebhook(flipped, signature, secret);
    expect(result.valid).toBe(false);
  });

  it("accepts uppercase hex in the signature (case-insensitive hex parsing)", async () => {
    const provider = new MetaWhatsAppCloudProvider();
    const upper = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex").toUpperCase()}`;
    const result = await provider.verifyWebhook(body, upper, secret);
    expect(result.valid).toBe(true);
  });
});
