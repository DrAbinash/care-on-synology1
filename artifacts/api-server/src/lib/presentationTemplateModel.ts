/**
 * presentationTemplateModel.ts — Ticket R1.2: the versioned report-template
 * model. PURE — types, validation, sanitization and compilation only; no IO.
 *
 * A TemplateDefinition is DATA (typography slots, colors, spacing, page
 * configuration, section visibility, image-panel/watermark/QR configuration).
 * It is validated on every write and import, then COMPILED into the resolved
 * shape the shared renderer consumes (lib/reportPresentation.ts). The
 * renderer never sees unvalidated input, and definitions can never carry
 * HTML, JavaScript, URLs or free-form CSS — every value passes an allowlist
 * or a bounded-format check. Presentation only: nothing here touches
 * structured JSON, hashes, audit, amendments or report wording.
 */

import type { PresentationSlot, PresentationTemplate, SlotTypography } from "./reportPresentation";

// ── Constants / enums ────────────────────────────────────────────────────────

/** Bumped only when the renderer's consumption contract changes incompatibly.
 *  Imports carrying a newer rendererVersion are rejected. */
export const RENDERER_COMPAT_VERSION = 1;

/** Import/export envelope schema version. */
export const TEMPLATE_EXPORT_SCHEMA_VERSION = 1;

export const COPY_TYPES = ["standard", "patient", "referrer"] as const;
export type CopyType = (typeof COPY_TYPES)[number];

export const TEMPLATE_STATUSES = ["published", "retired"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Approved font families (Phase 5: "font family from an approved safe list").
 *  Values are rendered inside font-family CSS — nothing outside this list is
 *  ever emitted. */
export const SAFE_FONT_FAMILIES = [
  "'Segoe UI', Helvetica, Arial, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Arial, sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Times New Roman', Times, serif",
  "'Palatino Linotype', Georgia, serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
  "'Courier New', Courier, monospace",
] as const;

export const PAGE_SIZES = ["A4", "A5", "Letter"] as const;
export const PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;

/** Template keys required by R1.2. Custom keys are also allowed (slug rule). */
export const SEED_TEMPLATE_KEYS = [
  "care-classic", "care-premium", "care-v2", "hope",
  "government", "teleradiology", "patient-copy", "referrer-copy",
] as const;

export const DEFAULT_TEMPLATE_KEY = "care-classic";

// ── Definition types (Phase 2) ───────────────────────────────────────────────

export interface TemplateSlotTypography {
  fontFamily?: string;      // from SAFE_FONT_FAMILIES
  fontSize?: string;        // bounded measurement (pt/px/em)
  color?: string;           // #rgb / #rrggbb
  letterSpacing?: string;   // bounded measurement (em/px)
  textTransform?: "none" | "uppercase" | "capitalize";
  fontWeight?: "400" | "500" | "600" | "700" | "800";
  lineHeight?: string;      // unitless 1.0–2.5
  textAlign?: "left" | "center" | "right";
}

/** All typography slots — the R1.1 eight plus the impression block. */
export const TEMPLATE_SLOTS = [
  "header", "patientBlock", "studyTitle", "sectionHeading",
  "body", "footer", "signature", "imagePanel", "impression",
] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

export interface TemplateDefinition {
  typography: Partial<Record<TemplateSlot, TemplateSlotTypography>>;
  colors: {
    headerBg: string; headerText: string; accent: string;
    sectionBg: string; sectionBorder: string;
    labelColor: string; valueColor: string; impressionBg: string;
  };
  spacing: {
    /** unitless line-height for the body, 1.0–2.5 */
    lineHeight?: string;
    /** vertical gap between sections (mm/px/pt, bounded) */
    sectionGap?: string;
  };
  page: {
    size: (typeof PAGE_SIZES)[number];
    orientation: (typeof PAGE_ORIENTATIONS)[number];
    /** "10mm" or "10mm 12mm" (1–2 bounded mm values) */
    margins: string;
  };
  header: { show: boolean; showLogo: boolean; showTagline: boolean; showContact: boolean; style: "banded" | "underlined" };
  patientBlock: { style: "grid" | "table" | "stacked" };
  studyTitle: { style: "bar" | "plain" };
  signature: { show: boolean; showImage: boolean };
  footer: { show: boolean };
  imagePanel: {
    placement: "inline" | "side-panel";
    /** side-panel width in mm, 40–90 */
    panelWidthMm: number;
  };
  watermark: { enabled: boolean; text: string };
  qr: { show: boolean };
  pageBreaks: { orphans: number; widows: number };
}

/** A stored template version (DB row shape, sans DB plumbing). */
export interface TemplateVersionRecord {
  templateKey: string;
  version: number;
  displayName: string;
  description?: string | null;
  orgScope: string;      // "global" today; organization/branch/department reserved
  copyType: CopyType;
  status: TemplateStatus;
  rendererVersion: number;
  isSystem: boolean;
  definition: TemplateDefinition;
}

// ── Validation (Phases 2/7 — every write and import passes through this) ────

export interface TemplateValidationIssue {
  path: string;
  message: string;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MEASUREMENT = /^\d{1,3}(?:\.\d{1,2})?(?:pt|px|em|mm)$/;
const MARGINS = /^\d{1,2}(?:\.\d)?mm(?: \d{1,2}(?:\.\d)?mm)?$/;
const LINE_HEIGHT = /^(?:1(?:\.\d{1,2})?|2(?:\.[0-5]\d?)?)$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9-]{1,40}$/;
/** Anything that could smuggle markup, script, URLs or CSS escapes. */
const FORBIDDEN_SUBSTRINGS = ["<", ">", "url(", "expression(", "javascript:", "http://", "https://", "data:", "@import", "\\", "{", "}", "/*", "*/", ";"];

function forbidden(value: string): boolean {
  const low = value.toLowerCase();
  return FORBIDDEN_SUBSTRINGS.some((s) => low.includes(s));
}

function checkColor(issues: TemplateValidationIssue[], path: string, value: unknown, required = true): void {
  if (value == null) {
    if (required) issues.push({ path, message: "color is required" });
    return;
  }
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    issues.push({ path, message: `"${String(value).slice(0, 40)}" is not a #hex color` });
  }
}

function checkKnownKeys(issues: TemplateValidationIssue[], path: string, obj: object, allowed: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}.${key}`, message: "unknown property" });
  }
}

export function validateSlotTypography(path: string, t: unknown): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  if (t == null || typeof t !== "object" || Array.isArray(t)) {
    return [{ path, message: "typography slot must be an object" }];
  }
  const slot = t as Record<string, unknown>;
  checkKnownKeys(issues, path, slot, ["fontFamily", "fontSize", "color", "letterSpacing", "textTransform", "fontWeight", "lineHeight", "textAlign"]);
  if (slot.fontFamily != null && !SAFE_FONT_FAMILIES.includes(slot.fontFamily as never)) {
    issues.push({ path: `${path}.fontFamily`, message: "font family is not on the approved list" });
  }
  for (const field of ["fontSize", "letterSpacing"] as const) {
    const v = slot[field];
    if (v != null && (typeof v !== "string" || !MEASUREMENT.test(v))) {
      issues.push({ path: `${path}.${field}`, message: `"${String(v).slice(0, 40)}" is not a bounded measurement (pt/px/em/mm)` });
    }
  }
  if (slot.lineHeight != null && (typeof slot.lineHeight !== "string" || !LINE_HEIGHT.test(slot.lineHeight))) {
    issues.push({ path: `${path}.lineHeight`, message: "line height must be a unitless value between 1.0 and 2.5" });
  }
  if (slot.textTransform != null && !["none", "uppercase", "capitalize"].includes(slot.textTransform as string)) {
    issues.push({ path: `${path}.textTransform`, message: "invalid text transform" });
  }
  if (slot.fontWeight != null && !["400", "500", "600", "700", "800"].includes(slot.fontWeight as string)) {
    issues.push({ path: `${path}.fontWeight`, message: "invalid font weight" });
  }
  if (slot.textAlign != null && !["left", "center", "right"].includes(slot.textAlign as string)) {
    issues.push({ path: `${path}.textAlign`, message: "invalid text alignment" });
  }
  checkColor(issues, `${path}.color`, slot.color, false);
  return issues;
}

export function validateTemplateDefinition(def: unknown): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  if (def == null || typeof def !== "object" || Array.isArray(def)) {
    return [{ path: "definition", message: "definition must be an object" }];
  }
  const d = def as Record<string, unknown>;
  checkKnownKeys(issues, "definition", d, [
    "typography", "colors", "spacing", "page", "header", "patientBlock",
    "studyTitle", "signature", "footer", "imagePanel", "watermark", "qr", "pageBreaks",
  ]);

  // typography slots
  if (d.typography == null || typeof d.typography !== "object") {
    issues.push({ path: "typography", message: "typography is required" });
  } else {
    for (const [slotName, slot] of Object.entries(d.typography as object)) {
      if (!TEMPLATE_SLOTS.includes(slotName as TemplateSlot)) {
        issues.push({ path: `typography.${slotName}`, message: "unknown typography slot" });
        continue;
      }
      issues.push(...validateSlotTypography(`typography.${slotName}`, slot));
    }
  }

  // colors
  if (d.colors == null || typeof d.colors !== "object") {
    issues.push({ path: "colors", message: "colors are required" });
  } else {
    const colorKeys = ["headerBg", "headerText", "accent", "sectionBg", "sectionBorder", "labelColor", "valueColor", "impressionBg"];
    checkKnownKeys(issues, "colors", d.colors as object, colorKeys);
    for (const key of colorKeys) checkColor(issues, `colors.${key}`, (d.colors as Record<string, unknown>)[key]);
  }

  // spacing
  if (d.spacing != null && typeof d.spacing === "object") {
    const s = d.spacing as Record<string, unknown>;
    checkKnownKeys(issues, "spacing", s, ["lineHeight", "sectionGap"]);
    if (s.lineHeight != null && (typeof s.lineHeight !== "string" || !LINE_HEIGHT.test(s.lineHeight))) {
      issues.push({ path: "spacing.lineHeight", message: "line height must be 1.0–2.5" });
    }
    if (s.sectionGap != null && (typeof s.sectionGap !== "string" || !MEASUREMENT.test(s.sectionGap))) {
      issues.push({ path: "spacing.sectionGap", message: "section gap must be a bounded measurement" });
    }
  }

  // page
  if (d.page == null || typeof d.page !== "object") {
    issues.push({ path: "page", message: "page configuration is required" });
  } else {
    const p = d.page as Record<string, unknown>;
    checkKnownKeys(issues, "page", p, ["size", "orientation", "margins"]);
    if (!PAGE_SIZES.includes(p.size as never)) issues.push({ path: "page.size", message: `size must be one of ${PAGE_SIZES.join("|")}` });
    if (!PAGE_ORIENTATIONS.includes(p.orientation as never)) issues.push({ path: "page.orientation", message: "orientation must be portrait|landscape" });
    if (typeof p.margins !== "string" || !MARGINS.test(p.margins)) {
      issues.push({ path: "page.margins", message: `"${String(p.margins).slice(0, 40)}" is not valid margins ("10mm" or "10mm 12mm")` });
    }
  }

  // simple sections
  const boolChecks: Array<[string, string[]]> = [
    ["header", ["show", "showLogo", "showTagline", "showContact", "style"]],
    ["patientBlock", ["style"]],
    ["studyTitle", ["style"]],
    ["signature", ["show", "showImage"]],
    ["footer", ["show"]],
    ["qr", ["show"]],
  ];
  for (const [section, keys] of boolChecks) {
    const v = d[section];
    if (v == null || typeof v !== "object") {
      issues.push({ path: section, message: `${section} configuration is required` });
      continue;
    }
    checkKnownKeys(issues, section, v as object, keys);
    for (const key of keys.filter((k) => k !== "style")) {
      if (typeof (v as Record<string, unknown>)[key] !== "boolean") {
        issues.push({ path: `${section}.${key}`, message: "must be true or false" });
      }
    }
  }
  if (typeof d.header === "object" && d.header != null && !["banded", "underlined"].includes((d.header as Record<string, unknown>).style as string)) {
    issues.push({ path: "header.style", message: "header style must be banded|underlined" });
  }
  if (typeof d.patientBlock === "object" && d.patientBlock != null && !["grid", "table", "stacked"].includes((d.patientBlock as Record<string, unknown>).style as string)) {
    issues.push({ path: "patientBlock.style", message: "patient block style must be grid|table|stacked" });
  }
  if (typeof d.studyTitle === "object" && d.studyTitle != null && !["bar", "plain"].includes((d.studyTitle as Record<string, unknown>).style as string)) {
    issues.push({ path: "studyTitle.style", message: "study title style must be bar|plain" });
  }

  // image panel
  if (d.imagePanel == null || typeof d.imagePanel !== "object") {
    issues.push({ path: "imagePanel", message: "image panel configuration is required" });
  } else {
    const ip = d.imagePanel as Record<string, unknown>;
    checkKnownKeys(issues, "imagePanel", ip, ["placement", "panelWidthMm"]);
    if (!["inline", "side-panel"].includes(ip.placement as string)) {
      issues.push({ path: "imagePanel.placement", message: "placement must be inline|side-panel" });
    }
    const w = ip.panelWidthMm;
    if (typeof w !== "number" || !Number.isFinite(w) || w < 40 || w > 90) {
      issues.push({ path: "imagePanel.panelWidthMm", message: "panel width must be 40–90 mm" });
    }
  }

  // watermark
  if (d.watermark == null || typeof d.watermark !== "object") {
    issues.push({ path: "watermark", message: "watermark configuration is required" });
  } else {
    const w = d.watermark as Record<string, unknown>;
    checkKnownKeys(issues, "watermark", w, ["enabled", "text"]);
    if (typeof w.enabled !== "boolean") issues.push({ path: "watermark.enabled", message: "must be true or false" });
    if (typeof w.text !== "string" || w.text.length > 40) {
      issues.push({ path: "watermark.text", message: "watermark text must be a string of at most 40 characters" });
    } else if (w.text && (forbidden(w.text) || !/^[\w\s\-—•.]*$/u.test(w.text))) {
      issues.push({ path: "watermark.text", message: "watermark text contains forbidden characters" });
    }
  }

  // page breaks
  if (d.pageBreaks == null || typeof d.pageBreaks !== "object") {
    issues.push({ path: "pageBreaks", message: "page break configuration is required" });
  } else {
    const pb = d.pageBreaks as Record<string, unknown>;
    checkKnownKeys(issues, "pageBreaks", pb, ["orphans", "widows"]);
    for (const key of ["orphans", "widows"] as const) {
      const v = pb[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 6) {
        issues.push({ path: `pageBreaks.${key}`, message: "must be an integer between 1 and 6" });
      }
    }
  }

  // final sweep: NO string anywhere in the definition may carry forbidden content
  const sweep = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (forbidden(value)) issues.push({ path, message: "contains forbidden characters (markup/script/URL/CSS)" });
      return;
    }
    if (value != null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) sweep(v, `${path}.${k}`);
    }
  };
  sweep(d, "definition");

  return issues;
}

export function validateTemplateKey(key: unknown): TemplateValidationIssue[] {
  if (typeof key !== "string" || !TEMPLATE_KEY.test(key)) {
    return [{ path: "templateKey", message: "key must be a lowercase slug (a-z, 0-9, dashes; 2–41 chars)" }];
  }
  return [];
}

export function validateDisplayName(name: unknown): TemplateValidationIssue[] {
  if (typeof name !== "string" || !name.trim() || name.length > 80) {
    return [{ path: "displayName", message: "display name must be 1–80 characters" }];
  }
  if (forbidden(name)) return [{ path: "displayName", message: "display name contains forbidden characters" }];
  return [];
}

/** Description is optional; when present it must match the same bound the
 *  import envelope enforces, so publish is not a bypass for the export→import
 *  round trip. */
export function validateDescription(description: unknown): TemplateValidationIssue[] {
  if (description == null) return [];
  if (typeof description !== "string" || description.length > 500 || forbidden(description)) {
    return [{ path: "description", message: "description must be ≤500 safe characters" }];
  }
  return [];
}

// ── Import/export envelope (Phase 7) ────────────────────────────────────────

export interface TemplateExportEnvelope {
  schemaVersion: number;
  rendererVersion: number;
  templateKey: string;
  version: number;
  displayName: string;
  description?: string | null;
  copyType: CopyType;
  definition: TemplateDefinition;
  exportedAt?: string;
}

export function validateImportEnvelope(raw: unknown): { issues: TemplateValidationIssue[]; envelope: TemplateExportEnvelope | null } {
  const issues: TemplateValidationIssue[] = [];
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { issues: [{ path: "$", message: "import must be a JSON object" }], envelope: null };
  }
  const e = raw as Record<string, unknown>;
  checkKnownKeys(issues, "$", e, ["schemaVersion", "rendererVersion", "templateKey", "version", "displayName", "description", "copyType", "definition", "exportedAt"]);
  if (e.schemaVersion !== TEMPLATE_EXPORT_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: `unsupported schema version (expected ${TEMPLATE_EXPORT_SCHEMA_VERSION})` });
  }
  if (typeof e.rendererVersion !== "number" || e.rendererVersion > RENDERER_COMPAT_VERSION) {
    issues.push({ path: "rendererVersion", message: `requires renderer version ${String(e.rendererVersion)} — this system supports up to ${RENDERER_COMPAT_VERSION}` });
  }
  issues.push(...validateTemplateKey(e.templateKey));
  if (typeof e.version !== "number" || !Number.isInteger(e.version) || e.version < 1 || e.version > 10_000) {
    issues.push({ path: "version", message: "version must be a positive integer" });
  }
  issues.push(...validateDisplayName(e.displayName));
  if (e.description != null && (typeof e.description !== "string" || e.description.length > 500 || forbidden(e.description))) {
    issues.push({ path: "description", message: "description must be ≤500 safe characters" });
  }
  if (!COPY_TYPES.includes(e.copyType as never)) {
    issues.push({ path: "copyType", message: `copy type must be one of ${COPY_TYPES.join("|")}` });
  }
  issues.push(...validateTemplateDefinition(e.definition));
  return { issues, envelope: issues.length === 0 ? (raw as TemplateExportEnvelope) : null };
}

// ── Compilation → the resolved shape the shared renderer consumes ───────────

function toSlotTypography(t: TemplateSlotTypography | undefined): SlotTypography {
  if (!t) return {};
  return {
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    color: t.color,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform === "none" ? undefined : t.textTransform,
    fontWeight: t.fontWeight,
  };
}

/** Renderer-facing resolved template: the R1.1 shape plus the R1.2
 *  capabilities. reportPresentation.renderReportDocument consumes exactly
 *  this — ONE renderer, richer data. */
export interface ResolvedTemplate extends PresentationTemplate {
  templateKey: string;
  templateVersion: number;
  copyType: CopyType;
  page: TemplateDefinition["page"];
  headerCfg: TemplateDefinition["header"];
  studyTitleCfg: TemplateDefinition["studyTitle"];
  signatureCfg: TemplateDefinition["signature"];
  footerCfg: TemplateDefinition["footer"];
  imagePanelCfg: TemplateDefinition["imagePanel"];
  watermarkCfg: TemplateDefinition["watermark"];
  qrCfg: TemplateDefinition["qr"];
  pageBreaks: TemplateDefinition["pageBreaks"];
  spacingCfg: TemplateDefinition["spacing"];
  impressionTypography: SlotTypography;
  bodyLineHeight?: string;
  bodyTextAlign?: string;
}

export function compileTemplate(record: Pick<TemplateVersionRecord, "templateKey" | "version" | "displayName" | "copyType" | "definition"> & { description?: string | null }): ResolvedTemplate {
  const d = record.definition;
  const typography = {} as Record<PresentationSlot, SlotTypography>;
  for (const slot of ["header", "patientBlock", "studyTitle", "sectionHeading", "body", "footer", "signature", "imagePanel"] as const) {
    typography[slot] = toSlotTypography(d.typography[slot]);
  }
  return {
    id: record.templateKey,
    name: record.displayName,
    description: record.description ?? "",
    typography,
    palette: { ...d.colors },
    layout: {
      imagePlacement: d.imagePanel.placement,
      patientBlockStyle: d.patientBlock.style,
      pageMargins: d.page.margins,
    },
    templateKey: record.templateKey,
    templateVersion: record.version,
    copyType: record.copyType,
    page: d.page,
    headerCfg: d.header,
    studyTitleCfg: d.studyTitle,
    signatureCfg: d.signature,
    footerCfg: d.footer,
    imagePanelCfg: d.imagePanel,
    watermarkCfg: d.watermark,
    qrCfg: d.qr,
    pageBreaks: d.pageBreaks,
    spacingCfg: d.spacing ?? {},
    impressionTypography: toSlotTypography(d.typography.impression),
    bodyLineHeight: d.typography.body?.lineHeight ?? d.spacing?.lineHeight,
    bodyTextAlign: d.typography.body?.textAlign,
  };
}

// ── Resolution precedence (Phase 6 — deterministic, pure) ───────────────────

export interface TemplateResolutionInput {
  /** Per-request staff override (?template=key or key@version). */
  explicitKey?: string | null;
  explicitVersion?: number | null;
  /** Frozen identity for a finalized report (Phase 3). */
  frozen?: { templateKey: string; templateVersion: number } | null;
  /** Copy type demanded by the surface (public → patient, etc.). */
  copyType: CopyType;
  /** Active selections from settings, keyed by copy type. */
  activeByCopyType: Partial<Record<CopyType, string>>;
}

export interface TemplateResolutionDecision {
  templateKey: string;
  /** null → latest published version of the key. */
  version: number | null;
  source: "explicit" | "frozen" | "copy-type-active" | "standard-active" | "default";
}

/**
 * Deterministic precedence.
 *
 * The FROZEN identity is the finalized STANDARD (clinical) document — that is
 * what must stay byte-reproducible. Patient- and referrer-copy surfaces are
 * derived, live-branded deliveries of that report, so their active selection
 * outranks the frozen standard identity (otherwise the patient-copy /
 * referrer-copy selectors could never affect a report signed after R1.2,
 * because every sign creates a standard freeze row).
 *
 * For copyType === "standard":
 *   1. explicit per-request override (staff surfaces only — never persisted)
 *   2. frozen standard identity of the finalized report
 *   3. active standard selection
 *   4. care-classic (system default)
 * For copyType !== "standard" (patient/referrer):
 *   1. explicit override
 *   2. active selection for THIS copy type
 *   3. frozen standard identity (so a copy still renders SOMETHING stable)
 *   4. active standard selection
 *   5. care-classic
 * Future scope levels (organization → branch → department → radiologist
 * preference) slot immediately below the copy-type selection — reserved,
 * documented, not implemented.
 */
export function resolveTemplatePrecedence(input: TemplateResolutionInput): TemplateResolutionDecision {
  if (input.explicitKey) {
    return { templateKey: input.explicitKey, version: input.explicitVersion ?? null, source: "explicit" };
  }
  const copyActive = input.copyType !== "standard" ? input.activeByCopyType[input.copyType] : undefined;
  if (copyActive) {
    return { templateKey: copyActive, version: null, source: "copy-type-active" };
  }
  if (input.frozen) {
    return { templateKey: input.frozen.templateKey, version: input.frozen.templateVersion, source: "frozen" };
  }
  const standardActive = input.activeByCopyType.standard;
  if (standardActive) {
    return { templateKey: standardActive, version: null, source: "standard-active" };
  }
  return { templateKey: DEFAULT_TEMPLATE_KEY, version: null, source: "default" };
}

/** Settings key for a copy type's active template (standard keeps the R1.1 key). */
export function activeTemplateSettingKey(copyType: CopyType): string {
  return copyType === "standard"
    ? "report_presentation_template"
    : `report_presentation_template_${copyType}`;
}
