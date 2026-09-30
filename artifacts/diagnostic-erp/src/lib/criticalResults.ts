/**
 * criticalResults.ts — critical-finding detection (MRI PR 3, "Critical Results").
 *
 * The workspace already has a MANUAL "Mark Critical Finding" toggle + the F5
 * communication checklist, and the DB already models critical findings
 * (radiology_critical_findings + /api/radiology/critical-findings). What was
 * missing is the safety net that READS the drafted report and notices that it
 * *describes* a critical finding — so the radiologist is reminded to flag and
 * communicate it before signing.
 *
 * This is pure detection only: it never marks, never communicates, never edits.
 * The curated term table covers the cross-modality emergencies; the per-study
 * `watchList` (reused verbatim from radiologyMasterTemplates `criticalWatchList`)
 * adds study-specific red-flags without duplicating those lists here.
 *
 * Pure and alias-free so it runs under the root vitest config, same as
 * commandPalette.ts / copilotOrchestrator.ts.
 */

export interface CriticalHit {
  /** The lower-case phrase that matched (for de-dupe / debugging). */
  term: string;
  /** Human-facing label for the confirm dialog / Copilot item. */
  label: string;
}

/**
 * Curated critical / actionable-emergency phrases. Each is deliberately
 * SPECIFIC (e.g. "acute infarct", not bare "infarct"; "tonsillar herniation",
 * not bare "herniation") so a normal report doesn't false-positive. Both the
 * British and American spellings are listed where they differ.
 */
export const CRITICAL_TERMS: { term: string; label: string }[] = [
  // Neuro / brain
  { term: "acute infarct", label: "acute infarct" },
  { term: "acute stroke", label: "acute stroke" },
  { term: "acute haemorrhage", label: "acute haemorrhage" },
  { term: "acute hemorrhage", label: "acute haemorrhage" },
  { term: "intracranial haemorrhage", label: "intracranial haemorrhage" },
  { term: "intracranial hemorrhage", label: "intracranial haemorrhage" },
  { term: "subarachnoid haemorrhage", label: "subarachnoid haemorrhage" },
  { term: "subarachnoid hemorrhage", label: "subarachnoid haemorrhage" },
  { term: "subdural haematoma", label: "subdural haematoma" },
  { term: "subdural hematoma", label: "subdural haematoma" },
  { term: "extradural haematoma", label: "extradural haematoma" },
  { term: "epidural haematoma", label: "extradural haematoma" },
  { term: "midline shift", label: "midline shift" },
  { term: "intracerebral haemorrhage", label: "intracerebral haemorrhage" },
  { term: "intracerebral hemorrhage", label: "intracerebral haemorrhage" },
  { term: "saccular cerebral aneurysm", label: "cerebral aneurysm" },
  { term: "cerebral aneurysm", label: "cerebral aneurysm" },
  { term: "mass effect", label: "mass effect" },
  { term: "tonsillar herniation", label: "tonsillar herniation" },
  { term: "uncal herniation", label: "uncal herniation" },
  { term: "transtentorial herniation", label: "transtentorial herniation" },
  { term: "obstructive hydrocephalus", label: "obstructive hydrocephalus" },
  { term: "acute hydrocephalus", label: "acute hydrocephalus" },
  { term: "ruptured aneurysm", label: "ruptured aneurysm" },
  { term: "aneurysm rupture", label: "ruptured aneurysm" },
  { term: "brain abscess", label: "brain abscess" },
  // Spine / cord
  { term: "cord compression", label: "cord compression" },
  { term: "cauda equina", label: "cauda equina syndrome" },
  { term: "myelomalacia", label: "myelomalacia" },
  { term: "cord oedema", label: "cord oedema" },
  { term: "cord edema", label: "cord oedema" },
  { term: "cord signal change", label: "cord signal change" },
  { term: "unstable fracture", label: "unstable fracture" },
  { term: "burst fracture", label: "burst fracture" },
  { term: "epidural abscess", label: "epidural abscess" },
  // Cervical radiography. These are the critical patterns the seeded
  // xr.cervical_spine knowledge pack names — unstable fracture, instability /
  // listhesis, prevertebral swelling as a marker of occult injury — written in
  // the exact prose the cervical sub-master produces. There is no X-ray master
  // template, so radiographic critical detection runs on this table
  // (radiologyMasterTemplates supplies criticalWatchList for MR/CT/US only).
  { term: "fracture-dislocation", label: "cervical fracture-dislocation" },
  { term: "facet dislocation", label: "cervical facet dislocation" },
  { term: "perched facet", label: "perched cervical facet" },
  { term: "odontoid fracture", label: "odontoid fracture" },
  { term: "unstable craniocervical", label: "unstable craniocervical injury" },
  { term: "widened atlanto-dental interval", label: "widened atlanto-dental interval" },
  { term: "atlanto-axial instability", label: "atlanto-axial instability" },
  // The seeded xr.cervical_spine knowledge pack names "Cervical spine
  // instability / listhesis" as a critical finding, so a listhesis described on
  // plain films raises the reminder. The baseline denial ("no acute fracture or
  // listhesis is identified") stays excluded by the negation check.
  { term: "anterolisthesis", label: "cervical anterolisthesis" },
  { term: "retrolisthesis", label: "cervical retrolisthesis" },
  { term: "dynamic instability", label: "dynamic cervical instability" },
  { term: "prevertebral soft-tissue swelling", label: "prevertebral soft-tissue swelling" },
  { term: "prevertebral soft tissue swelling", label: "prevertebral soft-tissue swelling" },
  { term: "prevertebral swelling", label: "prevertebral soft-tissue swelling" },
  { term: "prevertebral gas", label: "prevertebral gas" },
  { term: "burst-type fracture", label: "burst-type fracture" },
  { term: "hardware breakage", label: "hardware breakage" },
  { term: "hardware migration", label: "hardware migration" },
  { term: "concerning for loosening", label: "implant loosening" },
  // Chest / vascular
  { term: "tension pneumothorax", label: "tension pneumothorax" },
  { term: "pneumothorax", label: "pneumothorax" },
  { term: "tension physiology", label: "tension physiology" },
  { term: "large pleural effusion", label: "large pleural effusion" },
  // Plain-film prose puts the side between "large" and "pleural effusion"
  // ("Large left pleural effusion…"), so the phrase above cannot match it.
  // Mass effect is the emergency, and it is named explicitly here.
  { term: "contralateral mediastinal shift", label: "contralateral mediastinal shift" },
  { term: "haemothorax", label: "haemothorax" },
  { term: "hemothorax", label: "haemothorax" },
  { term: "marked pulmonary oedema", label: "marked pulmonary oedema" },
  { term: "marked pulmonary edema", label: "marked pulmonary oedema" },
  { term: "severe pulmonary oedema", label: "severe pulmonary oedema" },
  { term: "severe pulmonary edema", label: "severe pulmonary oedema" },
  { term: "pulmonary embolism", label: "pulmonary embolism" },
  { term: "pulmonary embolus", label: "pulmonary embolism" },
  { term: "aortic dissection", label: "aortic dissection" },
  // Abdomen / pelvis / obstetric
  { term: "pneumoperitoneum", label: "pneumoperitoneum" },
  { term: "free air", label: "free intraperitoneal air" },
  // Plain chest films describe this as "subdiaphragmatic free gas", which the
  // terms above did not match — the chest sub-master's own wording must fire.
  { term: "subdiaphragmatic free gas", label: "subdiaphragmatic free gas" },
  { term: "free gas under the diaphragm", label: "subdiaphragmatic free gas" },
  { term: "malpositioned", label: "device malposition" },
  { term: "malposition", label: "device malposition" },
  { term: "bowel perforation", label: "bowel perforation" },
  { term: "ectopic pregnancy", label: "ectopic pregnancy" },
  { term: "testicular torsion", label: "testicular torsion" },
  { term: "ovarian torsion", label: "ovarian torsion" },
  { term: "placental abruption", label: "placental abruption" },
];

/** Negation cues that, when they precede a term, mean it is being EXCLUDED
 *  ("no acute infarct", "no evidence of haemorrhage") — so that occurrence is
 *  not a critical hit. Deliberately conservative (prefix cues only): a critical
 *  reminder is safer shown than suppressed, so we only strip the clearest
 *  "absence" statements. */
const NEGATORS = [
  "no ", "no evidence", "no acute", "without", "negative for",
  "free of", "absence of", "ruled out", "r/o ",
];

function isNegated(haystack: string, idx: number): boolean {
  let window = haystack.slice(Math.max(0, idx - 30), idx);
  // A negation only applies within its own sentence/clause — don't let a "no"
  // from a PREVIOUS sentence ("No acute infarct. There is cord compression…")
  // bleed forward and suppress a genuinely-present finding.
  const boundary = Math.max(window.lastIndexOf("."), window.lastIndexOf(";"), window.lastIndexOf("\n"));
  if (boundary >= 0) window = window.slice(boundary + 1);
  return NEGATORS.some((n) => window.includes(n));
}

/** Does `haystack` contain `term` in at least one NON-negated position? */
function containsUnnegated(haystack: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(term, from);
    if (idx < 0) return false;
    if (!isNegated(haystack, idx)) return true;
    from = idx + term.length;
  }
}

/**
 * Detect critical findings described in the report text. Scans Findings +
 * Impression against the curated table and the (optional) per-study watch list.
 * Case-insensitive; de-duplicated by label; skips clearly-negated occurrences.
 * Pure — returns a fresh array and mutates nothing.
 */
export function detectCriticalFindings(
  findings: string,
  impression: string[],
  watchList?: string[],
): CriticalHit[] {
  const haystack = `${findings || ""}\n${(impression || []).join("\n")}`.toLowerCase();
  if (!haystack.trim()) return [];

  const candidates: { term: string; label: string }[] = [...CRITICAL_TERMS];
  for (const w of watchList ?? []) {
    const term = (w || "").trim().toLowerCase();
    if (term.length >= 3) candidates.push({ term, label: (w || "").trim() });
  }

  const hits: CriticalHit[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.label.toLowerCase())) continue;
    if (containsUnnegated(haystack, c.term)) {
      hits.push({ term: c.term, label: c.label });
      seen.add(c.label.toLowerCase());
    }
  }
  return hits;
}
