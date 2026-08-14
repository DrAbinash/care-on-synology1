/**
 * Catalogue seed CSVs for the pendrive ultra-emergency stick.
 * These are NOT CARE bill-import files (`CARE_EMERGENCY_BILLING_V1`).
 */
import type { MasterDataSnapshot } from "./types";
import { MASTER_FORMAT } from "./types";
import { csvCell, parseCsvLine } from "./csv";

export const SEED_TESTS_COLUMNS = ["id", "code", "name", "category", "price", "is_active"] as const;
export const SEED_DOCTORS_COLUMNS = ["id", "name", "specialization"] as const;

export type SeedTestRow = MasterDataSnapshot["services"][number];
export type SeedDoctorRow = MasterDataSnapshot["doctors"][number];

function headerOk(header: string[], expected: readonly string[]): boolean {
  return expected.every((name) => header.includes(name));
}

export function serializeTestsSeedCsv(services: SeedTestRow[]): string {
  const header = SEED_TESTS_COLUMNS.join(",");
  const rows = services.map((s) =>
    [
      csvCell(s.id),
      csvCell(s.code),
      csvCell(s.name),
      csvCell(s.category),
      csvCell(Number(s.price).toFixed(2)),
      csvCell(s.isActive === false ? "false" : "true"),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function serializeDoctorsSeedCsv(doctors: SeedDoctorRow[]): string {
  const header = SEED_DOCTORS_COLUMNS.join(",");
  const rows = doctors.map((d) => [csvCell(d.id), csvCell(d.name), csvCell(d.specialization)].join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function parseTestsSeedCsv(raw: string): { tests: SeedTestRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { tests: [], errors: ["tests.csv has no data rows"] };
  const header = parseCsvLine(lines[0]!);
  if (!headerOk(header, SEED_TESTS_COLUMNS)) {
    return { tests: [], errors: ["tests.csv is missing required columns id,code,name,category,price,is_active"] };
  }
  const idx = (name: string) => header.indexOf(name);
  const tests: SeedTestRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const get = (name: string) => cols[idx(name)] ?? "";
    const id = Number(get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      errors.push(`tests.csv row ${i + 1}: invalid id`);
      continue;
    }
    const name = get("name").trim();
    if (!name) {
      errors.push(`tests.csv row ${i + 1}: name is required`);
      continue;
    }
    tests.push({
      id,
      code: get("code").trim(),
      name,
      category: get("category").trim(),
      price: Number(get("price") || 0),
      isActive: get("is_active").trim().toLowerCase() !== "false",
    });
  }
  return { tests, errors };
}

export function parseDoctorsSeedCsv(raw: string): { doctors: SeedDoctorRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { doctors: [], errors: ["doctors.csv has no data rows"] };
  const header = parseCsvLine(lines[0]!);
  if (!headerOk(header, SEED_DOCTORS_COLUMNS)) {
    return { doctors: [], errors: ["doctors.csv is missing required columns id,name,specialization"] };
  }
  const idx = (name: string) => header.indexOf(name);
  const doctors: SeedDoctorRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const get = (name: string) => cols[idx(name)] ?? "";
    const id = Number(get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      errors.push(`doctors.csv row ${i + 1}: invalid id`);
      continue;
    }
    const name = get("name").trim();
    if (!name) {
      errors.push(`doctors.csv row ${i + 1}: name is required`);
      continue;
    }
    doctors.push({
      id,
      name,
      specialization: get("specialization").trim(),
    });
  }
  return { doctors, errors };
}

export function usbSeedReadme(snapshot: Pick<MasterDataSnapshot, "syncedAt" | "services" | "doctors">): string {
  return [
    "CARE ultra-emergency USB seed",
    "",
    "This zip is a catalogue snapshot for the pendrive billing stick.",
    "It is NOT a bill import. Do not upload these files to Settings → Emergency Billing → CSV.",
    `CARE bill import remains ${"CARE_EMERGENCY_BILLING_V1"} (EMG receipts from the stick).`,
    "",
    `Master format: ${MASTER_FORMAT}`,
    `Snapshot time (UTC): ${snapshot.syncedAt}`,
    `Tests: ${snapshot.services.length}`,
    `Doctors: ${snapshot.doctors.length}`,
    "",
    "Copy onto the stick as:",
    "  CARE-ULTRA-EMERGENCY/data/seed/tests.csv",
    "  CARE-ULTRA-EMERGENCY/data/seed/doctors.csv",
    "  CARE-ULTRA-EMERGENCY/data/seed/CARE_EMERGENCY_MASTER_V1.json",
    "",
    "Contains patient names and staff PIN hashes in the JSON. Keep the stick locked.",
    "Refresh after tariff or doctor changes. Super admin login only.",
    "",
  ].join("\n");
}
