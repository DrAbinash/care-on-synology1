/**
 * presentationTemplateSeeds.ts — Ticket R1.2: the system template versions.
 *
 * Each seed is version 1 of an immutable template key. care-classic and
 * care-premium compile to EXACTLY the R1.1 presentation (pinned by tests) so
 * existing deployments render byte-compatibly; the other six are brand/copy
 * variants over the SAME canonical render model — no radically different
 * clinical layouts. Seeds live in code (no seeding migration needed): the
 * store resolves (key, version) against the database first and falls back
 * here, and "reset to default" selects care-classic v1.
 */

import {
  type CopyType, type TemplateDefinition, type TemplateVersionRecord,
} from "./presentationTemplateModel";

const SEGOE = "'Segoe UI', Helvetica, Arial, sans-serif";
const GEORGIA = "Georgia, 'Times New Roman', serif";

function seed(
  templateKey: string,
  displayName: string,
  description: string,
  copyType: CopyType,
  definition: TemplateDefinition,
): TemplateVersionRecord {
  return {
    templateKey, version: 1, displayName, description,
    orgScope: "global", copyType, status: "published",
    rendererVersion: 1, isSystem: true, definition,
  };
}

export const PRESENTATION_TEMPLATE_SEEDS: TemplateVersionRecord[] = [
  // ── care-classic — the R1.1 default, unchanged ────────────────────────────
  seed("care-classic", "CARE Classic", "The presentation the clinic delivers today — unchanged default.", "standard", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "20px", color: "#1e1b4b", fontWeight: "800" },
      patientBlock: { fontFamily: SEGOE, fontSize: "11px" },
      studyTitle: { fontFamily: SEGOE, fontSize: "16px", color: "#1e1b4b", fontWeight: "700" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "12px", fontWeight: "700" },
      body: { fontFamily: SEGOE, fontSize: "12px", color: "#111" },
      footer: { fontFamily: SEGOE, fontSize: "9px", color: "#64748b" },
      signature: { fontFamily: SEGOE, fontSize: "12px" },
      imagePanel: { fontFamily: SEGOE, fontSize: "10px" },
    },
    colors: {
      headerBg: "#ffffff", headerText: "#1e1b4b", accent: "#4338ca",
      sectionBg: "#f8fafc", sectionBorder: "#e2e8f0",
      labelColor: "#64748b", valueColor: "#111111", impressionBg: "#fef9c3",
    },
    spacing: {},
    page: { size: "A4", orientation: "portrait", margins: "12mm 14mm" },
    header: { show: true, showLogo: true, showTagline: true, showContact: true, style: "underlined" },
    patientBlock: { style: "stacked" },
    studyTitle: { style: "plain" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "inline", panelWidthMm: 64 },
    watermark: { enabled: false, text: "" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── care-premium — the R1.1 premium layout, unchanged ─────────────────────
  seed("care-premium", "CARE Premium", "Publication-quality layout: banded header, accent study bar, report left with the selected-images panel right.", "standard", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "18pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.04em" },
      patientBlock: { fontFamily: SEGOE, fontSize: "8.5pt" },
      studyTitle: { fontFamily: SEGOE, fontSize: "12pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "9.5pt", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase" },
      body: { fontFamily: SEGOE, fontSize: "10pt", color: "#0f172a" },
      footer: { fontFamily: SEGOE, fontSize: "7.5pt", color: "#94a3b8" },
      signature: { fontFamily: SEGOE, fontSize: "10pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "7pt" },
    },
    colors: {
      headerBg: "#0f172a", headerText: "#ffffff", accent: "#3b82f6",
      sectionBg: "#f8fafc", sectionBorder: "#3b82f6",
      labelColor: "#64748b", valueColor: "#0f172a", impressionBg: "#eff6ff",
    },
    spacing: {},
    page: { size: "A4", orientation: "portrait", margins: "10mm 12mm" },
    header: { show: true, showLogo: true, showTagline: true, showContact: true, style: "banded" },
    patientBlock: { style: "table" },
    studyTitle: { style: "bar" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "side-panel", panelWidthMm: 64 },
    watermark: { enabled: false, text: "" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── care-v2 — refreshed CARE identity (teal), same canonical layout ──────
  seed("care-v2", "CARE V2", "Refreshed CARE identity: teal accents, table demographics, side image panel.", "standard", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "19px", color: "#134e4a", fontWeight: "800" },
      patientBlock: { fontFamily: SEGOE, fontSize: "9pt" },
      studyTitle: { fontFamily: SEGOE, fontSize: "13pt", color: "#134e4a", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "10pt", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase" },
      body: { fontFamily: SEGOE, fontSize: "10.5pt", color: "#0f172a", lineHeight: "1.6" },
      footer: { fontFamily: SEGOE, fontSize: "8pt", color: "#64748b" },
      signature: { fontFamily: SEGOE, fontSize: "10pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "7.5pt" },
      impression: { fontWeight: "600" },
    },
    colors: {
      headerBg: "#ffffff", headerText: "#134e4a", accent: "#0d9488",
      sectionBg: "#f0fdfa", sectionBorder: "#99f6e4",
      labelColor: "#475569", valueColor: "#0f172a", impressionBg: "#f0fdfa",
    },
    spacing: { lineHeight: "1.6" },
    page: { size: "A4", orientation: "portrait", margins: "12mm" },
    header: { show: true, showLogo: true, showTagline: true, showContact: true, style: "underlined" },
    patientBlock: { style: "table" },
    studyTitle: { style: "plain" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "side-panel", panelWidthMm: 60 },
    watermark: { enabled: false, text: "" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── hope — partner brand ──────────────────────────────────────────────────
  seed("hope", "Hope", "Hope brand: green banded header, serif body, inline images.", "standard", {
    typography: {
      header: { fontFamily: GEORGIA, fontSize: "18pt", color: "#ffffff", fontWeight: "700" },
      patientBlock: { fontFamily: SEGOE, fontSize: "9pt" },
      studyTitle: { fontFamily: GEORGIA, fontSize: "12pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: GEORGIA, fontSize: "10pt", fontWeight: "700", letterSpacing: "0.04em" },
      body: { fontFamily: GEORGIA, fontSize: "10.5pt", color: "#14532d", lineHeight: "1.65" },
      footer: { fontFamily: SEGOE, fontSize: "8pt", color: "#4d7c0f" },
      signature: { fontFamily: GEORGIA, fontSize: "10pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "7.5pt" },
    },
    colors: {
      headerBg: "#14532d", headerText: "#ffffff", accent: "#16a34a",
      sectionBg: "#f0fdf4", sectionBorder: "#86efac",
      labelColor: "#4d7c0f", valueColor: "#14532d", impressionBg: "#f0fdf4",
    },
    spacing: { lineHeight: "1.65" },
    page: { size: "A4", orientation: "portrait", margins: "12mm" },
    header: { show: true, showLogo: true, showTagline: true, showContact: true, style: "banded" },
    patientBlock: { style: "table" },
    studyTitle: { style: "bar" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "inline", panelWidthMm: 64 },
    watermark: { enabled: false, text: "" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── government — austere monochrome official copy ─────────────────────────
  seed("government", "Government", "Austere monochrome layout for government submissions, watermarked.", "standard", {
    typography: {
      header: { fontFamily: "'Times New Roman', Times, serif", fontSize: "18pt", color: "#111111", fontWeight: "700" },
      patientBlock: { fontFamily: "'Times New Roman', Times, serif", fontSize: "10pt" },
      studyTitle: { fontFamily: "'Times New Roman', Times, serif", fontSize: "13pt", color: "#111111", fontWeight: "700", textTransform: "uppercase" },
      sectionHeading: { fontFamily: "'Times New Roman', Times, serif", fontSize: "11pt", fontWeight: "700", textTransform: "uppercase" },
      body: { fontFamily: "'Times New Roman', Times, serif", fontSize: "11pt", color: "#111111", lineHeight: "1.5" },
      footer: { fontFamily: "'Times New Roman', Times, serif", fontSize: "8pt", color: "#333333" },
      signature: { fontFamily: "'Times New Roman', Times, serif", fontSize: "11pt" },
      imagePanel: { fontFamily: "'Times New Roman', Times, serif", fontSize: "8pt" },
    },
    colors: {
      headerBg: "#ffffff", headerText: "#111111", accent: "#111111",
      sectionBg: "#ffffff", sectionBorder: "#111111",
      labelColor: "#333333", valueColor: "#111111", impressionBg: "#f5f5f5",
    },
    spacing: { lineHeight: "1.5" },
    page: { size: "A4", orientation: "portrait", margins: "18mm 16mm" },
    header: { show: true, showLogo: false, showTagline: false, showContact: true, style: "underlined" },
    patientBlock: { style: "grid" },
    studyTitle: { style: "plain" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "inline", panelWidthMm: 64 },
    watermark: { enabled: true, text: "GOVERNMENT COPY" },
    qr: { show: true },
    pageBreaks: { orphans: 4, widows: 4 },
  }),

  // ── teleradiology — outbound reads for partner centres ───────────────────
  seed("teleradiology", "Teleradiology", "Outbound teleradiology reads: navy banded header, side image panel, watermarked.", "standard", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "17pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.03em" },
      patientBlock: { fontFamily: SEGOE, fontSize: "8.5pt" },
      studyTitle: { fontFamily: SEGOE, fontSize: "12pt", color: "#ffffff", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "9.5pt", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" },
      body: { fontFamily: SEGOE, fontSize: "10pt", color: "#1e293b", lineHeight: "1.55" },
      footer: { fontFamily: SEGOE, fontSize: "7.5pt", color: "#64748b" },
      signature: { fontFamily: SEGOE, fontSize: "10pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "7pt" },
    },
    colors: {
      headerBg: "#1e3a8a", headerText: "#ffffff", accent: "#2563eb",
      sectionBg: "#eff6ff", sectionBorder: "#93c5fd",
      labelColor: "#475569", valueColor: "#1e293b", impressionBg: "#eff6ff",
    },
    spacing: { lineHeight: "1.55" },
    page: { size: "A4", orientation: "portrait", margins: "10mm 12mm" },
    header: { show: true, showLogo: true, showTagline: false, showContact: true, style: "banded" },
    patientBlock: { style: "table" },
    studyTitle: { style: "bar" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "side-panel", panelWidthMm: 60 },
    watermark: { enabled: true, text: "TELERADIOLOGY" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── patient-copy — friendlier reading copy for patients ──────────────────
  seed("patient-copy", "Patient Copy", "Patient-facing copy: larger type, softer palette, watermarked PATIENT COPY.", "patient", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "19px", color: "#1e1b4b", fontWeight: "800" },
      patientBlock: { fontFamily: SEGOE, fontSize: "10pt" },
      studyTitle: { fontFamily: SEGOE, fontSize: "13pt", color: "#1e1b4b", fontWeight: "700" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "11pt", fontWeight: "700" },
      body: { fontFamily: SEGOE, fontSize: "11.5pt", color: "#111111", lineHeight: "1.7" },
      footer: { fontFamily: SEGOE, fontSize: "8.5pt", color: "#64748b" },
      signature: { fontFamily: SEGOE, fontSize: "11pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "8pt" },
    },
    colors: {
      headerBg: "#ffffff", headerText: "#1e1b4b", accent: "#7c3aed",
      sectionBg: "#faf5ff", sectionBorder: "#ddd6fe",
      labelColor: "#64748b", valueColor: "#111111", impressionBg: "#faf5ff",
    },
    spacing: { lineHeight: "1.7" },
    page: { size: "A4", orientation: "portrait", margins: "14mm" },
    header: { show: true, showLogo: true, showTagline: true, showContact: true, style: "underlined" },
    patientBlock: { style: "table" },
    studyTitle: { style: "plain" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "inline", panelWidthMm: 64 },
    watermark: { enabled: true, text: "PATIENT COPY" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),

  // ── referrer-copy — compact copy for referring doctors ───────────────────
  seed("referrer-copy", "Referrer Copy", "Compact referrer copy: dense type, side image panel, watermarked REFERRER COPY.", "referrer", {
    typography: {
      header: { fontFamily: SEGOE, fontSize: "16pt", color: "#0f172a", fontWeight: "800" },
      patientBlock: { fontFamily: SEGOE, fontSize: "8pt" },
      studyTitle: { fontFamily: SEGOE, fontSize: "11pt", color: "#0f172a", fontWeight: "700", textTransform: "uppercase" },
      sectionHeading: { fontFamily: SEGOE, fontSize: "9pt", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase" },
      body: { fontFamily: SEGOE, fontSize: "9.5pt", color: "#111111", lineHeight: "1.4" },
      footer: { fontFamily: SEGOE, fontSize: "7pt", color: "#64748b" },
      signature: { fontFamily: SEGOE, fontSize: "9pt" },
      imagePanel: { fontFamily: SEGOE, fontSize: "6.5pt" },
    },
    colors: {
      headerBg: "#ffffff", headerText: "#0f172a", accent: "#0369a1",
      sectionBg: "#f0f9ff", sectionBorder: "#bae6fd",
      labelColor: "#64748b", valueColor: "#111111", impressionBg: "#f0f9ff",
    },
    spacing: { lineHeight: "1.4" },
    page: { size: "A4", orientation: "portrait", margins: "10mm" },
    header: { show: true, showLogo: true, showTagline: false, showContact: false, style: "underlined" },
    patientBlock: { style: "table" },
    studyTitle: { style: "plain" },
    signature: { show: true, showImage: true },
    footer: { show: true },
    imagePanel: { placement: "side-panel", panelWidthMm: 55 },
    watermark: { enabled: true, text: "REFERRER COPY" },
    qr: { show: true },
    pageBreaks: { orphans: 3, widows: 3 },
  }),
];

export function seedByKey(templateKey: string): TemplateVersionRecord | undefined {
  return PRESENTATION_TEMPLATE_SEEDS.find((s) => s.templateKey === templateKey);
}
