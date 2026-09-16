/**
 * Workspace-only Starting Canvas change presentation.
 *
 * HIGHLIGHT = changed from Starting Canvas (never written into clinical text)
 * BOLD      = known clinically significant abnormal contribution
 *
 * Final Preview/PDF/Print must never receive these decorations.
 */
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";

import {
  SCREENING_LIMITATION_TEXT,
  SCREENING_LIMITATION_CONCEPT,
} from "./baselines/screeningLimitation";

export { SCREENING_LIMITATION_TEXT, SCREENING_LIMITATION_CONCEPT };

export type StartingCanvasBaseline = {
  formatName: string;
  formatRevision: string | null;
  findings: string;
  impression: string;
  appliedAt: string;
};

export type ChangeHighlightKind = "manual-change" | "known-abnormal";

export type ChangeHighlightSpan = {
  field: "findings" | "impression";
  text: string;
  kind: ChangeHighlightKind;
  /** Bold only for known abnormal contributions. */
  bold: boolean;
};

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function isKnownAbnormalPatch(p: AppliedPathologyPatch): boolean {
  if (isSystemNormalPatch(p)) return false;
  if (p.stale) return false;
  if (p.observation?.role === "baseline" || p.observation?.role === "screening") return false;
  if (p.observation?.concept === SCREENING_LIMITATION_CONCEPT) return false;
  if (p.source === "manual" || p.source === "radiologist-voice") return false;
  if (p.source === "system" || p.source === "ai-draft") return false;
  const findings = (p.lastRendered.findings ?? "").trim();
  const impression = (p.lastRendered.impression ?? "").trim();
  return Boolean(findings || impression);
}

/**
 * Build display-only highlight spans relative to the applied Starting Canvas.
 * Never mutates clinical text. Phrase-level when the changed unit is a single
 * sentence; otherwise sentence-level.
 */
export function buildStartingCanvasChangeHighlights(opts: {
  baseline: StartingCanvasBaseline | null | undefined;
  findingsText: string;
  impressionText: string;
  patches: AppliedPathologyPatch[];
}): ChangeHighlightSpan[] {
  const { baseline, findingsText, impressionText, patches } = opts;
  if (!baseline) return [];

  const spans: ChangeHighlightSpan[] = [];
  const seen = new Set<string>();

  const push = (span: ChangeHighlightSpan) => {
    const key = `${span.field}|${span.kind}|${normalizeKey(span.text)}`;
    if (!span.text.trim() || seen.has(key)) return;
    seen.add(key);
    spans.push(span);
  };

  // Known abnormal contributions → bold + highlight
  for (const p of patches) {
    if (!isKnownAbnormalPatch(p)) continue;
    const f = (p.lastRendered.findings ?? "").trim();
    const i = (p.lastRendered.impression ?? "").trim();
    if (f && findingsText.includes(f)) {
      push({ field: "findings", text: f, kind: "known-abnormal", bold: true });
    }
    if (i && impressionText.includes(i)) {
      push({ field: "impression", text: i, kind: "known-abnormal", bold: true });
    }
  }

  const abnormalKeys = new Set(
    spans.filter((s) => s.kind === "known-abnormal").map((s) => `${s.field}|${normalizeKey(s.text)}`),
  );

  // Manual / new text vs baseline sentences → highlight only (not bold)
  for (const field of ["findings", "impression"] as const) {
    const current = field === "findings" ? findingsText : impressionText;
    const base = field === "findings" ? baseline.findings : baseline.impression;
    const baseKeys = new Set(splitSentences(base).map(normalizeKey));
    for (const sentence of splitSentences(current)) {
      if (sentence === SCREENING_LIMITATION_TEXT) continue;
      const key = normalizeKey(sentence);
      if (baseKeys.has(key)) continue;
      if (abnormalKeys.has(`${field}|${key}`)) continue;
      push({ field, text: sentence, kind: "manual-change", bold: false });
    }
  }

  return spans;
}

/** Guard: clinical text must never contain workspace decoration markup. */
export function clinicalTextHasHighlightMarkup(text: string): boolean {
  return /data-canvas-change|data-abnormal-highlight|<\/?mark\b|canvas-change-highlight/i.test(text);
}

/**
 * Final/PDF/Preview isolation: strip any accidental workspace decoration
 * classes from HTML without removing clinical <strong> abnormal emphasis.
 */
export function stripWorkspaceChangeDecoration(html: string): string {
  return html
    .replace(/\s*data-canvas-change="[^"]*"/gi, "")
    .replace(/\s*data-editor-only="[^"]*"/gi, "")
    .replace(/\s*class="[^"]*canvas-change-highlight[^"]*"/gi, (m) => {
      const cleaned = m
        .replace(/canvas-change-highlight/g, "")
        .replace(/known-abnormal-bold/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned === 'class=""' || cleaned === "class=''" ? "" : ` ${cleaned}`;
    })
    .replace(/<mark\b[^>]*data-canvas-change[^>]*>/gi, "")
    .replace(/<\/mark>/gi, "");
}

/**
 * Rebuild Starting Canvas reference after save/reopen when format identity +
 * library revision still match. Does not store highlight markup in clinical text.
 * Returns null when reconstruction is unsafe (format missing / revision drift).
 */
export function reconstructStartingCanvasBaseline(opts: {
  formatName: string | null | undefined;
  formatRevision?: string | null;
  baselineManifestRevision?: string | null;
  appliedAt?: string | null;
  format:
    | {
        name: string;
        findings: string;
        impression: string;
        baselineManifest?: { revision?: string } | null;
      }
    | null
    | undefined;
  reportFormatRevision?: (format: { findings: string; impression: string; name?: string }) => string;
}): StartingCanvasBaseline | null {
  const name = (opts.formatName ?? "").trim();
  const format = opts.format;
  if (!name || !format || format.name !== name) return null;
  const libraryRevision =
    format.baselineManifest?.revision
    ?? (opts.reportFormatRevision ? opts.reportFormatRevision(format) : null);
  const savedRevision =
    (opts.baselineManifestRevision ?? "").trim()
    || (opts.formatRevision ?? "").trim()
    || null;
  if (savedRevision && libraryRevision && savedRevision !== libraryRevision) {
    // Format content drifted since apply — do not guess baseline prose.
    return null;
  }
  return {
    formatName: name,
    formatRevision: libraryRevision ?? savedRevision,
    findings: format.findings,
    impression: format.impression,
    appliedAt: opts.appliedAt?.trim() || new Date().toISOString(),
  };
}

export type WorkspaceOverlayPiece = {
  text: string;
  highlight: boolean;
  bold: boolean;
};

/** Split clinical text into display-only overlay pieces for FindingsEditor. */
export function workspaceOverlayPieces(
  text: string,
  spans: ChangeHighlightSpan[],
  field: "findings" | "impression",
): WorkspaceOverlayPiece[] {
  const fieldSpans = spans
    .filter((s) => s.field === field && text.includes(s.text))
    .sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text) || b.text.length - a.text.length);
  if (fieldSpans.length === 0) return [{ text, highlight: false, bold: false }];

  const pieces: WorkspaceOverlayPiece[] = [];
  let cursor = 0;
  const used = new Set<string>();
  for (const span of fieldSpans) {
    const key = normalizeKey(span.text);
    if (used.has(key)) continue;
    const idx = text.indexOf(span.text, cursor);
    if (idx < 0) continue;
    used.add(key);
    if (idx > cursor) {
      pieces.push({ text: text.slice(cursor, idx), highlight: false, bold: false });
    }
    pieces.push({ text: span.text, highlight: true, bold: span.bold });
    cursor = idx + span.text.length;
  }
  if (cursor < text.length) {
    pieces.push({ text: text.slice(cursor), highlight: false, bold: false });
  }
  return pieces.length ? pieces : [{ text, highlight: false, bold: false }];
}
