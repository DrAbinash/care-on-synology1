/**
 * Scope MRI warm-cache / browser prefetch to Today + Yesterday (IST),
 * matching server-side mriStudyWarmer and the reading-queue default preset.
 */

import { daysAgoISO, todayISO, toISTDateStr } from "./dateRangePresets";

export function isMriModality(modality: string | null | undefined): boolean {
  const m = (modality ?? "").trim().toUpperCase();
  return m === "MR" || m === "MRI" || m.startsWith("MR");
}

export function isTodayYesterdayIst(isoTimestamp: string | null | undefined): boolean {
  if (!isoTimestamp) return false;
  const day = toISTDateStr(isoTimestamp);
  const from = daysAgoISO(1);
  const to = todayISO();
  return day >= from && day <= to;
}

export type MriWarmCandidate = {
  studyInstanceUID?: string | null;
  modality?: string | null;
  createdAt?: string | null;
  receivedAt?: string | null;
};

/** MR studies received today or yesterday (IST), with a DICOM StudyInstanceUID. */
export function filterMriTodayYesterday(rows: MriWarmCandidate[]): MriWarmCandidate[] {
  return rows.filter((row) => {
    if (!row.studyInstanceUID?.trim()) return false;
    if (!isMriModality(row.modality)) return false;
    return isTodayYesterdayIst(row.createdAt ?? row.receivedAt ?? null);
  });
}

export function mriWarmTargetsFromRows(
  rows: MriWarmCandidate[],
  dicomWebBaseUrl: string,
): Array<{ studyInstanceUID: string; dicomWebBaseUrl: string }> {
  const base = dicomWebBaseUrl.replace(/\/$/, "");
  if (!base) return [];
  return filterMriTodayYesterday(rows).map((row) => ({
    studyInstanceUID: String(row.studyInstanceUID),
    dicomWebBaseUrl: base,
  }));
}
