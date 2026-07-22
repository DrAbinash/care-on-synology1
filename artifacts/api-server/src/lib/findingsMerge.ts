/**
 * findingsMerge.ts — combine several selected radiology findings into ONE
 * coherent house-style report (the "merge more than one finding into one"
 * feature of the Report Builder).
 *
 * Pure & deterministic: no DB, no network, no LLM. Given a set of findings the
 * radiologist picked from the searchable catalogue, it groups them by anatomical
 * section, renders a Findings block in house order, and builds a numbered
 * Impression from the abnormal ones. Safe to run anywhere and easy to unit-test.
 *
 * It never invents or drops clinical content — it only orders, de-duplicates and
 * formats exactly the sentences it is given.
 */

export interface MergeFinding {
  text: string;
  section?: string;
  /** true = abnormal/positive finding (surfaces in the Impression) */
  abnormal?: boolean;
  /** true = the sentence is itself an impression line */
  impression?: boolean;
  modality?: string;
  region?: string;
}

export interface MergeInput {
  findings: MergeFinding[];
  title?: string;
  technique?: string;
  /** impression used when nothing abnormal was selected */
  normalImpression?: string;
  /** preferred section ordering; unlisted sections keep first-seen order after these */
  sectionOrder?: string[];
}

export interface MergedSection {
  section: string;
  lines: string[];
}

export interface MergedReport {
  title: string;
  technique: string;
  sections: MergedSection[];
  findingsText: string;
  impressionText: string;
  /** the whole report assembled as plain text, ready to drop into the editor */
  plainText: string;
  counts: { findings: number; abnormal: number; sections: number };
}

// House anatomical order — sections not listed sort after these, in first-seen order.
const DEFAULT_SECTION_ORDER = [
  "Brain Parenchyma", "Ventricles", "Posterior Fossa", "Sella",
  "Liver", "Gall Bladder", "CBD", "Portal Vein", "Pancreas", "Spleen",
  "Kidneys", "Ureters", "Urinary Bladder", "Prostate", "Uterus", "Ovaries / Adnexa",
  "Aorta", "Bowel", "Lymph Nodes", "Peritoneum",
  "Lungs / Pleura", "Mediastinum", "Heart",
  "Thyroid", "Breast", "Testes",
  "Vertebrae", "Discs", "Spinal Cord", "Menisci", "Cruciate Ligaments",
  "Collateral Ligaments", "Bones", "Paranasal Sinuses", "Mastoids",
  "General", "Other",
];

const clip = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Normalise a sentence for de-duplication (case/punctuation-insensitive). */
const dedupeKey = (s: string): string => clip(s).toLowerCase().replace(/[.;,]+$/g, "");

/** Ensure a finding sentence ends with a single period. */
function asSentence(s: string): string {
  const t = clip(s).replace(/[.;,\s]+$/g, "");
  return t ? `${t}.` : t;
}

/** Turn a finding sentence into an impression line (strip a leading organ label). */
function asImpressionLine(s: string): string {
  return asSentence(s).replace(/^([A-Z][A-Za-z /&()-]{2,24})\s*[:\-]\s*/, "");
}

function orderSections(sections: string[], preferred: string[]): string[] {
  const rank = new Map<string, number>();
  preferred.forEach((s, i) => rank.set(s.toLowerCase(), i));
  return [...sections].sort((a, b) => {
    const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase())! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase())! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return sections.indexOf(a) - sections.indexOf(b); // stable: first-seen
  });
}

export function mergeFindings(input: MergeInput): MergedReport {
  const preferred = input.sectionOrder && input.sectionOrder.length ? input.sectionOrder : DEFAULT_SECTION_ORDER;
  const normalImpression = input.normalImpression?.trim() || "No significant abnormality detected.";

  // group by section, de-duplicating sentences within a section
  const bySection = new Map<string, { lines: string[]; seen: Set<string> }>();
  const abnormal: MergeFinding[] = [];
  let kept = 0;

  for (const f of input.findings) {
    const text = asSentence(f.text || "");
    if (!text) continue;
    const section = clip(f.section || "General") || "General";
    if (!bySection.has(section)) bySection.set(section, { lines: [], seen: new Set() });
    const grp = bySection.get(section)!;
    const key = dedupeKey(text);
    if (grp.seen.has(key)) continue;
    grp.seen.add(key);
    grp.lines.push(text);
    kept++;
    if (f.abnormal || f.impression) abnormal.push(f);
  }

  const orderedSections = orderSections([...bySection.keys()], preferred);
  const sections: MergedSection[] = orderedSections.map((s) => ({ section: s, lines: bySection.get(s)!.lines }));

  // Findings block: "Section: sentence sentence"
  const findingsText = sections
    .map((s) => `${s.section}: ${s.lines.join(" ")}`)
    .join("\n");

  // Impression: numbered, de-duplicated abnormal lines; else the normal line.
  const impSeen = new Set<string>();
  const impLines: string[] = [];
  for (const f of abnormal) {
    const line = asImpressionLine(f.text || "");
    const key = dedupeKey(line);
    if (!line || impSeen.has(key)) continue;
    impSeen.add(key);
    impLines.push(line);
  }
  const impressionText = impLines.length
    ? impLines.map((l, i) => `${i + 1}. ${l}`).join("\n")
    : normalImpression;

  const title = clip(input.title || "");
  const technique = clip(input.technique || "");
  const plainText = [
    title ? title.toUpperCase() : null,
    technique ? `\nTECHNIQUE:\n${technique}` : null,
    `\nFINDINGS:\n${findingsText || "—"}`,
    `\nIMPRESSION:\n${impressionText}`,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    title,
    technique,
    sections,
    findingsText,
    impressionText,
    plainText,
    counts: { findings: kept, abnormal: impLines.length, sections: sections.length },
  };
}
