/**
 * usgFindingLibraryExtended — expanded structured finding library (Phase P2.6).
 *
 * Additional deterministic finding objects for the core Whole-Abdomen / KUB
 * organs, built on the SAME engine as the P1 reference findings (parameters →
 * guarded text + impression via fillStructuredTemplate). No hard-coded prose in
 * React — everything is data here. This is an initial clinically-useful set;
 * the framework is intentionally extensible (add a UsgFindingDef, wire its id
 * into EXTENDED_ORGAN_FINDINGS). Remaining organs (spleen, pancreas, uterus,
 * ovaries, scrotum, thyroid, breast, soft tissue, Doppler) are follow-up within
 * P2.6 / later phases and are catalogued in docs/usg-companion.
 *
 * Clinical safety: descriptive lesion findings never assert malignancy; they
 * record features and leave interpretation to the radiologist.
 */

import { ellipsoidVolumeMl, parseMeasurement, type UsgFindingDef, type DeriveResult } from "./usgFindingBuilder";

const num = (unit: string, units: string[], normalizeTo: string, extra: Partial<Record<string, unknown>> = {}) =>
  ({ type: "number" as const, unit, units, normalizeTo, ...extra });

// ── LIVER ────────────────────────────────────────────────────────────────────
const LIVER_FATTY: UsgFindingDef = {
  id: "liver_fatty", organ: "liver", organLabel: "Liver", findingType: "Fatty liver",
  params: [
    { key: "grade", label: "Grade", type: "select", options: ["Grade I", "Grade II", "Grade III"], default: "Grade I", required: true, sortOrder: 1 },
    { key: "hepatomegaly", label: "Hepatomegaly", type: "yesno", default: "Absent", sortOrder: 2 },
    { key: "span", label: "Liver span", ...num("cm", ["cm", "mm"], "mm"), sortOrder: 3 },
  ],
  findingText: "The liver is {size_phrase} and shows {grade_desc} diffuse increase in echogenicity with {grade_feature}, suggestive of grade {grade_num} fatty liver.",
  impressionText: "Grade {grade_num} fatty liver {hepatomegaly_impression}.",
  derive: (v): DeriveResult => {
    const g = (v.grade ?? "Grade I").trim();
    const gradeNum = g.replace(/^Grade\s*/i, "");
    const desc = gradeNum === "III" ? "severe" : gradeNum === "II" ? "moderate" : "mild";
    const feature = gradeNum === "III" ? "marked posterior beam attenuation and poor diaphragm visualization"
      : gradeNum === "II" ? "impaired visualization of the intrahepatic vessels and diaphragm" : "preserved diaphragm and portal vein wall visualization";
    const hepato = (v.hepatomegaly ?? "").trim().toLowerCase() === "present";
    const span = parseMeasurement(v.span, { defaultUnit: "cm", normalizeTo: "mm" });
    const spanCm = span.normalized != null ? `${Math.round(span.normalized / 10 * 10) / 10} cm` : "";
    return {
      render: {
        grade_num: gradeNum,
        grade_desc: desc,
        grade_feature: feature,
        size_phrase: hepato ? (spanCm ? `enlarged (span ${spanCm})` : "enlarged") : "normal in size",
        hepatomegaly_impression: hepato ? "with hepatomegaly" : "",
      },
    };
  },
};

const LIVER_HEPATOMEGALY: UsgFindingDef = {
  id: "liver_hepatomegaly", organ: "liver", organLabel: "Liver", findingType: "Hepatomegaly",
  params: [{ key: "span", label: "Liver span", ...num("cm", ["cm", "mm"], "mm"), required: true, sortOrder: 1 }],
  findingText: "The liver is enlarged, measuring {span_cm} in craniocaudal span, with normal echotexture and no focal lesion.",
  impressionText: "Hepatomegaly.",
  derive: (v): DeriveResult => {
    const span = parseMeasurement(v.span, { defaultUnit: "cm", normalizeTo: "mm" });
    return { render: { span_cm: span.normalized != null ? `${Math.round(span.normalized / 10 * 10) / 10} cm` : "" } };
  },
};

const LIVER_CYST: UsgFindingDef = {
  id: "liver_cyst", organ: "liver", organLabel: "Liver", findingType: "Hepatic cyst",
  params: [
    { key: "number", label: "Number", type: "select", options: ["Single", "Multiple"], default: "Single", required: true, sortOrder: 1 },
    { key: "segment", label: "Segment/lobe", type: "select", options: ["right lobe", "left lobe", "caudate lobe"], default: "right lobe", sortOrder: 2 },
    { key: "size", label: "Largest size", ...num("mm", ["mm", "cm"], "mm"), required: true, sortOrder: 3 },
  ],
  findingText: "{count_article} well-defined anechoic {cyst_word} with thin walls and posterior acoustic enhancement {is_are} seen in the {segment} of the liver, the largest measuring {size}.",
  impressionText: "{count_article2} simple hepatic {cyst_word}.",
  derive: (v): DeriveResult => {
    const single = (v.number ?? "").trim().toLowerCase() === "single";
    return { render: {
      count_article: single ? "A" : "Multiple",
      count_article2: single ? "Simple hepatic cyst —" : "Multiple",
      cyst_word: single ? "cyst" : "cysts",
      is_are: single ? "is" : "are",
    } };
  },
};

// ── GALLBLADDER ───────────────────────────────────────────────────────────────
const GB_SLUDGE: UsgFindingDef = {
  id: "gb_sludge", organ: "gallbladder", organLabel: "Gallbladder", findingType: "Biliary sludge",
  params: [{ key: "amount", label: "Amount", type: "select", options: ["Layering", "Filling"], default: "Layering", sortOrder: 1 }],
  findingText: "{amount_phrase} low-level echoes without acoustic shadowing are seen within the gallbladder, consistent with biliary sludge. No definite calculus is seen.",
  impressionText: "Biliary sludge.",
  derive: (v): DeriveResult => ({ render: { amount_phrase: (v.amount ?? "").trim() === "Filling" ? "Sludge filling the lumen with" : "Layering" } }),
};

const GB_POLYP: UsgFindingDef = {
  id: "gb_polyp", organ: "gallbladder", organLabel: "Gallbladder", findingType: "Gallbladder polyp",
  params: [
    { key: "number", label: "Number", type: "select", options: ["Single", "Multiple"], default: "Single", required: true, sortOrder: 1 },
    { key: "size", label: "Largest size", ...num("mm", ["mm"], "mm"), required: true, sortOrder: 2 },
  ],
  findingText: "{count_article} non-mobile echogenic {polyp_word} without posterior acoustic shadowing {is_are} seen arising from the gallbladder wall, the largest measuring {size}.",
  impressionText: "Gallbladder {polyp_word2}{size_flag}.",
  derive: (v): DeriveResult => {
    const single = (v.number ?? "").trim().toLowerCase() === "single";
    const sz = parseMeasurement(v.size, { defaultUnit: "mm", normalizeTo: "mm" });
    const large = sz.normalized != null && sz.normalized >= 10;
    return { render: {
      count_article: single ? "A single" : "Multiple",
      polyp_word: single ? "polyp" : "polyps",
      polyp_word2: single ? "polyp" : "polyps",
      is_are: single ? "is" : "are",
      size_flag: large ? " (≥10 mm — follow-up/further evaluation advised)" : "",
    } };
  },
};

const GB_WALL: UsgFindingDef = {
  id: "gb_wall_thickening", organ: "gallbladder", organLabel: "Gallbladder", findingType: "Gallbladder wall thickening",
  params: [
    { key: "thickness", label: "Wall thickness", ...num("mm", ["mm"], "mm"), required: true, sortOrder: 1 },
    { key: "pattern", label: "Pattern", type: "select", options: ["diffuse", "focal"], default: "diffuse", sortOrder: 2 },
  ],
  findingText: "The gallbladder wall is {pattern}ly thickened, measuring {thickness}. No calculus or pericholecystic fluid is seen.",
  impressionText: "Gallbladder wall thickening — clinical correlation advised.",
};

// ── CBD ───────────────────────────────────────────────────────────────────────
const CBD_DILATED: UsgFindingDef = {
  id: "cbd_dilated", organ: "cbd", organLabel: "CBD", findingType: "Dilated CBD",
  params: [
    { key: "diameter", label: "Max diameter", ...num("mm", ["mm"], "mm"), required: true, sortOrder: 1 },
    { key: "calculus", label: "Intraluminal calculus", type: "yesno", default: "Absent", sortOrder: 2 },
  ],
  findingText: "The common bile duct is dilated, measuring {diameter} in maximum diameter[, with an intraluminal echogenic focus suggesting {calculus}].",
  impressionText: "Dilated common bile duct {calculus_impression}.",
  derive: (v): DeriveResult => {
    const stone = (v.calculus ?? "").trim().toLowerCase() === "present";
    return { render: { calculus: stone ? "choledocholithiasis" : "", calculus_impression: stone ? "with choledocholithiasis" : "" } };
  },
};

// ── KIDNEY ────────────────────────────────────────────────────────────────────
const KIDNEY_HYDRO: UsgFindingDef = {
  id: "kidney_hydronephrosis", organ: "kidney", organLabel: "Kidney", findingType: "Hydronephrosis", lateralityParam: "side",
  params: [
    { key: "side", label: "Side", type: "select", options: ["Right", "Left", "Bilateral"], default: "Right", required: true, sortOrder: 1 },
    { key: "grade", label: "Grade", type: "select", options: ["Mild", "Moderate", "Severe"], default: "Mild", required: true, sortOrder: 2 },
    { key: "ureter", label: "Ureteric dilatation", type: "select", options: ["None", "Present"], default: "None", sortOrder: 3 },
  ],
  findingText: "There is {grade_lower} hydronephrosis of {kidney_phrase}[ with associated hydroureter].",
  impressionText: "{side} {grade_lower} hydronephrosis {ureter_impression}.",
  derive: (v): DeriveResult => {
    const side = (v.side ?? "").trim();
    const kidney = side === "Bilateral" ? "both kidneys" : `the ${side.toLowerCase()} kidney`;
    const ureter = (v.ureter ?? "").trim() === "Present";
    return { render: {
      grade_lower: (v.grade ?? "").trim().toLowerCase(),
      kidney_phrase: kidney,
      ureter_impression: ureter ? "with hydroureter" : "",
    } };
  },
};

const KIDNEY_CYST: UsgFindingDef = {
  id: "kidney_cyst", organ: "kidney", organLabel: "Kidney", findingType: "Renal cyst", lateralityParam: "side",
  params: [
    { key: "side", label: "Side", type: "select", options: ["Right", "Left"], default: "Right", required: true, sortOrder: 1 },
    { key: "number", label: "Number", type: "select", options: ["Single", "Multiple"], default: "Single", required: true, sortOrder: 2 },
    { key: "pole", label: "Location", type: "select", options: ["upper pole", "interpolar region", "lower pole"], default: "upper pole", sortOrder: 3 },
    { key: "size", label: "Largest size", ...num("mm", ["mm", "cm"], "mm"), required: true, sortOrder: 4 },
  ],
  findingText: "{count_article} well-defined anechoic {cyst_word} with imperceptible walls {is_are} seen in the {pole} of the {side_lower} kidney, the largest measuring {size}.",
  impressionText: "Simple {side_lower} renal {cyst_word}.",
  derive: (v): DeriveResult => {
    const single = (v.number ?? "").trim().toLowerCase() === "single";
    return { render: {
      count_article: single ? "A" : "Multiple",
      cyst_word: single ? "cyst" : "cysts",
      is_are: single ? "is" : "are",
      side_lower: (v.side ?? "").trim().toLowerCase(),
    } };
  },
};

const KIDNEY_ECHO: UsgFindingDef = {
  id: "kidney_echogenicity", organ: "kidney", organLabel: "Kidney", findingType: "Increased cortical echogenicity", lateralityParam: "side",
  params: [
    { key: "side", label: "Side", type: "select", options: ["Right", "Left", "Bilateral"], default: "Bilateral", required: true, sortOrder: 1 },
    { key: "cmd", label: "Corticomedullary differentiation", type: "select", options: ["maintained", "reduced", "lost"], default: "reduced", sortOrder: 2 },
  ],
  findingText: "{kidney_phrase_cap} {show_word} increased cortical echogenicity with {cmd} corticomedullary differentiation.",
  impressionText: "Increased renal cortical echogenicity ({side_lower}) — suggested clinical/biochemical correlation for medical renal disease.",
  derive: (v): DeriveResult => {
    const side = (v.side ?? "").trim();
    const bilateral = side === "Bilateral";
    return { render: {
      kidney_phrase_cap: bilateral ? "Both kidneys" : `The ${side.toLowerCase()} kidney`,
      show_word: bilateral ? "show" : "shows",
      cmd: (v.cmd ?? "").trim(),
      side_lower: bilateral ? "bilateral" : side.toLowerCase(),
    } };
  },
};

// ── URINARY BLADDER ───────────────────────────────────────────────────────────
const BLADDER_WALL: UsgFindingDef = {
  id: "bladder_wall_thickening", organ: "urinary_bladder", organLabel: "Urinary bladder", findingType: "Bladder wall thickening",
  params: [
    { key: "thickness", label: "Wall thickness", ...num("mm", ["mm"], "mm"), required: true, sortOrder: 1 },
    { key: "distension", label: "Distension", type: "select", options: ["adequately distended", "underdistended"], default: "adequately distended", sortOrder: 2 },
  ],
  findingText: "The urinary bladder wall is thickened, measuring {thickness}[ (assessment limited as the bladder is {distension_flag})]. No intraluminal calculus or mass is seen.",
  impressionText: "Bladder wall thickening — clinical correlation advised.",
  derive: (v): DeriveResult => ({ render: { distension_flag: (v.distension ?? "").trim() === "underdistended" ? "underdistended" : "" } }),
};

const BLADDER_PVR: UsgFindingDef = {
  id: "bladder_pvr", organ: "urinary_bladder", organLabel: "Urinary bladder", findingType: "Post-void residual assessment",
  params: [
    { key: "pre_l", label: "Pre-void L", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 1 },
    { key: "pre_w", label: "Pre-void W", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 2 },
    { key: "pre_h", label: "Pre-void H", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 3 },
    { key: "post_l", label: "Post-void L", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 4 },
    { key: "post_w", label: "Post-void W", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 5 },
    { key: "post_h", label: "Post-void H", ...num("mm", ["mm", "cm"], "mm"), sortOrder: 6 },
  ],
  findingText: "Pre-void bladder volume is approximately {pre_vol} cc and post-void residual volume is approximately {post_vol} cc ({pvr_pct}).",
  impressionText: "{pvr_impression}",
  derive: (v): DeriveResult => {
    const mm = (k: string) => parseMeasurement(v[k], { defaultUnit: "mm", normalizeTo: "mm" }).normalized;
    const pre = ellipsoidVolumeMl(mm("pre_l"), mm("pre_w"), mm("pre_h"));
    const post = ellipsoidVolumeMl(mm("post_l"), mm("post_w"), mm("post_h"));
    const preR = pre != null ? String(Math.round(pre)) : "";
    const postR = post != null ? String(Math.round(post)) : "";
    let pct = "";
    let impression = "";
    if (pre != null && post != null && pre > 0) {
      const p = Math.round((post / pre) * 100);
      pct = `residual fraction ~${p}%`;
      impression = post >= 50 || p >= 20 ? `Significant post-void residual urine (~${postR} cc).` : `Insignificant post-void residual urine (~${postR} cc).`;
    }
    return { render: { pre_vol: preR, post_vol: postR, pvr_pct: pct, pvr_impression: impression } };
  },
};

export const EXTENDED_FINDING_DEFS: UsgFindingDef[] = [
  LIVER_FATTY, LIVER_HEPATOMEGALY, LIVER_CYST,
  GB_SLUDGE, GB_POLYP, GB_WALL,
  CBD_DILATED,
  KIDNEY_HYDRO, KIDNEY_CYST, KIDNEY_ECHO,
  BLADDER_WALL, BLADDER_PVR,
];

/** Additional finding ids to wire onto each organ (merged by usgOrganLibrary). */
export const EXTENDED_ORGAN_FINDINGS: Record<string, string[]> = {
  liver: ["liver_fatty", "liver_hepatomegaly", "liver_cyst"],
  gallbladder: ["gb_sludge", "gb_polyp", "gb_wall_thickening"],
  cbd: ["cbd_dilated"],
  right_kidney: ["kidney_hydronephrosis", "kidney_cyst", "kidney_echogenicity"],
  left_kidney: ["kidney_hydronephrosis", "kidney_cyst", "kidney_echogenicity"],
  urinary_bladder: ["bladder_wall_thickening", "bladder_pvr"],
};
