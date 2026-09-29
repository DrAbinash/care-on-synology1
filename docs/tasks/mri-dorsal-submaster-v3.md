TASK: CARE ERP — MRI DORSAL / THORACIC SPINE CLINICAL SUB-MASTER REPORTING V3
WITH SHARED THREE-MODULE SPINE SCREENING

Repository: DrAbinash/care-on-synology1

BINDING RULES (hard):
- All chip/preset application MUST go through useWorkspace.getState().applyMacroBundle /
  applyPathologyOverlay. Level entries MUST flow through buildDorsalLevelApplyBundle (mirror
  the lumbar pattern). AP inputs MUST write canalApProvenance via setCanalApProvenance.
- No parallel local React state for observations, measurements, level resolution, or screening.
- Use conflictGroup slots: lvl-<key>-disc, -canal-sev, -cord, -foram-R, -foram-L. Same-slot
  replacement; undo restores verbatim baseline.

SOURCE CONTENT:
The canonical clinical content library for this task is:
docs/clinical-libraries/mri-dorsal-clinical-content-library.md

Use that file as the authoritative clinical content source for findings,
terminology and starting presets.

Seeded/preset prose MUST be derived from that canonical library.
The implementation may parameterize variables such as level, laterality,
measurements and severity, but must not silently invent new clinical diagnoses
or unsupported clinical sentences.

Existing in-code report prose and docs/mri-report-formats reference files are
not canonical for this task unless their prose is identical to or explicitly
incorporated into the canonical library. If existing production prose conflicts
with the canonical library, do not silently choose or overwrite it: preserve
safe production behaviour as needed and document the discrepancy in the
completion/spec-compliance report.

This V3 specification remains authoritative for architecture, workflow,
validation and safety rules; the canonical clinical library is authoritative
for seeded clinical prose.

Where the source library contains wording that implies a diagnosis from a
single imaging feature, preserve the useful descriptive observation but require
radiologist selection/approval before emitting the stronger etiologic or
syndromic diagnosis.

============================================================
OBJECTIVE
============================================================

Enhance the EXISTING CARE MRI spine structured-reporting architecture with a
dedicated MRI DORSAL / THORACIC SPINE Clinical Sub-Master canvas.

This is NOT a new reporting system.

Reuse CARE's existing:
- reporting canvas architecture
- structured observation model
- observation ledger
- Zustand / useWorkspace infrastructure
- reportFieldMerge / provenance protection
- applyMacroBundle / applyPathologyOverlay
- Findings composer
- Impression refresh/staleness workflow
- contradiction validator
- critical-result workflow
- AI Draft / Selected Images workflow
- spine measurement infrastructure
- shared lesion/measurement components
- shared three-region spine-screening architecture introduced by the Lumbar V3
  specification where available

Dorsal reporting must share GENERIC spine infrastructure with Cervical and
Lumbar where clinically appropriate, while preserving THORACIC anatomy.

DO NOT copy cervical-specific anatomy such as uncovertebral joints into dorsal
reporting.

DO NOT copy lumbar-specific traversing-root/lateral-recess/pars workflows into
thoracic reporting unless anatomically appropriate.

Thoracic-specific anatomy and pathology must remain first-class:
- thoracic kyphosis
- thoracic spinal cord
- rib-bearing vertebrae
- costovertebral / costotransverse region
- thoracic neural foramina
- ligamentum flavum / OLF
- OPLL where applicable
- thoracic disc disease
- epidural space
- paravertebral space
- thoracolumbar junction
- conus when included
- thoracic cord compression / signal abnormality
- intradural / intramedullary disease
- vascular-pattern observations

============================================================
1. AUDIT FIRST
============================================================

Before coding inspect current main for:

- existing dorsal/thoracic MRI reporting implementation
- MriLumbarCanvas.tsx
- MriCervicalCanvas.tsx
- any dorsal canvas or dorsal screening implementation
- mriLumbarLevelState / mriCervicalLevelState
- generic spine level-state infrastructure
- mriSpineGrading
- SpineApCanalMeasurements or equivalent
- structured observation builders
- observation ledger
- abnormalPatterns / macro infrastructure
- applyMacroBundle
- applyPathologyOverlay
- undo infrastructure
- reportFieldMerge / provenance
- Findings → Impression refresh
- contradiction validators
- critical-result workflow
- sequence/protocol representation
- billedStudyType / catalog-code resolver
- current whole-spine / regional screening implementation
- existing spine tests

Determine which functionality can safely become shared spine infrastructure
without changing existing Cervical or Lumbar behaviour.

Do not refactor stable existing components merely for architectural elegance.

Provide a concise architecture audit and implementation plan BEFORE coding.

Then:

NEW BRANCH
→ IMPLEMENT
→ TEST
→ REVIEW AGAINST THIS SPEC
→ PR

DO NOT MERGE.

============================================================
2. CLINICAL SUB-MASTERS
============================================================

Organize MRI Dorsal Spine using progressive-disclosure clinical palettes:

1. ROUTINE / NORMAL
2. DEGENERATIVE / DISC
3. CANAL STENOSIS / CORD COMPRESSION
4. OPLL / OLF / DISH
5. TRAUMA
6. INFECTION / SPONDYLODISCITIS
7. TUMOR / MARROW / METASTASIS
8. INTRADURAL / INTRAMEDULLARY
9. VASCULAR / dAVF PATTERN
10. POST-OPERATIVE
11. DEFORMITY / KYPHOSIS / SCOLIOSIS
12. CONGENITAL / DEVELOPMENTAL
13. THORACOLUMBAR JUNCTION / CONUS
14. MORE / ADVANCED

These are NOT separate report editors.

They are palettes over ONE dorsal observation model.

Multiple palettes may be active simultaneously.

Examples:

DEGENERATIVE + CORD COMPRESSION
OLF + CORD COMPRESSION
TRAUMA + THORACOLUMBAR JUNCTION
INFECTION + CORD COMPRESSION
TUMOR + EPIDURAL EXTENSION
INTRADURAL + CORD COMPRESSION
DEFORMITY + DEGENERATIVE

Switching palettes must never delete unrelated existing observations.

============================================================
3. SHARED DORSAL CORE
============================================================

The common dorsal observation model must support:

- study/protocol adequacy
- vertebral numbering / coverage
- alignment
- thoracic kyphosis
- scoliosis / deformity
- vertebral bodies
- vertebral heights
- marrow signal
- endplates
- intervertebral discs
- level-by-level findings
- central canal
- AP canal measurements where actually measured
- CSF-space morphology
- thoracic spinal cord
- cord caliber
- cord compression
- cord signal
- neural foramina
- posterior elements
- facets where relevant
- ligamentum flavum
- OLF
- OPLL
- epidural space
- intradural space
- paravertebral soft tissues
- costovertebral / costotransverse region where visualized
- thoracolumbar junction
- conus medullaris when covered
- screening modules
- recommendations

Do not duplicate these structures inside individual sub-masters.

============================================================
4. COVERAGE / LEVEL RESOLVER
============================================================

Create or reuse a DorsalLevelResolver rather than scattering hard-coded arrays
through components.

Typical dedicated dorsal coverage:

T1-T2
T2-T3
T3-T4
T4-T5
T5-T6
T6-T7
T7-T8
T8-T9
T9-T10
T10-T11
T11-T12
T12-L1 when included

Actual acquired coverage is authoritative.

Do not imply T12-L1 or conus assessment when it is outside the acquired study.

The resolver must provide the same active level keys to:

- UI
- observation ledger
- measurements
- Findings emitter
- Impression references
- validators
- presets
- screening/dedicated composition where applicable

Do not maintain separate conflicting level arrays.

DORSAL LEVEL NUMBERING CONFIDENCE

Support:
- whole-spine/localizer-confirmed numbering
- cervicothoracic landmark-based numbering
- thoracolumbar landmark-based numbering
- manual radiologist designation
- uncertain numbering

If reliable whole-spine/localizer correlation is unavailable and level
assignment is uncertain, allow a reduced-certainty numbering caveat.

Never silently renumber an existing lesion when the numbering method changes.
Changing the numbering method must remap through DorsalLevelResolver and require
radiologist-visible review of affected observations before finalization.

============================================================
5. ROUTINE / NORMAL
============================================================

Provide a one-click NORMAL DORSAL SPINE baseline using source-library normal
content where supported.

Structured normal observations should include, when actually evaluated:

- thoracic kyphosis/alignment maintained
- vertebral body heights maintained
- marrow signal without focal significant abnormality
- disc heights/signals without significant focal herniation
- no significant central canal stenosis
- thoracic cord normal in caliber and intrinsic signal
- neural foramina without significant narrowing
- posterior elements grossly intact
- paraspinal soft tissues without significant abnormality
- conus normal only when adequately included

NORMAL is structured observations, not one irreversible paragraph.

Normal → abnormal reconciliation is mandatory.

Example:

Normal Cord
+
T8-T9 cord compression selected

must remove/reconcile conflicting normal-cord observations while preserving
unrelated normal anatomy.

============================================================
6. ALIGNMENT / KYPHOSIS / DEFORMITY
============================================================

Support structured observations for:

- normal thoracic kyphosis
- exaggerated thoracic kyphosis
- straightening / reduced kyphosis
- reversal where applicable
- scoliosis
- side of convexity
- apex level
- vertebral rotation where selected
- focal kyphotic angulation
- gibbus deformity
- anterolisthesis
- retrolisthesis
- measurement of translation
- junctional deformity

Do not automatically assign etiology such as osteoporosis, trauma or infection
from deformity alone.

Etiology is separately selected/derived from supporting observations.

============================================================
7. VERTEBRAL BODIES / MARROW / ENDPLATES
============================================================

Support:

- preserved vertebral heights
- chronic wedging
- compression deformity
- acute compression fracture
- burst fracture
- pathological fracture
- marrow edema
- focal marrow replacement
- diffuse marrow abnormality
- hemangioma pattern
- Schmorl nodes
- endplate irregularity
- Modic-type endplate changes where applicable
- sclerosis where supported
- posterior element involvement
- pedicle involvement
- multifocal marrow lesions

Do not automatically convert:
"multiple marrow lesions"
into
"metastases"

unless the radiologist selects metastatic disease or the diagnostic conclusion
is otherwise explicitly approved.

Likewise, benign-appearing marrow lesions remain descriptive until categorized.

============================================================
8. DEGENERATIVE / DISC DISEASE
============================================================

Support:

- disc desiccation
- disc-height reduction
- diffuse bulge
- focal protrusion
- extrusion
- sequestration where appropriate
- central
- paracentral
- foraminal
- extraforaminal
- cranial migration
- caudal migration
- calcified/low-signal disc component when supported
- ventral thecal-sac indentation
- CSF-space effacement
- cord contact
- cord flattening
- cord compression

Measurements:

- AP dimension
- transverse dimension
- craniocaudal extent when relevant

Do not equate disc contact with cord compression.

Do not equate cord compression with myelopathy unless intrinsic cord signal
abnormality and/or radiologist interpretation supports it.

============================================================
9. LEVEL-BY-LEVEL DORSAL REPORTING
============================================================

Provide compact level cards using DorsalLevelResolver.

Each level may support:

DISC:
- normal
- desiccation
- bulge
- protrusion
- extrusion
- calcified/low-signal component
- location
- migration
- dimensions

CENTRAL CANAL:
- patent
- mild/moderate/severe narrowing when radiologist selected
- AP measurement
- CSF preserved
- partial CSF effacement
- complete local CSF effacement
- cord contact
- cord flattening
- cord compression

FORAMINA:
- right
- left
- none/mild/moderate/severe narrowing where supported

POSTERIOR:
- facet change where relevant
- ligamentum flavum thickening
- suspected/selected OLF

CORD AT LEVEL:
- normal
- displaced
- flattened
- compressed
- T2/STIR signal abnormality
- focal swelling
- focal atrophy where appropriate

Use conflictGroup/slot semantics so replacing severity or morphology does not
delete unrelated observations.

============================================================
10. CENTRAL CANAL / AP MEASUREMENTS
============================================================

Reuse the existing spine AP measurement architecture.

Do NOT create a second measurement state.

AP values must use the established provenance mechanism, including
setCanalApProvenance where that is the shared CARE contract.

The system may display measurements and allow radiologist-selected grading.

Do not introduce questionable hard-coded thoracic stenosis thresholds merely
for automation.

If an existing validated CARE grading helper applies to thoracic levels, reuse
it only after confirming its anatomical applicability.

If quantitative measurement and selected qualitative severity materially
conflict, warn rather than silently rewriting either.

============================================================
11. THORACIC SPINAL CORD
============================================================

Cord assessment is first-class in dorsal reporting.

Support:

- normal caliber
- normal signal
- focal flattening
- compression
- displacement
- swelling
- edema-pattern T2/STIR hyperintensity
- intrinsic T2/STIR cord hyperintensity
- myelomalacia-pattern signal abnormality
- atrophy
- focal intramedullary lesion
- longitudinal intramedullary signal abnormality

Keep these concepts separable:

CORD COMPRESSION
CORD SIGNAL ABNORMALITY
MYELOPATHY
MYELOMALACIA

Do not automatically call every T2 hyperintense cord focus "myelomalacia."

Keep intrinsic cord signal abnormality as the primary imaging observation.
"Compressive myelopathy" is a radiologist-selected interpretation when the
morphology and clinical/imaging context support it.

Do not automatically infer acuity from signal alone.

============================================================
12. THORACOLUMBAR JUNCTION / CONUS
============================================================

When included in actual coverage, support:

- T11-T12
- T12-L1
- L1 region where acquired
- junctional kyphosis
- fracture/retropulsion
- canal compromise
- conus compression
- conus displacement
- conus edema/signal abnormality
- conus termination level
- low-lying conus
- focal conus lesion

Conus termination must be STRUCTURED and editable.

Never hard-code "conus terminates at L1" into all normal reports.

If the conus is not adequately included:
do not emit a normal conus statement.

============================================================
13. NEURAL FORAMINA
============================================================

Support right/left thoracic foraminal assessment.

Observations:

- patent
- narrowing
- disc-related narrowing
- osteophyte-related narrowing
- posterior-element-related narrowing
- focal lesion extending into foramen

IMPORTANT: Thoracic nerve root localization is unreliable without clear rib counting.
If root involvement is suspected, allow descriptive text (e.g., "suspected involvement of
intercostal nerve at this level") but DO NOT auto-suggest specific root numbers (e.g., "T6
radiculopathy") unless the radiologist explicitly selects/overrides it.

Do not import the full lumbar exiting/traversing-root inference engine into the
thoracic canvas.

============================================================
14. COSTOVERTEBRAL / POSTERIOR ELEMENTS
============================================================

Support:

- costovertebral joint abnormality where visible
- costotransverse region where visible
- hypertrophic/degenerative change
- osteophytes
- pedicles
- laminae
- spinous processes
- facets
- posterior element marrow lesion
- posterior element fracture
- interspinous ligament injury
- ligamentum flavum abnormality

These fields should remain collapsed in routine cases unless abnormal or the
relevant palette is selected.

============================================================
15. OLF / OPLL / DISH
============================================================

Provide dedicated structured observations for:

OLF:
- level
- side/bilateral
- focal/nodular/continuous morphology where supported
- canal effect
- cord effect
- associated cord signal abnormality

OPLL:
- level/extent
- focal/segmental/continuous description where supported
- ventral canal compromise
- cord effect

DISH:
- flowing/bridging anterior longitudinal ligament ossification pattern
- levels involved
- preserved/reduced disc spaces as observed

IMPORTANT:
MRI may suggest ossification but CT may characterize mineralization/ossification
better.

Do not automatically label low-signal ligamentous thickening as OLF or OPLL
without radiologist selection.

Do not automatically diagnose DISH from one bridging osteophyte.

============================================================
16. TRAUMA
============================================================

Support:

- compression fracture
- burst fracture
- wedge fracture
- posterior-wall involvement
- retropulsion
- vertebral height loss %
- marrow edema
- posterior-element fracture
- facet injury
- interspinous injury
- posterior ligamentous complex observations
- epidural hematoma
- canal compromise
- cord compression
- cord edema/contusion pattern
- conus injury at junction
- pre/paravertebral soft-tissue abnormality

Provide a structured THORACOLUMBAR BURST FRACTURE preset based on the supplied
clinical library.

Do not automatically declare mechanical instability from routine supine MRI
alone.

Do not automatically infer a complete ligamentous disruption from nonspecific
STIR hyperintensity.

============================================================
17. INFECTION / SPONDYLODISCITIS
============================================================

Support:

- vertebral level(s)
- disc involvement
- endplate erosion/destruction
- marrow edema
- vertebral collapse
- kyphotic/gibbus deformity
- epidural component
- prevertebral collection
- paravertebral collection
- abscess dimensions
- craniocaudal extent
- psoas extension when junctional/lower thoracic coverage includes it
- canal compromise
- cord compression
- enhancement when contrast exists

Allow radiologist-selected diagnostic impressions such as:
- infective spondylodiscitis
- tuberculous spondylodiscitis / Pott disease

But DO NOT automatically convert an imaging pattern into tuberculous etiology.

"Cold abscess" and "Pott's spine" must not be generated merely because a
paravertebral collection is present.

Contrast-dependent enhancement wording must be sequence-gated.

============================================================
18. TUMOR / MARROW / METASTATIC DISEASE
============================================================

Support:

- focal marrow lesion
- multifocal marrow lesions
- diffuse marrow replacement
- vertebral body involvement
- pedicle involvement
- posterior element involvement
- pathological fracture
- epidural extension
- paravertebral extension
- foraminal extension
- canal compromise
- cord compression

Reuse shared lesion characterization.

Radiologist may classify as:

- indeterminate
- benign-appearing
- suspicious
- metastatic disease
- primary osseous lesion
- other

Do not automatically diagnose metastasis from multifocal signal abnormalities.

============================================================
19. INTRADURAL / INTRAMEDULLARY
============================================================

Support lesion compartment:

- extradural
- intradural extramedullary
- intramedullary

Structured lesion fields:

- level
- craniocaudal extent
- AP/transverse dimensions
- T1
- T2
- STIR
- DWI/ADC where available
- susceptibility where available
- enhancement where contrast performed
- cord expansion
- cord displacement
- canal effect
- associated edema
- syrinx if present

Diagnostic labels such as schwannoma, meningioma, ependymoma or astrocytoma
must be radiologist-selected interpretations rather than automatic consequences
of compartment alone.

============================================================
20. VASCULAR / dAVF-PATTERN OBSERVATIONS
============================================================

Support descriptive observations for:

- serpiginous perimedullary flow voids
- dorsal/ventral predominance
- cord swelling
- longitudinal cord T2 hyperintensity
- conus involvement
- enhancement when contrast available

Allow radiologist-selected impression:
"Findings raise suspicion for spinal dural arteriovenous fistula."

Do NOT automatically diagnose dAVF from prominent flow voids alone.

Allow recommendation for appropriate dedicated vascular evaluation when
selected by the radiologist.

============================================================
21. EPIDURAL SPACE
============================================================

Support:

- normal epidural space
- epidural fat prominence
- epidural lipomatosis
- epidural collection
- epidural hematoma
- epidural tumor
- epidural inflammatory tissue
- canal effect
- cord effect

If epidural lipomatosis and degenerative stenosis coexist, Findings should be
capable of composing a combined non-duplicative sentence.

============================================================
22. PARAVERTEBRAL / EXTRA-SPINAL OBSERVATIONS
============================================================

Support clinically relevant visualized findings such as:

- prevertebral/paravertebral collection
- paraspinal mass
- soft-tissue edema
- pleural fluid where visualized
- other gross thoracic extra-spinal finding

Do not turn the spine report into a comprehensive chest examination.

Incidental observations should explicitly reflect limited field-of-view when
appropriate.

Aortic or mediastinal abnormalities, if represented, must be descriptive and
must not imply comprehensive vascular/chest assessment.

============================================================
23. POST-OPERATIVE
============================================================

Support:

- laminectomy
- decompression
- discectomy where applicable
- fusion
- instrumentation
- postoperative collection
- hematoma
- infection
- residual/recurrent stenosis
- epidural fibrosis where contrast supports evaluation
- adjacent segment degeneration
- cord decompression status
- hardware-related artifact

Respect MRI limitations for detailed hardware integrity, fusion assessment and
subtle loosening.

Do not state hardware loosening solely from nonspecific MRI signal.

============================================================
24. SHARED LESION / COLLECTION CHARACTERIZATION
============================================================

Reuse the generic CARE lesion/collection component wherever possible.

Fields:

- compartment
- location
- level
- laterality
- AP
- transverse
- craniocaudal
- T1
- T2
- STIR
- DWI/ADC where available
- susceptibility where available
- enhancement where contrast performed
- canal effect
- cord effect
- foraminal effect
- paravertebral extension

Reuse for:

- epidural mass
- epidural collection
- intradural mass
- intramedullary mass
- paravertebral collection
- postoperative collection
- other focal lesion

Do not create separate measurement/state engines for every pathology.

============================================================
25. SEQUENCE / PROTOCOL AWARENESS
============================================================

Reuse/extend shared sequence availability.

At minimum support relevant flags for:

- T1
- T2
- STIR / fat-suppressed fluid-sensitive imaging
- axial imaging
- DWI/ADC
- GRE/SWI where performed
- contrast
- whole-spine localizer
- dynamic imaging if ever available
- cervical screening
- dorsal screening
- LS screening

Protocol-derived values may initialize these flags where reliable.

Radiologist must be able to correct them.

Presets declare requirements.

Examples:

No contrast
→ no enhancement statement.

No axial imaging
→ do not generate unsupported detailed foraminal or focal canal precision.

No DWI
→ no diffusion restriction statement.

No adequate conus coverage
→ no normal conus statement.

When a preset cannot be fully supported by the available protocol, downgrade
the generated prose and show a non-blocking limitation notice rather than
fabricating observations.

IMPLEMENTATION (state):
- sequencesAvailable: { stir, dwi, contrast, wholeSpineLocalizer, dynamic, axial,
  cervicalScreening, dorsalScreening, lsScreening } in the store; defaulted from the study
  protocol/description when derivable, editable in the canvas header.
- Composer gates sentence families on these flags; missing sequence → emit limitation wording
  instead of the negative finding (e.g., "assessment of enhancement limited by absence of
  contrast").
- Presets declare required sequences/regions; applying a preset beyond what is available
  auto-downgrades those sentences to limitation wording + one-line notice.

============================================================
26. SHARED THREE-MODULE SPINE SCREENING
============================================================

DO NOT create another screening engine.

Reuse the shared screening architecture defined by CARE Spine V3:

SCREENING_SCHEMAS:
Record<'cervical' | 'dorsal' | 'ls', RegionScreeningSchema>

Shared renderer:
SpineScreeningPanel

Shared state:
screening:
Record<'cervical' | 'dorsal' | 'ls', {
  role: RegionRole;
  performed: boolean;
  obs: ScreeningObs;
}>

RegionRole:
- primary-dedicated
- primary-screening
- accompanying-screening
- absent

For a dedicated MRI Dorsal Spine:

dorsal = primary-dedicated

When whole-spine screening accompanies it:

cervical = accompanying-screening
ls = accompanying-screening

Do NOT show a separate limited Dorsal Screening module inside an already
dedicated dorsal study.

The dedicated dorsal canvas is authoritative for the dorsal region.

============================================================
27. DORSAL + WHOLE-SPINE SCREENING COMPOSITION
============================================================

Dedicated dorsal study may include:

[ Cervical Spine Screening ]
[ LS Spine Screening ]

When both are performed, group them visually under:

WHOLE SPINE SCREENING

but internally they remain:

CERVICAL SCREENING
+
LS SCREENING

Whole Spine Screening is NOT a fourth clinical schema.

Report order for a dedicated dorsal study:

MRI DORSAL SPINE — FINDINGS
[detailed dorsal findings]

WHOLE-SPINE SCREENING
Cervical Spine: [...]
LS Spine: [...]

SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.

IMPRESSION
1. important dorsal finding(s)
2. significant cervical screening finding if selected
3. significant LS screening finding if selected

RECOMMENDATION
[only radiologist-selected recommendations]

The screening limitation statement must appear ONCE regardless of the number of
screening regions.

============================================================
28. BILLED-STUDY / COMPOSITION RESOLVER
============================================================

Audit the current catalog before hard-coding product codes.

DO NOT assume "DL SPINE" means Dorsal Spine. "DL" may represent Dorso-Lumbar
in the CARE catalog. Audit the live catalog and existing billedStudyType
mappings first. If MRI020 / "MRI DL SPINE" represents Dorso-Lumbar, do NOT map
it to dorsal primary-dedicated. Only explicitly verified Dorsal/Thoracic study
codes or names may initialize dorsal = primary-dedicated. Ambiguous "DL" labels
must be documented and must not be silently reclassified.

Reuse the billedStudyType pattern already used by CARE.

The resolver must distinguish:

DEDICATED DORSAL
DORSAL SCREENING
DORSAL + WHOLE-SPINE SCREENING
WHOLE-SPINE SCREENING-ONLY
DORSOLUMBAR dedicated studies

Do NOT treat a dedicated Dorsal study as "Dorsal Screening."

Do NOT treat a future dedicated Dorso-Lumbar study as merely:
Dorsal Screening + LS Screening.

That is a separate study composition and will receive its own dedicated
Clinical Sub-Master specification.
Existing known screening mappings from the shared Spine V3 architecture should
be reused rather than duplicated.

Roles initialized from billed study/protocol must remain manually overridable
when the performed examination differs from the booking label.

IMPLEMENTATION (billing resolver mapping, mirror lumbar pattern):
- Dictionary entries (code/name → role set):
  MRI020 / "MRI DL SPINE" or "MRI DORSAL SPINE" → dorsal: primary-dedicated.
  MRI021 / MRISCREENINGDORSAL / "MRI DORSAL SPINE SCREENING" → dorsal: primary-screening.
  MRI062 / "MRI WHOLE SPINE SCREENING" → cervical+dorsal+ls: primary-screening.
  MRICEWSS / "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING" → cervical:
  primary-dedicated; dorsal+ls: accompanying-screening.
  MRI038 / "MRI LS SPINE WITH SCREENING WHOLE SPINE" → ls: primary-dedicated;
  cervical+dorsal: accompanying-screening.
- performed defaults from role (role !== 'absent'); roles defaulted from the resolver/protocol
  and ALWAYS manually overridable in the canvas header.

============================================================
29. NORMAL SCREENING RECONCILIATION
============================================================

Reuse the regional normal screening presets:

Normal Cervical Spine Screening
Normal Dorsal Spine Screening
Normal LS Spine Screening

For dedicated Dorsal reporting, only Cervical and LS screening presets are
relevant as accompanying screening regions.

Each region has independent conflict namespaces:

screen-cervical-*
screen-dorsal-*
screen-ls-*

An abnormal Cervical screening observation must not delete LS screening
observations or dedicated dorsal observations.

============================================================
30. FINDINGS COMPOSITION
============================================================

Generate Findings from the structured observation ledger.

Recommended dedicated dorsal order:

ALIGNMENT
VERTEBRAL BODIES / MARROW
INTERVERTEBRAL DISCS
LEVEL-BY-LEVEL FINDINGS
CENTRAL CANAL
SPINAL CORD
NEURAL FORAMINA
POSTERIOR ELEMENTS / LIGAMENTS
EPIDURAL / INTRADURAL FINDINGS
THORACOLUMBAR JUNCTION / CONUS
PARAVERTEBRAL SOFT TISSUES
SCREENING FINDINGS

Only sections relevant to the case need to be emitted.

Avoid repetitive prose.

Example:
do not state severe T8-T9 canal stenosis three times under Disc, Canal and Cord
when one coherent level sentence plus a cord sentence is sufficient.

Manual radiologist text remains protected according to existing CARE provenance
rules.

============================================================
31. IMPRESSION PRIORITY
============================================================

Impression ordering should prioritize clinically important findings.

Suggested CATEGORY ordering logic, not automatic diagnosis:

1. cord/conus compression with significant signal abnormality
2. severe canal compromise
3. acute trauma with canal/neural compromise
4. epidural/intradural/intramedullary lesion
5. infection with epidural/paravertebral extension
6. tumor/pathological fracture/epidural extension
7. major OLF/OPLL-related compression
8. significant focal disc disease
9. significant deformity
10. other degenerative findings
11. significant screening findings

Implement priority in reusable library/config rather than scattered component
conditionals.

Radiologist may manually reorder Impression.

Manual reordering freezes automatic ordering unless explicitly refreshed.

IMPLEMENTATION: the priority rank table lives in lib (e.g. impressionPriority.ts),
not JSX; a manual reorder/edit freezes auto-ordering for that report until explicitly
refreshed by the radiologist.

============================================================
32. FINDINGS → IMPRESSION
============================================================

Reuse CARE's existing impression ledger/refresh architecture.

When linked Findings change:

- mark Impression stale where appropriate
- show "Impression needs refresh"
- allow radiologist-controlled refresh
- never silently overwrite manually edited Impression text

Support:

Generate Impression
Refresh from Findings
manual editing
manual ordering

============================================================
33. CONTRADICTION VALIDATION
============================================================

Warn for clinically meaningful contradictions including:

- normal cord + cord signal abnormality
- normal canal + severe canal stenosis
- normal vertebral bodies + acute fracture
- no focal marrow lesion + focal marrow-replacing lesion
- no disc abnormality + significant disc extrusion
- normal epidural space + epidural mass/collection
- no cord compression + severe cord compression
- normal conus + abnormal conus
- normal screening region + significant abnormality in same screening region
- enhancement wording without contrast
- detailed axial-dependent finding when axial imaging unavailable
- conus statement when conus not adequately covered

Warnings should be actionable but should not unnecessarily block report
finalization.

Never silently rewrite radiologist-entered observations to resolve a conflict.

============================================================
34. CRITICAL-RESULT WORKFLOW
============================================================

Reuse CARE's existing critical-result workflow.

Potential candidates for radiologist-confirmed critical handling include:

- severe acute cord compression
- acute cord/conus injury
- epidural hematoma with significant neural compression
- epidural abscess with significant cord compression
- unstable-appearing major trauma pattern requiring urgent clinical attention
- rapidly significant epidural tumor compression
- other radiologist-selected critical finding

Do NOT determine criticality from one AP measurement alone.

Critical workflow must remain:

DETECT / SUGGEST
→ RADIOLOGIST CONFIRMS
→ COMMUNICATION WORKFLOW

Never automatically write:
"Clinician informed"
or equivalent.

============================================================
35. SOURCE-LIBRARY PRESETS / MACROS
============================================================

Implement useful presets based on the supplied Dorsal/Dorsolumbar library,
using CARE's reversible macro infrastructure.

At minimum consider:

1. Normal Dorsal Spine
2. Multilevel Thoracic Degeneration
3. Focal Thoracic Disc Protrusion
4. Calcified Thoracic Disc Herniation + Cord Compression
5. Cord Compression + Signal Abnormality
6. OLF with Canal Stenosis
7. OPLL with Cord Compression
8. Acute Compression Fracture
9. Thoracolumbar Burst Fracture
10. Infective Spondylodiscitis
11. Spondylodiscitis + Paravertebral/Epidural Collection
12. Multifocal Marrow Lesions
13. Pathological Compression Fracture + Epidural Extension
14. Intradural Extramedullary Mass
15. Intramedullary Mass
16. dAVF Suspicion Pattern
17. Epidural Lipomatosis
18. Kyphotic/Gibbus Deformity

The supplied library's example macros should be used as source material.

Preset application MUST use:

useWorkspace.getState().applyMacroBundle
and/or
applyPathologyOverlay

according to existing CARE architecture.

Every preset must be reversible.

Undo must restore prior structured observations and must not destroy unrelated
manual observations.

============================================================
36. DIAGNOSTIC SAFETY / RADIOLOGIST CONTROL
============================================================

The structured system may suggest but must not silently finalize:

- tuberculous etiology
- metastatic disease
- spinal dAVF
- DISH
- OPLL
- OLF
- myelomalacia
- pathological fracture etiology
- specific intradural/intramedullary tumor diagnosis
- mechanical instability

Separate:

OBSERVATION
from
INTERPRETATION
from
DIAGNOSIS.

Example:

Observation:
serpiginous dorsal perimedullary flow voids + long-segment cord signal change

Suggestion:
consider dAVF pattern

Final Impression:
only after radiologist acceptance.

============================================================
37. AI COMPATIBILITY
============================================================

Do not rebuild AI in this task.

Preserve AI Draft / Selected Images workflow.

Structured observations should allow future AI to PROPOSE:

- thoracic disc abnormality
- vertebral fracture
- marrow lesion
- canal narrowing
- cord compression
- cord signal abnormality
- OLF/OPLL pattern
- paravertebral collection
- epidural lesion
- intradural/intramedullary lesion
- deformity
- gross screening abnormality

Workflow remains:

AI PROPOSES
→ RADIOLOGIST ACCEPTS / EDITS / REJECTS
→ OBSERVATION LEDGER
→ FINDINGS
→ IMPRESSION

AI must never silently finalize the report.

============================================================
38. UI / UX
============================================================

The Dorsal canvas must feel smaller than the pathology library behind it.

Routine workflow:

ROUTINE / DEGENERATIVE
→ alignment
→ vertebral bodies/marrow
→ discs
→ level-by-level
→ canal
→ cord
→ optional screening
→ Findings
→ Impression

Cord-compression workflow:

CANAL / CORD
→ level
→ cause
→ AP measurement if measured
→ CSF morphology
→ cord flattening/compression
→ cord signal
→ Impression

Trauma workflow:

TRAUMA
→ level
→ fracture morphology
→ height loss
→ posterior wall/retropulsion
→ PLC observations
→ canal
→ cord/conus
→ soft tissues
→ Impression

Infection workflow:

INFECTION
→ levels
→ vertebrae/endplates
→ disc
→ epidural component
→ paravertebral component
→ canal/cord
→ contrast findings
→ Impression

Rare modules remain collapsed until selected.

Screening remains collapsed unless the billed/performed protocol includes it or
the radiologist opens it.

============================================================
39. TESTS — CORE
============================================================

Test:

- normal dorsal baseline
- normal → abnormal reconciliation
- multiple sub-masters simultaneously
- palette switching preserves observations
- DorsalLevelResolver level consistency
- T1-T2 through T11-T12
- optional T12-L1 based on coverage
- no conus statement when conus not covered

============================================================
40. TESTS — DISC / CANAL / CORD
============================================================

Test:

- focal protrusion
- extrusion
- migration
- calcified/low-signal disc observation
- canal narrowing
- AP measurement provenance
- CSF-space morphology
- cord contact
- cord flattening
- cord compression
- cord signal abnormality
- normal cord reconciliation
- measurement/severity mismatch warning

============================================================
41. TESTS — THORACIC-SPECIFIC PATHOLOGY
============================================================

Test:

- OLF
- OPLL
- DISH pattern
- costovertebral abnormality
- posterior-element lesion
- epidural lipomatosis
- kyphosis
- scoliosis
- gibbus deformity
- thoracolumbar junction involvement

Ensure no cervical uncovertebral terminology appears.

Ensure lumbar traversing-root/lateral-recess logic is not incorrectly emitted.

============================================================
42. TESTS — TRAUMA / INFECTION / TUMOR
============================================================

Test:

TRAUMA:
- compression fracture
- burst fracture
- retropulsion
- PLC observation
- epidural hematoma
- cord/conus injury

INFECTION:
- spondylodiscitis
- endplate destruction
- epidural collection
- paravertebral collection
- contrast gating
- no automatic TB diagnosis

TUMOR:
- focal marrow lesion
- multifocal lesions
- pathological fracture
- epidural extension
- cord compression
- no automatic metastatic diagnosis

============================================================
43. TESTS — INTRADURAL / VASCULAR
============================================================

Test:

- intradural extramedullary lesion
- intramedullary lesion
- cord expansion
- associated edema
- enhancement gating
- perimedullary flow-void observation
- dAVF suggestion
- no automatic dAVF diagnosis

============================================================
44. TESTS — SCREENING
============================================================

For dedicated Dorsal:

- dorsal = primary-dedicated
- cervical accompanying screening
- LS accompanying screening
- cervical only
- LS only
- both → Whole Spine Screening grouping
- no duplicate Dorsal Screening module
- limitation statement exactly once
- normal cervical screening reconciliation
- normal LS screening reconciliation
- screening conflicts do not alter dedicated dorsal observations
- significant screening findings may be promoted to Impression only when
  selected/accepted
- absent screening region emits nothing

============================================================
45. TESTS — WORKFLOW / PROVENANCE / BINDING
============================================================

Test:

- preset apply
- preset undo
- manual-text protection
- structured provenance
- Findings change → Impression stale
- Impression refresh
- manual Impression protection
- contradiction warnings
- sequence gating
- critical workflow without false communication documentation
- AI proposal does not silently finalize

BINDING TESTS:
- DorsalLevelResolver remaps keys and UI/table/findings/screening refs all agree.
- Sequence gating incl. screening flags and preset downgrade notice.
- Root/descriptive text conflictGroup coexistence (e.g., cord compression + cord signal
  abnormality both survive; undo restores).
- Screening performed=false → zero screening prose while performed=true+normal → normal
  prose once; limitation statement exactly once with both regions performed.

Run relevant unit/integration tests.

Run typecheck.

Run build if practical.

Document any pre-existing unrelated failures separately.

============================================================
46. IMPLEMENTATION CONSTRAINTS
============================================================

DO NOT:

- create a second generic reporting system
- create independent local React observation state
- create duplicate measurement state
- duplicate the screening engine
- create a fourth Whole Spine Screening schema
- treat dedicated Dorsal as Dorsal Screening
- treat Dorso-Lumbar as Dorsal Screening + LS Screening
- import cervical uncovertebral anatomy
- import lumbar traversing-root/lateral-recess logic indiscriminately
- silently overwrite manual Findings/Impression
- invent enhancement without contrast
- invent diffusion findings without DWI
- emit conus findings when conus is not covered
- automatically diagnose TB, metastasis, dAVF, OLF, OPLL, DISH or a specific
  tumor from one observation
- automatically document clinician communication
- modify PACS/DICOM routing
- modify unrelated billing/accounting logic
- perform destructive database migrations
- modify production data
- merge the PR

Prefer backward-compatible frontend/state/library changes.

Any schema/API/database change requires explicit justification in the completion
report.

============================================================
47. SPEC COMPLIANCE REVIEW BEFORE PR
============================================================

Before opening the PR, re-read THIS ENTIRE SPECIFICATION.

Create a compliance matrix for EVERY numbered section.

Each section must be marked:

IMPLEMENTED

or

ALREADY EXISTED — REUSED

or

PARTIALLY IMPLEMENTED

or

NOT IMPLEMENTED

For PARTIALLY IMPLEMENTED / NOT IMPLEMENTED:

- explain exactly what remains
- explain why
- identify whether it is blocking or suitable for a later phase

Do NOT claim the task is complete merely because tests pass.

============================================================
48. COMPLETION REPORT
============================================================

Provide:

1. branch name
2. final commit SHA
3. PR URL
4. files changed
5. architecture reused
6. shared components introduced/extended
7. DorsalLevelResolver implementation
8. clinical sub-masters implemented
9. level-by-level implementation
10. canal/AP measurement implementation
11. cord observation implementation
12. OLF/OPLL/DISH implementation
13. trauma implementation
14. infection implementation
15. tumor/marrow implementation
16. intradural/intramedullary implementation
17. vascular/dAVF-pattern implementation
18. thoracolumbar/conus implementation
19. lesion/collection reuse
20. sequence/protocol gating
21. screening integration
22. billed-study resolver behavior
23. Findings composition
24. Impression refresh/prioritization
25. validators added
26. critical workflow integration
27. presets/macros added
28. AI compatibility
29. tests added/updated
30. typecheck result
31. build result
32. screenshots of important UI states if practical
33. spec compliance matrix
34. known limitations
35. recommended next phase, including dedicated Dorso-Lumbar V3 integration

CREATE THE PR.

DO NOT MERGE.