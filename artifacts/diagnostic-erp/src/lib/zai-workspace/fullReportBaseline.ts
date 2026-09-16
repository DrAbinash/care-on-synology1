import { buildCanonicalObservation } from "@/lib/observationSlot";
import type { LedgerPatch } from "@/lib/observationLedger";
import {
  SYSTEM_NORMAL_CONCEPT,
  SYSTEM_NORMAL_PATCH_ID,
} from "@/lib/conceptCanon/normalImpression";
import {
  validateBaselineManifestStructure,
} from "@workspace/baseline-manifest";
import type {
  BaselineManifest,
  BaselineManifestObservation,
  ReportFormat,
} from "./types";
import {
  ownedBaselineCatalog,
  SCREENING_LIMITATION_CONCEPT,
} from "./baselines";

export { FULL_REPORT_BASELINE_KIND } from "./baselineKind";
import { FULL_REPORT_BASELINE_KIND } from "./baselineKind";

export {
  ownedBaselineCatalog,
  SCREENING_LIMITATION_CONCEPT,
  SCREENING_LIMITATION_TEXT,
  MRI_BRAIN_STANDARD_NORMAL_NAME,
  MRI_BRAIN_STANDARD_NORMAL_FINDINGS,
  MRI_BRAIN_STANDARD_NORMAL_IMPRESSION,
  MRI_BRAIN_STANDARD_NORMAL_MANIFEST,
  MRI_BRAIN_SCREENING_NORMAL_NAME,
  MRI_BRAIN_SCREENING_NORMAL_FINDINGS,
  MRI_BRAIN_SCREENING_NORMAL_IMPRESSION,
  MRI_BRAIN_SCREENING_NORMAL_MANIFEST,
  MRI_CERVICAL_STANDARD_NORMAL_NAME,
  MRI_CERVICAL_STANDARD_NORMAL_FINDINGS,
  MRI_CERVICAL_STANDARD_NORMAL_IMPRESSION,
  MRI_CERVICAL_STANDARD_NORMAL_MANIFEST,
  MRI_CERVICAL_SCREENING_NORMAL_NAME,
  MRI_CERVICAL_SCREENING_NORMAL_FINDINGS,
  MRI_CERVICAL_SCREENING_NORMAL_IMPRESSION,
  MRI_CERVICAL_SCREENING_NORMAL_MANIFEST,
  MRI_KNEE_STANDARD_NORMAL_NAME,
  MRI_KNEE_STANDARD_NORMAL_FINDINGS,
  MRI_KNEE_STANDARD_NORMAL_IMPRESSION,
  MRI_KNEE_STANDARD_NORMAL_MANIFEST,
  MRI_DORSAL_SCREENING_NORMAL_NAME,
  MRI_DORSAL_SCREENING_NORMAL_FINDINGS,
  MRI_DORSAL_SCREENING_NORMAL_IMPRESSION,
  MRI_DORSAL_SCREENING_NORMAL_MANIFEST,
  MRI_LS_SCREENING_NORMAL_NAME,
  MRI_LS_SCREENING_NORMAL_FINDINGS,
  MRI_LS_SCREENING_NORMAL_IMPRESSION,
  MRI_LS_SCREENING_NORMAL_MANIFEST,
  MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME,
  MRI_WHOLE_SPINE_SCREENING_NORMAL_FINDINGS,
  MRI_WHOLE_SPINE_SCREENING_NORMAL_IMPRESSION,
  MRI_WHOLE_SPINE_SCREENING_NORMAL_MANIFEST,
} from "./baselines";

export const MRI_LS_SPINE_STANDARD_NORMAL_NAME = "MRI LS Spine — Standard Normal";

const LS_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;

const LS_GENERAL_NORMALS: BaselineManifestObservation[] = [
  {
    id: "alignment",
    field: "findings",
    concept: "alignment",
    conflictGroup: "alignment",
    anatomicalSection: "alignment",
    renderedText: "Normal lumbar lordosis is maintained.",
  },
  {
    id: "vertebral-height",
    field: "findings",
    concept: "compression_fracture",
    conflictGroup: "compression_fracture",
    anatomicalSection: "vertebral bodies",
    renderedText: "Lumbar vertebral bodies demonstrate normal height and marrow signal.",
  },
  {
    id: "spondylolisthesis",
    field: "findings",
    concept: "spondylolisthesis",
    conflictGroup: "spondylolisthesis",
    anatomicalSection: "alignment",
    renderedText: "No spondylolisthesis is seen.",
  },
  {
    id: "conus",
    field: "findings",
    concept: "conus",
    conflictGroup: "conus",
    anatomicalSection: "conus",
    renderedText: "Conus medullaris terminates at L1 and appears normal.",
  },
  {
    id: "cauda-equina",
    field: "findings",
    concept: "cauda_equina",
    conflictGroup: "cauda_equina",
    anatomicalSection: "cauda equina",
    renderedText: "Cauda equina nerve roots are normally distributed.",
  },
  {
    id: "facet-joints",
    field: "findings",
    concept: "facet_joint",
    conflictGroup: "facet_joint",
    anatomicalSection: "facet joints",
    renderedText: "Lumbar facet joints are unremarkable.",
  },
  {
    id: "ligamentum-flavum",
    field: "findings",
    concept: "ligamentum_flavum",
    conflictGroup: "ligamentum_flavum",
    anatomicalSection: "ligamentum flavum",
    renderedText: "Ligamentum flavum is not hypertrophied.",
  },
  {
    id: "paraspinal",
    field: "findings",
    concept: "paraspinal",
    conflictGroup: "paraspinal",
    anatomicalSection: "paraspinal soft tissues",
    renderedText: "Paraspinal soft tissues are unremarkable.",
  },
  {
    id: "sacroiliac",
    field: "findings",
    concept: "sacroiliac_joint",
    conflictGroup: "sacroiliac_joint",
    anatomicalSection: "sacroiliac joints",
    renderedText: "Visualized sacroiliac joints are unremarkable.",
  },
];

function levelNormals(level: (typeof LS_LEVELS)[number]): BaselineManifestObservation[] {
  const key = level.toLowerCase();
  return [
    {
      id: `${key}-disc-signal`,
      field: "findings",
      concept: "disc_signal",
      conflictGroup: "disc_signal",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Intervertebral disc signal is preserved.`,
    },
    {
      id: `${key}-disc-height`,
      field: "findings",
      concept: "disc_height",
      conflictGroup: "disc_height",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Intervertebral disc height is maintained.`,
    },
    {
      id: `${key}-disc-contour`,
      field: "findings",
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No significant disc bulge or protrusion is seen.`,
    },
    {
      id: `${key}-canal`,
      field: "findings",
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No spinal canal or thecal sac compression is seen.`,
    },
    {
      id: `${key}-foramina`,
      field: "findings",
      concept: "foraminal_stenosis",
      conflictGroup: "foraminal_stenosis",
      anatomicalSection: level,
      level,
      renderedText: `${level}: Neural foramina are patent bilaterally.`,
    },
    {
      id: `${key}-roots`,
      field: "findings",
      concept: "root_contact",
      conflictGroup: "root_contact",
      anatomicalSection: level,
      level,
      renderedText: `${level}: No exiting or traversing nerve root compression is seen.`,
    },
  ];
}

const LS_LEVEL_NORMALS = LS_LEVELS.flatMap(levelNormals);

export const MRI_LS_SPINE_STANDARD_NORMAL_FINDINGS = [
  ...LS_GENERAL_NORMALS.map((o) => o.renderedText),
  ...LS_LEVEL_NORMALS.map((o) => o.renderedText),
].join("\n");

export const MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION =
  "Normal MRI of the lumbosacral spine. No significant disc, canal, foraminal or neural compressive abnormality.";

export const MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST: BaselineManifest = {
  kind: FULL_REPORT_BASELINE_KIND,
  version: 1,
  revision: "mri-ls-standard-normal-r1",
  observations: [
    ...LS_GENERAL_NORMALS,
    ...LS_LEVEL_NORMALS,
    {
      id: "normal-impression",
      field: "impression",
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      renderedText: MRI_LS_SPINE_STANDARD_NORMAL_IMPRESSION,
    },
  ],
};

/** Stable, deterministic content revision (not a security hash). */
export function reportFormatRevision(
  format: Pick<
    ReportFormat,
    | "name"
    | "modality"
    | "bodyPart"
    | "clinicalHistory"
    | "technique"
    | "findings"
    | "impression"
    | "recommendation"
    | "baselineManifest"
  >,
): string {
  const raw = JSON.stringify([
    format.name,
    format.modality,
    format.bodyPart,
    format.clinicalHistory,
    format.technique,
    format.findings,
    format.impression,
    format.recommendation,
    format.baselineManifest?.revision ?? "",
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

export type BaselineManifestValidation = {
  ok: boolean;
  missing: string[];
  duplicateSlots: string[];
};

/**
 * Domain materialize gate for owned baselines.
 *
 * Shared structural + ownership-slot invariants come from
 * `@workspace/baseline-manifest` (same as API persistence). This function then
 * runs concept-canon-aware `buildCanonicalObservation` slotKeys so materialize
 * fails closed if aliases collapse onto one runtime slot.
 */
export function validateBaselineManifest(
  format: Pick<ReportFormat, "findings" | "impression" | "baselineManifest"> &
    Partial<Pick<ReportFormat, "bodyPart">>,
  region?: string,
): BaselineManifestValidation {
  const manifest = format.baselineManifest;
  if (!manifest) {
    return { ok: false, missing: ["baselineManifest"], duplicateSlots: [] };
  }

  const effectiveRegion = region ?? format.bodyPart ?? "LS Spine";
  const structural = validateBaselineManifestStructure({
    findings: format.findings,
    impression: format.impression,
    defaultRegion: effectiveRegion,
    baselineManifest: manifest,
  });

  if (!structural.ok) {
    if (structural.unsupported || /kind|version|revision|observations must/i.test(structural.reason)) {
      return { ok: false, missing: ["baselineManifest"], duplicateSlots: [] };
    }
    const missing: string[] = [];
    const duplicateSlots: string[] = [];
    for (const detail of structural.details) {
      const m = detail.match(/^observations\[(\d+)\]/);
      const idx = m ? Number(m[1]) : -1;
      const id =
        idx >= 0 && Array.isArray(manifest.observations)
          ? String(manifest.observations[idx]?.id ?? `index:${idx}`)
          : detail;
      if (/duplicate ownership slot/i.test(detail)) duplicateSlots.push(id);
      else if (/renderedText missing/i.test(detail)) missing.push(id);
      else missing.push(id);
    }
    if (!missing.length && !duplicateSlots.length) {
      return { ok: false, missing: ["baselineManifest"], duplicateSlots: [] };
    }
    return { ok: false, missing, duplicateSlots };
  }

  // Canon-aware materialize: catch alias collapse the structural raw-concept key misses.
  const slots = new Set<string>();
  const duplicateSlots: string[] = [];
  for (const entry of manifest.observations) {
    const observation = buildCanonicalObservation({
      region: entry.region?.trim() || effectiveRegion,
      concept: entry.concept,
      conflictGroup: entry.conflictGroup,
      anatomicalSection: entry.anatomicalSection,
      baselineReplaces: entry.renderedText,
      level: entry.level,
      laterality: entry.laterality,
    });
    if (slots.has(observation.slotKey)) duplicateSlots.push(entry.id);
    slots.add(observation.slotKey);
  }
  return { ok: duplicateSlots.length === 0, missing: [], duplicateSlots };
}

const BUILTIN_OWNED_BY_NAME = new Map<string, { bodyPart: string; manifest: BaselineManifest }>([
  [MRI_LS_SPINE_STANDARD_NORMAL_NAME, { bodyPart: "LS Spine", manifest: MRI_LS_SPINE_STANDARD_NORMAL_MANIFEST }],
  ...ownedBaselineCatalog().map((entry) => [
    entry.name,
    { bodyPart: entry.bodyPart, manifest: entry.manifest },
  ] as const),
]);

/** Attach the curated built-in manifest to its server-hydrated copy. */
export function baselineManifestForFormat(
  format: Pick<ReportFormat, "name" | "modality" | "bodyPart" | "findings" | "impression"> &
    Partial<Pick<ReportFormat, "baselineManifest">>,
): BaselineManifest | undefined {
  if (format.baselineManifest) return format.baselineManifest;
  const builtin = BUILTIN_OWNED_BY_NAME.get(format.name);
  if (
    builtin &&
    String(format.modality).toUpperCase() === "MR" &&
    format.bodyPart === builtin.bodyPart
  ) {
    const candidate = { ...format, baselineManifest: builtin.manifest };
    return validateBaselineManifest(candidate, format.bodyPart).ok ? builtin.manifest : undefined;
  }
  return undefined;
}

export function materializeFormatBaseline(
  format: Pick<ReportFormat, "findings" | "impression" | "baselineManifest"> &
    Partial<Pick<ReportFormat, "bodyPart">>,
  region: string,
): LedgerPatch[] {
  const validation = validateBaselineManifest(format, region);
  if (!validation.ok || !format.baselineManifest) return [];
  const now = new Date().toISOString();
  return format.baselineManifest.observations.map((entry) => {
    const systemNormal = entry.field === "impression" && entry.concept === SYSTEM_NORMAL_CONCEPT;
    const screeningLimitation = entry.concept === SCREENING_LIMITATION_CONCEPT;
    const id = systemNormal
      ? SYSTEM_NORMAL_PATCH_ID
      : `baseline:${format.baselineManifest!.revision}:${entry.id}`;
    const source = systemNormal ? "system" as const : "template" as const;
    const contribution =
      entry.field === "findings"
        ? { findings: entry.renderedText }
        : { impression: entry.renderedText };
    const role = screeningLimitation
      ? ("screening" as const)
      : entry.field === "findings"
        ? ("baseline" as const)
        : ("impression" as const);
    const observation = buildCanonicalObservation({
      id,
      region: entry.region?.trim() || region,
      concept: entry.concept,
      conflictGroup: entry.conflictGroup,
      anatomicalSection: entry.anatomicalSection,
      baselineReplaces: entry.renderedText,
      level: entry.level,
      laterality: entry.laterality,
      source,
      role,
      specificity: entry.level ? "study" : "region",
      sectionsOwned: [entry.field],
      findingsText: entry.field === "findings" ? entry.renderedText : undefined,
      impressionText: entry.field === "impression" ? entry.renderedText : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      observation,
      templates: contribution,
      lastRendered: contribution,
      replacedBaseline: { findings: [], impression: [] },
      source,
      protected: screeningLimitation,
    };
  });
}
