/**
 * Resolve DICOM (0040,0001) ScheduledStationAETitle for MWL publication.
 *
 * Priority (configuration-driven — never hard-codes a scanner AE):
 *   1. Explicit value already on the study / bill payload
 *   2. Optional per-test default from pacs_settings `mwl_test_defaults`
 *   3. Unique active `dicom_modalities` row for the study modality
 *      (autoCreateWorklist + non-empty aeTitle)
 *
 * Deliberate unconfigured behavior:
 *   Returns aeTitle=null with a reason. Callers must NOT invent "ANY" or
 *   silently assign a global scanner — Orthanc treats literal "ANY" as a
 *   string that does not match a modality querying for its own AE (e.g. UIH).
 */

import { db } from "@workspace/db";
import { dicomModalitiesTable, pacsSettingsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";

export type StationAeResolveSource =
  | "explicit"
  | "test_default"
  | "modality_registry"
  | "unconfigured";

export type StationAeResolveReason =
  | "ok"
  | "missing_modality"
  | "no_active_station"
  | "ambiguous_stations"
  | "empty_ae_title";

export type StationAeResolution = {
  aeTitle: string | null;
  source: StationAeResolveSource;
  reason: StationAeResolveReason;
  machineName?: string | null;
  detail?: string;
};

function normalizeAe(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  // Historical dump fallback — treat as unset so we can resolve from config.
  if (t.toUpperCase() === "ANY") return null;
  return t;
}

function normalizeModality(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return t || null;
}

type TestDefaultsMap = Record<string, { bodyPart?: string; stationAE?: string }>;

async function loadMwlTestDefaults(): Promise<TestDefaultsMap> {
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(and(eq(pacsSettingsTable.category, "mwl"), eq(pacsSettingsTable.key, "mwl_test_defaults")))
      .limit(1);
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as TestDefaultsMap) : {};
  } catch {
    return {};
  }
}

/**
 * Pure resolver over an in-memory modality list — used by unit tests and the
 * DB-backed wrapper below.
 */
export function resolveStationAeFromCandidates(opts: {
  modality: string | null | undefined;
  explicitAeTitle?: string | null;
  testId?: number | null;
  testDefaults?: TestDefaultsMap;
  modalities: Array<{
    modality: string | null;
    aeTitle: string | null;
    machineName: string;
    isActive: boolean;
    autoCreateWorklist: boolean;
  }>;
}): StationAeResolution {
  const explicit = normalizeAe(opts.explicitAeTitle);
  if (explicit) {
    return { aeTitle: explicit, source: "explicit", reason: "ok" };
  }

  if (opts.testId != null && opts.testDefaults) {
    const def = opts.testDefaults[String(opts.testId)];
    const fromTest = normalizeAe(def?.stationAE);
    if (fromTest) {
      return { aeTitle: fromTest, source: "test_default", reason: "ok" };
    }
  }

  const modality = normalizeModality(opts.modality);
  if (!modality) {
    return {
      aeTitle: null,
      source: "unconfigured",
      reason: "missing_modality",
      detail: "Study has no DICOM modality code; cannot map to a station AE",
    };
  }

  const candidates = opts.modalities.filter((m) => {
    if (!m.isActive || !m.autoCreateWorklist) return false;
    return normalizeModality(m.modality) === modality && !!normalizeAe(m.aeTitle);
  });

  if (candidates.length === 0) {
    return {
      aeTitle: null,
      source: "unconfigured",
      reason: "no_active_station",
      detail: `No active dicom_modalities row with autoCreateWorklist for modality ${modality}`,
    };
  }

  const uniqueAes = [
    ...new Set(candidates.map((c) => normalizeAe(c.aeTitle)!)),
  ];
  // Case-insensitive uniqueness: UIH vs uih is one station AE.
  const uniqueLower = [...new Set(uniqueAes.map((a) => a.toUpperCase()))];
  if (uniqueLower.length > 1) {
    return {
      aeTitle: null,
      source: "unconfigured",
      reason: "ambiguous_stations",
      detail: `Multiple stations for ${modality}: ${candidates
        .map((c) => `${c.machineName}=${normalizeAe(c.aeTitle)}`)
        .join(", ")}. Set an explicit station AE or deactivate extras.`,
    };
  }

  const chosen = candidates[0]!;
  const ae = normalizeAe(chosen.aeTitle);
  if (!ae) {
    return {
      aeTitle: null,
      source: "unconfigured",
      reason: "empty_ae_title",
      detail: `Station ${chosen.machineName} has empty AE title`,
    };
  }

  return {
    aeTitle: ae,
    source: "modality_registry",
    reason: "ok",
    machineName: chosen.machineName,
  };
}

/** DB-backed resolution for publish / sync paths. */
export async function resolveScheduledStationAeTitle(opts: {
  modality: string | null | undefined;
  explicitAeTitle?: string | null;
  testId?: number | null;
}): Promise<StationAeResolution> {
  const explicit = normalizeAe(opts.explicitAeTitle);
  if (explicit) {
    return { aeTitle: explicit, source: "explicit", reason: "ok" };
  }

  let testDefaults: TestDefaultsMap = {};
  if (opts.testId != null) {
    testDefaults = await loadMwlTestDefaults();
  }

  const modalities = await db
    .select({
      modality: dicomModalitiesTable.modality,
      aeTitle: dicomModalitiesTable.aeTitle,
      machineName: dicomModalitiesTable.machineName,
      isActive: dicomModalitiesTable.isActive,
      autoCreateWorklist: dicomModalitiesTable.autoCreateWorklist,
    })
    .from(dicomModalitiesTable);

  const result = resolveStationAeFromCandidates({
    modality: opts.modality,
    explicitAeTitle: opts.explicitAeTitle,
    testId: opts.testId,
    testDefaults,
    modalities,
  });

  if (result.source === "unconfigured") {
    logger.warn(
      {
        modality: opts.modality,
        testId: opts.testId,
        reason: result.reason,
        detail: result.detail,
      },
      "mwl: ScheduledStationAETitle unconfigured — refusing literal ANY; configure Modalities (station AE) or set an explicit study station AE",
    );
  }

  return result;
}
