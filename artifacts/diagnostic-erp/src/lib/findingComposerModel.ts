/**
 * Structured Finding Composer — pure model.
 *
 * Builds drafts from the Quick Findings catalog + region-aware dimensions,
 * renders phrase text via existing structuredFinding templates / conservative
 * fallbacks, and routes commits through applyPathologyOverlay (same-slot).
 *
 * Impression participation reuses non-empty lastRendered.impression
 * (see observationIncludesInImpression) — no parallel boolean.
 */

import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import {
  CERVICAL_CANAL_LEVELS,
  DORSAL_CANAL_LEVELS,
  LUMBAR_CANAL_LEVELS,
  resolveCanalSegment,
} from "@/lib/spineCanalAp";
import {
  buildCanonicalObservation,
  buildSlotKey,
  extractLevel,
  normalizeLaterality,
  normalizeLevel,
  resolveConcept,
  type CanonicalObservation,
} from "@/lib/observationSlot";
import {
  fillStructuredTemplate,
  generateStructuredFinding,
  parseQuestions,
  type StructuredQuestion,
} from "@/lib/structuredFindings";
import type { AppliedPathologyPatch, PendingPathologyPatch } from "@/lib/zai-workspace/store";
import type { PathologyIncoming } from "@/lib/pathologyPatch";

export type ComposerDimensionKey = "level" | "severity" | "laterality" | "grade" | "site";

export type ComposerCatalogEntry = {
  /** Stable key for the finding option (catalog id or concept). */
  key: string;
  label: string;
  concept: string | null;
  conflictGroup: string;
  anatomicalSection: string;
  baselineReplaces: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  properties: string;
  supportsLaterality: boolean;
  questions: StructuredQuestion[];
  catalogId?: number;
};

export type FindingComposerDraft = {
  region: string;
  catalogKey: string;
  level: string;
  severity: string;
  laterality: string;
  /** When editing an existing ledger row — preserve id on same-slot update. */
  editingId?: string | null;
  /** Radiologist override; default from catalog impression text presence. */
  includeInImpression: boolean;
  /** Optional free overrides after template fill. */
  findingsOverride?: string;
  impressionOverride?: string;
};

export type ComposerVisibleControls = {
  level: boolean;
  severity: boolean;
  laterality: boolean;
  grade: boolean;
};

export type ComposerPhrase = {
  findings: string;
  impression: string;
  technique: string;
  recommendation: string;
  values: Record<string, string>;
};

export type DictationStructureProposal = {
  confidence: "high" | "low";
  draft: Partial<FindingComposerDraft> & { region: string };
  catalogKey?: string;
  reason: string;
};

const SEVERITY_OPTIONS = ["mild", "moderate", "severe"] as const;
const LATERALITY_SIDE_OPTIONS = ["left", "right", "bilateral"] as const;
const FAZEKAS_GRADES = ["1", "2", "3"] as const;

export function observationIncludesInImpression(
  patch: Pick<AppliedPathologyPatch, "lastRendered" | "templates">,
): boolean {
  return Boolean((patch.lastRendered.impression ?? patch.templates.impression ?? "").trim());
}

export function levelsForReportingRegion(region: string | null | undefined): string[] {
  const seg = resolveCanalSegment(region ?? "");
  if (seg === "cervical") return [...CERVICAL_CANAL_LEVELS];
  if (seg === "dorsal") return [...DORSAL_CANAL_LEVELS];
  if (seg === "lumbar") return [...LUMBAR_CANAL_LEVELS];
  const r = (region ?? "").toLowerCase();
  if (/spine|lumbar|ls\b/.test(r)) return [...LUMBAR_CANAL_LEVELS];
  if (/cervical/.test(r)) return [...CERVICAL_CANAL_LEVELS];
  return [];
}

function supportsLateralityFromProperties(properties: string, questions: StructuredQuestion[]): boolean {
  if (/(^|,)\s*side\s*(,|$)/i.test(properties)) return true;
  return questions.some((q) => /side|laterality/i.test(q.key) || /side|laterality/i.test(q.label));
}

function conceptNeedsLevel(concept: string | null, region: string): boolean {
  if (!concept) return levelsForReportingRegion(region).length > 0;
  if (/fazekas|senile|ventricles|meniscus|rotator|hemorrhage|infarct/.test(concept)) return false;
  if (/disc_|canal_|foraminal|root_|endplate|spondylolisthesis|ligamentum|facet/.test(concept)) {
    return true;
  }
  return levelsForReportingRegion(region).length > 0 && /spine|lumbar|cervical|dorsal/i.test(region);
}

function conceptNeedsSeverity(concept: string | null, questions: StructuredQuestion[]): boolean {
  if (questions.some((q) => /severity|grade/i.test(q.key))) return true;
  if (!concept) return false;
  return /canal_stenosis|foraminal_stenosis|disc_contour|root_contact|fazekas/.test(concept);
}

/** Build catalog entries from Quick Findings — no second pathology DB. */
export function buildComposerCatalog(
  findings: readonly QuickFinding[],
  region: string,
): ComposerCatalogEntry[] {
  const out: ComposerCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (f.isActive === false) continue;
    const questions = parseQuestions(f.questionsJson);
    const resolved = resolveConcept({
      concept: null,
      conflictGroup: f.conflictGroup,
      anatomicalSection: f.anatomicalSection,
      label: f.label,
      findingsText: f.findingText,
    });
    const key = `qf-${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: f.label,
      concept: resolved.concept,
      conflictGroup: (f.conflictGroup || "").trim(),
      anatomicalSection: (f.anatomicalSection || "").trim(),
      baselineReplaces: (f.baselineReplaces || "").trim(),
      findingText: f.findingText || "",
      impressionText: f.impressionText || "",
      techniqueText: f.techniqueText || "",
      recommendationText: f.recommendationText || "",
      properties: f.properties || "",
      supportsLaterality: supportsLateralityFromProperties(f.properties || "", questions),
      questions,
      catalogId: f.id,
    });
  }
  // Ensure common spine concepts exist even when catalog is sparse (dev / empty DB).
  if (/spine|lumbar|cervical|dorsal|ls\b/i.test(region)) {
    for (const builtin of BUILTIN_SPINE_ENTRIES) {
      if (out.some((e) => e.concept === builtin.concept)) continue;
      out.push(builtin);
    }
  }
  if (/brain/i.test(region) && !out.some((e) => e.concept === "fazekas")) {
    out.push(BUILTIN_FAZEKAS);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const BUILTIN_SPINE_ENTRIES: ComposerCatalogEntry[] = [
  {
    key: "builtin-disc-bulge",
    label: "Disc bulge",
    concept: "disc_contour",
    conflictGroup: "disc bulge",
    anatomicalSection: "{level}",
    baselineReplaces: "",
    findingText: "{severity} diffuse disc bulge at {level}[ ({laterality})].",
    impressionText: "{severity} disc bulge at {level}.",
    techniqueText: "",
    recommendationText: "",
    properties: "side",
    supportsLaterality: true,
    questions: [
      { key: "level", label: "Level", type: "select", options: [...LUMBAR_CANAL_LEVELS], default: "L4-L5", required: true, sortOrder: 0 },
      { key: "severity", label: "Severity", type: "select", options: [...SEVERITY_OPTIONS], default: "mild", required: true, sortOrder: 1 },
      { key: "laterality", label: "Laterality", type: "select", options: [...LATERALITY_SIDE_OPTIONS], default: "", required: false, sortOrder: 2 },
    ],
  },
  {
    key: "builtin-canal-stenosis",
    label: "Canal stenosis",
    concept: "canal_stenosis",
    conflictGroup: "canal stenosis",
    anatomicalSection: "{level}",
    baselineReplaces: "",
    findingText: "{severity} canal stenosis at {level} without cord compression.",
    impressionText: "{severity} canal stenosis at {level}.",
    techniqueText: "",
    recommendationText: "",
    properties: "",
    supportsLaterality: false,
    questions: [
      { key: "level", label: "Level", type: "select", options: [...LUMBAR_CANAL_LEVELS], default: "L4-L5", required: true, sortOrder: 0 },
      { key: "severity", label: "Severity", type: "select", options: [...SEVERITY_OPTIONS], default: "mild", required: true, sortOrder: 1 },
    ],
  },
  {
    key: "builtin-foraminal",
    label: "Foraminal stenosis",
    concept: "foraminal_stenosis",
    conflictGroup: "foraminal stenosis",
    anatomicalSection: "{level}",
    baselineReplaces: "",
    findingText: "{severity} {laterality} foraminal stenosis at {level}.",
    impressionText: "{severity} {laterality} foraminal stenosis at {level}.",
    techniqueText: "",
    recommendationText: "",
    properties: "side",
    supportsLaterality: true,
    questions: [
      { key: "level", label: "Level", type: "select", options: [...LUMBAR_CANAL_LEVELS], default: "L4-L5", required: true, sortOrder: 0 },
      { key: "severity", label: "Severity", type: "select", options: [...SEVERITY_OPTIONS], default: "mild", required: true, sortOrder: 1 },
      { key: "laterality", label: "Laterality", type: "select", options: [...LATERALITY_SIDE_OPTIONS], default: "left", required: true, sortOrder: 2 },
    ],
  },
];

const BUILTIN_FAZEKAS: ComposerCatalogEntry = {
  key: "builtin-fazekas",
  label: "Fazekas SVD",
  concept: "fazekas",
  conflictGroup: "fazekas",
  anatomicalSection: "White matter",
  baselineReplaces: "",
  findingText: "Fazekas grade {severity} small vessel ischemic changes in the white matter.",
  impressionText: "Fazekas grade {severity} small vessel disease.",
  techniqueText: "",
  recommendationText: "",
  properties: "",
  supportsLaterality: false,
  questions: [
    { key: "severity", label: "Grade", type: "select", options: [...FAZEKAS_GRADES], default: "1", required: true, sortOrder: 0 },
  ],
};

export function emptyComposerDraft(region: string): FindingComposerDraft {
  return {
    region,
    catalogKey: "",
    level: "",
    severity: "",
    laterality: "",
    editingId: null,
    includeInImpression: false,
  };
}

export function findCatalogEntry(
  catalog: readonly ComposerCatalogEntry[],
  key: string,
): ComposerCatalogEntry | undefined {
  return catalog.find((e) => e.key === key);
}

export function visibleComposerControls(
  entry: ComposerCatalogEntry | undefined,
  region: string,
): ComposerVisibleControls {
  if (!entry) {
    return { level: false, severity: false, laterality: false, grade: false };
  }
  const qKeys = new Set(entry.questions.map((q) => q.key.toLowerCase()));
  const isFazekas = entry.concept === "fazekas" || qKeys.has("grade");
  const level = qKeys.has("level") || conceptNeedsLevel(entry.concept, region);
  const severity = !isFazekas && (qKeys.has("severity") || conceptNeedsSeverity(entry.concept, entry.questions));
  const grade = isFazekas;
  const laterality = entry.supportsLaterality
    || qKeys.has("laterality")
    || qKeys.has("side");
  return { level, severity, laterality, grade };
}

export function severityOptionsForEntry(entry: ComposerCatalogEntry | undefined): string[] {
  if (!entry) return [...SEVERITY_OPTIONS];
  const q = entry.questions.find((x) => /severity|grade/i.test(x.key));
  if (q?.options.length) return q.options;
  if (entry.concept === "fazekas") return [...FAZEKAS_GRADES];
  return [...SEVERITY_OPTIONS];
}

export function lateralityOptionsForEntry(entry: ComposerCatalogEntry | undefined): string[] {
  if (!entry) return [...LATERALITY_SIDE_OPTIONS];
  const q = entry.questions.find((x) => /laterality|side/i.test(x.key));
  if (q?.options.length) return q.options;
  return [...LATERALITY_SIDE_OPTIONS];
}

export function levelOptionsForEntry(
  entry: ComposerCatalogEntry | undefined,
  region: string,
): string[] {
  const fromRegion = levelsForReportingRegion(region);
  if (!entry) return fromRegion;
  const q = entry.questions.find((x) => x.key === "level");
  if (q?.options.length) {
    // Prefer region-filtered intersection when both exist.
    if (fromRegion.length) {
      const set = new Set(fromRegion.map((l) => normalizeLevel(l) || l));
      const filtered = q.options.filter((o) => set.has(normalizeLevel(o) || o));
      if (filtered.length) return filtered;
    }
    return q.options;
  }
  return fromRegion;
}

export function renderComposerPhrase(
  draft: FindingComposerDraft,
  entry: ComposerCatalogEntry,
): ComposerPhrase {
  const values: Record<string, string> = {
    level: draft.level || "",
    severity: draft.severity || "",
    grade: draft.severity || "",
    laterality: draft.laterality || "",
    side: draft.laterality || "",
  };
  for (const q of entry.questions) {
    if (values[q.key] == null || values[q.key] === "") {
      if (q.key === "level") values[q.key] = draft.level;
      else if (/severity|grade/i.test(q.key)) values[q.key] = draft.severity;
      else if (/laterality|side/i.test(q.key)) values[q.key] = draft.laterality;
      else values[q.key] = q.default || "";
    }
  }

  let findings = "";
  let impression = "";
  let technique = "";
  let recommendation = "";

  if (entry.questions.length > 0 && (entry.findingText.includes("{") || entry.impressionText.includes("{"))) {
    const generated = generateStructuredFinding(
      {
        anatomicalSection: entry.anatomicalSection,
        findingText: entry.findingText,
        impressionText: entry.impressionText,
        techniqueText: entry.techniqueText,
        recommendationText: entry.recommendationText,
      },
      values,
    );
    findings = generated.finding;
    impression = generated.impression;
    technique = generated.technique;
    recommendation = generated.recommendation;
  } else if (entry.findingText.includes("{")) {
    findings = fillStructuredTemplate(entry.findingText, values);
    impression = fillStructuredTemplate(entry.impressionText, values);
  } else if (entry.findingText.trim()) {
    // Static catalog text — still inject level/severity when absent.
    findings = entry.findingText.trim();
    impression = (entry.impressionText || "").trim();
    if (draft.level && !extractLevel(findings) && conceptNeedsLevel(entry.concept, draft.region)) {
      findings = findings.replace(/\.$/, "") + ` at ${draft.level}.`;
    }
    if (draft.severity && !new RegExp(draft.severity, "i").test(findings)) {
      findings = `${draft.severity} ${findings.charAt(0).toLowerCase()}${findings.slice(1)}`;
      findings = findings.charAt(0).toUpperCase() + findings.slice(1);
    }
  } else {
    findings = fallbackPhrase(draft, entry);
    impression = draft.includeInImpression ? fallbackPhrase(draft, entry) : "";
  }

  if (draft.findingsOverride?.trim()) findings = draft.findingsOverride.trim();
  if (draft.impressionOverride?.trim()) impression = draft.impressionOverride.trim();

  if (!draft.includeInImpression) impression = "";

  return { findings, impression, technique, recommendation, values };
}

function fallbackPhrase(draft: FindingComposerDraft, entry: ComposerCatalogEntry): string {
  const parts: string[] = [];
  if (draft.severity) parts.push(draft.severity);
  if (draft.laterality) parts.push(draft.laterality);
  parts.push(entry.label.toLowerCase());
  let s = parts.join(" ").replace(/\s+/g, " ").trim();
  if (draft.level) s += ` at ${draft.level}`;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

export function draftFromObservation(
  patch: AppliedPathologyPatch,
  catalog: readonly ComposerCatalogEntry[],
  region: string,
): FindingComposerDraft {
  const obs = patch.observation;
  const concept = obs?.concept ?? patch.ownership.concept ?? null;
  const conflictGroup = obs?.conflictGroup || patch.ownership.conflictGroup || "";
  let entry = catalog.find((e) => e.catalogId != null && String(e.catalogId) === String(obs?.catalogId))
    ?? catalog.find((e) => e.concept && e.concept === concept)
    ?? catalog.find((e) => e.conflictGroup && e.conflictGroup === conflictGroup)
    ?? catalog.find((e) => e.key === patch.id);

  if (!entry && concept) {
    entry = catalog.find((e) => e.concept === concept);
  }

  return {
    region: obs?.region || region,
    catalogKey: entry?.key ?? "",
    level: obs?.level || patch.ownership.level || "",
    severity: obs?.severity || "",
    laterality: obs?.laterality || patch.ownership.laterality || "",
    editingId: patch.id,
    includeInImpression: observationIncludesInImpression(patch),
    findingsOverride: undefined,
    impressionOverride: undefined,
  };
}

/** Conservative local proposal — no new AI dependency. High confidence only when level+concept match clearly. */
export function proposeComposerFromTranscript(
  transcript: string,
  catalog: readonly ComposerCatalogEntry[],
  region: string,
): DictationStructureProposal {
  const text = (transcript ?? "").trim();
  if (!text) {
    return { confidence: "low", draft: { region }, reason: "empty" };
  }

  const level = extractLevel(text);
  const severityMatch = text.match(/\b(mild|moderate|severe)\b/i);
  const severity = severityMatch?.[1]?.toLowerCase() ?? "";
  const laterality = normalizeLaterality(
    /\bbilateral\b/i.test(text) ? "bilateral"
      : /\bleft\b/i.test(text) ? "left"
        : /\bright\b/i.test(text) ? "right"
          : "",
  );

  let entry: ComposerCatalogEntry | undefined;
  const lower = text.toLowerCase();
  const scored = catalog
    .map((e) => {
      let score = 0;
      const label = e.label.toLowerCase();
      if (label && lower.includes(label)) score += 3;
      if (e.concept && lower.includes(e.concept.replace(/_/g, " "))) score += 2;
      if (e.conflictGroup && lower.includes(e.conflictGroup.toLowerCase())) score += 2;
      if (/disc bulge|bulge/.test(lower) && e.concept === "disc_contour") score += 4;
      if (/canal stenosis/.test(lower) && e.concept === "canal_stenosis") score += 4;
      if (/foraminal/.test(lower) && e.concept === "foraminal_stenosis") score += 4;
      if (/fazekas/.test(lower) && e.concept === "fazekas") score += 4;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  entry = scored[0]?.e;
  const high = Boolean(entry && (level || entry.concept === "fazekas") && scored[0]!.score >= 3);

  if (!high || !entry) {
    return {
      confidence: "low",
      draft: { region, level, severity, laterality, includeInImpression: false },
      reason: "ambiguous-transcript",
    };
  }

  return {
    confidence: "high",
    catalogKey: entry.key,
    draft: {
      region,
      catalogKey: entry.key,
      level: level || "",
      severity: severity || (entry.concept === "fazekas" ? (text.match(/\b([123])\b/)?.[1] ?? "") : ""),
      laterality,
      includeInImpression: Boolean(entry.impressionText?.trim()),
      editingId: null,
    },
    reason: "structured-match",
  };
}

export function slotKeyForDraft(
  draft: FindingComposerDraft,
  entry: ComposerCatalogEntry,
): string {
  const lat = entry.supportsLaterality ? normalizeLaterality(draft.laterality) : "";
  return buildSlotKey({
    region: draft.region,
    concept: entry.concept,
    level: draft.level,
    laterality: lat,
  });
}

export function pendingFromComposerDraft(
  draft: FindingComposerDraft,
  entry: ComposerCatalogEntry,
  phrase: ComposerPhrase,
): PendingPathologyPatch {
  const level = normalizeLevel(draft.level) || draft.level;
  const laterality = entry.supportsLaterality ? normalizeLaterality(draft.laterality) : "";
  const incoming: PathologyIncoming = {
    findings: phrase.findings,
    impression: draft.includeInImpression ? phrase.impression : "",
    technique: phrase.technique || undefined,
    recommendation: phrase.recommendation || undefined,
  };
  const id = draft.editingId || `composer-${entry.key}-${Date.now().toString(36)}`;
  return {
    id,
    incoming,
    templates: { ...incoming },
    ownership: {
      anatomicalSection: fillStructuredTemplate(entry.anatomicalSection || level || entry.label, phrase.values)
        || level
        || entry.label,
      conflictGroup: entry.conflictGroup || entry.label,
      baselineReplaces: entry.baselineReplaces || undefined,
      concept: entry.concept ?? undefined,
      level: level || undefined,
      laterality: laterality || undefined,
    },
    source: "structured-template",
    region: draft.region,
    concept: entry.concept ?? undefined,
    level: level || undefined,
    laterality: laterality || undefined,
    label: entry.label,
    catalogId: entry.catalogId,
    properties: entry.properties,
    supportsLaterality: entry.supportsLaterality,
    findingsText: phrase.findings,
    severity: draft.severity || undefined,
    sectionsOwned: draft.includeInImpression ? ["findings", "impression"] : ["findings"],
    role: "finding",
  };
}

/** Derive default impression line from findings when enabling participation. */
export function defaultImpressionFromFindings(findings: string): string {
  const t = findings.trim();
  if (!t) return "";
  // Keep first sentence as impression candidate.
  const m = t.match(/^[^.!?]+[.!?]?/);
  return (m?.[0] ?? t).trim();
}

export function observationSlotKey(obs: CanonicalObservation | undefined): string {
  if (!obs) return "";
  return obs.slotKey || buildSlotKey({
    region: obs.region,
    concept: obs.concept,
    level: obs.level,
    laterality: obs.laterality,
  });
}
