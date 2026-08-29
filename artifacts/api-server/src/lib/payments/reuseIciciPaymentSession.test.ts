import { describe, expect, test } from "vitest";
import {
  isDuplicateOrReuseableInitiateError,
  redirectUrlFromPaymentLog,
} from "./reuseIciciPaymentSession";

describe("reuseIciciPaymentSession", () => {
  test("detects P1006 / duplicate initiate errors", () => {
    expect(isDuplicateOrReuseableInitiateError("P1006")).toBe(true);
    expect(isDuplicateOrReuseableInitiateError("P1006. Use Pay at Centre.")).toBe(true);
    expect(isDuplicateOrReuseableInitiateError("Duplicate merchant transaction")).toBe(true);
    expect(isDuplicateOrReuseableInitiateError("Gateway timeout")).toBe(false);
  });

  test("reads redirect from requestPayload or responsePayload", () => {
    expect(
      redirectUrlFromPaymentLog({
        status: "initiated",
        requestPayload: JSON.stringify({ redirectUrl: "https://pgpay.example/pay?x=1" }),
        responsePayload: null,
      }),
    ).toBe("https://pgpay.example/pay?x=1");

    expect(
      redirectUrlFromPaymentLog({
        status: "initiated",
        requestPayload: "{}",
        responsePayload: JSON.stringify({
          redirectURI: "https://pgpay.example/hpp",
          tranCtx: "abc",
        }),
      }),
    ).toBe("https://pgpay.example/hpp?tranCtx=abc");

    expect(
      redirectUrlFromPaymentLog({
        status: "failed",
        requestPayload: JSON.stringify({ redirectUrl: "https://pgpay.example/pay" }),
        responsePayload: null,
      }),
    ).toBeNull();
  });
});
