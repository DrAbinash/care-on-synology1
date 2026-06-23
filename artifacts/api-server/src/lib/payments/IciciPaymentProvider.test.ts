import { describe, it, expect } from "vitest";
import { normalizeIciciBaseUrl } from "./IciciPaymentProvider";

describe("IciciPaymentProvider URL Normalization", () => {
  const getInitiateUrl = (baseUrl: string) => `${normalizeIciciBaseUrl(baseUrl)}/pg/api/v2/initiateSale`;
  const getCommandUrl = (baseUrl: string) => `${normalizeIciciBaseUrl(baseUrl)}/pg/api/command`;

  it("1. should correctly normalize standard base URL", () => {
    const baseUrl = "https://pgpay.icicibank.com";
    expect(getInitiateUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/v2/initiateSale");
    expect(getCommandUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/command");
  });

  it("2. should strip trailing /pg/api/v2 and normalize correctly", () => {
    const baseUrl = "https://pgpay.icicibank.com/pg/api/v2";
    expect(getInitiateUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/v2/initiateSale");
    expect(getCommandUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/command");
  });

  it("3. should strip trailing /pg/api and normalize correctly", () => {
    const baseUrl = "https://pgpay.icicibank.com/pg/api";
    expect(getInitiateUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/v2/initiateSale");
    expect(getCommandUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/command");
  });

  it("4. should strip trailing slash and normalize correctly", () => {
    const baseUrl = "https://pgpay.icicibank.com/";
    expect(getInitiateUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/v2/initiateSale");
    expect(getCommandUrl(baseUrl)).toBe("https://pgpay.icicibank.com/pg/api/command");
  });
});
