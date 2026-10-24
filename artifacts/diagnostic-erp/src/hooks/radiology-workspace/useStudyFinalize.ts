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
import { eligibleSigners, type SignerRow } from "@/lib/reportSignerEligibility";
import { readStaffSession } from "@/lib/staffSession";
import {
  classifyHopeDeliveryError,
  classifyHopeDeliveryResponse,
  hopeDeliveryToast,
  type HopeEmitSuccess,
} from "@/lib/hopeDeliveryOutcome";
import {
  finalizeContextForWorkspaceStudy,
  finalizeRadiologyReport,
  isFinalizeCompletion,
} from "@/lib/radiologyReportLifecycle";
import { validateReport } from "@/lib/reportValidator";
import { formatQualityAdvisoryForDialog } from "@/lib/reportQualityFinalize";
import {
  FINALIZE_CHECK_LABELS,
  incompleteFinalizeChecks,
  runFinalizeCheck,
  skippedFinalizeCheck,
  type FinalizeCheckOutcome,
  type FinalizeServiceChecks,
} from "@/lib/finalizeChecks";
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
import type { FinalizePromptInput, FinalizePromptResult } from "@/hooks/useFinalizeFlow";

export type UseStudyFinalizeOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  isOnline: boolean;
  checklistPercent: number;
  saveDraft: (opts?: { silent?: boolean }) => Promise<number | null>;
  finalizeFlow: {
    promptFinalize: (args: FinalizePromptInput) => Promise<FinalizePromptResult>;
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
      /** radiology_studies.id for this worklist row — null while unbilled.
       *  Read by `finalizeContextForWorkspaceStudy`, which keeps it out of the
       *  row-id slot; see the two-id-space note there. */
      studyId?: number | string | null;
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
  /** Last resort for the stored `patient_reports.title` when the queue row
   *  (and its DICOM description) is absent — a deep-linked or queue-filtered
   *  study. Fed by the caller from the by-id detail row, then the billed
   *  catalogue name, then the applied format's title, so the signed artifact
   *  never carries the bare word "Report" while a real name exists. */
  titleFallback?: string | null;
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
  // 2b + 3b. The two service checks, each keeping WHETHER it ran.
  //
  // Both used to report a failure as an absence: the draft validator swallowed
  // its rejection in an empty catch, and a failed quality evaluation left
  // `qualityGate` null, which makes the dialog hide its quality block — the same
  // silence as a report with nothing wrong with it. A radiologist could not tell
  // "clean" from "never looked", and the signed record said nothing either way.
  //
  // Wrapped as one closure because the dialog's Retry button re-runs exactly what
  // this gauntlet ran the first time: no second draft save, no second identity
  // assertion, no re-prompt, and nothing added to what signing requires. These
  // checks were advisory before this change and are advisory now; whether a failed
  // check should stop a signature is the owner's policy decision (ARCHITECTURE.md
  // §8.1), not something a reliability fix gets to make.
  // Read once, before the checks, for the same reason `live` is: the dialog is
  // showing this text and this study, so a Retry has to re-evaluate that same
  // snapshot — not whatever the worklist row or the store has become meanwhile.
  const checkModality = workflow.currentRow.modality;
  const checkStudyDescription = workflow.currentRow.studyDescription;

  const runServiceChecks = async (): Promise<FinalizeServiceChecks> => {
    const serverIssues: string[] = [];
    let gate: Awaited<ReturnType<typeof runFinalizeQualityEvaluation>> | null = null;

    // FEW-CLICKS: both service checks are independent reads of the SAME saved
    // snapshot (step 1 saved it above) — neither consumes the other's output —
    // but they used to run one-after-the-other, so the gauntlet paid two
    // serialized round-trips before the sign dialog could appear. One
    // Promise.all pays for one. The outcomes keep declaration order
    // (validateDraft, qualityEvaluation) so `checksIncomplete` and the
    // dialog's "not checked" list stay deterministic, and the skip path stays
    // a value, not a silence.
    const [draftOutcome, qualityOutcome] = await Promise.all([
      effectiveDraftId
        ? runFinalizeCheck("validateDraft", async () => {
            const serverVal = await api.post<{
              structured?: { errors?: unknown[]; warnings?: string[]; skipReasons?: string[] };
            }>("/api/radiology/report-generator/validate-draft", { draftId: effectiveDraftId });
            return serverVal?.structured ?? {};
          })
        : // A finalize with no saved draft to validate. Nothing was pushed here
          // before, so `checksIncomplete` stayed empty and the sign dialog's
          // "Not checked" block never rendered: the screen for "validation
          // unavailable" was the same screen as "validation passed". Recorded
          // as a SKIP rather than a failure because Retry re-runs this closure
          // over the same still-absent draft — naming it a failure would offer
          // a remedy that cannot work.
          Promise.resolve(
            skippedFinalizeCheck("validateDraft", "this report has no saved draft for the server to validate"),
          ),
      runFinalizeCheck("qualityEvaluation", () =>
        runFinalizeQualityEvaluation({
          draftId: effectiveDraftId,
          modality: checkModality,
          studyDescription: checkStudyDescription,
          clinicalHistory: live.clinicalHistoryText,
          technique: live.techniqueText,
          findings: live.findingsText,
          impression: live.impressionText,
          recommendation: live.recommendationText,
          checklistPercent: studySetup.checklistPercent,
          sex: patientSex,
          age: patientAge,
        }),
      ),
    ]);

    const outcomes: FinalizeCheckOutcome<unknown>[] = [draftOutcome, qualityOutcome];
    if (draftOutcome.state === "completed") {
      for (const e of draftOutcome.value.errors ?? []) serverIssues.push(typeof e === "string" ? e : JSON.stringify(e));
      for (const w of draftOutcome.value.warnings ?? []) serverIssues.push(w);
      for (const s of draftOutcome.value.skipReasons ?? []) serverIssues.push(s);
    }
    if (qualityOutcome.state === "completed") gate = qualityOutcome.value;

    return {
      validationSummary: [...validationIssues, ...serverIssues].join("; ")
        + (gate ? formatQualityAdvisoryForDialog(gate) : ""),
      qualityGate: gate,
      checksIncomplete: incompleteFinalizeChecks(outcomes),
    };
  };

  // 5. Get signatures — the fetch STARTS here, alongside the service checks,
  // and is awaited at step 5 below where its failure surface has always been.
  // Three independent reads (validate-draft, quality evaluation, signature
  // pool) used to run strictly one-after-the-other, so the gauntlet paid three
  // serialized round-trips before the sign dialog could appear — pure latency
  // at the exact moment the radiologist is waiting to click Confirm. The no-op
  // observer keeps an early abort (an exception in the sync code between the
  // two awaits) from surfacing an unhandled rejection; the real await below
  // still owns the failure.
  //
  // Only the eligible pool is handed to the dialog, decided from the records by
  // reportSignerEligibility.ts. This list used to be sorted so that a particular
  // person's name came first, and that sort is what let the dialog preselect her and
  // hide the "Sign as" picker even with a second radiologist's block active.
  const signaturesPromise = api.get<SignerRow[]>("/api/signatures");
  signaturesPromise.catch(() => {});
  const checks = await runServiceChecks();
  const qualityGate = checks.qualityGate;
  if (checks.checksIncomplete.length > 0) {
    toast({
      title: `Validation checks incomplete (${checks.checksIncomplete.length})`,
      // "did not finish" would be a lie for the skipped check: it was never
      // attempted, so it never finished. Whether Retry can help is answered in the
      // dialog, which is the only place that knows which of the two it was.
      description: `${checks.checksIncomplete.map((f) => FINALIZE_CHECK_LABELS[f.key]).join(", ")} did not run on this report. `
        + "The sign dialog lists what was not checked and why.",
    });
  }

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

  // 5. Await the signature pool (fetch started alongside the service checks —
  // see the kickoff above). Only the eligible pool is handed to the dialog,
  // decided from the records by reportSignerEligibility.ts. This list used to
  // be sorted so that a particular person's name came first, and that sort is
  // what let the dialog preselect her and hide the "Sign as" picker even with
  // a second radiologist's block active.
  const signatureRows = await signaturesPromise;
  // Offered pool = this account's own blocks (plus any never claimed). A block that
  // belongs to a colleague is not the reporter's to sign with, and the server now
  // refuses it; filtering here is what stops the dialog from defaulting to one.
  const signatures = eligibleSigners(signatureRows, readStaffSession()?.user?.id ?? null);

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
    validationSummary: checks.validationSummary,
    warningBlock: safetyIssues.filter(i => i.severity === "warn").map(i => i.message).join("; "),
    safetyBlock: formatFinalizeSafety(safetyIssues),
    unbilledNote: "",
    signatures: signatures,
    qualityGate,
    // What did not run, and how to run it again. The dialog is the only place
    // this can be said — by the time the report is signed the moment has passed.
    checksIncomplete: checks.checksIncomplete,
    onRetryChecks: runServiceChecks,
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

  // 6a. The dialog was asynchronous — re-check what it gated, against the LIVE
  // store. The composition gate's input (`compositionImpressionNeedsRefresh`)
  // was snapshotted before the prompt; an impression that went stale WHILE the
  // dialog was open (a background apply, the derived-impression effect) signed
  // with no gate at all, because nothing read the dependency again. The review
  // acknowledgement counts: that IS the gate's other exit.
  if (useWorkspace.getState().impressionNeedsRefresh && !result.impressionReviewedAnyway) {
    toast({
      title: "Not signed — the Impression needs a refresh",
      description:
        "Findings changed while the finalize dialog was open. Reopen Finalize and refresh (or review) the Impression, then sign.",
      variant: "destructive",
      duration: 10000,
    });
    return;
  }
  // 6b. A refresh (or any edit) inside the dialog wrote the store AFTER the
  // draft was saved at step 1. Without a re-save, the signed payload and the
  // persisted draft diverge — D5's staleness cross-check sees the mismatch and
  // silently falls back to legacy, and a reopen rehydrates the pre-refresh
  // text. Saving here is idempotent and cheap when nothing changed.
  if (useWorkspace.getState().isDirty) {
    await saveDraft({ silent: true });
  }

  // 7. Execute finalize — read narrative AFTER refresh/ack so the signed payload matches the gate.
  const signed = useWorkspace.getState();
  const signedFindings = signed.findingsText;
  const signedImpression = signed.impressionText;
  const signedRecommendation = signed.recommendationText;
  const linkedForFinalize = signed.linkedStudy;
  // Deep-linked / queue-filtered studies have no `workflow.currentRow`; the
  // old chain stored the bare word "Report" as the signed artifact's title.
  // Blank-safe: an empty DICOM description falls through like an absent one.
  // The fallback is the caller's canonical chain (billed name → DICOM
  // description → applied format title — resolveCanonicalStudyTitle), so the
  // SIGNED artifact's heading is the same authority the preview drew and the
  // print route prints; the queue row's own DICOM description is the deep-link
  // safety net, not the winner.
  const primaryStudyTitle =
    opts.titleFallback?.trim()
    || workflow.currentRow?.studyDescription?.trim()
    || "Report";
  const combinedTitle = linkedForFinalize
    ? `${primaryStudyTitle} + ${linkedForFinalize.title}`
    : primaryStudyTitle;
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
  // signatureId, advanceToNext); `impressionRefreshed` is consumed inside the
  // dialog itself (it gates canConfirm there, and onRefreshImpression really calls
  // refreshImpressionFromLedger), while `impressionReviewedAnyway` is now read here
  // as well as there — it is the durability of a review, see below. The last
  // two existed only to travel outward and were dropped, which is what made the
  // dialog's second checkbox a promise nothing kept. internal-radiology.ts
  // spreads auditDetails into the REPORT_STATUS_UPDATED audit row's `details`,
  // so that row is where an attestation with no outbound channel belongs.
  // A "reviewed anyway" tick is a decision about the Findings→Impression
  // dependency, so it is recorded as one — after A-01 has proved the open study is
  // still this study. Without this the acknowledgement lived only in this session
  // and the same report nagged again after a reload, which is how a warning trains
  // a radiologist to click through it. It writes no clinical text and it does not
  // touch authorization: the gate below is the same one, answered by the same
  // predicate, and any later change to the Findings arms it again.
  if (result.impressionReviewedAnyway) useWorkspace.getState().markImpressionReviewed();
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
  // Recorded on every signature, empty included: "signed with clean checks" and
  // "signed with nothing checked" have to be distinguishable after the fact, and
  // the dialog's Retry may have fixed the list between opening and signing — so
  // the value written is the one the radiologist was shown, not the first attempt.
  signingAuditDetails.validationChecksIncomplete =
    result.checksIncompleteAtSigning ?? checks.checksIncomplete.map((f) => f.key);

  // 6c. RIS throughput — the one-click sign & print. The popup is opened at the
  // LAST user gesture on this path (the dialog's Confirm click just resolved);
  // everything after this point is a chain of awaits (re-save → sign → status)
  // that a popup blocker can outlast. Filled only once the signature has
  // landed; every refusal path closes it again, so nothing blank outlives a
  // failed sign.
  const printWindow = result.printAfterSigning ? window.open("", "_blank") : null;
  if (result.printAfterSigning && !printWindow) {
    toast({
      title: "Popup blocked",
      description: "Allow popups for this site to print the signed report.",
      variant: "destructive",
    });
  }

  try {
    const finalizeResult = await finalizeRadiologyReport(
      // `studyId` here is the ROUTE param — radiology_worklist.id, the key the
      // whole workspace uses. It is NOT a billed study id, and the lifecycle's
      // `studyId` field is; `finalizeContextForWorkspaceStudy` keeps the two
      // apart so the from-study prefill cannot answer with the study that
      // happens to share this row's number.
      finalizeContextForWorkspaceStudy({
        worklistRowId: studyId,
        row: workflow.currentRow,
        linked: linkedForFinalize,
      }),
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
      // Not a success path either way — but there are two different failures
      // here and the old wording claimed the louder one for both.
      //
      // When the status flip WAS sent, the row really is REPORT_FINAL with no
      // report behind it: nothing to print, nothing to send, nothing in Report
      // Hub. When the flip was WITHHELD — which is what the lifecycle does for a
      // study that HAS a patient but no resolvable billed test, precisely
      // because closing a study over no report is how a radiologist ends up with
      // one that shows as final and can never be signed — the row is still
      // STUDY_RECEIVED and nothing changed at all. Telling the radiologist the
      // study was "marked final" in that case would be a second false statement
      // sitting on top of the first.
      toast({
        title: finalizeResult.reportStatusSent
          ? "Study marked final — but NO report was created"
          : "NOT signed and NOT finalized — no report was created",
        description: finalizeResult.reportCreationSkipped.includes("no patient")
          ? "No patient is linked to this study, so there is no billable patient to attach a report to. Nothing has been printed or sent. Link the study to its patient and bill in Match Center, then finalize again."
          : finalizeResult.reportStatusSent
            ? `No patient report row created: ${finalizeResult.reportCreationSkipped}`
            : `Nothing was written: ${finalizeResult.reportCreationSkipped}. The study stays open and stays in your queue, and your draft is still saved on this device. If this study is billed, its test could not be resolved — check the bill in Match Center, then finalize again.`,
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

    // Freeze-at-sign honesty: a picture the radiologist attached that could NOT
    // be captured into the signed artifact prints as "IMAGE COULD NOT BE READ"
    // on the delivered document. Saying nothing here would let a signed report
    // go out missing evidence the radiologist believes it carries.
    if ((finalizeResult.frozenImageRefs?.placeholders ?? 0) > 0) {
      const n = finalizeResult.frozenImageRefs!.placeholders;
      toast({
        title: n === 1 ? "1 attached image could not be captured" : `${n} attached images could not be captured`,
        description:
          `${n === 1 ? "An image" : "Some images"} attached to this report could not be fetched from PACS at signing, `
          + "so the signed copy marks each one IMAGE COULD NOT BE READ. Check PACS availability and re-attach before sharing.",
        variant: "destructive",
        duration: 12000,
      });
    }

    // 7b. Auto-push to Hope when this study is linked to a Hope referral.
    // Skipped on the idempotent path: the report on screen was not written, so a
    // delivery message would describe a document the radiologist was just told
    // was not saved.
    //
    // Delivery is reported separately from signing, and never as a substitute for it.
    // The push can answer in three different ways that all used to look identical from
    // here: accepted by Hope, queued for retry, or refused. One `.catch(() => {})`
    // swallowed all three, so a report that never left CARE read as a signed report on
    // Hope. The classifier owns that distinction; nothing here re-decides it, and no
    // outcome touches the signed state — the radiologist never re-signs for an
    // integration failure.
    if (!finalizeResult.idempotent && finalizeResult.signed && (finalizeResult.reportId || studyId)) {
      void api
        .post<HopeEmitSuccess>("/api/internal/radiology/send-report-to-hope", {
          reportId: finalizeResult.reportId ?? undefined,
          worklistId: studyId,
        })
        .then((res) => {
          const msg = hopeDeliveryToast(classifyHopeDeliveryResponse(res));
          if (msg) toast(msg);
        })
        .catch((err) => {
          const msg = hopeDeliveryToast(classifyHopeDeliveryError(err));
          if (msg) toast(msg);
        });
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
    //
    // Gated on what the server ACTUALLY ended up holding, not on "the call did
    // not throw". `finalizeRadiologyReport` returns normally when it skips the
    // report row, so `!idempotent` was the only false case and everything below
    // ran on a finalize that wrote nothing: the study left the queue, both local
    // backups were deleted, the editors locked, the reading session was credited
    // and the queue advanced. Measured on the synthetic CT: `from-study/4 → 404`,
    // no create, no status flip, editors locked, while the queue response for the
    // same row still read `{status: "STUDY_RECEIVED", reportId: null}`.
    const completedFinalize = isFinalizeCompletion(finalizeResult);
    if (completedFinalize) {
      workflow.markCompleted(studyId);
      if (linkedForFinalize?.studyId) {
        const linkedId = Number(linkedForFinalize.studyId);
        // The linked study leaves the queue only when ITS flip actually
        // landed. A 409 (soft-final block, match gate, unlinked confirm,
        // lock) leaves it STUDY_RECEIVED on the server — dropping it here
        // made the billed study behind it vanish from the session while
        // still unreported.
        if (Number.isInteger(linkedId) && !finalizeResult.linkedMarkError) {
          workflow.markCompleted(linkedId);
        }
      }
      draftBackup.clear();
      clearRescueDraft();
      useWorkspace.getState().completeFinalize();
      setReadingSession(prev => bumpSessionCompleted(prev));
    } else {
      // Nothing was written — by the idempotent refusal (the server returned the
      // existing row and discarded this body) or by a skipped creation for a
      // study whose billed test could not be resolved. Either way the study stays
      // open, stays in the queue and keeps both local backups, because they are
      // the only surviving copy of what was just not saved.
      // `cancelFinalize` rather than no call at all — otherwise `isFinalizing`
      // stays true and the workspace is left showing a permanent finalizing
      // state over a report that never changed.
      useWorkspace.getState().cancelFinalize();
    }

    // 9. Invalidate queries
    qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });
    // The per-study detail query now carries the authoritative signed status the
    // workspace locks on; without this the lock keeps reading the pre-sign row
    // until its 60 s staleTime expires.
    qc.invalidateQueries({ queryKey: ["pacs-worklist-detail", studyId] });
    // And the row itself, because the completion chip now reads its claim off
    // the report's signature witnesses rather than off `reportId`. This runs for
    // the refusal outcomes too: on a finalize that created the row but could not
    // sign it, the cached row — if there is one at all — says something else, and
    // leaving it would let a stale entry justify the wrong badge.
    qc.invalidateQueries({ queryKey: ["workspace-final-report"] });

    // 9b. Print-after-sign — fill the tab the Confirm click opened, but only
    // with a report that exists: an idempotent refusal or a skipped creation
    // wrote nothing, and a silent close is what a blocked study should see (its
    // toast already said why nothing was signed). The SIGNED artifact prints
    // itself — the server /print route embeds the autoPrint script, same door
    // Report Hub's Print button uses.
    if (printWindow) {
      if (completedFinalize && finalizeResult.reportId) {
        try {
          const html = await api.get<string>(`/api/patient-reports/${finalizeResult.reportId}/print`);
          if (typeof html === "string" && html.trim()) {
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
          } else {
            printWindow.close();
          }
        } catch (err) {
          printWindow.close();
          toast({
            title: "Signed report could not be printed",
            description: err instanceof Error ? err.message : "The report is signed; print it from Report Hub.",
            variant: "destructive",
          });
        }
      } else {
        printWindow.close();
      }
    }

    // 10. RIS throughput — auto-advance to the next eligible study.
    // goNextStudy handles the transition lock + wrong-patient arrival
    // cross-check and toasts "End of queue" when nothing eligible remains.
    // The just-finalized study is excluded by identity (currentId), so the
    // not-yet-rendered completedIds update cannot cause a self-advance.
    //
    // Only after a finalize that actually completed. Advancing is what turned
    // "nothing was written" into the three symptoms that made this a P0: the
    // study left the queue on the strength of a completion that had not
    // happened, `goNextStudy()` moved the ROUTE underneath the still-open
    // gauntlet, `useStudyLock` then claimed the next row for a study the
    // radiologist never opened, and the autosave that was still carrying the
    // previous study's captured id hit `save-draft` with two different studies
    // in one request — DRAFT_WORKLIST_MISMATCH, with the patient header
    // changing underneath the text being saved. A study that was not finalized
    // is still the study the radiologist is reading.
    if (result.advanceToNext && completedFinalize) {
      goNextStudy();
    }
  } catch (err) {
    printWindow?.close();
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
