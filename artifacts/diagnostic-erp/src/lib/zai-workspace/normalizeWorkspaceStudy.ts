/**
 * Normalize flat pacs-worklist / QueueStudy rows into the Z.ai Study shape
 * (nested `patient`). Raw API rows have `patientName` / `patientId` at the
 * top level — dumping them into the store makes WorklistStrip crash on
 * `s.patient.id` ("Cannot read properties of undefined (reading 'id')").
 */

import type { Modality, Patient, Priority, Study, StudyStatus } from "./types";

const MODALITIES = new Set<string>([
  "XR", "CT", "MR", "US", "MG", "DX", "NM", "PT", "DOPPLER", "ECHO", "USG_OB",
]);
const PRIORITIES = new Set<string>(["stat", "urgent", "routine", "vip"]);
const SEXES = new Set<string>(["M", "F", "O"]);

function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asModality(v: unknown): Modality {
  const m = asString(v, "XR").toUpperCase();
  if (MODALITIES.has(m)) return m as Modality;
  if (m.startsWith("MR")) return "MR";
  if (m.startsWith("CT")) return "CT";
  if (m.startsWith("US") || m === "ULTRASOUND") return "US";
  return "XR";
}

function asPriority(v: unknown): Priority {
  const p = asString(v, "routine").toLowerCase();
  return (PRIORITIES.has(p) ? p : "routine") as Priority;
}

function asSex(v: unknown): Patient["sex"] {
  const s = asString(v, "O").toUpperCase().slice(0, 1);
  return (SEXES.has(s) ? s : "O") as Patient["sex"];
}

function asStatus(v: unknown): StudyStatus {
  const s = asString(v, "received").toLowerCase();
  const allowed: StudyStatus[] = ["received", "in_progress", "draft", "prelim", "final", "amended"];
  return (allowed.includes(s as StudyStatus) ? s : "received") as StudyStatus;
}

/** Accepts nested Study, flat QueueStudy / pacs-worklist row, or nullish junk. */
export function normalizeWorkspaceStudy(raw: unknown): Study | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = r.id ?? r.worklistId;
  if (id == null || id === "") return null;

  const nested =
    r.patient && typeof r.patient === "object"
      ? (r.patient as Record<string, unknown>)
      : null;

  const patientId = nested?.id ?? r.patientId ?? 0;
  const patient: Patient = {
    id: asString(patientId, "0"),
    name: asString(nested?.name ?? r.patientName, "Unknown"),
    age: asNumber(nested?.age ?? r.patientAge, 0),
    sex: asSex(nested?.sex ?? r.patientSex),
    uhid: asString(nested?.uhid ?? r.uhid ?? r.patientId, ""),
    phone: nested?.phone != null || r.patientPhone != null
      ? asString(nested?.phone ?? r.patientPhone)
      : undefined,
    referringDoctor: asString(
      nested?.referringDoctor ?? r.referringDoctor ?? r.referringPhysician,
      "",
    ),
  };

  return {
    id: asString(id),
    accession: asString(r.accession ?? r.accessionNumber),
    studyInstanceUID: asString(r.studyInstanceUID ?? r.StudyInstanceUID),
    patient,
    modality: asModality(r.modality),
    bodyPart: asString(r.bodyPart),
    studyDescription: asString(r.studyDescription),
    clinicalHistory: asString(r.clinicalHistory),
    status: asStatus(r.status),
    priority: asPriority(r.priority),
    receivedAt: asString(r.receivedAt ?? r.createdAt),
    lockedBy: r.lockedBy != null || r.lockUserName != null
      ? asString(r.lockedBy ?? r.lockUserName)
      : undefined,
    lockExpiresAt: r.lockExpiresAt != null ? asString(r.lockExpiresAt) : undefined,
    priorCount: asNumber(r.priorCount, 0),
    criticalFlag: Boolean(r.criticalFlag),
    aiDraftReady: Boolean(r.aiDraftReady),
    tatMinutes: asNumber(r.tatMinutes, 0),
    slaMinutes: asNumber(r.slaMinutes, 240),
    series: asNumber(r.series, 0),
    images: asNumber(r.images, 0),
  };
}

export function normalizeWorkspaceStudies(raw: unknown): Study[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { studies?: unknown }).studies)
      ? (raw as { studies: unknown[] }).studies
      : [];
  const out: Study[] = [];
  for (const row of list) {
    const study = normalizeWorkspaceStudy(row);
    if (study) out.push(study);
  }
  return out;
}
