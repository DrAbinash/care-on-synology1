import { describe, it, expect } from "vitest";
import {
  maskRecipient, recipientFingerprint, decideObligationsForAmendment,
  deliveryCompletesObligation, canTransitionObligation, OBLIGATION_ACTION_STATUS,
  OPEN_OBLIGATION_STATUSES,
} from "./redeliveryRules";

// Ticket BEND-1 Phase 2 — the D10 re-delivery obligation rules, pure.

describe("recipient privacy", () => {
  it("maskRecipient shows enough to recognize, never the full address", () => {
    expect(maskRecipient("asha.rao@clinic.example")).toBe("a***@clinic.example");
    expect(maskRecipient("+91 98765 43210")).toBe("91********10");
    expect(maskRecipient("public-link")).toBe("public-link");
    expect(maskRecipient(null)).toBeNull();
    expect(maskRecipient("x")).toBe("***");
  });

  it("fingerprint matches across formatting, never across channels", () => {
    expect(recipientFingerprint("whatsapp", "+91 98765-43210")).toBe(recipientFingerprint("whatsapp", "919876543210"));
    expect(recipientFingerprint("email", "A@B.COM")).toBe(recipientFingerprint("email", "a@b.com"));
    expect(recipientFingerprint("whatsapp", "919876543210")).not.toBe(recipientFingerprint("email", "919876543210"));
    // opaque: a fingerprint never contains the recipient
    expect(recipientFingerprint("email", "secret@x.y")).not.toContain("secret");
  });
});

describe("obligation creation (idempotent, deduped)", () => {
  const base = { amendedReportId: 30, sequenceNumber: 3, rootReportId: 10 };

  it("derives one obligation per (channel, recipient) from prior SENT shares", () => {
    const seeds = decideObligationsForAmendment({
      ...base,
      priorSentShares: [
        { id: 1, reportId: 10, channel: "whatsapp", recipient: "+91 98765 43210" },
        { id: 2, reportId: 20, channel: "whatsapp", recipient: "919876543210" }, // same person, later revision → dedup
        { id: 3, reportId: 10, channel: "email", recipient: "a@b.c" },
      ],
    });
    expect(seeds).toHaveLength(2);
    const wa = seeds.find((s) => s.channel === "whatsapp")!;
    expect(wa.reportId).toBe(30);
    expect(wa.sourceShareId).toBe(1); // earliest source kept
    expect(wa.recipientMasked).toBe("91********10");
    expect(wa.recipientMasked).not.toContain("98765"); // masked, never raw
  });

  it("creates no duty for print/pdf/public-link/no-recipient shares or the amended row itself", () => {
    const seeds = decideObligationsForAmendment({
      ...base,
      priorSentShares: [
        { id: 1, reportId: 10, channel: "print", recipient: null },
        { id: 2, reportId: 10, channel: "pdf", recipient: "public-link" },
        { id: 3, reportId: 10, channel: "whatsapp", recipient: null },
        { id: 4, reportId: 30, channel: "whatsapp", recipient: "919876543210" }, // the amended row — not prior
      ],
    });
    expect(seeds).toEqual([]);
  });
});

describe("completion (latest-revision rule)", () => {
  const obligation = {
    status: "pending" as const,
    channel: "whatsapp",
    recipientFingerprint: recipientFingerprint("whatsapp", "919876543210"),
    rootReportId: 10,
  };
  const args = {
    latestReportId: 30,
    deliveredChannel: "whatsapp",
    deliveredFingerprint: recipientFingerprint("whatsapp", "+91 98765 43210"),
    deliveredRootReportId: 10,
    obligation,
  };

  it("delivery of the LATEST revision completes the matching obligation", () => {
    expect(deliveryCompletesObligation({ ...args, deliveredReportId: 30 })).toBe(true);
  });

  it("delivery of an OLD revision never completes the latest obligation", () => {
    expect(deliveryCompletesObligation({ ...args, deliveredReportId: 20 })).toBe(false);
    expect(deliveryCompletesObligation({ ...args, deliveredReportId: 10 })).toBe(false);
  });

  it("channel, recipient and chain must all match; closed obligations stay closed", () => {
    expect(deliveryCompletesObligation({ ...args, deliveredReportId: 30, deliveredChannel: "email" })).toBe(false);
    expect(deliveryCompletesObligation({
      ...args, deliveredReportId: 30,
      deliveredFingerprint: recipientFingerprint("whatsapp", "911111111111"),
    })).toBe(false);
    expect(deliveryCompletesObligation({ ...args, deliveredReportId: 30, deliveredRootReportId: 99 })).toBe(false);
    expect(deliveryCompletesObligation({
      ...args, deliveredReportId: 30,
      obligation: { ...obligation, status: "dismissed" },
    })).toBe(false);
    expect(deliveryCompletesObligation({
      ...args, deliveredReportId: 30,
      obligation: { ...obligation, status: "completed" },
    })).toBe(false);
    // "sent" still completes (the send just happened; completion is the terminal stamp)
    expect(deliveryCompletesObligation({
      ...args, deliveredReportId: 30,
      obligation: { ...obligation, status: "sent" },
    })).toBe(true);
  });
});

describe("manual transitions", () => {
  it("acknowledge/dismiss/queue apply only to open, un-queued states", () => {
    expect(canTransitionObligation("acknowledge", "pending")).toBe(true);
    expect(canTransitionObligation("queue", "acknowledged")).toBe(true);
    expect(canTransitionObligation("queue", "failed")).toBe(true);   // operator retry
    expect(canTransitionObligation("dismiss", "failed")).toBe(true);
    expect(canTransitionObligation("queue", "queued")).toBe(false);  // no double-queue
    expect(canTransitionObligation("dismiss", "completed")).toBe(false);
    expect(canTransitionObligation("acknowledge", "sent")).toBe(false);
    expect(OBLIGATION_ACTION_STATUS.queue).toBe("queued");
  });

  it("open-status set matches the partial-unique-index states", () => {
    expect([...OPEN_OBLIGATION_STATUSES].sort()).toEqual(["acknowledged", "failed", "pending", "queued"]);
  });
});
