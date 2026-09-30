/**
 * Bill Desk is the source of truth for Reporting Studio worklist demographics.
 *
 * Join chain (first unique hit wins):
 *   1. billNumber     — worklist.accessionNumber equals bills.bill_number
 *   2. accessionNumber — radiology_studies.accession_number match with bill_id
 *   3. worklistId     — worklist.study_id → radiology_studies.bill_id
 *   4. singleHit      — patientName + studyDate ±1 day + modality (exactly one bill)
 *
 * Never synthesizes "Self/Walk-in". Referring doctor / age / sex come from
 * bill → order → doctor / patient rows only.
 */
import { db } from "@workspace/db";
import {
  billsTable,
  doctorsTable,
  ordersTable,
  patientsTable,
  radiologyStudiesTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { normalizeModality } from "./usgModality";

export type BillMatchKey =
  | "billNumber"
  | "accessionNumber"
  | "worklistId"
  | "singleHit"
  | null;

export type BillDeskResolution = {
  matchedKey: BillMatchKey;
  billId: number | null;
  billNumber: string;
  referringDoctor: string;
  patientAge: string;
  patientSex: string;
  patientId: number | null;
  patientPhone: string;
  patientAddress: string;
};

export type WorklistBillJoinInput = {
  worklistId: number;
  accessionNumber: string | null;
  studyId: number | null;
  patientId: number | null;
  patientName: string;
  modality: string | null;
  studyDate: string | null;
};

export type MatchKeyCounters = Record<
  "billNumber" | "accessionNumber" | "worklistId" | "singleHit" | "unmatched",
  number
>;

export function emptyMatchKeyCounters(): MatchKeyCounters {
  return {
    billNumber: 0,
    accessionNumber: 0,
    worklistId: 0,
    singleHit: 0,
    unmatched: 0,
  };
}

export function accumulateMatchKey(
  counters: MatchKeyCounters,
  key: BillMatchKey,
): MatchKeyCounters {
  if (key == null) return { ...counters, unmatched: counters.unmatched + 1 };
  return { ...counters, [key]: counters[key] + 1 };
}

/** Verbatim bill-desk referrer — empty string only, never Self/Walk-in. */
export function referringDoctorFromBillDesk(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Age from bill-desk patient age_value/unit or DOB.
 * Rejects <0 or >110 (never emit 126 / machine dummies).
 */
export function sanitizePatientAge(opts: {
  ageValue?: number | null;
  ageUnit?: string | null;
  dateOfBirth?: string | null;
}): string {
  if (opts.ageValue != null && Number.isFinite(opts.ageValue)) {
    if (opts.ageValue < 0 || opts.ageValue > 110) return "";
    const unit = (opts.ageUnit ?? "").toLowerCase();
    if (unit.startsWith("month")) return `${opts.ageValue}M`;
    if (unit.startsWith("day")) return `${opts.ageValue}D`;
    return String(opts.ageValue);
  }

  const dob = (opts.dateOfBirth ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(dob)) {
    const years = Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000);
    if (years < 0 || years > 110) return "";
    if (years === 0) return "";
    return String(years);
  }

  return "";
}

export function sanitizePatientSex(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

function normalizeAccession(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]/gi, "");
}

function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse worklist studyDate (YYYYMMDD / YYYY-MM-DD / ISO) → Date at UTC noon, or null. */
export function parseStudyDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const compact = s.replace(/[^0-9]/g, "");
  if (compact.length >= 8) {
    const d = new Date(
      `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T12:00:00.000Z`,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayBounds(center: Date, radiusDays: number): { start: Date; end: Date } {
  const start = new Date(center.getTime());
  start.setUTCDate(start.getUTCDate() - radiusDays);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(center.getTime());
  end.setUTCDate(end.getUTCDate() + radiusDays);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

type BillDeskRow = {
  billId: number;
  billNumber: string;
  patientId: number;
  patientFirstName: string | null;
  patientLastName: string | null;
  patientPhone: string | null;
  patientAddress: string | null;
  patientDob: string | null;
  patientAgeValue: number | null;
  patientAgeUnit: string | null;
  patientGender: string | null;
  referringDoctor: string | null;
  studyAccession: string | null;
  studyId: number | null;
  studyModality: string | null;
  studyDate: string | null;
};

function toResolution(row: BillDeskRow, matchedKey: BillMatchKey): BillDeskResolution {
  return {
    matchedKey,
    billId: row.billId,
    billNumber: row.billNumber ?? "",
    referringDoctor: referringDoctorFromBillDesk(row.referringDoctor),
    patientAge: sanitizePatientAge({
      ageValue: row.patientAgeValue,
      ageUnit: row.patientAgeUnit,
      dateOfBirth: row.patientDob,
    }),
    patientSex: sanitizePatientSex(row.patientGender),
    patientId: row.patientId,
    patientPhone: row.patientPhone ?? "",
    patientAddress: row.patientAddress ?? "",
  };
}

function emptyResolution(): BillDeskResolution {
  return {
    matchedKey: null,
    billId: null,
    billNumber: "",
    referringDoctor: "",
    patientAge: "",
    patientSex: "",
    patientId: null,
    patientPhone: "",
    patientAddress: "",
  };
}

async function loadBillDeskByBillIds(billIds: number[]): Promise<Map<number, BillDeskRow>> {
  const out = new Map<number, BillDeskRow>();
  if (billIds.length === 0) return out;

  const rows = await db
    .select({
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      patientId: billsTable.patientId,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientPhone: patientsTable.phone,
      patientAddress: patientsTable.address,
      patientDob: patientsTable.dateOfBirth,
      patientAgeValue: patientsTable.ageValue,
      patientAgeUnit: patientsTable.ageUnit,
      patientGender: patientsTable.gender,
      referringDoctor: doctorsTable.name,
    })
    .from(billsTable)
    .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
    .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
    .where(
      and(
        inArray(billsTable.id, billIds),
        ne(billsTable.status, "cancelled"),
        isNull(billsTable.cancelledAt),
      ),
    );

  for (const r of rows) {
    out.set(r.billId, {
      ...r,
      studyAccession: null,
      studyId: null,
      studyModality: null,
      studyDate: null,
    });
  }
  return out;
}

/**
 * Resolve Bill Desk demographics for a batch of worklist rows.
 * Prefers earlier join keys; single-hit only when exactly one candidate.
 */
export async function resolveBillDeskForWorklistRows(
  inputs: WorklistBillJoinInput[],
): Promise<Map<number, BillDeskResolution>> {
  const result = new Map<number, BillDeskResolution>();
  if (inputs.length === 0) return result;

  for (const input of inputs) {
    result.set(input.worklistId, emptyResolution());
  }

  const claimedBillIds = new Set<number>();

  const claim = (worklistId: number, resolution: BillDeskResolution) => {
    result.set(worklistId, resolution);
    if (resolution.billId != null) claimedBillIds.add(resolution.billId);
  };

  // ── 1. billNumber: accession == bill_number ───────────────────────────────
  const accessions = [
    ...new Set(
      inputs
        .map((i) => (i.accessionNumber ?? "").trim())
        .filter((a) => a.length > 0),
    ),
  ];
  if (accessions.length > 0) {
    const byBillNumber = await db
      .select({
        billId: billsTable.id,
        billNumber: billsTable.billNumber,
        patientId: billsTable.patientId,
        patientFirstName: patientsTable.firstName,
        patientLastName: patientsTable.lastName,
        patientPhone: patientsTable.phone,
        patientAddress: patientsTable.address,
        patientDob: patientsTable.dateOfBirth,
        patientAgeValue: patientsTable.ageValue,
        patientAgeUnit: patientsTable.ageUnit,
        patientGender: patientsTable.gender,
        referringDoctor: doctorsTable.name,
      })
      .from(billsTable)
      .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
      .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
      .where(
        and(
          inArray(billsTable.billNumber, accessions),
          ne(billsTable.status, "cancelled"),
          isNull(billsTable.cancelledAt),
        ),
      );

    // Bill numbers are unique per BOOK, so one accession string can match live
    // rows in two registers. Picking either would attach a stranger's
    // demographics to a study, so a colliding number is left unclaimed here and
    // falls through to the study-keyed joins below, which are exact.
    const billByNumber = new Map<string, (typeof byBillNumber)[number]>();
    const seenNumbers = new Set<string>();
    for (const r of byBillNumber) {
      const key = r.billNumber.trim();
      if (seenNumbers.has(key)) {
        billByNumber.delete(key);
        continue;
      }
      seenNumbers.add(key);
      billByNumber.set(key, r);
    }
    for (const input of inputs) {
      const acc = (input.accessionNumber ?? "").trim();
      if (!acc) continue;
      const hit = billByNumber.get(acc);
      if (!hit) continue;
      claim(
        input.worklistId,
        toResolution(
          {
            ...hit,
            studyAccession: null,
            studyId: null,
            studyModality: null,
            studyDate: null,
          },
          "billNumber",
        ),
      );
    }
  }

  // ── 2. accessionNumber: study accession → bill_id ─────────────────────────
  const stillNeed = inputs.filter((i) => result.get(i.worklistId)?.matchedKey == null);
  const rawAccsForStudy = [
    ...new Set(
      stillNeed
        .map((i) => (i.accessionNumber ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (rawAccsForStudy.length > 0) {
    const studyRows = await db
      .select({
        studyId: radiologyStudiesTable.id,
        billId: radiologyStudiesTable.billId,
        accessionNumber: radiologyStudiesTable.accessionNumber,
      })
      .from(radiologyStudiesTable)
      .where(
        and(
          inArray(radiologyStudiesTable.accessionNumber, rawAccsForStudy),
          sql`${radiologyStudiesTable.billId} is not null`,
          ne(radiologyStudiesTable.status, "cancelled"),
        ),
      );

    const billIds = studyRows
      .map((s) => s.billId)
      .filter((id): id is number => typeof id === "number");
    const bills = await loadBillDeskByBillIds(billIds);
    const studyByAcc = new Map<string, number>();
    const dupAcc = new Set<string>();
    for (const s of studyRows) {
      if (s.billId == null) continue;
      const key = normalizeAccession(s.accessionNumber);
      if (!key) continue;
      if (dupAcc.has(key)) continue;
      if (studyByAcc.has(key) && studyByAcc.get(key) !== s.billId) {
        studyByAcc.delete(key);
        dupAcc.add(key);
        continue;
      }
      studyByAcc.set(key, s.billId);
    }

    for (const input of stillNeed) {
      const key = normalizeAccession(input.accessionNumber);
      if (!key || dupAcc.has(key)) continue;
      const billId = studyByAcc.get(key);
      if (billId == null || claimedBillIds.has(billId)) continue;
      const bill = bills.get(billId);
      if (!bill) continue;
      claim(input.worklistId, toResolution(bill, "accessionNumber"));
    }
  }

  // ── 3. worklistId: worklist.study_id → study.bill_id ───────────────────────
  const needStudyLink = inputs.filter((i) => result.get(i.worklistId)?.matchedKey == null && i.studyId != null);
  if (needStudyLink.length > 0) {
    const studyIds = [...new Set(needStudyLink.map((i) => i.studyId!))];
    const linked = await db
      .select({
        studyId: radiologyStudiesTable.id,
        billId: radiologyStudiesTable.billId,
      })
      .from(radiologyStudiesTable)
      .where(
        and(
          inArray(radiologyStudiesTable.id, studyIds),
          sql`${radiologyStudiesTable.billId} is not null`,
          ne(radiologyStudiesTable.status, "cancelled"),
        ),
      );
    const billByStudy = new Map(
      linked
        .filter((r): r is { studyId: number; billId: number } => r.billId != null)
        .map((r) => [r.studyId, r.billId]),
    );
    const bills = await loadBillDeskByBillIds([...new Set(billByStudy.values())]);
    for (const input of needStudyLink) {
      const billId = billByStudy.get(input.studyId!);
      if (billId == null || claimedBillIds.has(billId)) continue;
      const bill = bills.get(billId);
      if (!bill) continue;
      claim(input.worklistId, toResolution(bill, "worklistId"));
    }
  }

  // ── 4. singleHit: name + studyDate±1 + modality (exactly one bill) ────────
  // Refuse bills already claimed by a stronger key in this batch (prevents
  // Orthanc machine-ghost rows from stealing Bill Desk demographics).
  const needFuzzy = inputs.filter((i) => result.get(i.worklistId)?.matchedKey == null);
  for (const input of needFuzzy) {
    const studyDay = parseStudyDate(input.studyDate);
    if (!studyDay) continue;
    const modality = normalizeModality(input.modality);
    if (!modality) continue;
    const nameKey = normalizeName(input.patientName);
    if (!nameKey) continue;

    const { start, end } = dayBounds(studyDay, 1);
    const startYmd = start.toISOString().slice(0, 10).replace(/-/g, "");
    const endYmd = end.toISOString().slice(0, 10).replace(/-/g, "");

    const candidates = await db
      .select({
        billId: billsTable.id,
        billNumber: billsTable.billNumber,
        patientId: billsTable.patientId,
        patientFirstName: patientsTable.firstName,
        patientLastName: patientsTable.lastName,
        patientPhone: patientsTable.phone,
        patientAddress: patientsTable.address,
        patientDob: patientsTable.dateOfBirth,
        patientAgeValue: patientsTable.ageValue,
        patientAgeUnit: patientsTable.ageUnit,
        patientGender: patientsTable.gender,
        referringDoctor: doctorsTable.name,
        studyModality: radiologyStudiesTable.modality,
        studyDate: radiologyStudiesTable.studyDate,
      })
      .from(radiologyStudiesTable)
      .innerJoin(billsTable, eq(radiologyStudiesTable.billId, billsTable.id))
      .innerJoin(patientsTable, eq(billsTable.patientId, patientsTable.id))
      .leftJoin(ordersTable, eq(billsTable.orderId, ordersTable.id))
      .leftJoin(doctorsTable, eq(ordersTable.doctorId, doctorsTable.id))
      .where(
        and(
          ne(billsTable.status, "cancelled"),
          isNull(billsTable.cancelledAt),
          ne(radiologyStudiesTable.status, "cancelled"),
          // Compact YYYYMMDD and ISO both appear in study_date — compare digit forms.
          // Cast to text first: study_date is a date column; coalesce(..., '') is invalid.
          sql`regexp_replace(coalesce(${radiologyStudiesTable.studyDate}::text, ''), '[^0-9]', '', 'g') >= ${startYmd}`,
          sql`left(regexp_replace(coalesce(${radiologyStudiesTable.studyDate}::text, ''), '[^0-9]', '', 'g'), 8) <= ${endYmd}`,
        ),
      );

    const matches = candidates.filter((c) => {
      if (claimedBillIds.has(c.billId)) return false;
      const fullName = normalizeName(`${c.patientFirstName ?? ""} ${c.patientLastName ?? ""}`);
      if (fullName !== nameKey) return false;
      if (normalizeModality(c.studyModality) !== modality) return false;
      return true;
    });

    const uniqueBills = new Map<number, (typeof matches)[number]>();
    for (const m of matches) uniqueBills.set(m.billId, m);

    if (uniqueBills.size !== 1) continue;
    const only = [...uniqueBills.values()][0]!;
    claim(
      input.worklistId,
      toResolution(
        {
          ...only,
          studyAccession: null,
          studyId: null,
        },
        "singleHit",
      ),
    );
  }

  return result;
}

/** Pure helper for stamp/backfill: name-only matches are refused. */
export function isSingleHitExact(opts: {
  candidateCount: number;
  nameOnly: boolean;
}): boolean {
  if (opts.nameOnly) return false;
  return opts.candidateCount === 1;
}
