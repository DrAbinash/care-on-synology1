/**
 * Hook: Background AI Report Composer — enqueue, poll, reopen, apply via store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { reportComposerApi, type JobKind } from "@/lib/reportComposer/api";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  computeSnapshotHashes,
  materializeAcceptedText,
  type ComposeJobView,
  type ComposeObservation,
  type ComposerInputSnapshot,
  type TrackedChange,
} from "@/lib/reportComposer/types";

const POLL_MS = 2000;

export function useReportComposer(opts: {
  worklistId: number | null;
  studyId: number | null;
  reportId: number | null;
  modality?: string;
  /** Primary reporting region. Mirrors ReportingStudyContext.region. */
  region?: string;
  /** All selected reporting regions (multi-select, primary first). Mirrors
   * ReportingStudyContext.regions. Carries screening context. */
  regions?: string[];
  /** Structured-template bodyPart code (BRAIN, SPINE_CERVICAL, …). */
  bodyPart?: string;
  /** Reporting family ("brain" | "spine" | "chest" | "abdomen" | "unknown"). */
  family?: string;
  /** Spine segment ("cervical" | "dorsal" | "lumbar" | "whole" | "generic"). */
  spineSegment?: string;
  /** DICOM / worklist StudyDescription — descriptive provenance only. */
  studyType?: string;
  /** Resolved protocol / sub-technique name (e.g. "Plain", "Epilepsy Protocol").
   * Source: ReportingStudyContext.protocolName (which is activeProtocol?.name).
   * Never inferred from StudyDescription. */
  protocol?: string;
  /** Resolved printed report heading (NOT library/display format name).
   * Source: resolvePrintedReportTitle(appliedFormatReportTitle, fallback). */
  reportTitle?: string;
  isFinalized: boolean;
}) {
  const { toast } = useToast();
  const [job, setJob] = useState<ComposeJobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showAiChanges, setShowAiChanges] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findingsText = useWorkspace((s) => s.findingsText);
  const impressionText = useWorkspace((s) => s.impressionText);
  const recommendationText = useWorkspace((s) => s.recommendationText);
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const clinicalHistoryText = useWorkspace((s) => s.clinicalHistoryText);
  const fieldProvenance = useWorkspace((s) => s.fieldProvenance);
  const appliedPathologyPatches = useWorkspace((s) => s.appliedPathologyPatches);
  const applyAiComposerAccepted = useWorkspace((s) => s.applyAiComposerAccepted);
  const undoLastPatch = useWorkspace((s) => s.undoLastPatch);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshJob = useCallback(async (id: number) => {
    const res = await reportComposerApi.getJob(id);
    if (res.ok && res.job) {
      setJob(res.job);
      if (["READY", "STALE_READY", "FAILED", "APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE"].includes(res.job.status)) {
        stopPoll();
        if (res.job.status === "READY" || res.job.status === "STALE_READY") {
          // Freshness check against the live editor + live canonical ledger +
          // live canonical study context. Three invalidation axes:
          //   1. Narrative text change (findings/impression/recommendation).
          //   2. Canonical observation change (PR #654) — captured in
          //      `reportRevision` via `obsCanon` inside `computeSnapshotHashes`.
          //   3. Canonical study-context change (PR #656) — modality, region,
          //      regions, bodyPart, family, spineSegment, protocol,
          //      reportTitle. Captured in `inputHash` via
          //      `canonicalStudyContextHashPayload` inside `computeSnapshotHashes`.
          //      WITHOUT this axis a Plain → Contrast protocol change with
          //      identical narrative text + identical observations would
          //      leave a READY draft silently applicable, which is unsafe.
          // The full snapshot we hash here MUST mirror the enqueue-time
          // snapshot shape — same canonical context fields, same observations,
          // same narrative. `computeSnapshotHashes` produces a hash that is
          // identical on client and server (mirrored verbatim in
          // api-server/src/lib/reportComposer/snapshot.ts).
          const liveObservations = deriveComposeObservations(appliedPathologyPatches);
          const liveSnapshot: ComposerInputSnapshot = {
            modality: opts.modality,
            region: opts.region,
            regions: opts.regions,
            bodyPart: opts.bodyPart,
            family: opts.family,
            spineSegment: opts.spineSegment,
            studyType: opts.studyType,
            protocol: opts.protocol,
            reportTitle: opts.reportTitle,
            clinicalHistory: clinicalHistoryText,
            technique: techniqueText,
            findings: findingsText,
            impression: impressionText,
            recommendation: recommendationText,
            observations: liveObservations,
            jobKindHint: res.job.jobKind ?? "FULL_REPORT",
          };
          const hashes = await computeSnapshotHashes(liveSnapshot);
          const fr = await reportComposerApi.freshness(id, {
            findings: findingsText,
            impression: impressionText,
            recommendation: recommendationText,
            reportRevision: hashes.reportRevision,
            inputHash: hashes.inputHash,
          });
          if (fr.stale && res.job.status === "READY") {
            const again = await reportComposerApi.getJob(id);
            if (again.ok) setJob(again.job);
          }
          toast({
            title: fr.stale ? "AI report STALE" : "AI report ready",
            description: fr.stale
              ? "Report changed since compose was requested — review carefully."
              : `${opts.modality ?? "Study"} composition finished.`,
          });
          setReviewOpen(true);
        }
      }
    }
  }, [
    findingsText, impressionText, recommendationText, clinicalHistoryText, techniqueText,
    appliedPathologyPatches, opts, stopPoll, toast,
  ]);

  const startPoll = useCallback((id: number) => {
    stopPoll();
    pollRef.current = setInterval(() => {
      void refreshJob(id);
    }, POLL_MS);
  }, [refreshJob, stopPoll]);

  // Reopen: load latest job for worklist
  useEffect(() => {
    if (!opts.worklistId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await reportComposerApi.latest(opts.worklistId!);
        if (cancelled || !res.ok || !res.job) return;
        setJob(res.job);
        if (["QUEUED", "COMPOSING"].includes(res.job.status)) startPoll(res.job.id);
        if (["READY", "STALE_READY"].includes(res.job.status)) setReviewOpen(true);
      } catch {
        /* soft */
      }
    })();
    return () => {
      cancelled = true;
      stopPoll();
    };
  }, [opts.worklistId, startPoll, stopPoll]);

  const buildSnapshot = useCallback(async (extra?: Partial<ComposerInputSnapshot>, jobKind?: JobKind): Promise<ComposerInputSnapshot> => {
    // Canonical observations are derived from the live workspace observation
    // ledger (`appliedPathologyPatches`). This is the single authoritative
    // observation store in CARE — Quick Select, Finding Composer, structured
    // macros / Chocolate bundles, MRI lumbar level canvas, pathology overlay,
    // and committed Voice Composer plans all write into it through the
    // existing `apply*` entrypoints. Voice observations are already members
    // of the ledger (id `voice-*`, source `radiologist-voice`), so they are
    // included here automatically and do NOT need a second pass through
    // `voiceComposerObservations`.
    const observations: ComposeObservation[] = deriveComposeObservations(appliedPathologyPatches);
    const snap: ComposerInputSnapshot = {
      studyId: opts.studyId,
      worklistId: opts.worklistId,
      reportId: opts.reportId,
      modality: opts.modality,
      region: opts.region,
      regions: opts.regions,
      bodyPart: opts.bodyPart,
      family: opts.family,
      spineSegment: opts.spineSegment,
      studyType: opts.studyType,
      protocol: opts.protocol,
      reportTitle: opts.reportTitle,
      clinicalHistory: clinicalHistoryText,
      technique: techniqueText,
      findings: findingsText,
      impression: impressionText,
      recommendation: recommendationText,
      observations,
      fieldProvenanceSummary: {
        findings: fieldProvenance.findings as Record<string, string[]> | undefined,
        impression: fieldProvenance.impression as Record<string, string[]> | undefined,
        recommendation: fieldProvenance.recommendation as Record<string, string[]> | undefined,
      },
      jobKindHint: jobKind ?? "FULL_REPORT",
      ...extra,
    };
    const hashes = await computeSnapshotHashes(snap);
    snap.clientRevisionHint = hashes.reportRevision;
    return snap;
  }, [
    clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText,
    fieldProvenance, appliedPathologyPatches, opts,
  ]);

  const enqueue = useCallback(async (jobKind: JobKind = "FULL_REPORT", extra?: Partial<ComposerInputSnapshot>) => {
    if (opts.isFinalized) {
      toast({ title: "Report finalized", description: "Composition not allowed.", variant: "destructive" });
      return null;
    }
    setBusy(true);
    try {
      const snapshot = await buildSnapshot(extra, jobKind);
      const res = await reportComposerApi.enqueue({ snapshot, jobKind });
      if (!res.ok || !res.jobId) {
        toast({ title: "Compose failed", description: res.error ?? "Could not enqueue", variant: "destructive" });
        return null;
      }
      toast({
        title: res.deduped ? "Already composing" : "Compose queued",
        description: `Job #${res.jobId} — you can leave this study.`,
      });
      const got = await reportComposerApi.getJob(res.jobId);
      if (got.ok) setJob(got.job);
      startPoll(res.jobId);
      // Fast path: try process-now for admins (optional; ignore 403)
      try {
        await reportComposerApi.processNow(res.jobId);
        await refreshJob(res.jobId);
      } catch {
        /* drained by worker */
      }
      return res.jobId;
    } catch (e) {
      toast({ title: "Compose failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [buildSnapshot, opts.isFinalized, refreshJob, startPoll, toast]);

  const updateLocalChanges = (changes: TrackedChange[]) => {
    setJob((j) => (j ? { ...j, trackedChanges: changes } : j));
  };

  const acceptChange = async (changeId: string) => {
    if (!job) return;
    const res = await reportComposerApi.acceptChange(job.id, changeId);
    if (res.ok && res.changes) updateLocalChanges(res.changes);
  };

  const rejectChange = async (changeId: string) => {
    if (!job) return;
    const res = await reportComposerApi.rejectChange(job.id, changeId);
    if (res.ok && res.changes) updateLocalChanges(res.changes);
  };

  const acceptAllPending = async () => {
    if (!job) return;
    for (const c of job.trackedChanges.filter((x) => x.reviewState === "PENDING")) {
      await acceptChange(c.id);
    }
  };

  const rejectAllPending = async () => {
    if (!job) return;
    for (const c of job.trackedChanges.filter((x) => x.reviewState === "PENDING")) {
      await rejectChange(c.id);
    }
  };

  /** Apply accepted changes through canonical store (Guard 3). Never auto on READY. */
  const applyAccepted = async () => {
    if (!job) return;
    if (opts.isFinalized) {
      toast({ title: "Apply disabled", description: "Report is finalized.", variant: "destructive" });
      return;
    }
    if (job.status === "STALE_READY") {
      toast({
        title: "STALE draft",
        description: "Report changed since this draft. Compare or Regenerate — blind apply blocked.",
        variant: "destructive",
      });
      return;
    }
    const significantPending = job.trackedChanges.filter(
      (c) => c.reviewState === "PENDING" && c.clinicalSignificance,
    );
    if (significantPending.length > 0) {
      toast({
        title: "Clinically significant edits pending",
        description: `${significantPending.length} change(s) need explicit Accept/Reject.`,
        variant: "destructive",
      });
      return;
    }

    let changes = job.trackedChanges;
    // Accept All remaining non-significant pending as part of Apply All
    const pending = changes.filter((c) => c.reviewState === "PENDING");
    for (const c of pending) {
      await reportComposerApi.acceptChange(job.id, c.id);
    }
    const refreshed = await reportComposerApi.getJob(job.id);
    if (refreshed.ok) {
      changes = refreshed.job.trackedChanges;
      setJob(refreshed.job);
    }

    const accepted = changes.filter((c) => c.reviewState === "ACCEPTED" || c.reviewState === "EDITED");
    if (accepted.length === 0) {
      toast({ title: "Nothing to apply", description: "Accept at least one change first." });
      return;
    }

    const text = materializeAcceptedText({
      currentFindings: findingsText,
      currentImpression: impressionText,
      currentRecommendation: recommendationText,
      changes: accepted,
    });
    applyAiComposerAccepted(text);
    await reportComposerApi.confirmApplied(
      job.id,
      accepted.map((c) => c.id),
    );
    const after = await reportComposerApi.getJob(job.id);
    if (after.ok) setJob(after.job);
    setReviewOpen(false);
    toast({ title: "AI draft applied", description: "One Undo restores the previous report." });
  };

  const discard = async () => {
    if (!job) return;
    await reportComposerApi.discard(job.id);
    const after = await reportComposerApi.getJob(job.id);
    if (after.ok) setJob(after.job);
    setReviewOpen(false);
    toast({ title: "AI draft discarded" });
  };

  const regenerate = async () => {
    await enqueue("FULL_REPORT");
  };

  const pendingCount = job?.trackedChanges.filter((c) => c.reviewState === "PENDING").length ?? 0;

  return {
    job,
    busy,
    reviewOpen,
    setReviewOpen,
    showAiChanges,
    setShowAiChanges,
    pendingCount,
    enqueue,
    composeFull: () => enqueue("FULL_REPORT"),
    composeImpression: () => enqueue("IMPRESSION"),
    microEdit: (kind: JobKind, selectionText: string, selectionField: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION", instruction: string, targetLanguage?: string) =>
      enqueue(kind, { selectionText, selectionField, instruction, targetLanguage }),
    acceptChange,
    rejectChange,
    acceptAllPending,
    rejectAllPending,
    applyAccepted,
    discard,
    regenerate,
    undoLastPatch,
    refreshJob,
  };
}
