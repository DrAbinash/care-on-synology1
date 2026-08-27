import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  bearerMatchesInternalApiKey,
  bearerMatchesStrongInternalApiKey,
  requireInternalApiKey,
  requireStrongInternalApiKey,
  safeEqual,
} from "./internalApiKeyAuth";

type Handler = (req: unknown, res: unknown, next: () => void) => void | Promise<void>;

function fakeRes() {
  const out: { code?: number; body?: unknown } = {};
  const res = {
    status(c: number) {
      out.code = c;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    header: () => undefined,
    setHeader: () => undefined,
  };
  return { res, out };
}

async function runMiddleware(
  middleware: Handler,
  authHeader: string,
): Promise<{ passed: boolean; code?: number; body?: unknown }> {
  const { res, out } = fakeRes();
  let passed = false;
  const req = {
    header: (n: string) => (n.toLowerCase() === "authorization" ? authHeader : undefined),
    headers: {},
  };
  await middleware(req, res, () => {
    passed = true;
  });
  return { passed, ...out };
}

describe("internalApiKeyAuth", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  test("safeEqual compares in constant time shape", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  test("requireStrongInternalApiKey rejects production placeholder 1234", async () => {
    process.env.INTERNAL_API_KEY = "1234";
    const r = await runMiddleware(requireStrongInternalApiKey, "Bearer 1234");
    expect(r.passed).toBe(false);
    expect(r.code).toBe(503);
    expect(JSON.stringify(r.body)).toContain("INTERNAL_API_KEY");
    expect(JSON.stringify(r.body)).not.toContain('"1234"');
  });

  test("requireStrongInternalApiKey accepts a strong key", async () => {
    const strong = "kJ8n2Qw7Zx4Vb9Rt6Yu1Ip3Ol5As0Df";
    process.env.INTERNAL_API_KEY = strong;
    const ok = await runMiddleware(requireStrongInternalApiKey, `Bearer ${strong}`);
    expect(ok.passed).toBe(true);
    const bad = await runMiddleware(requireStrongInternalApiKey, "Bearer wrong-but-long-enough-value");
    expect(bad.passed).toBe(false);
    expect(bad.code).toBe(401);
  });

  test("requireInternalApiKey still accepts weak keys for DICOM intake", async () => {
    process.env.NODE_ENV = "production";
    process.env.INTERNAL_API_KEY = "1234";
    const r = await runMiddleware(requireInternalApiKey, "Bearer 1234");
    expect(r.passed).toBe(true);
  });

  test("bearerMatchesStrongInternalApiKey rejects weak configured keys", () => {
    process.env.INTERNAL_API_KEY = "1234";
    const req = { header: (n: string) => (n === "authorization" ? "Bearer 1234" : undefined), headers: {} };
    expect(bearerMatchesInternalApiKey(req as never)).toBe(true);
    expect(bearerMatchesStrongInternalApiKey(req as never)).toBe(false);
  });
});
