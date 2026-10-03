/**
 * Finalize gauntlet (sign + archive + notify) for RadiologyReportingWorkspace.
 * Phase 3 extraction — gauntlet ORDER unchanged.
 */

import {
  useCallback, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { finalizeRadiologyReport } from "@/lib/radiologyReportLifecycle";
import { validateReport } from "@/lib/reportValidator";
import { formatQualityAdvisoryForDialog } from "@/lib/reportQualityFinalize";
import { runFinalizeQualityEvaluation } from "@/lib/reportQualityFinalizeApi";
import { detectCriticalFindings } from "@/lib/criticalResults";
import { computeFinalizeSafety, formatFinalizeSafety, criticalFindingBlocksFinalize } from "@/lib/finalizeSafety";
import { offlineBlockMessage } from "@/lib/reliability";
import { clearRescueDraft } from "@/lib/draftRescue";
import { collectCompositionFinalizeGate } from "@/lib/observationLedger";
import { decideAiFinalizeGate } from "@/lib/aiFinalizeGate";
import { buildSignedReportBodyHtml } from "@/lib/radiologyReportPrintLiveMerge";
import type {
  PreviewFindingsItem, ReportHeadingCase, ReportImpressionStyle,
} from "@/lib/radiologyReportPreviewHtml";
import { bumpSessionCompleted, type ReadingSessionState } from "@/lib/readingSession";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import type { FinalizePromptResult } from "@/hooks/useFinalizeFlow";

export type UseStudyFinalizeOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  isOnline: boolean;
  checklistPercent: number;
  saveDraft: (opts?: { silent?: boolean }) => Promise<number | null>;
  finalizeFlow: {
    promptFinalize: (args: any) => Promise<FinalizePromptResult>;
  };
  draftBackup: { clear: () => void };
  qc: ReturnType<typeof useQueryClient>;
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
  isCritical: boolean;
  criticalNote: string;
  checklistComm: { phoned: boolean; annotated: boolean; dispatched: boolean };
  session: unknown;
  sessionFresh: { user?: { name?: string | null } | null } | null | undefined;
  reportComposer: {
    job?: {
      status?: string;
      trackedChanges?: Array<{ reviewState?: string }>;
    } | null;
    setReviewOpen: (open: boolean) => void;
  };
  workflow: {
    currentRow: {
      patientId?: number | null;
      patientName?: string;
      studyDescription?: string | null;
      modality?: string | null;
      accessionNumber?: string | null;
      studyInstanceUID?: string | null;
    } | null;
    markCompleted: (id: number) => void;
  };
  goNextStudy: () => void;
  setReadingSession: Dispatch<SetStateAction<ReadingSessionState>>;
  /** Canonical patient demography, read at sign-off. Q109 (sex vs anatomy) and
   *  Q110 (age vs wording) cannot fire without it — they are the codebase's only
   *  wrong-patient-report detectors. Null until the demography merge has run. */
  getDemography: () => { sex?: string | null; age?: string | null } | null;
  /** Presentation choices that shape the signed body. Must be the SAME values
   *  the pre-sign print preview uses, or the issued document is not the one
   *  the radiologist approved. */
  presentation: {
    headingCase: ReportHeadingCase;
    impressionStyle: ReportImpressionStyle;
    useStructured: boolean;
    findingsMap: Record<string, PreviewFindingsItem>;
  };
};

export function useStudyFinalize(opts: UseStudyFinalizeOptions) {
  const {
    studyId, draftId, isOnline, checklistPercent, saveDraft, finalizeFlow,
    draftBackup, qc, toast, isCritical, criticalNote, checklistComm,
    session, sessionFresh, reportComposer, workflow, goNextStudy, setReadingSession,
    getDemography, presentation,
  } = opts;

  // Destructured so the finalize callback depends on the four values, not on a
  // fresh wrapper object every render.
  const {
    headingCase, impressionStyle, useStructured, findingsMap,
  } = presentation;

  // Alias for verbatim finalize body (uses studySetup.checklistPercent)
  const studySetup = { checklistPercent };

  const [formFFinalizeOpen, setFormFFinalizeOpen] = useState(false);
  const formFContinueFinalizeRef = useRef(false);
  const pcpndtBlockedRef = useRef(false);
  const [aiFinalizeGate, setAiFinalizeGate] = useState<"idle" | "pending">("idle");
  const aiFinalizeBypassRef = useRef(false);

// ─── Finalize (sign + archive + notify) ─────────────────────────────────────
const finalizeReport = useCallback(async () => {
  // Guard, but never a silent one. This returned without a word, so pressing
  // Finalize & Sign looked like a busy system that had ignored the click — the
  // radiologist's only evidence was nothing happening.
  if (!studyId || !workflow.currentRow) {
    toast({
      title: "Nothing to finalize",
      description: !studyId
        ? "No study is open. Choose one in the worklist first."
        : "This study's worklist row is not loaded, so there is nothing to sign. Reopen the study from the worklist.",
      variant: "destructive",
    });
    return;
  }
  const offlineMsg = offlineBlockMessage(isOnline, "finalize");
  if (offlineMsg) { toast({ title: "Offline", description: offlineMsg, variant: "destructive" }); return; }

  // 0. Session guard — never finalize without a valid user identity
  if (!sessionFresh?.user?.name) {
    toast({ title: "Session expired", description: "Reload the page to sign in before finalizing.", variant: "destructive" });
    return;
  }

  // Guard 10: pending AI proposals must never silently finalize
  const aiGate = decideAiFinalizeGate({
    job: reportComposer.job,
    bypassed: aiFinalizeBypassRef.current,
  });
  if (aiGate.block) {
    setAiFinalizeGate("pending");
    toast({
      title: "AI suggestions remain unreviewed",
      description: `${aiGate.pendingCount} AI change(s) pending. Review, or Reject remaining and continue.`,
      variant: "destructive",
    });
    reportComposer.setReviewOpen(true);
    return;
  }
  aiFinalizeBypassRef.current = false;
  setAiFinalizeGate("idle");

  // 1. Save dirty state first (capture draft id for quality + validate-draft)
  let effectiveDraftId = draftId;
  if (useWorkspace.getState().isDirty) {
    const savedId = await saveDraft();
    if (savedId) effectiveDraftId = savedId;
  }

  // 1b. PCPNDT Form F gate (obstetric USG) — open in-flow Form F step when incomplete
  if (pcpndtBlockedRef.current && !formFContinueFinalizeRef.current) {
    setFormFFinalizeOpen(true);
    return;
  }
  formFContinueFinalizeRef.current = false;

  // 2. Validate (local + server validate-draft when available) — live store
  const live = readWorkspaceClinicalTexts();
  // Read once, at sign-off: every rule below that needs patient sex or age is a
  // wrong-patient / wrong-report detector, and none of them can fire without it.
  const demography = getDemography();
  const patientSex = demography?.sex ?? null;
  const patientAge = demography?.age ?? null;
  const validationIssues = validateReport({
    findings: live.findingsText,
    // One element per impression point — the same shape the canonical quality
    // request uses. A single joined string leaves the duplicate-impression rule
    // (Q102) with no pair to compare, so it can never fire here either.
    impression: live.impressionText.split(/\n+/).map((l) => l.trim()).filter(Boolean),
    recommendation: live.recommendationText,
    technique: live.techniqueText,
    clinicalHistory: live.clinicalHistoryText,
    sex: patientSex,
    age: patientAge,
    modality: workflow.currentRow.modality,
    studyDescription: workflow.currentRow.studyDescription,
  });
  if (effectiveDraftId) {
    try {
      const serverVal = await api.post<{
        structured?: { errors?: unknown[]; warnings?: string[]; skipReasons?: string[] };
      }>("/api/radiology/report-generator/validate-draft", { draftId: effectiveDraftId });
      const errs = serverVal?.structured?.errors ?? [];
      const warns = serverVal?.structured?.warnings ?? [];
      const skips = serverVal?.structured?.skipReasons ?? [];
      for (const e of errs) validationIssues.push(typeof e === "string" ? e : JSON.stringify(e));
      for (const w of warns) validationIssues.push(w);
      for (const s of skips) validationIssues.push(s);
    } catch { /* non-fatal — local validation still applies */ }
  }

  // 3b. Canonical report-quality evaluation (persisted, drives finalize dialog)
  let qualityGate: Awaited<ReturnType<typeof runFinalizeQualityEvaluation>> | null = null;
  try {
    qualityGate = await runFinalizeQualityEvaluation({
      draftId: effectiveDraftId,
      modality: workflow.currentRow.modality,
      studyDescription: workflow.currentRow.studyDescription,
      clinicalHistory: live.clinicalHistoryText,
      technique: live.techniqueText,
      findings: live.findingsText,
      impression: live.impressionText,
      recommendation: live.recommendationText,
      checklistPercent: studySetup.checklistPercent,
      sex: patientSex,
      age: patientAge,
    });
  } catch (err) {
    toast({
      title: "Quality check skipped",
      description: err instanceof Error ? err.message : "Could not run report quality evaluation — continuing.",
    });
  }

  const qualityAdvisory = qualityGate ? formatQualityAdvisoryForDialog(qualityGate) : "";

  // 4. Critical findings check (auto-detect + manual mark/comms from legacy)
  const criticalHits = detectCriticalFindings(live.findingsText, [live.impressionText]);
  const criticalMarked = isCritical || criticalHits.length > 0;
  const criticalCommunicated = checklistComm.phoned;
  const safetyIssues = computeFinalizeSafety({
    checklistActive: false,
    checklistPercent: 100,
    criticalHits: criticalHits.map(h => ({ label: h.label })),
    criticalMarked,
    criticalCommunicated,
  });

  // 5. Get signatures
  // Prefer Dr. Sugandha when several signatures exist — she is the clinic radiologist.
  const signaturesRaw = await api.get<{ id: number; name: string }[]>("/api/signatures");
  const signatures = [...signaturesRaw].sort((a, b) => {
    const as = /sugandha/i.test(a.name) ? 0 : 1;
    const bs = /sugandha/i.test(b.name) ? 0 : 1;
    return as - bs;
  });

  const latest = useWorkspace.getState();
  const compositionGate = collectCompositionFinalizeGate({
    impressionNeedsRefresh: latest.impressionNeedsRefresh,
    findings: latest.findingsText,
    recommendation: latest.recommendationText,
    provenance: latest.fieldProvenance.recommendation,
    patches: latest.appliedPathologyPatches.map((p) => ({
      id: p.id,
      observation: p.observation as never,
      templates: p.templates,
      lastRendered: p.lastRendered,
      replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
      source: p.source,
      protected: Boolean(p.protected),
      stale: p.stale,
    })),
  });

  // 6. Prompt via finalize flow (quality gate + critical ack + signer + composition gate)
  const result = await finalizeFlow.promptFinalize({
    identity: `${workflow.currentRow.patientName} — ${workflow.currentRow.studyDescription}`,
    validationSummary: (validationIssues.join("; ") + qualityAdvisory) as string,
    warningBlock: safetyIssues.filter(i => i.severity === "warn").map(i => i.message).join("; "),
    safetyBlock: formatFinalizeSafety(safetyIssues),
    unbilledNote: "",
    signatures: signatures,
    qualityGate,
    criticalRequiresAck: criticalFindingBlocksFinalize({
      checklistActive: false,
      checklistPercent: 100,
      criticalHits: criticalHits.map(h => ({ label: h.label })),
      criticalMarked,
      criticalCommunicated,
    }),
    criticalSummary: [
      ...criticalHits.map(h => h.label),
      ...(isCritical && criticalNote ? [criticalNote] : []),
    ].filter(Boolean).join(", "),
    compositionImpressionNeedsRefresh: latest.impressionNeedsRefresh,
    compositionSiblingWarnings: compositionGate.siblingWarnings,
    compositionOrphanedRecommendations: compositionGate.orphanedRecommendations,
    compositionStalePatchCount: compositionGate.stalePatchCount,
  });

  if (!result.confirmed) return;

  // 7. Execute finalize — read narrative AFTER refresh/ack so the signed payload matches the gate.
  const signed = useWorkspace.getState();
  const signedFindings = signed.findingsText;
  const signedImpression = signed.impressionText;
  const signedRecommendation = signed.recommendationText;
  const linkedForFinalize = signed.linkedStudy;
  const combinedTitle = linkedForFinalize
    ? `${workflow.currentRow?.studyDescription ?? "Report"} + ${linkedForFinalize.title}`
    : (workflow.currentRow?.studyDescription ?? "Report");
  // The stored artifact is built by the SAME function that built the pre-sign
  // print preview, so Clinical History and Technique reach the signed report,
  // its PDF, the WhatsApp link and the PACS archive. The title is not repeated
  // here: reportPresentation renders it in the study-title bar.
  const signedBodyHtml = buildSignedReportBodyHtml({
    clinicalHistory: signed.clinicalHistoryText,
    technique: signed.techniqueText,
    findingsText: signedFindings,
    impressionText: signedImpression,
    recommendationText: signedRecommendation,
    impressionStyle,
    headingCase,
    useStructured,
    findingsMap,
  });
  try {
    const finalizeResult = await finalizeRadiologyReport(
      ({
        studyId,
        worklistId: studyId,
        patientId: workflow.currentRow.patientId,
        accessionNumber: workflow.currentRow.accessionNumber ?? "",
        studyInstanceUID: workflow.currentRow.studyInstanceUID ?? "",
        studyDescription: workflow.currentRow?.studyDescription ?? "",
        modality: workflow.currentRow.modality ?? "",
        linkedStudyId: linkedForFinalize?.studyId ?? null,
        linkedAccessionNumber: linkedForFinalize?.accessionNumber ?? null,
        linkedStudyInstanceUID: linkedForFinalize?.studyInstanceUID ?? null,
      } as any),
      {
        title: combinedTitle,
        htmlBody: signedBodyHtml,
        impression: [signedImpression],
        isCritical: criticalMarked,
        criticalNote: criticalNote || (criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null),
        createdBy: sessionFresh?.user?.name ?? undefined,
        actor: sessionFresh?.user?.name ?? undefined,
        signatureId: result.signatureId,
        auditDetails: qualityGate
          ? {
              qualityEvaluationId: qualityGate.textEvaluationId,
              structuredQualityEvaluationId: qualityGate.structuredEvaluationId,
              qualityScore: qualityGate.score,
              qualityBlockingCount: qualityGate.blockingCount,
              qualityWarningCount: qualityGate.warningCount,
              qualitySource: "workspace-finalize",
            }
          : undefined,
      } as any,
    );

    // 7. Honest toast
    if (finalizeResult.idempotent) {
      // The server returned this study's EXISTING report row — patient-reports.ts
      // answers HTTP 200 `{ ...existingReport, idempotent: true }` purely because
      // the worklist already holds a reportId, with no comparison against the
      // body/impression this call sent. So signedBodyHtml above was never
      // written. Claiming "finalized & signed" here was the false-success half of
      // the finding; the backup clear in step 8 was the half that destroyed the
      // only remaining copy of the discarded edits.
      toast({
        title: "Edits NOT saved — a report is already finalized for this study",
        description:
          `Report #${finalizeResult.reportId ?? "—"} already exists, so the server returned it unchanged. `
          + "What is on screen is NOT what is signed. Your local draft backup has been kept so nothing is lost — "
          + "open the signed report and compare before editing again.",
        variant: "destructive",
        duration: 15000,
      });
    } else if (finalizeResult.signed) {
      toast({ title: "Report finalized & signed", description: `Report #${finalizeResult.reportId}` });
    } else if (finalizeResult.reportCreationSkipped) {
      // Not a success path. The worklist row is marked final while no report
      // exists — nothing to print, nothing to send, nothing in Report Hub. The
      // old wording ("Worklist marked final") read as completion in a calm voice,
      // so a radiologist who believed it walked away from a study that has no
      // report behind it. Destructive, and the fix named.
      toast({
        title: "Study marked final — but NO report was created",
        description: finalizeResult.reportCreationSkipped.includes("no patient")
          ? "No patient is linked to this study, so there is no billable patient to attach a report to. Nothing has been printed or sent. Link the study to its patient and bill in Match Center, then finalize again."
          : `No patient report row created: ${finalizeResult.reportCreationSkipped}`,
        variant: "destructive",
        duration: 15000,
      });
    } else {
      toast({ title: "Report saved but NOT signed", description: finalizeResult.signError ?? "Sign error", variant: "destructive" });
    }
    if (finalizeResult.linkedMarkError) {
      toast({
        title: "Linked study was not marked final",
        description: finalizeResult.linkedMarkError,
        variant: "destructive",
      });
    } else if (finalizeResult.linkedMarkedFinal) {
      toast({
        title: "Both studies marked final",
        description: "Primary and linked worklist rows are REPORT_FINAL.",
      });
    }

    // 7b. Auto-push to Hope when this study is linked to a Hope referral (best-effort).
    // Skipped on the idempotent path: the report on screen was not written, so
    // "Sent to Hope" would describe a document the radiologist was just told
    // was not saved.
    if (!finalizeResult.idempotent && finalizeResult.signed && (finalizeResult.reportId || studyId)) {
      void api
        .post<{ ok?: boolean; alreadySent?: boolean; error?: string }>("/api/internal/radiology/send-report-to-hope", {
          reportId: finalizeResult.reportId ?? undefined,
          worklistId: studyId,
        })
        .then((r) => {
          if (r?.ok) {
            toast({
              title: r.alreadySent ? "Already on Hope" : "Sent to Hope",
              description: "Report is available on Hope ERP investigations.",
              duration: 2500,
            });
          }
        })
        .catch(() => { /* no Hope referral / integration off — silent */ });
    }

    // 8. Post-finalize cleanup
    if (finalizeResult.idempotent) {
      // Nothing was written, so nothing was completed: the study stays in the
      // queue, the reading session is not credited, and both local backups are
      // kept because they are the only surviving copy of the discarded text.
      // `cancelFinalize` rather than no call at all — otherwise `isFinalizing`
      // stays true and the workspace is left showing a permanent finalizing
      // state over a report that never changed.
      useWorkspace.getState().cancelFinalize();
    } else {
      workflow.markCompleted(studyId);
      if (linkedForFinalize?.studyId) {
        const linkedId = Number(linkedForFinalize.studyId);
        if (Number.isInteger(linkedId)) workflow.markCompleted(linkedId);
      }
      draftBackup.clear();
      clearRescueDraft();
      useWorkspace.getState().completeFinalize();
      setReadingSession(prev => bumpSessionCompleted(prev));
    }

    // 9. Invalidate queries
    qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });
    // The per-study detail query now carries the authoritative signed status the
    // workspace locks on; without this the lock keeps reading the pre-sign row
    // until its 60 s staleTime expires.
    qc.invalidateQueries({ queryKey: ["pacs-worklist-detail", studyId] });

    // 10. RIS throughput — auto-advance to the next eligible study.
    // goNextStudy handles the transition lock + wrong-patient arrival
    // cross-check and toasts "End of queue" when nothing eligible remains.
    // The just-finalized study is excluded by identity (currentId), so the
    // not-yet-rendered completedIds update cannot cause a self-advance.
    if (result.advanceToNext) {
      goNextStudy();
    }
  } catch (err) {
    toast({ title: "Finalize failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
  }
}, [studyId, workflow, isOnline, studySetup.checklistPercent, saveDraft, finalizeFlow, draftBackup, qc, toast, isCritical, criticalNote, checklistComm, draftId, session, reportComposer, sessionFresh, goNextStudy, getDemography, headingCase, impressionStyle, useStructured, findingsMap]);

  return {
    finalizeReport,
    formFFinalizeOpen,
    setFormFFinalizeOpen,
    aiFinalizeGate,
    setAiFinalizeGate,
    formFContinueFinalizeRef,
    pcpndtBlockedRef,
    aiFinalizeBypassRef,
  };
}
