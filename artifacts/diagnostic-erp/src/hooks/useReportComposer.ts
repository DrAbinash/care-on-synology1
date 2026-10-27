/**
 * Hook: Background AI Report Composer — enqueue, poll, reopen, apply via store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { reportComposerApi, type JobKind } from "@/lib/reportComposer/api";
import { composerApplyGate } from "@/lib/composerApplyGate";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import {
  buildComposerInputPreview,
  type ComposerInputPreview,
} from "@/lib/reportComposer/composerInputPreview";
import { resolveRefineTarget } from "@/lib/reportComposer/refineTarget";
import {
  composeDegradedReason,
  computeSnapshotHashes,
  materializeAcceptedText,
  type ComposeJobView,
  type ComposeObservation,
  type ComposerInputSnapshot,
  type ComposerPersistenceTag,
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
  /** TEXT_ONLY (default) or SELECTED_IMAGES. */
  aiMode?: "TEXT_ONLY" | "SELECTED_IMAGES";
  /** Radiologist AI-selected frozen key images (IDs + metadata; never base64). */
  selectedKeyImages?: ComposerInputSnapshot["selectedKeyImages"];
  /** Human-readable primary region for UI (e.g. MRI Brain). */
  primaryRegionLabel?: string;
  /** Session-only provider/model override (workspace A/B). Does not mutate Settings. */
  sessionProvider?: string | null;
  sessionModel?: string | null;
  /**
   * The radiologist's optional "Instructions to AI" text from the composer panel. It is
   * part of the frozen snapshot — and therefore of `inputHash` — for every job kind, so
   * the preview and the generation request cannot diverge on it.
   */
  instruction?: string;
  /**
   * Persist the accepted AI text through the workspace's own canonical draft-save
   * path and resolve once the server has recorded what it wrote. Required for
   * Apply: an accepted draft that was never saved is not a report, and "AI
   * Applied" has to mean the study's row holds the text.
   *
   * Resolves to the draft row id, or null when the save did not happen — a
   * refusal or a network failure both end here, and Apply then simply never gets
   * recorded, because the server's durability proof reads the row rather than
   * trusting this return value.
   */
  persistAccepted: (tag: ComposerPersistenceTag) => Promise<number | null>;
}) {
  const { toast } = useToast();
  const [job, setJob] = useState<ComposeJobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showAiChanges, setShowAiChanges] = useState(true);
  /** The AI input the radiologist last previewed; dropped whenever clinical input changes. */
  const [inputPreview, setInputPreview] = useState<ComposerInputPreview | null>(null);
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
            aiMode: opts.aiMode ?? "TEXT_ONLY",
            selectedKeyImages: opts.selectedKeyImages ?? [],
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
          // The reason the server wrote for THIS draft. The toast is the first
          // thing the radiologist reads, and one generic line for every fallback
          // named the wrong fix whenever a configured model had merely timed out.
          const isFallback = res.job.fallbackUsed || res.job.model === "deterministic";
          const fallbackReason = composeDegradedReason(res.job);
          toast({
            title: fr.stale
              ? (isFallback ? "Fallback draft STALE" : "AI report STALE")
              : (isFallback ? "Fallback draft ready" : "AI report ready"),
            description: fr.stale
              ? "Report changed since compose was requested — review carefully."
              : isFallback
                ? fallbackReason || "Local AI was not used — deterministic fallback. Review before apply."
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

  // Reopen: load latest job for worklist.
  //
  // Keyed on worklistId ALONE, deliberately. This effect used to list
  // `startPoll` in its deps, and `startPoll` depends on `refreshJob`, which
  // depends on the whole live editor snapshot — so every re-render of the
  // workspace re-ran it and re-issued GET /report-composer/latest for the same
  // study. Measured in a real browser: 13 of those requests inside one 3.1 s
  // mount, and 11 more during 90 s in which the radiologist did nothing. Each
  // response was identical to the last, and the workspace shares a
  // 300-requests-per-minute-per-IP budget, so this one effect was the largest
  // consumer of it — and the reason the key-image rail's own request was the one
  // that got refused. An in-flight job is still followed by startPoll's 2 s tick.
  const startPollRef = useRef(startPoll);
  useEffect(() => {
    startPollRef.current = startPoll;
  }, [startPoll]);

  useEffect(() => {
    if (!opts.worklistId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await reportComposerApi.latest(opts.worklistId!);
        if (cancelled || !res.ok || !res.job) return;
        setJob(res.job);
        if (["QUEUED", "COMPOSING"].includes(res.job.status)) startPollRef.current(res.job.id);
        if (["READY", "STALE_READY"].includes(res.job.status)) setReviewOpen(true);
      } catch {
        /* soft */
      }
    })();
    return () => {
      cancelled = true;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopPoll is stable
    // ([] deps); the only value this effect must re-run on is the study it is for.
  }, [opts.worklistId]);

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
    const guidance = (opts.instruction ?? "").trim();
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
      aiMode: opts.aiMode ?? "TEXT_ONLY",
      selectedKeyImages: opts.selectedKeyImages ?? [],
      ...(opts.sessionProvider?.trim()
        ? {
            sessionProvider: opts.sessionProvider.trim(),
            sessionModel: opts.sessionModel?.trim() || undefined,
          }
        : {}),
      // Radiologist guidance is part of the frozen clinical input for every kind, and is
      // already inside `inputHash` on both client and server. Spread before `extra` so an
      // explicit per-call instruction (micro-edit) still wins.
      ...(guidance ? { instruction: guidance } : {}),
      ...extra,
    };
    const hashes = await computeSnapshotHashes(snap);
    snap.clientRevisionHint = hashes.reportRevision;
    return snap;
  }, [
    clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText,
    fieldProvenance, appliedPathologyPatches, opts,
  ]);

  // Bumped every time the clinical input changes, so an in-flight preview that raced a
  // Quick Select click is discarded instead of being believed.
  const previewInvalidation = useRef(0);

  /**
   * Project the frozen AI input for the radiologist to read, and send nothing. This calls
   * `buildSnapshot()` — the same function `enqueue()` freezes and the server validates —
   * so the preview is the request's own input rather than a second description of it.
   */
  const previewInput = useCallback(async (): Promise<ComposerInputPreview | null> => {
    const token = previewInvalidation.current;
    const snapshot = await buildSnapshot();
    const hashes = await computeSnapshotHashes(snapshot);
    const preview = buildComposerInputPreview(snapshot, hashes);
    if (previewInvalidation.current !== token) return null;
    setInputPreview(preview);
    return preview;
  }, [buildSnapshot]);

  const selectedImageSignature = (opts.selectedKeyImages ?? [])
    .map((r) => r.keyImageId)
    .join(",");

  // A preview is a claim about the CURRENT input. Any change to the ledger (a finding added
  // or deselected, a measurement, a level, a laterality, a macro, dictation), the narrative,
  // the clinical indication, the technique, the study identity, the image selection, the
  // mode, the radiologist's own instructions or the chosen provider/model makes that claim
  // false — so the preview is dropped instead of being left on screen after the finding it
  // showed has been deselected.
  useEffect(() => {
    previewInvalidation.current += 1;
    setInputPreview(null);
  }, [
    appliedPathologyPatches, findingsText, impressionText, recommendationText,
    clinicalHistoryText, techniqueText, opts.worklistId, opts.studyId, opts.modality,
    opts.region, opts.protocol, opts.reportTitle, opts.family, opts.bodyPart,
    opts.spineSegment, opts.studyType, opts.aiMode, opts.instruction,
    opts.sessionProvider, opts.sessionModel, selectedImageSignature,
  ]);

  const enqueue = useCallback(async (jobKind: JobKind = "FULL_REPORT", extra?: Partial<ComposerInputSnapshot>) => {
    if (opts.isFinalized) {
      toast({ title: "Report finalized", description: "Composition not allowed.", variant: "destructive" });
      return null;
    }
    const effectiveMode =
      jobKind === "FULL_REPORT"
        ? (extra?.aiMode ?? opts.aiMode ?? "TEXT_ONLY")
        : "TEXT_ONLY";
    if (effectiveMode === "SELECTED_IMAGES") {
      const imgs = extra?.selectedKeyImages ?? opts.selectedKeyImages ?? [];
      if (imgs.length === 0) {
        toast({
          title: "No AI-selected images",
          description: "Select frozen key images for AI, or use Draft from Observations.",
          variant: "destructive",
        });
        return null;
      }
    }
    setBusy(true);
    try {
      const snapshot = await buildSnapshot(
        {
          ...extra,
          aiMode: effectiveMode,
          selectedKeyImages: effectiveMode === "SELECTED_IMAGES"
            ? (extra?.selectedKeyImages ?? opts.selectedKeyImages ?? [])
            : [],
        },
        jobKind,
      );
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
  }, [buildSnapshot, opts, refreshJob, startPoll, toast]);

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

    // Re-check freshness at Apply time (poll stops on READY — edits after that
    // would otherwise overwrite the live report with a stale AI draft).
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
      jobKindHint: job.jobKind ?? "FULL_REPORT",
      aiMode: opts.aiMode ?? "TEXT_ONLY",
      selectedKeyImages: opts.selectedKeyImages ?? [],
    };
    const hashes = await computeSnapshotHashes(liveSnapshot);
    const fr = await reportComposerApi.freshness(job.id, {
      findings: findingsText,
      impression: impressionText,
      recommendation: recommendationText,
      reportRevision: hashes.reportRevision,
      inputHash: hashes.inputHash,
    });
    if (fr.stale) {
      const again = await reportComposerApi.getJob(job.id);
      if (again.ok) setJob(again.job);
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

    // F1 / D-13 — the last instant before the write. The freshness check above
    // compared the CLICK-TIME text against the server's record; it cannot see
    // edits made while those round trips ran, and neither can the closure
    // values it hashed. The live store can. One character typed inside the async
    // window — or a study switch, which puts another patient's content in the
    // same fields — stops the Apply rather than overwriting it. The draft stays
    // in the panel for a Compare or Regenerate; the radiologist's text wins.
    const gate = composerApplyGate(
      { findings: findingsText, impression: impressionText, recommendation: recommendationText },
      readWorkspaceClinicalTexts(),
    );
    if (!gate.proceed) {
      const again = await reportComposerApi.getJob(job.id);
      if (again.ok) setJob(again.job);
      toast({
        title: "Report changed while Apply was running",
        description: "Your newest edits are safe and nothing was written. Compare the draft against the current report, or Regenerate.",
        variant: "destructive",
      });
      return;
    }

    const text = materializeAcceptedText({
      currentFindings: findingsText,
      currentImpression: impressionText,
      currentRecommendation: recommendationText,
      changes: accepted,
    });
    // The narrative this tab is replacing, captured BEFORE the accepted text goes
    // into the store. The server compares the study's saved report against it and
    // against the baseline it took when the draft was generated; it is not asked
    // to believe either one.
    const tag: ComposerPersistenceTag = {
      jobId: job.id,
      previous: {
        findings: findingsText,
        impression: impressionText,
        recommendation: recommendationText,
      },
    };
    applyAiComposerAccepted(text);
    // PROMPT 4 — persist first, then confirm. The save runs through the
    // workspace's own canonical draft-save path (the same one the Save button,
    // the autosave and Finalize use), awaited, so the accepted sentences are in
    // `radiology_report_drafts` before anything claims they are. The order is the
    // guarantee: previously the sequence was mutate → mark APPLIED → maybe
    // autosave later, which let a closed tab or a failed save leave a job recorded
    // as applied with its text in no database.
    //
    // A null return (refused or offline) is not handled here on purpose. `/applied`
    // re-reads the row on the server, so the refusal — and its wording — comes
    // from the same place whichever step did not happen.
    //
    // F4 — a THROWN exception from either step must not escape with the applied
    // text still in the editor and the job recorded as nothing in particular.
    // The refusal branch below already restores the previous report on a server
    // `!ok`; the same rollback is owed to a network error, and the notice says
    // what was done about it rather than leaving an unhandled rejection.
    try {
      await opts.persistAccepted(tag);
      const applied = await reportComposerApi.confirmApplied(
        job.id,
        accepted.map((c) => c.id),
        hashes,
        // The study this apply is happening inside. The server resolves it from
        // its own rows and refuses unless it is the study the draft was created
        // for — so a draft generated for Patient A cannot be confirmed against
        // Patient B's report, whatever this tab has loaded.
        { worklistId: opts.worklistId, studyId: opts.studyId, reportId: opts.reportId },
      );
      if (!applied.ok) {
        useWorkspace.getState().undoLastPatch();
        const again = await reportComposerApi.getJob(job.id);
        if (again.ok) setJob(again.job);
        toast({
          title: "Apply blocked",
          // One source of refusal wording (the server), plus the promise that
          // the refusal cost nothing: the accepted text is rolled back, never
          // silently kept and never silently lost.
          description: `${applied.message ?? applied.error ?? "Server rejected apply"} Your previous report text has been restored.`,
          variant: "destructive",
        });
        return;
      }
    } catch (err) {
      useWorkspace.getState().undoLastPatch();
      const again = await reportComposerApi.getJob(job.id);
      if (again.ok) setJob(again.job);
      toast({
        title: "Apply did not complete",
        description: `${err instanceof Error ? err.message : "The apply request failed."} Your previous report text has been restored.`,
        variant: "destructive",
      });
      return;
    }
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

  /**
   * "Refine Report" — the radiologist's sentence, sent as it was typed.
   *
   * Nothing here classifies the instruction. The path this replaces matched the
   * words against /translat|shorten|expand/ and fell through to REPHRASE, so
   * "organise the findings by anatomical level" reached the model labelled as a
   * request to rephrase — and it only ever saw `findingsText.slice(0, 800)`, so a
   * long report was refined from its first two paragraphs while everything after
   * character 800 was invisible to the prompt and could be dropped without anyone
   * noticing.
   *
   * With a selection, the selection is the target and its field is decided by
   * containment in the current text rather than by assumption. Without one, the
   * target is the whole draft — Findings and Impression, plus Recommendation when
   * the report has one — because "improve the impression" and "remove the
   * duplicated conclusion" are not Findings-only operations.
   */
  const refineReport = (instruction: string) => {
    const target = resolveRefineTarget({
      instruction,
      selection: window.getSelection?.()?.toString() ?? "",
      findings: findingsText,
      impression: impressionText,
      recommendation: recommendationText,
    });
    if (!target) return Promise.resolve(null);
    return enqueue(target.jobKind, {
      selectionText: target.selectionText,
      selectionField: target.selectionField,
      instruction: target.instruction,
    });
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
    inputPreview,
    previewInput,
    composeFull: () => enqueue("FULL_REPORT"),
    refineReport,
    composeImpression: () => enqueue("IMPRESSION", { aiMode: "TEXT_ONLY", selectedKeyImages: [] }),
    microEdit: (kind: JobKind, selectionText: string, selectionField: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION", instruction: string, targetLanguage?: string) =>
      enqueue(kind, {
        selectionText,
        selectionField,
        instruction,
        targetLanguage,
        aiMode: "TEXT_ONLY",
        selectedKeyImages: [],
      }),
    acceptChange,
    rejectChange,
    acceptAllPending,
    rejectAllPending,
    applyAccepted,
    discard,
    regenerate,
    undoLastPatch,
    refreshJob,
    aiMode: opts.aiMode ?? "TEXT_ONLY",
    selectedKeyImageCount: opts.selectedKeyImages?.length ?? 0,
    primaryRegionLabel: opts.primaryRegionLabel ?? opts.region ?? "Unknown region",
  };
}
