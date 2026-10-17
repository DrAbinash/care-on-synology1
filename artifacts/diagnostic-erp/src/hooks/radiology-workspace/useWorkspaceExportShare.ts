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
import { useWorkspace } from "@/lib/zai-workspace/store";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";
import type { ReportDemography } from "@/lib/reportDemography";
import type { FieldProvenanceMap } from "@/lib/reportFieldMerge";

export type UseWorkspaceExportShareOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  previewLayoutOverride: ReportLayoutKey | null;
  saveDraft: (opts?: { silent?: boolean }) => Promise<number | null>;
  ensureDraftOnce: () => Promise<number | null>;
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
        const url = reportId
          ? `/api/patient-reports/${reportId}/print?preview=true&${templateQs}&${styleQs}`
          : `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}&${styleQs}`;
        const serverHtml = await api.get<string>(url);
        if (typeof serverHtml === "string" && serverHtml.trim()) {
          const live = readWorkspaceClinicalTexts();
          html = await finalizePrintPreviewHtml(serverHtml, {
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

const handlePrintLikeFinal = useCallback(async () => {
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
    const url = `/api/radiology/report-generator/drafts/${id}/print-preview?autoPrint=true&likeFinal=true&${templateQs}&${styleQs}`;
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
]);

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
  status?: string | null;
  lifecycle?: { state?: string; superseded?: boolean };
  version?: { superseded?: boolean };
}>({
  queryKey: ["workspace-final-report", linkedReportId],
  queryFn: () => api.get(`/api/patient-reports/${linkedReportId}`),
  enabled: !!linkedReportId,
});

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
    handleSaveTeachingCase,
    handleShare,
    linkedReportId,
    linkedReportIdRef,
    finalReport,
    verifyGate,
    canShowVerify,
    handleVerifyReport,
    confirmedVerifyReport,
    confirmVerify,
    setConfirmVerify,
    verifyBusy,
  };
}
