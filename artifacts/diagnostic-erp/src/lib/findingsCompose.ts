/**
 * findingsCompose.ts — client-side composition used by the Findings Library
 * panel inside the Reporting Workspace.
 *
 * Turns a set of selected findings into (a) a findings text block grouped by
 * organ/section in anatomical order, and (b) impression lines (from the abnormal
 * ones). These map directly onto the workspace's `rawFindings` (string, appended
 * via mergeBlock) and `impression` (string[]). Pure & deterministic.
 *
 * The backend has an equivalent full-report merge (findingsMerge.ts); this
 * client copy exists because the workspace appends incrementally into its own
 * state shapes rather than producing a standalone report document.
 */

export interface ComposeFinding {
  text: string;
  section?: string;
  abnormal?: boolean;
}

export interface Composed {
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

export function composeFindings(findings: ComposeFinding[]): Composed {
  const bySection = new Map<string, { lines: string[]; seen: Set<string> }>();
  const impSeen = new Set<string>();
  const impressionLines: string[] = [];

  for (const f of findings) {
    const text = asSentence(f.text || "");
    if (!text) continue;
    const section = clip(f.section || "General") || "General";
    if (!bySection.has(section)) bySection.set(section, { lines: [], seen: new Set() });
    const grp = bySection.get(section)!;
    const key = dedupeKey(text);
    if (!grp.seen.has(key)) {
      grp.seen.add(key);
      grp.lines.push(text);
    }
    if (f.abnormal) {
      const line = stripLabel(f.text || "");
      const ik = dedupeKey(line);
      if (line && !impSeen.has(ik)) {
        impSeen.add(ik);
        impressionLines.push(line);
      }
    }
  }

  const sections = [...bySection.keys()].sort((a, b) => {
    const ra = SECTION_ORDER.indexOf(a); const rb = SECTION_ORDER.indexOf(b);
    const na = ra === -1 ? Number.MAX_SAFE_INTEGER : ra;
    const nb = rb === -1 ? Number.MAX_SAFE_INTEGER : rb;
    return na - nb;
  });

  const findingsText = sections
    .map((s) => `${s}: ${bySection.get(s)!.lines.join(" ")}`)
    .join("\n");

  return { findingsText, impressionLines };
}
