/**
 * Unit tests — Print & Send invokes print exactly once; queue lifecycle helpers.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isBillIssuableForWhatsApp,
  runPrintThenOfferWhatsApp,
} from "@/components/WhatsAppDeliveryDialog";

describe("Print & Send — print exactly once", () => {
  it("calls existing print handler once then opens dialog when auto-offer on", async () => {
    const printOnce = vi.fn();
    const openDialog = vi.fn();
    const result = await runPrintThenOfferWhatsApp({
      printOnce,
      autoOffer: true,
      openDialog,
    });
    expect(printOnce).toHaveBeenCalledTimes(1);
    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(result).toBe("printed_and_offered");
  });

  it("skips dialog when whatsapp_auto_offer_after_print is false", async () => {
    const printOnce = vi.fn();
    const openDialog = vi.fn();
    const result = await runPrintThenOfferWhatsApp({
      printOnce,
      autoOffer: false,
      openDialog,
    });
    expect(printOnce).toHaveBeenCalledTimes(1);
    expect(openDialog).not.toHaveBeenCalled();
    expect(result).toBe("printed_only");
  });
});

describe("issued vs draft bills", () => {
  it("disables WhatsApp for draft/cancelled", () => {
    expect(isBillIssuableForWhatsApp("draft")).toBe(false);
    expect(isBillIssuableForWhatsApp("cancelled")).toBe(false);
    expect(isBillIssuableForWhatsApp("pending")).toBe(true);
    expect(isBillIssuableForWhatsApp("paid")).toBe(true);
  });
});
