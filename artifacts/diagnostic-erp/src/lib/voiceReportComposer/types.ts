/**
 * Voice Report Composer — shared types (mirrors api-server schema).
 */
export type VoiceObservation = {
  id?: string;
  concept: string;
  level?: string | null;
  severity?: string | null;
  laterality?: string | null;
  modifiers?: string[];
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  operation?: "add" | "update" | "remove";
  targetObservationId?: string;
};

export type VoiceChangePlan = {
  operation: "report_change_plan";
  observations: VoiceObservation[];
  removeConflictingBaselineConcepts?: string[];
  impressionCandidates?: string[];
  impressionUpdate?: string;
  uncertainties: string[];
  clarificationRequired?: string | null;
};

export type VoiceComposerDiagnostics = {
  requestId: string;
  provider: "ollama";
  model: string;
  fallbackUsed?: boolean;
  endpointSource?: string;
  region?: string;
  transcriptLength: number;
  latencyMs: number;
  validationMs?: number;
  validationOk: boolean;
  schemaOk?: boolean;
  phraseFallback?: boolean;
};

export type VoiceComposerProvenance = {
  source: "radiologist-voice";
  composer: "local_ai" | "phrase_catalog";
  model?: string;
  fallbackUsed?: boolean;
  requestId?: string;
};

export type ComposeApiResponse = {
  ok: boolean;
  plan?: VoiceChangePlan;
  error?: string;
  diagnostics?: VoiceComposerDiagnostics;
  provenance?: VoiceComposerProvenance;
  phraseFallbackAvailable?: boolean;
};
