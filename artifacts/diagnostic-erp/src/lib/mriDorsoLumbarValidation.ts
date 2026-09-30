/**
 * mriDorsoLumbarValidation.ts — one report order (§25), the Dorso-Lumbar
 * contradiction list (§27), the escalation wording question (§28) and the
 * coverage rules that only a two-region study can break (§23, §29 guards).
 *
 * The Impression priority itself is `mriDorsoLumbarImpression.ts`; this file
 * does not rank Impression lines because the store's single sorter does.
 *
 * Three things this module is careful about:
 *
 *   - The Findings order is DATA (§25). Sections are named once, ranked once, and
 *     a junction finding is assigned to exactly one section, so the same
 *     thoracolumbar pathology cannot appear again under the thoracic canal block
 *     and again under the lumbar block.
 *   - Every rule is a WARNING. Nothing here rewrites, deletes, renumbers or
 *     reorders the radiologist's prose; a contradiction is a question raised.
 *   - The checks that are really ledger rules (duplicate junction identity,
 *     stranded levels after a coverage change) delegate to the functions that
 *     own those rules, so there is one definition of "wrong" rather than two.
 *
 * Pure functions only — no store, no React.
 */

import { splitToSentences } from "./reportFieldMerge";
import {
  SPINE_STATEMENT_RULES,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import { SCREENING_LIMITATION_TEXT } from "./zai-workspace/baselines/screeningLimitation";
import {
  canonicalDorsoLumbarLevel,
  dorsolumbarCaudaCovered,
  dorsolumbarConusCovered,
  dorsolumbarFullLevelSequence,
  dorsolumbarJunctionCovered,
  dorsolumbarLevelDomain,
  dorsolumbarNumberingCaution,
  dorsolumbarNeedsConsistencyCheck,
  dorsolumbarStrandedLevels,
  type DorsoLumbarState,
} from "./mriDorsoLumbarCoverage";
import { dorsolumbarJunctionWarnings } from "./mriDorsoLumbarJunction";
import {
  dorsolumbarRolesAreOneComposition,
  isDorsoLumbarDedicated,
  type StudyComposition,
} from "./mriDorsoLumbarCatalog";
import type { RegionRole, SpineScreeningRegion } from "./mriSpineScreeningSchema";

/** Spec §25, in the recommended report order. */
export const DORSOLUMBAR_FINDINGS_SECTIONS = [
  "techniqueCoverage",
  "numbering",
  "alignment",
  "vertebralBodies",
  "discs",
  "levelByLevel",
  "thoracicCanalCord",
  "junctionConus",
  "lumbarCanalCauda",
  "foramina",
  "posteriorElements",
  "epiduralIntradural",
  "paravertebral",
  "accompanyingScreening",
] as const;

export type DorsoLumbarFindingsSection = (typeof DORSOLUMBAR_FINDINGS_SECTIONS)[number];

export const DORSOLUMBAR_FINDING_SECTION_LABELS: Record<DorsoLumbarFindingsSection, string> = {
  techniqueCoverage: "Technique / coverage",
  numbering: "Vertebral numbering",
  alignment: "Alignment",
  vertebralBodies: "Vertebral bodies / marrow",
  discs: "Intervertebral discs",
  levelByLevel: "Level-by-level findings",
  thoracicCanalCord: "Thoracic central canal / cord",
  junctionConus: "Thoracolumbar junction / conus",
  lumbarCanalCauda: "Lumbar canal / lateral recesses / cauda equina",
  foramina: "Neural foramina",
  posteriorElements: "Posterior elements / ligaments",
  epiduralIntradural: "Epidural / intradural findings",
  paravertebral: "Paravertebral / psoas soft tissues",
  accompanyingScreening: "Accompanying screening findings",
};

/** The shape a Dorso-Lumbar rule needs from a ledger row — patch or observation. */
export type DorsoLumbarFindingRow = {
  observation?: {
    concept?: string | null;
    level?: string | null;
    anatomicalSection?: string | null;
    region?: string | null;
    role?: string | null;
  } | null;
  ownership?: { concept?: string | null; anatomicalSection?: string | null } | null;
};

const CONCEPT_SECTION: Record<string, DorsoLumbarFindingsSection> = {
  screening_limitation: "techniqueCoverage",
  screening_recommendation: "accompanyingScreening",
  alignment: "alignment",
  kyphosis: "alignment",
  gibbus_deformity: "alignment",
  scoliosis: "alignment",
  spondylolisthesis: "alignment",
  listhesis_dynamic: "alignment",
  bone_lesion: "vertebralBodies",
  marrow_edema: "vertebralBodies",
  compression_fracture: "vertebralBodies",
  vertebral_collapse: "vertebralBodies",
  retropulsion: "vertebralBodies",
  endplate: "vertebralBodies",
  endplate_erosion: "vertebralBodies",
  schmorl_node: "vertebralBodies",
  disc_contour: "discs",
  disc_signal: "discs",
  disc_height: "discs",
  disc_migration: "discs",
  annular_fissure: "discs",
  disc_uncapping: "discs",
  spondylodiscitis: "discs",
  canal_stenosis: "thoracicCanalCord",
  canal_morphology: "thoracicCanalCord",
  cord_caliber: "thoracicCanalCord",
  cord_compression: "thoracicCanalCord",
  cord_signal: "thoracicCanalCord",
  syrinx: "thoracicCanalCord",
  conus_medullaris: "junctionConus",
  thoracolumbar_junction: "junctionConus",
  cauda_equina: "lumbarCanalCauda",
  lateral_recess_stenosis: "lumbarCanalCauda",
  filum_terminale: "lumbarCanalCauda",
  arachnoiditis: "lumbarCanalCauda",
  foraminal_stenosis: "foramina",
  root_traversing: "foramina",
  root_exiting: "foramina",
  root_contact: "foramina",
  facet_joint: "posteriorElements",
  posterior_elements: "posteriorElements",
  pars_defect: "posteriorElements",
  ligamentum_flavum: "posteriorElements",
  olf: "posteriorElements",
  opl_ossification: "posteriorElements",
  dish: "posteriorElements",
  ankylosing_pattern: "posteriorElements",
  posterior_ligamentous_complex: "posteriorElements",
  costovertebral_joint: "posteriorElements",
  epidural_space: "epiduralIntradural",
  epidural_collection: "epiduralIntradural",
  epidural_lipomatosis: "epiduralIntradural",
  intradural_lesion: "epiduralIntradural",
  intramedullary_lesion: "epiduralIntradural",
  spinal_flow_voids: "epiduralIntradural",
  tethered_cord: "epiduralIntradural",
  paravertebral_collection: "paravertebral",
  muscle_atrophy: "paravertebral",
  sacroiliac_joints: "paravertebral",
  hardware_postop: "posteriorElements",
  adjacent_segment_degeneration: "discs",
  osteophytes: "vertebralBodies",
  transitional_vertebra: "vertebralBodies",
  bertolotti_syndrome: "vertebralBodies",
  synovial_cyst: "posteriorElements",
};

/**
 * Which §25 section a ledger row belongs to.
 *
 * A thoracic canal or cord statement at the bridge belongs to the junction
 * section, not the thoracic one: that is where the conus lives, and it keeps the
 * junction out of two paragraphs (§25 "avoid repeating the same junctional
 * pathology under multiple sections").
 */
export function dorsoLumbarFindingsSectionOf(row: DorsoLumbarFindingRow): DorsoLumbarFindingsSection {
  const concept = String(row.observation?.concept ?? row.ownership?.concept ?? "");
  if (row.observation?.role === "screening") return "accompanyingScreening";
  const base = CONCEPT_SECTION[concept];
  const level = rowLevel(row);
  const domain = level ? dorsolumbarLevelDomain(level) : null;
  if (base === "thoracicCanalCord" && domain === "junction") return "junctionConus";
  if (base === "discs" && domain === "junction") return "junctionConus";
  return base ?? (level ? "levelByLevel" : "techniqueCoverage");
}

function rowLevel(row: DorsoLumbarFindingRow): string {
  const raw = (row.observation?.level ?? row.observation?.anatomicalSection ?? row.ownership?.anatomicalSection ?? "").trim();
  return canonicalDorsoLumbarLevel(raw)?.key ?? "";
}

/**
 * Craniocaudal position of a level, taken from the resolver's own sequence so a
 * transitional vertebra cannot reorder the report and the bridge always sits
 * between the thoracic and lumbar blocks. A level the sequence does not know
 * sorts last; a study-wide row (no level) sorts first inside its section.
 */
export function dorsoLumbarLevelRank(
  level: string,
  state: DorsoLumbarState | null | undefined,
): number {
  const sequence = dorsolumbarFullLevelSequence(state?.lumbar ?? null);
  if (!level) return -1;
  const canonical = canonicalDorsoLumbarLevel(level);
  if (!canonical) return sequence.length;
  const at = sequence.findIndex((entry) => entry.key === canonical.key);
  return at < 0 ? sequence.length : at;
}

/**
 * The report's sections in §25 order, each with its rows in craniocaudal order.
 * The Findings composer keeps ledger insertion order for its prose; this is the
 * same ordering expressed as data, so a section preview, a reveal rule or a test
 * can check the report shape without inventing a second text assembly.
 */
export function dorsoLumbarFindingsOrder(
  rows: readonly DorsoLumbarFindingRow[],
  state: DorsoLumbarState | null | undefined = null,
): Array<{
  section: DorsoLumbarFindingsSection;
  label: string;
  rank: number;
  rows: DorsoLumbarFindingRow[];
}> {
  const grouped = new Map<DorsoLumbarFindingsSection, DorsoLumbarFindingRow[]>();
  for (const row of rows) {
    const section = dorsoLumbarFindingsSectionOf(row);
    const list = grouped.get(section) ?? [];
    list.push(row);
    grouped.set(section, list);
  }
  return [...grouped.entries()]
    .map(([section, list]) => ({
      section,
      label: DORSOLUMBAR_FINDING_SECTION_LABELS[section],
      rank: DORSOLUMBAR_FINDINGS_SECTIONS.indexOf(section),
      // Sort() is stable, so rows at the same level keep the order the
      // radiologist applied them in.
      rows: [...list].sort((a, b) => dorsoLumbarLevelRank(rowLevel(a), state) - dorsoLumbarLevelRank(rowLevel(b), state)),
    }))
    .sort((a, b) => a.rank - b.rank);
}

// A junction concept maps to exactly one section by construction, so "the same
// junction pathology written twice" is not a report-shape problem but a ledger
// problem — `dorsolumbarJunctionWarnings` owns that rule, and this module only
// delegates to it. There is deliberately no second duplicate-junction check.

// ─── Contradictions (spec §27) ───────────────────────────────────────────

type Pair = {
  id: string;
  label: string;
  normal: RegExp;
  abnormal: RegExp;
};

function trim(sentence: string): string {
  const s = sentence.trim();
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
}

/**
 * Normal-versus-abnormal pairs for a study that spans both halves of the spine.
 * The cord/conus/cauda pairs are separated by structure rather than by level,
 * because the same level can legitimately carry either the cord or the cauda
 * depending on where the conus ended.
 */
export const DORSOLUMBAR_CONTRADICTION_PAIRS: Pair[] = [
  { id: "alignment", label: "alignment", normal: /alignment .*(?:maintained|normal)|no scoliotic/i, abnormal: /scoliosis|scoliotic|kyphotic|gibbus|listhesis/i },
  { id: "fracture", label: "fracture", normal: /no (?:acute )?(?:compression |wedge )?fracture|no fracture/i, abnormal: /\b(?:compression|wedge|burst) fracture\b|fracture line|retropulsion/i },
  { id: "marrow", label: "marrow", normal: /marrow signal .*(?:normal|maintained|preserved)/i, abnormal: /marrow[- ]replacing|focal marrow lesion|pathologic(?:al)? fracture|metastat/i },
  { id: "cord", label: "spinal cord", normal: /cord .*(?:normal caliber and signal|unremarkable|normal)/i, abnormal: /cord (?:compression|flattening|signal|edema)|intrinsic (?:t2|stir) (?:cord )?(?:hyper|signal)/i },
  { id: "conus", label: "conus medullaris", normal: /conus .*(?:normal|unremarkable)/i, abnormal: /conus (?:compression|low[- ]lying|signal|expansion)|intrinsic conus/i },
  { id: "cauda", label: "cauda equina", normal: /cauda .*(?:normal|unremarkable|preserved)/i, abnormal: /cauda[- ]equina (?:crowding|compression)|clumped nerve roots/i },
  { id: "canal", label: "central canal", normal: /no (?:significant )?(?:canal|spinal) (?:narrowing|stenosis|compromise)|canal .*(?:normal|patent)/i, abnormal: /canal (?:narrowing|stenosis|compromise)/i },
  { id: "foramina", label: "neural foramina", normal: /foramina .*(?:normal|patent|preserved)|no foraminal/i, abnormal: /foraminal (?:narrowing|stenosis)/i },
  { id: "epidural", label: "epidural space", normal: /no epidural (?:collection|mass|lesion|hematoma)/i, abnormal: /epidural (?:collection|hematoma|abscess|mass|extension)/i },
  { id: "posterior", label: "posterior elements", normal: /posterior elements .*(?:normal|intact|unremarkable)/i, abnormal: /posterior[- ]element (?:fracture|lesion)|pars (?:defect|lysis)|spondylolysis/i },
  { id: "disc", label: "intervertebral discs", normal: /disc (?:height|signal) .*(?:maintained|preserved|normal)|no disc (?:herniation|protrusion)/i, abnormal: /disc (?:protrusion|extrusion|bulge|migration|desiccation)|herniated disc/i },
];

export type DorsoLumbarContradictionInput = {
  findingsText: string;
  impressionText: string;
  state: DorsoLumbarState | null | undefined;
  sequences?: SpineSequencesAvailable | null;
  composition?: StudyComposition | null;
  roles?: Record<SpineScreeningRegion, RegionRole> | null;
  /** Ledger rows, for the rules that are really ownership rules. */
  patches?: readonly DorsoLumbarFindingRow[] | null;
};

/**
 * Lumbar root vocabulary that has no meaning in a thoracic disc sentence: the
 * thoracic spine has no lateral recess and no traversing/exiting-root model, and
 * the pars workflow is lumbar-only (spec §14, §15).
 */
const LUMBAR_ROOT_LOGIC_RE = /\b(?:lateral recess|traversing root|exiting root|pars interarticularis|isthmic)\b/i;
const THORACIC_LEVEL_RE = /\b(?:[TD])(?:[1-9]|1[0-2])\s*[-/]\s*(?:[TD])(?:[1-9]|1[0-2])\b/i;
const JUNCTION_SPELLINGS = ["T12-L1", "D12-L1", "L1-T12", "L1-D12", "T12/L1", "L1/T12"];

/**
 * Dorso-Lumbar contradictions and coverage checks. Order-stable, warning-only.
 *
 * The two ledger rules (duplicate junction identity, stranded levels) are
 * delegated so a coverage change surfaces what it stranded instead of silently
 * renumbering it, and a junction written under two regions is reported rather
 * than merged by the software.
 */
export function dorsoLumbarTextContradictions(
  input: DorsoLumbarContradictionInput,
): string[] {
  const warnings: string[] = [];
  const blob = `${input.findingsText ?? ""}\n${input.impressionText ?? ""}`.trim();
  const sentences = blob ? splitToSentences(blob) : [];
  const state = input.state;

  if (blob) {
    for (const pair of DORSOLUMBAR_CONTRADICTION_PAIRS) {
      const normalHit = sentences.find((s) => pair.normal.test(s));
      const abnormalHit = sentences.find((s) => pair.abnormal.test(s));
      if (!normalHit || !abnormalHit) continue;
      warnings.push(
        `Contradiction in ${pair.label}: the report states both “${trim(normalHit)}” and “${trim(abnormalHit)}”. Confirm which is intended.`,
      );
    }

    if (input.sequences) {
      for (const rule of SPINE_STATEMENT_RULES) {
        const missing = rule.keys.filter((k) => !input.sequences![k]);
        if (missing.length === 0) continue;
        const hit = sentences.find((s) => rule.re.test(s));
        if (!hit) continue;
        warnings.push(
          `Sequence check: the report contains ${rule.label} — “${trim(hit)}” — but this study does not include ${missing.join(" + ")}.`,
        );
      }
    }

    // §27: a conus or cauda claim the acquired coverage cannot support.
    if (state && !dorsolumbarConusCovered(state)) {
      const hit = sentences.find((s) => /\bconus\b/i.test(s) && !/not (?:assessed|included|visualized)|cannot be assessed/i.test(s));
      if (hit) {
        warnings.push(`Coverage check: the report describes the conus medullaris — “${trim(hit)}” — but recorded coverage does not reach the thoracolumbar junction.`);
      }
    }
    if (state && !dorsolumbarCaudaCovered(state)) {
      const hit = sentences.find((s) => /cauda[- ]equina|nerve roots of the cauda/i.test(s) && !/not (?:assessed|included)|cannot be assessed/i.test(s));
      if (hit) {
        warnings.push(`Coverage check: the report describes the cauda equina — “${trim(hit)}” — but no lumbar segment was covered on this examination.`);
      }
    }
    // The bridge is a coverage question of its own: a Dorso-Lumbar study that
    // stops at T10 cannot describe junctional anatomy as if it saw it.
    if (state && !dorsolumbarJunctionCovered(state)) {
      const hit = sentences.find((s) => /\b(?:thoracolumbar|junctional)\b/i.test(s) && !/not (?:assessed|included|visualized)|cannot be assessed/i.test(s));
      if (hit) {
        warnings.push(`Coverage check: the report comments on the thoracolumbar junction — “${trim(hit)}” — but the acquired coverage does not include the T12-L1 level.`);
      }
    }

    // §27: lumbar root logic applied to a thoracic level.
    const misplaced = sentences.find((s) => LUMBAR_ROOT_LOGIC_RE.test(s) && THORACIC_LEVEL_RE.test(s) && !/\bL\d/.test(s));
    if (misplaced) {
      warnings.push(`Anatomy check: a lumbar root / recess / pars statement is written at a thoracic level — “${trim(misplaced)}”. The thoracic spine has no lateral recess and no lumbar root model; record it at the lumbar level it belongs to.`);
    }

    // §27: the same bridge named two different ways in prose.
    const upper = blob.toUpperCase();
    const spellings = JUNCTION_SPELLINGS.filter((s) => upper.includes(s));
    const distinct = new Set(spellings.map((s) => canonicalDorsoLumbarLevel(s)?.key ?? s));
    if (spellings.length > 1 && distinct.size === 1 && new Set(spellings).size > 1) {
      warnings.push(`Junction naming: the thoracolumbar bridge is written as ${[...new Set(spellings)].join(" and ")} in the same report. Use one spelling for the one junction observation.`);
    }

    // §27: screening limitation must appear exactly once.
    const limitationCount = (blob.match(new RegExp(SCREENING_LIMITATION_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    if (limitationCount > 1) {
      warnings.push(`Screening limitation: the limitation statement appears ${limitationCount} times. It is a report-level statement and belongs once.`);
    }

    // §23: a dedicated composition must not be worded as two screening modules.
    if (isDorsoLumbarDedicated(input.composition) && input.roles) {
      const asTwoScreenings = (input.roles.dorsal === "primary-screening" && input.roles.ls === "primary-screening")
        || !dorsolumbarRolesAreOneComposition(input.roles);
      if (asTwoScreenings) {
        warnings.push("Composition check: this study is booked as a dedicated Dorso-Lumbar examination but its dorsal and lumbar regions are recorded as independent screening modules. Set the roles to match the performed study.");
      }
    }

    // §5: numbering confidence must be stated when it is reduced.
    if (state && dorsolumbarNeedsConsistencyCheck(state) && !/numbering|level assignment|transitional/i.test(blob)) {
      warnings.push(`Numbering caution: ${dorsolumbarNumberingCaution(state).split(". ")[0]}. The report does not state the numbering / coverage basis.`);
    }
  }

  // Ownership rules, delegated to the functions that define them.
  if (input.patches) {
    const rows = [...input.patches];
    warnings.push(...dorsolumbarJunctionWarnings(rows, input.composition ?? null));
    if (state) warnings.push(...dorsolumbarStrandedLevels(rows, state));
  }

  return warnings;
}

