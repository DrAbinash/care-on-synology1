// text/clinicalTerms.ts — the curated clinical vocabulary and the clause-level
// negation and uncertainty reading that every findings-vs-impression
// contradiction rule shares.
//
// Why this exists: those rules were doing plain substring searches, so
//   • "No acute intracranial haemorrhage" counted as a haemorrhage,
//   • "Normal MRI of the cervical spine" was invisible to a rule that only knew
//     the literal "normal study", and
//   • "haemorrhage" — what this clinic writes — never matched a rule that only
//     knew "hemorrhage", while its own PATHOLOGY_WORDS carried both spellings.
// That is the whole Q103/Q113/Q114 problem class. The reading happens once, here,
// and both the canonical text tier (./evaluate.ts) and the live workspace
// validator (artifacts/diagnostic-erp/src/lib/reportValidator.ts) import it, so
// the two cannot drift apart — reportQualityShadow.test.ts asserts they agree
// message for message.

/** A vocabulary entry: `label` is what a warning names, `pattern` how it matches. */
export type ClinicalTerm = { readonly label: string; readonly pattern: string };

/**
 * A named diagnosis, plus the words that describe the organ it inflames or
 * the tissue it arises in. `grounds` exists because an inflammatory diagnosis
 * is very often written as anatomy: this clinic's own appendicitis report
 * describes "a dilated blind-ending tubular structure in the right iliac fossa
 * ... with a calcified appendicolith and periappendiceal fat stranding" and
 * never spells the word "appendicitis" in Findings. That is a conclusion drawn
 * from what was examined. Naming an organ the report never mentions at all is
 * the defect Q117 is for, and nothing else.
 */
export type NamedDiagnosis = ClinicalTerm & { readonly grounds?: string };

/**
 * Abnormalities a radiology report can assert, in both British and American
 * spelling, across the systems this clinic reports. Excluded on purpose:
 * wording that describes normal anatomy ("alignment", "densities"), benign-only
 * entities ("cyst", kept for the mammography rule's own list) and anything
 * contrast-related (Q112 owns contrast).
 *
 * The "both spellings" claim above is what the haemorrhage fix bought, and it was
 * still untrue of three entries — found by running a British/American pair table
 * through the vocabulary rather than by reading it. "ischaemia" knew only
 * `ischaemi*`, so the American "ischemia"/"ischemic" written by SIX of the clinic's
 * own canned brain formats — eight sections between them, including both Findings
 * and Impression of the Fazekas 2 and Fazekas 3 templates — was invisible to
 * Q103/Q113/Q114; "empyema" knew only the American spelling, the mirror image of
 * the original defect; and "herniation" hard-coded `disc extrusion` while the
 * `intervertebral disc` entry further down this same table already wrote
 * `disc|disk`. All three were measured as zero-collateral widenings: over every
 * correct report in the repository — 58 shipped formats × 5 sections, 20
 * golden-corpus reports × 5 sections, and the catalogue seed prose — the only new
 * matches are those eight "ischemic" sections, and nothing stopped matching.
 *
 * A spelling gap is the quietest kind: it does not mark up a correct report, so no
 * radiologist ever complains, and the report that needed reading was written in the
 * other spelling. It is measured by the pair table in ./clinicalTerms.test.ts,
 * which fails when the two halves of a pair disagree.
 */
export const ABNORMAL_TERMS: readonly ClinicalTerm[] = [
  // brain and cerebrovascular
  { label: "infarct", pattern: String.raw`\binfarct\w*` },
  { label: "haemorrhage", pattern: String.raw`\b(?:ha?emorrhage|ha?ematom\w*|ha?atemesis|bleed|bleeding)\b` },
  { label: "extra-axial collection", pattern: String.raw`\bsub(?:dural|arachnoid)\b|\bextradural\b|\bepidural\b` },
  { label: "midline shift", pattern: String.raw`\bmidline shift\b` },
  { label: "mass effect", pattern: String.raw`\bmass effect\b` },
  { label: "hydrocephalus", pattern: String.raw`\b(?:hydrocephalus|ventriculomegaly|transependymal)\b` },
  { label: "ischaemia", pattern: String.raw`\b(?:is|hae)mi(?:c|a)\b|\bisch(?:ae|e)mi\w*` },
  { label: "demyelination", pattern: String.raw`\bdemyelin\w*|\bplaque\b|\bdisc demyelination\b` },
  { label: "oedema", pattern: String.raw`\b(?:oe|e)dema\b` },
  { label: "atrophy", pattern: String.raw`\batrophi\w*|\batroph\w*` },
  { label: "gliosis", pattern: String.raw`\bgliosis\b|\bgliotic\b|\bencephalomalacia\b` },

  // spine
  { label: "herniation", pattern: String.raw`\bherniat\w*|\b(?:disc|disk) extrusion\b|\bsequestrat\w*` },
  { label: "protrusion", pattern: String.raw`\bprotrusi\w*` },
  { label: "disc bulge", pattern: String.raw`\bbulge\w*|\bbulgi\w*` },
  { label: "stenosis", pattern: String.raw`\bstenos\w*|\bnarrowing\b` },
  // Read bare, so it also labels a compression FRACTURE ("wedge compression
  // collapse"), a mammographic POSITION ("confirmed on spot compression") and a
  // Doppler TECHNIQUE ("compression ultrasonography") as a cord compression. Seven
  // sections of correct prose read that way — three of them Technique, which no rule
  // passes here, one of them genuinely a cord, and three of them the imprecise
  // label. Left alone on measurement: no correct report in the repository emits a
  // Q103/Q113/Q114 message at all (0 of 58 formats, 0 of 20 corpus reports), so the
  // wrong word never reaches a radiologist, and excluding "compression
  // collapse|deformity" would leave the two fracture formats asserting nothing —
  // `fracture` needs the word "fracture", which the Findings clause does not
  // contain. Narrowing this is owed a detection it buys, not a label it prettifies.
  { label: "cord compression", pattern: String.raw`\bcompress(?:ion|ing|ed)\b|\bimpingement\b|\bthecal sac indentation\b` },
  { label: "myelopathy", pattern: String.raw`\b(?:myelopath|myelomalaci)\w*|\bcord oedema\b|\bcord edema\b` },
  { label: "nerve root involvement", pattern: String.raw`\bradiculopath\w*|\b(?:nerve )?root (?:contact|compression|impinge\w*)\b` },
  { label: "spondylolisthesis", pattern: String.raw`\bspondylolisthe\w*|\bspondyloptosis\b|\bisthmic\b` },
  { label: "infection", pattern: String.raw`\bspondylodiscit\w*|\bdiscitis\b|\bosteomyelit\w*|\bdisc infection\b|\btubercul\w*|\babscess\b` },
  { label: "fracture", pattern: String.raw`\bfractur\w*|\bsubluxation\b|\bdislocation\b|\bcompression fracture\b` },
  { label: "destructive lesion", pattern: String.raw`\bdestructive (?:lesion|change)\b|\blytic\b|\bmetastatic deposit\b` },

  // body, abdomen and soft tissue
  { label: "lesion", pattern: String.raw`\blesion\w*` },
  { label: "mass", pattern: String.raw`\bmass(?:es)?\b(?![a-z])` },
  { label: "tumour", pattern: String.raw`\b(?:tumor|tumour|neoplasm|nodule|nodular|deposit)\w*` },
  { label: "metastasis", pattern: String.raw`\bmetasta\w*|\bcarcinomatosis\b|\bsecondaries\b` },
  { label: "malignancy", pattern: String.raw`\bmalignan\w*|\b(?:carcinoma|lymphoma|sarcoma|myeloma|melanoma)\b` },
  { label: "collection", pattern: String.raw`\bcollection\w*|\bempya?ema\b` },
  { label: "fluid", pattern: String.raw`\bfree fluid\b|\bascites\b|\beffusion\w*` },
  { label: "stone", pattern: String.raw`\bstone\w*|\bgallstone\w*|\brenal stone\b|\bcalculus\b|\bcalculi\b|\blithiasis\b|\blith\b|\bappendicolith\w*` },
  { label: "obstruction", pattern: String.raw`\bobstruct\w*|\bocclus\w*|\bvolvulus\b|\bilus\b|\bnon-?compressibl\w*|\bnot compressible\b` },
  { label: "dilatation", pattern: String.raw`\bdilat\w*|\bdistension\b|\bhydroureter\b` },
  // "thickness" is what you MEASURE and "thickened" is what you SEE, and the old
  // `\bthick(?:en|ening|ness)\b` had them exactly backwards: it matched the
  // dimension noun and missed the past participle, because `\bthicken\b` demands a
  // boundary that "-ed" closes. So "Gallbladder is normal in size and wall
  // thickness" — a NORMAL declaration — asserted a wall thickening, while "the
  // gallbladder wall is thickened" asserted nothing.
  //
  // That reached a radiologist. `observationLedger.ts` arms the Impression
  // dependency when `assertedAbnormality(findings) !== null &&
  // assertsStudyNormal(impression)`, and running that predicate over all 58 shipped
  // formats gave 1 of 58 arming on its own untouched prose — `US Abdomen — Normal`,
  // with `asserted="wall thickening"`. After this change 0 of 58 do. So every use of
  // that format asked the radiologist to refresh or override an Impression the
  // format itself had just written.
  //
  // The noun is dropped outright rather than graded, and that is a measurement, not
  // a preference. Every "thick*" clause in the repository's correct prose — 58
  // shipped formats × 5 sections plus 20 golden-corpus reports × 5 sections, 16
  // clauses in all — was printed and read: each true finding used the gerund
  // ("wall thickening", "cortical thickening", "soft tissue thickening"), and each
  // bare "thickness" was either a normal declaration ("normal in size and cortical
  // thickness", "Gallbladder wall thickness is normal", "Normal size and wall
  // thickness (< 3 mm)") or a measurement ("maximum thickness 12 mm"). Not one used
  // the noun as the finding. Putting the old pattern back and diffing the two reads
  // gives 5 correct sections that stop being a wall thickening and 0 that start.
  // The participle "thickened" appears nowhere in shipped prose, so that half of the
  // inversion had no instance here — but it is how the finding is ordinarily stated,
  // and `\bthicken\b` cannot read it because "-ed" closes the boundary.
  //
  // A lookahead that kept the noun when a graded word followed it
  // (`thickness(?=[^.;\n]{0,32}\b(?:increas|gross|marked|significan|abnormal)\w*)`)
  // was implemented and then removed, because it read two correct normals as
  // findings: "Gallbladder wall thickness: no significant abnormality." and
  // "…measures 3 mm, which is not abnormal." both fired. The negation reader cannot
  // rescue them — DENIAL_BEFORE only sees text before the term, and DENIAL_AFTER
  // recognises "not seen/excluded/ruled out", not a bare "no" or "not" — so any
  // adjective allowed after the noun is also allowed after "not". Bare "thick"
  // stays unmatched for the same reason it always was: it is the acquisition
  // adjective ("5 mm thick slices", "thick-slab MIP").
  { label: "wall thickening", pattern: String.raw`\bthicken\w*` },
  { label: "fat stranding", pattern: String.raw`\bstranding\b|\b(?:hyperaemia|hyperemia)\b|\bfat proliferation\b` },
  { label: "inflammation", pattern: String.raw`\b(?:appendicitis|cholecystitis|cholangitis|pancreatitis|diverticulitis|enteritis|colitis|gastritis|peritonitis|pyelonephritis|salpingitis|orchitis|encephalitis|meningitis|cellulitis|nephritis)\b` },
  { label: "perforation", pattern: String.raw`\bperforat\w*|\bpneumoperitoneum\b|\bfree (?:gas|air)\b|\bpneumothorax\b|\bpneumomediastinum\b` },
  { label: "chronic parenchymal change", pattern: String.raw`\bfibros\w*|\bcirrhos\w*|\bsteatos\w*|\bcalcific atherosclerosis\b` },
  { label: "organomegaly", pattern: String.raw`\b(?:hepato|spleno|cardio|reno|thyroid|prosto)megaly\b|\benlarged (?:liver|spleen|heart|kidney|prostate|uterus)\b` },
  { label: "lymphadenopathy", pattern: String.raw`\blymphadenopath\w*|\benlarged lymph nodes\b|\blap\b` },
  { label: "sclerosis", pattern: String.raw`\bscleros\w*` },
  { label: "calcification", pattern: String.raw`\b(?:micro|macro)?calcifi\w*` },
  { label: "consolidation", pattern: String.raw`\bconsolidat\w*|\binfiltrat\w*|\batelectas\w*|\bground[- ]glass\b|\bemphysemat\w*` },

  // breast
  { label: "suspicious breast lesion", pattern: String.raw`\bspiculat\w*|\barchitectural distortion\b|\bnipple retraction\b|\bdominant mass\b|\bgrouped microcalcification\w*` },

  // vascular and Doppler
  { label: "thrombus", pattern: String.raw`\b(?:thrombus|thrombi|thrombos\w*|thrombotic)\b|\bdvt\b` },
  { label: "embolism", pattern: String.raw`\b(?:embolus|emboli|embolism)\w*` },
  { label: "aneurysm", pattern: String.raw`\b(?:aneurysm|pseudoaneurysm|ectasia|dissection)\w*` },
  { label: "venous reflux", pattern: String.raw`\breflux\b|\bincompeten\w*|\bvaricositi\w*|\bvarices\b` },
] as const;

/**
 * Mammography wording that makes a finding *suspicious*. Narrower than
 * {@link ABNORMAL_TERMS} by design: a BI-RADS 2 sitting beside a benign-looking
 * entity is not a contradiction, so only worrying wording arms the downgrade
 * check.
 */
export const SUSPICIOUS_TERMS: readonly ClinicalTerm[] = [
  { label: "spiculation", pattern: String.raw`\bspiculat\w*` },
  { label: "suspicion", pattern: String.raw`\bsuspici\w*` },
  { label: "microcalcification", pattern: String.raw`\b(?:micro|grouped|clustered|pleomorphic)[ -]?calcif\w*|\bmicrocalcification\w*` },
  { label: "architectural distortion", pattern: String.raw`\barchitectural distortion\b` },
  { label: "dominant mass", pattern: String.raw`\bdominant mass\b|\bnew (?:mass|asymmetry)\b` },
  { label: "suspicious node", pattern: String.raw`\b(?:loss of the fatty hilum|morphologically (?:abnormal|suspicious)|suspicious (?:axillary )?nodes?)\b` },
] as const;
// Skin thickening, nipple retraction and increased density are deliberately NOT
// here: in BI-RADS usage they are signs only in context — a retraction that is
// unchanged after surgery or long-standing asymmetry is reported with a benign
// category every day. A rule that called those a contradiction would mark up
// routine reports, and the mammography rule has to keep its credibility.

/** Lesion wording that can support a stated BI-RADS assessment. */
export const NAMED_LESION_TERMS: readonly ClinicalTerm[] = [
  { label: "lesion", pattern: String.raw`\blesion\w*|\bmass(?:es)?\b(?![a-z])|\bnodule\w*|\bcyst\w*|\bcalcification\w*|\bthickening\b` },
] as const;

/**
 * The anatomy that PLACES a finding, as canonical site names.
 *
 * {@link ABNORMAL_TERMS} says what was found; this says where. Both are needed
 * because one label spans several organs, and reading a label with no site
 * attached reports contradictions that are not there. The measured case is MRCP:
 * Findings "the gallbladder contains multiple stones" beside Impression "no common
 * bile duct stone" is one correct report — gallstones with a clear duct is the
 * commonest MRCP result there is — but both mentions carry the label "stone", so
 * the pair read as a denial contradicting an assertion.
 *
 * Sites fold to a canonical name, so "biliary", "CBD" and "bile duct" are one
 * place rather than three wordings of it. The list is deliberately incomplete and
 * errs towards saying nothing: a sentence naming no site here yields an empty set,
 * and an empty set never separates two mentions, so unrecognised anatomy leaves a
 * rule exactly as strict as it was before this list existed. Growing it can only
 * reduce false positives — it cannot create one.
 *
 * Ambiguous wordings are excluded rather than guessed at. Bare "sinus" is left out
 * because it is a paranasal sinus in the head, a renal sinus in the abdomen and a
 * dural venous sinus in a thrombosis report; bare "cord", "medulla" and "lobe" are
 * left out for the same reason.
 */
export const ANATOMICAL_SITE_TERMS: readonly ClinicalTerm[] = [
  // head and neck
  { label: "brain", pattern: String.raw`\b(?:brain\w*|cerebr\w*|cerebell\w*|hemispher\w*|brainstem|pons|midbrain|medulla oblongata|thalam\w*|basal gangli\w*|corona radiata|centrum semiovale|internal capsule|white matter|grey matter|gray matter)\b` },
  // Deliberately inside "brain" as well as beside it. Two mentions that both name
  // the basal ganglia share "brain" already, so this label cannot make a pair look
  // like different anatomy — it can only say which of the brain's structures a
  // mention is about, which is what Q122 needs to tell a bleed in the basal ganglia
  // from a subdural one in the same report.
  { label: "basal ganglia", pattern: String.raw`\bbasal gangli\w*\b` },
  { label: "extra-axial space", pattern: String.raw`\b(?:subdural|extradural|epidural|subarachnoid|extra-?axial|mening\w*|falx|tentorium)\b` },
  { label: "ventricular system", pattern: String.raw`\b(?:ventricl\w*|cistern\w*|choroid plexus)\b` },
  { label: "orbit", pattern: String.raw`\b(?:orbit\w*|globe|retrobulbar|extraocular|optic nerve)\b` },
  { label: "paranasal sinuses", pattern: String.raw`\b(?:paranasal|maxillary|ethmoid\w*|sphenoid|mastoid\w*|middle ear|petrous|temporal bone|nasal)\b` },
  { label: "sella", pattern: String.raw`\b(?:sella|pituitary|hypophys\w*)\b` },
  { label: "neck", pattern: String.raw`\b(?:neck|thyroid|parotid|submandibular|pharyn\w*|laryn\w*|tonsil\w*)\b` },

  // spine
  { label: "spinal canal", pattern: String.raw`\b(?:spinal canal|central canal|spinal stenosis|thecal sac|dural sac|spinal cord|medulla spinalis)\b` },
  { label: "neural foramen", pattern: String.raw`\b(?:foram\w*|neuroforam\w*|nerve root|root sleeve|exiting root)\b` },
  { label: "intervertebral disc", pattern: String.raw`\b(?:disc|disk|disc\w*|intervertebral|annulus|nucleus pulposus)\b` },
  { label: "vertebra", pattern: String.raw`\b(?:vertebral body|vertebrae|vertebra|endplate\w*|pedicle\w*|lamina\w*|spinous process|transverse process|facet\w*|pars interarticularis|sacrum|sacral|coccyx)\b` },
  { label: "paraspinal soft tissue", pattern: String.raw`\b(?:paraspinal|paravertebral|prevertebral|retropharyngeal|posterior elements)\b` },

  // chest
  { label: "lung", pattern: String.raw`\b(?:lung\w*|pulmonary (?!arter|vein)\w*|upper lobe|middle lobe|lower lobe|lobar|lingula|bronch\w*|air ?space\w*|alveol\w*)\b` },
  { label: "pleura", pattern: String.raw`\b(?:pleura|pleural|costophrenic)\b` },
  { label: "mediastinum", pattern: String.raw`\b(?:mediastin\w*|hilum|hilar|carina)\b` },
  { label: "heart", pattern: String.raw`\b(?:heart|cardiac|pericard\w*|myocard\w*|(?:left|right) ventricle|ventricular septum|atrium|atria|coronary)\b` },
  { label: "aorta", pattern: String.raw`\b(?:aorta|aortic)\b` },
  { label: "chest wall", pattern: String.raw`\b(?:chest wall|ribs?|clavicle|scapula|sternum|costal|thoracic cage)\b` },
  { label: "diaphragm", pattern: String.raw`\b(?:diaphragm\w*|subdiaphragmatic|subphrenic)\b` },

  // abdomen and pelvis
  { label: "liver", pattern: String.raw`\b(?:liver|hepatic|hepat\w*)\b` },
  { label: "gallbladder", pattern: String.raw`\b(?:gall ?bladder\w*|cholecyst\w*)\b` },
  { label: "bile duct", pattern: String.raw`\b(?:bile duct\w*|biliary|cbd|hepatic duct\w*|cystic duct|ampulla\w*|periampullary|cholangio\w*)\b` },
  { label: "pancreas", pattern: String.raw`\b(?:pancrea\w*|wirsung)\b` },
  { label: "spleen", pattern: String.raw`\b(?:spleen|splenic)\b` },
  { label: "kidney", pattern: String.raw`\b(?:kidney\w*|renal|nephro\w*)\b` },
  { label: "ureter", pattern: String.raw`\b(?:ureter\w*|pelvicalyceal|pelviureter\w*|vesicoureter\w*)\b` },
  { label: "bladder", pattern: String.raw`\b(?:urinary bladder|bladder|urethra\w*|prostate|prostatic)\b` },
  { label: "pelvic organs", pattern: String.raw`\b(?:uter\w*|endometri\w*|ovar\w*|adnex\w*|vagina\w*|cervix uteri)\b` },
  { label: "adrenal", pattern: String.raw`\b(?:adrenal|suprarenal)\b` },
  { label: "bowel", pattern: String.raw`\b(?:bowel|intestinal|colon\w*|caecum|cecum|appendi\w*|rectum|rectal|rectosigmoid|sigmoid\w*|duoden\w*|jejun\w*|ileum|ileal|ileo\w*|stomach|gastric|oesophag\w*|esophag\w*)\b` },
  { label: "peritoneum", pattern: String.raw`\b(?:peritone\w*|mesenter\w*|omentum\w*|retroperitone\w*|pouch of douglas)\b` },
  { label: "abdominal wall", pattern: String.raw`\b(?:abdominal wall|flank|groin|inguinal|umbilic\w*)\b` },
  { label: "lymph nodes", pattern: String.raw`\b(?:lymph node\w*|nodal|lymphatic)\b` },

  // breast
  { label: "breast", pattern: String.raw`\b(?:breast\w*|mamm\w*|retroareolar|areola\w*|nipple\w*|quadrant)\b` },
  { label: "axilla", pattern: String.raw`\b(?:axilla|axillary)\b` },

  // vascular, limb and soft tissue
  { label: "deep veins", pattern: String.raw`\b(?:deep vein\w*|deep venous|common femoral|femoral vein\w*|popliteal vein\w*|iliac vein\w*|tibial vein\w*|peroneal vein\w*|gastrocnemius|soleal|dvt)\b` },
  { label: "superficial veins", pattern: String.raw`\b(?:sapheno\w*|superficial vein\w*|varicose|varix|varices|gsv|ssv)\b` },
  { label: "arteries", pattern: String.raw`\b(?:arter\w*|carotid\w*)\b` },
  { label: "bones and joints", pattern: String.raw`\b(?:joint\w*|articular|synovi\w*|tendon\w*|ligament\w*|bursa\w*|menisc\w*|cartilage|marrow|bones?|skeletal)\b` },
  { label: "soft tissue", pattern: String.raw`\b(?:soft tissue\w*|subcutaneous|muscle\w*|muscular|fascia\w*|myo\w*)\b` },
] as const;

/**
 * The canonical sites a stretch of text names, in list order.
 *
 * Read from the whole sentence rather than from the span a negation governed: the
 * organ usually comes before the verb, so "the gallbladder contains multiple
 * stones" has already left "gallbladder" behind by the time the negation reading
 * starts. That is why sites sit beside levels and sides, which are read the same
 * way, rather than beside acuity and magnitude.
 */
export function anatomicalSites(text: string): string[] {
  const lower = (text ?? "").toLowerCase();
  const out: string[] = [];
  for (const term of ANATOMICAL_SITE_TERMS) {
    // matchAll clones the memoised pattern; a bare .test() on a /g/ RegExp would
    // leave lastIndex set and silently shorten the next caller's scan.
    if (!lower.matchAll(compiled(term.pattern)).next().done) out.push(term.label);
  }
  return out;
}

/**
 * Statements that the study as a whole was normal. A sentence carrying one of
 * {@link SCOPE_LIMITERS} is not one: "No significant abnormality at other
 * cervical levels." is the correct way to pair a focal herniation with clear
 * background tissue, and reading it as a whole-study normal is exactly what
 * made the correct cervical report look contradictory.
 */
export const STUDY_NORMAL_PATTERNS: readonly RegExp[] = [
  /\bno (?:acute |significant |gross |focal )?abnormality\b/i,
  /\bno (?:acute |significant |gross )?pathology\b/i,
  /\bnormal study\b/i,
  /\bunremarkable (?:exam|examination|study|scan|report)\b/i,
  /\bnormal(?:\s+\w+){0,2}\s+(?:mri|mr|mrcp|ct|us|usg|ultrasound|sonography|doppler|scan|examination|report|radiograph|x-?ray|mammogram|survey|study)\b/i,
  /\b(?:mri|ct|us|usg|ultrasound|mrcp|doppler|mammogram|radiograph|study|examination|scan)(?:\s+\w+){0,2}\s+(?:is|was) normal\b/i,
  /\bnegative (?:screening |study|examination|mammogram)\b/i,
] as const;

/** Qualifiers that limit a normal statement to part of the study. */
export const SCOPE_LIMITERS: readonly RegExp[] = [
  /\bother\b/i,
  /\brest of\b/i,
  /\bremaining\b/i,
  /\bexcept\b/i,
  /\bapart from\b/i,
  /\bbeyond\b/i,
  /\bsave for\b/i,
  /\bin isolation\b/i,
] as const;

/**
 * Uncertainty is not denial: "cannot be excluded", "possible", "suspected" and
 * "equivocal" leave an abnormality on the record, so a report whose impression
 * then calls the study normal still contradicts itself.
 */
const UNCERTAINTY =
  /\b(?:cannot (?:be )?(?:exclude|excluded|rule ?out|assessed|evaluated|demonstrated)|not excluded|possible|probable|likely|presumably|equivocal|query|questionable|suspected|suspicion for|to exclude|for exclusion|rule ?out|may (?:repre|be)|could (?:repre|be)|concern(?:s)? for|suggestive of|suspicious for|cannot be (?:seen|identified))\b/i;

/** Where an earlier "no" stops governing: a fresh assertion begins here. */
const SCOPE_RESET =
  /\b(?:but|however|although|though|yet|whereas|nevertheless|while|there (?:is|are|was|were)|has (?:been|revealed)|with (?:a|an)|show(?:s|ed|n)?|demonstrat\w+|reveal\w+|noted|present(?:ed)?|contains|identified|seen|detect\w+|correlate(?:d)? with)\b/gi;

/** Denial before the term: "no acute haemorrhage", "without calculus". */
const DENIAL_BEFORE =
  /\b(?:no|not|without|absence of|absent|lack of|negative for|free of|denies|denied|neither|excluding)\b/i;

/** Denial after the term: "disc herniation is not seen", "tumour excluded". */
const DENIAL_AFTER =
  /\b(?:not (?:seen|identified|detected|demonstrated|noted|present|evident|appreciable|found|apparent|discernible)|excluded|ruled ?out)\b/i;

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|[;\n]+/;

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * The stretch a denial cue can still govern, from the last reset up to the term.
 * The split is by sentence rather than by comma because "No mass effect, midline
 * shift or herniation" keeps one negation across all three items — cutting at
 * the commas would have made a normal head CT report a herniation.
 */
function governingScope(sentence: string, termStart: number): string {
  const before = sentence.slice(0, termStart);
  let start = 0;
  SCOPE_RESET.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCOPE_RESET.exec(before)) !== null) start = m.index + m[0].length;
  return before.slice(start);
}

function windowAfter(sentence: string, termEnd: number): string {
  const tail = sentence.slice(termEnd);
  const stop = tail.search(/[,]/);
  return stop === -1 ? tail.slice(0, 48) : tail.slice(0, Math.min(stop, 48));
}

/**
 * What the text does with one mention of a term — denies it, asserts it, or holds
 * it open. The precedence is the one {@link assertedAbnormality} has always had,
 * written out as three states instead of a boolean: an unresolved abnormality still
 * contradicts a normal summary, but it is not the same clinical fact as a stated
 * one, and the findings signature has to tell those apart or "cannot be excluded"
 * and "is present" would read as the same report.
 */
function readState(scope: string, after: string): ClinicalOccurrence["state"] {
  // Denial outranks a hedge: "no likely fracture" and "no definite abnormality"
  // are denials, and reading the hedge as the assertion is what marks up a
  // correct normal report. A hedge with NO denial cue is the other case —
  // "haemorrhage cannot be excluded" keeps the abnormality on the record.
  if (DENIAL_BEFORE.test(scope)) return "denied";
  if (UNCERTAINTY.test(scope) || UNCERTAINTY.test(after)) return "uncertain";
  if (DENIAL_AFTER.test(after)) return "denied";
  return "asserted";
}

/** One mention of one vocabulary term, and what the text did with it. */
export type ClinicalOccurrence = {
  label: string;
  state: "asserted" | "denied" | "uncertain";
};

/**
 * One mention, plus the qualifiers and anatomy that scope it.
 *
 * The state on its own cannot say whether two mentions of one word contradict
 * each other. "No acute infarct" in the Findings beside "chronic infarct" in the
 * Impression is one correct report, and so is "no nerve root compression at
 * L3-L4" beside "thecal sac indentation at L4-L5" — in each the two halves are
 * about different facts, not disagreeing about one. Acuity, magnitude and the
 * entity qualifiers are read from the span the negation reading governed, i.e. the
 * words that scope *this* mention; levels, sides and sites come from the whole
 * sentence, because the level an abnormality sits at and the organ it belongs to
 * are usually named outside the span a negation still governs.
 */
export type ClinicalOccurrenceDetail = ClinicalOccurrence & {
  readonly acuity: readonly string[];
  readonly magnitude: readonly string[];
  readonly qualifiers: readonly string[];
  readonly levels: readonly string[];
  readonly sides: readonly string[];
  readonly sites: readonly string[];
};

/**
 * Every vocabulary mention in the text, in sentence order then term order, with
 * the qualifiers that scope each one. The order is load-bearing:
 * {@link assertedAbnormality} reports the first mention the text does not deny,
 * and the rule messages quote that label.
 */
export function clinicalOccurrenceDetails(
  text: string,
  terms: readonly ClinicalTerm[] = ABNORMAL_TERMS,
): ClinicalOccurrenceDetail[] {
  const out: ClinicalOccurrenceDetail[] = [];
  if (!text) return out;
  for (const sentence of sentences(text)) {
    const lower = sentence.toLowerCase();
    // Per sentence, not per term: ~50 patterns share one reading of the anatomy.
    const levels = [...new Set(spinalLevels(sentence).map((l) => l.canonical))];
    const sides = [...new Set([...lower.matchAll(LATERALITY_TOKEN)].map((m) => m[1].toLowerCase()))];
    const sites = anatomicalSites(sentence);
    for (const term of terms) {
      for (const match of lower.matchAll(compiled(term.pattern))) {
        const at = match.index ?? 0;
        const end = at + match[0].length;
        const scope = governingScope(lower, at);
        const after = windowAfter(lower, end);
        const span = `${scope}${match[0]}${after}`;
        const state = readState(scope, after);
        out.push({
          label: term.label,
          state,
          acuity: uniqueWords(span, ACUITY_TOKEN),
          magnitude: uniqueWords(span, MAGNITUDE_TOKEN),
          qualifiers: state === "denied" && UNCERTAINTY.test(scope) ? [] : uniqueWords(span, ENTITY_QUALIFIER),
          levels,
          sides,
          sites,
        });
      }
    }
  }
  return out;
}

/**
 * The same reading with the scope qualifiers dropped. Kept as its own export
 * because most callers only ask what the text did with a term, and the answer has
 * to be the one reading above — a second pass over the prose would be a second
 * opinion about what "no acute haemorrhage" means.
 */
export function clinicalOccurrences(
  text: string,
  terms: readonly ClinicalTerm[] = ABNORMAL_TERMS,
): ClinicalOccurrence[] {
  return clinicalOccurrenceDetails(text, terms);
}

function uniqueWords(text: string, token: RegExp): string[] {
  return [...new Set([...text.matchAll(token)].map((m) => m[1].toLowerCase()))];
}

/**
 * The first abnormality this text genuinely asserts, or null when every mention
 * of the vocabulary is denied ("no fracture", "without calculus"). Uncertain
 * mentions count as asserted.
 *
 * Patterns are compiled once: the live quality badge re-runs these rules on every
 * keystroke, and rebuilding ~50 patterns per sentence per call is work a
 * radiologist should not pay for while typing.
 */
const COMPILED = new Map<string, RegExp>();

function compiled(pattern: string): RegExp {
  let re = COMPILED.get(pattern);
  if (!re) {
    re = new RegExp(pattern, "gi");
    COMPILED.set(pattern, re);
  }
  return re;
}

export function assertedAbnormality(
  text: string,
  terms: readonly ClinicalTerm[] = ABNORMAL_TERMS,
): string | null {
  for (const occurrence of clinicalOccurrences(text, terms)) {
    if (occurrence.state !== "denied") return occurrence.label;
  }
  return null;
}

/** True when some sentence claims the whole study was normal. */
export function assertsStudyNormal(text: string): boolean {
  if (!text) return false;
  for (const sentence of sentences(text)) {
    if (SCOPE_LIMITERS.some((re) => re.test(sentence))) continue;
    if (STUDY_NORMAL_PATTERNS.some((re) => re.test(sentence))) return true;
  }
  return false;
}

/**
 * The BI-RADS assessment categories stated in the text, in order. Composition
 * categories (A-D) describe density rather than an assessment and are skipped,
 * and a suffix letter (4C) still reads as category 4.
 */
export function assessmentCategories(text: string): number[] {
  if (!text) return [];
  const found: number[] = [];
  const re = /\b(?:bi-?rads)\s+(?:assessment\s+)?category\s*([0-5])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (text.slice(Math.max(0, m.index - 24), m.index).toLowerCase().includes("composition")) continue;
    found.push(Number(m[1]));
  }
  return found;
}

/** Spinal / vascular level, with the second digit's letter filled in so "C5-6"
 *  and "C5-C6" are one fact. */
const LEVEL_TOKEN = /\b([ctls])(\d{1,2})(?:\s*-\s*([ctls])?(\d{1,2}))?\b/gi;

const LATERALITY_TOKEN = /\b(left|right|bilateral|contralateral|unilateral)\b/gi;

/** A number with the unit it was written with — the canal diameter, the stone,
 *  the gestational age. Units are folded to one spelling so "8 mm" and "8mm"
 *  are one fact. */
const MEASUREMENT_TOKEN =
  /\b(\d+(?:[.,]\d+)?)\s*(mm|cm|cc|ml|hu|hounsfield|weeks?|days?|months?|years?)\b/gi;

/**
 * The qualifiers a radiologist would call a clinical change if one of them were
 * rewritten in the Findings: severity, acuity and extent. Deliberately a closed
 * list rather than every adjective — "adjacent" or "prominent" re-arranging is
 * prose, while "mild" becoming "severe" is a different patient.
 */
const SEVERITY_TOKEN =
  /\b(acute|chronic|subacute|mild|moderate|severe|minimal|marked|massive|complete|partial|focal|diffuse|small|large|significant)\b/gi;

/**
 * Acuity, read on its own. "No acute infarct" beside "chronic infarct" is one
 * correct report rather than a contradiction, and the same is true of a subacute
 * collection described once as acute and once as chronic — so a denial and an
 * assertion of one word are about different facts when the two name different
 * times. Deliberately not the whole of {@link SEVERITY_TOKEN}: "no significant
 * stenosis" beside "severe stenosis" is a contradiction about the same fact, and
 * folding magnitude in here would excuse exactly the report that needs reading.
 */
const ACUITY_TOKEN = /\b(acute|chronic|subacute)\b/gi;

/**
 * The graded magnitude words, as a closed three-step scale. A Findings that grades
 * a finding "mild" and an Impression that grades the same finding "severe" are not
 * two spellings of one fact — the grade is what decides whether anybody operates.
 * "minimal" and "marked" are left out on purpose: they are not on this scale, and
 * a Findings that says "minimal" beside an Impression that says "mild" is prose,
 * not a disagreement.
 */
const MAGNITUDE_TOKEN = /\b(mild|moderate|severe)\b/gi;

/**
 * Words that pick out a SUBSET of a finding rather than grading it: "no suspicious
 * mass", "no new satellite lesion", "no additional fracture". A denial carrying one
 * is not a denial of the finding — the mammogram that says "No suspicious masses or
 * calcifications" and then describes two stable fibroadenomas with coarse
 * calcifications is the correct BI-RADS 2 report, and it is the subset that was
 * cleared, not the masses.
 *
 * The graded words of {@link MAGNITUDE_TOKEN} are left out on purpose, and the
 * distinction is the whole of it. "Significant" says how much of one finding there
 * is, so "no significant spinal canal stenosis" beside "severe spinal canal
 * stenosis at L4-L5" is still one fact described twice and must still be reported;
 * "suspicious" says which members of a set, so clearing the set of them leaves the
 * members standing.
 *
 * A DENIAL whose scope also hedges — "no lesion suspicious for metastasis", "no
 * mass concerning for malignancy" — carries none of these words, and
 * {@link clinicalOccurrenceDetails} drops them for exactly that case. "Suspicious
 * for X" is one of the {@link UNCERTAINTY} constructions, so it names the diagnosis
 * being excluded rather than a subset of the findings: what the sentence cleared was
 * metastasis, not some of the lesions. Reading it as a subset silenced a real defect
 * — the whole-spine report whose Findings exclude metastasis and whose Impression
 * then reports "T8 metastatic deposit with pathological fracture", which changes a
 * screening study into a staging one. The narrowing is gated on `state === "denied"`
 * so an UNCERTAIN mention keeps its words: "no suspicious mass" beside "mass
 * suspicious for malignancy" is still two sections disagreeing about one finding.
 */
const ENTITY_QUALIFIER =
  /\b(suspicious|satellite|additional|further|separate|other|extra|new|fresh)\b/gi;

const UNIT_CANON: Record<string, string> = {
  mm: "mm",
  cm: "cm",
  cc: "cc",
  ml: "ml",
  hu: "hu",
  hounsfield: "hu",
  week: "wk",
  weeks: "wk",
  day: "d",
  days: "d",
  month: "mo",
  months: "mo",
  year: "yr",
  years: "yr",
};

/**
 * The clinical content of a Findings block, as a comparable string.
 *
 * This is what the Impression is declared to summarise, so it is the value the
 * workspace records when the summary is written and compares against when the
 * report is reopened. Everything presentation-shaped is excluded — headings,
 * punctuation, capitalisation, sentence order, "the" — and everything
 * decision-shaped is included: which abnormalities are asserted, denied or held
 * open, at which level, on which side, at what size and severity. Re-formatting
 * the Findings therefore leaves the signature alone, while changing C5-C6 to
 * C6-C7, left to right, 8 mm to 18 mm, or withdrawing a denial does not.
 */
/**
 * Function words, and the cues the negation reading already consumes. Excluded so
 * that re-flowing a sentence — punctuation, case, articles, is/with — is not
 * mistaken for a clinical change. Every content word is kept, so a sentence added
 * or removed always counts as one: a radiologist's free-text note has no term,
 * level, side or number in it and must still arm the dependency, because prose the
 * vocabulary cannot classify is exactly the prose that needs re-reading.
 */
const SIGNATURE_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "nor", "to", "of", "in", "on", "at", "is", "are", "was", "were",
  "be", "been", "being", "with", "without", "within", "no", "not", "cannot", "that", "this",
  "these", "those", "there", "here", "it", "its", "their", "as", "by", "from", "than", "which",
  "can", "could", "may", "might", "for", "per", "into", "over", "under", "also", "still", "yet",
]);

/** A line with no lower-case letter in it is a heading, not prose. */
const HEADING_LINE = /^[^a-z]*$/;

function contentWords(text: string): string[] {
  const words: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (!line.trim() || HEADING_LINE.test(line)) continue;
    for (const raw of line.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || SIGNATURE_STOP_WORDS.has(raw)) continue;
      words.push(raw);
    }
  }
  return words;
}

export function clinicalContentSignature(text: string): string {
  if (!text) return "";
  const tokens = new Set<string>();

  for (const occurrence of clinicalOccurrences(text)) {
    const marker =
      occurrence.state === "asserted" ? "A" : occurrence.state === "uncertain" ? "U" : "N";
    tokens.add(`${marker}:${occurrence.label}`);
  }

  for (const match of text.matchAll(LEVEL_TOKEN)) {
    const vertebral = match[1].toUpperCase();
    const level = `${vertebral}${match[2]}`;
    tokens.add(match[4] ? `L:${level}-${(match[3] ?? vertebral).toUpperCase()}${match[4]}` : `L:${level}`);
  }
  for (const match of text.matchAll(LATERALITY_TOKEN)) tokens.add(`S:${match[1].toLowerCase()}`);
  for (const match of text.matchAll(MEASUREMENT_TOKEN)) {
    const unit = UNIT_CANON[match[2].toLowerCase()] ?? match[2].toLowerCase();
    tokens.add(`M:${match[1].replace(",", ".")}${unit}`);
  }
  for (const match of text.matchAll(SEVERITY_TOKEN)) tokens.add(`Q:${match[1].toLowerCase()}`);
  for (const word of contentWords(text)) tokens.add(`W:${word}`);

  return [...tokens].sort().join("|");
}

/**
 * Contrast. One term, so the same denial reading that decides whether "fracture"
 * is present also decides whether "enhancement" is claimed — "no abnormal
 * gadolinium enhancement" on a plain study is a correct sentence, and a check that
 * reads it as a claim of contrast marks up every normal MRI in the clinic.
 *
 * Bare "enhancement" is excluded when the word before it is "acoustic": posterior
 * acoustic enhancement is how ultrasound describes the tissue behind a cyst or
 * stone, and has nothing to do with contrast. Measured in this corpus — the
 * gallstone report's own Findings say it.
 */
export const CONTRAST_MENTION_TERMS: readonly ClinicalTerm[] = [
  {
    label: "contrast administration",
    pattern: String.raw`\b(?:gadolinium|iodinated contrast|contrast medium|contrast administration|contrast bolus|contrast injection|post[- ]?contrast|contrast[- ]enhanced|contrast enhancement)\b`,
  },
  {
    label: "contrast administration",
    pattern: String.raw`(?<!acoustic )\b(?:enhancement|enhancing)\b`,
  },
];

/**
 * How this clinic's own worklist names an unenhanced study, in either field.
 * Up to two words may sit between the denial and "contrast", because protocols
 * are written "performed without intravenous contrast".
 */
const NON_CONTRAST_STUDY =
  /\b(?:plain|unenhanced|not enhanced|ncct|without\s+(?:[a-z]+\s+){0,2}contrast|no\s+(?:[a-z]+\s+){0,2}contrast|non[- ]contrast)\b/i;

/**
 * A two-phase study, checked before the denial above: "with and without contrast"
 * is how a brain or MS protocol is written, and it means contrast WAS given.
 * Read the other way, every enhanced MRI in the clinic becomes a plain study
 * whose enhancement is a contradiction.
 */
const CONTRAST_BOTH_PHASES =
  /\bwith and without (?:iv |intravenous |oral )?contrast\b|\bcontrast[- ]enhanced and unenhanced\b|\bpre- and post-contrast\b/i;

/** And how it names an enhanced one. Checked last, so "plain, no contrast" wins. */
const CONTRAST_STUDY =
  /\b(?:with contrast|post[- ]?contrast|contrast[- ]enhanced|gadolinium|cect|cemri|enhanced study)\b/i;

export type StudyContrastState = "plain" | "contrast" | "unknown";

/**
 * What the patient actually received, from the study description and the Technique
 * line. Q112 used to read the study description alone and only recognised
 * "WITHOUT CONTRAST"/"NCCT"/"NON-CONTRAST" — so a worklist that writes
 * "MRI CERVICAL SPINE (PLAIN)" matched neither branch, and a study whose title
 * says nothing while its protocol says "performed without intravenous contrast"
 * had no state at all. On this clinic's naming the rule was therefore inert.
 */
export function studyContrastState(...fields: (string | null | undefined)[]): StudyContrastState {
  const text = fields.filter(Boolean).join(" ");
  if (CONTRAST_BOTH_PHASES.test(text)) return "contrast";
  if (NON_CONTRAST_STUDY.test(text)) return "plain";
  if (CONTRAST_STUDY.test(text)) return "contrast";
  return "unknown";
}

/**
 * A contrast claim the text actually makes, or null when every mention of
 * enhancement is denied. Findings and Impression only: a Technique line that
 * describes the protocol is not a clinical assertion.
 */
export function assertedContrastMention(text: string): string | null {
  for (const occurrence of clinicalOccurrences(text, CONTRAST_MENTION_TERMS)) {
    if (occurrence.state !== "denied") return occurrence.label;
  }
  return null;
}

/**
 * Diagnoses specific enough that a report has to have described them somewhere.
 * Deliberately narrower than ABNORMAL_TERMS: "ischaemia", "gliosis", "lesion" and
 * "mass" are how a summary *re-describes* findings, and flagging them is what
 * would mark up correct reports — "Mild chronic small vessel ischaemic disease"
 * over punctate white-matter lesions is the everyday example. A named entity —
 * a tumour, an infection, an infarct — is not a re-description, so naming one
 * that appears nowhere else is an invention, not a summary.
 *
 * The inflammatory entries carry `grounds`: the words that describe the organ
 * they name, because "-itis" is routinely written as anatomy in Findings and a
 * diagnosis supported that way is not invented. Neoplasms and infarcts get no
 * such allowance on purpose — "an irregular mass" does not license "invasive
 * ductal carcinoma", which is a histological claim no mammogram can make.
 */
export const NAMED_DIAGNOSIS_TERMS: readonly NamedDiagnosis[] = [
  { label: "meningioma", pattern: String.raw`\bmeningiom\w*\b` },
  { label: "glioma", pattern: String.raw`\b(?:astrocytom\w*|oligodendrom\w*|gliom\w*|ependymom\w*)\b` },
  { label: "pituitary adenoma", pattern: String.raw`\b(?:pituitar\w+ adenom\w*|prolactinom\w*)\b` },
  { label: "lymphoma", pattern: String.raw`\b(?:lymphom\w*|leukaem\w*|leukem\w*)\b` },
  { label: "carcinoma", pattern: String.raw`\b(?:carcinom\w*|sarcom\w*|myelom\w*|melanom\w*|blastom\w*)\b` },
  { label: "metastasis", pattern: String.raw`\b(?:metasta\w*|secondar(?:y|ies) deposit\w*)\b` },
  {
    label: "spinal infection",
    pattern: String.raw`\b(?:spondylodiscit\w*|discit\w*|osteomyelit\w*|epidural abscess|pott(?:'s)? disease|tubercul\w*)\b`,
  },
  { label: "abscess", pattern: String.raw`\b(?:abscess|empyema|empyem\w*)\b` },
  {
    label: "biliary inflammation",
    pattern: String.raw`\b(?:cholecystitis|cholangitis)\b`,
    grounds: String.raw`\b(?:gall ?bladder|cystic duct|(?:common |intrahepatic |extrahepatic )?bile duct|biliar\w*|cholecyst\w*|cholang\w*)\b`,
  },
  {
    label: "appendicitis",
    pattern: String.raw`\bappendicitis\b`,
    grounds: String.raw`\b(?:appendic\w*|vermiform)\b`,
  },
  { label: "pancreatitis", pattern: String.raw`\bpancreatitis\b`, grounds: String.raw`\bpancrea\w*\b` },
  {
    label: "diverticulitis",
    pattern: String.raw`\bdiverticulit\w*\b`,
    grounds: String.raw`\b(?:diverticul\w*|sigmoid|colon|caecum|cecum)\b`,
  },
  {
    label: "peritonitis",
    pattern: String.raw`\bperitonitis\b`,
    grounds: String.raw`\b(?:peritone\w*|ascites|free fluid)\b`,
  },
  {
    label: "salpingo-oophoritis",
    pattern: String.raw`\b(?:salpingitis|salpingo-oophorit\w*|oophoritis)\b`,
    grounds: String.raw`\b(?:fallopian|salpinx|salping\w*|ovar\w*|adnex\w*|uter\w*)\b`,
  },
  {
    label: "orchitis",
    pattern: String.raw`\b(?:orchitis|epididymo-orchitis|epididymitis)\b`,
    grounds: String.raw`\b(?:test(?:is|es|icular)|scrot\w*|epididym\w*|spermatic cord)\b`,
  },
  {
    label: "pyelonephritis",
    pattern: String.raw`\bpyelonephritis\b`,
    grounds: String.raw`\b(?:kidney|kidneys|renal\w*|ureter\w*|pelvicalyceal|collecting system)\b`,
  },
  { label: "gonorrhoea", pattern: String.raw`\bgonorrhoe\w*\b` },
  { label: "syphilis", pattern: String.raw`\bsyphil\w*\b` },
  { label: "aneurysm", pattern: String.raw`\b(?:aneurysm\w*|pseudoaneurysm\w*|arteriovenous (?:malformation|fistula))\b` },
  { label: "dissection", pattern: String.raw`\b(?:arterial )?dissection\b` },
  { label: "haemorrhage", pattern: String.raw`\b(?:ha?ematoma|hematoma|subarachnoid haemorrhage|subarachnoid hemorrhage)\b` },
  { label: "fracture", pattern: String.raw`\b(?:fractur\w*|spondylolysis|spondylolisthesis)\b` },
  { label: "hydrocephalus", pattern: String.raw`\b(?:hydrocephal\w*|normal pressure hydrocephalus)\b` },
  { label: "venous thrombosis", pattern: String.raw`\b(?:thrombos\w*|thrombus|thrombi|dvt|embolism|emboli)\b` },
  { label: "infarction", pattern: String.raw`\b(?:infarct\w*|ischaemic stroke|ischemic stroke|cerebrovascular accident)\b` },
];

/**
 * The named diagnoses a block of prose asserts (or holds open), by label. A
 * diagnosis the Impression states and no other section mentions is a conclusion
 * with no examination behind it.
 */
export function assertedDiagnoses(text: string, terms: readonly ClinicalTerm[] = NAMED_DIAGNOSIS_TERMS): string[] {
  const out = new Set<string>();
  for (const occurrence of clinicalOccurrences(text, terms)) {
    if (occurrence.state !== "denied") out.add(occurrence.label);
  }
  return [...out];
}

/**
 * The named diagnoses an Impression asserts that nothing else in the report
 * supports — by name, or through the organ the diagnosis names.
 *
 * Denials are read on both sides. "No collection or abscess" in the Findings
 * supports nothing, and an Impression line "without abscess formation" asserts
 * nothing, so neither half of a correctly negative report can arm this. What
 * reaches the radiologist is the diagnosis that has no sentence anywhere else in
 * the study: the entity that appears only in the conclusion.
 */
export function ungroundedNamedDiagnoses(
  impressionText: string,
  supportText: string,
  terms: readonly NamedDiagnosis[] = NAMED_DIAGNOSIS_TERMS,
): string[] {
  const support = supportText ?? "";
  const named = new Set(assertedDiagnoses(support, terms));
  const out: string[] = [];
  for (const occurrence of clinicalOccurrences(impressionText, terms)) {
    if (occurrence.state === "denied") continue;
    if (named.has(occurrence.label)) continue;
    const term = terms.find((t) => t.label === occurrence.label);
    if (!term?.grounds) {
      out.push(occurrence.label);
      continue;
    }
    const grounds: readonly ClinicalTerm[] = [{ label: term.label, pattern: term.grounds }];
    if (!assertedDiagnoses(support, grounds).includes(term.label)) out.push(occurrence.label);
  }
  return [...new Set(out)];
}

/** A limited spine study and what it may legitimately name. */
const SPINE_REGIONS: readonly { label: string; title: RegExp; letters: readonly string[] }[] = [
  { label: "cervical", title: /CERV/i, letters: ["C"] },
  { label: "thoracic", title: /DORSAL|THORACIC/i, letters: ["T"] },
  { label: "lumbosacral", title: /LUMB|SACRAL/i, letters: ["L", "S"] },
];

/** A study that covers the whole spine may name any level. */
const WHOLE_SPINE_TITLE = /WHOLE|ENTIRE|COMPLETE|PAN.?SPINE|DORSO.?LUMB|CERVI?.?CO?.?LUMB|PANTOMELARK/i;

const SPINE_TITLE = /\b(?:SPINE|C-?SPINE|L-?SPINE|DORSAL|THORACIC|CERVICAL|LUMBAR|SACRAL)\b/i;

const LEVEL_WORD = /\b([CTLS])(\d{1,2})(?:\s*-\s*(?:([CTLS]))?(\d{1,2}))?\b/g;

/**
 * "T2" is ambiguous in an MRI report: the second thoracic vertebra, or the
 * T2-weighted sequence. "Intrinsic T2 hyperintensity at the level of compression"
 * is the standard way to describe a cord lesion, and reading that T2 as a
 * thoracic level tells a cervical surgeon the report covers segments it never
 * imaged — a false alarm on the clinic's most common abnormal cervical MRI.
 *
 * Only T1 and T2 are ambiguous (no sequence is named C1/L1/S1), and only when a
 * weighting or signal word follows the token. "T12 compression fracture" and
 * "T9-T10 disc disease" in a cervical report stay flagged.
 */
const SEQUENCE_AMBIGUOUS = /^T[12]$/i;
const SEQUENCE_CONTEXT =
  /^\s*[- ]?\s*(?:w\b|wi\b|weight\w*|hyper\w*|hypo\w*|iso\w*|signal\b|intensity\b|flair\b|stir\b|image\w*|sequence\w*)/i;

/** One level the prose names: as written, its region, and its canonical form. */
export type SpinalLevel = {
  /** Exactly what was written — "C5-6", "L4–L5". */
  readonly raw: string;
  /** The region letter, upper-case. */
  readonly region: string;
  /** One spelling of one fact: "C5-6" and "C5-C6" both read as "C5-C6". */
  readonly canonical: string;
};

/**
 * Every spinal level the prose names, with the sequence reading above applied.
 * Shared by the anatomical-scope rule and the Findings↔Impression level rule
 * because they are asking the same question of the same sentence — a level one of
 * them reads as a vertebra and the other as a pulse sequence is a disagreement
 * about the report, not about the rule.
 */
export function spinalLevels(text: string): SpinalLevel[] {
  const prose = text ?? "";
  const out: SpinalLevel[] = [];
  for (const match of prose.matchAll(LEVEL_WORD)) {
    const at = match.index ?? 0;
    if (SEQUENCE_AMBIGUOUS.test(match[0]) && SEQUENCE_CONTEXT.test(prose.slice(at + match[0].length))) continue;
    const region = match[1].toUpperCase();
    out.push({
      raw: match[0],
      region,
      canonical: match[4] ? `${region}${match[2]}-${(match[3] ?? region).toUpperCase()}${match[4]}` : `${region}${match[2]}`,
    });
  }
  return out;
}

/**
 * Spine content that belongs to a region this examination did not cover.
 *
 * A cervical MRI that describes "L4-L5 disc extrusion with left S1 root contact"
 * is not a summary of the study — a surgeon reads it as a reviewed level, and the
 * two are different operations on different nerve roots. Same for a segment
 * declared normal ("the dorsal spine is normal") that was never imaged: an
 * unexamined region cannot be cleared.
 *
 * Returns nothing for a non-spine study (no basis to judge), for a whole-spine
 * protocol (every level is in scope), and for the level letters the title itself
 * covers. Findings and Impression only — a Technique line legitimately names the
 * cervicothoracic junction it acquired through. A T1/T2 followed by a weighting
 * or signal word is read as the sequence, not the vertebra — see
 * {@link SEQUENCE_CONTEXT}.
 */
export function outOfScopeSpineContent(text: string, studyDescription: string | null | undefined): string[] {
  const title = (studyDescription ?? "").toUpperCase();
  if (!SPINE_TITLE.test(title) || WHOLE_SPINE_TITLE.test(title)) return [];

  const allowed = new Set<string>();
  const inScopeLabels = new Set<string>();
  for (const region of SPINE_REGIONS) {
    if (region.title.test(title)) {
      for (const letter of region.letters) allowed.add(letter);
      inScopeLabels.add(region.label);
    }
  }
  if (allowed.size === 0) return [];

  const offenders = new Set<string>();
  for (const level of spinalLevels(text ?? "")) {
    if (allowed.has(level.region)) continue;
    offenders.add(level.raw);
  }
  const prose = text ?? "";
  for (const region of SPINE_REGIONS) {
    if (inScopeLabels.has(region.label)) continue;
    const word = region.label === "cervical" ? /\bcervical\b/i
      : region.label === "thoracic" ? /\b(?:dorsal|thoracic)\s+spine\b/i
      : /\b(?:lumbar|lumbosacral|sacral)\s+spine\b|\blumbosacral\b/i;
    if (word.test(prose)) offenders.add(region.label);
  }
  return [...offenders].sort();
}
