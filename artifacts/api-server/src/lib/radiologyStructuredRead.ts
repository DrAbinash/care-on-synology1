// ─────────────────────────────────────────────────────────────────────────────
// radiologyStructuredRead.ts — Ticket D6 (Structured Report Read Path and
// Renderer Display Cutover). PURE read pipeline: a patient_reports row →
// the body every display surface should show, plus full diagnostics.
//
// SAFETY MODEL (the only rule that matters): the stored legacy `body` is the
// signed medico-legal artifact and is ALWAYS a safe thing to display. The D4
// render of `structured_json` is served INSTEAD only when every gate passes:
//   1. structured_json exists and has the signed-final document shape,
//   2. content_sha256 verifies (tamper-evidence, D1 §10),
//   3. the D1 validator accepts it (finalize mode, injected ports),
//   4. the render is byte-IDENTICAL to the stored body, or differs only by
//      APPROVED formatting (whitespace / blank lines / "N." numbering /
//      heading case).
// Any other outcome — missing, malformed, tampered, invalid, or clinically
// divergent — falls back to the stored body with the reason classified and
// reported. A clinical difference is NEVER silently ignored: it is returned
// as CLINICAL_DIFFERENCE with per-line context so callers can log/audit it.
//
// No database access here (validator/catalog ports are injected by the route,
// same honest-gap pattern as D5's prepare) and NO mutation: the input row is
// never written to, and signed reports are never modified by reading them.
// ─────────────────────────────────────────────────────────────────────────────

import { validateStructuredReport, type ValidationIssue } from "./structuredReport/validator";
import type { StructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./structuredReport/aiRulesRegistry";
import { noFindingsCatalogPort } from "./radiologyD1DraftWriter";
import { verifyContentSha256 } from "./structuredReport/hash";
import {
  renderStructuredReport,
  STRUCTURED_RENDERER_VERSION,
  type RenderResult,
  type RenderWarning,
} from "./structuredReport/renderer";
import { STRUCTURED_REPORT_KIND, type StructuredReportDocument } from "./structuredReport/types";

// ── Comparison classes (Phase 3) ─────────────────────────────────────────────

export type ReadComparisonClass =
  | "IDENTICAL"
  | "APPROVED_FORMATTING_ONLY"
  | "CLINICAL_DIFFERENCE"
  | "INVALID_STRUCTURED_JSON"
  | "NO_STRUCTURED_JSON";

export interface StoredVsRenderedComparison {
  class: Extract<ReadComparisonClass, "IDENTICAL" | "APPROVED_FORMATTING_ONLY" | "CLINICAL_DIFFERENCE">;
  /** First few normalized line pairs that differ (CLINICAL_DIFFERENCE only). */
  divergentLines: Array<{ stored: string | null; rendered: string | null }>;
}

/** The D4 renderer's finite section-heading set (renderer.ts renders exactly
 *  these labels, cased per its headingCase option). Only THESE lines fold
 *  case in the comparison — a broad "any colon-terminated line" heuristic
 *  would bless case-only drift on clinical lines like "L4-L5 level:". */
const SECTION_HEADINGS = new Set(["TECHNIQUE:", "FINDINGS:", "IMPRESSION:", "RECOMMENDATION:"]);

/** APPROVED formatting normalizations for the READ comparison — the same
 *  family as D5's write-side policy (trim, blank-line removal, "N."/"N)"
 *  numbering strip, whitespace collapse) plus case-insensitive SECTION
 *  HEADINGS (a pure D4 render option; "IMPRESSION:" vs "Impression:" is
 *  formatting, not clinical content). Anything else is clinical. */
export function normalizeBodyLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l !== "")
    .map((l) => (SECTION_HEADINGS.has(l.toUpperCase()) ? l.toUpperCase() : l));
}

/**
 * Classify the stored signed body against the D4 render (Phase 3).
 * Byte-equal → IDENTICAL; normalized-equal → APPROVED_FORMATTING_ONLY;
 * anything else → CLINICAL_DIFFERENCE with the first divergent line pairs.
 */
export function compareStoredVsRendered(storedBody: string, renderedBody: string): StoredVsRenderedComparison {
  if (storedBody === renderedBody) return { class: "IDENTICAL", divergentLines: [] };

  const stored = normalizeBodyLines(storedBody);
  const rendered = normalizeBodyLines(renderedBody);
  if (stored.length === rendered.length && stored.every((l, i) => l === rendered[i])) {
    return { class: "APPROVED_FORMATTING_ONLY", divergentLines: [] };
  }

  const divergentLines: StoredVsRenderedComparison["divergentLines"] = [];
  const max = Math.max(stored.length, rendered.length);
  for (let i = 0; i < max && divergentLines.length < 5; i++) {
    if (stored[i] !== rendered[i]) {
      divergentLines.push({ stored: stored[i] ?? null, rendered: rendered[i] ?? null });
    }
  }
  return { class: "CLINICAL_DIFFERENCE", divergentLines };
}

// ── Read pipeline (Phase 2) ──────────────────────────────────────────────────

/** The patient_reports columns the read pipeline consumes. */
export interface StructuredReadRow {
  body: string;
  structuredJson: unknown;
  renderEngineVersion?: string | null;
  catalogVersion?: string | null;
}

export interface StructuredReadPorts {
  /** Real catalog port so R1/R4/R5 can resolve refs on documents with
   *  findings. Defaults to the no-op port — which REJECTS documents with
   *  findings, i.e. the safe fallback direction (legacy body). */
  catalogPort?: StructuredReportCatalogPort;
  /** R14b lookup against audit_logs; omitted → validator downgrades to a
   *  warning (the stored hash + signature checks still gate). */
  auditLogLookup?: (documentId: string, signedContentSha256: string) => Promise<boolean>;
  amendsLookup?: (priorDocumentId: string) => Promise<{ state: string; alreadyAmendedBy: string | null } | null>;
}

/** Phase 5 diagnostics — everything an auditor needs to see why a body was
 *  (or was not) served from the structured document. */
export interface StructuredReadDiagnostics {
  comparisonClass: ReadComparisonClass;
  usedStructured: boolean;
  hashVerified: boolean | null; // null = never got far enough to check
  validationErrors: ValidationIssue[];
  validationWarnings: ValidationIssue[];
  rendererWarnings: RenderWarning[];
  divergentLines: StoredVsRenderedComparison["divergentLines"];
  renderMs: number | null;
  storedRenderEngineVersion: string | null;
  currentRendererVersion: string;
  catalogVersion: string | null;
  /** Human-readable reason when the structured render was not used. */
  fallbackReason: string | null;
}

export interface StructuredReadResult {
  /** The body every display surface should show. NEVER undefined. */
  body: string;
  usedStructured: boolean;
  comparisonClass: ReadComparisonClass;
  document: StructuredReportDocument | null;
  render: RenderResult | null;
  diagnostics: StructuredReadDiagnostics;
}

function baseDiagnostics(row: StructuredReadRow): StructuredReadDiagnostics {
  return {
    comparisonClass: "NO_STRUCTURED_JSON",
    usedStructured: false,
    hashVerified: null,
    validationErrors: [],
    validationWarnings: [],
    rendererWarnings: [],
    divergentLines: [],
    renderMs: null,
    storedRenderEngineVersion: row.renderEngineVersion ?? null,
    currentRendererVersion: STRUCTURED_RENDERER_VERSION,
    catalogVersion: row.catalogVersion ?? null,
    fallbackReason: null,
  };
}

function legacyFallback(
  row: StructuredReadRow,
  diagnostics: StructuredReadDiagnostics,
  comparisonClass: ReadComparisonClass,
  fallbackReason: string | null,
  document: StructuredReportDocument | null = null,
  render: RenderResult | null = null,
): StructuredReadResult {
  diagnostics.comparisonClass = comparisonClass;
  diagnostics.usedStructured = false;
  diagnostics.fallbackReason = fallbackReason;
  return { body: row.body, usedStructured: false, comparisonClass, document, render, diagnostics };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The D6 read pipeline. Pure; no DB access (ports injected); never mutates
 * the row or the stored document; every path returns a displayable body.
 * Timing (renderMs) is a diagnostic side-channel only — output content is a
 * deterministic function of the inputs.
 */
export async function readStructuredReport(
  row: StructuredReadRow,
  ports: StructuredReadPorts = {},
): Promise<StructuredReadResult> {
  const diagnostics = baseDiagnostics(row);

  // Rule 3 — no structured document: legacy body unchanged.
  if (row.structuredJson == null) {
    return legacyFallback(row, diagnostics, "NO_STRUCTURED_JSON", null);
  }

  // Shape gate: must look like a SIGNED-final canonical document before any
  // heavier work. (A draft-state or foreign-shaped object in this column is
  // not a signed structured report.)
  const docUnknown = row.structuredJson;
  if (!isPlainObject(docUnknown) || docUnknown.kind !== STRUCTURED_REPORT_KIND) {
    return legacyFallback(row, diagnostics, "INVALID_STRUCTURED_JSON", "not_a_structured_report_document");
  }
  const doc = docUnknown as unknown as StructuredReportDocument;
  if (doc.audit?.signature?.state !== "final") {
    return legacyFallback(row, diagnostics, "INVALID_STRUCTURED_JSON", `signature.state is "${doc.audit?.signature?.state}", expected "final"`);
  }

  // Tamper-evidence gate (D1 §10): recompute the content hash over the
  // stored jsonb value. A mismatch means the stored document is NOT the one
  // that was signed — never render it.
  const hash = verifyContentSha256(doc);
  diagnostics.hashVerified = hash.ok;
  if (!hash.ok) {
    return legacyFallback(row, diagnostics, "INVALID_STRUCTURED_JSON", "content_sha256_mismatch (stored document does not verify against its own signed hash)", doc);
  }

  // Full D1 validation, finalize mode (rule 1). Injected ports resolve
  // catalog refs / the audit row; without them the validator's honest-gap
  // behavior applies and any REJECT falls back to legacy (rule 2).
  const validation = await validateStructuredReport(doc, {
    catalog: ports.catalogPort ?? noFindingsCatalogPort,
    aiRules: new UnavailableAiRulesRegistryPort(),
    mode: "finalize",
    auditLogLookup: ports.auditLogLookup,
    amendsLookup: ports.amendsLookup ?? (async () => null),
  });
  diagnostics.validationErrors = validation.errors;
  diagnostics.validationWarnings = validation.warnings;
  if (!validation.ok) {
    return legacyFallback(row, diagnostics, "INVALID_STRUCTURED_JSON", "d1_validation_failed", doc);
  }

  // Render through D4 (the only structured body producer), timed for audit.
  const started = performance.now();
  const render = renderStructuredReport(doc);
  diagnostics.renderMs = Math.max(0, performance.now() - started);
  diagnostics.rendererWarnings = render.warnings;
  if (!render.body.trim()) {
    return legacyFallback(row, diagnostics, "INVALID_STRUCTURED_JSON", "renderer_produced_empty_body", doc, render);
  }

  // Compatibility gate (Phase 3/4): serve the render only when it shows the
  // same clinical content the stored signed body shows.
  const comparison = compareStoredVsRendered(row.body, render.body);
  diagnostics.divergentLines = comparison.divergentLines;
  if (comparison.class === "CLINICAL_DIFFERENCE") {
    return legacyFallback(row, diagnostics, "CLINICAL_DIFFERENCE", "rendered body diverges clinically from the stored signed body — stored body wins", doc, render);
  }

  diagnostics.comparisonClass = comparison.class;
  diagnostics.usedStructured = true;
  return {
    body: render.body,
    usedStructured: true,
    comparisonClass: comparison.class,
    document: doc,
    render,
    diagnostics,
  };
}
