import { describe, expect, it } from "vitest";
import { buildBillFieldMeta } from "./localDocumentOcr";

describe("buildBillFieldMeta", () => {
  it("marks blank payment mode as missing (does not invent cash)", () => {
    const fields = buildBillFieldMeta(
      {
        vendor: "ABC Medical",
        amount: 18500,
        gstAmount: 0,
        category: "Medical Supplies",
        paymentMode: "",
        fieldConfidence: { vendor: 96, amount: 98, category: 70, paymentMode: 0 },
      },
      87,
    );
    expect(fields.vendor?.source).toBe("ocr");
    expect(fields.vendor?.confidencePercent).toBe(96);
    expect(fields.amount?.value).toBe(18500);
    expect(fields.paymentMode?.source).toBe("missing");
    expect(fields.paymentMode?.value).toBeNull();
    expect(fields.category?.source).toBe("ai_suggested");
  });

  it("keeps explicit UPI payment mode as OCR", () => {
    const fields = buildBillFieldMeta(
      {
        vendor: "ABC",
        amount: 100,
        paymentMode: "upi",
        fieldConfidence: { vendor: 90, amount: 95, paymentMode: 88 },
      },
      87,
    );
    expect(fields.paymentMode?.source).toBe("ocr");
    expect(fields.paymentMode?.value).toBe("upi");
  });
});
