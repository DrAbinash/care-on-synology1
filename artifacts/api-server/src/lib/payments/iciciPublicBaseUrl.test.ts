import { describe, expect, test, afterEach, vi } from "vitest";
import { getIciciPublicBaseUrl } from "./iciciPublicBaseUrl";

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

    vi.stubEnv("PUBLIC_BASE_URL", "http://192.168.1.137:8888");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");
  });

  test("normalizes even when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_BASE_URL", "https://erp.caredeoghar.com/erp");
    expect(getIciciPublicBaseUrl()).toBe("https://caredeoghar.com");
  });
});
