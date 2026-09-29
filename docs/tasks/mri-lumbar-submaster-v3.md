TASK: CARE ERP — MRI LUMBAR SPINE CLINICAL SUB-MASTER REPORTING V3
WITH THREE-MODULE SPINE SCREENING

Repository: DrAbinash/care-on-synology1

SOURCE CONTENT:
Use the supplied MRI Lumbar Spine clinical content library as the clinical
content source for findings, terminology and starting presets.
Seeded/preset prose MUST be verbatim from that library; the composer may
template variables but never invent clinical sentences.

OBJECTIVE
Enhance the EXISTING CARE MRI Lumbar Spine structured reporting canvas using
the Clinical Sub-Master architecture being developed across CARE MRI Brain /
Cervical / Lumbar reporting.
This task must also introduce/reuse a SPINE SCREENING architecture with THREE
region-specific limited-screening modules (cervical, dorsal, LS) over SHARED
technical infrastructure, so limited screening performed with a primary study
(or as a screening-only study) is documented correctly without pretending a
dedicated MRI of that region was performed.
DO NOT build a new reporting system.
Reuse CARE's existing: reporting canvas; structured observation model;
observation ledger; Zustand/store infrastructure; level-by-level spine
components; AP canal measurements; Findings composer; Impression refresh;
manual-text/provenance protection; contradiction validator; abnormal
pattern/macro infrastructure; critical-result workflow; AI Draft / Selected
Images workflow.

CONTEXT FILES TO READ FIRST:
- src/components/radiology/reporting-canvas/MriLumbarCanvas.tsx
- src/components/radiology/reporting-canvas/MriCervicalCanvas.tsx (incl. any ad-hoc screening)
- src/lib/mriLumbarLevelState.ts and src/lib/mriCervicalLevelState.ts
- src/lib/zai-workspace/store.ts (useWorkspace)
- src/components/radiology/reporting-canvas/SpineApCanalMeasurements.tsx
- src/lib/mriSpineGrading.ts
- any existing whole-spine/screening module found in audit

BINDING RULES (hard):
- All chip/preset application MUST go through useWorkspace.getState().applyMacroBundle /
  applyPathologyOverlay. Level entries MUST flow through buildLumbarLevelApplyBundle.
  AP inputs MUST write canalApProvenance via setCanalApProvenance.
- No parallel local React state for observations, measurements, numbering or screening.

============================================================
1. AUDIT FIRST
============================================================
Before coding, inspect current main for: existing MRI Lumbar canvas;
MriCervicalCanvas; any dorsal/whole-spine/LS screening implementation;
cervical/dorsal/lumbar shared spine components; mriSpineGrading;
SpineApCanalMeasurements or equivalent; level-by-level observation builders;
root/laterality handling; abnormalPatterns; apply/undo macro infrastructure;
Findings → Impression workflow; reportFieldMerge/provenance; validators;
critical-result workflow; existing spine tests; existing Technique/protocol
representation; existing whole-spine screening phrases/components; the
impression ordering/prioritization function; the billed-study resolver
(billedStudyType pattern) for catalog-code → study-composition mapping.
IMPORTANT: Cervical, dorsal and lumbar reporting should share generic spine
infrastructure where clinically appropriate, but region-specific anatomy must
remain correct (Cervical: uncovertebral joints, cervical exiting-root
relationships, craniocervical junction. Dorsal: rib-bearing vertebrae,
paravertebral spaces. Lumbar: lateral recess, traversing vs exiting roots,
pars, conus/cauda). Do NOT copy cervical-specific anatomy into lumbar reporting.
SCREENING: before creating anything new, determine whether CARE already
contains whole-spine/cervical/dorsal/LS screening logic that can be
generalized. Do not create separate duplicate screening engines per region.
Provide a concise architecture audit before implementation.
Then: NEW BRANCH → IMPLEMENT → TEST → PR. DO NOT MERGE.

============================================================
2. CLINICAL SUB-MASTERS
============================================================
Organize MRI Lumbar Spine into progressive-disclosure clinical palettes:
1. ROUTINE / NORMAL
2. DEGENERATIVE
3. DISC HERNIATION / NEURAL COMPRESSION
4. SPONDYLOLISTHESIS / PARS
5. TRAUMA
6. INFECTION
7. TUMOR / MARROW / MASS
8. POST-OPERATIVE
9. CONUS / CAUDA EQUINA / INTRADURAL
10. CONGENITAL / LSTV
11. INFLAMMATORY / SACROILIAC
12. MORE / ADVANCED
These are NOT separate report editors; they are palettes over ONE lumbar
observation model. Multiple sub-masters may be active simultaneously
(e.g. DEGENERATIVE + NEURAL COMPRESSION; POST-OPERATIVE + NEURAL COMPRESSION;
INFECTION + CONUS/CAUDA; TUMOR + CONUS/CAUDA; LSTV + DEGENERATIVE).
Switching palettes must never delete observations.

============================================================
3. SHARED LUMBAR CORE
============================================================
Do not duplicate anatomy inside individual sub-masters. Create/reuse shared
structured components for: A. Vertebral numbering / transitional anatomy;
B. Alignment / lordosis; C. Vertebral bodies; D. Marrow / endplates;
E. Intervertebral discs; F. Level-by-level findings; G. Central canal / AP
measurements; H. Lateral recesses; I. Neural foramina; J. Exiting and
traversing nerve roots; K. Facet joints; L. Ligamentum flavum;
M. Pars interarticularis; N. Epidural space; O. Conus medullaris;
P. Cauda equina; Q. Paraspinal/psoas soft tissues; R. Visualized sacroiliac
joints; S. Spine screening (three modules, section 22+).
One observation concept should be reusable across relevant sub-masters.

============================================================
4. ROUTINE / NORMAL
============================================================
Provide a one-click NORMAL LUMBAR SPINE baseline supporting: normal lumbar
lordosis; normal alignment; vertebral body heights maintained; normal marrow
signal; no acute fracture; disc heights/signals preserved; no significant
disc bulge/herniation; central canal patent; lateral recesses patent; neural
foramina patent; no nerve-root compression; facets unremarkable; ligamentum
flavum unremarkable; posterior elements intact; conus normal in
morphology/signal; cauda equina normally distributed; paraspinal tissues
unremarkable.
CONUS LEVEL: do not blindly hard-code L1; allow structured conus termination
level. If abnormal findings are subsequently selected, reconcile corresponding
normal observations. Never leave contradictory normal and abnormal statements.

============================================================
5. VERTEBRAL NUMBERING — HIGH PRIORITY SAFETY FEATURE
============================================================
Provide NUMBERING / ANATOMY: [ Standard numbering ] [ LSTV present ]
[ Lowest prominent lumbar-type vertebra designated L5 ]
[ Numbering based on whole-spine/localizer ] [ Other / manual ].
For LSTV support: sacralization; lumbarization; unilateral/bilateral;
Castellvi I / II / III / IV; subtype a/b where appropriate; pseudoarthrosis;
reactive marrow change.
IMPORTANT: when transitional anatomy exists, display a numbering caution. CARE
must not silently assume that the lowest mobile segment is L5-S1. Level naming
must remain internally consistent throughout: Findings; level-by-level
component; AP measurement table; Impression; root mapping; screening references.

IMPLEMENTATION (Zustand) — LumbarNumberingResolver:
- Store slice: numberingMode: 'standard'|'lstv-sacralization'|'lstv-lumbarization'|
  'localizer-based'|'manual'; castellvi: 'I'|'IIa'|'IIb'|'IIIa'|'IIIb'|'IV';
  side: 'unilateral'|'bilateral'.
- LumbarNumberingResolver derives the active level-key array (e.g. sacralization
  → …L4-L5, L5-transitional). Level UI, AP table, Findings composer, Impression
  generator, root mapping AND LS-screening level references MUST all consume
  resolver keys — never a hard-coded array.
- numberingMode !== 'standard' → persistent amber numbering banner and the
  composer appends the numbering caution sentence.
- wholeSpineLocalizer=false + LSTV/localizer mode → append reduced-certainty caveat.

============================================================
6. DEGENERATIVE SUB-MASTER
============================================================
ALIGNMENT: preserved lordosis; loss/straightening; reversal where applicable;
degenerative scoliosis; anterolisthesis; retrolisthesis.
VERTEBRAE / ENDPLATES: osteophytes; endplate irregularity; sclerosis; Modic I;
Modic II; Modic III; Schmorl nodes.
DISCS: desiccation; reduced disc height; diffuse bulge; broad-based bulge;
disc-osteophyte complex; annular fissure / HIZ; protrusion; extrusion;
sequestration.
POSTERIOR ELEMENTS: facet arthropathy; facet hypertrophy; facet effusion;
ligamentum flavum hypertrophy; ligamentum flavum buckling; synovial cyst.
EFFECTS: thecal sac indentation; lateral recess narrowing; central canal
stenosis; foraminal stenosis; root contact; root displacement; root
impingement; root compression.

============================================================
7. LEVEL-BY-LEVEL — CORE COMPONENT
============================================================
This is a SHARED COMPONENT, not another sub-master.
Support: T12-L1 where appropriate; L1-L2; L2-L3; L3-L4; L4-L5; L5-S1.
Each level should allow:
DISC: normal; desiccation; height loss; diffuse bulge; broad-based bulge;
protrusion; extrusion; sequestration; disc-osteophyte complex.
LOCATION: central; right paracentral; left paracentral; right subarticular;
left subarticular; broad based; right foraminal; left foraminal; right
extraforaminal; left extraforaminal.
MIGRATION: none; cranial; caudal; distance ___ mm.
CENTRAL CANAL: no significant stenosis; mild; moderate; severe; AP diameter ___ mm.
THECAL SAC / CANAL MORPHOLOGY: CSF preserved; partial CSF effacement; complete
CSF effacement; cauda equina crowding; trefoil configuration; combined
degenerative stenosis.
LATERAL RECESS — EACH SIDE: normal; mild narrowing; moderate narrowing; severe
stenosis; traversing root contact; traversing root displacement; traversing
root impingement; traversing root compression.
NEURAL FORAMEN — EACH SIDE: normal; mild narrowing; moderate narrowing; severe
stenosis; perineural fat preserved; partial loss of perineural fat; complete
loss of perineural fat; exiting root contact; exiting root impingement;
exiting root compression.
FACETS: normal; arthropathy; hypertrophy; effusion; synovial cyst.
LIGAMENTUM FLAVUM: normal; hypertrophy; buckling; thickness ___ mm when measured.
Generate professional prose from the structured observations. Do not simply
concatenate chip labels.

IMPLEMENTATION (slots):
- Each level row owns conflictGroup slots: lvl-<key>-disc, -location, -migration,
  -canal-sev, -canal-morph, -recess-R, -recess-L, -foram-R, -foram-L, -root-effect,
  -facets, -lf. Same-slot replacement; undo restores the verbatim baseline.
- Composer renders slots via per-slot sentence templates (professional prose).

============================================================
8. NERVE-ROOT INTELLIGENCE
============================================================
Provide lightweight anatomical assistance. Examples: L3-L4
foraminal/extraforaminal → exiting L3 root; L3-L4 paracentral/subarticular/
lateral recess → traversing L4 root; L4-L5 foraminal/extraforaminal → exiting
L4 root; L4-L5 paracentral/subarticular/lateral recess → traversing L5 root;
L5-S1 foraminal/extraforaminal → exiting L5 root; L5-S1 paracentral/
subarticular/lateral recess → traversing S1 root.
CARE may SUGGEST the expected root. Radiologist can override. If LEVEL +
LOCATION + ROOT appears anatomically inconsistent: WARN. Do not silently
correct. IMPORTANT: account for transitional anatomy/vertebral numbering
before applying root assistance.

IMPLEMENTATION (conflict groups):
- Root observations carry IDs: traversing 'root-trav-L4|L5|S1'; exiting
  'root-exit-L3|L4|L5', so same-slot replacement never deletes a different root.
- Suggested root stored as a suggestion flag; override writes the final root and
  clears the flag. Inconsistent combinations raise a warning chip; never auto-correct.
- Root mapping consumes LumbarNumberingResolver keys; transitional levels get
  caution wording.

============================================================
9. CENTRAL CANAL MEASUREMENTS
============================================================
Reuse existing Spine AP Canal Measurements. Support at minimum L1-L2, L2-L3,
L3-L4, L4-L5, L5-S1. One measurement must be ONE source of truth feeding:
measurement table; level observation; Findings; Impression context; validation.
Do not maintain independent copies of the same number. Do not introduce
questionable stenosis cutoffs inside JSX. Audit existing mriSpineGrading.
If measurement and radiologist-selected severity disagree: WARN. Do not
silently change the radiologist's grading.
IMPLEMENTATION: AP values write ONLY via setCanalApProvenance; table, level
observations, Findings and Impression all read from canalApProvenance.

============================================================
10. DISC HERNIATION / NEURAL COMPRESSION
============================================================
Optimize for focal disc disease. MORPHOLOGY: protrusion; extrusion;
sequestration. LOCATION: central; paracentral; subarticular/lateral recess;
foraminal; extraforaminal/far lateral. MEASUREMENTS: AP; transverse;
craniocaudal. MIGRATION: cranial; caudal; ___ mm. EFFECT: thecal sac
indentation; lateral recess stenosis; root contact; root displacement; root
impingement; root compression. Use exiting/traversing root intelligence.
Do not label imaging findings as clinical radiculopathy automatically.

============================================================
11. SPONDYLOLISTHESIS / PARS
============================================================
Support: anterolisthesis; retrolisthesis; level; displacement ___ mm; grade.
CAUSE / PATTERN: degenerative; isthmic / pars related; other/manual.
PARS: right; left; bilateral; chronic defect; marrow edema/stress reaction.
ASSOCIATED: disc uncapping / pseudobulge; disc degeneration; foraminal
stenosis; root compression; facet degeneration.
Do not automatically classify the etiology without supporting selected
observations.

============================================================
12. OPTIONAL DYNAMIC INSTABILITY
============================================================
Only expose when appropriate flexion/extension or other dynamic imaging
information exists. Support: neutral slip ___ mm; flexion slip ___ mm;
extension slip ___ mm; interval translation ___ mm.
Do NOT infer dynamic instability from routine supine MRI alone.
IMPLEMENTATION: dynamic fields render only when sequencesAvailable.dynamic ===
true; otherwise hidden with a one-line hint.

============================================================
13. EPIDURAL SPACE
============================================================
Add a shared epidural-space observation group: normal epidural fat; prominent
epidural fat; spinal epidural lipomatosis; epidural mass; epidural collection;
epidural hematoma; thecal sac compression; level/extent.
Allow epidural lipomatosis to contribute to combined canal stenosis when selected.
IMPLEMENTATION: composer rule — lipomatosis + degenerative stenosis at the same
level emit ONE combined sentence ("combined degenerative and epidural
lipomatosis-related canal stenosis"), never two competing sentences.

============================================================
14. TRAUMA
============================================================
Support: compression fracture; burst fracture; wedge deformity; endplate
fracture; marrow edema; vertebral height loss %; retropulsion ___ mm;
posterior element fracture; pars injury; pedicle injury; ligamentous injury;
epidural hematoma; canal compromise; conus/cauda effect.
Allow acute/subacute/chronic characterization where supported.

============================================================
15. INFECTION
============================================================
Support: discitis; osteomyelitis; spondylodiscitis; disc fluid signal; disc
destruction; endplate erosion; marrow edema; enhancement; epidural phlegmon;
epidural abscess; paraspinal collection; psoas abscess; canal compromise;
neural compression. Allow: level; cranio-caudal extent; AP × transverse ×
craniocaudal dimensions; enhancement pattern; neural effect.

============================================================
16. TUMOR / MARROW / MASS
============================================================
MARROW: focal lesion; multifocal lesions; diffuse marrow alteration;
T1/T2/STIR characteristics; enhancement when contrast performed.
OSSEOUS: vertebral involvement; posterior element involvement; pathological
fracture; epidural extension.
EPIDURAL / INTRADURAL: compartment; level/extent; dimensions; signal;
enhancement; canal compromise; conus/cauda compression.
Diagnostic labels such as metastasis / myeloma / marrow infiltrative disorder
must remain radiologist-controlled interpretations.

============================================================
17. CONUS / CAUDA EQUINA / INTRADURAL
============================================================
CONUS: termination level; normal / low lying; normal signal; focal signal
abnormality; diffuse signal abnormality; expansion; compression.
TETHERED CORD: low conus; thickened filum; fatty filum / intrafilar lipoma.
CAUDA EQUINA: normal distribution; crowding; compression; clumping; peripheral
adherence; empty-thecal-sac pattern.
ARACHNOIDITIS: support descriptive observations; do not automatically declare
arachnoiditis from one sign alone.
INTRADURAL MASS: reuse shared lesion characterization where possible.

============================================================
18. POST-OPERATIVE
============================================================
Support: laminectomy; hemilaminectomy; discectomy; decompression; PLIF; TLIF;
posterior fusion; pedicle screws; interbody cage.
POSTOPERATIVE FINDINGS: expected postoperative change; residual disc; recurrent
disc; epidural fibrosis; recurrent/residual stenosis; adjacent segment
degeneration; postoperative collection; pseudomeningocele; hematoma; infection;
arachnoiditis.
CONTRAST-AWARE: recurrent disc versus epidural fibrosis observations that depend
upon enhancement must only be generated when contrast imaging exists.
Respect MRI limitations for fusion assessment, screw loosening, subtle hardware
failure. Do not overstate hardware integrity when artifact limits evaluation.

============================================================
19. CONGENITAL / LSTV
============================================================
Support: sacralization; lumbarization; Castellvi classification;
unilateral/bilateral pseudoarthrosis; reactive edema; sclerosis;
supratransitional degeneration; congenital fusion; segmentation abnormality;
spina bifida occulta where visible; tethered cord; thick/fatty filum.
Bertolotti syndrome is a radiologist-selected clinical-radiological
interpretation. Do not automatically diagnose Bertolotti syndrome merely
because LSTV is present.

============================================================
20. INFLAMMATORY / SI JOINT
============================================================
For visualized SI joints support: normal; subchondral marrow edema; erosions;
sclerosis; ankylosis; joint-space abnormality; unilateral; bilateral; active
sacroiliitis pattern.
IMPORTANT: routine lumbar MRI may provide only limited SI-joint assessment.
When coverage is limited, use cautious wording. Do not automatically diagnose
axial spondyloarthritis from limited screening of the SI joints.

============================================================
21. SHARED LESION / COLLECTION CHARACTERIZATION
============================================================
Reuse a generic structured lesion/collection component: location; level;
laterality; AP; transverse; craniocaudal; T1; T2; STIR; DWI/ADC where
available; enhancement where contrast performed; canal effect; neural effect.
Reuse for: synovial cyst; epidural mass; intradural mass; psoas abscess;
paraspinal collection; postoperative collection; other focal lesions.
Do not duplicate measurement/state logic for every pathology.

============================================================
22. SPINE SCREENING ARCHITECTURE — THREE DISTINCT MODULES
============================================================
CARE must support THREE clinically distinct limited-screening modules:
1. MRI CERVICAL SPINE SCREENING
2. MRI DORSAL / THORACIC SPINE SCREENING
3. MRI LS / LUMBOSACRAL SPINE SCREENING
These are THREE separate clinical screening palettes because each spinal
region has different anatomy and clinically relevant screening observations.
They share common technical infrastructure: shared screening state/model;
shared observation/ledger integration; shared sequence-awareness; shared
normal→abnormal reconciliation; shared Findings composer; shared limitation
handling; shared recommendation handling; shared validation/provenance/undo.
DO NOT build one generic form containing identical fields for all three regions.
DO NOT create three completely independent reporting engines either.
Use shared infrastructure + region-specific clinical schemas.

IMPLEMENTATION (schema-driven, not component-triplicated):
- SCREENING_SCHEMAS: Record<'cervical'|'dorsal'|'ls', RegionScreeningSchema> where
  each schema is a DATA contract: { sections: [{ key, label, options[],
  levelOptions?, axialDependent? }], proseTemplates }. The three schemas differ
  clinically per sections 24–26.
- ONE schema-driven renderer (SpineScreeningPanel) renders any region from its
  schema. Three clinical palettes, one engine — this satisfies both prohibitions.
- Shared store slice: screening: Record<'cervical'|'dorsal'|'ls',
  { role: RegionRole; performed: boolean; obs: ScreeningObs }>.
- RegionRole: 'primary-dedicated' | 'primary-screening' |
  'accompanying-screening' | 'absent'. This single field expresses dedicated+
  screening combos, screening-only products and whole-spine screening.
- conflictGroup namespace 'screen-<region>-<section>' so reconciliation and undo
  never cross region boundaries.
- If the existing Cervical canvas has ad-hoc whole-spine screening, refactor it
  onto this shared infrastructure ONLY if audit proves a zero-regression path;
  otherwise build backward-compatible and document cervical migration as next phase.

============================================================
23. SCREENING AVAILABILITY BY PRIMARY STUDY
============================================================
The reporting canvas exposes screening modules according to the actual
examination/protocol.
MRI LUMBAR SPINE PRIMARY may include: [ Cervical Spine Screening ]
[ Dorsal Spine Screening ]; together presented as [ Whole Spine Screening ]
but internally CERVICAL SCREENING + DORSAL SCREENING.
MRI CERVICAL SPINE PRIMARY may include: [ Dorsal Spine Screening ]
[ LS Spine Screening ]; together [ Whole Spine Screening ].
MRI DORSAL SPINE PRIMARY may include: [ Cervical Spine Screening ]
[ LS Spine Screening ]; together [ Whole Spine Screening ].
SCREENING-ONLY WORKFLOW: CARE must support an individual screening module
standalone ([ MRI Cervical Spine Screening ], [ MRI Dorsal Spine Screening ],
[ MRI LS Spine Screening ]) and whole-spine-screening-only studies.
Do not require a complete Whole Spine Screening bundle when only one screening
region was performed.

IMPLEMENTATION (billing resolver mapping, mirror billedStudyType pattern):
- Dictionary entries (code/name → role set):
  MRI016 / "MRI CERVICAL SPINE SCREENING" → cervical: primary-screening.
  MRI021 / MRISCREENINGDORSAL / "MRI DORSAL SPINE SCREENING" → dorsal: primary-screening.
  MRI037 / "MRI LS SPINE SCREENING" → ls: primary-screening.
  MRI062 / "MRI WHOLE SPINE SCREENING" → cervical+dorsal+ls: primary-screening.
  MRICEWSS / "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING" → cervical:
  primary-dedicated; dorsal+ls: accompanying-screening.
  MRI038 / "MRI LS SPINE WITH SCREENING WHOLE SPINE" → ls: primary-dedicated;
  cervical+dorsal: accompanying-screening.
- performed defaults from role (role !== 'absent'); roles defaulted from the
  resolver/protocol and ALWAYS manually overridable in the canvas header.
- A region never holds two roles in one study; the dedicated lumbar canvas is
  not offered as LS screening under a lumbar primary (and vice versa).

============================================================
24. MRI CERVICAL SPINE SCREENING MODULE
============================================================
Limited structured component; NOT the full dedicated MRI Cervical canvas.
ALIGNMENT: normal cervical lordosis; loss/straightening; reversal; gross
listhesis; other gross alignment abnormality.
VERTEBRAL BODIES / MARROW: heights maintained; compression deformity; focal
marrow signal abnormality; multilevel degenerative endplate change; other
significant osseous abnormality.
DISCS: no significant disc abnormality; disc desiccation; reduced disc height;
mild disc bulge; significant disc bulge; focal protrusion; multilevel
degenerative disc disease. Allow approximate level selection where confidently
visible: C2-C3, C3-C4, C4-C5, C5-C6, C6-C7, C7-T1.
CENTRAL CANAL: no gross canal stenosis; mild narrowing; moderate/significant
stenosis; severe stenosis.
CORD: normal gross morphology/signal; cord indentation; cord compression;
focal T2/STIR signal abnormality; diffuse signal abnormality; suspected
myelopathy; syrinx if evident.
CRANIOCERVICAL JUNCTION: grossly unremarkable; tonsillar descent / suspected
Chiari; other significant abnormality.
IMPORTANT: do not expose detailed dedicated-cervical features (complete
foraminal grading, detailed root mapping, extensive uncovertebral/facet
analysis) unless the screening protocol genuinely supports them.
If an important abnormality requires characterization, allow radiologist-
selected recommendation: "Dedicated MRI cervical spine suggested."

============================================================
25. MRI DORSAL / THORACIC SPINE SCREENING MODULE
============================================================
Limited structured component.
ALIGNMENT: normal; altered kyphosis; scoliosis; gross deformity.
VERTEBRAL BODIES / MARROW: heights maintained; compression deformity; focal
marrow abnormality; multifocal marrow abnormality; degenerative endplate
change; other significant osseous abnormality.
DISCS: no significant disc abnormality; disc degeneration; disc bulge; focal
protrusion; significant disc disease. Allow approximate thoracic level
selection where confidently identified.
CANAL: no gross stenosis; mild narrowing; significant stenosis; severe stenosis.
CORD: normal gross morphology/signal; indentation; compression; focal T2/STIR
hyperintensity; diffuse signal abnormality; suspected myelopathy; syrinx.
OTHER IMPORTANT SCREENING FINDINGS: gross epidural abnormality; significant
paravertebral abnormality; obvious focal lesion.
Do not over-characterize abnormalities from limited sequences.
Allow: "Dedicated MRI dorsal spine suggested."

============================================================
26. MRI LS / LUMBOSACRAL SPINE SCREENING MODULE
============================================================
Limited structured component; NOT the full MRI Lumbar canvas.
ALIGNMENT: normal lumbar lordosis; loss/straightening; gross scoliosis; gross
listhesis.
VERTEBRAL BODIES / MARROW: heights maintained; compression deformity; focal
marrow abnormality; degenerative endplate changes; other significant osseous
abnormality.
DISCS: no significant disc abnormality; disc desiccation; reduced disc height;
diffuse bulge; focal protrusion/extrusion; multilevel degenerative disc
disease. Allow approximate level selection where confidently visible: L1-L2,
L2-L3, L3-L4, L4-L5, L5-S1 (keys from LumbarNumberingResolver).
CANAL: no gross stenosis; mild narrowing; moderate/significant stenosis; severe
stenosis.
CONUS / CAUDA: grossly normal; low-lying conus; conus signal abnormality; gross
cauda equina crowding/compression; other significant abnormality.
FORAMINAL / ROOT EFFECT (broad screening-level only, when confidently visible):
no gross foraminal stenosis; significant foraminal stenosis; suspected neural
compression.
Do NOT expose the complete dedicated lumbar lateral recess grading,
exiting/traversing root engine, detailed foraminal grading, detailed facet
analysis or full AP measurement workflow from limited screening sequences.
If significant lumbar abnormality is detected, allow: "Dedicated MRI LS spine
suggested."

============================================================
27. NORMAL SCREENING PRESETS
============================================================
Each screening module has its OWN normal preset: [ Normal Cervical Spine
Screening ], [ Normal Dorsal Spine Screening ], [ Normal LS Spine Screening ].
NORMAL CERVICAL SCREENING: alignment grossly maintained; vertebral heights
maintained; no significant disc abnormality; no gross canal stenosis; cervical
cord grossly normal.
NORMAL DORSAL SCREENING: alignment maintained; vertebral heights maintained;
no significant disc abnormality; no gross canal stenosis; dorsal cord grossly
normal.
NORMAL LS SCREENING: lumbar alignment maintained; vertebral heights maintained;
no significant disc abnormality; no gross canal stenosis; conus/cauda grossly
unremarkable.
IMPORTANT: only apply a normal screening preset if that region was actually
acquired and reviewed (role !== 'absent'). Normal → abnormal reconciliation
must work independently within each screening region: e.g. Normal Cervical
Screening + C5-C6 significant disc protrusion must remove/reconcile "No
significant cervical disc abnormality" WITHOUT altering dorsal or LS screening
observations (enforced by the 'screen-<region>-*' conflictGroup namespace).

============================================================
28. WHOLE-SPINE SCREENING IS A COMPOSITION, NOT A FOURTH MODULE
============================================================
Do NOT create a fourth independent clinical schema called "Whole Spine
Screening." Whole Spine Screening is a COMPOSITION of the region-specific
modules: PRIMARY MRI LS + Cervical Screening + Dorsal Screening; PRIMARY MRI
CERVICAL + Dorsal Screening + LS Screening; PRIMARY MRI DORSAL + Cervical
Screening + LS Screening; or screening-only compositions (e.g. MRI062 = three
primary-screening regions). This keeps observations anatomically correct and
reusable.
IMPLEMENTATION: a composition helper derives the "Whole Spine Screening"
grouping label when ≥2 screening regions are performed; the report emitter
iterates performed regions in fixed order (cervical, dorsal, ls).

============================================================
29. SCREENING LIMITATION STATEMENT
============================================================
Whenever one or more screening modules are used, include the standard
limitation statement: "SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE."
Generate it ONCE in the final report regardless of whether one, two or three
screening modules are active. Do not repeat it under every region.
IMPLEMENTATION: emitter-level rule, not per-region prose.

============================================================
30. SCREENING REPORT COMPOSITION
============================================================
Primary lumbar example:
MRI LUMBAR SPINE — FINDINGS: [detailed lumbar findings]
WHOLE-SPINE SCREENING: Cervical Spine: [structured cervical screening
findings]; Dorsal Spine: [structured dorsal screening findings]
SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.
IMPRESSION: 1. [important primary lumbar findings] 2. [important cervical
screening finding, if significant] 3. [important dorsal screening finding, if
significant]
RECOMMENDATION: [dedicated regional MRI recommendation only when selected]
Primary cervical and primary dorsal follow the same shape with their own
screening pair. For a SCREENING-ONLY study (single region or whole-spine
screening product), the screening section(s) ARE the report body — no dedicated
findings block — with the limitation statement once.

============================================================
31. SCREENING IMPRESSION RULES
============================================================
Screening findings should not automatically flood the Impression. Promote to
Impression when clinically significant, for example: significant cervical cord
compression; cervical cord signal abnormality; significant dorsal cord
compression; dorsal cord signal abnormality; suspicious vertebral lesion;
significant fracture/compression deformity; severe screening-level canal
stenosis; gross lumbar neural compression; other important abnormality
selected by radiologist. Minor screening degeneration can remain in Findings.
Radiologist controls whether a screening finding enters Impression.
IMPLEMENTATION: each screening abnormality carries significant:boolean; the
listed critical-grade items pre-set significant=true as an OVERRIDABLE
suggestion; the impression emitter includes only significant entries.

============================================================
32. SCREENING SEQUENCE AWARENESS
============================================================
Screening modules must be protocol-aware. No cervical screening sequences → no
cervical screening findings/preset. No dorsal screening → no dorsal screening
findings. No LS screening → no LS screening findings. No STIR → do not generate
STIR-dependent statements. Limited sagittal-only screening → do not generate
detailed axial-dependent foraminal/root conclusions. No adequate level
localization → avoid false precision regarding level. No contrast → no
enhancement conclusions. The UI should make the limitations of the available
screening protocol clear without obstructing reporting.
IMPLEMENTATION: schema options carry axialDependent flags; sagittal-only mode
hides or disables those options; level chips disabled (or marked approximate)
when localizer inadequate.

============================================================
33. SCREENING CONTRADICTION VALIDATION
============================================================
Validate each screening module independently. CERVICAL: "Cord grossly normal"
vs "Cord T2 hyperintensity". DORSAL: "No significant disc abnormality" vs
"D7-D8 significant disc protrusion". LS: "No gross canal stenosis" vs "Severe
L4-L5 canal stenosis". Also validate cross-report consistency: a screening
finding should not contradict a detailed primary-region observation if both
somehow refer to the same region (by the role model this cannot occur in
normal flows; keep as a guard for manual override). Warn. Never silently
overwrite.

============================================================
34. SCREENING TESTS
============================================================
Add tests for: cervical screening independently; dorsal screening
independently; LS screening independently; normal cervical/dorsal/LS
screening; normal → abnormal reconciliation independently per region; cervical
abnormality does not modify dorsal state; dorsal abnormality does not modify
LS state; LS abnormality does not modify cervical state; lumbar primary +
cervical screening; lumbar primary + dorsal screening; lumbar primary + both =
whole spine screening; cervical primary + dorsal screening; cervical primary +
LS screening; cervical primary + both; dorsal primary + cervical screening;
dorsal primary + LS screening; dorsal primary + both; screening-only single
region; screening-only whole spine (MRI062 role set); resolver mappings
(MRI016/021/037/062/MRICEWSS/MRI038 → role sets); screening limitation
statement appears exactly once; no screening prose when region not performed;
limited sagittal screening does not produce detailed axial/root findings;
dedicated-study recommendation only when selected; significant screening
abnormality can enter Impression (and suggestion default is overridable);
minor screening abnormality remains Findings-only; screening observations
preserve manual text/provenance/undo; LS screening level keys follow
LumbarNumberingResolver.

============================================================
35. SEQUENCE / PROTOCOL-AWARE REPORTING (PRIMARY CANVAS)
============================================================
Mandatory. Do not generate statements requiring sequences that were not
performed. No STIR → do not claim absence of marrow edema based on STIR.
No contrast → do not describe enhancement/non-enhancement. No DWI → no
diffusion statements. No adequate whole-spine/localizer → do not imply
absolute numbering certainty in an LSTV case.
IMPLEMENTATION (state): sequencesAvailable: { stir, dwi, contrast,
wholeSpineLocalizer, dynamic, cervicalScreening, dorsalScreening, lsScreening }
in the store; defaulted from the study protocol/description when derivable,
editable in the canvas header; screening performed-flags bind to the
screening roles. Composer gates sentence families on these flags; missing
sequence → emit limitation wording instead of the negative finding. Presets
declare required sequences/regions; applying a preset beyond what is available
auto-downgrades those sentences to limitation wording + one-line notice.

============================================================
36. PRESETS — CONVERT EXISTING MACROS
============================================================
The supplied lumbar macros must become editable STARTING PRESETS, not static
final reports. At minimum:
DEGENERATIVE: "Degenerative Lumbar Spondylosis with Canal & Foraminal Stenosis"
DISC / NEURAL COMPRESSION: "Acute Focal Disc Extrusion with Nerve Root Compression"
SPONDYLOLISTHESIS: "Isthmic Spondylolisthesis with Foraminal Impingement"
LSTV: "LSTV with Supratransitional Disc Degeneration"
POST-OPERATIVE: "Post-operative Lumbar Spine — Recurrent Disc vs Epidural Fibrosis"
Also support where they fit: Normal MRI Lumbar Spine; Acute Compression
Fracture; Severe Lumbar Canal Stenosis; Spondylodiscitis ± Epidural/Paraspinal
Collection; Tethered Cord / Low-Lying Conus; Acute Cauda Equina Syndrome
(CRITICAL preset); Modic Changes with Discitis / Spondylodiscitis.
Screening normal presets are defined per region in section 27.
All presets must: populate structured observations; remain editable; support
undo; not destroy unrelated observations; not overwrite protected manual text;
never finalize the report automatically.

============================================================
37. IMPRESSION PRIORITIZATION
============================================================
The Impression composer should NOT simply repeat Findings. Prioritize:
1 acute/urgent abnormalities; 2 dominant clinically significant level(s);
3 severe central canal stenosis; 4 definite nerve-root compression;
5 significant foraminal/lateral recess stenosis; 6 focal disc
extrusion/sequestration; 7 spondylolisthesis/pars abnormality; 8 fracture;
9 infection; 10 mass; 11 conus/cauda compression; 12 significant postoperative
complication; 13 significant screening abnormality.
Minor degenerative findings need not dominate the Impression. The radiologist
must remain able to edit/reorder Impression manually.
IMPLEMENTATION: the priority rank table lives in lib (e.g. impressionPriority.ts),
not JSX; a manual reorder/edit freezes auto-ordering for that report.

============================================================
38. FINDINGS → IMPRESSION
============================================================
Reuse existing CARE observation ledger. STRUCTURED OBSERVATION → FINDINGS →
IMPRESSION. When linked Findings change: mark Impression stale / needs refresh;
do not silently overwrite manually edited Impression; preserve provenance;
preserve manual-text protection; preserve deduplication; preserve undo.

============================================================
39. CONTRADICTION VALIDATION
============================================================
Extend the EXISTING validator. Catch: normal alignment vs spondylolisthesis;
normal marrow vs Modic/infiltrative/infective abnormality; no fracture vs
acute fracture; normal discs vs disc extrusion; canal patent vs severe
stenosis; foramina patent vs severe foraminal stenosis; no root compression vs
root compression; normal conus vs conus signal abnormality; normal cauda
equina vs crowding/clumping/compression; normal paraspinal tissues vs
psoas/paraspinal abscess; no postoperative collection vs
pseudomeningocele/abscess. Also validate LEVEL + DISC LOCATION +
EXITING/TRAVERSING ROOT. Screening validators live in section 33.
Warn. Never silently rewrite the radiologist's interpretation.

============================================================
40. CRITICAL / URGENT FINDINGS
============================================================
Reuse CARE's existing critical-result workflow. Potential urgent lumbar
findings: severe acute cauda equina compression; acute conus compression;
epidural abscess with neural compression; epidural hematoma with severe
compression; unstable acute fracture with canal compromise; malignant epidural
neural compression. Important screening findings such as severe cord
compression or cord signal abnormality are eligible for the same workflow.
Do not rely on one measurement alone to declare criticality.
Never automatically state that a clinician was informed.

============================================================
41. AI COMPATIBILITY
============================================================
Do not rebuild AI in this task. Preserve existing AI Draft / Selected Images
workflow. Design structured observations so future AI can propose: disc
desiccation; disc extrusion; canal stenosis; lateral recess stenosis; foraminal
stenosis; Modic changes; marrow edema; nerve-root compression; fracture;
spondylolisthesis; gross cervical screening abnormality; gross dorsal screening
abnormality; gross LS screening abnormality. AI workflow: PROPOSE →
RADIOLOGIST ACCEPT / EDIT / REJECT → OBSERVATION LEDGER. Never silently finalize.

============================================================
42. UI / UX
============================================================
The new Lumbar canvas must feel SIMPLER, not larger.
Typical degenerative workflow: DEGENERATIVE → alignment → general disc/endplate
changes → level-by-level → AP measurements → lateral recess → foramina → root
effect → optional whole-spine screening → Findings → Impression.
Typical focal disc workflow: DISC / NEURAL COMPRESSION → level → morphology →
location → size/migration → recess/foramen → suggested root → neural effect →
Impression.
Screening modules are exposed per regionRole and collapsed by default unless
the protocol includes screening or the radiologist opens them; when ≥2 regions
are performed they group under a "Whole Spine Screening" header.
Rare infection/tumor/congenital findings must not clutter routine degenerative
reporting.

============================================================
43. TESTS (CORE + WORKFLOW)
============================================================
CORE: normal baseline; normal → abnormal reconciliation; multiple sub-masters;
palette switching preserves observations.
DEGENERATIVE: level-by-level reporting; AP measurement propagation; canal
morphology; lateral recess severity; foraminal laterality; LF hypertrophy;
facet arthropathy; synovial cyst; epidural lipomatosis.
ROOT INTELLIGENCE: exiting-root suggestion; traversing-root suggestion; manual
override; inconsistent root warning; LSTV numbering interaction.
DISC: protrusion; extrusion; sequestration; cranial/caudal migration.
VERTEBRAE: Modic I/II/III; Schmorl node; acute fracture.
LISTHESIS: degenerative slip; pars defect/isthmic slip; dynamic fields not
exposed as routine MRI inference.
LSTV: numbering; Castellvi; supratransitional degeneration.
OTHER: infection; psoas/epidural collection; conus abnormality; cauda equina
compression/clumping; postoperative recurrent disc/fibrosis; sequence-aware
contrast wording.
WORKFLOW: preset apply; preset undo; manual-text protection; Findings change →
Impression stale; contradiction warnings; critical workflow without false
communication documentation.
BINDING TESTS: LSTV resolver remaps keys and UI/table/findings/roots/LS-screening
refs all agree; sequence gating incl. dynamic + screening flags and preset
downgrade notice; root conflictGroup coexistence (traversing L5 + exiting L4 at
L4-L5 both survive; undo restores); canal-morph slot replacement; lipomatosis
combined sentence.
SCREENING TESTS: per section 34.
Run relevant tests and typecheck. Build if practical.

============================================================
44. IMPLEMENTATION CONSTRAINTS
============================================================
DO NOT: create a second lumbar report editor; create a fourth "Whole Spine
Screening" clinical schema; create three completely independent screening
engines; build one generic identical-fields screening form; duplicate
Zustand/store; duplicate observation ledger; duplicate AP measurement state;
duplicate validator; make hundreds of visible chips; copy cervical-only anatomy
into lumbar; treat limited screening as a dedicated MRI; over-grade or
over-characterize screening abnormalities; generate screening findings for
sequences/regions not performed; hard-code questionable clinical thresholds in
JSX; silently overwrite manual text; automatically diagnose disease from one
imaging sign; auto-finalize reports; auto-document critical communication;
alter PACS/DICOM; alter billing/accounting; make unrelated ERP changes; perform
destructive migrations; modify production data.

============================================================
45. COMPLETION REPORT
============================================================
Provide: 1 audit findings; 2 final architecture; 3 branch; 4 commit SHA;
5 PR URL; 6 files changed/new; 7 schema/API/migration changes if any;
8 sub-masters implemented; 9 shared spine components reused; 10 vertebral
numbering/LSTV implementation; 11 level-by-level implementation; 12 canal/AP
measurement integration; 13 canal morphology implementation; 14 lateral recess
implementation; 15 root intelligence; 16 epidural-space/lipomatosis support;
17 sequence awareness (primary + screening); 18 three-module screening
architecture and regionRole model; 19 billing resolver → role-set mappings;
20 cervical/dorsal/LS screening implementations; 21 whole-spine composition
behaviour; 22 screening limitation/recommendation/impression-promotion
behaviour; 23 presets implemented (lumbar + per-region screening);
24 Findings/Impression integration; 25 impression prioritization;
26 contradiction validation (primary + screening); 27 critical-result
integration; 28 manual-text/provenance protection; 29 AI compatibility;
30 tests/typecheck/build results; 31 screenshots (Routine; Degenerative;
Disc/Neural Compression; LSTV/Spondylolisthesis; Lumbar primary + Whole-Spine
Screening; Screening-only study; Post-operative; one mixed-sub-master case);
32 known limitations; 33 recommended next phase (incl. cervical dedicated
canvas migration onto shared screening infra).
CREATE THE PR. DO NOT MERGE.