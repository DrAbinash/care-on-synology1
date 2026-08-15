import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { istYearMonth } from "./documentNumberCounters";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("documentNumberCounters — order month + sync", () => {
  test("istYearMonth returns Asia/Kolkata YYYYMM", () => {
    // Fixed UTC instant that is still previous calendar day in US but same IST day
    const d = new Date("2026-08-15T20:00:00.000Z"); // IST = Aug 16 01:30
    expect(istYearMonth(d)).toBe("202608");
    const nearMidnightIst = new Date("2026-08-15T18:31:00.000Z"); // IST Aug 16 00:01
    expect(istYearMonth(nearMidnightIst)).toBe("202608");
  });

  test("syncOrderNumberSeqForward exists and validates yyyymm", () => {
    const src = readFileSync(join(__dirname, "documentNumberCounters.ts"), "utf8");
    expect(src).toContain("export async function syncOrderNumberSeqForward");
    expect(src).toContain("order_number_seq_");
    expect(src).toContain("/^\\d{6}$/");
  });
});

describe("billing save harden migration", () => {
  test("migration creates active order_id unique and partial client_ref", () => {
    const mig = readFileSync(
      join(__dirname, "../../../../migrations/zzzzzzzzzzzz_billing_save_harden.sql"),
      "utf8",
    );
    expect(mig).toContain("bills_order_id_active_uidx");
    expect(mig).toContain("DROP INDEX IF EXISTS bills_client_ref_uidx");
    expect(mig).toContain("status IS DISTINCT FROM 'cancelled'");
  });
});
