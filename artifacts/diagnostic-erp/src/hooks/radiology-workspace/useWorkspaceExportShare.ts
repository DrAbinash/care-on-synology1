/**
 * Word/PDF/print export, teaching-case save, WhatsApp share, and verify/countersign
 * for RadiologyReportingWorkspace. Phase 3 extraction — behavior unchanged.
 */

import {
  useCallback, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { exportRadiologyReportToWord, safeFileNamePart } from "@/lib/radiologyReportWordExport";
import { exportRadiologyReportToPdf } from "@/lib/radiologyReportPdfExport";
import type { ReportKeyImage } from "@/lib/reportPdfGenerator";
import {
  buildLivePrintBodyHtml,
  finalizePrintPreviewHtml,
} from "@/lib/radiologyReportPrintLiveMerge";
import { activeStandardLetterhead, type PresentationTemplatesPayload } from "@/lib/careLetterpadChrome";
import {
  buildPreviewHtml,
  formatReportExportError,
  type ReportHeadingCase,
  type ReportSectionSpacing,
  type ReportImpressionStyle,
} from "@/lib/radiologyReportPreviewHtml";
import type { PrintClinic } from "@/lib/reportPdfGenerator";
import {
  type ReportLayoutKey,
  quickSelectLayoutKey,
  reportLayoutTemplateQuery,
} from "@/components/radiology/ReportLayoutQuickSelect";
import type { ReportImageRef } from "@/lib/reportImageRefs";
import { BROWSER_DICOMWEB_BASE } from "@/lib/browserDicomWeb";
import {
  canalApLevelsFromCanonicalRecord,
  canalApToPdfRows,
  mergeCanalApLevels,
  normalizeDiscLevel,
} from "@/lib/spineCanalAp";
import { canVerifyReport } from "@/lib/workspaceReportState";
import { loadSignerOfRecord, signedReportDisplayState } from "@/lib/radiologyReportLifecycle";
import {
  NO_PRINT_FORMAT_ADJUSTMENT,
  adjustPrintFormat,
  adjustmentForReport,
  formatReportKey,
  printFormatQuery,
  type FormatField,
  type PrintFormatAdjustment,
} from "@/lib/reportPrintFormat";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import { detectCriticalFindings } from "@/lib/criticalResults";
import { criticalCommsEnabled } from "@/lib/criticalResultCommsFlag";
import type { ReportDemography } from "@/lib/reportDemography";
import type { FieldProvenanceMap } from "@/lib/reportFieldMerge";

/** What the Print nudge dialog shows. `elapsedMinutes` is null when no
 *  session SLA clock is running for the study (e.g. the workspace was reloaded
 *  after the finding was detected) — the dialog then says so instead of
 *  inventing a number. */
export interface PrintCriticalNudge {
  labels: string[];
  elapsedMinutes: number | null;
  slaMinutes: number;
}

export type UseWorkspaceExportShareOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  previewLayoutOverride: ReportLayoutKey | null;
  saveDraft: (opts?: { silent?: boolean }) => Promise<number | null>;
  ensureDraftOnce: () => Promise<number | null>;
  /** The editor's dirty flag — D-22's save-before-print needs it. */
  dirty: boolean;
  /** Signed/finalized content lock — a locked study prints without a doomed save. */
  contentLocked: boolean;
  /** The critical-result communication checklist (the same `{ phoned }` signal
   *  the finalize gate reads). Print consults it exactly as finalize does, so
   *  the two doors cannot disagree about whether a critical finding was
   *  communicated. */
  checklistComm: { phoned: boolean; annotated: boolean; dispatched: boolean };
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
  qc: ReturnType<typeof useQueryClient>;
  workflow: {
    currentRow: {
      patientId?: number | null;
      patientName?: string | null;
      accessionNumber?: string | null;
      studyDescription?: string | null;
      modality?: string | null;
      studyId?: number | null;
      studyDate?: string | null;
      referringDoctor?: string | null;
      reportId?: number | null;
      /** radiology_worklist.status — finalization, which is not signing. */
      status?: string | null;
      sex?: string | null;
      age?: string | null;
    } | null;
  };
  existingDraft: { finalReportId?: number | null } | null | undefined;
  canonicalDemography: ReportDemography;
  studyNameForExport: string;
  /**
   * The booked examination, independent of the applied report format's title.
   * Used only for the documented-region sentence: `studyNameForExport` follows
   * the format, and a format titled for the narrower documented region would
   * otherwise leave the PDF saying nothing about what was booked.
   */
  bookedStudyNameForExport: string | null;
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  useStructured: boolean;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  impressionStyle: ReportImpressionStyle;
  headingCase: ReportHeadingCase;
  sectionSpacing: ReportSectionSpacing;
  showLetterpadHeader: boolean;
  signerLine: string;
  findingsProvenance: FieldProvenanceMap;
  impressionProvenance: FieldProvenanceMap;
  /**
   * The frozen key-image rows, in store order. The caption is the stored record's
   * own — Download PDF labels an image with it and prints nothing when it is
   * empty, so this stays one list rather than an image list plus a label list.
   * `id`/`sopInstanceUid` travel with it because an attachment whose pixels cannot
   * be read has to be identified by something other than a caption.
   */
  frozenKeyImages: Array<{
    id: number;
    includeInReport: boolean;
    sortOrder: number;
    imageUrl: string;
    caption: string;
    sopInstanceUid?: string | null;
  }>;
  doctorsCatalog: { name: string; degree?: string | null }[];
  session: {
    user?: {
      name?: string | null;
      role?: string | null;
      permissions?: string[];
    } | null;
  } | null | undefined;
  sessionFresh: { user?: { name?: string | null } | null } | null | undefined;
  canVerifyRef: MutableRefObject<boolean>;
  verifyActionRef: MutableRefObject<(() => void) | null>;
  linkedReportIdRef: MutableRefObject<number | null>;
  setWhatsappShareOpen: Dispatch<SetStateAction<boolean>>;
};

export function useWorkspaceExportShare(opts: UseWorkspaceExportShareOptions) {
  const {
    studyId, draftId, previewLayoutOverride, saveDraft, ensureDraftOnce, toast, qc,
    dirty, contentLocked, checklistComm,
    workflow, existingDraft, canonicalDemography, studyNameForExport,
    bookedStudyNameForExport,
    clinicalHistoryText, techniqueText, findingsText, impressionText, recommendationText,
    useStructured, findingsMap, impressionStyle, headingCase, sectionSpacing,
    showLetterpadHeader, signerLine, findingsProvenance, impressionProvenance,
    frozenKeyImages, doctorsCatalog, session, sessionFresh,
    canVerifyRef, verifyActionRef, linkedReportIdRef, setWhatsappShareOpen,
  } = opts;

  // Alias for verbatim PDF body (doctorsCatalogQ.data)
  const doctorsCatalogQ = { data: doctorsCatalog };

  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printingLikeFinal, setPrintingLikeFinal] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  /**
   * The critical-finding communication nudge at Print: set when the radiologist
   * pressed Print on a report that DESCRIBES a critical finding (live detector,
   * the same input the finalize gate uses) whose communication checklist does
   * not record a call. A NUDGE, not a block — "Print anyway" proceeds — because
   * the print happens before finalize and legitimate reasons exist to hand the
   * referring clinician a printed copy WHILE making the call. Null = no nudge.
   */
  const [printCriticalNudge, setPrintCriticalNudge] = useState<PrintCriticalNudge | null>(null);
  /**
   * D-06 — whether THIS study's report row carries an authorized signature,
   * mirror-of-record style (the same linkedReportIdRef pattern): set from the
   * `signedReport` memo below so the export callbacks read the row's own
   * state at click time, not reactive state captured at render. Fail-safe
   * default true (unauthorized → DRAFT watermark), because only a signature
   * actually on record may print clean.
   */
  const unsignedDraftRef = useRef(true);

  /**
   * The Print Preview typography adjustment for the report currently open.
   *
   * Held as `{ key, adjustment }` rather than a bare number because the
   * workspace is reused when the next study is opened: a size chosen to fit
   * yesterday's lumbar spine must not silently apply to today's brain. The key
   * is checked on read (see `adjustmentForReport`), so a stale adjustment is
   * no adjustment — and nothing is written to localStorage, which is what made
   * the control this replaces one shared setting for every report on the
   * workstation. Session-only by design: the owner asked for a report-specific
   * deviation from Settings, not a second persisted preference.
   */
  const [printFormatStore, setPrintFormatStore] = useState<{
    key: string;
    adjustment: PrintFormatAdjustment;
  } | null>(null);
  /**
   * Click-time mirror of the current adjustment, kept in the same way this hook
   * already keeps `linkedReportIdRef`: the export callbacks are declared above
   * the derivation below, so they cannot list it in a dependency array — and a
   * value captured at first render would export the size of a previous report.
   */
  const printFormatRef = useRef<PrintFormatAdjustment>(NO_PRINT_FORMAT_ADJUSTMENT);

// ─── Word/PDF export (legacy layout path + Classic/Premium) ────────────────
const { data: presentationTemplates } = useQuery<PresentationTemplatesPayload>({
  queryKey: ["presentation-templates"],
  queryFn: () => api.get("/api/radiology/presentation-templates"),
  staleTime: 60_000,
});
const clinicReportLayout = quickSelectLayoutKey(presentationTemplates?.active?.standard);
const reportLayout = previewLayoutOverride ?? clinicReportLayout;

const { data: clinicSettings } = useQuery<PrintClinic>({
  queryKey: ["clinic-settings"],
  queryFn: () => api.get("/api/clinic-settings/branding"),
  staleTime: 5 * 60_000,
});

const { data: imageRefs = [] } = useQuery<ReportImageRef[]>({
  queryKey: ["report-image-references", draftId],
  queryFn: () => api.get(`/api/radiology/report-generator/image-references?draftId=${draftId}`),
  enabled: !!draftId,
});

const livePrintBodyHtml = useMemo(
  () =>
    buildLivePrintBodyHtml({
      clinicalHistory: clinicalHistoryText,
      technique: techniqueText,
      rawFindings: findingsText,
      findingsMap: useStructured ? findingsMap : {},
      useStructured,
      impression: impressionText.split("\n").filter(Boolean),
      recommendation: recommendationText,
      impressionStyle,
      headingCase,
    }),
  [
    clinicalHistoryText, techniqueText, findingsText, findingsMap, useStructured,
    impressionText, recommendationText, impressionStyle, headingCase,
  ],
);

const previewHtml = useMemo(
  () =>
    buildPreviewHtml({
      patientName: canonicalDemography.patientName,
      age: canonicalDemography.age,
      sex: canonicalDemography.sex,
      uhid: canonicalDemography.uhid,
      accessionNumber: canonicalDemography.accessionNumber,
      referringDoctor: canonicalDemography.referringDoctor,
      studyDate: canonicalDemography.studyDate,
      headerStyle: reportLayout === "care-classic" ? "classic" : "table",
      studyName: studyNameForExport,
      technique: techniqueText,
      clinicalHistory: clinicalHistoryText,
      findingsMap: useStructured ? findingsMap : {},
      rawFindings: findingsText,
      useStructured,
      impression: impressionText.split("\n").filter(Boolean),
      recommendation: recommendationText,
      imageRefs,
      headingCase,
      sectionSpacing,
      impressionStyle,
      signerLine,
      findingsProvenance,
      impressionProvenance,
    }),
  [
    canonicalDemography, studyNameForExport, techniqueText, clinicalHistoryText,
    findingsText, impressionText, recommendationText, imageRefs,
    headingCase, sectionSpacing, impressionStyle, signerLine, reportLayout,
    useStructured, findingsMap, findingsProvenance, impressionProvenance,
  ],
);

const handleExportWord = useCallback(async () => {
  setExportingWord(true);
  try {
    let html = previewHtml;
    // Prefer server-rendered letter-pad layout when a draft/report exists.
    if ((reportLayout === "care-premium" || reportLayout === "care-classic") && (draftId || linkedReportIdRef.current)) {
      try {
        await saveDraft({ silent: true });
        const templateQs = reportLayoutTemplateQuery(reportLayout);
        const styleQs = `impressionStyle=${encodeURIComponent(impressionStyle)}`;
        const reportId = linkedReportIdRef.current;
        const formatQs = printFormatQuery(printFormatRef.current);
        const url = reportId
          ? `/api/patient-reports/${reportId}/print?preview=true&${templateQs}&${styleQs}${formatQs}`
          : `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}&${styleQs}${formatQs}`;
        const serverHtml = await api.get<string>(url);
        if (typeof serverHtml === "string" && serverHtml.trim()) {
          // Same rule the PDF door already applies, read at the moment of export:
          // once a signing record exists, the words are the record's, not the
          // screen's. Merging live editor text over a signed report's print HTML
          // produced a Word file of a signed report that carried no signer at all
          // while its own PDF carried the authorized name, registration number and
          // timestamp — one authorized report with two printed forms.
          const authorized = reportId ? (await loadSignerOfRecord(reportId)).signerOfRecord !== null : false;
          const live = readWorkspaceClinicalTexts();
          html = await finalizePrintPreviewHtml(serverHtml, {
            authorizedArtifact: authorized,
            livePrintBodyHtml,
            findingsText: live.findingsText,
            impressionText: live.impressionText,
            dicomWebBase: BROWSER_DICOMWEB_BASE,
            imageRefs,
            includeProvenanceChrome: false,
            demography: {
              patientName: canonicalDemography.patientName,
              age: canonicalDemography.age,
              sex: canonicalDemography.sex,
              referringDoctor: canonicalDemography.referringDoctor,
              studyDate: canonicalDemography.studyDate,
              uhid: canonicalDemography.uhid,
              patientId: canonicalDemography.patientId,
              accessionNumber: canonicalDemography.accessionNumber,
            },
          });
        }
      } catch {
        /* fall back to client previewHtml */
      }
    }
    const fileName = `${safeFileNamePart(workflow.currentRow?.patientName ?? "patient")}_${safeFileNamePart(workflow.currentRow?.accessionNumber ?? "report")}`;
    await exportRadiologyReportToWord(html, fileName, {
      patientName: canonicalDemography.patientName,
      age: canonicalDemography.age,
      sex: canonicalDemography.sex,
      referringDoctor: canonicalDemography.referringDoctor,
      studyDate: canonicalDemography.studyDate,
      chrome: activeStandardLetterhead(presentationTemplates),
      // Word is finished on pre-printed letter-pad — always reserve top margin.
      // (Header ON/OFF still controls the HTML/PDF letterhead chrome.)
      physicalLetterpad: true,
    });
  } catch (err) {
    toast({
      title: "Export failed",
      description: formatReportExportError(err, "Word"),
      variant: "destructive",
    });
  } finally {
    setExportingWord(false);
  }
}, [
  workflow.currentRow, previewHtml, toast, reportLayout, draftId, canonicalDemography,
  presentationTemplates, saveDraft, impressionStyle, livePrintBodyHtml, findingsText,
  impressionText, imageRefs,
]);

const handleExportPdf = useCallback(async () => {
  setExportingPdf(true);
  try {
    // The authorization is read BEFORE anything is fetched or drawn, because it
    // decides which document this is. A report with a signing record downloads the
    // artifact the server froze when it was signed, so the words under the name are
    // the words that name authorized. Anything else — a draft, an unsigned row, a
    // page with no report behind it — is still drawn here from the screen, exactly
    // as it was before.
    const authorizedReportId = linkedReportIdRef.current;
    const { signerOfRecord, unsigned } = await loadSignerOfRecord(authorizedReportId);
    if (signerOfRecord && authorizedReportId != null) {
      // Same file Report Hub's Download PDF produces, from the same route: one
      // signed report must not have two printed forms in one clinic.
      const stem = (canonicalDemography.accessionNumber || canonicalDemography.patientName || "report")
        .replace(/[^a-zA-Z0-9\-_]/g, "_")
        .toLowerCase();
      await api.downloadFile(`/api/patient-reports/${authorizedReportId}/pdf`, `${stem}.pdf`);
      return;
    }
    let measurements: Array<{ label: string; value: string }> = [];
    const spinalKey = workflow.currentRow?.studyId ?? studyId;
    if (spinalKey) {
      try {
        // Two stores, one answer — the same fold the signed body prints from. This
        // call used to read only `spinal_measurements`, the legacy generator's rows,
        // so a number typed into the reporting workspace's grid was absent from the
        // PDF the radiologist exported even though the printed page carried it. Then
        // it picked ONE segment by study hint, which dropped the other half of a
        // Dorso-Lumbar study. Both stores are folded through the canonical record,
        // and the level list comes from the shared print plan, so the export cannot
        // disagree with the signed report about which number a level carries (owner
        // DECISIONS 1 and 2, 2026-10-17).
        const rows = await api.get<Array<{ vertebraLevel: string; canalAP: string | null }>>(
          `/api/radiology/report-generator/spinal-measurements?studyId=${spinalKey}`,
        );
        const legacy = new Map<string, string>();
        for (const r of rows) {
          const value = r.canalAP?.trim();
          if (value) legacy.set(normalizeDiscLevel(r.vertebraLevel) ?? r.vertebraLevel, value);
        }
        measurements = canalApToPdfRows(mergeCanalApLevels(
          legacy,
          canalApLevelsFromCanonicalRecord(useWorkspace.getState().canalApProvenance),
        ));
      } catch { /* omit measurements section */ }
    }
    const frozenForPdf = frozenKeyImages
      .filter((img) => img.includeInReport)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    let frozenDataUrls: ReportKeyImage[] = [];
    if (frozenForPdf.length > 0) {
      frozenDataUrls = await Promise.all(
        frozenForPdf.map(async (img): Promise<ReportKeyImage> => {
          // The stored attachment travels with its own identity whether or not the
          // pixels arrive, because "could not be read" has to name WHICH one. A
          // rejected read used to be filtered out of the list, so the PDF simply
          // had fewer images than the study and nothing said so.
          const carries = {
            caption: img.caption.trim(),
            attachmentId: img.id,
            sopInstanceUid: img.sopInstanceUid ?? null,
          };
          try {
            // Authenticated blob, no credential in the URL. `fetch` can send
            // the Bearer header, and the guarded key-image mount accepts it
            // (with the /radiology permission) precisely so that callers like
            // this one never need a grant. A stored key image is PHI-bearing
            // pixels and is no longer fetched anonymously.
            const blob = await api.getBlob(img.imageUrl);
            const src = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => resolve("");
              reader.readAsDataURL(blob);
            });
            // The caption rides with its own pixels instead of living in a
            // parallel array whose index could drift from the image it labels.
            return { src, ...carries };
          } catch {
            return { src: "", ...carries };
          }
        }),
      );
    }
    // Who this PDF may say authorized it: read above, before the document was
    // chosen. Reaching here with a record means the id was missing, and the door
    // refuses a record it cannot name an artifact for.
    await exportRadiologyReportToPdf({
      patientName: canonicalDemography.patientName,
      age: canonicalDemography.age,
      sex: canonicalDemography.sex,
      accessionNumber: canonicalDemography.accessionNumber,
      uhid: canonicalDemography.uhid,
      studyDate: canonicalDemography.studyDate,
      referringDoctor: canonicalDemography.referringDoctor,
      modality: workflow.currentRow?.modality ?? "",
      bodyPart: workflow.currentRow?.studyDescription ?? "",
      clinicalHistory: clinicalHistoryText,
      technique: techniqueText,
      useStructured,
      findingsMap: useStructured ? findingsMap : {},
      rawFindings: findingsText,
      impression: impressionText.split("\n").filter(Boolean),
      recommendation: recommendationText,
      studyName: studyNameForExport,
      bookedStudyName: bookedStudyNameForExport,
      headingCase,
      impressionStyle,
      dicomWebBase: BROWSER_DICOMWEB_BASE,
      imageRefs,
      frozenKeyImages: frozenDataUrls,
      clinic: clinicSettings ?? null,
      letterhead: activeStandardLetterhead(presentationTemplates),
      showLetterpadHeader,
      measurements,
      doctorsCatalog: doctorsCatalogQ.data ?? [],
      // The signer-authority fields (merged #1088): who may authorize this
      // document, and whether anything has. At this point in the door a signed
      // report has already been redirected to its frozen artifact above, so
      // these carry the draft/unsigned state.
      signerOfRecord,
      unsigned,
      authorizedReportId,
      // D-06 — read from the report row's own signing state at export time
      // (the same `signedReportDisplayState` the badge reads): an unauthorized
      // document exports with the DRAFT watermark. Omitted/unknown/not-signed
      // all count unauthorized, so only a signature actually on record prints
      // clean. Signer identity is not decided here — it is #1088's fields
      // above; this flag only drives the watermark through
      // draftAwarePrintSettings.
      unsignedDraft: unsignedDraftRef.current,
      // Read at export time, like the reporting context above: this is the
      // transition history of the study being printed, not reactive UI state.
      regionTransitions: useWorkspace.getState().regionTransitions,
    });
  } catch (err) {
    toast({
      title: "Export failed",
      description: formatReportExportError(err, "PDF"),
      variant: "destructive",
    });
  } finally {
    setExportingPdf(false);
  }
}, [
  canonicalDemography, clinicalHistoryText, techniqueText, findingsText,
  impressionText, recommendationText, studyNameForExport, headingCase,
  imageRefs, frozenKeyImages, clinicSettings, toast, workflow.currentRow,
  useStructured, findingsMap, presentationTemplates, showLetterpadHeader,
  studyId, doctorsCatalogQ.data,
]);

/** The print itself — the pre-existing save-then-print flow, reached directly
 *  when no nudge applies and from the nudge dialog's "Print anyway". Declared
 *  before the wrapper so its identity can go in the wrapper's deps array. */
const runPrintLikeFinal = useCallback(async () => {
  // D-22 — print what is persisted, not what only the editor remembers. The
  // server print-preview below renders the SAVED draft and then merges the
  // editor's live text over it, so an unsaved study printed a document whose
  // persisted twin was missing the newest sentences — and when that merge
  // failed, a stale preview silently. A dirty, writable study is therefore
  // saved first, and a failed save ABORTS the print: a red toast is honest, a
  // print of a version that is not on the server is not. A signed study
  // (contentLocked) prints without a save attempt — there is nothing to save
  // and the attempt is certain to be refused.
  if (dirty && !contentLocked) {
    const saved = await saveDraft({ silent: true });
    if (saved == null) {
      toast({
        title: "Save before print",
        description: "The report could not be saved, so nothing was printed. Save the report, then print.",
        variant: "destructive",
      });
      return;
    }
  }
  let id = draftId;
  if (!id) id = await ensureDraftOnce();
  if (!id) {
    toast({ title: "Could not save draft", description: "Print-like-final needs a saved draft.", variant: "destructive" });
    return;
  }
  setPrintingLikeFinal(true);
  const w = window.open("", "_blank");
  if (!w) {
    setPrintingLikeFinal(false);
    toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" });
    return;
  }
  try {
    const templateQs = reportLayoutTemplateQuery(reportLayout);
    const styleQs = `impressionStyle=${encodeURIComponent(impressionStyle)}`;
    // The per-report typography the radiologist stepped the preview to must
    // reach the paper too — the Word export and the preview panel already
    // carry it; without it here the print came out at the clinic default and
    // did not match the preview it was approved from.
    const formatQs = printFormatQuery(printFormatRef.current);
    const url = `/api/radiology/report-generator/drafts/${id}/print-preview?autoPrint=true&likeFinal=true&${templateQs}&${styleQs}&${formatQs}`;
    let html = await api.get<string>(url);
    if (typeof html !== "string" || !html.trim()) {
      throw new Error("Empty print preview");
    }
    // Merge unsaved editor text into server layout; hydrate key images client-side.
    html = await finalizePrintPreviewHtml(html, {
      livePrintBodyHtml,
      findingsText,
      impressionText,
      dicomWebBase: BROWSER_DICOMWEB_BASE,
      imageRefs,
      includeProvenanceChrome: false,
      demography: {
        patientName: canonicalDemography.patientName,
        age: canonicalDemography.age,
        sex: canonicalDemography.sex,
        referringDoctor: canonicalDemography.referringDoctor,
        studyDate: canonicalDemography.studyDate,
        uhid: canonicalDemography.uhid,
        patientId: canonicalDemography.patientId,
        accessionNumber: canonicalDemography.accessionNumber,
      },
    });
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  } catch (err) {
    w.close();
    toast({
      title: "Print preview failed",
      description: err instanceof Error ? err.message : "Could not open print layout.",
      variant: "destructive",
    });
  } finally {
    setPrintingLikeFinal(false);
  }
}, [
  draftId, reportLayout, ensureDraftOnce, toast, imageRefs, impressionStyle,
  livePrintBodyHtml, findingsText, impressionText, canonicalDemography,
  dirty, contentLocked, saveDraft,
]);

/** "Print anyway" from the nudge dialog: clears the nudge and runs the print
 *  with the same save-before-print guarantees as an unnudged print. */
const confirmedPrintLikeFinal = useCallback(async () => {
  setPrintCriticalNudge(null);
  await runPrintLikeFinal();
}, [runPrintLikeFinal]);

const handlePrintLikeFinal = useCallback(async () => {
  // ── Critical-finding communication nudge ──
  // The finalize gate already refuses to sign an uncommunicated critical
  // finding, but Print is an EARLIER door on the same report (the clinic's
  // chain runs ... Recommendation → Print → finalize): the paper copy is how
  // the finding reaches the referring clinician's hands, so this is the last
  // moment a reminder costs nothing. Gated on the comms flag exactly like
  // every other workflow surface, and skipped for a signed study — finalize
  // already demanded the communication for it, and a reprint must not nag.
  if (criticalCommsEnabled() && !contentLocked) {
    const hits = detectCriticalFindings(findingsText, [impressionText]);
    if (hits.length > 0 && !checklistComm.phoned) {
      const ws = useWorkspace.getState();
      const start = ws.activeStudyId ? (ws.criticalSlaStarts[ws.activeStudyId] ?? null) : null;
      setPrintCriticalNudge({
        labels: hits.map((h) => h.label),
        elapsedMinutes: start != null ? Math.max(0, Math.floor((Date.now() - start) / 60_000)) : null,
        slaMinutes: ws.criticalSlaMinutes,
      });
      return;
    }
  }
  await runPrintLikeFinal();
}, [findingsText, impressionText, checklistComm, contentLocked, runPrintLikeFinal]);

// ─── Teaching case save ─────────────────────────────────────────────────────
const handleSaveTeachingCase = useCallback(async () => {
  if (!studyId) return;
  try {
    const live = readWorkspaceClinicalTexts();
    await api.post("/api/teaching-cases/generate-from-report", {
      studyId,
      findings: live.findingsText,
      impression: live.impressionText,
      modality: workflow.currentRow?.modality,
      studyDescription: workflow.currentRow?.studyDescription,
      patientName: workflow.currentRow?.patientName,
    });
    toast({ title: "Saved as teaching case" });
  } catch (err) { toast({ title: "Teaching case save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }); }
}, [studyId, toast, workflow.currentRow]);

// ─── Verify / countersign (legacy D9) — additive; does not replace Finalize ─
const linkedReportId = useMemo(() => {
  const row = workflow.currentRow as { reportId?: number | null } | null | undefined;
  const draft = existingDraft as { finalReportId?: number | null } | null | undefined;
  return draft?.finalReportId ?? row?.reportId ?? null;
}, [workflow.currentRow, existingDraft]);
linkedReportIdRef.current = linkedReportId;

/** The report the typography adjustment belongs to: its row, else the draft, else the study. */
const printFormatKey = formatReportKey({ linkedReportId, draftId, studyId });
const printFormat = adjustmentForReport(printFormatKey, printFormatStore);
printFormatRef.current = printFormat;
const stepPrintFormat = useCallback((field: FormatField, delta: number) => {
  if (!printFormatKey) return;
  setPrintFormatStore({
    key: printFormatKey,
    adjustment: adjustPrintFormat(adjustmentForReport(printFormatKey, printFormatStore), field, delta),
  });
}, [printFormatKey, printFormatStore]);

// ─── Report share (WhatsApp) — dialog with phone + verify-then-send ─────────
const handleShare = useCallback(() => {
  const reportId = linkedReportIdRef.current;
  if (!reportId) {
    toast({
      title: "Finalize the report first",
      description: "WhatsApp send needs a signed patient report. Use Finalize, then Share.",
      variant: "destructive",
    });
    return;
  }
  setWhatsappShareOpen(true);
}, [toast]);

const { data: finalReport } = useQuery<{
  id?: number;
  signedByName?: string | null;
  /** The three witnesses `isSignedArtifact` counts — signed_at, the status
   *  list, and a D5 structured document whose audit signature is final. A
   *  D5-signed row keeps the schema-default `status: "draft"`, so status alone
   *  sees neither of the last two. */
  signedAt?: string | Date | null;
  structuredJson?: { audit?: { signature?: { state?: string } } } | null;
  status?: string | null;
  lifecycle?: { state?: string; superseded?: boolean };
  version?: { superseded?: boolean };
}>({
  queryKey: ["workspace-final-report", linkedReportId],
  queryFn: () => api.get(`/api/patient-reports/${linkedReportId}`),
  enabled: !!linkedReportId,
});

/**
 * What the workspace is allowed to SAY about the report behind this study.
 *
 * Read from the server's own row, never inferred from `linkedReportId`: a
 * report row can exist and be bound while the signature did not happen (no
 * active signature on file, or 2+ and ambiguous — `autoSignReport` declines
 * rather than guess an author). The badge and the finalize button used to key
 * on the id alone, so an unsigned row read "Report signed" in green while the
 * toast three seconds earlier had said "Report saved but NOT signed".
 */
const signedReport = useMemo(() => {
  // One read of the queue row for the whole workspace. `signedElsewhereControlLock`
  // keeps this count pinned because a second hand-rolled `REPORT_FINAL` check
  // somewhere else can disagree with `contentLocked`, which prefers the detail
  // query — so the caption is taken from here rather than recomputed in the
  // canvas, and the badge and the button cannot tell two stories about one study.
  const studyFinal =
    workflow.currentRow?.status === "REPORT_FINAL" || workflow.currentRow?.status === "DELIVERED";
  return {
    ...signedReportDisplayState({
      reportId: linkedReportId,
      report: (finalReport as Record<string, unknown> | null | undefined) ?? null,
      studyFinal,
    }),
    studyFinal,
  };
}, [linkedReportId, finalReport, workflow.currentRow]);
unsignedDraftRef.current = signedReport.state !== "signed";

/**
 * A signed report prints as it was signed. The server already refuses the
 * typography nudge for any row with a signature on record, so the control is
 * disabled here instead of offering a click that changes nothing — and the
 * reason is stated in the preview, because "the buttons do not work" reads
 * exactly like a broken feature.
 */
const printFormatLocked = signedReport.state === "signed";

const verifyGate = useMemo(
  () => canVerifyReport(
    {
      subjectName: session?.user?.name ?? undefined,
      role: session?.user?.role ?? undefined,
      permissions: (session?.user as { permissions?: string[] } | undefined)?.permissions,
    },
    finalReport ?? null,
  ),
  [session, finalReport],
);
const reportSuperseded = Boolean(finalReport?.version?.superseded || finalReport?.lifecycle?.superseded);
const canShowVerify = Boolean(finalReport) && verifyGate.allowed && !reportSuperseded;
canVerifyRef.current = canShowVerify;

const handleVerifyReport = useCallback(async () => {
  if (!finalReport || verifyBusy) return;
  const targetId = finalReport.id ?? linkedReportId;
  if (!targetId) return;
  setConfirmVerify(true);
}, [finalReport, verifyBusy, linkedReportId]);

const confirmedVerifyReport = useCallback(async () => {
  setConfirmVerify(false);
  setVerifyBusy(true);
  try {
    const targetId = finalReport?.id ?? linkedReportId;
    if (!targetId) return;
    await api.post(`/api/patient-reports/${targetId}/verify`, {
      verifiedByName: sessionFresh?.user?.name ?? undefined,
    });
    toast({ title: "Report verified" });
    void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
  } catch (err) {
    toast({
      title: "Verify failed",
      description: err instanceof Error ? err.message : "Error",
      variant: "destructive",
    });
  } finally {
    setVerifyBusy(false);
  }
}, [finalReport, linkedReportId, sessionFresh, toast, qc]);

verifyActionRef.current = () => {
  if (canShowVerify && !verifyBusy) void handleVerifyReport();
};

  return {
    exportingWord,
    exportingPdf,
    printingLikeFinal,
    presentationTemplates,
    clinicSettings,
    imageRefs,
    clinicReportLayout,
    reportLayout,
    livePrintBodyHtml,
    previewHtml,
    handleExportWord,
    handleExportPdf,
    handlePrintLikeFinal,
    confirmedPrintLikeFinal,
    printCriticalNudge,
    setPrintCriticalNudge,
    handleSaveTeachingCase,
    handleShare,
    linkedReportId,
    linkedReportIdRef,
    finalReport,
    signedReport,
    verifyGate,
    canShowVerify,
    handleVerifyReport,
    confirmedVerifyReport,
    confirmVerify,
    setConfirmVerify,
    verifyBusy,
    printFormat,
    printFormatLocked,
    stepPrintFormat,
  };
}
