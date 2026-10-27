/**
 * Region section vocabulary — the closed set of anatomicalSection keys the
 * composer may emit, per region family.
 *
 * WHY: the LLM path used to receive no section vocabulary at all. The JSON
 * schema example showed "disc" and the model free-formed everything else, and
 * migrations/z_fix_radiology_smart_findings_sections.sql documents the exact
 * production failure that follows: invented names ("Spinal Canal",
 * "Intervertebral Discs", "Sellar Region") that match no report template
 * section and materialize as literally-named fake sections. The fix has two
 * halves, both wired in composer.ts:
 *
 *   1. the prompt now LISTS the region's canonical keys (teach), and
 *   2. every parsed plan is NORMALIZED against them (verify) — a near-miss
 *      spelling canonicalizes onto the real key, and anything the model
 *      invents collapses to "" (the report's "Additional Observations"
 *      catch-all), never a fake section.
 *
 * DERIVATION: the vocabularies below are not invented here. They are the union
 * of the two shipped section vocabularies — the server phrase catalog's
 * anatomicalSection keys (phraseCatalog.ts, per family) and the workspace
 * baselines' section labels (zai-workspace/baselines/*.ts) — so a curated
 * phrase can never be stripped by normalization: its own key is in the set.
 * "sellar region" is deliberately ABSENT: the migration above ruled it a
 * non-template section routed to the catch-all.
 *
 * Family scoping is brain-vs-spine (not per-segment): whole-spine studies
 * legitimately mix cervical/dorsal/lumbar anatomy, so the spine vocabulary is
 * the union across segments; cross-family leakage (a disc section in a brain
 * plan, orbit in a spine plan) is exactly what normalization must catch.
 */

import { regionFamilies } from "./regions";
import type { VoiceChangePlan } from "./schema";

/** Brain anatomy keys — catalog brain phrases + brain baseline labels. */
export const BRAIN_SECTION_KEYS = [
  "brain",
  "brain parenchyma",
  "parenchyma",
  "white matter",
  "diffusion",
  "ventricles",
  "extra-axial",
  "extra-axial spaces",
  "midline",
  "basal ganglia",
  "mca",
  "intracranial vessels",
  "vascular",
  "brainstem",
  "cerebellum",
  "posterior fossa",
  "cisterns",
  "susceptibility",
  "orbit",
  "temporal",
  "lesion",
] as const;

/** Spine anatomy keys — catalog spine phrases (all segments) + spine baseline labels. */
export const SPINE_SECTION_KEYS = [
  "alignment",
  "vertebra",
  "vertebral bodies",
  "disc",
  "discs",
  "endplate",
  "canal",
  "spinal canal",
  "thecal",
  "cord",
  "spinal cord",
  "nerve_root",
  "foramina",
  "neural foramina",
  "facet",
  "facet joints",
  "ligamentum",
  "ligamentum flavum",
  "ligament",
  "epidural",
  "posterior elements",
  "paraspinal soft tissues",
  "sacroiliac",
  "c1c2",
  "uncovertebral",
  "conus",
] as const;

/**
 * The closed section vocabulary for a region, or null when the region is not
 * one we know (Knee, USG abdomen, …). Null means NO opinion: callers must
 * pass such plans through untouched — stripping sections with a vocabulary we
 * do not have would be inventing, the same sin this module exists to prevent.
 */
export function regionSectionKeys(region?: string | null): readonly string[] | null {
  const fam = regionFamilies(region);
  if (fam.brain) return BRAIN_SECTION_KEYS;
  if (fam.lumbar || fam.cervical || fam.dorsal) return SPINE_SECTION_KEYS;
  return null;
}

/** Lowercase, strip punctuation/separators to single spaces, collapse. */
function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a raw section string onto a canonical key: exact/normalized-equality
 * matches return the CANONICAL spelling ("Spinal Canal" → "spinal canal",
 * "Nerve-Root" → "nerve_root"); everything else — invented sections,
 * near-misses, cross-family keys — returns "" (the report's catch-all).
 * Deliberately NO fuzzy matching: "spinal canal measurements" is not
 * "spinal canal", and guessing anatomy is how fake sections were born.
 */
export function canonicalSectionKey(
  raw: string | null | undefined,
  allowed: readonly string[],
): string {
  if (!raw) return "";
  const n = normalizeKey(raw);
  if (!n) return "";
  for (const key of allowed) {
    if (normalizeKey(key) === n) return key;
  }
  return "";
}

/**
 * Normalize every observation's anatomicalSection in a parsed plan.
 *
 * - unknown region → the plan is returned UNTOUCHED (same reference);
 * - absent field stays absent, "" stays "";
 * - custom phrase sections (extraKeys) join the allowed vocabulary, so what
 *   the radiologist taught the system stays dictatable;
 * - findingsText / impressionText / every other plan field is never touched —
 *   normalization only constrains the section GROUPING key, never the words.
 */
export function normalizePlanSections(
  plan: VoiceChangePlan,
  region?: string | null,
  extraKeys?: readonly (string | null | undefined)[],
): VoiceChangePlan {
  const base = regionSectionKeys(region);
  if (!base) return plan;
  const allowed: string[] = [...base];
  for (const extra of extraKeys ?? []) {
    const t = (extra ?? "").trim();
    if (t && !allowed.includes(t)) allowed.push(t);
  }
  let changed = false;
  const observations = plan.observations.map((o) => {
    if (o.anatomicalSection === undefined) return o;
    const canon = canonicalSectionKey(o.anatomicalSection, allowed);
    if (canon === o.anatomicalSection) return o;
    changed = true;
    return { ...o, anatomicalSection: canon };
  });
  return changed ? { ...plan, observations } : plan;
}

/** The region's keys as a compact comma line for the prompt, or null. */
export function sectionKeysForPrompt(region?: string | null): string | null {
  const keys = regionSectionKeys(region);
  return keys ? keys.join(", ") : null;
}
