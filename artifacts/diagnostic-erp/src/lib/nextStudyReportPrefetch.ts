/**
 * Warm the next Reading Queue study's report shell (drafts / measurements /
 * priors) while the radiologist is still on the current case — so Next feels
 * instant. Does NOT kick off AI draft generation (that stays on the 80% path).
 */
import { api } from "@/lib/fetchApi";

export type NextStudyReportPrefetchTarget = {
  id: string | number;
  patientId?: string | number | null;
  studyInstanceUID?: string | null;
  modality?: string | null;
};

export function nextStudyDraftsUrl(studyId: string | number): string {
  return `/api/radiology/report-generator/drafts?studyId=${encodeURIComponent(String(studyId))}`;
}

export function nextStudyMeasurementsUrl(studyId: string | number): string {
  return `/api/radiology/report-generator/measurements?studyId=${encodeURIComponent(String(studyId))}`;
}

export function nextStudyPriorsUrl(patientId: string | number): string | null {
  const id = String(patientId).trim();
  if (!id || id === "0") return null;
  return `/api/radiology-copilot/prior-studies?patientId=${encodeURIComponent(id)}`;
}

/** Fire-and-forget HTTP warm for the next eligible queue row. */
export function prefetchNextStudyReportShell(
  target: NextStudyReportPrefetchTarget | null | undefined,
): Promise<void> {
  if (!target?.id && target?.id !== 0) return Promise.resolve();
  const priorUrl = target.patientId != null ? nextStudyPriorsUrl(target.patientId) : null;
  return Promise.allSettled([
    api.get(nextStudyDraftsUrl(target.id)),
    api.get(nextStudyMeasurementsUrl(target.id)),
    priorUrl ? api.get(priorUrl) : Promise.resolve(null),
  ]).then(() => undefined);
}
