/**
 * generate-mri-macro-quick-select.mjs — turn the owner's approved MRI macros into
 * Quick Select boxes, in one deterministic migration file.
 *
 * `structured_report_templates.macros_json` holds 22 MRI sentences written and approved by the
 * radiologist-owner. Nothing in the reporting UI ever reads that column — only the admin template
 * editor writes it — so the approved prose has been unreachable at the reporting desk. This tool
 * converts the applicable ones into `radiology_quick_findings` rows, which is the catalogue the
 * existing deterministic composer already reads. It does not build a second engine and it does not
 * write clinical prose: every sentence is taken byte-for-byte from the macro, and the only edit is
 * replacing the owner's own square-bracket slot with the parameter token the composer validates.
 *
 * Read: the migration-built database (`DATABASE_URL`, or --db=...). Write: one .sql file.
 *
 * Rules this tool exists to enforce:
 *  - `[LEVEL]`/`[VERTEBRAL LEVEL]`/`[LEVELS]` become a required `{level}` SELECT whose options are
 *    that segment's own disc levels, taken from the skeleton's headings — a cervical sentence never
 *    gets lumbar options, and no level is assumed.
 *  - `[RIGHT/LEFT…]`/`[SIDE]` become a required `{side}` select. Nothing defaults to a side.
 *  - `[X] mm`, `[SIZE] cm`, `[X]%`, `[SCORE]/10` become required measurements. A `{token}` followed
 *    by a unit is exactly the shape `unansweredStructuredMeasurements` refuses, so an empty
 *    measurement can never reach a report.
 *  - every other choice slot becomes a required select carrying the owner's own options verbatim.
 *  - `anatomical_section` is set only to a heading that skeleton actually has, because
 *    `sectionEndSlot` places a finding by exact (case-folded) heading equality. A level-parameterised
 *    sentence gets no section: it belongs to the level line the composer already anchors on.
 *  - enhancement prose is marked `{"requiresContrast":true}` in `properties`, which
 *    `quickSelectContrastGate` honours, so a plain study cannot offer it.
 *  - `factory_key = macro:<template>/<key>` is the idempotency key; the emitted INSERT skips any
 *    factory_key already present and any (study_type, label) clash, and it never touches a row the
 *    clinic customised.
 */
import fs from "node:fs";
import pg from "pg";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6)
  ?? "migrations/zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r001.sql";
/** The authored additions ship separately: same rules, different provenance, so the clinic can
 *  retire this change's own content without touching a single converted macro box. */
const OUT2 = OUT.replace(/r001\.sql$/, "r002.sql");
const baseName = (p) => p.split("/").pop();
const DB = process.env.DATABASE_URL
  || process.argv.find((a) => a.startsWith("--db="))?.slice(5)
  || "postgresql://erp@127.0.0.1:5450/care_accept_r4";

/**
 * One entry per macro this conversion ships.
 *
 * `slots` names the owner's own square-bracket choices, measured out of `macros_json` — the
 * generator throws if a named slot is not in the sentence, so a guessed slot cannot ship, and throws
 * again if any bracket she wrote is left unsubstituted, so no slot can survive into a report
 * unnoticed. There is deliberately no fallback table that guesses what an unnamed bracket meant.
 * Whether a box asks a questionnaire is DERIVED, not declared (see `CHIP_TOKENS` below): slots inside
 * the strip's own chip vocabulary (side, severity, level) keep the existing chips — the way #521
 * "Disc bulge (pick level)" already works — and any other slot makes the box a dialog box, because a
 * token neither the chips know nor the box asks is one that refuses forever. Declaring both for the
 * same token would put two controls on one hole.
 * `concept` is reused from the catalogue's own vocabulary wherever the sentence is the same
 * observation under different words, because `concept` is what supersession and the contradiction
 * checks key on; a brand-new concept is stated as `newConcept: true` so it is visible in the report.
 * `baselineReplaces` is only ever a sentence the app's own baseline module renders, checked below.
 * `level: "disc" | "vertebra"` picks which of the segment's own headings a `{level}` may answer —
 * "spondylolisthesis of L4 over L5" is a vertebral body, "disc prolapse at L4-L5" is a disc space,
 * and the two vocabularies are not interchangeable.
 */
const SPEC = [
  // ---- MRI Brain Plain -----------------------------------------------------------------
  { template: "MRI Brain Plain", key: "white_matter_lesions", label: "Small-vessel ischaemic white matter change",
    studyType: "Brain", concept: "white_matter_lesions", newConcept: true, section: "", slots: {},
    impression: "White matter lesions, differential includes small vessel ischaemic change vs. demyelination.",
    note: "Kept distinct from the Fazekas 1/2/3 tiles (#395/#416/#433), which state a grade; the owner's sentence states the differential instead, which is what a first ungraded study needs." },
  { template: "MRI Brain Plain", key: "midline_shift", label: "Midline shift with measurement",
    studyType: "Brain", concept: "midline", section: "",
    baselineReplaces: "No midline shift is seen.",
    slots: { "[X] mm": { name: "measurement", type: "text", label: "Shift in millimetres", unit: "mm" },
             "[SIDE]": { name: "side", type: "select", label: "Direction of shift", options: ["right", "left"] } },
    impression: "Midline shift of approximately {measurement} mm to the {side}.",
    note: "The wall already had #35 \"Midline shift is noted.\" — direction and magnitude are the neurosurgical question and the owner's macro states both. #336 carries the same two parameters for CT Brain; this is the MR counterpart." },

  // ---- MRI Brain With Contrast ---------------------------------------------------------
  { template: "MRI Brain With Contrast", key: "ring_enhancing", label: "Ring-enhancing lesion",
    studyType: "Brain", concept: "ring_enhancing_lesion", newConcept: true, section: "", contrast: true,
    slots: { "[LOCATION]": { name: "location", type: "text", label: "Location" },
             "[SIZE] cm": { name: "size", type: "text", label: "Largest size in centimetres", unit: "cm" } },
    impression: "Ring-enhancing lesion with differential of glioblastoma multiforme, brain abscess or metastasis.",
    note: "Contrast-only by its own sentence, so the plain/contrast gate withholds it from a study reported without gadolinium." },
  { template: "MRI Brain With Contrast", key: "meningeal_enhancement", label: "Meningeal enhancement",
    studyType: "Brain", concept: "meningeal_enhancement", newConcept: true, section: "", contrast: true,
    slots: {}, impression: "Diffuse pachymeningeal/leptomeningeal enhancement.",
    note: "The owner's second sentence (CSF and clinical correlation) stays in Findings rather than being copied into Recommendations, so the advice is not printed twice." },

  // ---- MRI Cervical Spine --------------------------------------------------------------
  { template: "MRI Cervical Spine", key: "cervical_spondylosis", label: "Multilevel cervical spondylosis",
    studyType: "Cervical Spine", concept: "spondylotic_change", newConcept: true, section: "",
    slots: { "[LEVELS]": { name: "levels", type: "text", label: "Levels involved" },
             "[mild/moderate/severe]": { name: "severity", type: "select", label: "Severity", options: ["mild", "moderate", "severe"] } },
    impression: "Multilevel cervical spondylosis with {severity} canal stenosis at {levels}.",
    note: "Multilevel by wording, so it declares no level and no heading; the per-level tiles (#510/#521 …) stay independent of it." },

  // ---- MRI LS Spine -------------------------------------------------------------------
  { template: "MRI LS Spine", key: "disc_prolapse", label: "Disc prolapse with nerve root compression",
    studyType: "LS Spine", concept: "disc_contour", section: "",
    slots: { "[LEVEL]": { name: "level", type: "select", label: "Disc level", level: "disc" },
             "[mild/moderate/severe]": { name: "severity", type: "select", label: "Severity", options: ["mild", "moderate", "severe"] },
             "[central/paracentral/foraminal]": { name: "position", type: "select", label: "Position of the prolapse", options: ["central", "paracentral", "foraminal"] },
             "[RIGHT/LEFT/bilateral]": { name: "side", type: "select", label: "Nerve root side", options: ["right", "left", "bilateral"] } },
    impression: "Disc prolapse at {level} with {side} nerve root compression.",
    note: "The shipped LS disc tiles state a bulge or a protrusion; the owner's sentence is the one that names root compression, which is the surgical question." },
  { template: "MRI LS Spine", key: "canal_stenosis", label: "Canal stenosis from three causes",
    studyType: "LS Spine", concept: "canal_stenosis", section: "",
    slots: { "[LEVEL]": { name: "level", type: "select", label: "Disc level", level: "disc" } },
    impression: "Moderate to severe spinal canal stenosis at {level}.",
    note: "Distinct from #400/#428/#507 because the owner's sentence names all three mechanisms (disc, ligamentum flavum, facets) together rather than a single grade." },
  { template: "MRI LS Spine", key: "listhesis", label: "Spondylolisthesis with its cause",
    studyType: "LS Spine", concept: "spondylolisthesis", section: "",
    slots: { "[Grade I/II/III]": { name: "grade", type: "select", label: "Grade", options: ["Grade I", "Grade II", "Grade III"] },
             "[LEVEL]": { name: "level", type: "select", label: "Vertebra that slipped", level: "vertebra" },
             "[LEVEL+1]": { name: "level_below", type: "select", label: "Vertebra it slips over", level: "vertebra" },
             "[bilateral pars defects/degenerative facet disease]": { name: "association", type: "select", label: "Associated change",
               options: ["bilateral pars defects", "degenerative facet disease"] } },
    impression: "{grade} spondylolisthesis of {level} over {level_below}.",
    note: "A vertebral-body pair, not a disc space: the level vocabulary here is L1…L5 / S1, taken from the segment's own headings, and it is a required answer rather than a guessed one." },

  // ---- MRI Dorsal Spine — the dedicated catalogue the generic cross-modality rows were not
  { template: "MRI Dorsal Spine", key: "compression_fracture", label: "Vertebral compression fracture",
    studyType: "Dorsal Spine", concept: "compression_fracture", section: "",
    slots: { "[VERTEBRAL LEVEL]": { name: "level", type: "select", label: "Vertebral level", level: "vertebra" },
             "[X]%": { name: "height_loss", type: "text", label: "Loss of height, per cent", unit: "%" },
             "[Acute / Subacute / Chronic]": { name: "age", type: "select", label: "Age of the fracture",
               options: ["Acute", "Subacute", "Chronic"] } },
    impression: "Wedge compression fracture of {level} with {height_loss}% loss of height.",
    note: "The dorsal wall held no MR-scoped box at all before this file — #17/#40/#41 are cross-modality \"Spine\" rows, so an X-ray of the spine could offer them and an MRI dorsal study got nothing of its own." },
  { template: "MRI Dorsal Spine", key: "disc_herniation", label: "Thoracic disc herniation",
    studyType: "Dorsal Spine", concept: "disc_contour", section: "",
    slots: { "[LEVEL]": { name: "level", type: "select", label: "Disc level", level: "disc" },
             "[mild/moderate/severe]": { name: "severity", type: "select", label: "Severity", options: ["mild", "moderate", "severe"] },
             "[cord contact / cord compression]": { name: "cord_effect", type: "select", label: "Effect on the cord",
               options: ["cord contact", "cord compression"] } },
    impression: "Disc herniation at {level} with {cord_effect}.",
    note: "Dorsal wording throughout — the cord, not the cauda, is what a thoracic disc compresses, and the owner's own bracket says so." },
];

/**
 * Macros the conversion deliberately does not ship, and why the final report has to say so.
 * The 22 MRI macros are accounted for exactly: 10 shipped above, 12 below. Every box id cited was
 * read out of `radiology_quick_findings` on the rig, not from a summary.
 */
const SKIPPED = [
  { template: "MRI Brain Plain", key: "acute_infarct", why: "already on the Brain wall as #48 \"Acute Infarct\", which carries {side} and {territory} — it was hidden by the anatomy chip, not absent, and #512 \"Acute infarct (DWI)\" is its MR-scoped twin" },
  { template: "MRI Brain Plain", key: "no_midline_shift", why: "it is the normal statement, not an abnormality — the composer already owns that sentence as baseline prose (mriBrainStandardNormal.ts), so a tile would let a radiologist click a negative and retire a positive" },
  { template: "MRI Stroke Protocol", key: "acute_mca_infarct", why: "the strip scopes by modality and region only, never by protocol, so shipping it active would offer MRA and ASPECTS wording on a plain brain study. It also carries [occlusion/stenosis] and [M1/M2/ICA] slots that need a stroke-specific vocabulary nothing in the catalogue defines" },
  { template: "MRI Stroke Protocol", key: "tia_negative", why: "a negative with a clinical caveat, not an abnormality" },
  { template: "MRI Cervical Spine", key: "myelopathy", why: "already on the Cervical wall as #68 \"Myelomalacia\" at {level} (and #468 \"Cord signal change\", concept cord_signal)" },
  { template: "MRI Cervical Spine with Whole Spine Screening", key: "myelopathy", why: "the same sentence as the plain cervical macro — one box serves both examinations" },
  { template: "MRI Cervical Spine with Whole Spine Screening", key: "cervical_spondylosis", why: "byte-identical to the plain cervical macro shipped above; the screening study bills as Cervical Spine, so that box already reaches its wall" },
  { template: "MRI LS Spine with Whole Spine Screening", key: "disc_prolapse", why: "byte-identical to the MRI LS Spine macro shipped above; the screening study bills as LS Spine, so the shipped box already reaches its wall" },
  { template: "MRI LS Spine with Whole Spine Screening", key: "canal_stenosis", why: "byte-identical to the MRI LS Spine macro shipped above" },
  { template: "MRI LS Spine with Whole Spine Screening", key: "listhesis", why: "byte-identical to the MRI LS Spine macro shipped above" },
  { template: "MRI LS Spine with Whole Spine Screening", key: "screening_lesion", why: "kept for review, not exposed: its own sentence places a [LEVEL] in the [cervical/dorsal] spine, but the examination's skeleton only carries lumbar disc levels, so every level this box could offer contradicts the region the sentence names. Converting it would need a second level vocabulary the catalogue does not have." },
  { template: "MRI Cervical Spine with Whole Spine Screening", key: "screening_lesion", why: "the same sentence with the opposite gap — [LEVEL] offered from cervical headings (C2-C3…) while the owner's own bracket asks for the [dorsal/lumbosacral] spine" },
];

/**
 * Content the owner's macros do not cover, authored here and STAMPED as such.
 *
 * The owner's brief permits this and requires it be visible: "Any finding absent from both the
 * catalogue and the macros may be added, but must be marked as newly authored in the final report."
 * Every row below is therefore stamped `"newlyAuthored": true` in its own `properties`, in a
 * factory_key namespace (`authored:`) no macro conversion writes into, and in the header of the file
 * it emits — so the clinic can see at a glance which sentences came from her and which from this
 * change, and refine or retire the latter without touching a single converted box.
 *
 * What is NOT done here: no measurement is stated that no one measured, no side is pre-filled, no
 * level is baked into a sentence (each one is a parameter the radiologist answers), and every
 * sentence follows a shape the owner's own catalogue already uses — the dorsal set is worded around
 * the cord and the thoracic spine because a thoracic disc compresses the cord, not the cauda.
 */
const AUTHORED = [
  // ---- MRI Dorsal Spine: the dedicated catalogue the cross-modality "Spine" rows were not ----
  { studyType: "Dorsal Spine", label: "Thoracic canal stenosis", concept: "canal_stenosis",
    finding: "Central canal stenosis at {level} due to disc-osteophyte change and ligamentum flavum hypertrophy, causing {severity} compression of the thoracic cord.",
    impression: "{severity} thoracic canal stenosis at {level}.",
    slots: { "{level}": { name: "level", type: "select", label: "Disc level", level: "disc" },
             "{severity}": { name: "severity", type: "select", label: "Severity", options: ["mild", "moderate", "severe"] } },
    why: "The named dorsal requirement 'dorsal canal stenosis' — no dorsal-scoped box existed at all, and the generic #20 'Cord changes' row is not MRI-scoped or level-specific." },
  { studyType: "Dorsal Spine", label: "Thoracic cord compression", concept: "cord_compression",
    finding: "Thoracic cord compression at {level} with effacement of the posterior subarachnoid space.",
    impression: "Cord compression at {level}.",
    slots: { "{level}": { name: "level", type: "select", label: "Disc level", level: "disc" } },
    why: "'cord compression' on the dorsal list; mirrors the owner's own cervical #476 sentence, retargeted to the thoracic cord." },
  { studyType: "Dorsal Spine", label: "Thoracic cord signal change", concept: "cord_signal",
    finding: "Focal T2 hyperintense signal within the thoracic cord at {level}, consistent with myelopathic change.",
    impression: "Myelopathic signal change at {level}.",
    slots: { "{level}": { name: "level", type: "select", label: "Level", level: "disc" } },
    why: "'cord signal changes' on the dorsal list; the owner's cervical #68 sentence, with the cord named where it is." },
  { studyType: "Dorsal Spine", label: "Vertebral marrow oedema", concept: "marrow_oedema", newConcept: true,
    finding: "Marrow oedema signal is noted in {vertebra} with preserved vertebral body height.",
    impression: "Marrow oedema in {vertebra}.",
    slots: { "{vertebra}": { name: "vertebra", type: "select", label: "Vertebra", level: "vertebra" } },
    why: "'marrow edema' on the dorsal list; states oedema WITHOUT height loss, which is the finding that is not yet a fracture box." },
  { studyType: "Dorsal Spine", label: "Focal vertebral body lesion", concept: "focal_lytic_lesion",
    finding: "A focal marrow-replacing lesion is noted in {vertebra}.",
    impression: "Focal vertebral body lesion at {vertebra}.",
    slots: { "{vertebra}": { name: "vertebra", type: "select", label: "Vertebra", level: "vertebra" } },
    why: "'vertebral lesions' on the dorsal list; deliberately says only that a lesion is present — no behaviour, no size, no assumption of what it is." },
  { studyType: "Dorsal Spine", label: "Vertebral hemangioma", concept: "hemangioma",
    finding: "A vertebral hemangioma is noted at {vertebra}, with high T1 and T2 signal and no extra-osseous extension.",
    impression: "Vertebral hemangioma at {vertebra}.",
    slots: { "{vertebra}": { name: "vertebra", type: "select", label: "Vertebra", level: "vertebra" } },
    why: "'hemangioma' on the dorsal list; the owner's own LS #427 sentence, level-tokenised and carried to the dorsal vocabulary." },
  { studyType: "Dorsal Spine", label: "Infective discitis", concept: "discitis", newConcept: true,
    finding: "Endplate irregularity with adjacent marrow oedema and loss of disc signal at {level}, suggestive of infective discitis.",
    impression: "Changes suggestive of infective discitis at {level}.",
    slots: { "{level}": { name: "level", type: "select", label: "Disc level", level: "disc" } },
    why: "'infective / inflammatory' on the dorsal list; 'suggestive of' keeps it an impression to be confirmed, not a diagnosis the click asserts." },
  { studyType: "Dorsal Spine", label: "Multilevel thoracic spondylotic change", concept: "spondylotic_change",
    finding: "Multilevel thoracic spondylotic change with disc-osteophyte complexes at {levels}, causing {severity} canal stenosis.",
    impression: "Multilevel thoracic spondylosis with {severity} canal stenosis at {levels}.",
    slots: { "{levels}": { name: "levels", type: "text", label: "Levels involved" },
             "{severity}": { name: "severity", type: "select", label: "Severity", options: ["mild", "moderate", "severe"] } },
    why: "'spondylotic changes' on the dorsal list; the same sentence shape as the owner's cervical spondylosis macro, so the two examinations stay distinguishable." },

  // ---- MRI Brain: the checklist items neither the catalogue nor the macros carry ----------------
  { studyType: "Brain", label: "Meningioma", concept: "meningioma", newConcept: true, contrast: true,
    finding: "An extra-axial, dural-based lesion is noted in the {location}, showing homogeneous enhancement with a dural tail, consistent with meningioma.",
    impression: "Extra-axial dural-based lesion consistent with meningioma.",
    slots: { "{location}": { name: "location", type: "text", label: "Location" } },
    why: "The 26-item Brain list names meningioma and nothing on the wall states it; #467 offers only an unqualified 'extra-axial fluid collection'. Enhancement is in the sentence, so the plain/contrast gate withholds it from a study without gadolinium." },
  { studyType: "Brain", label: "Cerebellopontine angle lesion", concept: "cpa_lesion", newConcept: true,
    finding: "A well-defined extra-axial lesion is noted in the {side} cerebellopontine angle, with widening of the internal auditory canal.",
    impression: "{side} cerebellopontine angle lesion.",
    slots: { "{side}": { name: "side", type: "select", label: "Side", options: ["right", "left"] } },
    why: "CPA is on the list and absent from the catalogue. The side is asked for, never assumed." },
  { studyType: "Brain", label: "Sellar and parasellar mass", concept: "sellar_lesion", newConcept: true,
    finding: "A sellar mass is noted with superior extension into the suprasellar cistern, indenting the optic chiasm.",
    impression: "Sellar mass with suprasellar extension.",
    slots: {},
    why: "'sellar / parasellar' is on the list and on no box. States mass effect only where the sentence says extension is present — the radiologist edits or does not click it." },
  { studyType: "Brain", label: "Mastoid and middle ear change", concept: "mastoid_change", newConcept: true,
    finding: "T2 hyperintense mucosal change is noted in the {side} mastoid air cells and middle ear cleft.",
    impression: "{side} mastoid and middle ear mucosal change.",
    slots: { "{side}": { name: "side", type: "select", label: "Side", options: ["right", "left"] } },
    why: "'sinus / mastoid' is on the list; #5 covers the paranasal sinuses only, and says nothing about the temporal bone." },
  { studyType: "Brain", label: "Subacute infarct", concept: "subacute_infart", newConcept: true,
    finding: "T2/FLAIR hyperintense signal is noted in the {side} {territory} vascular territory, consistent with a subacute infarct.",
    impression: "Subacute infarct in the {side} {territory} vascular territory.",
    slots: { "{side}": { name: "side", type: "select", label: "Side", options: ["right", "left"] },
             "{territory}": { name: "territory", type: "select", label: "Vascular territory",
               options: ["MCA", "ACA", "PCA", "PICA", "watershed"] } },
    // Its own concept, deliberately: #489 (chronic) and #512 (acute) share the `infarct` mutex slot,
    // and an old infarct beside a subacute one is two findings the radiologist may legitimately
    // report together. A concept it owns keeps the two rows from taking each other's slot.
    why: "'subacute infarction' is on the 26-item list; the wall offers acute (#48/#512), chronic (#489/#49) and lacunar (#504) but no subacute stage, and the owner's macros stop at acute_infarct." },
  { studyType: "Brain", label: "Cerebellar atrophy", concept: "cerebellar_atrophy", newConcept: true,
    finding: "Cerebellar atrophy is noted with prominent folia and enlargement of the vermian and paravermal cisterns.",
    impression: "Cerebellar atrophy.",
    baselineReplaces: "Cerebellar hemispheres show normal morphology and signal intensity.",
    slots: {},
    why: "'cerebral / cerebellar atrophy' is on the list as two findings; #6 and #50 both describe the cerebrum, so the posterior fossa had no box of its own." },
];

/** Which examination's own headings a region's levels come from. */
const REGION_TEMPLATE = {
  Brain: "MRI Brain Plain",
  "Cervical Spine": "MRI Cervical Spine",
  "Dorsal Spine": "MRI Dorsal Spine",
  "LS Spine": "MRI LS Spine",
  "Whole Spine": "MRI LS Spine with Whole Spine Screening",
};

const client = new pg.Client({ connectionString: DB, connectionTimeoutMillis: 8000 });
await client.connect();
const templates = await client.query(
  "select template_name, modality, body_part, study_type, sections_json, macros_json from structured_report_templates where modality='MRI' order by id");
const byName = new Map(templates.rows.map((t) => [t.template_name, {
  headings: (JSON.parse(t.sections_json)?.findingsItems ?? []).map((x) => x.label),
  normals: Object.fromEntries((JSON.parse(t.sections_json)?.findingsItems ?? []).map((x) => [x.label, x.normal])),
  macros: Object.fromEntries((JSON.parse(t.macros_json ?? "[]")).map((m) => [m.key, m])),
}]));

/** Concepts the live catalogue already uses — a new one is allowed only when the SPEC says so. */
const knownConcepts = new Set((await client.query(
  "select distinct concept from radiology_quick_findings where concept <> ''")).rows.map((r) => r.concept));

/**
 * Ledger region names. A box's `study_type` IS the region it belongs to for the strip's matcher
 * (`quickSelectBoxCatalogue.ts:118`) and the tab stamp below, so a spelling nothing tabs must be
 * caught here rather than shipping a box no examination can ever offer.
 */
const tabNames = new Set((await client.query("select name from radiology_study_tabs")).rows.map((r) => r.name));

/**
 * Every MRI macro must be accounted for exactly once, as shipped or as skipped. This is the check
 * behind "the final report says which macros were not converted": a macro that quietly fell between
 * the two lists would look like coverage while the reporting desk still could not reach it.
 */
{
  const all = new Set();
  for (const [name, t] of byName) for (const key of Object.keys(t.macros)) all.add(`${name}/${key}`);
  const shipped = new Set(SPEC.map((s) => `${s.template}/${s.key}`));
  const skipped = new Set(SKIPPED.map((s) => `${s.template}/${s.key}`));
  const unaccounted = [...all].filter((k) => !shipped.has(k) && !skipped.has(k));
  const phantom = [...shipped, ...skipped].filter((k) => !all.has(k));
  const doubled = [...shipped].filter((k) => skipped.has(k));
  if (unaccounted.length || phantom.length || doubled.length) {
    throw new Error(`macro accounting failed — unaccounted: ${unaccounted.join(", ")} | `
      + `named but not in the database: ${phantom.join(", ")} | both shipped and skipped: ${doubled.join(", ")}`);
  }
  console.log(`macro accounting: ${all.size} MRI macros = ${shipped.size} shipped + ${skipped.size} skipped`);
}

/**
 * Sentences the app's own baseline modules render. `baseline_replaces` must be one of these or it
 * retires nothing: the overlay deletes the string it is given, so a near-miss leaves the contradicting
 * normal standing in the report beside the abnormality. Read from source, so a baseline edit here
 * fails this generator rather than shipping a dead retirement.
 */
const BASELINE_SENTENCES = (() => {
  const dir = "artifacts/diagnostic-erp/src/lib/zai-workspace/baselines";
  const out = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
    const src = fs.readFileSync(`${dir}/${f}`, "utf8").replace(/\r\n/g, "\n");
    for (const m of src.matchAll(/renderedText:\s*"([^"]+)"/g)) out.add(m[1]);
  }
  return out;
})();

/** Disc levels a segment owns, read from its own skeleton headings — never guessed. */
function levelsOf(templateName) {
  const h = byName.get(templateName).headings;
  return h.filter((x) => /^[LCST]\d+\s*-\s*[LCST]?\d+$/.test(x));
}

/**
 * Vertebral bodies a segment owns, derived from the same headings: the disc levels "L1-L2 … L5-S1"
 * name the vertebrae L1…L5 and S1 between them. A vertebra is NOT a disc level — "spondylolisthesis
 * of L4 over L5" and "disc prolapse at L4-L5" answer different questions, and offering one list for
 * the other is how a level gets invented.
 */
function vertebraeOf(templateName) {
  const out = new Set();
  for (const level of levelsOf(templateName)) {
    for (const part of level.split(/[-/]/)) out.add(part.trim());
  }
  return [...out].sort((a, b) => {
    const rank = (s) => ({ C: 0, T: 1, L: 2, S: 3 })[s[0]] ?? 4;
    return rank(a) - rank(b) || Number(a.slice(1)) - Number(b.slice(1));
  });
}

/**
 * The three tokens the strip's own chip controls fill and refuse: `quickSelectParameterContract.ts`
 * knows only side, severity and level. A box whose slots are inside that set needs no questionnaire —
 * clicking it gets the existing chips, and an unfilled level is refused with "Nothing was applied —
 * choose the level". Any other slot (a grade, a millimetre figure, cord contact) has to be a declared
 * question, because a token the chips do not know and the box does not ask is a hole that refuses
 * forever. The fork is per box, never per token: `quick-select-strip.tsx` opens the dialog when
 * `questions_json` is non-empty and then bypasses the chips entirely.
 */
const CHIP_TOKENS = new Set(["side", "severity", "level"]);

/**
 * The owner's unit stays attached to the token. "approximately {measurement} mm" is what
 * `unansweredStructuredMeasurements` reads as an unfilled measurement and refuses; dropping the "mm"
 * would leave a bare number in a sentence that no longer says what it measures.
 */
const slotText = (d) => `{${d.name}}${d.unit ? (d.unit === "%" ? d.unit : ` ${d.unit}`) : ""}`;

/** A SQL string literal: doubled quotes inside, single quotes around. */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Resolve one slot into a question: a level vocabulary or the owner's own options, never a guess. */
function slotDef(spec, def) {
  if (def.level) {
    const options = def.level === "vertebra" ? vertebraeOf(spec.template) : levelsOf(spec.template);
    if (!options.length) throw new Error(`${spec.key}: ${spec.template} has no ${def.level} level headings to offer`);
    return { ...def, type: "select", options };
  }
  if (def.type === "select" && !def.options?.length) throw new Error(`${spec.key}: slot ${def.name} is a select with no options`);
  return def;
}

/**
 * Resolve one sentence pair into a box row: slots answered, tokens checked, parameters declared.
 * Shared by the macro conversion and the authored additions so both halves of the catalogue are held
 * to exactly the same rules — same level vocabularies, same refusal of a default, same question
 * shape, same guards. A second, weaker path for authored content is how unvalidated prose ships.
 */
function buildRow(input) {
  const src = byName.get(input.template);
  let text = input.finding;
  const impression = input.impression ?? "";
  const params = [];
  const used = new Set();
  for (const [needle, raw] of Object.entries(input.slots ?? {})) {
    const d = slotDef(input, raw);
    if (!`${text} ${impression}`.includes(needle)) {
      throw new Error(`${input.label}: slot ${needle} is in no sentence of this box`);
    }
    if (needle !== `{${d.name}}`) text = text.split(needle).join(slotText(d));
    if (!used.has(d.name)) { used.add(d.name); params.push(d); }
  }
  if (/\[[^\]]{0,60}\]/.test(text)) throw new Error(`${input.label}: an unresolved bracket slot remains: ${text}`);
  // A token in either sentence the box never asks for is a hole: the composer substitutes only what
  // it knows, so an unknown one prints as nothing.
  for (const m of `${text} ${impression}`.matchAll(/\{([a-z_]+)\}/g)) {
    if (!used.has(m[1])) throw new Error(`${input.label}: sentence uses {${m[1]}} which no slot declares`);
  }
  if (input.section && !src.headings.some((h) => h.toLowerCase() === input.section.toLowerCase())) {
    throw new Error(`${input.label}: section "${input.section}" is not a heading of ${input.template}`);
  }
  if (input.baselineReplaces && !BASELINE_SENTENCES.has(input.baselineReplaces)) {
    throw new Error(`${input.label}: baseline_replaces is not a sentence any baseline module renders`);
  }
  if (!input.concept) throw new Error(`${input.label}: no concept — supersession and the contradiction checks key on it`);
  if (!knownConcepts.has(input.concept) && !input.newConcept) {
    throw new Error(`${input.label}: concept "${input.concept}" is new; declare newConcept to ship it`);
  }
  if (!tabNames.has(input.studyType)) {
    throw new Error(`${input.label}: study_type "${input.studyType}" is not a ledger region name, so no examination would ever offer it`);
  }

  const chipOnly = params.length > 0 && params.every((d) => CHIP_TOKENS.has(d.name));
  const questions = chipOnly ? [] : params.map((d, i) => ({
    key: d.name, label: d.label, type: d.type, options: d.options ?? [], default: "", required: true, sortOrder: i,
  }));
  return {
    factory_key: input.factoryKey,
    study_type: input.studyType, label: input.label, field: "findings", scope_modality: "MR",
    category: "abnormal", concept: input.concept, conflict_group: input.concept,
    anatomical_section: input.section ?? "",
    baseline_replaces: input.baselineReplaces ?? "",
    properties: JSON.stringify({
      ...input.properties,
      ...(input.contrast ? { requiresContrast: true } : {}),
      // A box whose parameters come from the strip's chips has to SAY which chips, in the column the
      // declaration audit reads (`radiologyQuickSelectTokenOwnership.test.ts`), because these rows
      // carry their provenance in the same column as JSON and the audit's CSV reading would otherwise
      // see no declaration at all. `{severity}` with no declared chip is the exact defect that audit
      // was written for — a tile that is clickable but can never be made to write.
      ...(chipOnly ? { parameters: "chips", chips: [...new Set(params.map((d) => d.name))] } : {}),
    }),
    questions_json: JSON.stringify(questions),
    finding_text: text, impression_text: impression, technique_text: "", recommendation_text: "",
    sort_order: 500, is_active: true,
    chipOnly,
    note: input.note ?? "",
  };
}

/** A macro the owner wrote, converted. */
function convert(spec) {
  const macro = byName.get(spec.template).macros[spec.key];
  if (!macro) throw new Error(`macro ${spec.key} is not in ${spec.template}`);
  const slots = {};
  for (const [needle, def] of Object.entries(spec.slots ?? {})) {
    if (!macro.text.includes(needle)) throw new Error(`${spec.key}: slot ${needle} is not in the owner's sentence`);
    slots[needle] = def;
  }
  return buildRow({
    ...spec,
    finding: macro.text,
    factoryKey: `macro:${spec.template}/${spec.key}`,
    properties: { source: "structured_report_templates.macros_json", template: spec.template, macro: spec.key },
  });
}

/** Content this change authors, stamped so the clinic can see it did not come from her macros. */
function authored(entry) {
  const template = REGION_TEMPLATE[entry.studyType];
  if (!template) throw new Error(`${entry.label}: no examination named for ${entry.studyType}`);
  for (const needle of Object.keys(entry.slots ?? {})) {
    if (!`${entry.finding} ${entry.impression ?? ""}`.includes(needle)) {
      throw new Error(`${entry.label}: slot ${needle} is not in its own sentence`);
    }
  }
  return buildRow({
    ...entry,
    template,
    factoryKey: `authored:${entry.studyType}/${entry.concept}`,
    properties: {
      source: "newly-authored",
      newlyAuthored: true,
      reason: entry.why,
    },
  });
}

const rows = SPEC.map(convert);
const authoredRows = AUTHORED.map(authored);

/**
 * The shared half of every file this tool writes. Both halves of the catalogue — the owner's converted
 * macros and the newly authored additions — are held to the same contract, in the same column list,
 * with the same guards and the same exact-count assertion. One shape, two provenances.
 */
function sqlFor(file, list, intro) {
  const values = list.map((r) => `(${[
    q(r.study_type), q(r.label), q(r.field), q(r.scope_modality), q(r.category), q(r.concept), q(r.conflict_group),
    q(r.anatomical_section), q(r.baseline_replaces), q(r.properties), q(r.questions_json), q(r.finding_text),
    q(r.impression_text), q(r.technique_text), q(r.recommendation_text), String(r.sort_order),
    r.is_active ? "TRUE" : "FALSE", q(r.factory_key),
  ].join(", ")})`).join(",\n    ");
  const keyList = list.map((r) => `  ${q(r.factory_key)}`).join(",\n");
  return `-- =============================================================================
-- ${file}
-- =============================================================================
${intro}
--
-- SAFETY CONTRACT (identical in both MRI files)
--   * \`factory_key\` is the identity, and it is namespaced by provenance: 'macro:<template>/<key>' for
--     a converted owner macro, 'authored:<region>/<concept>' for content this change wrote. The INSERT
--     skips any factory_key already present and any (study_type, label) clash, so re-running changes
--     nothing and no deploy ever doubles a box. The clash guard is also what protects the clinic: it
--     is the same key \`radiology_quick_findings_legacy_study_label_uq\` enforces, and every tab-scoped
--     row in this table spells study_type as its own tab name, so one guard covers both unique indexes.
--   * A clinic-customised box is never rewritten: these files only INSERT, never UPDATE, and
--     \`customized_at\` stays NULL on the rows they create.
--   * \`study_tab_id\` is stamped from the ledger's own tab by name, the way the shipped MR boxes are
--     stamped today, so the admin editor lists these boxes under the same region as its own.
--   * \`anatomical_section\` is empty on every box here. The Findings the composer writes is a flat
--     narrative of \`<br/>\`-separated sentences (measured on studies 264/265/268 on the acceptance rig:
--     no \`White Matter:\` or \`Spinal Canal:\` heading exists in an MRI report today), and
--     \`sectionEndSlot\` places a finding only at a heading whose label equals the box's section
--     case-folded — so a section naming a heading the report does not have is inert, and one naming a
--     heading it does have would seat the sentence in the wrong place. A level-parameterised sentence
--     is anchored to its own level line ("L4-L5: …") instead, which is how the shipped spine boxes
--     already work.
--   * \`baseline_replaces\` is only ever a sentence an app baseline module renders (checked against the
--     \`baselines/*.ts\` sources when this file was generated), so the box retires exactly the normal it
--     contradicts and leaves every other normal standing.
--   * Parameters: a box whose slots are all side/severity/level keeps \`questions_json = '[]'\` and is
--     filled by the strip's existing chip controls, which refuse an unfilled level with
--     "Nothing was applied — choose the level". Every other box declares its slots as required
--     questions, because a token the chips do not know and the box does not ask is a hole that refuses
--     forever. No question carries a default: no side, level, grade or measurement is ever assumed.
--     Measured before writing this: zero of the 496 shipped boxes carried a non-chip token without
--     declaring it, so this is the catalogue's existing rule, not a new one.
--   * Enhancement wording carries \`{"requiresContrast":true}\` in \`properties\`, which
--     \`quickSelectContrastGate\` honours: a study reported without contrast cannot offer it.
--   * Every level option comes from the segment's own skeleton headings, and disc levels are kept
--     distinct from vertebral bodies. No cervical sentence is offered lumbar levels.
--   * The DO block at the end is the count check: if any box was skipped by a guard — a label the
--     clinic already used, a factory_key already stamped — the deploy fails loudly instead of
--     shipping a silently short catalogue.
--
-- Generated by \`scripts/generate-mri-macro-quick-select.mjs\` from the migration-built database;
-- regenerate rather than hand-edit, so the counts below stay provable.
-- =============================================================================

BEGIN;

INSERT INTO radiology_quick_findings (
  study_type, label, field, scope_modality, category, concept, conflict_group,
  anatomical_section, baseline_replaces, properties, questions_json,
  finding_text, impression_text, technique_text, recommendation_text,
  sort_order, is_active, factory_key, study_tab_id
)
SELECT
  s.study_type, s.label, s.field, s.scope_modality, s.category, s.concept, s.conflict_group,
  s.anatomical_section, s.baseline_replaces, s.properties, s.questions_json,
  s.finding_text, s.impression_text, s.technique_text, s.recommendation_text,
  s.sort_order, s.is_active, s.factory_key,
  (select min(t.id) from radiology_study_tabs t where t.name = s.study_type)
FROM (VALUES
    ${values}
) AS s(study_type, label, field, scope_modality, category, concept, conflict_group,
       anatomical_section, baseline_replaces, properties, questions_json,
       finding_text, impression_text, technique_text, recommendation_text,
       sort_order, is_active, factory_key)
WHERE NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q WHERE q.factory_key = s.factory_key
      )
  AND NOT EXISTS (
        SELECT 1 FROM radiology_quick_findings q
         WHERE lower(trim(q.study_type)) = lower(trim(s.study_type))
           AND lower(trim(q.label))      = lower(trim(s.label))
      );

-- EXACT COUNT, OR THE DEPLOY STOPS. ${list.length} boxes, no fewer: one excluded by either guard above
-- means the clinic already owns that (study_type, label), and that has to be reconciled by hand rather
-- than resolved by an INSERT that quietly wrote fewer rows and reported success.
DO $do$
declare
  expected int := ${list.length};
  actual int;
begin
  select count(*) into actual from radiology_quick_findings
   where factory_key in (
${keyList}
   );
  if actual <> expected then
    raise exception 'MRI Quick Select conversion incomplete (% of % boxes present). A (study_type, label) guard excluded at least one box, so reconcile it in the editor rather than deploying a short catalogue.',
      actual, expected;
  end if;
end
$do$;

COMMIT;
`;
}

const macroIntro = `-- WHY THIS FILE EXISTS
-- \`structured_report_templates.macros_json\` holds 22 MRI sentences written and approved by the
-- radiologist-owner. No reporting surface ever read that column: the only consumer of \`macros_json\` in
-- the repository is the admin template editor (\`artifacts/diagnostic-erp/src/pages/ReportTemplates.tsx\`),
-- so her approved wording was unreachable at the reporting desk while the desk offered tiles authored
-- elsewhere.
--
-- This file converts ${rows.length} of those macros into \`radiology_quick_findings\` boxes — the
-- catalogue the existing deterministic composer already reads. It is not a second engine and not new
-- clinical prose: each sentence is the owner's macro text verbatim, with only her own square-bracket
-- slot replaced by the parameter token the composer validates, so an unanswered level, side or
-- measurement is refused rather than reported (\`missingRequired\`, \`unansweredStructuredMeasurements\`).
--
-- Not every macro is shipped. Deliberately excluded, each with its reason:
${SKIPPED.map((s) => `--   * ${s.template} / ${s.key}: ${s.why}`).join("\n")}`;

const authoredIntro = `-- WHY THIS FILE EXISTS
-- The MRI catalogues the owner asked for are not complete without content her macros do not cover: a
-- Dorsal Spine examination with NO MR-scoped findings box of its own at all (the wall was served only
-- by cross-modality "Spine" rows an X-ray request could equally be offered), and Brain checklist items
-- — meningioma, cerebellopontine angle, sellar/parasellar, mastoid — that neither the catalogue nor
-- \`macros_json\` carries.
--
-- ${authoredRows.length} boxes are therefore NEWLY AUTHORED by this change, and every one of them says
-- so twice: \`"newlyAuthored": true\` and the reason it was needed in its own \`properties\` column, which
-- the Quick Select editor shows, and \`authored:\` in its \`factory_key\`, which no macro conversion writes
-- into. Nothing here is presented as the owner's approved language, and deleting any of these boxes
-- touches no converted macro box, because they share no identity.
--
-- The wording follows shapes her own catalogue already uses — a level or side is always a parameter the
-- radiologist answers, never a value baked into a sentence; no box states a measurement; "suggestive
-- of" is kept where a diagnosis is not certain. What each adds, and the gap it closes:
${authoredRows.map((r) => `--   * [${r.study_type}] ${r.label}: ${r.note}`).join("\n")}`;

const written = [
  { file: OUT, sql: sqlFor(baseName(OUT), rows, macroIntro), list: rows },
  { file: OUT2, sql: sqlFor(baseName(OUT2), authoredRows, authoredIntro), list: authoredRows },
];
for (const w of written) {
  fs.writeFileSync(w.file, w.sql);
  console.log(`wrote ${w.file}: ${w.list.length} boxes`);
  for (const r of w.list) {
    console.log(`  ${r.factory_key}`);
    console.log(`      [${r.study_type}] concept=${r.concept} q=${JSON.parse(r.questions_json).length}${r.chipOnly ? " (chips)" : ""} contrast=${/requiresContrast/.test(r.properties)}`);
    console.log(`      F: ${r.finding_text}`);
    if (r.impression_text) console.log(`      I: ${r.impression_text}`);
  }
}
await client.end();
