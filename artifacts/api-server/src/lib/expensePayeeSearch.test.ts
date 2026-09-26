import { describe, expect, it } from "vitest";
import {
  canShowAccountingRetry,
  dedupePayeeSuggestions,
  isJunkHistoricalPayeeName,
  normalizePayeeName,
  parseExpenseMetaJson,
  scorePayeeMatch,
  serializeExpenseMetaJson,
  validateExpenseMetaJsonInput,
  type PayeeSuggestion,
} from "./expensePayeeSearch";

function sug(partial: Partial<PayeeSuggestion> & Pick<PayeeSuggestion, "name" | "kind">): PayeeSuggestion {
  return {
    normalizedName: normalizePayeeName(partial.name),
    vendorId: partial.vendorId ?? null,
    useCount: partial.useCount ?? 0,
    matchReason: partial.matchReason ?? "contains",
    rankScore: partial.rankScore ?? 0,
    ...partial,
  };
}

describe("normalizePayeeName", () => {
  it("uppercases and collapses whitespace", () => {
    expect(normalizePayeeName("  Ganeshas   Infotech ")).toBe("GANESHAS INFOTECH");
  });
});

describe("scorePayeeMatch substring ranking", () => {
  it("finds GANESHAS INFOTECH from mid-string fragments", () => {
    for (const q of ["ganes", "esha", "info", "tech", "GANESHAS", "Ganeshas Infotech"]) {
      const hit = scorePayeeMatch({ name: "GANESHAS INFOTECH", query: q, kind: "vendor" });
      expect(hit, q).not.toBeNull();
    }
  });

  it("finds RAJU ELECTRICIAN from raj / elect / ectri", () => {
    for (const q of ["raj", "elect", "ectri", "electrician"]) {
      expect(scorePayeeMatch({ name: "RAJU ELECTRICIAN", query: q, kind: "previous_payee" })).not.toBeNull();
    }
  });

  it("finds UTTAM from utt / tta / tam", () => {
    for (const q of ["utt", "tta", "tam"]) {
      expect(scorePayeeMatch({ name: "UTTAM", query: q, kind: "previous_payee" })).not.toBeNull();
    }
  });

  it("ranks exact > prefix > contains > description", () => {
    const exact = scorePayeeMatch({ name: "UTTAM", query: "uttam", kind: "previous_payee" })!;
    const prefix = scorePayeeMatch({ name: "UTTAM", query: "utt", kind: "previous_payee" })!;
    const contains = scorePayeeMatch({ name: "UTTAM", query: "tta", kind: "previous_payee" })!;
    const desc = scorePayeeMatch({
      name: "UTTAM",
      query: "plumber",
      kind: "previous_payee",
      descriptionHit: true,
    })!;
    expect(exact.rankScore).toBeGreaterThan(prefix.rankScore);
    expect(prefix.rankScore).toBeGreaterThan(contains.rankScore);
    expect(contains.rankScore).toBeGreaterThan(desc.rankScore);
  });

  it("prefers vendor master over previous payee at same tier", () => {
    const vendor = scorePayeeMatch({ name: "GANESHAS INFOTECH", query: "info", kind: "vendor" })!;
    const prev = scorePayeeMatch({ name: "GANESHAS INFOTECH", query: "info", kind: "previous_payee" })!;
    expect(vendor.rankScore).toBeGreaterThan(prev.rankScore);
  });
});

describe("dedupePayeeSuggestions", () => {
  it("keeps Vendor Master when normalized names collide", () => {
    const out = dedupePayeeSuggestions([
      sug({
        name: "Ganeshas Infotech",
        kind: "previous_payee",
        rankScore: 650,
        useCount: 5,
      }),
      sug({
        name: "GANESHAS INFOTECH",
        kind: "vendor",
        vendorId: 9,
        rankScore: 640,
        useCount: 1,
      }),
      sug({
        name: "  GANESHAS   INFOTECH ",
        kind: "previous_payee",
        rankScore: 600,
        useCount: 2,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("vendor");
    expect(out[0]!.vendorId).toBe(9);
  });

  it("does not merge genuinely different payee names", () => {
    const out = dedupePayeeSuggestions([
      sug({ name: "RAJU ELECTRICIAN", kind: "previous_payee", rankScore: 700 }),
      sug({ name: "RAJU ELECTRICALS", kind: "previous_payee", rankScore: 690 }),
      sug({ name: "GANESH INFOTECH", kind: "previous_payee", rankScore: 650 }),
      sug({ name: "GANESHAS INFOTECH", kind: "vendor", vendorId: 1, rankScore: 700 }),
    ]);
    expect(out.map((r) => r.normalizedName).sort()).toEqual([
      "GANESH INFOTECH",
      "GANESHAS INFOTECH",
      "RAJU ELECTRICALS",
      "RAJU ELECTRICIAN",
    ]);
  });
});

describe("isJunkHistoricalPayeeName", () => {
  it("filters blank/placeholder historical labels only", () => {
    for (const junk of ["", "  ", "-", "NA", "N/A", "cash", "SELF", "unknown", "nil"]) {
      expect(isJunkHistoricalPayeeName(junk), junk).toBe(true);
    }
    expect(isJunkHistoricalPayeeName("RAJU ELECTRICIAN")).toBe(false);
    expect(isJunkHistoricalPayeeName("CASH MART SUPPLIES")).toBe(false);
  });
});

describe("canShowAccountingRetry", () => {
  it("shows retry for FAILED and PENDING with error only", () => {
    expect(canShowAccountingRetry({ accountingStatus: "FAILED" })).toBe(true);
    expect(
      canShowAccountingRetry({ accountingStatus: "PENDING", accountingError: "voucher failed" }),
    ).toBe(true);
    expect(canShowAccountingRetry({ accountingStatus: "PENDING", accountingError: null })).toBe(false);
    expect(canShowAccountingRetry({ accountingStatus: "POSTED" })).toBe(false);
    expect(canShowAccountingRetry({ accountingStatus: "FAILED", paymentStatus: "VOID" })).toBe(false);
  });
});

describe("expense work meta JSON", () => {
  it("round-trips labour fields", () => {
    const raw = serializeExpenseMetaJson({
      workType: "Electrical",
      labourBasis: "per_day",
      days: 1,
      ratePerDay: 700,
      labourAmount: 700,
    });
    expect(parseExpenseMetaJson(raw)).toMatchObject({
      workType: "Electrical",
      labourBasis: "per_day",
      days: 1,
      ratePerDay: 700,
      labourAmount: 700,
    });
  });

  it("drops negative numerics on parse and rejects them on validate", () => {
    expect(parseExpenseMetaJson(JSON.stringify({ days: -1, ratePerDay: 700 }))).toMatchObject({
      days: null,
      ratePerDay: 700,
    });
    expect(validateExpenseMetaJsonInput(JSON.stringify({ days: -1 }))).toEqual({
      ok: false,
      error: "days must be a non-negative number",
    });
    expect(validateExpenseMetaJsonInput("{not json")).toMatchObject({ ok: false });
    expect(validateExpenseMetaJsonInput("x".repeat(5000))).toMatchObject({ ok: false });
    expect(validateExpenseMetaJsonInput(JSON.stringify({ days: 1.5, ratePerDay: 700, labourAmount: 1050 })).ok).toBe(
      true,
    );
  });
});
