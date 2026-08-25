/**
 * Merge live editor text into server print-preview HTML and add screen-only
 * provenance tinting (Format A / Format B / Quick Select, etc.).
 *
 * Server print HTML is built from the last saved draft row; the workspace
 * editor can be ahead of that. Without merging, Print like final / Save as PDF
 * can show KEY IMAGES + letterhead but an empty or stale report body.
 */
import type { ReportImageRef } from "./reportImageRefs";
import {
  escHtml,
  fmtHeading,
  type ReportHeadingCase,
  type ReportImpressionStyle,
  type PreviewFindingsItem,
} from "./radiologyReportPreviewHtml";
import {
  formatProvenanceHover,
  provenanceMapToSegments,
  provenanceVisualKind,
  type FieldProvenanceMap,
  type ProvenanceVisualKind,
} from "./reportFieldMerge";
import { hydratePrintPreviewKeyImages } from "./radiologyReportPdfExport";
import { PROVENANCE_PREVIEW_CSS } from "./radiologyReportPreviewHtml";
import { CARE_LETTERHEAD_LOGO_DATA_URL } from "./careLetterheadLogo";
import { patchLetterpadDemographyHtml } from "./reportDemography";

/**
 * Print popups / srcDoc iframes cannot resolve `/care-….png` relative paths.
 * Always inline the bundled CARE letter-pad mark so logo shows in Print Preview
 * and Print like final even when the API fell back to a relative URL.
 */
export function ensurePrintLetterpadLogo(html: string): string {
  if (!html?.trim()) return html;
  let out = html;
  // Relative / empty logo src on letterpad header img
  out = out.replace(
    /(<img\b[^>]*\bclass="[^"]*\blogo\b[^"]*"[^>]*\bsrc=")(\/care-diagnostics-letterhead-logo\.png|\/[^"]*|)(")/gi,
    `$1${CARE_LETTERHEAD_LOGO_DATA_URL}$3`,
  );
  out = out.replace(
    /(<img\b[^>]*\bsrc=")(\/care-diagnostics-letterhead-logo\.png|)("[^>]*\bclass="[^"]*\blogo\b)/gi,
    `$1${CARE_LETTERHEAD_LOGO_DATA_URL}$3`,
  );
  // Letterpad header present but logo img missing entirely (API could not read PNG).
  if (!/\bclass="[^"]*\blogo\b/.test(out) && /letterpad-bill|class="hdr"/.test(out)) {
    out = out.replace(
      /(<div class="hdr-inner[^"]*letterpad-bill[^"]*">\s*)/i,
      `$1<img class="logo" src="${CARE_LETTERHEAD_LOGO_DATA_URL}" alt="CARE DIAGNOSTICS"/>`,
    );
  }
  return out;
}

export type LivePrintBodyInput = {
  clinicalHistory: string;
  technique: string;
  rawFindings: string;
  findingsMap: Record<string, PreviewFindingsItem>;
  useStructured: boolean;
  impression: string[];
  recommendation: string;
  impressionStyle?: ReportImpressionStyle;
  headingCase?: ReportHeadingCase;
};

function normalizeImpressionBullet(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(/^\s*(?:\d+[\.\)]\s+|[-•*]\s+)/, "").trim();
  return stripped || trimmed;
}

/** Preserve s/o slash; collapse unicode slash lookalikes. */
function normalizePrintPlainText(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u2215\u2044\uFF0F]/g, "/")
    .replace(/\u00A0/g, " ");
}

/** Escape HTML then honour **bold** / __bold__ markdown for print findings. */
export function formatPrintBodyHtml(text: string): string {
  const normalized = normalizePrintPlainText(text);
  const parts: string[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) != null) {
    if (m.index > last) parts.push(escHtml(normalized.slice(last, m.index)));
    parts.push(`<strong>${escHtml(m[1] ?? m[2] ?? "")}</strong>`);
    last = m.index + m[0].length;
  }
  if (last < normalized.length) parts.push(escHtml(normalized.slice(last)));
  return parts.join("").replaceAll("\n", "<br/>");
}

function renderImpressionSectionHtml(
  bullets: string[],
  style: ReportImpressionStyle,
): string {
  const items = bullets.filter(Boolean).map(normalizeImpressionBullet);
  if (items.length === 0) return "";
  const heading = `<div class="section-heading">Impression</div>`;
  if (style === "numbered") {
    return `${heading}<ol>${items.map((b) => `<li>${formatPrintBodyHtml(b)}</li>`).join("")}</ol>`;
  }
  if (style === "plain") {
    return `${heading}<p>${items.map((b) => formatPrintBodyHtml(b)).join("; ")}</p>`;
  }
  return `${heading}<ul>${items.map((b) => `<li>${formatPrintBodyHtml(b)}</li>`).join("")}</ul>`;
}

/** Body sections in the same shape as GET …/print-preview (reportPresentation). */
export function buildLivePrintBodyHtml(input: LivePrintBodyInput): string {
  const hc = input.headingCase ?? "all_caps";
  const ist = input.impressionStyle ?? "bulleted";
  const parts: string[] = [];

  if (input.clinicalHistory?.trim()) {
    parts.push(
      `<div class="section-heading">${escHtml(fmtHeading("Clinical History", hc))}</div>`,
      `<p>${formatPrintBodyHtml(input.clinicalHistory.trim())}</p>`,
    );
  }
  if (input.technique?.trim()) {
    parts.push(
      `<div class="section-heading">${escHtml(fmtHeading("Technique", hc))}</div>`,
      `<p>${formatPrintBodyHtml(input.technique.trim())}</p>`,
    );
  }

  if (input.useStructured) {
    const findingsParts: string[] = [];
    for (const [name, item] of Object.entries(input.findingsMap)) {
      const text = (item.text?.trim() || (item.normal ? "Normal." : "—"));
      if (!text) continue;
      findingsParts.push(
        `<div class="section-heading">${escHtml(fmtHeading(name, hc))}</div>`,
        `<p>${formatPrintBodyHtml(text)}</p>`,
      );
    }
    if (findingsParts.length > 0) parts.push(...findingsParts);
  } else if (input.rawFindings?.trim()) {
    parts.push(
      `<div class="section-heading">${escHtml(fmtHeading("Findings", hc))}</div>`,
      `<p>${formatPrintBodyHtml(input.rawFindings.trim())}</p>`,
    );
  }

  const impressionHtml = renderImpressionSectionHtml(input.impression, ist);
  if (impressionHtml) parts.push(impressionHtml);

  const rec = input.recommendation?.trim() || "Please correlate with clinical findings.";
  parts.push(
    `<div class="section-heading">${escHtml(fmtHeading("Recommendation", hc))}</div>`,
    `<p>${formatPrintBodyHtml(rec)}</p>`,
  );

  return parts.join("\n");
}

/** Replace `<div class="body">…</div>` using depth counting (nested section headings). */
export function replacePrintBodyDiv(html: string, liveBodyHtml: string): string | null {
  const start = html.search(/<div\b[^>]*\bclass="[^"]*\bbody\b[^"]*"[^>]*>/);
  if (start < 0) return null;
  let i = start;
  let depth = 0;
  const openRe = /<div\b[^>]*>/gi;
  const closeRe = /<\/div>/gi;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
      continue;
    }
    depth -= 1;
    i = close.index + close[0].length;
    if (depth === 0) {
      return `${html.slice(0, start)}<div class="body">${liveBodyHtml}</div>${html.slice(i)}`;
    }
  }
  return null;
}

/** Replace the server draft body with the live editor body (letterhead/images unchanged). */
export function mergeLiveBodyIntoPrintHtml(printHtml: string, liveBodyHtml: string): string {
  if (!printHtml?.trim() || !liveBodyHtml?.trim()) return printHtml;
  const replaced = replacePrintBodyDiv(printHtml, liveBodyHtml);
  if (replaced) return replaced;
  // Fallback: inject before signatures inside report column.
  if (printHtml.includes('class="report-column"')) {
    return printHtml.replace(
      /(<div class="report-column">[\s\S]*?)(<div class="sigs")/,
      `$1<div class="body">${liveBodyHtml}</div>$2`,
    );
  }
  return printHtml;
}

const PROV_CLASS: Record<ProvenanceVisualKind, string> = {
  manual: "",
  "quick-select": "prov-quick-select",
  "quick-findings": "prov-quick-findings",
  merged: "prov-merged",
  "template-a": "prov-template-a",
  "template-b": "prov-template-b",
  "structured-template": "prov-structured",
  "structured-candidate": "prov-structured-candidate",
  other: "prov-other",
};

function htmlWithProvenance(text: string, provenance: FieldProvenanceMap): string {
  const segments = provenanceMapToSegments(text, provenance);
  if (segments.length === 0) return escHtml(text);
  return segments.map((seg) => {
    const kind = provenanceVisualKind(seg.sources);
    const cls = PROV_CLASS[kind];
    const title = formatProvenanceHover(seg.sources);
    if (!cls) return escHtml(seg.text);
    return `<span class="${cls} preview-prov" title="${escHtml(title)}">${escHtml(seg.text)}</span>`;
  }).join("<br/>");
}

/** Screen-only: tint merged template / QS lines inside print body sections. */
export function injectProvenancePreviewChrome(
  printHtml: string,
  opts: {
    findingsText: string;
    impressionText: string;
    findingsProvenance?: FieldProvenanceMap;
    impressionProvenance?: FieldProvenanceMap;
  },
): string {
  if (!printHtml?.trim()) return printHtml;
  let out = printHtml;
  const fp = opts.findingsProvenance ?? {};
  const ip = opts.impressionProvenance ?? {};

  if (opts.findingsText.trim() && Object.keys(fp).length > 0) {
    const tinted = htmlWithProvenance(opts.findingsText, fp);
    // Replace first Findings section paragraph block (server uses section-heading Findings).
    out = out.replace(
      /(<div class="section-heading">[^<]*Findings[^<]*<\/div>\s*<p>)([\s\S]*?)(<\/p>)/i,
      `$1${tinted}$3`,
    );
  }

  if (opts.impressionText.trim() && Object.keys(ip).length > 0) {
    const tinted = htmlWithProvenance(
      opts.impressionText.split("\n").filter(Boolean).join("\n"),
      ip,
    );
    out = out.replace(
      /(<div class="section-heading">[^<]*Impression[^<]*<\/div>\s*<(ul|ol|p)>)([\s\S]*?)(<\/\2>)/i,
      (_m, open, _tag, _inner, close) => {
        // Re-render impression as a single paragraph with provenance spans for preview.
        return `<div class="section-heading">Impression</div><p>${tinted}</p>`;
      },
    );
  }

  const legend = `<div class="preview-provenance-legend no-print" aria-hidden="true">`
    + `<span class="prov-template-a">● Format A</span>`
    + `<span class="prov-template-b">● Format B</span>`
    + `<span class="prov-quick-select">● Quick Select</span>`
    + `<span class="prov-quick-findings">● Quick Findings</span>`
    + `<span class="prov-merged">● Merged</span>`
    + ` <em>(colours — preview only; not printed)</em></div>`;

  if (out.includes("</style>")) {
    out = out.replace("</style>", `${PROVENANCE_PREVIEW_CSS}\n</style>`);
  }
  if (out.includes('<div class="report-column">')) {
    out = out.replace('<div class="report-column">', `<div class="report-column">${legend}`);
  } else if (out.includes('<div class="body">')) {
    out = out.replace('<div class="body">', `${legend}<div class="body">`);
  }
  return out;
}

export type FinalizePrintPreviewOpts = {
  livePrintBodyHtml: string;
  findingsText: string;
  impressionText: string;
  findingsProvenance?: FieldProvenanceMap;
  impressionProvenance?: FieldProvenanceMap;
  dicomWebBase: string | null;
  imageRefs: ReportImageRef[];
  /** Screen preview only — skip for Word export and browser print. */
  includeProvenanceChrome?: boolean;
  /** Client canonical demography — patches letterpad AGE/SEX + REFD. BY. */
  demography?: {
    patientName?: string | null;
    age?: string | null;
    sex?: string | null;
    referringDoctor?: string | null;
    studyDate?: string | null;
  };
};

/** Server print HTML + live body + provenance chrome + client key-image hydrate. */
export async function finalizePrintPreviewHtml(
  serverHtml: string,
  opts: FinalizePrintPreviewOpts,
): Promise<string> {
  if (!serverHtml?.trim()) return serverHtml;
  let html = ensurePrintLetterpadLogo(serverHtml);
  if (opts.demography) {
    html = patchLetterpadDemographyHtml(html, opts.demography);
  }
  html = mergeLiveBodyIntoPrintHtml(html, opts.livePrintBodyHtml);
  if (opts.includeProvenanceChrome !== false) {
    html = injectProvenancePreviewChrome(html, {
      findingsText: opts.findingsText,
      impressionText: opts.impressionText,
      findingsProvenance: opts.findingsProvenance,
      impressionProvenance: opts.impressionProvenance,
    });
  }
  return hydratePrintPreviewKeyImages(html, opts.dicomWebBase, opts.imageRefs);
}
