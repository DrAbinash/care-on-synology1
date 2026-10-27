/**
 * quickSelectTokenBoxes.fixture — the SHIPPED Quick Select catalogue, verbatim.
 *
 * Every active `radiology_quick_findings` row whose prose carries a template
 * placeholder. Generated from the migration-built database (the same 487-row
 * catalogue CI’s real-Postgres job applies) by selecting rows whose four
 * sections match `{[A-Za-z_][A-Za-z0-9_]*}`. 136 rows, 56 study types.
 *
 * It exists so the substitution test can run the REAL structured-dialog
 * renderer over the REAL catalogue in the frontend package, where the database
 * is not reachable — the renderer lives in `@/lib/structuredFindings` (this
 * package) and the rows live behind `@workspace/db` (the api-server package);
 * no test in either package can import a source module from the other under
 * typecheck, so the catalogue is materialised here. Regenerate with the
 * documented psql query; do not hand-edit: this is the audit’s population, not
 * a curated sample.
 */
export type TokenCarryingQuickSelectBox = {
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  questionsJson: string;
};

export const TOKEN_CARRYING_QUICK_SELECT_BOXES: TokenCarryingQuickSelectBox[] = [
 {
  "studyType": "Anomaly",
  "label": "Choroid Plexus Cyst",
  "findingText": "A choroid plexus cyst is noted in the {side} lateral ventricle, measuring {size} mm.",
  "impressionText": "{side} choroid plexus cyst — an isolated finding is generally a normal variant; correlate with other soft markers and maternal age-adjusted risk.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Anomaly",
  "label": "Renal Pelvis Dilation (Pyelectasis)",
  "findingText": "The renal pelvis of the {side} kidney measures {size} mm in antero-posterior diameter.",
  "impressionText": "{side} mild pyelectasis — third-trimester follow-up ultrasound recommended to exclude progression.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Appendix",
  "label": "Acute Appendicitis",
  "findingText": "A non-compressible, blind-ending tubular structure is noted in the right iliac fossa arising from the cecum, measuring {diameter} mm in outer diameter, with mural wall thickening and increased wall vascularity on colour Doppler[, with {periappendiceal}][, with {appendicolith}], in keeping with acute appendicitis.",
  "impressionText": "Acute appendicitis, {diameter} mm[, with {periappendiceal}][, with {appendicolith}].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"diameter\", \"label\": \"Diameter (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"periappendiceal\", \"label\": \"Periappendiceal change\", \"type\": \"select\", \"options\": [\"None\", \"periappendiceal fat stranding\", \"a periappendiceal free fluid collection\"], \"default\": \"None\", \"required\": false}, {\"key\": \"appendicolith\", \"label\": \"Appendicolith\", \"type\": \"select\", \"options\": [\"None\", \"an associated appendicolith\"], \"default\": \"None\", \"required\": false}]"
 },
 {
  "studyType": "Arterial Doppler",
  "label": "Arterial Occlusion",
  "findingText": "The {side} {vessel} shows no colour or spectral flow throughout a segment measuring approximately {length} cm, {collaterals}, in keeping with occlusion.",
  "impressionText": "{side} {vessel} occlusion, approximately {length} cm in length — {collaterals}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vessel\", \"label\": \"Vessel\", \"type\": \"select\", \"options\": [\"common femoral artery\", \"superficial femoral artery\", \"popliteal artery\", \"anterior tibial artery\", \"posterior tibial artery\", \"peroneal artery\"], \"default\": \"superficial femoral artery\", \"required\": true}, {\"key\": \"length\", \"label\": \"Occlusion length (cm)\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"collaterals\", \"label\": \"Distal reconstitution\", \"type\": \"select\", \"options\": [\"with reconstitution distally via collaterals (subacute/chronic)\", \"without distal reconstitution (acute — urgent, limb-threatening)\"], \"default\": \"with reconstitution distally via collaterals (subacute/chronic)\", \"required\": true}]"
 },
 {
  "studyType": "Arterial Doppler",
  "label": "Arterial Stenosis",
  "findingText": "The {side} {vessel} shows an atherosclerotic plaque with focal velocity elevation and post-stenotic turbulence, in keeping with {grade} stenosis.",
  "impressionText": "{side} {vessel} stenosis, {grade}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vessel\", \"label\": \"Vessel\", \"type\": \"select\", \"options\": [\"common femoral artery\", \"superficial femoral artery\", \"popliteal artery\", \"anterior tibial artery\", \"posterior tibial artery\", \"peroneal artery\"], \"default\": \"superficial femoral artery\", \"required\": true}, {\"key\": \"grade\", \"label\": \"Grade\", \"type\": \"select\", \"options\": [\"<50%\", \"50-75%\", \"76-99% (severe)\"], \"default\": \"50-75%\", \"required\": true}]"
 },
 {
  "studyType": "Arterial Doppler",
  "label": "Monophasic Waveform",
  "findingText": "The {side} {vessel} shows a dampened monophasic waveform with loss of the normal triphasic pattern, in keeping with proximal inflow disease.",
  "impressionText": "Monophasic {side} {vessel} waveform — proximal inflow disease.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vessel\", \"label\": \"Vessel\", \"type\": \"select\", \"options\": [\"common femoral artery\", \"superficial femoral artery\", \"popliteal artery\"], \"default\": \"common femoral artery\"}]"
 },
 {
  "studyType": "Arterial Doppler",
  "label": "Popliteal Artery Aneurysm",
  "findingText": "The {side} popliteal artery is aneurysmally dilated, measuring approximately {size} mm in AP diameter, with mural thrombus.",
  "impressionText": "{side} popliteal artery aneurysm, {size} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"AP diameter (mm)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "Arterial Doppler",
  "label": "Pseudoaneurysm",
  "findingText": "A well-defined anechoic sac is noted adjacent to the {side} {vessel} with a visible neck showing to-and-fro ('yin-yang') flow on colour Doppler, in keeping with a pseudoaneurysm.",
  "impressionText": "{side} {vessel} pseudoaneurysm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vessel\", \"label\": \"Vessel\", \"type\": \"select\", \"options\": [\"common femoral artery\", \"superficial femoral artery\", \"popliteal artery\"], \"default\": \"common femoral artery\"}]"
 },
 {
  "studyType": "BPP",
  "label": "Biophysical Profile Assessment",
  "findingText": "Fetal breathing movements are {breathing}. Gross body movements are {movement}. Fetal tone is {tone}. Amniotic fluid volume is {afi}.[ Non-stress test is {nst}.] Biophysical profile score: {score}/10.",
  "impressionText": "Biophysical profile score {score}/10 — reassuring fetal status.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"breathing\", \"label\": \"Breathing movements\", \"type\": \"select\", \"options\": [\"Present\", \"Absent\"], \"default\": \"Present\", \"required\": true}, {\"key\": \"movement\", \"label\": \"Gross body movements\", \"type\": \"select\", \"options\": [\"Present\", \"Absent\"], \"default\": \"Present\", \"required\": true}, {\"key\": \"tone\", \"label\": \"Fetal tone\", \"type\": \"select\", \"options\": [\"Present\", \"Absent\"], \"default\": \"Present\", \"required\": true}, {\"key\": \"afi\", \"label\": \"Amniotic fluid volume\", \"type\": \"select\", \"options\": [\"Normal\", \"Reduced\"], \"default\": \"Normal\", \"required\": true}, {\"key\": \"nst\", \"label\": \"Non-stress test\", \"type\": \"select\", \"options\": [\"Reactive\", \"Non-reactive\", \"None\"], \"default\": \"Reactive\"}, {\"key\": \"score\", \"label\": \"BPP score (/10)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "BPP",
  "label": "Low BPP Score — Action Required",
  "findingText": "Biophysical profile score is {score}/10, raising concern for possible fetal compromise. {management}.",
  "impressionText": "Low biophysical profile score ({score}/10) — {management}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"score\", \"label\": \"BPP score (/10)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"management\", \"label\": \"Recommended action\", \"type\": \"select\", \"options\": [\"Repeat BPP within 24 hours\", \"Urgent obstetric consultation and delivery planning advised\"], \"default\": \"Urgent obstetric consultation and delivery planning advised\", \"required\": true}]"
 },
 {
  "studyType": "BPP",
  "label": "Modified BPP (AFI + NST)",
  "findingText": "A modified biophysical profile comprising amniotic fluid index and non-stress test only was performed. Amniotic fluid volume is {afi} and non-stress test is {nst}.",
  "impressionText": "Modified BPP: amniotic fluid {afi}, NST {nst}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"afi\", \"label\": \"Amniotic fluid volume\", \"type\": \"select\", \"options\": [\"Normal\", \"Reduced\", \"Increased\"], \"default\": \"Normal\", \"required\": true}, {\"key\": \"nst\", \"label\": \"Non-stress test\", \"type\": \"select\", \"options\": [\"Reactive\", \"Non-reactive\"], \"default\": \"Reactive\", \"required\": true}]"
 },
 {
  "studyType": "Brain",
  "label": "Acute Infarct",
  "findingText": "Area of restricted diffusion (DWI hyperintense, ADC hypointense) is noted in the {side} {territory} vascular territory[, measuring approximately {size}], consistent with an acute infarct[ with {hemorrhagic} haemorrhagic transformation].",
  "impressionText": "Acute infarct in the {side} {territory} vascular territory[ with {hemorrhagic} haemorrhagic transformation].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[\r\n    {\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\",\"required\":true,\"sortOrder\":1},\r\n    {\"key\":\"territory\",\"label\":\"Vascular Territory\",\"type\":\"select\",\"options\":[\"MCA\",\"ACA\",\"PCA\",\"PICA\",\"watershed\",\"lacunar\"],\"default\":\"MCA\",\"required\":true,\"sortOrder\":2},\r\n    {\"key\":\"size\",\"label\":\"Size\",\"type\":\"text\",\"options\":[],\"default\":\"\",\"sortOrder\":3},\r\n    {\"key\":\"hemorrhagic\",\"label\":\"Hemorrhagic Transformation\",\"type\":\"select\",\"options\":[\"None\",\"petechial\",\"frank\"],\"default\":\"None\",\"sortOrder\":4}\r\n  ]"
 },
 {
  "studyType": "Breast",
  "label": "Solid Breast Lesion",
  "findingText": "A {shape} solid hypoechoic lesion is noted in the {side} breast, measuring approximately {size} mm, BI-RADS {birads}.",
  "impressionText": "{side} breast lesion, BI-RADS {birads}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\",\"required\":true,\"sortOrder\":1},{\"key\":\"shape\",\"label\":\"Shape\",\"type\":\"select\",\"options\":[\"oval\",\"round\",\"irregular\"],\"default\":\"oval\",\"sortOrder\":2},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":3},{\"key\":\"birads\",\"label\":\"BI-RADS category\",\"type\":\"select\",\"options\":[\"2\",\"3\",\"4\",\"5\"],\"default\":\"3\",\"required\":true,\"sortOrder\":4}]"
 },
 {
  "studyType": "Breast",
  "label": "Suspicious Axillary Lymph Node",
  "findingText": "An enlarged {side} axillary lymph node is noted, measuring approximately {size} mm, showing {feature}.",
  "impressionText": "{side} axillary lymphadenopathy — {feature}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"feature\", \"label\": \"Morphology\", \"type\": \"select\", \"options\": [\"preserved fatty hilum, uniform thin cortex (reactive)\", \"eccentric cortical thickening with loss of fatty hilum (suspicious)\"], \"default\": \"preserved fatty hilum, uniform thin cortex (reactive)\"}]"
 },
 {
  "studyType": "Carotid Doppler",
  "label": "Carotid Occlusion",
  "findingText": "The {side} {vessel} shows no colour or spectral flow with echogenic intraluminal material filling the lumen, in keeping with complete occlusion.",
  "impressionText": "{side} {vessel} occlusion.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vessel\", \"label\": \"Vessel\", \"type\": \"select\", \"options\": [\"ICA\", \"CCA\"], \"default\": \"ICA\"}]"
 },
 {
  "studyType": "Carotid Doppler",
  "label": "Carotid Plaque",
  "findingText": "A {morphology} atherosclerotic plaque with a {surface} surface is noted at the {side} {location}, causing non-flow-limiting luminal narrowing with ICA peak systolic velocity within normal limits.",
  "impressionText": "{side} {location} carotid plaque ({morphology}) without haemodynamically significant stenosis.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"location\", \"label\": \"Location\", \"type\": \"select\", \"options\": [\"carotid bulb\", \"proximal ICA\", \"CCA\", \"ECA\"], \"default\": \"carotid bulb\"}, {\"key\": \"morphology\", \"label\": \"Morphology\", \"type\": \"select\", \"options\": [\"homogeneous echolucent (soft)\", \"heterogeneous mixed\", \"densely calcified\"], \"default\": \"heterogeneous mixed\"}, {\"key\": \"surface\", \"label\": \"Surface\", \"type\": \"select\", \"options\": [\"smooth\", \"irregular\", \"ulcerated\"], \"default\": \"smooth\"}]"
 },
 {
  "studyType": "Carotid Doppler",
  "label": "ICA Stenosis (Velocity-Graded)",
  "findingText": "{side} internal carotid artery shows an atherosclerotic plaque causing luminal narrowing, with ICA PSV of {psv} cm/s and an ICA/CCA ratio of {ratio}, in keeping with {grade} stenosis by velocity criteria (NASCET/SRU consensus).",
  "impressionText": "{side} ICA stenosis, {grade} by velocity criteria.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"grade\", \"label\": \"Grade\", \"type\": \"select\", \"options\": [\"<50%\", \"50-69%\", \"70-99% (severe)\", \"near-occlusion\", \"total occlusion\"], \"default\": \"50-69%\", \"required\": true}, {\"key\": \"psv\", \"label\": \"ICA PSV (cm/s)\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"ratio\", \"label\": \"ICA/CCA Ratio\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "CECT Abdomen",
  "label": "Acute Appendicitis",
  "findingText": "The appendix is dilated to {diameter} mm with wall thickening and periappendiceal fat stranding. {appendicolith} {collection}",
  "impressionText": "Acute appendicitis.",
  "techniqueText": "",
  "recommendationText": "Surgical correlation.",
  "questionsJson": "[{\"key\":\"diameter\",\"label\":\"Diameter (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"appendicolith\",\"label\":\"Appendicolith\",\"type\":\"select\",\"options\":[\"No appendicolith.\",\"An appendicolith is present.\"],\"default\":\"No appendicolith.\"},{\"key\":\"collection\",\"label\":\"Collection\",\"type\":\"select\",\"options\":[\"No periappendiceal collection.\",\"With a periappendiceal collection.\"],\"default\":\"No periappendiceal collection.\"}]"
 },
 {
  "studyType": "CECT Abdomen",
  "label": "Appendicitis",
  "findingText": "The appendix is dilated ({diameter} mm) with mural thickening and periappendiceal fat stranding{abscess}.",
  "impressionText": "Acute appendicitis.",
  "techniqueText": "",
  "recommendationText": "Surgical correlation.",
  "questionsJson": "[{\"key\":\"diameter\",\"label\":\"Diameter (mm)\",\"type\":\"text\",\"default\":\"10\"},{\"key\":\"abscess\",\"label\":\"Collection\",\"type\":\"select\",\"options\":[\"\",\" with periappendiceal collection\"],\"default\":\"\"}]"
 },
 {
  "studyType": "CECT Abdomen",
  "label": "Bowel Obstruction",
  "findingText": "Dilated {bowel} loops with a transition point in the {location}. {ischemia}",
  "impressionText": "{bowel} obstruction.",
  "techniqueText": "",
  "recommendationText": "Surgical correlation.",
  "questionsJson": "[{\"key\":\"bowel\",\"label\":\"Bowel\",\"type\":\"select\",\"options\":[\"small bowel\",\"large bowel\"],\"default\":\"small bowel\"},{\"key\":\"location\",\"label\":\"Transition point\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"ischemia\",\"label\":\"Ischemia\",\"type\":\"select\",\"options\":[\"No features of ischemia.\",\"With features suggesting ischemia.\"],\"default\":\"No features of ischemia.\"}]"
 },
 {
  "studyType": "CECT Abdomen",
  "label": "Cholecystitis",
  "findingText": "Gallbladder wall thickening with pericholecystic fluid and fat stranding. Stones {stones}.",
  "impressionText": "Acute cholecystitis.",
  "techniqueText": "",
  "recommendationText": "Surgical / GI correlation.",
  "questionsJson": "[{\"key\":\"stones\",\"label\":\"Stones\",\"type\":\"select\",\"options\":[\"present\",\"not clearly seen\"],\"default\":\"present\"}]"
 },
 {
  "studyType": "CECT Abdomen",
  "label": "Liver Lesion",
  "findingText": "A lesion is noted in segment {segment} of the liver, measuring {size} mm, showing {enhancement}.",
  "impressionText": "Segment {segment} hepatic lesion ({size} mm).",
  "techniqueText": "",
  "recommendationText": "MRI / MRCP for characterization. LI-RADS categorization if at-risk.",
  "questionsJson": "[{\"key\":\"segment\",\"label\":\"Segment\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"enhancement\",\"label\":\"Enhancement\",\"type\":\"select\",\"options\":[\"arterial hyperenhancement with washout\",\"peripheral discontinuous nodular enhancement\",\"no significant enhancement\"],\"default\":\"no significant enhancement\"}]"
 },
 {
  "studyType": "Cervical Length",
  "label": "Cervical Length — Post-Cerclage",
  "findingText": "Cervical length measures {cl} mm distal to a cervical cerclage suture, which is seen in situ.",
  "impressionText": "Post-cerclage cervical length {cl} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"cl\", \"label\": \"Cervical length distal to cerclage (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Cervical Length",
  "label": "Cervical Length Measurement",
  "findingText": "Transvaginal cervical length measures {cl} mm.[ {funneling}.]",
  "impressionText": "Cervical length {cl} mm.[ {funneling}.]",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"cl\", \"label\": \"Cervical length (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"funneling\", \"label\": \"Funneling\", \"type\": \"select\", \"options\": [\"Normal\", \"Funneling of the internal os is present, with cervical canal shortening toward the external os\"], \"default\": \"Normal\"}]"
 },
 {
  "studyType": "Cervical Spine",
  "label": "Disc Bulge",
  "findingText": "Posterior disc-osteophyte complex at {level} indenting the thecal sac[ causing {cord_compression} cord compression][ with {myelomalacia} myelomalacic cord signal change][ with {foramina} neural foraminal narrowing][ causing {canal} central canal stenosis].",
  "impressionText": "{level} disc-osteophyte complex[ with {cord_compression} cord compression][ with myelomalacia].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[\r\n    {\"key\":\"level\",\"label\":\"Level\",\"type\":\"select\",\"options\":[\"C2-C3\",\"C3-C4\",\"C4-C5\",\"C5-C6\",\"C6-C7\",\"C7-T1\"],\"default\":\"C5-C6\",\"required\":true,\"sortOrder\":1},\r\n    {\"key\":\"cord_compression\",\"label\":\"Cord Compression\",\"type\":\"select\",\"options\":[\"None\",\"mild\",\"moderate\",\"severe\"],\"default\":\"None\",\"sortOrder\":2},\r\n    {\"key\":\"myelomalacia\",\"label\":\"Myelomalacia\",\"type\":\"select\",\"options\":[\"None\",\"focal\"],\"default\":\"None\",\"sortOrder\":3},\r\n    {\"key\":\"foramina\",\"label\":\"Foraminal Narrowing\",\"type\":\"select\",\"options\":[\"Normal\",\"mild\",\"moderate\",\"severe\"],\"default\":\"Normal\",\"sortOrder\":4},\r\n    {\"key\":\"canal\",\"label\":\"Canal Stenosis\",\"type\":\"select\",\"options\":[\"Normal\",\"mild\",\"moderate\",\"severe\"],\"default\":\"Normal\",\"sortOrder\":5}\r\n  ]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "Acute Infarct",
  "findingText": "Loss of grey-white differentiation with hypodensity in the {territory} vascular territory, in keeping with an acute infarct. ASPECTS {aspects}.",
  "impressionText": "Acute {territory} territory infarct.",
  "techniqueText": "",
  "recommendationText": "Urgent stroke-team correlation. MRI DWI for confirmation and extent.",
  "questionsJson": "[{\"key\":\"territory\",\"label\":\"Territory\",\"type\":\"select\",\"options\":[\"right MCA\",\"left MCA\",\"right ACA\",\"left ACA\",\"right PCA\",\"left PCA\",\"posterior fossa\"],\"default\":\"right MCA\"},{\"key\":\"aspects\",\"label\":\"ASPECTS\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "Acute MCA infarct",
  "findingText": "Hypodensity in the {side} MCA territory with loss of grey-white differentiation{swelling}.",
  "impressionText": "Acute {side} MCA territory infarct.",
  "techniqueText": "",
  "recommendationText": "Stroke pathway / neurology review. Consider CTA / perfusion as per protocol.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"left\",\"right\"],\"default\":\"left\"},{\"key\":\"swelling\",\"label\":\"Swelling\",\"type\":\"select\",\"options\":[\"\",\" with mild mass effect\",\" with significant mass effect\"],\"default\":\"\"}]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "Hydrocephalus",
  "findingText": "Dilatation of the {ventricles} with features suggesting {type} hydrocephalus.",
  "impressionText": "{type} hydrocephalus.",
  "techniqueText": "",
  "recommendationText": "Neurosurgical correlation.",
  "questionsJson": "[{\"key\":\"ventricles\",\"label\":\"Ventricles\",\"type\":\"text\",\"default\":\"lateral and third ventricles\"},{\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"obstructive\",\"communicating\"],\"default\":\"obstructive\"}]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "ICH",
  "findingText": "Acute intraparenchymal haemorrhage in the {location} measuring approximately {size} cm{ivh}.",
  "impressionText": "Acute ICH ({location}).",
  "techniqueText": "",
  "recommendationText": "Neurosurgery / stroke team notification as per critical pathway.",
  "questionsJson": "[{\"key\":\"location\",\"label\":\"Location\",\"type\":\"text\",\"default\":\"basal ganglia\"},{\"key\":\"size\",\"label\":\"Size (cm)\",\"type\":\"text\",\"default\":\"2\"},{\"key\":\"ivh\",\"label\":\"IVH\",\"type\":\"select\",\"options\":[\"\",\" with intraventricular extension\"],\"default\":\"\"}]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "Intracranial Hemorrhage",
  "findingText": "An acute intraparenchymal hemorrhage is noted in the {location}, measuring approximately {volume} ml (ABC/2). {mass_effect}",
  "impressionText": "Acute {location} intracranial hemorrhage.",
  "techniqueText": "",
  "recommendationText": "Immediate neurosurgical correlation. Follow-up CT to assess for expansion.",
  "questionsJson": "[{\"key\":\"location\",\"label\":\"Location\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"volume\",\"label\":\"Volume (ml, ABC/2)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"mass_effect\",\"label\":\"Mass effect\",\"type\":\"select\",\"options\":[\"No significant mass effect.\",\"With surrounding edema and mass effect.\"],\"default\":\"No significant mass effect.\"}]"
 },
 {
  "studyType": "CT Brain Plain",
  "label": "Midline Shift",
  "findingText": "There is midline shift of {shift} mm to the {side}.",
  "impressionText": "Midline shift of {shift} mm.",
  "techniqueText": "",
  "recommendationText": "Immediate neurosurgical correlation.",
  "questionsJson": "[{\"key\":\"shift\",\"label\":\"Shift (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"}]"
 },
 {
  "studyType": "CT Cervical Spine",
  "label": "Vertebral Fracture",
  "findingText": "A fracture is noted involving the {level} vertebra with {height_loss}% body-height loss{retropulsion}. The injury is considered {stability}.",
  "impressionText": "{level} vertebral fracture ({stability}).",
  "techniqueText": "",
  "recommendationText": "Spine-surgery correlation. MRI for cord/ligamentous injury.",
  "questionsJson": "[{\"key\":\"level\",\"label\":\"Level\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"height_loss\",\"label\":\"Height loss (%)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"retropulsion\",\"label\":\"Retropulsion\",\"type\":\"select\",\"options\":[\"\",\" with retropulsion and canal compromise\"],\"default\":\"\"},{\"key\":\"stability\",\"label\":\"Stability\",\"type\":\"select\",\"options\":[\"stable\",\"unstable\"],\"default\":\"stable\"}]"
 },
 {
  "studyType": "CT KUB",
  "label": "Hydronephrosis",
  "findingText": "The {side} pelvicalyceal system is dilated, consistent with {grade} hydronephrosis.",
  "impressionText": "{side} {grade} hydronephrosis.",
  "techniqueText": "",
  "recommendationText": "Correlate with renal function; urology referral if obstructing.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\"},{\"key\":\"grade\",\"label\":\"Grade\",\"type\":\"select\",\"options\":[\"mild\",\"moderate\",\"gross\"],\"default\":\"mild\"}]"
 },
 {
  "studyType": "CT KUB",
  "label": "Renal Calculus",
  "findingText": "A calculus is noted in the {side} {location}, measuring {size} mm with density of {hu} HU.",
  "impressionText": "{side} {location} calculus ({size} mm).",
  "techniqueText": "",
  "recommendationText": "Urology correlation. Follow-up to confirm passage.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\"},{\"key\":\"location\",\"label\":\"Location\",\"type\":\"select\",\"options\":[\"upper calyx\",\"interpolar calyx\",\"lower calyx\",\"renal pelvis\"],\"default\":\"renal pelvis\"},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"hu\",\"label\":\"Density (HU)\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "CT KUB",
  "label": "Ureteric Calculus",
  "findingText": "A calculus is noted in the {side} {level} ureter, measuring {size} mm, with upstream {side} hydroureteronephrosis.",
  "impressionText": "{side} {level} ureteric calculus with obstruction.",
  "techniqueText": "",
  "recommendationText": "Urology correlation. Emergency referral if infected obstruction.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"level\",\"label\":\"Level\",\"type\":\"select\",\"options\":[\"proximal\",\"mid\",\"distal (VUJ)\"],\"default\":\"distal (VUJ)\"},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "CT Pulmonary Angiography",
  "label": "Pulmonary Embolism",
  "findingText": "A filling defect is noted in the {level} pulmonary artery/arteries. {saddle} RV:LV ratio {rvlv}.",
  "impressionText": "Pulmonary thromboembolism ({level}).",
  "techniqueText": "",
  "recommendationText": "Anticoagulation per protocol. Echocardiography if right-heart strain.",
  "questionsJson": "[{\"key\":\"level\",\"label\":\"Level\",\"type\":\"select\",\"options\":[\"main\",\"right main\",\"left main\",\"lobar\",\"segmental\",\"subsegmental\"],\"default\":\"segmental\"},{\"key\":\"saddle\",\"label\":\"Saddle\",\"type\":\"select\",\"options\":[\"\",\"A saddle embolus is present.\"],\"default\":\"\"},{\"key\":\"rvlv\",\"label\":\"RV:LV ratio\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "Dating",
  "label": "CRL-Based Dating",
  "findingText": "Crown-rump length measures {crl} mm. Based on CRL (Robinson & Fleming formula), the estimated gestational age is {ga} and the estimated date of delivery is {edd}.",
  "impressionText": "Singleton intrauterine pregnancy dated by CRL at {ga}; EDD {edd}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"crl\", \"label\": \"CRL (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"ga\", \"label\": \"Gestational age (CRL-based)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"edd\", \"label\": \"EDD\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Dating",
  "label": "Dating Discordant from LMP",
  "findingText": "CRL-based gestational age of {gaCrl} differs from the LMP-based gestational age of {gaLmp} by more than 7 days. Per standard first-trimester dating criteria, {action}.",
  "impressionText": "Dating discordance between CRL and LMP of more than 7 days; {action}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"gaLmp\", \"label\": \"LMP-based GA\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"gaCrl\", \"label\": \"CRL-based GA\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"action\", \"label\": \"Dating decision\", \"type\": \"select\", \"options\": [\"EDD is revised to the CRL-based estimate\", \"LMP-based EDD is retained given a reliable menstrual history\"], \"default\": \"EDD is revised to the CRL-based estimate\", \"required\": true}]"
 },
 {
  "studyType": "Early Pregnancy",
  "label": "Corpus Luteal Cyst",
  "findingText": "A simple thin-walled cystic structure is noted in the {side} adnexa, measuring {size} mm, in keeping with a corpus luteal cyst of pregnancy.",
  "impressionText": "{side} corpus luteal cyst of pregnancy, {size} mm — physiological, no follow-up required unless symptomatic.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Early Pregnancy",
  "label": "Live Embryo with Cardiac Activity",
  "findingText": "A single live embryo is identified with a crown-rump length of {crl} mm, corresponding to CRL-based gestational age. Cardiac activity is present, with a fetal heart rate of {fhr} bpm.",
  "impressionText": "Single live intrauterine pregnancy, CRL {crl} mm, cardiac activity present.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"crl\", \"label\": \"CRL (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"fhr\", \"label\": \"Fetal heart rate (bpm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Early Pregnancy",
  "label": "Normal Intrauterine Gestational Sac",
  "findingText": "A single intrauterine gestational sac is seen in the {location}, measuring {gs} mm in mean diameter, with a well-formed yolk sac measuring {ys} mm.",
  "impressionText": "Single intrauterine gestational sac, GS {gs} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"location\", \"label\": \"Location\", \"type\": \"select\", \"options\": [\"fundal\", \"mid-cavity\", \"lower uterine segment\"], \"default\": \"fundal\"}, {\"key\": \"gs\", \"label\": \"GS mean diameter (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"ys\", \"label\": \"YS diameter (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Early Pregnancy",
  "label": "Twin Gestation Sacs Identified",
  "findingText": "Two intrauterine gestational sacs are identified, {chorionicity}. Detailed per-fetus biometry and formal chorionicity assessment are recommended.",
  "impressionText": "Twin intrauterine pregnancy, {chorionicity} — see Multiple Pregnancy protocol for detailed follow-up.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"chorionicity\", \"label\": \"Chorionicity/amnionicity (provisional)\", \"type\": \"select\", \"options\": [\"dichorionic diamniotic\", \"monochorionic diamniotic\", \"monochorionic monoamniotic\", \"indeterminate at this stage\"], \"default\": \"indeterminate at this stage\", \"required\": true}]"
 },
 {
  "studyType": "Endometrium",
  "label": "Endometrial Hyperplasia",
  "findingText": "Endometrium is diffusely thickened, measuring {thicknessMm} mm, with {pattern} echotexture, a regular endo-myometrial junction, and no discrete focal lesion, in keeping with endometrial hyperplasia.",
  "impressionText": "Endometrial thickening ({thicknessMm} mm), favour endometrial hyperplasia; histopathological correlation advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"thicknessMm\", \"label\": \"Thickness (mm)\", \"type\": \"text\", \"required\": true}, {\"key\": \"pattern\", \"label\": \"Echotexture\", \"type\": \"select\", \"options\": [\"homogeneous\", \"heterogeneous\"], \"default\": \"homogeneous\", \"required\": false}]"
 },
 {
  "studyType": "Endometrium",
  "label": "Endometrial Polyp",
  "findingText": "A well-defined echogenic intracavitary lesion with a feeding vascular pedicle on colour Doppler is noted, measuring approximately {sizeMm} mm, in keeping with an endometrial polyp.",
  "impressionText": "Endometrial polyp, {sizeMm} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": false}]"
 },
 {
  "studyType": "Endometrium",
  "label": "IUD In Situ",
  "findingText": "An echogenic intrauterine device is noted; position is assessed as {position} relative to the endometrial cavity and internal os.",
  "impressionText": "IUD {position}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"position\", \"label\": \"Position\", \"type\": \"select\", \"options\": [\"well-positioned\", \"low-lying\", \"malpositioned/embedded\"], \"default\": \"well-positioned\", \"required\": true}]"
 },
 {
  "studyType": "Endometrium",
  "label": "Suspicious Endometrial Mass",
  "findingText": "Endometrium is markedly thickened and heterogeneous, measuring {thicknessMm} mm, with an irregular endo-myometrial junction and increased vascularity on colour Doppler, raising concern for endometrial malignancy.",
  "impressionText": "Thickened, vascular, irregular endometrium ({thicknessMm} mm) — endometrial malignancy cannot be excluded; urgent histopathological correlation advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"thicknessMm\", \"label\": \"Thickness (mm)\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Follicular Study",
  "label": "Day-wise Follicular Monitoring",
  "findingText": "Cycle Day {cycleDay}: Right ovary shows {rightCount} follicle(s), dominant follicle measuring {rightDominantMm} mm. Left ovary shows {leftCount} follicle(s), dominant follicle measuring {leftDominantMm} mm. Endometrium measures {endoThicknessMm} mm, {endoPattern} pattern.",
  "impressionText": "Day {cycleDay} follicular study — dominant follicle {rightDominantMm}/{leftDominantMm} mm, endometrium {endoThicknessMm} mm ({endoPattern}).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"cycleDay\", \"label\": \"Cycle day\", \"type\": \"text\", \"required\": true}, {\"key\": \"rightCount\", \"label\": \"Right — follicle count\", \"type\": \"text\", \"required\": false}, {\"key\": \"rightDominantMm\", \"label\": \"Right — dominant follicle (mm)\", \"type\": \"text\", \"required\": false}, {\"key\": \"leftCount\", \"label\": \"Left — follicle count\", \"type\": \"text\", \"required\": false}, {\"key\": \"leftDominantMm\", \"label\": \"Left — dominant follicle (mm)\", \"type\": \"text\", \"required\": false}, {\"key\": \"endoThicknessMm\", \"label\": \"Endometrial thickness (mm)\", \"type\": \"text\", \"required\": true}, {\"key\": \"endoPattern\", \"label\": \"Endometrial pattern\", \"type\": \"select\", \"options\": [\"trilaminar\", \"non-trilaminar\"], \"default\": \"trilaminar\", \"required\": true}]"
 },
 {
  "studyType": "Follicular Study",
  "label": "Mature Pre-ovulatory Follicle",
  "findingText": "A dominant pre-ovulatory follicle measuring {sizeMm} mm is noted in the {side} ovary, with a peripheral cumulus oophorus complex, in keeping with imminent ovulation.",
  "impressionText": "{side} dominant follicle, {sizeMm} mm — criteria for trigger/imminent ovulation appear met; correlate with clinical protocol.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Growth",
  "label": "FGR — Doppler Assessment",
  "findingText": "Fetal growth restriction is {type}. Umbilical artery PI is {uaPi} and MCA PI is {mcaPi}, giving a cerebroplacental ratio category of {category}.",
  "impressionText": "{type} fetal growth restriction with {category} Doppler pattern — closer surveillance advised as per obstetric team.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"type\", \"label\": \"Pattern\", \"type\": \"select\", \"options\": [\"symmetric\", \"asymmetric\"], \"default\": \"asymmetric\", \"required\": true}, {\"key\": \"uaPi\", \"label\": \"UA PI\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"mcaPi\", \"label\": \"MCA PI\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"category\", \"label\": \"Doppler category\", \"type\": \"select\", \"options\": [\"normal (no redistribution)\", \"brain-sparing (redistribution)\", \"absent/reversed end-diastolic flow\"], \"default\": \"normal (no redistribution)\", \"required\": true}]"
 },
 {
  "studyType": "Hepatic Doppler",
  "label": "Budd-Chiari (Hepatic Vein Obstruction)",
  "findingText": "The hepatic veins show {pattern}, with a plump, heterogeneous caudate lobe and intrahepatic venous collaterals, in keeping with hepatic venous outflow obstruction (Budd-Chiari pattern).",
  "impressionText": "Hepatic venous outflow obstruction (Budd-Chiari pattern).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"pattern\", \"label\": \"Pattern\", \"type\": \"select\", \"options\": [\"absent/non-visualised hepatic vein flow\", \"flat/monophasic hepatic vein waveform with intrahepatic collaterals\"], \"default\": \"absent/non-visualised hepatic vein flow\", \"required\": true}]"
 },
 {
  "studyType": "Hepatic Doppler",
  "label": "Hepatic Artery Stenosis (Post-Transplant)",
  "findingText": "The hepatic artery at the {location} shows focal velocity elevation exceeding 200 cm/s with post-stenotic turbulence and a tardus-parvus waveform in the intrahepatic branches, in keeping with hepatic artery stenosis.",
  "impressionText": "Hepatic artery stenosis at the {location} — correlate urgently with the transplant team.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"location\", \"label\": \"Location\", \"type\": \"select\", \"options\": [\"anastomotic site\", \"proximal to the anastomosis\"], \"default\": \"anastomotic site\", \"required\": true}]"
 },
 {
  "studyType": "Hepatic Doppler",
  "label": "Portal Vein Thrombosis",
  "findingText": "The portal vein shows echogenic intraluminal material with {extent} loss of colour flow, with {vascularity} on spectral interrogation of the thrombus, in keeping with portal vein thrombosis[ with {cavernoma} periportal cavernomatous collateral formation, indicating chronicity].",
  "impressionText": "{extent} portal vein thrombosis ({vascularity})[ with {cavernoma} cavernomatous transformation].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"extent\", \"label\": \"Extent\", \"type\": \"select\", \"options\": [\"partial (non-occlusive)\", \"complete (occlusive)\"], \"default\": \"partial (non-occlusive)\", \"required\": true}, {\"key\": \"vascularity\", \"label\": \"Thrombus vascularity\", \"type\": \"select\", \"options\": [\"bland (no internal arterial signal — non-tumoral)\", \"tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion)\"], \"default\": \"bland (no internal arterial signal — non-tumoral)\", \"required\": true}, {\"key\": \"cavernoma\", \"label\": \"Cavernomatous transformation\", \"type\": \"select\", \"options\": [\"None\", \"associated\"], \"default\": \"None\"}]"
 },
 {
  "studyType": "Hernia",
  "label": "Irreducible/Incarcerated Hernia",
  "findingText": "A {side} groin/abdominal wall defect contains {contents} which do not reduce with compression or on lying supine[, with {strangulationSigns}].",
  "impressionText": "{side} irreducible hernia containing {contents}[, with {strangulationSigns}] — clinical correlation for possible incarceration/strangulation advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"contents\", \"label\": \"Contents\", \"type\": \"select\", \"options\": [\"omental fat\", \"small bowel loops\", \"large bowel\"], \"default\": \"omental fat\", \"required\": true}, {\"key\": \"strangulationSigns\", \"label\": \"Strangulation signs\", \"type\": \"select\", \"options\": [\"None\", \"bowel wall thickening, reduced peristalsis, and hyperaemia concerning for compromised bowel\"], \"default\": \"None\", \"required\": false}]"
 },
 {
  "studyType": "Hernia",
  "label": "Reducible Inguinal Hernia",
  "findingText": "A defect is noted in the {side} inguinal canal through which {contents} protrude on Valsalva maneuver/standing, with free reduction on supine positioning and gentle compression. No bowel wall thickening or free fluid is seen.",
  "impressionText": "{side} reducible inguinal hernia containing {contents}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"contents\", \"label\": \"Contents\", \"type\": \"select\", \"options\": [\"omental fat\", \"small bowel loops\", \"large bowel\"], \"default\": \"omental fat\", \"required\": true}]"
 },
 {
  "studyType": "Hernia",
  "label": "Umbilical Hernia",
  "findingText": "A ventral abdominal wall defect is noted at the umbilicus, measuring approximately {size} mm, through which {contents} protrudes on Valsalva maneuver, reducing spontaneously in the supine relaxed position.",
  "impressionText": "Umbilical hernia ({size} mm) containing {contents}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"size\", \"label\": \"Defect size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"contents\", \"label\": \"Contents\", \"type\": \"select\", \"options\": [\"omental fat\", \"bowel\"], \"default\": \"omental fat\", \"required\": true}]"
 },
 {
  "studyType": "HRCT Chest",
  "label": "Bronchiectasis",
  "findingText": "Bronchial dilatation with lack of tapering, in keeping with {type} bronchiectasis in the {zone} zones.",
  "impressionText": "{type} bronchiectasis.",
  "techniqueText": "",
  "recommendationText": "Correlate clinically; sputum culture as indicated.",
  "questionsJson": "[{\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"traction\",\"cylindrical\",\"varicose\",\"cystic\"],\"default\":\"cylindrical\"},{\"key\":\"zone\",\"label\":\"Zone\",\"type\":\"text\",\"default\":\"lower\"}]"
 },
 {
  "studyType": "HRCT Chest",
  "label": "Ground-glass Opacities",
  "findingText": "Patchy ground-glass opacities are noted in a {distribution} distribution.",
  "impressionText": "Ground-glass opacities.",
  "techniqueText": "",
  "recommendationText": "Correlate clinically; consider active inflammation/infection.",
  "questionsJson": "[{\"key\":\"distribution\",\"label\":\"Distribution\",\"type\":\"text\",\"default\":\"bilateral\"}]"
 },
 {
  "studyType": "HRCT Chest",
  "label": "Honeycombing",
  "findingText": "Clustered subpleural cystic air spaces with shared walls, in keeping with honeycombing, most marked in the {zone} zones.",
  "impressionText": "Honeycombing ({zone} predominant).",
  "techniqueText": "",
  "recommendationText": "ILD-MDT correlation.",
  "questionsJson": "[{\"key\":\"zone\",\"label\":\"Zone\",\"type\":\"select\",\"options\":[\"lower\",\"upper\",\"mid\"],\"default\":\"lower\"}]"
 },
 {
  "studyType": "Infertility",
  "label": "Baseline Infertility Survey - Normal",
  "findingText": "Uterus is normal in size, position, and myometrial echotexture with no congenital anomaly. Endometrium measures {endoThicknessMm} mm. Right ovary shows an antral follicle count of {rightAFC} (2-9 mm), normal volume. Left ovary shows an antral follicle count of {leftAFC} (2-9 mm), normal volume. No hydrosalpinx or adnexal mass. No free fluid.",
  "impressionText": "Normal baseline infertility survey; bilateral antral follicle count within normal range (right {rightAFC}, left {leftAFC}).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"rightAFC\", \"label\": \"Right AFC\", \"type\": \"text\", \"required\": true}, {\"key\": \"leftAFC\", \"label\": \"Left AFC\", \"type\": \"text\", \"required\": true}, {\"key\": \"endoThicknessMm\", \"label\": \"Endometrial thickness (mm)\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Infertility",
  "label": "Congenital Uterine Anomaly Suspected",
  "findingText": "The endometrial cavity/uterine fundal contour demonstrates a configuration suggestive of a {type} uterus. 3D ultrasound or MR correlation is advised for definitive subclassification.",
  "impressionText": "Suspected {type} uterus — further characterization (3D USG/MRI/hysterosalpingography) advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"type\", \"label\": \"Suspected anomaly type\", \"type\": \"select\", \"options\": [\"septate\", \"bicornuate\", \"arcuate\", \"unicornuate\", \"didelphys\"], \"default\": \"septate\", \"required\": true}]"
 },
 {
  "studyType": "Infertility",
  "label": "Diminished Ovarian Reserve Pattern",
  "findingText": "Both ovaries are reduced in volume with a low combined antral follicle count (right {rightAFC}, left {leftAFC}), in keeping with diminished ovarian reserve.",
  "impressionText": "Sonographic features of diminished ovarian reserve — correlate with AMH/FSH.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"rightAFC\", \"label\": \"Right AFC\", \"type\": \"text\", \"required\": true}, {\"key\": \"leftAFC\", \"label\": \"Left AFC\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Infertility",
  "label": "Polycystic Ovarian Morphology (PCOM)",
  "findingText": "Right ovary shows {rightCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity. Left ovary shows {leftCount} peripherally arranged follicles (2-9 mm) with increased ovarian volume and stromal echogenicity, meeting PCOM criteria (20 or more follicles per ovary and/or ovarian volume of 10 mL or more, per current international PCOS ultrasound consensus).",
  "impressionText": "Bilateral polycystic ovarian morphology (PCOM) — correlate clinically/biochemically for PCOS (Rotterdam criteria require 2 of 3: oligo/anovulation, clinical/biochemical hyperandrogenism, PCOM).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"rightCount\", \"label\": \"Right — follicle count\", \"type\": \"text\", \"required\": true}, {\"key\": \"leftCount\", \"label\": \"Left — follicle count\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "KUB",
  "label": "Elevated Post-Void Residual",
  "findingText": "Post-void residual urine volume is estimated at approximately {volume} mL, which is elevated for age, in keeping with incomplete bladder emptying.",
  "impressionText": "Elevated post-void residual ({volume} mL) — incomplete bladder emptying.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"volume\", \"label\": \"PVR volume (mL)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "KUB",
  "label": "Hydronephrosis",
  "findingText": "{side} kidney shows {grade} hydronephrosis with dilated pelvicalyceal system.",
  "impressionText": "{side} {grade} hydronephrosis.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\",\"required\":true,\"sortOrder\":1},{\"key\":\"grade\",\"label\":\"Grade\",\"type\":\"select\",\"options\":[\"mild\",\"moderate\",\"gross\"],\"default\":\"mild\",\"required\":true,\"sortOrder\":2}]"
 },
 {
  "studyType": "KUB",
  "label": "Renal Calculus",
  "findingText": "An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} kidney. No upstream hydronephrosis.",
  "impressionText": "{side} renal calculus.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\",\"required\":true,\"sortOrder\":1},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":2}]"
 },
 {
  "studyType": "KUB",
  "label": "Ureteric Calculus",
  "findingText": "An echogenic focus with posterior acoustic shadowing, measuring approximately {size} mm, is noted in the {side} ureter at the {level} level, with upstream {side} hydroureteronephrosis.",
  "impressionText": "{side} {level} ureteric calculus with hydroureteronephrosis.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"level\", \"label\": \"Level\", \"type\": \"select\", \"options\": [\"proximal\", \"mid\", \"distal (VUJ)\"], \"default\": \"distal (VUJ)\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "LS Spine",
  "label": "Disc Bulge",
  "findingText": "{type} posterior disc bulge is seen at {level}[ {thecal_sac}][ with {foramina} bilateral neural foraminal narrowing][ causing {canal} central canal stenosis][ and impingement upon the traversing {nerve_root} nerve root].",
  "impressionText": "{type} posterior disc bulge at {level}[ with {foramina} bilateral neural foraminal narrowing][ and {nerve_root} nerve root impingement].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[\r\n    {\"key\":\"level\",\"label\":\"Level\",\"type\":\"select\",\"options\":[\"L1-L2\",\"L2-L3\",\"L3-L4\",\"L4-L5\",\"L5-S1\"],\"default\":\"L4-L5\",\"required\":true,\"sortOrder\":1},\r\n    {\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"Diffuse\",\"Focal\",\"Broad-based\",\"Central\",\"Paracentral\"],\"default\":\"Diffuse\",\"sortOrder\":2},\r\n    {\"key\":\"thecal_sac\",\"label\":\"Thecal Sac\",\"type\":\"select\",\"options\":[\"causing indentation over the anterior thecal sac\",\"effacing the anterior thecal sac\",\"Normal\"],\"default\":\"causing indentation over the anterior thecal sac\",\"sortOrder\":3},\r\n    {\"key\":\"foramina\",\"label\":\"Neural Foramina\",\"type\":\"select\",\"options\":[\"Normal\",\"mild\",\"moderate\",\"severe\"],\"default\":\"Normal\",\"sortOrder\":4},\r\n    {\"key\":\"canal\",\"label\":\"Canal Stenosis\",\"type\":\"select\",\"options\":[\"Normal\",\"mild\",\"moderate\",\"severe\"],\"default\":\"Normal\",\"sortOrder\":5},\r\n    {\"key\":\"nerve_root\",\"label\":\"Nerve Root\",\"type\":\"select\",\"options\":[\"None\",\"L4\",\"L5\",\"S1\",\"bilateral L5\",\"bilateral S1\"],\"default\":\"None\",\"sortOrder\":6}\r\n  ]"
 },
 {
  "studyType": "MSK",
  "label": "Ankle Ligament Injury (ATFL)",
  "findingText": "The {side} anterior talofibular ligament (ATFL) is thickened and hypoechoic, in keeping with {grade}, with associated anterolateral ankle joint effusion.",
  "impressionText": "{side} ATFL injury — {grade}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"grade\", \"label\": \"Grade\", \"type\": \"select\", \"options\": [\"Grade I (sprain, no discontinuity)\", \"Grade II (partial tear)\", \"Grade III (complete tear)\"], \"default\": \"Grade I (sprain, no discontinuity)\", \"required\": true}]"
 },
 {
  "studyType": "MSK",
  "label": "Carpal Tunnel Syndrome",
  "findingText": "The {side} median nerve is swollen and hypoechoic at the level of the carpal tunnel inlet, measuring approximately {csa} mm2 in cross-sectional area, with flattening of the nerve at the tunnel outlet, in keeping with median nerve entrapment (carpal tunnel syndrome).",
  "impressionText": "{side} carpal tunnel syndrome (median nerve entrapment).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"csa\", \"label\": \"Median nerve CSA (mm2)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "MSK",
  "label": "Knee Joint Effusion",
  "findingText": "Anechoic fluid is noted within the {side} suprapatellar recess, {quantity} in quantity, with no significant synovial thickening or intra-articular loose body.",
  "impressionText": "{side} {quantity} knee joint effusion.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"quantity\", \"label\": \"Quantity\", \"type\": \"select\", \"options\": [\"mild\", \"moderate\", \"gross\"], \"default\": \"mild\", \"required\": true}]"
 },
 {
  "studyType": "MSK",
  "label": "Rotator Cuff Tear",
  "findingText": "A {tearType} tear of the {side} supraspinatus tendon is noted, with a defect measuring approximately {size} mm and associated tendon retraction/discontinuity.",
  "impressionText": "{side} supraspinatus {tearType} tear.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"tearType\", \"label\": \"Tear type\", \"type\": \"select\", \"options\": [\"partial-thickness (articular surface)\", \"partial-thickness (bursal surface)\", \"full-thickness\"], \"default\": \"full-thickness\", \"required\": true}, {\"key\": \"size\", \"label\": \"Defect size (mm)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "Multiple Pregnancy",
  "label": "Dichorionic Diamniotic Twin Pregnancy",
  "findingText": "Two separate gestational sacs are identified, each with its own placenta. A thick intervening membrane demonstrating a {sign} is seen at the placental-membrane junction, in keeping with dichorionic diamniotic (DCDA) twin pregnancy.",
  "impressionText": "Dichorionic diamniotic twin pregnancy.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"sign\", \"label\": \"Membrane sign\", \"type\": \"select\", \"options\": [\"lambda (twin peak) sign\", \"thick membrane, two separate placentas\"], \"default\": \"lambda (twin peak) sign\", \"required\": true}]"
 },
 {
  "studyType": "Multiple Pregnancy",
  "label": "Fetal Growth Discordance <20%",
  "findingText": "Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, within the expected range.",
  "impressionText": "Inter-twin EFW discordance {discordancePercent}% — not significant.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"efwA\", \"label\": \"Twin A EFW (g)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"efwB\", \"label\": \"Twin B EFW (g)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"discordancePercent\", \"label\": \"Discordance (%)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Multiple Pregnancy",
  "label": "Fetal Growth Discordance ≥20%",
  "findingText": "Estimated fetal weight is {efwA} g for Twin A and {efwB} g for Twin B, an inter-twin discordance of {discordancePercent}%, exceeding the 20% threshold associated with adverse perinatal outcome.",
  "impressionText": "Significant inter-twin growth discordance ({discordancePercent}%) — obstetric correlation and closer surveillance advised; exclude selective FGR/TTTS in monochorionic pregnancies.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"efwA\", \"label\": \"Twin A EFW (g)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"efwB\", \"label\": \"Twin B EFW (g)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"discordancePercent\", \"label\": \"Discordance (%)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Multiple Pregnancy",
  "label": "TTTS Screening — Monochorionic Twins",
  "findingText": "In this monochorionic twin pregnancy, the donor twin's amniotic fluid (single deepest pocket) is {donorAfi} and the recipient twin's amniotic fluid is {recipientAfi}.[ Quintero staging: {stage}.]",
  "impressionText": "Monochorionic twin pregnancy — TTTS screening performed.[ Quintero {stage}.]",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"donorAfi\", \"label\": \"Donor twin fluid (SDP/AFI)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"recipientAfi\", \"label\": \"Recipient twin fluid (SDP/AFI)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"stage\", \"label\": \"Quintero stage\", \"type\": \"select\", \"options\": [\"None\", \"Stage I\", \"Stage II\", \"Stage III\", \"Stage IV/V\"], \"default\": \"None\", \"required\": true}]"
 },
 {
  "studyType": "Neck",
  "label": "Reactive Cervical Lymphadenopathy",
  "findingText": "Multiple mildly enlarged, oval, {side} level {level} cervical lymph nodes are noted, up to {size} mm in short axis, each with a preserved echogenic fatty hilum and normal flattened shape — reactive in nature.",
  "impressionText": "{side} level {level} reactive cervical lymphadenopathy.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"level\", \"label\": \"Nodal level\", \"type\": \"select\", \"options\": [\"I\", \"II\", \"III\", \"IV\", \"V\", \"VI\"], \"default\": \"II\"}, {\"key\": \"size\", \"label\": \"Size (mm, short axis)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "Neck",
  "label": "Sialolithiasis",
  "findingText": "An echogenic focus with posterior acoustic shadowing is noted within the {side} {gland} gland, with mild upstream ductal dilatation, in keeping with sialolithiasis.",
  "impressionText": "{side} {gland} sialolithiasis.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"gland\", \"label\": \"Gland\", \"type\": \"select\", \"options\": [\"submandibular\", \"parotid\"], \"default\": \"submandibular\", \"required\": true}]"
 },
 {
  "studyType": "Neck",
  "label": "Suspicious Cervical Lymph Node",
  "findingText": "A rounded {side} level {level} cervical lymph node is noted, measuring approximately {size} mm in short axis, with loss of the normal fatty hilum, eccentric cortical thickening, and increased peripheral/mixed vascularity on colour Doppler — suspicious for metastatic or lymphomatous involvement.",
  "impressionText": "CRITICAL — {side} level {level} cervical lymph node suspicious for malignant involvement; clinical correlation ± FNAC advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"level\", \"label\": \"Nodal level\", \"type\": \"select\", \"options\": [\"I\", \"II\", \"III\", \"IV\", \"V\", \"VI\"], \"default\": \"III\"}, {\"key\": \"size\", \"label\": \"Size (mm, short axis)\", \"type\": \"text\", \"default\": \"\"}]"
 },
 {
  "studyType": "NT",
  "label": "Ductus Venosus Doppler",
  "findingText": "Ductus venosus Doppler shows a {dv}.",
  "impressionText": "Ductus venosus a-wave: {dv}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"dv\", \"label\": \"DV a-wave\", \"type\": \"select\", \"options\": [\"Normal (positive a-wave)\", \"Absent a-wave\", \"Reversed a-wave\"], \"default\": \"Normal (positive a-wave)\", \"required\": true}]"
 },
 {
  "studyType": "NT",
  "label": "Increased Nuchal Translucency",
  "findingText": "Nuchal translucency measures {ntMm} mm, at or above the 3.5 mm threshold associated with increased aneuploidy and structural/cardiac-anomaly risk.",
  "impressionText": "Increased NT ({ntMm} mm) — genetic counselling, combined or cell-free DNA screening, and a detailed cardiac and anomaly scan are recommended.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"ntMm\", \"label\": \"NT (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "NT",
  "label": "NT Measurement",
  "findingText": "Nuchal translucency measures {ntMm} mm. Nasal bone is {nasalBone}.",
  "impressionText": "NT {ntMm} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"ntMm\",\"label\":\"NT (mm)\",\"type\":\"text\",\"default\":\"\",\"required\":true,\"sortOrder\":1},{\"key\":\"nasalBone\",\"label\":\"Nasal bone\",\"type\":\"select\",\"options\":[\"present\",\"absent\",\"hypoplastic\"],\"default\":\"present\",\"sortOrder\":2}]"
 },
 {
  "studyType": "NT",
  "label": "Tricuspid Regurgitation",
  "findingText": "Tricuspid regurgitation is {tr} on colour/pulsed Doppler across the tricuspid valve.",
  "impressionText": "Tricuspid regurgitation {tr} — an additional first-trimester soft marker for aneuploidy/cardiac anomaly risk when present.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"tr\", \"label\": \"Tricuspid regurgitation\", \"type\": \"select\", \"options\": [\"Absent\", \"Present\"], \"default\": \"Absent\", \"required\": true}]"
 },
 {
  "studyType": "Obstetric Doppler",
  "label": "Abnormal Ductus Venosus Waveform",
  "findingText": "Ductus venosus Doppler shows a {pattern}, in keeping with worsening fetal cardiovascular compromise.",
  "impressionText": "Ductus venosus {pattern} — significant finding requiring urgent obstetric correlation.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"pattern\", \"label\": \"Pattern\", \"type\": \"select\", \"options\": [\"reduced/absent a-wave\", \"reversed a-wave\"], \"default\": \"reduced/absent a-wave\", \"required\": true}]"
 },
 {
  "studyType": "Obstetric Doppler",
  "label": "Absent/Reversed End-Diastolic Umbilical Flow",
  "findingText": "Umbilical artery Doppler shows {pattern}, indicating significantly increased placental vascular resistance.",
  "impressionText": "Umbilical artery {pattern} — high-risk finding requiring urgent obstetric correlation and delivery-timing discussion.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"pattern\", \"label\": \"Pattern\", \"type\": \"select\", \"options\": [\"absent end-diastolic flow (AEDF)\", \"reversed end-diastolic flow (REDF)\"], \"default\": \"absent end-diastolic flow (AEDF)\", \"required\": true}]"
 },
 {
  "studyType": "Obstetric Doppler",
  "label": "Bilateral Uterine Artery Notching",
  "findingText": "Both uterine arteries show a persistent early diastolic notch with {pi}, in keeping with impaired trophoblastic invasion / increased utero-placental resistance.",
  "impressionText": "Bilateral uterine artery notching with {pi} — increased risk of pre-eclampsia/fetal growth restriction.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"pi\", \"label\": \"Pulsatility index\", \"type\": \"select\", \"options\": [\"normal PI\", \"elevated PI (>95th centile)\"], \"default\": \"elevated PI (>95th centile)\", \"required\": true}]"
 },
 {
  "studyType": "Ovarian Lesions",
  "label": "Complex Multiloculated Cyst",
  "findingText": "A multiloculated cystic lesion with {wallThickness} septations and no discrete solid component is noted in the {side} ovary, measuring approximately {sizeMm} mm.",
  "impressionText": "{side} multiloculated ovarian cyst, {sizeMm} mm, with {wallThickness} septations.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}, {\"key\": \"wallThickness\", \"label\": \"Septal/wall thickness\", \"type\": \"select\", \"options\": [\"thin\", \"thick\"], \"default\": \"thin\", \"required\": true}]"
 },
 {
  "studyType": "Ovarian Lesions",
  "label": "Dermoid (Mature Cystic Teratoma)",
  "findingText": "A well-defined lesion with a hyperechoic component showing posterior acoustic shadowing (Rokitansky nodule) and diffuse or focal fine echogenic foci ('dermoid mesh'/tip-of-the-iceberg sign), with no significant internal vascularity, is noted in the {side} ovary, measuring approximately {sizeMm} mm, in keeping with a mature cystic teratoma (dermoid).",
  "impressionText": "{side} dermoid cyst (mature cystic teratoma), {sizeMm} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Ovarian Lesions",
  "label": "Simple Cyst (IOTA)",
  "findingText": "A unilocular anechoic cystic lesion with a smooth thin wall, no septations, no solid component, and no internal or wall vascularity on colour Doppler (IOTA simple cyst) is noted in the {side} ovary, measuring approximately {sizeMm} mm.",
  "impressionText": "{side} simple ovarian cyst, {sizeMm} mm — IOTA benign pattern.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}]"
 },
 {
  "studyType": "Ovarian Lesions",
  "label": "Simple Septated Cyst",
  "findingText": "A cystic lesion with {septaCount} thin (under 3 mm) septation(s), no solid component, and no papillary projection is noted in the {side} ovary, measuring approximately {sizeMm} mm, with no or minimal septal vascularity on colour Doppler.",
  "impressionText": "{side} septated ovarian cyst, {sizeMm} mm — favour benign.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}, {\"key\": \"septaCount\", \"label\": \"Number of septations\", \"type\": \"text\", \"required\": false}]"
 },
 {
  "studyType": "Ovarian Lesions",
  "label": "Solid or Mixed Adnexal Mass",
  "findingText": "A mixed solid-cystic mass with a solid component/papillary projection showing {vascularity} vascularity on colour Doppler is noted in the {side} adnexa, measuring approximately {sizeMm} mm.",
  "impressionText": "{side} solid/mixed adnexal mass, {sizeMm} mm, {vascularity} vascularity — IOTA suspicious features; further characterization advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"sizeMm\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": true}, {\"key\": \"vascularity\", \"label\": \"Doppler vascularity\", \"type\": \"select\", \"options\": [\"minimal\", \"moderate\", \"marked\"], \"default\": \"moderate\", \"required\": true}]"
 },
 {
  "studyType": "Pelvis",
  "label": "Benign Prostatic Hyperplasia",
  "findingText": "Prostate is enlarged in volume, measuring approximately {volume} cc, with a smooth, symmetric, predominantly heterogeneous echotexture, in keeping with benign prostatic hyperplasia. No definite focal hypoechoic lesion.",
  "impressionText": "Benign prostatic hyperplasia (~{volume} cc).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"volume\", \"label\": \"Estimated prostate volume (cc)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Portal Doppler",
  "label": "Ascites (Portal Hypertension-Related)",
  "findingText": "Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity, in the setting of the above portal venous findings.",
  "impressionText": "{grade} ascites in the setting of portal hypertension.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"grade\", \"label\": \"Quantity\", \"type\": \"select\", \"options\": [\"Mild\", \"Moderate\", \"Gross\"], \"default\": \"Mild\", \"required\": true}]"
 },
 {
  "studyType": "Portal Doppler",
  "label": "Gastro-oesophageal / Portosystemic Varices",
  "findingText": "Dilated, tortuous, low-velocity venous channels are noted at the {location} region, in keeping with portosystemic collateral (varices) formation.",
  "impressionText": "{location} portosystemic varices.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"location\", \"label\": \"Location\", \"type\": \"select\", \"options\": [\"peri-splenic/splenorenal\", \"gastro-oesophageal/left gastric (coronary)\", \"peri-umbilical (recanalised paraumbilical vein)\", \"perigallbladder\"], \"default\": \"peri-splenic/splenorenal\", \"required\": true}]"
 },
 {
  "studyType": "Portal Doppler",
  "label": "Portal Hypertension",
  "findingText": "The main portal vein is dilated measuring more than 13 mm with {flow} flow. The spleen is {spleen}. Portosystemic collaterals are noted (see below).",
  "impressionText": "Sonographic features of portal hypertension with {flow} portal venous flow.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"flow\", \"label\": \"Flow pattern\", \"type\": \"select\", \"options\": [\"reduced hepatopetal\", \"biphasic (to-and-fro)\", \"reversed (hepatofugal)\"], \"default\": \"reduced hepatopetal\", \"required\": true}, {\"key\": \"spleen\", \"label\": \"Spleen\", \"type\": \"select\", \"options\": [\"mildly enlarged\", \"moderately enlarged\", \"markedly enlarged\"], \"default\": \"mildly enlarged\"}]"
 },
 {
  "studyType": "Portal Doppler",
  "label": "Portal Vein Thrombosis",
  "findingText": "The portal vein shows echogenic intraluminal material causing {extent} luminal occlusion, with {vascularity} on spectral interrogation of the thrombus.",
  "impressionText": "{extent} portal vein thrombosis ({vascularity}) — correlate with liver imaging for underlying HCC given the cirrhotic/surveillance context.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"extent\", \"label\": \"Extent\", \"type\": \"select\", \"options\": [\"partial (non-occlusive)\", \"complete (occlusive)\"], \"default\": \"partial (non-occlusive)\", \"required\": true}, {\"key\": \"vascularity\", \"label\": \"Thrombus vascularity\", \"type\": \"select\", \"options\": [\"bland (no internal arterial signal — non-tumoral)\", \"tumoral/arterialised (internal arterial waveform — suspicious for HCC invasion)\"], \"default\": \"bland (no internal arterial signal — non-tumoral)\", \"required\": true}]"
 },
 {
  "studyType": "Renal Doppler",
  "label": "Renal Artery Occlusion",
  "findingText": "No colour or spectral flow is demonstrated in the {side} main renal artery. The corresponding kidney is {kidney}, in keeping with {chronicity} renal artery occlusion.",
  "impressionText": "{side} renal artery occlusion — {chronicity}, kidney {kidney}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"chronicity\", \"label\": \"Chronicity\", \"type\": \"select\", \"options\": [\"acute\", \"chronic\"], \"default\": \"chronic\", \"required\": true}, {\"key\": \"kidney\", \"label\": \"Kidney appearance\", \"type\": \"select\", \"options\": [\"viable and normal in size (non-atrophic)\", \"small and atrophic\"], \"default\": \"small and atrophic\", \"required\": true}]"
 },
 {
  "studyType": "Renal Doppler",
  "label": "Renal Artery Stenosis",
  "findingText": "The {side} main renal artery shows elevated peak systolic velocity with a renal-aortic ratio ≥3.5 and post-stenotic turbulence, in keeping with {grade} renal artery stenosis.",
  "impressionText": "{side} renal artery stenosis, {grade}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"grade\", \"label\": \"Grade\", \"type\": \"select\", \"options\": [\"<60%\", \"≥60%\", \"severe/near-occlusive\"], \"default\": \"≥60%\", \"required\": true}]"
 },
 {
  "studyType": "Scrotum",
  "label": "Testicular Torsion",
  "findingText": "The {side} testis is enlarged and heterogeneous in echotexture with {flow} intratesticular vascularity on colour Doppler compared with the contralateral side, and a whirlpool sign is noted at the spermatic cord — findings concerning for testicular torsion.",
  "impressionText": "CRITICAL — sonographic findings concerning for {side} testicular torsion; immediate urological correlation advised.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"flow\", \"label\": \"Vascularity\", \"type\": \"select\", \"options\": [\"absent\", \"markedly reduced\"], \"default\": \"absent\", \"required\": true}]"
 },
 {
  "studyType": "Scrotum",
  "label": "Varicocele",
  "findingText": "Dilated, tortuous veins of the pampiniform plexus are noted in the {side} hemiscrotum, showing reversal of flow with Valsalva, in keeping with a Grade {grade} varicocele.",
  "impressionText": "{side} Grade {grade} varicocele.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"left\",\"required\":true,\"sortOrder\":1},{\"key\":\"grade\",\"label\":\"Grade\",\"type\":\"select\",\"options\":[\"I\",\"II\",\"III\"],\"default\":\"II\",\"sortOrder\":2}]"
 },
 {
  "studyType": "Soft Tissue",
  "label": "Soft Tissue Foreign Body",
  "findingText": "A linear echogenic focus with posterior acoustic shadowing/reverberation, measuring approximately {size} mm, is noted within the subcutaneous soft tissue, in keeping with a retained {material} foreign body[, with {inflammation}].",
  "impressionText": "Retained {material} foreign body ({size} mm)[, with {inflammation}].",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"material\", \"label\": \"Material\", \"type\": \"select\", \"options\": [\"wood\", \"glass\", \"metal\", \"organic/vegetative\"], \"default\": \"wood\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\"}, {\"key\": \"inflammation\", \"label\": \"Surrounding inflammation\", \"type\": \"select\", \"options\": [\"None\", \"surrounding hypoechoic inflammatory change\"], \"default\": \"None\", \"required\": false}]"
 },
 {
  "studyType": "Thyroid",
  "label": "Thyroid Nodule",
  "findingText": "A {composition} nodule is noted in the {side} lobe, measuring approximately {size} mm, TI-RADS {tirads}.",
  "impressionText": "{side} thyroid nodule, TI-RADS {tirads}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\",\"required\":true,\"sortOrder\":1},{\"key\":\"composition\",\"label\":\"Composition\",\"type\":\"select\",\"options\":[\"solid\",\"cystic\",\"mixed solid-cystic\"],\"default\":\"solid\",\"sortOrder\":2},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":3},{\"key\":\"tirads\",\"label\":\"TI-RADS category\",\"type\":\"select\",\"options\":[\"2\",\"3\",\"4\",\"5\"],\"default\":\"3\",\"required\":true,\"sortOrder\":4}]"
 },
 {
  "studyType": "TVS",
  "label": "Endometrioma",
  "findingText": "A well-defined cystic lesion with homogeneous low-level ('ground-glass') internal echoes and no significant internal vascularity is noted in the {side} ovary, measuring approximately {size} mm, in keeping with an endometrioma.",
  "impressionText": "{side} ovarian endometrioma, {size} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\", \"bilateral\"], \"default\": \"right\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"required\": false}]"
 },
 {
  "studyType": "TVS",
  "label": "Fibroid Uterus",
  "findingText": "A well-defined hypoechoic {location} myometrial lesion is noted, measuring approximately {size} mm, in keeping with a fibroid.",
  "impressionText": "{location} fibroid.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"location\",\"label\":\"Location\",\"type\":\"select\",\"options\":[\"intramural\",\"subserosal\",\"submucosal\"],\"default\":\"intramural\",\"required\":true,\"sortOrder\":1},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":2}]"
 },
 {
  "studyType": "TVS",
  "label": "Follicle Tracking",
  "findingText": "Right ovary shows {rightCount} follicle(s), largest measuring {rightLargestMm} mm. Left ovary shows {leftCount} follicle(s), largest measuring {leftLargestMm} mm.",
  "impressionText": "Follicular study as above.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"rightCount\",\"label\":\"Right — follicle count\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":1},{\"key\":\"rightLargestMm\",\"label\":\"Right — largest (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":2},{\"key\":\"leftCount\",\"label\":\"Left — follicle count\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":3},{\"key\":\"leftLargestMm\",\"label\":\"Left — largest (mm)\",\"type\":\"text\",\"default\":\"\",\"sortOrder\":4}]"
 },
 {
  "studyType": "Venous Doppler",
  "label": "Acute DVT",
  "findingText": "The {side} {segment} is non-compressible and distended with echogenic intraluminal thrombus, {morphology}, in keeping with acute deep vein thrombosis.",
  "impressionText": "Acute DVT involving the {side} {segment} ({morphology}).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"segment\", \"label\": \"Segment\", \"type\": \"select\", \"options\": [\"common femoral vein\", \"femoral vein\", \"popliteal vein\", \"calf veins (posterior tibial/peroneal)\"], \"default\": \"femoral vein\", \"required\": true}, {\"key\": \"morphology\", \"label\": \"Thrombus morphology\", \"type\": \"select\", \"options\": [\"occlusive with absent flow throughout\", \"non-occlusive with a mobile free-floating component and preserved peripheral flow — embolisation risk\"], \"default\": \"occlusive with absent flow throughout\", \"required\": true}]"
 },
 {
  "studyType": "Venous Doppler",
  "label": "Chronic DVT",
  "findingText": "The {side} {segment} shows a partially compressible, thickened, echogenic wall with recanalised flow and collateral venous channels, in keeping with chronic (post-thrombotic) changes.",
  "impressionText": "Chronic post-thrombotic changes in the {side} {segment}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"segment\", \"label\": \"Segment\", \"type\": \"select\", \"options\": [\"common femoral vein\", \"femoral vein\", \"popliteal vein\", \"calf veins (posterior tibial/peroneal)\"], \"default\": \"femoral vein\", \"required\": true}]"
 },
 {
  "studyType": "Venous Doppler",
  "label": "Superficial Venous Reflux (Varicose Veins)",
  "findingText": "The {side} {vein} is dilated and tortuous with reflux duration exceeding 0.5 seconds on Valsalva and calf compression, in keeping with superficial venous incompetence.",
  "impressionText": "{side} {vein} incompetence with varicose veins.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"side\", \"label\": \"Side\", \"type\": \"select\", \"options\": [\"right\", \"left\"], \"default\": \"right\", \"required\": true}, {\"key\": \"vein\", \"label\": \"Vein\", \"type\": \"select\", \"options\": [\"great saphenous vein\", \"small saphenous vein\", \"perforator vein\"], \"default\": \"great saphenous vein\"}]"
 },
 {
  "studyType": "Viability",
  "label": "Confirmed Viable Intrauterine Pregnancy",
  "findingText": "A live intrauterine embryo is seen with a crown-rump length of {crl} mm and cardiac activity present at {fhr} bpm.",
  "impressionText": "Viable intrauterine pregnancy, CRL {crl} mm.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"crl\", \"label\": \"CRL (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"fhr\", \"label\": \"Fetal heart rate (bpm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}]"
 },
 {
  "studyType": "Viability",
  "label": "Non-Viable Pregnancy",
  "findingText": "{findingType} is demonstrated, consistent with a non-viable intrauterine pregnancy per SRU diagnostic criteria.",
  "impressionText": "Findings consistent with a non-viable intrauterine pregnancy.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"findingType\", \"label\": \"Non-viability criterion met\", \"type\": \"select\", \"options\": [\"No cardiac activity in an embryo with CRL ≥ 7 mm\", \"Empty gestational sac with mean sac diameter ≥ 25 mm and no embryo or yolk sac\", \"No embryo with cardiac activity ≥ 2 weeks after a scan showing a sac without a yolk sac\", \"No embryo with cardiac activity ≥ 11 days after a scan showing a sac with a yolk sac\"], \"default\": \"No cardiac activity in an embryo with CRL ≥ 7 mm\", \"required\": true}]"
 },
 {
  "studyType": "Viability",
  "label": "Pregnancy of Unknown Location",
  "findingText": "No definite intrauterine or extrauterine gestational sac is identified despite a positive pregnancy test. Endometrium appears {endo}.",
  "impressionText": "Pregnancy of unknown location — serial β-hCG and repeat ultrasound in 48–72 hours recommended to differentiate a very early intrauterine pregnancy, ectopic pregnancy, and complete miscarriage.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"endo\", \"label\": \"Endometrial appearance\", \"type\": \"select\", \"options\": [\"unremarkable\", \"thickened\", \"showing a decidual reaction\"], \"default\": \"unremarkable\", \"required\": true}]"
 },
 {
  "studyType": "Viability",
  "label": "Subchorionic Hematoma",
  "findingText": "A crescentic anechoic to hypoechoic collection is noted between the chorionic membrane and myometrium at the {location} aspect of the gestational sac, measuring approximately {size} mm, in keeping with a subchorionic hematoma. {viability}.",
  "impressionText": "Subchorionic hematoma, {location}, {size} mm. {viability}.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"location\", \"label\": \"Location\", \"type\": \"select\", \"options\": [\"superior\", \"inferior\", \"marginal\", \"retroplacental\"], \"default\": \"marginal\", \"required\": true}, {\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": true}, {\"key\": \"viability\", \"label\": \"Embryo status\", \"type\": \"select\", \"options\": [\"The embryo is viable with cardiac activity present\", \"Non-viable — see separate Non-Viable Pregnancy finding\"], \"default\": \"The embryo is viable with cardiac activity present\", \"required\": true}]"
 },
 {
  "studyType": "Whole Abdomen",
  "label": "Ascites",
  "findingText": "Free anechoic fluid is noted in the peritoneal cavity, {grade} in quantity.",
  "impressionText": "{grade} ascites.",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\":\"grade\",\"label\":\"Quantity\",\"type\":\"select\",\"options\":[\"Mild\",\"Moderate\",\"Gross\"],\"default\":\"Mild\",\"required\":true,\"sortOrder\":1}]"
 },
 {
  "studyType": "Whole Abdomen",
  "label": "Gallbladder Polyp",
  "findingText": "Gallbladder shows a non-shadowing, immobile, echogenic polypoid lesion arising from the wall, measuring approximately {size} mm.",
  "impressionText": "Gallbladder polyp ({size} mm).",
  "techniqueText": "",
  "recommendationText": "",
  "questionsJson": "[{\"key\": \"size\", \"label\": \"Size (mm)\", \"type\": \"text\", \"default\": \"\", \"required\": false}]"
 },
 {
  "studyType": "X-Ray Cervical Spine",
  "label": "Fracture / Malalignment",
  "findingText": "There is {abnormality} at the {level} level.{prevert}",
  "impressionText": "Cervical spine injury at {level}.",
  "techniqueText": "",
  "recommendationText": "Maintain precautions. CT cervical spine; MRI for cord/ligamentous injury.",
  "questionsJson": "[{\"key\":\"abnormality\",\"label\":\"Abnormality\",\"type\":\"select\",\"options\":[\"a fracture\",\"anterolisthesis\",\"loss of normal alignment\",\"an odontoid fracture\"],\"default\":\"a fracture\"},{\"key\":\"level\",\"label\":\"Level\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"prevert\",\"label\":\"Prevertebral\",\"type\":\"select\",\"options\":[\"\",\" There is associated prevertebral soft-tissue widening.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Chest PA",
  "label": "Cardiomegaly",
  "findingText": "The cardiac silhouette is enlarged with a cardiothoracic ratio of {ctr}.{edema}",
  "impressionText": "Cardiomegaly.",
  "techniqueText": "",
  "recommendationText": "Clinical and echocardiographic correlation.",
  "questionsJson": "[{\"key\":\"ctr\",\"label\":\"CTR\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"edema\",\"label\":\"Pulmonary edema\",\"type\":\"select\",\"options\":[\"\",\"  There is upper-lobe blood diversion and interstitial edema.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Chest PA",
  "label": "Consolidation",
  "findingText": "There is {distribution} airspace opacification in the {zone}{air_bronchogram}.",
  "impressionText": "{zone} consolidation.",
  "techniqueText": "",
  "recommendationText": "Clinical correlation. Follow-up radiograph after treatment to confirm resolution.",
  "questionsJson": "[{\"key\":\"distribution\",\"label\":\"Distribution\",\"type\":\"select\",\"options\":[\"lobar\",\"patchy\",\"diffuse\"],\"default\":\"patchy\"},{\"key\":\"zone\",\"label\":\"Zone\",\"type\":\"select\",\"options\":[\"right upper zone\",\"right mid zone\",\"right lower zone\",\"left upper zone\",\"left mid zone\",\"left lower zone\",\"bilateral\"],\"default\":\"right lower zone\"},{\"key\":\"air_bronchogram\",\"label\":\"Air bronchogram\",\"type\":\"select\",\"options\":[\"\",\" with air bronchograms\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Chest PA",
  "label": "Lung Nodule",
  "findingText": "A {margin} nodule measuring approximately {size} mm is noted in the {zone}.",
  "impressionText": "Pulmonary nodule ({size} mm).",
  "techniqueText": "",
  "recommendationText": "Chest CT is advised for characterization; Fleischner Society follow-up per size and risk.",
  "questionsJson": "[{\"key\":\"margin\",\"label\":\"Margin\",\"type\":\"select\",\"options\":[\"well-defined\",\"ill-defined\",\"spiculated\"],\"default\":\"well-defined\"},{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"zone\",\"label\":\"Zone\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Chest PA",
  "label": "Pleural Effusion",
  "findingText": "There is a {side} pleural effusion with blunting of the costophrenic angle{size}.",
  "impressionText": "{side} pleural effusion.",
  "techniqueText": "",
  "recommendationText": "Clinical correlation. Ultrasound is advised for volume estimation and to guide aspiration if indicated.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\",\"bilateral\"],\"default\":\"right\"},{\"key\":\"size\",\"label\":\"Size\",\"type\":\"select\",\"options\":[\" (small)\",\" (moderate)\",\" (large, with mediastinal shift)\"],\"default\":\" (small)\"}]"
 },
 {
  "studyType": "X-Ray Chest PA",
  "label": "Pneumothorax",
  "findingText": "There is a {side} pneumothorax{size}.{tension}",
  "impressionText": "{side} pneumothorax.",
  "techniqueText": "",
  "recommendationText": "Clinical correlation. Emergency referral if tension physiology.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"size\",\"label\":\"Size\",\"type\":\"select\",\"options\":[\" (small)\",\" (moderate)\",\" (large)\"],\"default\":\" (small)\"},{\"key\":\"tension\",\"label\":\"Tension\",\"type\":\"select\",\"options\":[\"\",\"  There is mediastinal shift to the opposite side, suggesting tension — emergency.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Dorsal Spine",
  "label": "Compression Fracture",
  "findingText": "There is {wedge} of the {level} vertebral body with approximately {loss}% height loss.",
  "impressionText": "{level} compression fracture.",
  "techniqueText": "",
  "recommendationText": "MRI to age the fracture and assess the cord. DEXA if osteoporotic.",
  "questionsJson": "[{\"key\":\"wedge\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"anterior wedging\",\"biconcave collapse\",\"vertebra plana\"],\"default\":\"anterior wedging\"},{\"key\":\"level\",\"label\":\"Level\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"loss\",\"label\":\"Height loss (%)\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Erect Abdomen",
  "label": "Bowel Obstruction",
  "findingText": "There are dilated {bowel} loops with multiple air-fluid levels{ladder}, suggesting {bowel} obstruction.",
  "impressionText": "{bowel} obstruction.",
  "techniqueText": "",
  "recommendationText": "Surgical correlation. CT abdomen for level and cause.",
  "questionsJson": "[{\"key\":\"bowel\",\"label\":\"Bowel\",\"type\":\"select\",\"options\":[\"small bowel\",\"large bowel\"],\"default\":\"small bowel\"},{\"key\":\"ladder\",\"label\":\"Pattern\",\"type\":\"select\",\"options\":[\"\",\" in a step-ladder pattern\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Knee",
  "label": "Fracture",
  "findingText": "There is a fracture involving the {site}, which is {intraartic}.{effusion}",
  "impressionText": "{site} fracture.",
  "techniqueText": "",
  "recommendationText": "Orthopaedic correlation. CT for tibial plateau assessment.",
  "questionsJson": "[{\"key\":\"site\",\"label\":\"Site\",\"type\":\"select\",\"options\":[\"tibial plateau\",\"patella\",\"distal femur\",\"proximal fibula\"],\"default\":\"tibial plateau\"},{\"key\":\"intraartic\",\"label\":\"Articular\",\"type\":\"select\",\"options\":[\"extra-articular\",\"intra-articular\"],\"default\":\"intra-articular\"},{\"key\":\"effusion\",\"label\":\"Lipohaemarthrosis\",\"type\":\"select\",\"options\":[\"\",\" A lipohaemarthrosis is present, indicating an intra-articular fracture.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Knee",
  "label": "Osteoarthritis",
  "findingText": "There is {severity} osteoarthritis, most marked in the {compartment} compartment, with joint-space narrowing and osteophytes.",
  "impressionText": "{severity} knee osteoarthritis.",
  "techniqueText": "",
  "recommendationText": "Clinical correlation; orthopaedic opinion as indicated.",
  "questionsJson": "[{\"key\":\"severity\",\"label\":\"Severity\",\"type\":\"select\",\"options\":[\"mild\",\"moderate\",\"severe\"],\"default\":\"moderate\"},{\"key\":\"compartment\",\"label\":\"Compartment\",\"type\":\"select\",\"options\":[\"medial\",\"lateral\",\"patellofemoral\",\"all\"],\"default\":\"medial\"}]"
 },
 {
  "studyType": "X-Ray Knee AP/Lat",
  "label": "OA knee",
  "findingText": "Degenerative changes in the {side} knee with joint-space narrowing ({compartment}), osteophytes, and subchondral sclerosis.",
  "impressionText": "{side} knee osteoarthritis ({compartment}).",
  "techniqueText": "",
  "recommendationText": "Orthopaedic correlation.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"compartment\",\"label\":\"Compartment\",\"type\":\"select\",\"options\":[\"medial\",\"lateral\",\"patellofemoral\",\"tricompartmental\"],\"default\":\"medial\"}]"
 },
 {
  "studyType": "X-Ray KUB",
  "label": "Radio-opaque Calculus",
  "findingText": "A radio-opaque calculus measuring {size} mm projects over the {side} {location}.",
  "impressionText": "{side} {location} calculus ({size} mm).",
  "techniqueText": "",
  "recommendationText": "Ultrasound for hydronephrosis; CT KUB for confirmation. Urology correlation.",
  "questionsJson": "[{\"key\":\"size\",\"label\":\"Size (mm)\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"location\",\"label\":\"Location\",\"type\":\"select\",\"options\":[\"renal region\",\"line of the ureter\",\"VUJ region\",\"bladder region\"],\"default\":\"renal region\"}]"
 },
 {
  "studyType": "X-Ray Lumbar Spine",
  "label": "Degenerative lumbar",
  "findingText": "Lumbar spondylosis with disc-space narrowing at {levels} and marginal osteophytes. No acute fracture.",
  "impressionText": "Lumbar degenerative disc disease ({levels}).",
  "techniqueText": "",
  "recommendationText": "Clinical correlation. MRI if radiculopathy persists.",
  "questionsJson": "[{\"key\":\"levels\",\"label\":\"Levels\",\"type\":\"text\",\"default\":\"L4-L5 / L5-S1\"}]"
 },
 {
  "studyType": "X-Ray Lumbar Spine",
  "label": "Spondylolisthesis",
  "findingText": "There is grade {grade} (Meyerding) {direction} of {level}{pars}.",
  "impressionText": "Grade {grade} spondylolisthesis at {level}.",
  "techniqueText": "",
  "recommendationText": "MRI for canal and neural assessment; flexion-extension for instability.",
  "questionsJson": "[{\"key\":\"grade\",\"label\":\"Grade\",\"type\":\"select\",\"options\":[\"I\",\"II\",\"III\",\"IV\"],\"default\":\"I\"},{\"key\":\"direction\",\"label\":\"Direction\",\"type\":\"select\",\"options\":[\"anterolisthesis\",\"retrolisthesis\"],\"default\":\"anterolisthesis\"},{\"key\":\"level\",\"label\":\"Level\",\"type\":\"text\",\"default\":\"L5-S1\"},{\"key\":\"pars\",\"label\":\"Pars\",\"type\":\"select\",\"options\":[\"\",\" with a pars interarticularis defect\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Pelvis AP",
  "label": "Neck of Femur Fracture",
  "findingText": "There is a fracture of the {side} femoral neck, which is {displacement}. The injury is {capsule}.",
  "impressionText": "{side} neck-of-femur fracture.",
  "techniqueText": "",
  "recommendationText": "Urgent orthopaedic referral. MRI if radiographically occult but clinically suspected.",
  "questionsJson": "[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"displacement\",\"label\":\"Displacement\",\"type\":\"select\",\"options\":[\"undisplaced\",\"displaced\"],\"default\":\"displaced\"},{\"key\":\"capsule\",\"label\":\"Capsule\",\"type\":\"select\",\"options\":[\"intracapsular\",\"extracapsular (intertrochanteric)\"],\"default\":\"intracapsular\"}]"
 },
 {
  "studyType": "X-Ray Portable Chest",
  "label": "Central Line Position",
  "findingText": "The central venous catheter tip projects {position}.{ptx}",
  "impressionText": "Central line {position}.",
  "techniqueText": "",
  "recommendationText": "Correlate before use; exclude post-insertion pneumothorax.",
  "questionsJson": "[{\"key\":\"position\",\"label\":\"Position\",\"type\":\"select\",\"options\":[\"at the cavoatrial junction — satisfactory\",\"in the right atrium — recommend withdrawal\",\"in the internal jugular / azygos — reposition\"],\"default\":\"at the cavoatrial junction — satisfactory\"},{\"key\":\"ptx\",\"label\":\"Pneumothorax\",\"type\":\"select\",\"options\":[\"\",\" No post-insertion pneumothorax.\",\" There is a post-insertion pneumothorax.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Portable Chest",
  "label": "ET Tube Position",
  "findingText": "The endotracheal tube tip projects {position}.",
  "impressionText": "ET tube {position}.",
  "techniqueText": "",
  "recommendationText": "Reposition and repeat film if malpositioned before use.",
  "questionsJson": "[{\"key\":\"position\",\"label\":\"Position\",\"type\":\"select\",\"options\":[\"in a satisfactory position, approximately 5 cm above the carina\",\"low, at/near the carina — recommend withdrawal\",\"in the right main bronchus — recommend withdrawal\",\"high — correlate clinically\"],\"default\":\"in a satisfactory position, approximately 5 cm above the carina\"}]"
 },
 {
  "studyType": "X-Ray Portable Chest",
  "label": "NG Tube Position",
  "findingText": "The nasogastric tube {position}.",
  "impressionText": "NG tube {position}.",
  "techniqueText": "",
  "recommendationText": "Do not use a malpositioned NG tube; reposition and confirm.",
  "questionsJson": "[{\"key\":\"position\",\"label\":\"Position\",\"type\":\"select\",\"options\":[\"passes below the diaphragm in the midline with the tip in the stomach — satisfactory\",\"tip is at the gastro-oesophageal junction — advance\",\"is coiled in the oesophagus — reposition\",\"projects over the bronchial tree — remove immediately\"],\"default\":\"passes below the diaphragm in the midline with the tip in the stomach — satisfactory\"}]"
 },
 {
  "studyType": "X-Ray Shoulder",
  "label": "Dislocation",
  "findingText": "There is {type} glenohumeral dislocation.{lesion}",
  "impressionText": "{type} shoulder dislocation.",
  "techniqueText": "",
  "recommendationText": "Orthopaedic correlation and reduction; post-reduction film.",
  "questionsJson": "[{\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"anterior\",\"posterior\"],\"default\":\"anterior\"},{\"key\":\"lesion\",\"label\":\"Associated\",\"type\":\"select\",\"options\":[\"\",\" A Hill-Sachs / bony Bankart lesion is noted.\"],\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Skull",
  "label": "Fracture",
  "findingText": "There is a {type} fracture of the {region}.",
  "impressionText": "{type} skull fracture.",
  "techniqueText": "",
  "recommendationText": "CT head is advised. Neurosurgical correlation for a depressed fracture.",
  "questionsJson": "[{\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"linear\",\"depressed\"],\"default\":\"linear\"},{\"key\":\"region\",\"label\":\"Region\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Soft Tissue Neck",
  "label": "Foreign Body",
  "findingText": "A radio-opaque foreign body is seen at the {level}, projecting over the {tract}.",
  "impressionText": "Radio-opaque foreign body at {level}.",
  "techniqueText": "",
  "recommendationText": "Urgent ENT correlation. CT for a radiolucent foreign body.",
  "questionsJson": "[{\"key\":\"level\",\"label\":\"Level\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"tract\",\"label\":\"Tract\",\"type\":\"select\",\"options\":[\"airway\",\"oesophagus\",\"uncertain\"],\"default\":\"oesophagus\"}]"
 },
 {
  "studyType": "X-Ray Whole Spine",
  "label": "Scoliosis",
  "findingText": "There is a {direction}-convex {region} scoliosis with an apex at {apex} and a Cobb angle of {cobb} degrees.",
  "impressionText": "{region} scoliosis (Cobb {cobb} deg).",
  "techniqueText": "",
  "recommendationText": "Orthopaedic (scoliosis) referral if > 25 deg or progressing. Serial standing films.",
  "questionsJson": "[{\"key\":\"direction\",\"label\":\"Convexity\",\"type\":\"select\",\"options\":[\"right\",\"left\"],\"default\":\"right\"},{\"key\":\"region\",\"label\":\"Region\",\"type\":\"select\",\"options\":[\"thoracic\",\"thoracolumbar\",\"lumbar\"],\"default\":\"thoracic\"},{\"key\":\"apex\",\"label\":\"Apex level\",\"type\":\"text\",\"default\":\"\"},{\"key\":\"cobb\",\"label\":\"Cobb angle (deg)\",\"type\":\"text\",\"default\":\"\"}]"
 },
 {
  "studyType": "X-Ray Wrist",
  "label": "Distal Radius Fracture",
  "findingText": "There is a {type} fracture of the distal radius, which is {intraartic}, with {tilt}.",
  "impressionText": "Distal radius fracture ({type}).",
  "techniqueText": "",
  "recommendationText": "Orthopaedic correlation for displaced/intra-articular fracture.",
  "questionsJson": "[{\"key\":\"type\",\"label\":\"Type\",\"type\":\"select\",\"options\":[\"Colles\",\"Smith\",\"undisplaced\"],\"default\":\"Colles\"},{\"key\":\"intraartic\",\"label\":\"Articular\",\"type\":\"select\",\"options\":[\"extra-articular\",\"intra-articular\"],\"default\":\"extra-articular\"},{\"key\":\"tilt\",\"label\":\"Tilt\",\"type\":\"select\",\"options\":[\"dorsal angulation\",\"volar angulation\",\"preserved volar tilt\"],\"default\":\"dorsal angulation\"}]"
 }
];
