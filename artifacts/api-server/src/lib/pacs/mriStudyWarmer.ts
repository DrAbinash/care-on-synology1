/**
 * mriStudyWarmer.ts — keep recent MRI studies warm in Orthanc (and OS page cache)
 * so Reporting Workspace OHIF/DICOMweb opens faster.
 *
 * Strategy (fits existing Orthanc + ERP architecture):
 *   - Select candidates from radiology_worklist: MR modality, Today+Yesterday
 *     (IST) OR last N studies (default 20).
 *   - For each StudyInstanceUID, resolve Orthanc ID via /tools/find and walk
 *     series → instances metadata (+ first-instance preview JPEG). That pulls
 *     frames off NAS disk into Orthanc/OS cache without shipping GB into the ERP.
 *   - Runs on an interval (default 10 min) and on-demand via API.
 *   - Gated by pacs_settings `mri_warm_cache_enabled` (default ON for trial).
 *
 * Never stores pixel blobs in the ERP DB or IndexedDB — Orthanc remains the
 * source of truth; we only "touch" recent MR studies so the first open is warm.
 */

import { db } from "@workspace/db";
import { radiologyWorklistTable, pacsSettingsTable } from "@workspace/db/schema";
import { desc, eq, and, or, like, sql } from "drizzle-orm";
import { logger } from "../logger";
import { clinicPeakHoursLabel, isClinicPeakHours } from "../clinicPeakHours";

const HTTP_TIMEOUT_MS = 20_000;
const DEFAULT_INTERVAL_MS = 10 * 60_000;
const DEFAULT_LAST_N = 20;
const MAX_SERIES_PER_STUDY = 40;
const MAX_PREVIEWS_PER_STUDY = 6;

export type MriWarmMode = "today_yesterday" | "last_n";

export type MriWarmCacheStatus = {
  enabled: boolean;
  mode: MriWarmMode;
  lastN: number;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastWarmed: number;
  lastFailed: number;
  lastSkipped: number;
  lastError: string | null;
  candidates: number;
  orthancReachable: boolean | null;
  /** True 08:00–16:00 IST — automatic ticks are skipped so billing/USG C-STORE win. */
  pausedForPeakHours: boolean;
  recent: Array<{
    studyInstanceUID: string;
    patientName: string | null;
    modality: string | null;
    ok: boolean;
    series: number;
    previews: number;
    error?: string;
  }>;
};

const status: MriWarmCacheStatus = {
  enabled: true,
  mode: "today_yesterday",
  lastN: DEFAULT_LAST_N,
  running: false,
  lastRunAt: null,
  lastDurationMs: null,
  lastWarmed: 0,
  lastFailed: 0,
  lastSkipped: 0,
  lastError: null,
  candidates: 0,
  orthancReachable: null,
  pausedForPeakHours: false,
  recent: [],
};

function orthancBase(): string | null {
  const raw = process.env.ORTHANC_INTERNAL_URL || process.env.ORTHANC_URL || "http://care-orthanc:8042";
  return raw ? raw.replace(/\/+$/, "") : null;
}

function orthancHeaders(extra?: Record<string, string>): Record<string, string> {
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  const headers: Record<string, string> = { Accept: "application/json", ...(extra ?? {}) };
  if (user || pass) {
    headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

async function orthancFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = orthancBase();
  if (!base) throw new Error("Orthanc URL not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { ...orthancHeaders(init?.headers as Record<string, string> | undefined), ...(init?.headers as object) },
    });
  } finally {
    clearTimeout(t);
  }
}

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** DICOM StudyDate is often YYYYMMDD; worklist studyDate may be ISO or compact. */
function inDayWindow(studyDate: string | null | undefined, from: string, to: string): boolean {
  if (!studyDate) return false;
  const compact = studyDate.replace(/-/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(compact)) return false;
  const fromC = from.replace(/-/g, "");
  const toC = to.replace(/-/g, "");
  return compact >= fromC && compact <= toC;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, key))
      .limit(1);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function loadConfig(): Promise<{ enabled: boolean; mode: MriWarmMode; lastN: number }> {
  const [enabledRaw, modeRaw, lastNRaw] = await Promise.all([
    readSetting("mri_warm_cache_enabled"),
    readSetting("mri_warm_cache_mode"),
    readSetting("mri_warm_cache_last_n"),
  ]);
  // Trial default: enabled when unset.
  const enabled = enabledRaw !== "false" && enabledRaw !== "0";
  const mode: MriWarmMode = modeRaw === "last_n" ? "last_n" : "today_yesterday";
  const lastN = Math.min(50, Math.max(5, Number(lastNRaw) || DEFAULT_LAST_N));
  status.enabled = enabled;
  status.mode = mode;
  status.lastN = lastN;
  return { enabled, mode, lastN };
}

type Candidate = {
  studyInstanceUID: string;
  patientName: string | null;
  modality: string | null;
  studyDate: string | null;
  createdAt: Date | string | null;
};

async function listMriCandidates(mode: MriWarmMode, lastN: number): Promise<Candidate[]> {
  const rows = await db
    .select({
      studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
      patientName: radiologyWorklistTable.patientName,
      modality: radiologyWorklistTable.modality,
      studyDate: radiologyWorklistTable.studyDate,
      createdAt: radiologyWorklistTable.createdAt,
    })
    .from(radiologyWorklistTable)
    .where(
      and(
        sql`${radiologyWorklistTable.studyInstanceUID} is not null`,
        sql`${radiologyWorklistTable.studyInstanceUID} <> ''`,
        or(
          eq(radiologyWorklistTable.modality, "MR"),
          eq(radiologyWorklistTable.modality, "MRI"),
          like(radiologyWorklistTable.modality, "MR%"),
        ),
      ),
    )
    .orderBy(desc(radiologyWorklistTable.createdAt))
    .limit(200);

  const mapped: Candidate[] = rows
    .filter((r) => !!r.studyInstanceUID)
    .map((r) => ({
      studyInstanceUID: String(r.studyInstanceUID),
      patientName: r.patientName,
      modality: r.modality,
      studyDate: r.studyDate,
      createdAt: r.createdAt,
    }));

  if (mode === "last_n") {
    return mapped.slice(0, lastN);
  }

  const from = daysAgoISO(1);
  const to = todayISO();
  const windowed = mapped.filter((c) => {
    if (inDayWindow(c.studyDate, from, to)) return true;
    // Fallback: createdAt within last ~36h when studyDate missing/odd.
    if (!c.createdAt) return false;
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) && Date.now() - t < 36 * 60 * 60 * 1000;
  });
  // Cap so a busy day cannot monopolise Orthanc.
  return windowed.slice(0, Math.max(lastN, 20));
}

async function resolveOrthancStudyId(studyInstanceUID: string): Promise<string | null> {
  const resp = await orthancFetch("/tools/find", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Level: "Study",
      Query: { StudyInstanceUID: studyInstanceUID },
      Expand: false,
    }),
  });
  if (!resp.ok) return null;
  const ids = (await resp.json()) as unknown;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return String(ids[0]);
}

async function warmOneStudy(studyInstanceUID: string): Promise<{ series: number; previews: number }> {
  const orthancId = await resolveOrthancStudyId(studyInstanceUID);
  if (!orthancId) throw new Error("not in Orthanc yet");

  // Touch study metadata
  await orthancFetch(`/studies/${encodeURIComponent(orthancId)}`);

  const seriesResp = await orthancFetch(`/studies/${encodeURIComponent(orthancId)}/series`);
  if (!seriesResp.ok) throw new Error(`series list ${seriesResp.status}`);
  const seriesIds = (await seriesResp.json()) as string[];
  const limited = (Array.isArray(seriesIds) ? seriesIds : []).slice(0, MAX_SERIES_PER_STUDY);

  let previews = 0;
  for (const seriesId of limited) {
    const instResp = await orthancFetch(`/series/${encodeURIComponent(seriesId)}`);
    if (!instResp.ok) continue;
    const seriesMeta = (await instResp.json()) as { Instances?: string[] };
    const instances = seriesMeta.Instances ?? [];
    if (instances.length === 0) continue;
    // Warm first instance metadata
    const firstId = instances[0]!;
    await orthancFetch(`/instances/${encodeURIComponent(firstId)}`);
    // Preview JPEG — small, pulls pixels into cache without full DICOM payload
    if (previews < MAX_PREVIEWS_PER_STUDY) {
      try {
        const prev = await orthancFetch(`/instances/${encodeURIComponent(firstId)}/preview`, {
          headers: { Accept: "image/jpeg" },
        });
        if (prev.ok) {
          await prev.arrayBuffer();
          previews++;
        }
      } catch {
        /* preview optional */
      }
    }
  }

  return { series: limited.length, previews };
}

export function getMriWarmCacheStatus(): MriWarmCacheStatus {
  return {
    ...status,
    pausedForPeakHours: isClinicPeakHours(),
    recent: [...status.recent],
  };
}

export async function runMriWarmCache(opts?: { force?: boolean; mode?: MriWarmMode }): Promise<MriWarmCacheStatus> {
  if (status.running) return getMriWarmCacheStatus();
  // Automatic ticks yield during clinic hours so Orthanc can accept USG C-STORE
  // and Postgres can serve bill saves. "Warm now" (force) still runs.
  if (!opts?.force && isClinicPeakHours()) {
    logger.info(
      { window: clinicPeakHoursLabel() },
      "mri-warm-cache: skipped — clinic peak hours (billing / USG DICOM priority)",
    );
    return getMriWarmCacheStatus();
  }
  const cfg = await loadConfig();
  const mode = opts?.mode ?? cfg.mode;
  if (!cfg.enabled && !opts?.force) {
    status.lastError = null;
    return getMriWarmCacheStatus();
  }

  status.running = true;
  status.lastError = null;
  const started = Date.now();

  try {
    // Reachability probe
    try {
      const sys = await orthancFetch("/system");
      status.orthancReachable = sys.ok;
      if (!sys.ok) throw new Error(`Orthanc /system ${sys.status}`);
    } catch (err) {
      status.orthancReachable = false;
      status.lastError = err instanceof Error ? err.message : "Orthanc unreachable";
      status.lastRunAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - started;
      logger.warn({ err }, "mri-warm-cache: Orthanc unreachable — skip tick");
      return getMriWarmCacheStatus();
    }

    const candidates = await listMriCandidates(mode, cfg.lastN);
    status.candidates = candidates.length;
    let warmed = 0;
    let failed = 0;
    let skipped = 0;
    const recent: MriWarmCacheStatus["recent"] = [];

    for (const c of candidates) {
      try {
        const result = await warmOneStudy(c.studyInstanceUID);
        warmed++;
        recent.push({
          studyInstanceUID: c.studyInstanceUID,
          patientName: c.patientName,
          modality: c.modality,
          ok: true,
          series: result.series,
          previews: result.previews,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not in Orthanc/i.test(msg)) skipped++;
        else failed++;
        recent.push({
          studyInstanceUID: c.studyInstanceUID,
          patientName: c.patientName,
          modality: c.modality,
          ok: false,
          series: 0,
          previews: 0,
          error: msg,
        });
      }
    }

    status.lastWarmed = warmed;
    status.lastFailed = failed;
    status.lastSkipped = skipped;
    status.recent = recent.slice(0, 30);
    status.lastRunAt = new Date().toISOString();
    status.lastDurationMs = Date.now() - started;
    logger.info(
      { warmed, failed, skipped, candidates: candidates.length, mode, ms: status.lastDurationMs },
      "mri-warm-cache: tick complete",
    );
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err);
    status.lastRunAt = new Date().toISOString();
    status.lastDurationMs = Date.now() - started;
    logger.warn({ err }, "mri-warm-cache: tick failed");
  } finally {
    status.running = false;
  }

  return getMriWarmCacheStatus();
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startMriStudyWarmer(): void {
  if (process.env.MRI_WARM_CACHE === "false" || process.env.MRI_WARM_CACHE === "0") {
    logger.info("MRI study warmer disabled (MRI_WARM_CACHE=false)");
    return;
  }
  if (timer) return;
  const intervalMs = Math.max(60_000, Number(process.env.MRI_WARM_CACHE_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  // First run shortly after boot (let Orthanc come up).
  setTimeout(() => {
    void runMriWarmCache();
  }, 45_000);
  timer = setInterval(() => {
    void runMriWarmCache();
  }, intervalMs);
  logger.info({ intervalMs }, "MRI study warmer started (today+yesterday / last-N Orthanc touch)");
}
