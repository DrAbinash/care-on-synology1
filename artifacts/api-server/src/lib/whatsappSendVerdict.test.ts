/**
 * §3 — a WhatsApp send is reported as what actually happened to it.
 *
 * THE DEFECT, IN THE SCREEN'S OWN WORDS
 *   `sendWhatsAppNow()` answers `ok: true` from four different places, and only
 *   one of them means Meta took the message:
 *
 *     WhatsAppOutbox.ts  `{ ok: true, skipped: true }`            shadow mode — never sent
 *     WhatsAppOutbox.ts  `{ ok: true, outboxId }`                 no settings row / lost the claim /
 *                                                                quiet-hours defer / lost ownership —
 *                                                                the message is QUEUED, not sent
 *     WhatsAppOutbox.ts  `{ ok: true, outboxId, messageId }`      provider returned a wamid
 *     WhatsAppOutbox.ts  `{ ok: false, error }`                  the attempt failed
 *
 *   Every consumer tested `ok`. So `/api/report-delivery-tracking/send` wrote
 *   `send.ok ? "sent" : "failed"` into `report_delivery_receipts` AND into
 *   `report_shares`, the tracking screen counted a queue INSERT under "Sent", a
 *   queued reminder repaired a failed receipt into "sent", and the auto-on-verify
 *   path flipped `patient_reports.status` to **"delivered"** — a report marked as
 *   having reached the patient because a row was inserted into our own table.
 *
 * THE RULE THESE TESTS PIN
 *   The evidence decides the word: no provider message id, no "sent". "Queued" is
 *   a real state and is shown as one; `delivered`/`read` are only ever written by
 *   the Meta webhook, which matches on the provider message id.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The classifier is pure, but it lives beside the receipt writers, and that module
// imports `@workspace/db`, which throws at import time without DATABASE_URL. Mock
// it the way `reportDeliveryReceipts.test.ts` does so this file runs anywhere.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({ reportDeliveryReceiptsTable: {} }));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { whatsappSendVerdict } from "./reportDeliveryReceipts";

describe("whatsappSendVerdict — the evidence, not the flag", () => {
  it("a provider message id is the only thing that makes a send", () => {
    expect(whatsappSendVerdict({ ok: true, messageId: "wamid.ABC123" })).toBe("sent");
  });

  it("ok without a message id is queued, never sent", () => {
    // The three queue-shaped returns: no settings row, lost the claim (a worker or
    // a quiet-hours defer owns the row now), and lost ownership mid-flight.
    expect(whatsappSendVerdict({ ok: true })).toBe("queued");
    expect(whatsappSendVerdict({ ok: true, messageId: undefined })).toBe("queued");
    expect(whatsappSendVerdict({ ok: true, messageId: null })).toBe("queued");
    expect(whatsappSendVerdict({ ok: true, messageId: "   " })).toBe("queued");
  });

  it("a suppressed send is failed, not queued, because it will never be sent", () => {
    // `skipped` is shadow mode: the row was written and suppressed, and no worker
    // will ever dispatch it. Calling that "queued" would promise a delivery that
    // the flag explicitly forbids.
    expect(whatsappSendVerdict({ ok: true, skipped: true })).toBe("failed");
    expect(whatsappSendVerdict({ ok: true, skipped: true, messageId: "wamid.STALE" })).toBe("failed");
  });

  it("a refused or errored send is failed", () => {
    expect(whatsappSendVerdict({ ok: false, error: "Invalid recipient" })).toBe("failed");
    expect(whatsappSendVerdict({})).toBe("failed");
    // …even if a caller somehow carries an id alongside a failure.
    expect(whatsappSendVerdict({ ok: false, messageId: "wamid.X" })).toBe("failed");
  });

  it("never produces delivered or read", () => {
    // Those two belong to the webhook alone (`applyReportDeliveryReceiptStatuses`),
    // which is the only thing here that hears from the recipient's device.
    const words = [
      { ok: true, messageId: "wamid.A" },
      { ok: true },
      { ok: true, skipped: true },
      { ok: false },
    ].map(whatsappSendVerdict);
    expect(words).toEqual(["sent", "queued", "failed", "failed"]);
    expect(words).not.toContain("delivered");
    expect(words).not.toContain("read");
  });
});

describe("the routes use the verdict rather than `ok`", () => {
  const read = (p: string) =>
    readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("the tracking send route classifies before it records", () => {
    const route = read("../routes/reportDeliveryTracking.ts");
    expect(route).toContain("const verdict = whatsappSendVerdict(send);");
    expect(route).toContain("status: verdict,");
    expect(route, "no receipt may be written from the bare flag")
      .not.toMatch(/status:\s*send\.ok\s*\?\s*"sent"/);
    expect(route).toContain("ok: verdict === \"sent\"");
    expect(route).toContain("const queued = results.filter((r) => r.status === \"queued\").length;");
  });

  it("a suppressed send goes through the verdict and the receipt like any other", () => {
    // The browser measured this: WhatsApp was disabled, one report was ticked, and
    // the screen answered "Report delivery: 0 sent — All confirmed by WhatsApp"
    // with an empty tracking table. `send.skipped` used to `continue` past the
    // verdict, past `recordReceipt`, and past all three counts, so a batch in which
    // nothing was sent summed to 0/0/0 — indistinguishable from a clean run.
    const route = read("../routes/reportDeliveryTracking.ts");
    expect(route, "the early `continue` on skipped is what hid the failure")
      .not.toMatch(/if \(send\.skipped\)\s*\{\s*results\.push/);
    expect(route).toContain('const failureReason = send.skipped ? "WhatsApp sending is disabled/suppressed"');
    const at = route.indexOf("const failureReason =");
    const block = route.slice(at, route.indexOf("const sent =", at));
    expect(route).toContain("lastError: verdict === \"failed\" ? failureReason : null");
    expect(block).toContain("errorMessage: verdict === \"failed\" ? failureReason : null");
    expect(block).toContain("reason: verdict === \"failed\" ? failureReason : undefined");
    expect(route.indexOf("const verdict = whatsappSendVerdict(send);"))
      .toBeLessThan(route.indexOf("await recordReceipt({"));
    // And the pre-send refusals are counted, so no row can fall out of the totals.
    expect(route).toContain('results.filter((r) => r.status === "skipped")');
    expect(route).toContain("res.json({ sent, queued, failed, skipped, total: results.length, results });");
  });

  it("a queued reminder repairs a failed receipt to queued, not to sent", () => {
    const route = read("../routes/reportDeliveryTracking.ts");
    expect(route).toContain("repairFailedReceiptAfterRemind(id.data, verdict)");
    expect(route, "the old test was `if (send.ok)`")
      .not.toContain("if (send.ok) {\n    await repairFailedReceiptAfterRemind");
    const lib = read("./reportDeliveryReceipts.ts");
    expect(lib).toContain("to: WhatsAppSendVerdict = \"sent\"");
    expect(lib).toContain("if (to === \"failed\") return;");
    expect(lib).toContain(".set({ status: to, failedAt: null, lastError: null })");
  });

  it("the auto-on-verify path stops calling a queue insertion a delivery", () => {
    const routes = read("../routes/patient-reports.ts");
    expect(routes).toContain("const verdict = whatsappSendVerdict(result);");
    // `patient_reports.status = "delivered"` is the claim §3 is about, and it now
    // requires the provider's own message id.
    const at = routes.indexOf("const verdict = whatsappSendVerdict(result);");
    expect(at).toBeGreaterThan(-1);
    const block = routes.slice(at, at + 1400);
    expect(block).toContain("status: verdict,");
    expect(block).toContain('if (verdict === "sent") {');
    expect(block).toContain('set({ status: "delivered", deliveredAt: new Date() })');
    expect(block.indexOf('if (verdict === "sent") {'))
      .toBeLessThan(block.indexOf('set({ status: "delivered", deliveredAt: new Date() })'));
    expect(routes, "the flag-only test is gone from this file")
      .not.toContain("const actuallySent = result.ok && !result.skipped;");
  });

  it("the staff share route gates the delivered flip and the re-delivery obligation", () => {
    const routes = read("../routes/patient-reports.ts");
    // The second send site is the one a staff member presses; anchor on its own
    // guard rather than on the first `whatsappSendVerdict`, which is auto-on-verify.
    const at = routes.lastIndexOf('const verdict = whatsappSendVerdict(result);');
    expect(at, "the share route must classify before it records the share").toBeGreaterThan(-1);
    const block = routes.slice(at, routes.indexOf("const [share] = await db.insert(reportSharesTable)", at));
    expect(block).toContain('if (verdict !== "sent") {');
    expect(block).toContain("status = verdict;");
    // Both consequences below it still key off "sent", so a queued share
    // completes no BEND-1 re-delivery obligation and marks nothing delivered.
    const after = routes.slice(at);
    expect(after).toContain('if (status === "sent") await markDeliveredIfVerified(id);');
    expect(after).toContain('if (status === "sent") {\n    await completeObligationsForDelivery');
  });

  it("answers the desk with the status, and does not call a queued send an error", () => {
    // The old response said `ok: status === "sent"`, so a message the outbox had
    // accepted but WhatsApp had not confirmed came back as a failure — the share
    // dialog threw, and the desk re-sent a report that was already on its way.
    // `ok` now means "not a failure"; `status` carries the truth, and `error` is
    // only populated when it actually failed.
    const routes = read("../routes/patient-reports.ts");
    expect(routes).toContain('res.json({ ok: status !== "failed", status, share, error: status === "failed" ? errorMessage : null, reportUrl });');
  });
});
