/**
 * Governed abnormal-template pattern library (V-03).
 *
 * Suggestion-only. Nothing in this module writes the report.
 * Every findings/impression/recommendation string is copied verbatim from an
 * existing Quick Select tile, chocolate macro, or full-report format.
 * Missing or invalid `abnormal_pattern_library` falls back to these seeds.
 */

import type { MergeResult, MergeSentence } from "@/lib/zai-workspace/types";

export type AbnormalPatternBundleItem = {
  concept: string;
  level?: string;
  laterality?: string;
  severity?: string;
  conflictGroup: string;
  region: string;
  findingsText: string;
  impressionText: string;
  recommendationText?: string;
};

export type AbnormalPattern = {
  id: string;
  version: number;
  owner: string;
  updatedAt: string;
  region: string;
  modality: string[];
  label: string;
  /** Clinic toggle. Omitted or true = enabled. */
  enabled?: boolean;
  match: {
    protocols?: string[];
    anyChipLabels?: string[];
    historyKeywords?: string[];
    findingsKeywords?: string[];
  };
  /** Normal fork stays owned by Full Report Formats. */
  fork: "abnormal";
  bundle: AbnormalPatternBundleItem[];
};

export type AbnormalPatternMatchInput = {
  region: string;
  modality: string;
  protocolName?: string | null;
  selectedChipLabels: string[];
  clinicalHistory?: string;
  findingsText?: string;
  /** Ledger bundle ids. `pattern-${id}-v${version}` suppresses that pattern. */
  appliedBundleIds?: string[];
  /** Draft structuredJson appliedPatterns ids. */
  appliedPatternIds?: string[];
  /** useCopilotLearning dismissals for this study (pattern ids, not the copilot key). */
  dismissedPatternIds?: string[];
};

export type AbnormalPatternHit = {
  pattern: AbnormalPattern;
  score: number;
  reasons: string[];
};

export const ABNORMAL_PATTERN_LIBRARY_KEY = "abnormal_pattern_library";
export const ABNORMAL_PATTERN_SUGGESTIONS_ENABLED_KEY = "abnormal_pattern_suggestions_enabled";

const SEED_UPDATED_AT = "2026-09-27T00:00:00.000Z";

/**
 * Six built-in patterns. Prose citations:
 * - lumbar-degenerative-cascade — findingsMacros.ts SPINE_COMMON_TILES id "spine-degenerative"
 * - cervical-spondylotic-myelopathy — report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)")
 * - brain-chronic-small-vessel — quick-select-tiles.data.ts t("findings","Fazekas 1", …)
 * - brain-postop-cavity-residual — report-formats-library.ts fmt("MRI Brain — Glioma recurrence")
 *   (no separate post-op-cavity sentence exists; this findings string contains "post-resection cavity")
 * - lumbar-post-discectomy — quick-select-tiles.data.ts t("findings","Disc herniation L4-L5", …)
 *   (no discectomy/laminectomy sentence exists in the catalog)
 * - dorsal-disc — findingsMacros.ts SPINE_COMMON_TILES id "spine-disc-bulge"
 *   (tile has no impressionText; impression left empty rather than invented)
 */
export const BUILTIN_ABNORMAL_PATTERNS: readonly AbnormalPattern[] = [
  {
    id: "lumbar-degenerative-cascade",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "LS Spine",
    modality: ["MR"],
    label: "Lumbar degenerative cascade",
    fork: "abnormal",
    match: {
      protocols: ["lumbar", "ls spine", "lumbosacral", "lumbo-sacral"],
      anyChipLabels: ["disc bulge", "disc herniation", "disc desiccation", "facet arthropathy"],
      historyKeywords: ["radiculopathy"],
      findingsKeywords: ["desiccation", "osteophyte", "facet arthropathy"],
    },
    bundle: [
      {
        concept: "disc_signal",
        conflictGroup: "disc_signal",
        region: "LS Spine",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative observations[0].findingsText
        findingsText: "Lumbar discs show loss of T2 signal (desiccation).",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative impressionText
        impressionText: "Lumbar degenerative disc disease.",
      },
      {
        concept: "disc_height",
        level: "L4-L5",
        conflictGroup: "disc_height",
        region: "LS Spine",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative observations[1].findingsText
        findingsText: "Disc height is reduced at L4-L5.",
        impressionText: "",
      },
      {
        concept: "osteophytes",
        conflictGroup: "osteophytes",
        region: "LS Spine",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative observations[2].findingsText
        findingsText: "Marginal osteophytes are present at the lumbar vertebral endplates.",
        impressionText: "",
      },
      {
        concept: "facet_joint",
        level: "L4-L5",
        conflictGroup: "facet_joint",
        region: "LS Spine",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative observations[3].findingsText
        findingsText: "Facet arthropathy at L4-L5.",
        impressionText: "",
      },
      {
        concept: "endplate",
        level: "L4-L5",
        conflictGroup: "endplate",
        region: "LS Spine",
        // findingsMacros.ts SPINE_COMMON_TILES spine-degenerative observations[4].findingsText
        findingsText: "Modic type endplate changes at L4-L5.",
        impressionText: "",
      },
    ],
  },
  {
    id: "cervical-spondylotic-myelopathy",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "Cervical Spine",
    modality: ["MR"],
    label: "Cervical spondylotic myelopathy",
    fork: "abnormal",
    match: {
      protocols: ["cervical", "c-spine", "c spine"],
      anyChipLabels: ["myelopathy", "cord signal"],
      historyKeywords: ["myelopathy", "cord compression"],
      findingsKeywords: ["myelopathic", "cord oedema", "cord compression"],
    },
    bundle: [
      {
        concept: "cord_signal",
        conflictGroup: "cord_signal",
        region: "Cervical Spine",
        // report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)").findings
        findingsText: "Loss of cervical lordosis. Diffuse broad-based disc bulge with posterior annular tear and central protrusion causing anterior thecal sac compression and compression of bilateral traversing nerve roots at C4-C5 and C5-C6. T2W hyperintense signal in the cord from C4 through C6 vertebral levels — suggestive of cord oedema/myelopathic changes. Disc desiccation at multiple levels. Cervical vertebrae show normal marrow signal. No spondylolisthesis. Facet joints and ligamentum flavum are normal. Pre- and paraspinal structures are normal.",
        // report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)").impression
        impressionText: "Cervical cord compression at C4-C5 and C5-C6 with T2 signal change in the cord — consistent with compressive myelopathy.",
        // report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)").recommendation
        recommendationText: "Urgent neurosurgical consultation. Clinical correlation for neurological deficits.",
      },
    ],
  },
  {
    id: "brain-chronic-small-vessel",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "Brain",
    modality: ["MR"],
    label: "Brain chronic small-vessel",
    fork: "abnormal",
    match: {
      protocols: ["brain", "mri brain"],
      anyChipLabels: ["fazekas", "small vessel"],
      historyKeywords: ["small vessel", "fazekas", "white matter"],
      findingsKeywords: ["fazekas", "small vessel"],
    },
    bundle: [
      {
        concept: "fazekas",
        conflictGroup: "fazekas",
        region: "Brain",
        // quick-select-tiles.data.ts t("findings","Fazekas 1", …).sentence
        findingsText: "Few punctate T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions.",
        // quick-select-tiles.data.ts t("findings","Fazekas 1", …).impressionSentence
        impressionText: "Mild chronic small vessel ischemic disease (Fazekas grade 1).",
      },
    ],
  },
  {
    id: "brain-postop-cavity-residual",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "Brain",
    modality: ["MR"],
    label: "Brain post-op cavity/residual",
    fork: "abnormal",
    match: {
      protocols: ["brain", "post-op", "postop"],
      anyChipLabels: ["glioma recurrence", "recurrence", "post-resection"],
      historyKeywords: ["recurrence", "post-op", "postop", "resection", "cavity"],
      findingsKeywords: ["post-resection", "recurrence", "cavity"],
    },
    bundle: [
      {
        concept: "tumor_recurrence",
        conflictGroup: "tumor recurrence",
        region: "Brain",
        // report-formats-library.ts fmt("MRI Brain — Glioma recurrence").findings
        // No dedicated post-op cavity sentence exists; this catalog findings string contains "post-resection cavity".
        findingsText: "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence. No new satellite lesions. No midline shift. Ventricular system is normal. Basal cisterns are unremarkable. No restricted diffusion on DWI/ADC. Flow voids in major intracranial vessels are normal.",
        // report-formats-library.ts fmt("MRI Brain — Glioma recurrence").impression
        impressionText: "Heterogeneously enhancing lesion in the right frontal operculum with surrounding edema. Findings are concerning for tumor recurrence. Recommend correlation with clinical status and oncology referral.",
        // report-formats-library.ts fmt("MRI Brain — Glioma recurrence").recommendation
        recommendationText: "Urgent oncology referral. Recommend MRI brain with contrast and perfusion imaging in 6-8 weeks. Consider MR spectroscopy if clinically indicated.",
      },
    ],
  },
  {
    id: "lumbar-post-discectomy",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "LS Spine",
    modality: ["MR"],
    label: "Lumbar post-discectomy",
    fork: "abnormal",
    match: {
      protocols: ["discectomy", "post-op", "postop", "postoperative"],
      anyChipLabels: ["disc herniation", "disc bulge"],
      historyKeywords: ["discectomy", "post-op", "postop", "postoperative"],
      findingsKeywords: ["disc bulge", "herniation", "thecal sac"],
    },
    bundle: [
      {
        concept: "disc_contour",
        level: "L4-L5",
        conflictGroup: "disc bulge",
        region: "LS Spine",
        // quick-select-tiles.data.ts t("findings","Disc herniation L4-L5", …).sentence
        // No discectomy-specific sentence exists in Quick Select, chocolate macros, or full-report formats.
        findingsText: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.",
        // quick-select-tiles.data.ts t("findings","Disc herniation L4-L5", …).impressionSentence
        impressionText: "Disc herniation at L4-L5 causing indentation on the thecal sac.",
      },
    ],
  },
  {
    id: "dorsal-disc",
    version: 1,
    owner: "builtin",
    updatedAt: SEED_UPDATED_AT,
    region: "Dorsal Spine",
    modality: ["MR"],
    label: "Dorsal disc",
    fork: "abnormal",
    match: {
      protocols: ["dorsal", "thoracic", "d-spine"],
      anyChipLabels: ["disc bulge"],
      historyKeywords: ["dorsal", "thoracic"],
      findingsKeywords: ["thecal sac", "disc bulge"],
    },
    bundle: [
      {
        concept: "disc_contour",
        conflictGroup: "disc-bulge",
        region: "Dorsal Spine",
        // findingsMacros.ts SPINE_COMMON_TILES id "spine-disc-bulge" text
        // (inherited by dorsal). The tile has no impressionText — left empty so no prose is invented.
        findingsText: "Diffuse disc bulge at the [Level] level indenting the anterior thecal sac, [with/without] impingement on the [exiting nerve root].",
        impressionText: "",
      },
    ],
  },
];

const USAGE_STORAGE_KEY = "care-abnormal-pattern-usage-v1";

const CATEGORY_WEIGHT = {
  protocol: 3,
  chips: 3,
  history: 2,
  findings: 2,
} as const;

export function patternBundleId(pattern: Pick<AbnormalPattern, "id" | "version">): string {
  return `pattern-${pattern.id}-v${pattern.version}`;
}

export function cloneBuiltinAbnormalPatterns(): AbnormalPattern[] {
  return BUILTIN_ABNORMAL_PATTERNS.map((p) => ({
    ...p,
    modality: [...p.modality],
    match: {
      protocols: p.match.protocols ? [...p.match.protocols] : undefined,
      anyChipLabels: p.match.anyChipLabels ? [...p.match.anyChipLabels] : undefined,
      historyKeywords: p.match.historyKeywords ? [...p.match.historyKeywords] : undefined,
      findingsKeywords: p.match.findingsKeywords ? [...p.match.findingsKeywords] : undefined,
    },
    bundle: p.bundle.map((item) => ({ ...item })),
  }));
}

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalRegion(raw: string): string {
  const n = norm(raw);
  if (!n) return "";
  if (n.includes("cervical")) return "cervical spine";
  if (n.includes("dorsal") || n.includes("thoracic")) return "dorsal spine";
  if (n.includes("brain") || n === "head") return "brain";
  if (
    n.includes("lumbar")
    || n.includes("lumbosacral")
    || n.includes("lumbo-sacral")
    || n.includes("lumbo sacral")
    || n === "ls spine"
    || n === "ls"
    || n.includes("ls spine")
  ) return "ls spine";
  return n;
}

function modalityMatches(patternMods: string[], studyMod: string): boolean {
  const m = norm(studyMod);
  if (!m) return false;
  return patternMods.some((p) => {
    const x = norm(p);
    if (x === m) return true;
    const mr = x === "mr" || x === "mri";
    const studyMr = m === "mr" || m === "mri";
    return mr && studyMr;
  });
}

function isBaselineNormalLabel(label: string): boolean {
  const n = norm(label);
  if (!n) return false;
  return /\bnormal\b/.test(n);
}

/** Selected chips that are all baseline-normal force every pattern to score 0. */
export function selectedChipsAreAllBaselineNormal(labels: readonly string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return false;
  return cleaned.every(isBaselineNormalLabel);
}

function containsNeedle(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (!h || !n) return false;
  return h.includes(n);
}

function patternIdFromBundleId(bundleId: string): string | null {
  const m = /^pattern-(.+)-v\d+$/.exec(bundleId.trim());
  return m?.[1] ?? null;
}

export function suppressedPatternIds(input: Pick<AbnormalPatternMatchInput, "appliedBundleIds" | "appliedPatternIds" | "dismissedPatternIds">): Set<string> {
  const ids = new Set<string>();
  for (const id of input.appliedPatternIds ?? []) {
    if (id.trim()) ids.add(id.trim());
  }
  for (const id of input.dismissedPatternIds ?? []) {
    if (id.trim()) ids.add(id.trim());
  }
  for (const bundleId of input.appliedBundleIds ?? []) {
    const parsed = patternIdFromBundleId(bundleId);
    if (parsed) ids.add(parsed);
  }
  return ids;
}

function isPattern(value: unknown): value is AbnormalPattern {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AbnormalPattern>;
  if (typeof row.id !== "string" || !row.id.trim()) return false;
  if (typeof row.version !== "number" || !Number.isFinite(row.version)) return false;
  if (typeof row.label !== "string" || !row.label.trim()) return false;
  if (typeof row.region !== "string" || !row.region.trim()) return false;
  if (!Array.isArray(row.modality) || row.modality.length === 0) return false;
  if (row.fork !== "abnormal") return false;
  if (!Array.isArray(row.bundle) || row.bundle.length === 0) return false;
  return row.bundle.every((item) => {
    if (!item || typeof item !== "object") return false;
    const b = item as Partial<AbnormalPatternBundleItem>;
    return typeof b.concept === "string"
      && typeof b.conflictGroup === "string"
      && typeof b.region === "string"
      && typeof b.findingsText === "string"
      && typeof b.impressionText === "string";
  });
}

/** Missing or invalid library JSON → built-in seeds. A valid array replaces seeds. */
export function parseAbnormalPatternLibrary(raw: unknown): AbnormalPattern[] {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return cloneBuiltinAbnormalPatterns();
    try {
      value = JSON.parse(trimmed);
    } catch {
      return cloneBuiltinAbnormalPatterns();
    }
  }
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && Array.isArray((value as { patterns?: unknown }).patterns)
      ? (value as { patterns: unknown[] }).patterns
      : null);
  if (!list) return cloneBuiltinAbnormalPatterns();
  const parsed = list.filter(isPattern);
  if (parsed.length === 0) return cloneBuiltinAbnormalPatterns();
  return parsed.map((p) => ({
    ...p,
    modality: [...p.modality],
    match: { ...p.match },
    bundle: p.bundle.map((item) => ({ ...item })),
  }));
}

export function resolveAbnormalPatternSettings(
  rows?: ReadonlyArray<{ key: string; value: string | null }> | null,
): { patterns: AbnormalPattern[]; suggestionsEnabled: boolean } {
  if (!rows) {
    return { patterns: cloneBuiltinAbnormalPatterns(), suggestionsEnabled: true };
  }
  const lib = rows.find((r) => r.key === ABNORMAL_PATTERN_LIBRARY_KEY);
  const flag = rows.find((r) => r.key === ABNORMAL_PATTERN_SUGGESTIONS_ENABLED_KEY);
  const suggestionsEnabled = !flag || flag.value == null || flag.value === ""
    ? true
    : flag.value === "true";
  const patterns = lib && lib.value != null && lib.value.trim() !== ""
    ? parseAbnormalPatternLibrary(lib.value)
    : cloneBuiltinAbnormalPatterns();
  return { patterns, suggestionsEnabled };
}

export function serializeAbnormalPatternLibrary(patterns: readonly AbnormalPattern[]): string {
  return JSON.stringify({ patterns });
}

function storageOrNull(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Local usage-counter seam. Not telemetry. */
export function readPatternUsageCounts(): Record<string, number> {
  const store = storageOrNull();
  if (!store) return {};
  try {
    const raw = store.getItem(USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function bumpPatternUsageCount(patternId: string): Record<string, number> {
  const next = { ...readPatternUsageCounts(), [patternId]: (readPatternUsageCounts()[patternId] ?? 0) + 1 };
  const store = storageOrNull();
  if (store) {
    try {
      store.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode — in-memory count still returns */
    }
  }
  return next;
}

/**
 * Ranked suggestions. A hit needs at least two independent signal categories
 * (protocol / chips / history / findings). Baseline-normal-only chip sets score 0.
 * Suppressed patterns (ledger bundle, applied marker, dismissal) are omitted.
 */
export function matchAbnormalPatterns(
  input: AbnormalPatternMatchInput,
  patterns: readonly AbnormalPattern[] = BUILTIN_ABNORMAL_PATTERNS,
): AbnormalPatternHit[] {
  if (selectedChipsAreAllBaselineNormal(input.selectedChipLabels)) return [];
  const suppressed = suppressedPatternIds(input);
  const studyRegion = canonicalRegion(input.region);
  const hits: AbnormalPatternHit[] = [];
  for (const pattern of patterns) {
    if (pattern.enabled === false) continue;
    if (pattern.fork !== "abnormal") continue;
    if (suppressed.has(pattern.id)) continue;
    if (canonicalRegion(pattern.region) !== studyRegion) continue;
    if (!modalityMatches(pattern.modality, input.modality)) continue;
    const reasons: string[] = [];
    let categories = 0;
    let score = 0;
    const protocolName = (input.protocolName ?? "").trim();
    if (protocolName && (pattern.match.protocols ?? []).some((needle) => containsNeedle(protocolName, needle) || containsNeedle(needle, protocolName))) {
      categories += 1;
      score += CATEGORY_WEIGHT.protocol;
      const needle = (pattern.match.protocols ?? []).find((n) => containsNeedle(protocolName, n) || containsNeedle(n, protocolName));
      reasons.push(`Protocol “${protocolName}” matches ${needle}`);
    }
    const chipHit = (input.selectedChipLabels ?? []).find((label) =>
      (pattern.match.anyChipLabels ?? []).some((needle) => containsNeedle(label, needle)),
    );
    if (chipHit) {
      categories += 1;
      score += CATEGORY_WEIGHT.chips;
      reasons.push(`Chip “${chipHit.trim()}”`);
    }
    const history = input.clinicalHistory ?? "";
    const historyHit = (pattern.match.historyKeywords ?? []).find((needle) => containsNeedle(history, needle));
    if (historyHit) {
      categories += 1;
      score += CATEGORY_WEIGHT.history;
      reasons.push(`History contains “${historyHit}”`);
    }
    const findings = input.findingsText ?? "";
    const findingsHit = (pattern.match.findingsKeywords ?? []).find((needle) => containsNeedle(findings, needle));
    if (findingsHit) {
      categories += 1;
      score += CATEGORY_WEIGHT.findings;
      reasons.push(`Findings contain “${findingsHit}”`);
    }
    if (categories < 2 || reasons.length === 0) continue;
    hits.push({ pattern, score, reasons });
  }
  hits.sort((a, b) => b.score - a.score || a.pattern.label.localeCompare(b.pattern.label));
  return hits;
}

export type AbnormalPatternObservationPayload = {
  incoming: { findings?: string; impression?: string; recommendation?: string };
  templates: { findings?: string; impression?: string; recommendation?: string };
  ownership: { concept: string; conflictGroup: string };
  source: "abnormal-pattern";
  id: string;
  region: string;
  concept: string;
  level?: string;
  laterality?: string;
  severity?: string;
  label: string;
  findingsText: string;
  bundleId: string;
};

export function buildAbnormalPatternObservations(
  pattern: AbnormalPattern,
  region: string,
): AbnormalPatternObservationPayload[] {
  const bundleId = patternBundleId(pattern);
  return pattern.bundle.map((obs, i) => {
    const impression = obs.impressionText.trim() ? obs.impressionText : undefined;
    const recommendation = obs.recommendationText?.trim() ? obs.recommendationText : undefined;
    return {
      incoming: {
        findings: obs.findingsText,
        impression,
        recommendation,
      },
      templates: {
        findings: obs.findingsText,
        impression,
        recommendation,
      },
      ownership: {
        concept: obs.concept,
        conflictGroup: obs.conflictGroup,
      },
      source: "abnormal-pattern",
      id: `${bundleId}-${obs.concept || i}`,
      region: obs.region || region,
      concept: obs.concept,
      level: obs.level,
      laterality: obs.laterality,
      severity: obs.severity,
      label: pattern.label,
      findingsText: obs.findingsText,
      bundleId,
    };
  });
}

function toMergeSentences(block: string): MergeSentence[] {
  return block
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+/))
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, source: "from-a" as const }));
}

function fieldResult(block: string) {
  const sentences = toMergeSentences(block);
  return {
    text: block,
    sentences,
    common: 0,
    addedFromA: sentences.length,
    addedFromB: 0,
    discarded: [] as string[],
  };
}

/** Synthetic merge preview so the existing MergePreviewDialog can show the bundle before confirm. */
export function buildAbnormalPatternMergePreview(pattern: AbnormalPattern): MergeResult {
  const findings = pattern.bundle.map((b) => b.findingsText.trim()).filter(Boolean).join("\n");
  const impression = pattern.bundle.map((b) => b.impressionText.trim()).filter(Boolean).join("\n");
  const recommendation = pattern.bundle.map((b) => (b.recommendationText ?? "").trim()).filter(Boolean).join("\n");
  const findingsMerged = fieldResult(findings);
  const impressionMerged = fieldResult(impression);
  const recommendationMerged = fieldResult(recommendation);
  return {
    clinicalHistory: "",
    clinicalHistorySentences: [],
    technique: "",
    techniqueSentences: [],
    findings,
    impression,
    recommendation,
    findingsMerged,
    impressionMerged,
    recommendationMerged,
    stats: {
      commonSentencesDiscarded: 0,
      addedFromA: findingsMerged.addedFromA + impressionMerged.addedFromA + recommendationMerged.addedFromA,
      addedFromB: 0,
      totalFinal: findingsMerged.sentences.length + impressionMerged.sentences.length + recommendationMerged.sentences.length,
    },
    combinedReportTitle: pattern.label,
  };
}
