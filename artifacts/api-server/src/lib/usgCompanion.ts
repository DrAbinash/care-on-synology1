/**
 * usgCompanion.ts — CARE USG Companion (Phase 1) assembly logic.
 *
 * PURE, testable helpers that turn already-fetched rows (worklist entry,
 * usg_measurements, usg_doppler_measurements) into the structured summary the
 * Companion panel renders. This module builds NO new engine — it reuses the
 * existing study-type recognition (`suggestTemplate`) and the existing
 * measurement fields; it only *summarises* what the extraction pipeline already
 * produced (detected vs. missing per study type, machine, time-saved estimate).
 *
 * HARD RULE: no Measurement Engine V2 / Study Recognition V2. Everything here
 * is a read-only projection over existing data.
 */

import type { UsgMeasurement, UsgDopplerMeasurement } from "@workspace/db/schema";
import { DEFAULT_MEASUREMENT_REGISTRY } from "@workspace/measurements";
import {
  suggestTemplate,
  USG_TEMPLATES,
  type UsgTemplateId,
  type UsgTemplateDescriptor,
} from "./usgReportTemplates";

// ── Expected measurements per study type ──────────────────────────────────────
// Keyed to the *existing* usg_measurements text fields that a complete study of
// this type should carry (the same fields `autoGenerateReport` fills). Used to
// compute "measurements detected" vs "measurements missing". Types whose report
// is authored manually (scrotum/thyroid/breast) have no auto-extractable text
// fields and correctly report zero expected — the Companion still recognises the
// study, loads the template, and degrades gracefully.

export interface ExpectedMeasurement {
  /** usg_measurements text column name. */
  key: keyof UsgMeasurement & string;
  label: string;
}

const M = (key: keyof UsgMeasurement & string, label: string): ExpectedMeasurement => ({ key, label });

export const EXPECTED_MEASUREMENTS: Record<UsgTemplateId, ExpectedMeasurement[]> = {
  OB_EARLY: [M("crl", "CRL"), M("ga", "Gestational Age"), M("edd", "EDD"), M("fhr", "FHR")],
  OB_GROWTH: [
    M("bpd", "BPD"), M("hc", "HC"), M("ac", "AC"), M("fl", "FL"), M("efw", "EFW"),
    M("ga", "Gestational Age"), M("edd", "EDD"), M("fhr", "FHR"),
    M("liquorAfi", "Liquor / AFI"), M("placentaPosition", "Placenta"),
  ],
  OB_ANOMALY: [
    M("bpd", "BPD"), M("hc", "HC"), M("ac", "AC"), M("fl", "FL"), M("efw", "EFW"),
    M("ga", "Gestational Age"), M("edd", "EDD"), M("fhr", "FHR"),
  ],
  PELVIS_FEMALE: [
    M("uterusSize", "Uterus"), M("endometrium", "Endometrium"),
    M("rightOvary", "Right Ovary"), M("leftOvary", "Left Ovary"),
  ],
  WHOLE_ABDOMEN: [
    M("liverSize", "Liver"), M("gbWall", "GB Wall"), M("cbd", "CBD"),
    M("spleenSize", "Spleen"), M("rightKidney", "Right Kidney"), M("leftKidney", "Left Kidney"),
  ],
  KUB: [M("rightKidney", "Right Kidney"), M("leftKidney", "Left Kidney")],
  PROSTATE: [M("prostateVolume", "Prostate Volume")],
  SCROTUM: [],
  THYROID: [],
  BREAST: [],
  ARTERIAL_DOPPLER: [],
  VENOUS_DOPPLER: [],
  CAROTID_DOPPLER: [],
};

/** Study types whose completeness is measured by Doppler vessel rows, not text fields. */
export const DOPPLER_TEMPLATES: ReadonlySet<UsgTemplateId> = new Set<UsgTemplateId>([
  "ARTERIAL_DOPPLER", "VENOUS_DOPPLER", "CAROTID_DOPPLER",
]);

// ── Study-type recognition (reuse) ────────────────────────────────────────────

export function detectStudyType(opts: {
  modality?: string | null;
  studyDescription?: string | null;
  bodyPart?: string | null;
}): { id: UsgTemplateId; descriptor: UsgTemplateDescriptor | null } {
  const id = suggestTemplate(opts);
  return { id, descriptor: USG_TEMPLATES.find((t) => t.id === id) ?? null };
}

// ── Measurement summary ───────────────────────────────────────────────────────

export interface MeasurementItem {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  confidence: string;            // high | medium | low
  source: string;                // dicom_sr | ocr | combined | manual | GE_PRIVATE_TAG ...
  present: boolean;
  /**
   * Canonical id from the Universal Measurement Registry (e.g. "CBD") when
   * the usg_measurements column resolves. Downstream logic (Copilot modules,
   * follow-up suggestions, Quality Engine Phase 4) keys on this — never on
   * the display label.
   */
  measurementId?: string;
}

export interface DopplerSummary {
  vesselCount: number;
  present: boolean;
}

export interface MeasurementSummary {
  measurementRowId: number | null;
  overallConfidence: string | null;
  status: string | null;         // pending_review | approved | rejected
  expectedCount: number;
  foundCount: number;
  missingCount: number;
  items: MeasurementItem[];
  missing: { key: string; label: string; measurementId?: string }[];
  extras: MeasurementItem[];     // measurements found beyond the expected checklist
  doppler: DopplerSummary;
}

function nonEmpty(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Per-field source from provenanceJson (sourceType), falling back to row.source. */
function provenanceSource(provenance: Record<string, unknown> | null, key: string, fallback: string): string {
  const p = provenance?.[key];
  if (p && typeof p === "object" && "sourceType" in (p as Record<string, unknown>)) {
    const st = (p as Record<string, unknown>).sourceType;
    if (typeof st === "string" && st) return st;
  }
  return fallback;
}

function safeParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Summarise a study's measurements against its expected checklist.
 * @param measurement latest usg_measurements row (or null if none extracted)
 * @param doppler     usg_doppler_measurements rows for the study
 */
export function summarizeMeasurements(
  templateId: UsgTemplateId,
  measurement: UsgMeasurement | null,
  doppler: UsgDopplerMeasurement[],
): MeasurementSummary {
  const expected = EXPECTED_MEASUREMENTS[templateId] ?? [];
  const provenance = safeParse(measurement?.provenanceJson);
  const extras = safeParse(measurement?.extraMeasurementsJson);
  const rowConfidence = measurement?.overallConfidence ?? "low";
  const rowSource = measurement?.source ?? "manual";

  const items: MeasurementItem[] = [];
  const missing: { key: string; label: string; measurementId?: string }[] = [];

  for (const exp of expected) {
    const raw = measurement ? (measurement as Record<string, unknown>)[exp.key] : null;
    const present = nonEmpty(raw);
    const confKey = `${exp.key}Confidence`;
    const conf = measurement && nonEmpty((measurement as Record<string, unknown>)[confKey])
      ? String((measurement as Record<string, unknown>)[confKey])
      : rowConfidence;
    // Resolve the usg_measurements column to its canonical registry identity
    // (additive — items without a registry entry simply carry no id).
    const measurementId = DEFAULT_MEASUREMENT_REGISTRY.resolveByColumn(exp.key)?.id;
    items.push({
      key: exp.key,
      label: exp.label,
      value: present ? String(raw) : "",
      unit: null,
      confidence: conf,
      source: provenanceSource(provenance, exp.key, rowSource),
      present,
      ...(measurementId ? { measurementId } : {}),
    });
    if (!present) missing.push({ key: exp.key, label: exp.label, ...(measurementId ? { measurementId } : {}) });
  }

  // Extra measurements captured beyond the checklist (extraMeasurementsJson).
  const extraItems: MeasurementItem[] = Object.entries(extras)
    .filter(([, v]) => nonEmpty(v))
    .map(([k, v]) => ({
      key: `extra:${k}`,
      label: k,
      value: String(v),
      unit: null,
      confidence: rowConfidence,
      source: rowSource,
      present: true,
    }));

  const dopplerRows = (doppler ?? []).filter((d) => d.status !== "rejected");
  const dopplerSummary: DopplerSummary = { vesselCount: dopplerRows.length, present: dopplerRows.length > 0 };

  const foundExpected = items.filter((i) => i.present).length;
  const isDoppler = DOPPLER_TEMPLATES.has(templateId);

  // For Doppler studies, "found" = vessels present; expected = at least 1 vessel.
  const expectedCount = isDoppler ? 1 : expected.length;
  const foundCount = isDoppler ? (dopplerSummary.present ? 1 : 0) : foundExpected;
  const missingCount = Math.max(0, expectedCount - foundCount);

  return {
    measurementRowId: measurement?.id ?? null,
    overallConfidence: measurement?.overallConfidence ?? null,
    status: measurement?.status ?? null,
    expectedCount,
    foundCount,
    missingCount,
    items,
    missing: isDoppler ? (dopplerSummary.present ? [] : [{ key: "doppler", label: "Doppler vessels" }]) : missing,
    extras: extraItems,
    doppler: dopplerSummary,
  };
}

// ── Machine identification (from DICOM tags / measurement columns) ─────────────

export interface MachineInfo {
  manufacturer: string | null;
  model: string | null;
  station: string | null;
  institution: string | null;
  isVoluson: boolean;
}

/** Read a DICOM tag from an Orthanc/DICOM-JSON metadata blob, tolerant of shapes. */
function dicomTag(meta: Record<string, unknown>, tag: string, ...namedKeys: string[]): string | null {
  const candidates: unknown[] = [meta[tag]];
  const main = meta.MainDicomTags;
  if (main && typeof main === "object") {
    for (const nk of namedKeys) candidates.push((main as Record<string, unknown>)[nk]);
  }
  for (const nk of namedKeys) candidates.push(meta[nk]);
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "object") {
      const v = (c as Record<string, unknown>).Value;
      if (Array.isArray(v) && v.length && v[0] != null && String(v[0]).trim()) return String(v[0]).trim();
    }
  }
  return null;
}

export function extractMachine(
  measurement: UsgMeasurement | null,
  dicomMetadataJson: string | null | undefined,
): MachineInfo {
  const meta = safeParse(dicomMetadataJson);
  const manufacturer = (measurement?.manufacturer && measurement.manufacturer.trim())
    || dicomTag(meta, "00080070", "Manufacturer");
  const model = (measurement?.manufacturerModel && measurement.manufacturerModel.trim())
    || dicomTag(meta, "00081090", "ManufacturerModelName");
  const station = dicomTag(meta, "00081010", "StationName");
  const institution = (measurement?.institutionName && measurement.institutionName.trim())
    || dicomTag(meta, "00080080", "InstitutionName");
  const hay = `${manufacturer ?? ""} ${model ?? ""} ${station ?? ""}`.toLowerCase();
  return {
    manufacturer: manufacturer ?? null,
    model: model ?? null,
    station: station ?? null,
    institution: institution ?? null,
    isVoluson: /voluson|ge\s*healthcare|ge\s*medical/.test(hay),
  };
}

// ── Time-saved estimate ───────────────────────────────────────────────────────
// Conservative estimate of manual keystroke time avoided by importing machine
// measurements instead of typing them. Pure workflow arithmetic — not a claim
// about clinical value.
export const SECONDS_SAVED_PER_MEASUREMENT = 18;

export function estimateTimeSavedSeconds(importedCount: number): number {
  return Math.max(0, Math.round(importedCount)) * SECONDS_SAVED_PER_MEASUREMENT;
}
