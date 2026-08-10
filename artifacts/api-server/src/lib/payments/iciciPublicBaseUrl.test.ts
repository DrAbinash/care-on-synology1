import { describe, expect, test, afterEach, vi } from "vitest";
import { getIciciPublicBaseUrl } from "./iciciPublicBaseUrl";

// Pure helpers mirrored here so this suite does not import PaymentEngine
// (which requires DATABASE_URL at module load).
function buildIciciOrangePayQrUrl(txnRef: string): string {
  const base = getIciciPublicBaseUrl();
  return `${base}/api/public/booking/icici-pay/${encodeURIComponent(txnRef)}`;
}
function buildIciciOrangePayReturnUrl(): string {
  return `${getIciciPublicBaseUrl()}/api/public/booking/icici-callback`;
}
function assembleIciciRedirectUrl(redirectURI: string, tranCtx: string): string {
  const joinChar = redirectURI.includes("?") ? "&" : "?";
  return `${redirectURI}${joinChar}tranCtx=${encodeURIComponent(tranCtx)}`;
}

describe("getIciciPublicBaseUrl — ICICI whitelisted domain", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses PUBLIC_BASE_URL when already caredeoghar.com", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://caredeoghar.com");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");
  });

  test("normalizes ERP / LAN / www hosts to caredeoghar.com", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://erp.caredeoghar.com");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");

    vi.stubEnv("PUBLIC_BASE_URL", "https://www.caredeoghar.com");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");

    vi.stubEnv("PUBLIC_BASE_URL", "http://172.16.1.139:8888");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");
  });

  test("normalizes even when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_BASE_URL", "https://erp.caredeoghar.com/erp");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");
  });
});

describe("ICICI QR bridge URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("QR URL is always on caredeoghar.com even when ERP is on LAN", () => {
    vi.stubEnv("PUBLIC_BASE_URL", "http://172.16.1.139:8888");
    expect(buildIciciOrangePayQrUrl("BILLPAY-12-ABC")).toBe(
      "https://caredeoghar.com/api/public/booking/icici-pay/BILLPAY-12-ABC",
    );
    expect(buildIciciOrangePayReturnUrl()).toBe(
      "https://caredeoghar.com/api/public/booking/icici-callback",
    );
  });

  test("assembles HPP redirect with tranCtx", () => {
    expect(assembleIciciRedirectUrl("https://pgpay.icicibank.com/pg/payment", "tok123")).toBe(
      "https://pgpay.icicibank.com/pg/payment?tranCtx=tok123",
    );
    expect(assembleIciciRedirectUrl("https://pgpay.icicibank.com/pg/payment?x=1", "tok")).toBe(
      "https://pgpay.icicibank.com/pg/payment?x=1&tranCtx=tok",
    );
  });
});
