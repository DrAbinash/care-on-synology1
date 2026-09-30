import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { CreateExpenseBody, UpdateExpenseBody } from "@workspace/api-zod";
import { billsTable, expensesTable, paymentsTable } from "@workspace/db/schema";
import {
  CARE_BUSINESS_TIMEZONE,
  clinicDateOf,
  clinicDayBoundsIST,
  istHourMinute,
  todayIST,
} from "./istDate";
import { careTimeResponse } from "./careTimeContract";

/**
 * STAGE 1A — TIME-AUTHORITY CONTRACT TESTS.
 *
 * These assert the contract Stage 1A establishes: the CARE business date is
 * derived from a trusted server instant in Asia/Kolkata, the CARE business day
 * is 00:00:00.000–23:59:59.999 IST, and no caller-supplied value can influence
 * the answer. They also pin what Stage 1A must NOT have done — no accept/reject
 * change, no historical reinterpretation, no cutover enforcement — because the
 * forward-only rule is a property of the code, not of intent.
 *
 * No database is touched: the payload builder lives in `lib/` precisely so this
 * file never imports a router and therefore never opens a pool.
 */

const at = (iso: string) => new Date(iso);
const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8").replace(/\r\n/g, "\n");

/** Scan code, not prose: Stage 1A comments quote the idioms they removed. */
const codeOnly = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

/** The five boundary instants Stage 0 §13 identified, expressed in UTC. */
const BOUNDARIES: Array<{ label: string; iso: string; clinicDate: string; dayStartUtc: string; dayEndUtc: string }> = [
  {
    label: "23:59 IST on 29-Sep",
    iso: "2026-09-29T18:29:00Z",
    clinicDate: "2026-09-29",
    dayStartUtc: "2026-09-28T18:30:00.000Z",
    dayEndUtc: "2026-09-29T18:29:59.999Z",
  },
  {
    label: "00:00 IST on 30-Sep (clinic day rolls)",
    iso: "2026-09-29T18:30:00Z",
    clinicDate: "2026-09-30",
    dayStartUtc: "2026-09-29T18:30:00.000Z",
    dayEndUtc: "2026-09-30T18:29:59.999Z",
  },
  {
    label: "00:01 IST on 30-Sep",
    iso: "2026-09-29T18:31:00Z",
    clinicDate: "2026-09-30",
    dayStartUtc: "2026-09-29T18:30:00.000Z",
    dayEndUtc: "2026-09-30T18:29:59.999Z",
  },
  {
    label: "05:29 IST on 30-Sep (UTC still 29-Sep)",
    iso: "2026-09-29T23:59:00Z",
    clinicDate: "2026-09-30",
    dayStartUtc: "2026-09-29T18:30:00.000Z",
    dayEndUtc: "2026-09-30T18:29:59.999Z",
  },
  {
    label: "05:30 IST on 30-Sep (UTC rolls too)",
    iso: "2026-09-30T00:00:00Z",
    clinicDate: "2026-09-30",
    dayStartUtc: "2026-09-29T18:30:00.000Z",
    dayEndUtc: "2026-09-30T18:29:59.999Z",
  },
];

describe("Stage 1A · §18(1)(4) — the CARE business date is Asia/Kolkata-derived", () => {
  it("names the correct clinic day at all five boundary instants", () => {
    for (const b of BOUNDARIES) {
      expect(clinicDateOf(at(b.iso)), b.label).toBe(b.clinicDate);
    }
  });

  it("is not the UTC calendar day between 00:00 and 05:29:59 IST", () => {
    // The defect Stage 1A removes from every default path, stated as an
    // invariant rather than a characterisation: the two idioms disagree here,
    // and the CARE answer is always the IST one.
    for (const iso of ["2026-09-29T18:30:00Z", "2026-09-29T23:59:00Z", "2026-09-29T23:59:59.999Z"]) {
      expect(clinicDateOf(at(iso)), iso).toBe("2026-09-30");
      expect(at(iso).toISOString().slice(0, 10), `${iso} is the WRONG answer`).toBe("2026-09-29");
    }
  });

  it("todayIST() and clinicDateOf() are the same authority, so one name cannot mean two things", () => {
    for (const b of BOUNDARIES) {
      expect(todayIST(at(b.iso)), b.label).toBe(clinicDateOf(at(b.iso)));
    }
  });

  it("CARE_BUSINESS_TIMEZONE is the only timezone this contract can name", () => {
    expect(CARE_BUSINESS_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("Stage 1A · §18(2) — neither the process timezone nor the browser timezone can move it", () => {
  it("returns the same clinic day under UTC, Kolkata and New York process timezones", () => {
    const iso = "2026-09-29T18:30:00Z"; // 00:00 IST on 30-Sep
    const before = process.env.TZ;
    try {
      for (const [tz, expected] of [["UTC", "2026-09-30"], ["Asia/Kolkata", "2026-09-30"], ["America/New_York", "2026-09-30"]] as const) {
        process.env.TZ = tz;
        expect(clinicDateOf(at(iso)), `TZ=${tz}`).toBe(expected);
        expect(careTimeResponse(at(iso)).clinicDateIst, `TZ=${tz}`).toBe(expected);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("a client-supplied instant never becomes the authority: the contract reads no request", () => {
    const route = codeOnly(src("../routes/careTime.ts"));
    expect(route).toMatch(/router\.get\("\/now", \(_req, res\)/); // request unused
    expect(route).not.toMatch(/req\.query|req\.body|req\.headers/);
    const contract = codeOnly(src("./careTimeContract.ts"));
    expect(contract).not.toMatch(/\breq\b|request|header|query/i);
    expect(contract).toMatch(/export function careTimeResponse\(serverNow: Date\)/);
  });
});

describe("Stage 1A · §1 — the CARE business day is 00:00:00.000–23:59:59.999 IST", () => {
  it("clinicDayBoundsIST() returns exact, inclusive UTC instants for both edges", () => {
    for (const b of BOUNDARIES) {
      const bounds = clinicDayBoundsIST(at(b.iso));
      expect(bounds.clinicDate, b.label).toBe(b.clinicDate);
      expect(bounds.startUtc.toISOString(), b.label).toBe(b.dayStartUtc);
      expect(bounds.endUtc.toISOString(), b.label).toBe(b.dayEndUtc);
    }
  });

  it("the day is exactly 24h minus one millisecond, and the last legal instant is inside it", () => {
    const { startUtc, endUtc } = clinicDayBoundsIST(at("2026-09-30T02:00:00+05:30"));
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
    expect(clinicDateOf(endUtc)).toBe("2026-09-30");
    expect(clinicDateOf(new Date(endUtc.getTime() + 1))).toBe("2026-10-01");
    expect(istHourMinute(endUtc)).toEqual({ hour: 23, minute: 59 });
  });

  it("bounds are stable no matter which instant inside the day is asked about", () => {
    const first = clinicDayBoundsIST(at("2026-09-29T18:30:00Z")).startUtc.toISOString();
    const last = clinicDayBoundsIST(at("2026-09-30T18:29:59.999Z")).startUtc.toISOString();
    expect(first).toBe(last);
  });
});

describe("Stage 1A · §7/§24 — the /api/time/now contract", () => {
  it("reports the trusted instant, the clinic date, the zone and the day bounds", () => {
    const p = careTimeResponse(at("2026-09-29T23:59:00Z"));
    expect(p).toEqual({
      zone: "Asia/Kolkata",
      clinicDateIst: "2026-09-30",
      serverNowIso: "2026-09-29T23:59:00.000Z",
      businessDayStartUtcIso: "2026-09-29T18:30:00.000Z",
      businessDayEndUtcIso: "2026-09-30T18:29:59.999Z",
      source: "care-api-node-clock",
    });
  });

  it("names its clock instead of pretending to be the database", () => {
    // Stage 1B's two-clock check needs to know which clock answered; until
    // then claiming `source: "postgres"` would be a false guarantee.
    expect(careTimeResponse(new Date()).source).toBe("care-api-node-clock");
  });

  it("discloses no infrastructure detail beyond a timezone name and instants", () => {
    const keys = Object.keys(careTimeResponse(new Date())).sort();
    expect(keys).toEqual([
      "businessDayEndUtcIso",
      "businessDayStartUtcIso",
      "clinicDateIst",
      "serverNowIso",
      "source",
      "zone",
    ]);
  });

  it("is mounted behind the staff session and is read-only", () => {
    const index = src("../routes/index.ts");
    expect(index).toMatch(/router\.use\("\/time", careTimeRouter\)/);
    const route = src("../routes/careTime.ts");
    expect(route).toMatch(/router\.use\(requireStaffAuth\)/);
    expect(route).toMatch(/router\.get\("\/now"/);
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  it("the broken `nowIST()` is gone rather than repaired into use", () => {
    // Stage 0 characterized it as Invalid Date with zero callers. Stage 1A
    // deletes it: an instant is not "in a timezone", and keeping a helper that
    // pretends otherwise invites the wrong primitive back.
    expect(src("./istDate.ts")).not.toMatch(/export function nowIST/);
    expect(src("./istDate.ts")).toContain("was removed in Stage 1A");
  });
});

describe("Stage 1A · §2/§3 — forward-only, and a default is not a control", () => {
  it("FORWARD-ONLY: no schema column was added or repurposed by Stage 1A", () => {
    const names = (t: object) => Object.keys(getTableColumns(t as never));
    for (const t of [expensesTable, billsTable, paymentsTable]) {
      expect(names(t)).not.toContain("effectiveDate");
      expect(names(t)).not.toContain("careBusinessDate");
      expect(names(t)).not.toContain("timeIntegrityCutoverAt");
    }
  });

  it("FORWARD-ONLY: Stage 1A adds no migration file", () => {
    const added = readdirSync(resolve(__dirname, "../../../../migrations")).filter((f) =>
      /stage1a|care_business_date|care_time|business_date/i.test(f),
    );
    expect(added).toEqual([]);
  });

  it("NO POLICY: a historical business date is still accepted verbatim by the money path", () => {
    // Stage 1A changed a default, not a permission. If any of these start
    // failing, someone turned the trusted default into a floor — D-2 is not
    // decided and Stage 1A has no authority to decide it.
    for (const expenseDate of ["2024-01-31", "2026-09-29", "2035-01-01", ""]) {
      expect(
        CreateExpenseBody.safeParse({ category: "utilities", description: "x", amount: 1, expenseDate }).success,
        `expenseDate=${JSON.stringify(expenseDate)} must still parse`,
      ).toBe(true);
    }
    expect(UpdateExpenseBody.safeParse({ expenseDate: "1900-01-01" }).success).toBe(true);
  });

  it("NO POLICY: no route gained a same-day / window / reason / approval check", () => {
    for (const rel of ["../routes/expenses.ts", "../routes/accounting.ts", "../routes/form-f.ts"]) {
      const s = src(rel);
      expect(s, rel).not.toMatch(/clinicDateOf|careTimeResponse|businessDayStartUtcIso/);
      expect(s, rel).not.toMatch(/time_integrity_cutover_at|backdateWindow|reasonRequired/);
    }
  });

  it("TRUSTED INSTANTS: DB-generated created_at is untouched by Stage 1A", () => {
    for (const t of [[expensesTable, "createdAt"], [billsTable, "createdAt"], [paymentsTable, "createdAt"]] as const) {
      const c = (getTableColumns(t[0] as never) as Record<string, { columnType?: string; hasDefault?: boolean }>)[t[1]];
      expect(c.columnType).toBe("PgTimestamp");
      expect(c.hasDefault).toBe(true);
    }
  });
});
