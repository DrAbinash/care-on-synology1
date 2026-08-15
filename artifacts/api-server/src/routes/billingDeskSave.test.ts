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
  });

  test("orders and bills export create handlers", () => {
    const orders = readFileSync(join(__dirname, "orders.ts"), "utf8");
    const bills = readFileSync(join(__dirname, "bills.ts"), "utf8");
    expect(orders).toContain("export async function createOrderHandler");
    expect(bills).toContain("export async function createBillHandler");
  });
});
