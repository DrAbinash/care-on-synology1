import { api } from "@/lib/fetchApi";
import type { ComposerInputSnapshot, ComposeJobView, TrackedChange } from "./types";

export type JobKind =
  | "FULL_REPORT"
  | "IMPRESSION"
  | "SECTION_EDIT"
  | "SELECTION_EDIT"
  | "TRANSLATE"
  | "REPHRASE"
  | "SHORTEN"
  | "EXPAND";

export const reportComposerApi = {
  enqueue(opts: {
    snapshot: ComposerInputSnapshot;
    jobKind?: JobKind;
    persistedContentToken?: string | null;
  }) {
    return api.post<{
      ok: boolean;
      jobId?: number;
      deduped?: boolean;
      status?: string;
      reportRevision?: string;
      inputHash?: string;
      sources?: Record<string, number>;
      error?: string;
      code?: string;
    }>("/api/radiology/report-composer/jobs", opts);
  },

  getJob(id: number) {
    return api.get<{ ok: boolean; job: ComposeJobView }>("/api/radiology/report-composer/jobs/" + id);
  },

  latest(worklistId: number) {
    return api.get<{ ok: boolean; job: ComposeJobView | null }>(
      `/api/radiology/report-composer/latest?worklistId=${worklistId}`,
    );
  },

  freshness(
    id: number,
    body: {
      findings: string;
      impression: string;
      recommendation: string;
      reportRevision?: string;
      /**
       * PR #656: live `inputHash` recomputed by the client via
       * `computeSnapshotHashes` over the full canonical snapshot (modality,
       * region, regions, bodyPart, family, spineSegment, protocol,
       * reportTitle + clinicalHistory + technique + findings + impression +
       * recommendation + observations + selectionText + instruction +
       * templateSections + jobKindHint). When present, the server compares
       * it against the stored enqueue-time `inputHash` and flips READY →
       * STALE_READY on mismatch so study-identity changes (Plain → Contrast,
       * region add/remove, bodyPart change, etc.) cannot be silently applied
       * as if current. Optional for backward compatibility — legacy clients
       * omit and retain the reportRevision-only behavior.
       */
      inputHash?: string;
    },
  ) {
    return api.post<{ ok: boolean; status: string; stale: boolean }>(
      `/api/radiology/report-composer/jobs/${id}/freshness`,
      body,
    );
  },

  acceptChange(jobId: number, changeId: string) {
    return api.post<{ ok: boolean; changes?: TrackedChange[] }>(
      `/api/radiology/report-composer/jobs/${jobId}/changes/${changeId}/accept`,
      {},
    );
  },

  rejectChange(jobId: number, changeId: string) {
    return api.post<{ ok: boolean; changes?: TrackedChange[] }>(
      `/api/radiology/report-composer/jobs/${jobId}/changes/${changeId}/reject`,
      {},
    );
  },

  confirmApplied(jobId: number, acceptedChangeIds: string[]) {
    return api.post<{ ok: boolean; error?: string }>(
      `/api/radiology/report-composer/jobs/${jobId}/applied`,
      { acceptedChangeIds },
    );
  },

  discard(jobId: number) {
    return api.post<{ ok: boolean }>(`/api/radiology/report-composer/jobs/${jobId}/discard`, {});
  },

  processNow(jobId: number) {
    return api.post<{ ok: boolean; detail?: string; job?: ComposeJobView }>(
      `/api/radiology/report-composer/jobs/${jobId}/process-now`,
      {},
    );
  },

  diagnostics() {
    return api.get<{
      ok: boolean;
      composer: { healthy: boolean; model: string | null; fallbackModel: string | null };
      queue: Record<string, unknown>;
    }>("/api/radiology/report-composer/diagnostics");
  },

  selfTest() {
    return api.post<Record<string, unknown>>("/api/radiology/report-composer/test", {});
  },
};
