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
  | "EXPAND"
  /** Whole report in, better-written version of the same report out. */
  | "PROFESSIONALIZE"
  /** Current report merged with supplied report text. */
  | "COMBINE"
  /** Dictated findings → structured observation proposal. Nothing to Apply. */
  | "OBSERVATIONS";

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
       *
       * The last four of those fields describe the REQUEST, and the tab loses
       * them as soon as the draft lands, so they come from
       * `ComposeJobView.requestScope` — `liveComposeSnapshot` merges them in.
       * Hashing without them was not a stale report: it was a different
       * snapshot, and it disabled Apply on every Refine draft.
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

  confirmApplied(
    jobId: number,
    acceptedChangeIds: string[],
    hashes?: {
      findingsHash: string;
      impressionHash: string;
      recommendationHash: string;
      reportRevision: string;
      inputHash: string;
    },
    /**
     * Which study this apply is happening inside. The server resolves it from
     * its own `radiology_worklist` / `patient_reports` rows and compares it with
     * the study the job was bound to when it was created, so a draft generated
     * for one patient cannot be confirmed against another patient's report.
     * Required — an apply that names no study is refused.
     */
    target?: { worklistId: number | null; studyId: number | null; reportId: number | null },
  ) {
    return api.post<{ ok: boolean; error?: string; code?: string; message?: string }>(
      `/api/radiology/report-composer/jobs/${jobId}/applied`,
      { acceptedChangeIds, ...(hashes ?? {}), ...(target ? { target } : {}) },
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
