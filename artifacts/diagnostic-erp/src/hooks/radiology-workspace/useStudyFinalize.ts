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
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import { computeFinalizeSafety, formatFinalizeSafety, criticalFindingBlocksFinalize } from "@/lib/finalizeSafety";
import { offlineBlockMessage } from "@/lib/reliability";
import { isFinalizeStudyIdentityIntact } from "@/lib/radiologyWorkspaceSafety";
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
// The gauntlet body below is behaviourally unchanged; it is named
// `runFinalizeGauntlet` and wrapped by `finalizeReport` further down so the wrapper
// can own the finalization lifecycle across every way out of a gauntlet that contains
// five awaits, several early returns and throw sites — without re-indenting 400 lines
// to hold a try/finally around them.
const runFinalizeGauntlet = useCallback(async () => {
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

  // A-01 — arm the existing finalization lifecycle at the exact point the gauntlet
  // becomes asynchronous. Everything above is synchronous pre-checks; from here on the
  // study can change underneath us. `requestLeaveThen` reads this flag as
  // `finalizing:` (useDraftPersistence.ts:606) and `canLeaveStudy` already has the rule
  // "Finalize in progress — wait for it to finish" (reportingWorkflow.ts:266), so this
  // is the guard working as designed rather than a new mechanism.
  // `finalizeReport`'s wrapper clears it on every exit.
  useWorkspace.getState().startFinalize();

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
  //
  // The DETECTOR always runs — ff_radiology_critical_result_comms does not
  // blind it, and `criticalHits` stays available for anything that merely
  // reports. What the flag governs is whether a detection creates SIGNING
  // FRICTION. With the workflow off, the "Mark Critical Finding" switch and the
  // communication checklist are not rendered at all, so neither `isCritical`
  // nor `checklistComm.phoned` can ever be set by the radiologist. Passing the
  // raw hits into computeFinalizeSafety / criticalFindingBlocksFinalize anyway
  // would raise `criticalRequiresAck`, and FinalizeSignDialog's canConfirm
  // (`!criticalRequiresAck || criticalAck`) would then demand a tick from a
  // checkbox that no longer exists — the report could never be signed. So the
  // hits are withheld from both gates, which is exactly the state the workflow
  // was in before it was built: advisory detection without a protocol to satisfy.
  const criticalHits = detectCriticalFindings(live.findingsText, [live.impressionText]);
  const criticalCommsOn = criticalCommsEnabled();
  const gatedCriticalHits = criticalCommsOn ? criticalHits : [];
  const criticalMarked = criticalCommsOn ? (isCritical || criticalHits.length > 0) : false;
  const criticalCommunicated = checklistComm.phoned;
  const safetyIssues = computeFinalizeSafety({
    checklistActive: false,
    checklistPercent: 100,
    criticalHits: gatedCriticalHits.map(h => ({ label: h.label })),
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
      criticalHits: gatedCriticalHits.map(h => ({ label: h.label })),
      criticalMarked,
      criticalCommunicated,
    }),
    criticalSummary: [
      ...gatedCriticalHits.map(h => h.label),
      ...(criticalCommsOn && isCritical && criticalNote ? [criticalNote] : []),
    ].filter(Boolean).join(", "),
    compositionImpressionNeedsRefresh: latest.impressionNeedsRefresh,
    compositionSiblingWarnings: compositionGate.siblingWarnings,
    compositionOrphanedRecommendations: compositionGate.orphanedRecommendations,
    compositionStalePatchCount: compositionGate.stalePatchCount,
  });

  if (!result.confirmed) return;

  // A-01 — assert the study before the clinical content is consumed.
  //
  // Everything above this line was asynchronous: a save, a server validation, an AI
  // quality evaluation, the signature fetch and the sign dialog itself. The identity
  // used below (`studyId`, `workflow.currentRow`) comes from the render closure and is
  // therefore still the study finalize was started on, but `useWorkspace.getState()`
  // immediately underneath is the module-scope singleton and is whatever the radiologist
  // is now looking at. Without this check those two could name different patients, and
  // the report signed would be the previous study's identity carrying the next patient's
  // findings, impression, recommendation, clinical history, technique and linked study —
  // straight through to the PDF, the WhatsApp link and the PACS archive. The server
  // cannot catch it: it validates report ↔ worklist ↔ patient and trusts `htmlBody`.
  //
  // `activeStudyId` is authoritative because A-02 writes it in the same setState as the
  // clinical reset, so matching it is exactly the proof needed: the narrative about to be
  // read belongs to the study about to be signed.
  if (!isFinalizeStudyIdentityIntact(studyId, useWorkspace.getState().activeStudyId)) {
    toast({
      title: "Not signed — the open study changed",
      description:
        "Another study was opened while this report was being finalized, so nothing was signed and nothing was written. Reopen the study you meant to sign and finalize it again.",
      variant: "destructive",
      duration: 10000,
    });
    return;
  }

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

  // The sign dialog returns seven values. Three were read here (confirmed,
  // signatureId, advanceToNext); two are correctly consumed inside the dialog
  // itself (impressionReviewedAnyway / impressionRefreshed gate canConfirm there
  // and onRefreshImpression really calls refreshImpressionFromLedger). The last
  // two existed only to travel outward and were dropped, which is what made the
  // dialog's second checkbox a promise nothing kept. internal-radiology.ts
  // spreads auditDetails into the REPORT_STATUS_UPDATED audit row's `details`,
  // so that row is where an attestation with no outbound channel belongs.
  const signingAuditDetails: Record<string, unknown> = qualityGate
    ? {
        qualityEvaluationId: qualityGate.textEvaluationId,
        structuredQualityEvaluationId: qualityGate.structuredEvaluationId,
        qualityScore: qualityGate.score,
        qualityBlockingCount: qualityGate.blockingCount,
        qualityWarningCount: qualityGate.warningCount,
        qualitySource: "workspace-finalize",
      }
    : {};
  if (result.criticalAcknowledged) signingAuditDetails.criticalAcknowledgedAtSigning = true;
  if (result.notifyReferring) signingAuditDetails.referringDoctorNotifyIntent = true;

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
        // The auto-derived note is produced by the DETECTOR but lands in the
        // SIGNED record. With the communication workflow off, the panel that
        // would have shown the radiologist those labels is not rendered, so a
        // hidden detector must not silently add text to a signed report —
        // hence the criticalCommsOn term. A note the radiologist actually typed
        // is preserved either way: discarding real clinical input would be a
        // worse outcome than a slightly inconsistent flag.
        criticalNote: criticalNote || (criticalCommsOn && criticalHits.length > 0 ? criticalHits.map(h => h.label).join(", ") : null),
        createdBy: sessionFresh?.user?.name ?? undefined,
        actor: sessionFresh?.user?.name ?? undefined,
        signatureId: result.signatureId,
        auditDetails: Object.keys(signingAuditDetails).length > 0 ? signingAuditDetails : undefined,
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
    } else if (finalizeResult.resumedAfterLostResponse) {
      // D-5 — the report row was written; only its answer was lost. The content
      // on screen is what the server holds (finalizeRadiologyReport proves that
      // before resuming, and re-throws otherwise), so this is a completion, not
      // a rescue to be hidden. Saying just "finalized & signed" would leave the
      // radiologist believing the four red toasts that preceded it were about a
      // different attempt.
      toast({
        title: finalizeResult.signed
          ? finalizeResult.alreadySignedOnServer
            ? "Report was already finalized & signed"
            : "Report finalized & signed after the connection dropped"
          : "Report saved but NOT signed",
        description: finalizeResult.signed
          ? `Report #${finalizeResult.reportId}. The save did not answer, so the workspace recovered the report the server had already written instead of creating a second one.`
          : `Report #${finalizeResult.reportId} exists and holds this content, but signing did not happen: ${finalizeResult.signError ?? "sign error"}`,
        variant: finalizeResult.signed ? undefined : "destructive",
        duration: finalizeResult.signed ? 8000 : 15000,
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

    // 7c. Record the critical-finding tick the radiologist made IN THE SIGN
    // DIALOG against the report row, through the same audited endpoint Report
    // Hub uses. Before this, the dialog gated Confirm on that tick and this hook
    // then discarded it, so a critical report was signed with
    // criticalAcknowledgedAt = NULL: Report Hub kept showing its Ack button
    // (pages/ReportHub.tsx renders it on `isCritical && !criticalAcknowledgedAt`)
    // and the radiologist had to give the same acknowledgement a second time,
    // from a different screen, with nothing to say they had already given it.
    // The endpoint derives the acknowledger from the session, never from this
    // payload, and writes its own audit row.
    //
    // Gated on `criticalMarked` as well as on the tick. From this call site the
    // two cannot disagree — criticalRequiresAck needs gatedCriticalHits.length>0,
    // which needs criticalCommsOn, which makes criticalMarked true whenever
    // criticalHits is non-empty — so the term is redundant today. It stays
    // because the endpoint answers 409 not_a_critical_report for a report saved
    // with isCritical=false, and that answer must never become a destructive
    // "not recorded" toast if the gating above is ever widened.
    //
    // Skipped on the idempotent path for the same reason as 7b: nothing was
    // written by this call, so nothing about it should be recorded.
    if (!finalizeResult.idempotent && finalizeResult.signed && result.criticalAcknowledged && criticalMarked && finalizeResult.reportId) {
      void api
        .post(`/api/patient-reports/${finalizeResult.reportId}/acknowledge-critical`, {})
        .catch((err) => {
          // Not silent: an unrecorded acknowledgement is the exact thing the
          // badge in Report Hub exists to surface, so say where to finish it.
          toast({
            title: "Critical acknowledgement was not recorded",
            description:
              "The report is signed, but Report Hub will still show this critical result as "
              + `unacknowledged. Acknowledge it there. (${err instanceof Error ? err.message : "unknown error"})`,
            variant: "destructive",
            duration: 12000,
          });
        });
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

  // A-01 — the finalization lifecycle owner.
  //
  // Before this, `startFinalize()` had exactly one caller in the whole repository — the
  // command-palette entry at command-palette.tsx:51 — and the path that actually signs a
  // report never touched it. So `isFinalizing` was false during every real finalize:
  // `requestLeaveThen` read false, `canLeaveStudy` returned "ok", and the radiologist who
  // clicked a worklist row while the AI quality evaluation was still running navigated
  // away with no prompt at all. The protection had been written and wired and simply was
  // never armed.
  //
  // `cancelFinalize()` in `finally` is the single cleanup for every exit: a validation
  // failure, a signature-fetch failure, the unreviewed-AI gate, the Form F gate, the
  // radiologist pressing Cancel on the sign dialog, the identity assertion above refusing
  // a moved study, and the catch below. It writes only `isFinalizing: false`, so the
  // success path (where `completeFinalize()` has already cleared the flag and set
  // `isFinalized: true`), the idempotent path (which calls `cancelFinalize()` itself) and
  // the post-sign `goNextStudy()` auto-advance are all unaffected by it.
  const finalizeReport = useCallback(async () => {
    try {
      await runFinalizeGauntlet();
    } finally {
      useWorkspace.getState().cancelFinalize();
    }
  }, [runFinalizeGauntlet]);

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
