// ─────────────────────────────────────────────────────────────────────────────
// Structured Report Renderer — Ticket D4, D1 §19 item 6 (renderer)
// (docs/STRUCTURED_REPORT_JSON_SPEC_v1.md, frozen spec revision 2).
//
// PURE renderer: a validated D1 document → deterministic, legacy-compatible
// report prose. It ASSEMBLES the strings D1 already pinned (§3.4/§7) — it never
// re-resolves the live catalog, never generates prose, never mutates its input,
// and emits no HTML. Signed/pinned wording (finding.sentence,
// impression_fragment, impression.rendered, recommendations[].text,
// sections[].rendered) is used verbatim, so a report reads identically forever
// regardless of later catalog drift (§2.4).
//
// Output (Phase 2 contract): technique, findings lines, impression lines,
// recommendations, a plain-text body, a per-line render trace (every line is
// traceable to its source), and warnings (e.g. a normal/positive coexistence
// that must be surfaced, not silently resolved).
//
// NOT built here (later tickets): HTML/PDF layout, the runtime cutover that
// makes this the report producer, and patient_reports persistence.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  StructuredReportDocument,
  Finding,
  Recommendation,
  ImpressionItem,
} from "./types";

/** Version stamped into patient_reports.render_engine_version by the D5
 *  structured-finalize path when THIS renderer produced the signed body —
 *  distinct from the legacy frontend engine's RENDER_ENGINE_VERSION ("1.0.0"
 *  in diagnostic-erp/src/lib/renderEngine.ts). Bump on any output-affecting
 *  change (the byte-for-byte golden tests pin the output for each version). */
export const STRUCTURED_RENDERER_VERSION = "d4-structured-1.0.0";

// ── Options / template snapshot ──────────────────────────────────────────────

export interface RenderOptions {
  /** Section-heading casing. "upper" (default) matches the D1 §17 pinned
   *  `impression.rendered` ("IMPRESSION:"). */
  headingCase?: "upper" | "title";
  /** Number derived impression lines ("1. …"). Default true. Pinned
   *  `impression.rendered` is always used verbatim regardless. */
  numberImpression?: boolean;
  /** Emit the TECHNIQUE section. Default true. */
  includeTechnique?: boolean;
}

/** Optional caller-supplied fallbacks used ONLY when the document itself does
 *  not pin the value (never overrides pinned content). */
export interface TemplateSnapshot {
  /** Fallback technique text when the document has no technique section. */
  technique?: string;
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  headingCase: "upper",
  numberImpression: true,
  includeTechnique: true,
};

// ── Output shapes ────────────────────────────────────────────────────────────

export type RenderSection = "technique" | "findings" | "impression" | "recommendation";

export type ImpressionTier = "critical" | "significant" | "routine";

export interface RenderedFindingLine {
  text: string;
  findingLid: string;
  definitionRef: string;
  sentenceSource: string; // content_pack_default | rule | edited | manual
  order: number;
}

export interface RenderedImpressionLine {
  text: string;
  rank: number; // 1-based display order
  tier: ImpressionTier;
  sourceType: "impression_item" | "finding_fragment";
  findingLid: string | null;
}

export interface RenderedRecommendationLine {
  text: string;
  recommendationRef: string | null;
  priority: string;
  findingRefs: string[];
  order: number;
}

export interface RenderTraceEntry {
  section: RenderSection;
  order: number; // 1-based position within its section
  text: string;
  sourceType: string; // pinned_sentence | impression_item | finding_fragment | recommendation | technique_section | template_technique
  findingLid: string | null;
  definitionRef: string | null;
  recommendationRef: string | null;
  impressionSource: string | null; // the fragment/item source, when applicable
}

export interface RenderWarning {
  code: string;
  message: string;
  findingLids?: string[];
}

export interface RenderResult {
  technique: string;
  findings: RenderedFindingLine[];
  impression: RenderedImpressionLine[];
  recommendations: RenderedRecommendationLine[];
  /** Plain-text assembled report body (no HTML). */
  body: string;
  trace: RenderTraceEntry[];
  warnings: RenderWarning[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function heading(label: string, opts: Required<RenderOptions>): string {
  return opts.headingCase === "upper" ? label.toUpperCase() : label;
}

/** D1 §3.2 `order` is the meaningful display order. Stable sort by it, falling
 *  back to array position so equal orders keep authoring order. */
function findingsInOrder(findings: Finding[]): Finding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.order - b.f.order) || (a.i - b.i))
    .map((x) => x.f);
}

function findingTier(f: Finding): ImpressionTier {
  if (f.status_flags?.is_critical) return "critical";
  if (f.status_flags?.is_significant) return "significant";
  return "routine";
}

const TIER_RANK: Record<ImpressionTier, number> = { critical: 0, significant: 1, routine: 2 };

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render a validated D1 document to deterministic, legacy-compatible prose.
 * Pure: no IO, no catalog, no clock, no mutation of `doc`.
 */
export function renderStructuredReport(
  doc: StructuredReportDocument,
  options: RenderOptions = {},
  template: TemplateSnapshot = {},
): RenderResult {
  const opts: Required<RenderOptions> = { ...DEFAULT_OPTIONS, ...options };
  const warnings: RenderWarning[] = [];
  const trace: RenderTraceEntry[] = [];

  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const ordered = findingsInOrder(findings);

  // ── Technique (pinned section, else template fallback) ──────────────────────
  let technique = "";
  let techniqueSource: "technique_section" | "template_technique" | null = null;
  if (opts.includeTechnique) {
    const techSection = (doc.sections ?? []).find((s) => s.kind === "technique" && s.rendered?.trim());
    if (techSection) {
      technique = techSection.rendered.trim();
      techniqueSource = "technique_section";
    } else if (template.technique?.trim()) {
      technique = template.technique.trim();
      techniqueSource = "template_technique";
    }
  }

  // ── Findings (pinned sentences, in D1 order) ────────────────────────────────
  const findingLines: RenderedFindingLine[] = [];
  for (const f of ordered) {
    const text = (f.sentence ?? "").trim();
    if (!text) continue; // a finding with no pinned sentence contributes no line
    findingLines.push({
      text,
      findingLid: f.lid,
      definitionRef: f.definition_ref,
      sentenceSource: f.sentence_source,
      order: f.order,
    });
  }

  // ── Impression ──────────────────────────────────────────────────────────────
  // Pinned `impression.items[]`/`.rendered` (the radiologist-approved prose) win
  // verbatim (rules 1 & 2). Only when the document pins NO impression do we
  // DERIVE one from findings' impression_fragment, applying the ordering/dedup/
  // null-skip rules (4–6).
  const pinnedImpression = doc.impression;
  const impressionLines: RenderedImpressionLine[] = [];
  let impressionBody = "";

  if (pinnedImpression && Array.isArray(pinnedImpression.items) && pinnedImpression.items.length > 0) {
    const findingByLid = new Map(findings.map((f) => [f.lid, f]));
    const items = pinnedImpression.items as ImpressionItem[];
    items.forEach((item, idx) => {
      const text = (item.text ?? "").trim();
      if (!text) return;
      // Tag the pinned item with the tier/lid of the finding it traces to (via
      // its first fragment_ref) — for the trace only; pinned items are NEVER
      // reordered.
      const firstFrag = pinnedImpression.fragments?.find((fr) => fr.lid === item.fragment_refs?.[0]);
      const linkedFinding = firstFrag?.finding_ref ? findingByLid.get(firstFrag.finding_ref) : undefined;
      impressionLines.push({
        text,
        rank: idx + 1,
        tier: linkedFinding ? findingTier(linkedFinding) : "routine",
        sourceType: "impression_item",
        findingLid: linkedFinding?.lid ?? null,
      });
    });
    // The pinned rendered prose is authoritative; use it verbatim if present.
    impressionBody = (pinnedImpression.rendered ?? "").trim()
      || `${heading("Impression", opts)}:\n${impressionLines.map((l) => l.text).join("\n")}`;
  } else {
    // Derive: collect non-empty impression_fragments, order critical→significant
    // →routine (preserving finding order within a tier), collapse exact dupes.
    const candidates = ordered
      .map((f) => ({ f, frag: (f.impression_fragment ?? "").trim() }))
      .filter((x) => x.frag !== "") // rule 5: null/empty contributes nothing
      .map((x, i) => ({ ...x, i, tier: findingTier(x.f) }))
      .sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (a.i - b.i));

    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.frag)) continue; // rule 6: exact duplicate lines collapse
      seen.add(c.frag);
      impressionLines.push({
        text: c.frag,
        rank: impressionLines.length + 1,
        tier: c.tier,
        sourceType: "finding_fragment",
        findingLid: c.f.lid,
      });
    }
    if (impressionLines.length > 0) {
      const rendered = impressionLines
        .map((l, i) => (opts.numberImpression ? `${i + 1}. ${l.text}` : l.text))
        .join("\n");
      impressionBody = `${heading("Impression", opts)}:\n${rendered}`;
    }
  }

  // ── Recommendations (deterministic: document array order) ────────────────────
  const recommendationLines: RenderedRecommendationLine[] = [];
  const recs: Recommendation[] = Array.isArray(doc.recommendations) ? doc.recommendations : [];
  recs.forEach((r, idx) => {
    const text = (r.text ?? "").trim();
    if (!text) return;
    recommendationLines.push({
      text,
      recommendationRef: r.recommendation_ref ?? null,
      priority: r.priority,
      findingRefs: Array.isArray(r.finding_refs) ? r.finding_refs : [],
      order: idx + 1,
    });
  });

  // ── Warnings ────────────────────────────────────────────────────────────────
  // Rule 7 — a normal-survey statement coexisting with a SIGNIFICANT/CRITICAL
  // positive finding is surfaced (not silently resolved). Incidental-only
  // positives (is_significant/is_critical both false) do not trip it, matching
  // the "otherwise normal with an incidental …" pattern.
  const normalFindings = findings.filter((f) => f.presence === "normal");
  const positiveSignificant = findings.filter(
    (f) => f.presence === "present" && (f.status_flags?.is_significant || f.status_flags?.is_critical),
  );
  if (normalFindings.length > 0 && positiveSignificant.length > 0) {
    warnings.push({
      code: "normal_positive_coexistence",
      message:
        "Report contains a normal-survey finding alongside a significant/critical positive finding — verify the normal statement is consistent with the positive findings.",
      findingLids: [...normalFindings.map((f) => f.lid), ...positiveSignificant.map((f) => f.lid)],
    });
  }
  if (findingLines.length > 0 && impressionLines.length === 0) {
    warnings.push({ code: "missing_impression", message: "Findings are present but the report has no impression." });
  }

  // ── Assemble the plain-text body + trace ────────────────────────────────────
  const parts: string[] = [];

  if (technique) {
    parts.push(`${heading("Technique", opts)}:\n${technique}`);
    trace.push({
      section: "technique", order: 1, text: technique,
      sourceType: techniqueSource!, findingLid: null, definitionRef: null,
      recommendationRef: null, impressionSource: null,
    });
  }

  if (findingLines.length > 0) {
    parts.push(`${heading("Findings", opts)}:\n${findingLines.map((l) => l.text).join("\n")}`);
    findingLines.forEach((l, i) => {
      trace.push({
        section: "findings", order: i + 1, text: l.text,
        sourceType: "pinned_sentence", findingLid: l.findingLid, definitionRef: l.definitionRef,
        recommendationRef: null, impressionSource: l.sentenceSource,
      });
    });
  }

  if (impressionBody) {
    parts.push(impressionBody);
    impressionLines.forEach((l, i) => {
      trace.push({
        section: "impression", order: i + 1, text: l.text,
        sourceType: l.sourceType, findingLid: l.findingLid, definitionRef: null,
        recommendationRef: null, impressionSource: l.sourceType,
      });
    });
  }

  if (recommendationLines.length > 0) {
    parts.push(`${heading("Recommendation", opts)}:\n${recommendationLines.map((l) => l.text).join("\n")}`);
    recommendationLines.forEach((l, i) => {
      trace.push({
        section: "recommendation", order: i + 1, text: l.text,
        sourceType: "recommendation", findingLid: l.findingRefs[0] ?? null, definitionRef: null,
        recommendationRef: l.recommendationRef, impressionSource: null,
      });
    });
  }

  const body = parts.join("\n\n");

  return { technique, findings: findingLines, impression: impressionLines, recommendations: recommendationLines, body, trace, warnings };
}
