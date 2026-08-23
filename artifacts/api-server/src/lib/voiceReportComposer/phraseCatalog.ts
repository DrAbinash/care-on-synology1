/**
 * CARE phrase catalog — prefer configured wording over free model prose.
 * V1: MRI Brain + LS Spine built-in chocolate-box / format phrases.
 */

export type CatalogPhrase = {
  concept: string;
  patterns: RegExp[];
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
};

const CATALOG: CatalogPhrase[] = [
  {
    concept: "loss_of_lordosis",
    patterns: [/loss of (lumbar )?lordosis/i, /flattened lumbar lordosis/i],
    findingsText: "Loss of lumbar lordosis.",
    anatomicalSection: "alignment",
    conflictGroup: "lumbar_alignment",
    baselineReplaces: "Lumbar alignment is maintained",
  },
  {
    concept: "disc_desiccation",
    patterns: [/disc desiccation/i, /dehydrated disc/i],
    findingsText: "Disc desiccation at [Level] with reduced T2 signal.",
    anatomicalSection: "disc",
    conflictGroup: "disc",
  },
  {
    concept: "disc_bulge",
    patterns: [
      /disc bulge/i,
      /diffuse disc bulge/i,
      /diffuse bulges?/i,
      /broad-based disc bulge/i,
    ],
    findingsText: "Diffuse disc bulge at [Level] indenting the anterior thecal sac.",
    impressionText: "Diffuse disc bulge at [Level].",
    anatomicalSection: "disc",
    conflictGroup: "disc",
    baselineReplaces: "No significant disc bulge",
  },
  {
    concept: "thecal_sac_compression",
    patterns: [/thecal sac compression/i, /indenting the anterior thecal sac/i, /pressure over the front of the thecal sac/i],
    findingsText: "Anterior thecal sac compression.",
    anatomicalSection: "cord",
    conflictGroup: "cord",
  },
  {
    concept: "nerve_root_impingement",
    patterns: [/nerve root impingement/i, /radicular impingement/i],
    findingsText: "Bilateral nerve root impingement.",
    anatomicalSection: "cord",
    conflictGroup: "nerve_root",
  },
  {
    concept: "foraminal_narrowing",
    patterns: [/foraminal narrowing/i, /neural foraminal narrowing/i],
    findingsText: "Bilateral neural foraminal narrowing.",
    anatomicalSection: "foramina",
    conflictGroup: "foramina",
  },
  {
    concept: "ligamentum_flavum_hypertrophy",
    patterns: [/ligamentum flavum hypertrophy/i, /ligamentum flavum thickening/i],
    findingsText: "Ligamentum flavum hypertrophy in the lower lumbar levels.",
    anatomicalSection: "ligamentum",
    conflictGroup: "ligamentum",
  },
  {
    concept: "anterolisthesis",
    patterns: [/anterolisthesis/i, /listhesis/i],
    findingsText: "Grade [grade] anterolisthesis of [Level] over [Level].",
    anatomicalSection: "alignment",
    conflictGroup: "lumbar_alignment",
    baselineReplaces: "Lumbar alignment is maintained",
  },
  {
    concept: "normal_brain",
    patterns: [/normal brain/i, /^brain is normal/i],
    findingsText: "Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified.",
    impressionText: "Normal MRI brain.",
    anatomicalSection: "brain",
    conflictGroup: "brain_parenchyma",
  },
  {
    concept: "white_matter_changes",
    patterns: [/white matter (changes|disease|hyperintensity)/i, /fazekas/i],
    findingsText: "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade [grade].",
    anatomicalSection: "white matter",
    conflictGroup: "white_matter",
  },
];

export function matchCatalogPhrases(transcript: string): CatalogPhrase[] {
  const hits: CatalogPhrase[] = [];
  for (const entry of CATALOG) {
    if (entry.patterns.some((p) => p.test(transcript))) hits.push(entry);
  }
  return hits;
}

export function catalogForPrompt(region: string): string {
  const regionLower = region.toLowerCase();
  const filtered = CATALOG.filter((c) => {
    if (regionLower.includes("brain")) return /brain|white_matter/i.test(c.concept);
    if (regionLower.includes("ls") || regionLower.includes("lumbar")) {
      return !/brain|white_matter/i.test(c.concept);
    }
    return true;
  });
  return filtered
    .map((c) => `- ${c.concept}: "${c.findingsText}"`)
    .join("\n");
}

export function fillLevelInPhrase(text: string, level: string | null | undefined): string {
  if (!level?.trim()) return text.replace(/\[Level\]/g, "___");
  const norm = level.replace(/\s+/g, "").replace(/-/g, "-").toUpperCase();
  return text.replace(/\[Level\]/g, norm);
}
