import { describe, expect, it } from "vitest";
import {
  whatsappShareGate,
  WHATSAPP_SHARE_DELIVERABLE_STATUSES,
} from "./whatsappShareGate";

describe("whatsappShareGate (delivery-leg decision, mirrors the server's /share + /verify gates)", () => {
  it("treats exactly the server's deliverable statuses as deliverable", () => {
    expect([...WHATSAPP_SHARE_DELIVERABLE_STATUSES]).toEqual(
      expect.arrayContaining(["pending_verification", "verified", "delivered"]),
    );
    for (const s of WHATSAPP_SHARE_DELIVERABLE_STATUSES) {
      expect(whatsappShareGate(s, false).isDeliverable).toBe(true);
    }
  });

  it("is case-insensitive and trims", () => {
    expect(whatsappShareGate(" VERIFIED ", false).isDeliverable).toBe(true);
  });

  it("a DRAFT report is blocked with the finalize-first explanation, and never offers verify-then-send (#1168)", () => {
    // The server's /verify answers 409 "Sign the report first" for a draft, so
    // offering Verify & Send would be a click the server is guaranteed to
    // refuse. Before this pass a draft showed NO explanation at all — just a
    // silently disabled Send button.
    const withoutVerify = whatsappShareGate("draft", false);
    expect(withoutVerify.isDeliverable).toBe(false);
    expect(withoutVerify.needsVerify).toBe(true);
    expect(withoutVerify.offerVerifyThenSend).toBe(false);
    expect(withoutVerify.blockedMessage).toMatch(/Finalize first/i);

    const withVerifyRights = whatsappShareGate("draft", true);
    expect(withVerifyRights.offerVerifyThenSend).toBe(false);
    expect(withVerifyRights.blockedMessage).toMatch(/Finalize first/i);
  });

  it("an unknown non-draft status can offer verify-then-send when the caller may verify", () => {
    const gate = whatsappShareGate("something-else", true);
    expect(gate.isDeliverable).toBe(false);
    expect(gate.needsVerify).toBe(true);
    expect(gate.offerVerifyThenSend).toBe(true);
    expect(gate.blockedMessage).toMatch(/countersign/i);
  });

  it("an unknown non-draft status without verify rights still explains itself", () => {
    const gate = whatsappShareGate("something-else", false);
    expect(gate.offerVerifyThenSend).toBe(false);
    expect(gate.blockedMessage).toMatch(/Finalize first/i);
  });

  it("makes no claim before the report has loaded", () => {
    const unloaded = whatsappShareGate(null, true, false);
    expect(unloaded.isDeliverable).toBe(false);
    expect(unloaded.needsVerify).toBe(false);
    expect(unloaded.offerVerifyThenSend).toBe(false);
    expect(unloaded.blockedMessage).toBeNull();

    // A non-null row with a blank status is equally not an answer yet.
    const blank = whatsappShareGate("", true, true);
    expect(blank.needsVerify).toBe(false);
    expect(blank.blockedMessage).toBeNull();
  });
});
