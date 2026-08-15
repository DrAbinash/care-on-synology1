import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("POST /api/billing/save", () => {
  test("orchestrator reuses createOrderHandler + createBillHandler", () => {
    const src = readFileSync(join(__dirname, "billingDeskSave.ts"), "utf8");
    expect(src).toContain('billingDeskSaveRouter.post("/save"');
    expect(src).toContain("createOrderHandler");
    expect(src).toContain("createBillHandler");
    expect(src).toContain('fast: fastOff ? "0" : "1"');
    // Must defineProperty query — Object.assign({ query }) throws on Express 5
    expect(src).toContain('Object.defineProperty(billReq, "query"');
    expect(src).not.toMatch(/Object\.assign\([^)]*query:\s*\{/);
  });

  test("orders and bills export create handlers", () => {
    const orders = readFileSync(join(__dirname, "orders.ts"), "utf8");
    const bills = readFileSync(join(__dirname, "bills.ts"), "utf8");
    expect(orders).toContain("export async function createOrderHandler");
    expect(bills).toContain("export async function createBillHandler");
  });

  test("defineProperty can set query when prototype query is getter-only", () => {
    // Reproduces the production TypeError from care-api logs:
    // Cannot set property query of #<IncomingMessage> which has only a getter
    const proto: object = {};
    Object.defineProperty(proto, "query", {
      get() {
        return { existing: "1" };
      },
      enumerable: true,
      configurable: true,
    });
    const req = Object.assign(Object.create(proto), { body: { a: 1 } });
    expect(() =>
      Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
        body: {},
        query: { fast: "1" },
      }),
    ).toThrow(/Cannot set property query/);

    const billReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
      body: {},
    });
    Object.defineProperty(billReq, "query", {
      value: { ...(req.query as Record<string, unknown>), fast: "1" },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(billReq.query).toEqual({ existing: "1", fast: "1" });
  });
});
