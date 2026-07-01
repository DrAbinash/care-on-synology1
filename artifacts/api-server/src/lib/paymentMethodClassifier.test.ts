import { describe, expect, test } from "vitest";
import {
  classifyPaymentMethod,
  isPhysicalCash,
  isKnownPaymentMethod,
  isDigitalSettlement,
} from "./paymentMethodClassifier";

describe("classifyPaymentMethod — cash", () => {
  test("literal 'cash' is physical cash", () => {
    const c = classifyPaymentMethod("cash");
    expect(c.category).toBe("cash");
    expect(c.isCash).toBe(true);
    expect(c.isKnown).toBe(true);
  });

  test("'Cash' (mixed case) is still physical cash", () => {
    expect(isPhysicalCash("Cash")).toBe(true);
  });

  test("' cash ' (whitespace) is still physical cash", () => {
    expect(isPhysicalCash("  cash  ")).toBe(true);
  });
});

describe("classifyPaymentMethod — gateway/online payments (regression for the critical bug)", () => {
  const gatewayStrings = [
    "Online (ICICI Orange Pay)",
    "Online (Razorpay)",
    "Online (PhonePe)",
    "Online (BharatPe)",
    "Online (HDFC SmartGateway)",
    "Online (HDFC)",
  ];

  for (const raw of gatewayStrings) {
    test(`"${raw}" is classified as online, NOT cash`, () => {
      const c = classifyPaymentMethod(raw);
      expect(c.category).toBe("online");
      expect(c.isCash).toBe(false);
      expect(c.isKnown).toBe(true);
      expect(isPhysicalCash(raw)).toBe(false);
    });
  }

  test("bare 'online' is classified as online, not cash", () => {
    const c = classifyPaymentMethod("online");
    expect(c.category).toBe("online");
    expect(c.isCash).toBe(false);
  });

  test("legacy 'Web booking (Provider)' label is online, not cash", () => {
    const c = classifyPaymentMethod("Web booking (ICICI Orange Pay)");
    expect(c.category).toBe("online");
    expect(c.isCash).toBe(false);
  });

  test("'bank' / 'neft' / 'rtgs' are online, not cash", () => {
    expect(classifyPaymentMethod("bank").category).toBe("online");
    expect(classifyPaymentMethod("neft").category).toBe("online");
    expect(classifyPaymentMethod("rtgs").category).toBe("online");
  });
});

describe("classifyPaymentMethod — upi / card / cheque / insurance", () => {
  test("'upi' is digital, not cash", () => {
    const c = classifyPaymentMethod("upi");
    expect(c.category).toBe("upi");
    expect(c.isCash).toBe(false);
    expect(isDigitalSettlement("upi")).toBe(true);
  });

  test("'card' is digital, not cash", () => {
    const c = classifyPaymentMethod("card");
    expect(c.category).toBe("card");
    expect(c.isCash).toBe(false);
    expect(isDigitalSettlement("card")).toBe(true);
  });

  test("'cheque' is its own category, not cash", () => {
    const c = classifyPaymentMethod("cheque");
    expect(c.category).toBe("cheque");
    expect(c.isCash).toBe(false);
    expect(isDigitalSettlement("cheque")).toBe(true);
  });

  test("'insurance' is its own category, not cash (regression for the critical bug)", () => {
    const c = classifyPaymentMethod("insurance");
    expect(c.category).toBe("insurance");
    expect(c.isCash).toBe(false);
    expect(c.isKnown).toBe(true);
    expect(isDigitalSettlement("insurance")).toBe(true);
  });
});

describe("classifyPaymentMethod — unknown/exception bucket", () => {
  test("empty string is unknown, not cash", () => {
    const c = classifyPaymentMethod("");
    expect(c.category).toBe("unknown");
    expect(c.isCash).toBe(false);
    expect(c.isKnown).toBe(false);
  });

  test("null is unknown, not cash", () => {
    const c = classifyPaymentMethod(null);
    expect(c.category).toBe("unknown");
    expect(c.isCash).toBe(false);
    expect(c.isKnown).toBe(false);
  });

  test("undefined is unknown, not cash", () => {
    const c = classifyPaymentMethod(undefined);
    expect(c.isKnown).toBe(false);
  });

  test("whitespace-only string is unknown, not cash", () => {
    const c = classifyPaymentMethod("   ");
    expect(c.category).toBe("unknown");
    expect(c.isKnown).toBe(false);
  });

  test("a brand-new/unmapped gateway label not starting with 'online' is unknown", () => {
    const c = classifyPaymentMethod("wallet-xyz");
    expect(c.category).toBe("unknown");
    expect(c.isCash).toBe(false);
    expect(c.isKnown).toBe(false);
  });

  test("a typo'd method is unknown, not silently cash", () => {
    const c = classifyPaymentMethod("csah");
    expect(c.category).toBe("unknown");
    expect(c.isCash).toBe(false);
  });

  test("isKnownPaymentMethod false for unknown, true for recognized", () => {
    expect(isKnownPaymentMethod("gpay-loyalty-points")).toBe(false);
    expect(isKnownPaymentMethod("cash")).toBe(true);
    expect(isKnownPaymentMethod("Online (Razorpay)")).toBe(true);
  });

  test("isDigitalSettlement is false for unknown methods (exception, not digital)", () => {
    expect(isDigitalSettlement("wallet-xyz")).toBe(false);
    expect(isDigitalSettlement("")).toBe(false);
  });
});

describe("classifyPaymentMethod — cross-module consistency", () => {
  // The exact defect this module fixes: three independent classifiers
  // (my-daily-summary.ts, daily-summary.ts, day-close.ts) had drifted.
  // This test proves the single shared function gives identical, correct
  // answers for every real-world method value in one place.
  const cases: Array<[string, boolean /* isCash */, boolean /* isKnown */]> = [
    ["cash", true, true],
    ["upi", false, true],
    ["card", false, true],
    ["cheque", false, true],
    ["insurance", false, true],
    ["Online (ICICI Orange Pay)", false, true],
    ["Online (Razorpay)", false, true],
    ["Online (PhonePe)", false, true],
    ["Online (BharatPe)", false, true],
    ["bank", false, true],
    ["neft", false, true],
    ["rtgs", false, true],
    ["", false, false],
    ["mystery-method", false, false],
  ];

  for (const [raw, expectedIsCash, expectedIsKnown] of cases) {
    test(`"${raw}" → isCash=${expectedIsCash}, isKnown=${expectedIsKnown}`, () => {
      expect(isPhysicalCash(raw)).toBe(expectedIsCash);
      expect(isKnownPaymentMethod(raw)).toBe(expectedIsKnown);
    });
  }
});
