/**
 * findingsCompose.ts — template-driven report composition for the Findings
 * Library (Reporting Workspace + Report Builder).
 *
 * The real radiology workflow: start from an all-normal study template, then for
 * each abnormal organ the abnormal finding *replaces* that organ's normal line
 * in the body — and also becomes an Impression line. Organs with no abnormal
 * stay normal. `composeReport` implements exactly that.
 *
 * Output maps onto the workspace state: `findingsText` → rawFindings (replace),
 * `impressionLines` → impression[]. Pure & deterministic.
 */

export interface BaseSection {
  section: string;
  normal: string;
}
export interface SelFinding {
  text: string;
  section?: string;
  abnormal?: boolean;
}
export interface ReportLine {
  section: string;
  text: string;
  abnormal: boolean;
}
export interface ComposedReport {
  lines: ReportLine[];
  findingsText: string;
  impressionLines: string[];
}

// House anatomical order; unlisted sections keep first-seen order after these.
export const SECTION_ORDER = [
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
const dedupeKey = (s: string): string => clip(s).toLowerCase().replace(/[.;,]+$/g, "");
function asSentence(s: string): string {
  const t = clip(s).replace(/[.;,\s]+$/g, "");
  return t ? `${t}.` : t;
}
function stripLabel(s: string): string {
  return asSentence(s).replace(/^([A-Z][A-Za-z /&()-]{2,24})\s*[:-]\s*/, "");
}
function orderIndex(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = dedupeKey(s);
    if (k && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

/**
 * Compose a report from an optional normal base template and a set of selected
 * findings. Abnormal findings replace their organ's normal line; abnormal
 * findings also drive the impression. Organs with no abnormal stay normal.
 */
export function composeReport(base: BaseSection[] | undefined, selected: SelFinding[]): ComposedReport {
  const baseList = base ?? [];

  // group selection by section
  const sel = new Map<string, { abn: string[]; nml: string[] }>();
  for (const f of selected) {
    const text = asSentence(f.text || "");
    if (!text) continue;
    const section = clip(f.section || "General") || "General";
    if (!sel.has(section)) sel.set(section, { abn: [], nml: [] });
    (f.abnormal ? sel.get(section)!.abn : sel.get(section)!.nml).push(text);
  }

  const baseSections = baseList.map((b) => clip(b.section));
  const baseMap = new Map(baseList.map((b) => [clip(b.section), asSentence(b.normal)]));
  const extra = [...sel.keys()]
    .filter((s) => !baseSections.includes(s))
    .sort((a, b) => orderIndex(a) - orderIndex(b));
  const order = [...baseSections, ...extra];

  const lines: ReportLine[] = [];
  const seen = new Set<string>();
  for (const section of order) {
    if (seen.has(section)) continue;
    seen.add(section);
    const s = sel.get(section);
    if (s && s.abn.length) {
      // abnormal replaces the normal line for this organ
      lines.push({ section, text: dedupe(s.abn).join(" "), abnormal: true });
    } else if (baseMap.has(section)) {
      // keep normal, optionally appending any extra normal sentences the user added
      const extraNml = s ? dedupe(s.nml) : [];
      lines.push({ section, text: dedupe([baseMap.get(section)!, ...extraNml]).join(" "), abnormal: false });
    } else if (s && s.nml.length) {
      lines.push({ section, text: dedupe(s.nml).join(" "), abnormal: false });
    }
  }

  const findingsText = lines.map((l) => `${l.section}: ${l.text}`).join("\n");

  // impression: abnormal findings only, label-stripped, de-duplicated, in body order
  const impSeen = new Set<string>();
  const impressionLines: string[] = [];
  for (const l of lines) {
    if (!l.abnormal) continue;
    for (const part of (sel.get(l.section)?.abn ?? [])) {
      const line = stripLabel(part);
      const k = dedupeKey(line);
      if (line && !impSeen.has(k)) { impSeen.add(k); impressionLines.push(line); }
    }
  }

  return { lines, findingsText, impressionLines };
}
