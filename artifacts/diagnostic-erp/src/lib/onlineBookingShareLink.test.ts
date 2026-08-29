import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OnlineBookings share payment link UX", () => {
  const src = readFileSync(resolve(__dirname, "../pages/OnlineBookings.tsx"), "utf8");

  it("uses emerald Share Link (not destructive red) and opens a URL share dialog", () => {
    expect(src).toContain('data-testid="booking-share-link"');
    expect(src).toContain('data-testid="booking-share-link-dialog"');
    expect(src).toContain("text-emerald-700");
    expect(src).toContain("bookingWhatsAppPaymentUrl");
    expect(src).toContain("do not paste a screenshot");
    expect(src).not.toMatch(/Share Link[\s\S]{0,80}destructive/);
  });
});
