import { describe, expect, test, vi } from "vitest";

vi.mock("./initiateIciciOrangePayment", () => ({
  buildIciciOrangePayQrUrl: (ref: string) => `https://caredeoghar.com/api/public/booking/icici-pay/${ref}`,
}));

import { shareableOnlineBookingPaymentUrl } from "./shareableOnlineBookingPaymentUrl";

describe("shareableOnlineBookingPaymentUrl", () => {
  test("ICICI/HDFC return the bridge URL, not the raw HPP redirect", () => {
    const hpp = "https://pgpay.icicibank.com/pg/payment?tranCtx=abc";
    expect(shareableOnlineBookingPaymentUrl("icici", "OB-1", hpp)).toBe(
      "https://caredeoghar.com/api/public/booking/icici-pay/OB-1",
    );
    expect(shareableOnlineBookingPaymentUrl("hdfc", "OB-2", hpp)).toBe(
      "https://caredeoghar.com/api/public/booking/icici-pay/OB-2",
    );
  });

  test("other gateways keep the provider redirect URL", () => {
    const url = "https://rzp.io/i/abc";
    expect(shareableOnlineBookingPaymentUrl("razorpay", "OB-3", url)).toBe(url);
    expect(shareableOnlineBookingPaymentUrl("bharatpe", "OB-4", url)).toBe(url);
  });
});
