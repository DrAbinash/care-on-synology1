/**
 * §3 — the tracking screen may only say "All confirmed by WhatsApp" when WhatsApp
 * confirmed all of them.
 *
 * MEASURED IN THE BROWSER (journey 15, rig at 155073b0 + this fix): WhatsApp was
 * disabled on the rig, one verified report was ticked, Send was pressed, and the
 * toast read "Report delivery: 0 sent — All confirmed by WhatsApp" while the
 * tracking table stayed empty. The route's `skipped` branch had bypassed the send
 * verdict, the receipt and all three counts, so a batch that messaged nobody
 * summed to 0/0/0; the description then fell through to the sentence reserved for
 * a fully confirmed batch.
 *
 * The rule pinned here is about the screen, not the route: every count the route
 * returns is named in the toast, and the confirmation sentence requires that the
 * whole batch was confirmed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  new URL("../pages/ReportDeliveryTracking.tsx", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("the delivery toast cannot confirm a send nobody confirmed", () => {
  it("names the suppressed/failed attempts instead of dropping them", () => {
    expect(src).toContain("if (r.failed) parts.push(`${r.failed} failed`);");
    expect(src).toContain("if (skipped) parts.push(`${skipped} not attempted`);");
    expect(src).toContain("if (queued) parts.push(`${queued} queued`);");
  });

  it("reserves 'All confirmed by WhatsApp' for a batch that was wholly confirmed", () => {
    const at = src.indexOf("const allConfirmed =");
    expect(at, "the confirmation is a computed condition, not a fall-through").toBeGreaterThan(-1);
    const cond = src.slice(at, src.indexOf(";", at));
    expect(cond).toContain("r.sent === (r.total ?? 0)");
    expect(cond).toContain("queued === 0");
    expect(cond).toContain("r.failed === 0");
    expect(cond).toContain("skipped === 0");
    // The sentence must sit under that condition only — the old shape was
    // `description: queued ? … : r.failed ? undefined : "All confirmed by WhatsApp"`,
    // which reached it whenever nothing else was counted.
    const toastAt = src.indexOf("description: allConfirmed");
    expect(toastAt).toBeGreaterThan(at);
    expect(src, "no branch may reach the sentence without the condition")
      .not.toMatch(/:\s*(r\.failed|queued)[^\n]*\n?[^\n]*"All confirmed by WhatsApp"/);
    // And a partly-or-not-at-all confirmed batch is told the count, in words.
    expect(src.slice(toastAt)).toContain("confirmed by WhatsApp — nothing else on this page is a delivery");
  });

  it("carries the route's fourth count through the response type", () => {
    expect(src).toContain("skipped?: number");
    expect(src).toContain("const skipped = r.skipped ?? 0;");
  });
});
