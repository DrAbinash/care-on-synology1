/**
 * orthancChangesPoller.ts — Orthanc → ERP study auto-push (the missing link).
 *
 * The deployed PACS is Orthanc (PACS_PROVIDER=orthanc, care-orthanc:8042).
 * Previously there was NO mechanism to make a study appear in the ERP worklist
 * when Orthanc received it — the only auto-push hook that existed
 * (conquest/erp_notify.lua) is Conquest-specific and, additionally, skips
 * objects with no AccessionNumber, which drops the OB Structured Reports GE
 * ultrasound machines (Voluson E9) emit. See
 * Antigravity/08_PACS_DICOM/PACS_CURRENT_STATE_REPORT.md item 3 ("Orthanc → ERP
 * Sync — BROKEN").
 *
 * This closes that gap entirely inside the ERP — no change to the Orthanc
 * container config is required (an Orthanc-side OnStoredInstance webhook is a
 * possible lower-latency add-on, but this poller is the reliable baseline the
 * report explicitly lists as the alternative). It polls Orthanc's /changes
 * feed, and for every study that becomes Stable it forwards the study metadata
 * to the SAME, already-tested intake endpoint the Conquest hook targets
 * (POST /api/internal/radiology/studies). That endpoint upserts on
 * StudyInstanceUID, matches the study to a patient/bill, and — for ultrasound
 * studies — runs the USG auto-measurement extractor.
 *
 * Voluson E9 (GE) — "extract similarly":
 *   The intake endpoint already feeds ultrasound studies through
 *   lib/usgExtractor.ts, whose first (highest-confidence) path parses the DICOM
 *   Structured Report for fetal biometry (BPD/HC/AC/FL/EFW/…). All this poller
 *   has to do is ATTACH that SR to the intake payload. For ultrasound studies
 *   it fetches the study's SR instance via Orthanc DICOMweb metadata (the same
 *   DICOM-JSON model usgExtractor.parseDicomSr expects) and passes it as
 *   `dicomMetadata`. A Voluson study therefore lands with its measurements
 *   already extracted (pending radiologist review — never auto-finalized).
 *
 * Safety / idempotency:
 *   - Study intake is idempotent (upsert on StudyInstanceUID), so re-processing
 *     a change is harmless.
 *   - The last-processed /changes sequence number is persisted in pacs_settings
 *     so a restart resumes instead of re-scanning the whole PACS.
 *   - Gated to PACS_PROVIDER=orthanc and requires INTERNAL_API_KEY (the intake
 *     endpoint's server-to-server credential); disabled with a clear log line
 *     otherwise. Never throws out of the tick — a bad study or an Orthanc blip
 *     is logged and the loop continues.
 */

import { db } from "@workspace/db";
import { pacsSettingsTable, pacsLogsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";
import { isUltrasoundModality } from "../usgModality";

const CURSOR_KEY = "orthanc_changes_cursor";
const CURSOR_CATEGORY = "orthanc";
const HTTP_TIMEOUT_MS = 15_000;
// Bound the number of /changes pages drained per tick so a first run against a
// PACS with a long history can't monopolise the event loop — the cursor is
// saved after every page, so the remainder is picked up on the next tick.
const MAX_PAGES_PER_TICK = 50;

// ── Orthanc connection ────────────────────────────────────────────────────────

function orthancBase(): string | null {
  const raw = process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "http://care-orthanc:8042";
  return raw ? raw.replace(/\/+$/, "") : null;
}

function orthancHeaders(): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (user || pass) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

async function orthancGet<T>(base: string, path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}${path}`, { headers: orthancHeaders(), signal: controller.signal });
    if (!resp.ok) {
      logger.warn({ path, status: resp.status }, "orthanc-poller: GET non-2xx");
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    logger.warn({ err, path }, "orthanc-poller: GET failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Cursor persistence (pacs_settings k/v) ────────────────────────────────────

async function loadCursor(): Promise<number> {
  const [row] = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, CURSOR_KEY), eq(pacsSettingsTable.category, CURSOR_CATEGORY)))
    .limit(1);
  const n = row?.value ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function saveCursor(seq: number): Promise<void> {
  const [row] = await db
    .select({ id: pacsSettingsTable.id })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, CURSOR_KEY), eq(pacsSettingsTable.category, CURSOR_CATEGORY)))
    .limit(1);
  if (row) {
    await db.update(pacsSettingsTable).set({ value: String(seq) }).where(eq(pacsSettingsTable.id, row.id));
  } else {
    await db.insert(pacsSettingsTable).values({ key: CURSOR_KEY, value: String(seq), category: CURSOR_CATEGORY });
  }
}

async function logPacsEvent(
  severity: "info" | "warn" | "error",
  eventType: string,
  message: string,
  fields: { studyInstanceUid?: string | null; accessionNumber?: string | null; patientId?: string | null; modality?: string | null } = {},
): Promise<void> {
  try {
    await db.insert(pacsLogsTable).values({
      logType: "sync",
      severity,
      source: "orthanc-poller",
      eventType,
      message,
      studyInstanceUid: fields.studyInstanceUid ?? null,
      accessionNumber: fields.accessionNumber ?? null,
      patientId: fields.patientId ?? null,
      modality: fields.modality ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "orthanc-poller: failed to write pacs_log");
  }
}

// ── DICOM helpers ─────────────────────────────────────────────────────────────

// DICOM PN "Last^First^Middle^Prefix^Suffix" → readable "Last First Middle".
function normalizePersonName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\^+/g, " ").replace(/\s+/g, " ").trim();
}

// ModalitiesInStudy can be a single value ("US") or a multi-value string
// ("US\\SR"). Prefer the imaging modality over report/presentation objects so
// a USG study with an attached SR is classified as "US", not "SR".
function pickPrimaryModality(raw: string | null | undefined): string {
  const parts = (raw ?? "")
    .split(/[\\,]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const nonReport = parts.find((m) => !["SR", "PR", "KO", "DOC", "OT"].includes(m));
  return nonReport ?? parts[0];
}

interface OrthancStudy {
  MainDicomTags?: Record<string, string>;
  PatientMainDicomTags?: Record<string, string>;
  Series?: string[];
}

// Orthanc's /studies/{id} does not always carry the study-level
// ModalitiesInStudy tag. When it's missing (or only resolves to a report/other
// object), fall back to reading series-level Modality so ultrasound studies are
// still recognised and routed to the USG extractor. Capped and short-circuited
// so a large multi-series CT doesn't fan out into many requests.
async function resolveModality(base: string, study: OrthancStudy): Promise<string> {
  const fromStudy = pickPrimaryModality(study.MainDicomTags?.ModalitiesInStudy ?? study.MainDicomTags?.Modality);
  if (fromStudy && fromStudy !== "OT") return fromStudy;

  const seriesIds = (study.Series ?? []).slice(0, 8);
  const mods: string[] = [];
  for (const sid of seriesIds) {
    const series = await orthancGet<{ MainDicomTags?: { Modality?: string } }>(base, `/series/${encodeURIComponent(sid)}`);
    const m = (series?.MainDicomTags?.Modality ?? "").trim().toUpperCase();
    if (!m) continue;
    mods.push(m);
    if (!["SR", "PR", "KO", "DOC", "OT"].includes(m)) break; // found an imaging modality
  }
  return pickPrimaryModality(mods.join("\\")) || fromStudy || "OT";
}

// Fetch the study's SR instance metadata in the DICOM JSON model
// (usgExtractor.parseDicomSr consumes exactly this shape: tag keys like
// "0040A730", values shaped { vr, Value }). Returns null if the study has no SR
// or DICOMweb is unavailable — intake then falls back to the OCR path.
async function fetchSrMetadata(base: string, studyInstanceUID: string): Promise<Record<string, unknown> | null> {
  const arr = await orthancGet<Array<Record<string, unknown>>>(
    base,
    `/dicom-web/studies/${encodeURIComponent(studyInstanceUID)}/metadata`,
  );
  if (!Array.isArray(arr)) return null;
  // (0008,0060) Modality === "SR"
  const sr = arr.find((o) => {
    const modality = (o?.["00080060"] as { Value?: string[] } | undefined)?.Value?.[0];
    return typeof modality === "string" && modality.toUpperCase() === "SR";
  });
  return sr ?? null;
}

// ── Study intake (self-call to the existing, tested endpoint) ─────────────────

async function postIntake(payload: Record<string, unknown>, port: number): Promise<boolean> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/internal/radiology/studies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ status: resp.status, body: text.slice(0, 300) }, "orthanc-poller: intake POST non-2xx");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "orthanc-poller: intake POST failed");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ingestStudy(base: string, orthancStudyId: string, port: number): Promise<void> {
  const study = await orthancGet<OrthancStudy>(base, `/studies/${encodeURIComponent(orthancStudyId)}`);
  if (!study) return;
  const tags = study.MainDicomTags ?? {};
  const patientTags = study.PatientMainDicomTags ?? {};

  const studyInstanceUID = (tags.StudyInstanceUID ?? "").trim();
  if (!studyInstanceUID) {
    logger.warn({ orthancStudyId }, "orthanc-poller: study has no StudyInstanceUID — skipping");
    return;
  }

  const modalityRaw = tags.ModalitiesInStudy ?? tags.Modality ?? "";
  const modality = await resolveModality(base, study);

  const payload: Record<string, unknown> = {
    patientId: (patientTags.PatientID ?? "").trim(),
    patientName: normalizePersonName(patientTags.PatientName) || "UNKNOWN",
    accessionNumber: (tags.AccessionNumber ?? "").trim(),
    studyInstanceUID,
    modality,
    studyDescription: (tags.StudyDescription ?? "").trim(),
    studyDate: (tags.StudyDate ?? "").trim(),
    referringDoctor: normalizePersonName(tags.ReferringPhysicianName),
    sex: (patientTags.PatientSex ?? "").trim() || undefined,
    aeTitle: "ORTHANC",
    sourcePacs: "ORTHANC",
  };

  // For ultrasound studies (incl. GE Voluson E9), attach the SR so the intake
  // endpoint's USG extractor can pull fetal biometry / Doppler measurements.
  if (isUltrasoundModality(modality) || /US/i.test(modalityRaw)) {
    const sr = await fetchSrMetadata(base, studyInstanceUID);
    if (sr) payload.dicomMetadata = JSON.stringify(sr);
  }

  const ok = await postIntake(payload, port);
  await logPacsEvent(
    ok ? "info" : "warn",
    ok ? "study_auto_push" : "study_auto_push_failed",
    ok ? `Study auto-pushed from Orthanc (${modality})` : "Study intake rejected the auto-pushed study",
    { studyInstanceUid: studyInstanceUID, accessionNumber: payload.accessionNumber as string, patientId: payload.patientId as string, modality },
  );
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

interface OrthancChangesPage {
  Changes?: Array<{ ChangeType?: string; ID?: string; Seq?: number }>;
  Done?: boolean;
  Last?: number;
}

async function pollOnce(port: number): Promise<void> {
  const base = orthancBase();
  if (!base) return;

  let since = await loadCursor();
  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const body = await orthancGet<OrthancChangesPage>(base, `/changes?since=${since}&limit=100`);
    if (!body || !Array.isArray(body.Changes)) return; // Orthanc unreachable this tick — retry next tick

    for (const change of body.Changes) {
      // "StableStudy" fires once a study has finished receiving (no new
      // instances for the stabilisation window), so we intake a complete study
      // rather than a partial one on the first image.
      if (change.ChangeType === "StableStudy" && change.ID) {
        try {
          await ingestStudy(base, change.ID, port);
        } catch (err) {
          logger.warn({ err, id: change.ID }, "orthanc-poller: ingestStudy failed");
        }
      }
    }

    if (typeof body.Last === "number") {
      since = body.Last;
      await saveCursor(since);
    }
    if (body.Done) break;
  }
}

// ── Public: ingest one Orthanc study on demand ───────────────────────────────
//
// Used by the Orthanc-side OnStoredInstance webhook (POST
// /api/internal/radiology/orthanc-webhook) for near-instant push — the poller
// remains the reliable safety net, this is the low-latency fast path. Resolves
// the Orthanc base and the API port itself so callers need no wiring.
export async function ingestOrthancStudyId(orthancStudyId: string): Promise<boolean> {
  const base = orthancBase();
  if (!base || !orthancStudyId) return false;
  const port = Number(process.env.PORT) || 8080;
  try {
    await ingestStudy(base, orthancStudyId, port);
    return true;
  } catch (err) {
    logger.warn({ err, orthancStudyId }, "orthanc-poller: on-demand ingest failed");
    return false;
  }
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

let ticking = false;

export function startOrthancChangesPoller(port: number): void {
  if (process.env.PACS_PROVIDER && process.env.PACS_PROVIDER.toLowerCase() !== "orthanc") {
    logger.info({ provider: process.env.PACS_PROVIDER }, "Orthanc changes poller disabled (PACS_PROVIDER is not orthanc)");
    return;
  }
  if (process.env.ORTHANC_CHANGES_POLLER === "false" || process.env.ORTHANC_CHANGES_POLLER === "0") {
    logger.info("Orthanc changes poller disabled (ORTHANC_CHANGES_POLLER set to false)");
    return;
  }
  if (!process.env.INTERNAL_API_KEY) {
    logger.warn("Orthanc changes poller NOT started — INTERNAL_API_KEY is not set (study auto-push needs it to reach the intake endpoint)");
    return;
  }

  const intervalMs = Math.max(5_000, Number(process.env.ORTHANC_POLL_INTERVAL_MS) || 20_000);

  const tick = async () => {
    if (ticking) return; // never overlap runs
    ticking = true;
    try {
      await pollOnce(port);
    } catch (err) {
      logger.warn({ err }, "Orthanc poll tick failed");
    } finally {
      ticking = false;
    }
  };

  // First sweep shortly after boot (lets migrations settle), then on interval.
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, intervalMs).unref?.();
  logger.info({ intervalMs }, "Orthanc → ERP study auto-push poller started");
}
