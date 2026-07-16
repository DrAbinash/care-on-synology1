/**
 * usgCompanionTypes.ts — client-side mirror of the CARE USG Companion server
 * payload (GET /api/care-usg-companion/study/:uid). Kept as plain interfaces
 * (the radiology/USG API is not part of the orval-generated zod pipeline —
 * see the platform-conventions audit).
 */

export interface CompanionMeasurementItem {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  confidence: string;
  source: string;
  present: boolean;
}

export interface CompanionMeasurementSummary {
  measurementRowId: number | null;
  overallConfidence: string | null;
  status: string | null;
  expectedCount: number;
  foundCount: number;
  missingCount: number;
  items: CompanionMeasurementItem[];
  missing: { key: string; label: string }[];
  extras: CompanionMeasurementItem[];
  doppler: { vesselCount: number; present: boolean };
}

export interface CompanionPriorItem {
  label: string;
  dateIso: string | null;
  status: string | null;
}

export interface CompanionAssembly {
  ok: boolean;
  degraded: boolean;
  study: {
    studyInstanceUID: string;
    worklistId: number | null;
    patientId: number | null;
    patientName: string | null;
    accessionNumber: string | null;
    modality: string;
    studyDescription: string;
    studyDate: string | null;
    receivedAt: string | null;
    referringDoctor: string | null;
    status: string | null;
    reportId: number | null;
    imageCount: number;
  };
  machine: {
    manufacturer: string | null;
    model: string | null;
    station: string | null;
    institution: string | null;
    isVoluson: boolean;
  };
  detectedStudyType: { id: string; label: string; category: string; description: string };
  extraction: {
    status: "completed" | "failed" | "running" | "none";
    lastRunAt: string | null;
    framesProcessed: number;
    srFound: boolean;
  };
  measurements: CompanionMeasurementSummary;
  previousStudies: {
    usg: CompanionPriorItem[];
    mri: CompanionPriorItem[];
    ct: CompanionPriorItem[];
    other: CompanionPriorItem[];
    total: number;
    priorUsgText: string | null;
    priorUsgDateIso: string | null;
  };
  warnings: string[];
}

export interface CompanionDashboardStats {
  windowDays: number;
  totalRuns: number;
  extractionSuccessRate: number;
  extractionFailureRate: number;
  avgImportedMeasurements: number;
  avgTimeSavedSeconds: number;
  avgReadinessScore: number;
  autoPopulationRate: number;
  avgEditsAfterPopulate: number;
  avgReportCompletion: number;
  machineBreakdown: { machine: string; runCount: number; successCount: number }[];
  mostCommonMissingMeasurements: { key: string; count: number }[];
  topRejectedMeasurements: { key: string; count: number }[];
}

/** Compact context the Companion threads up into CopilotContext.usgCompanion. */
export interface CompanionCopilotContext {
  studyType: string;
  imported: { label: string; value: string }[];
  rejected: { label: string; value: string }[];
  modified: { label: string; value: string }[];
  missing: string[];
  /** Phase 2 — sentences the Companion auto-populated (machine/template/rule),
   *  so Copilot can advise the radiologist to review generated content. */
  autoPopulated?: { section: string; text: string; kind: string }[];
}
