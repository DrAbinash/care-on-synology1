TASK: CARE ERP — MRI DORSO-LUMBAR SPINE CLINICAL SUB-MASTER REPORTING V3
DEDICATED THORACIC + THORACOLUMBAR JUNCTION + LUMBAR COMPOSITION
WITH SHARED SPINE SCREENING

Repository: DrAbinash/care-on-synology1

BINDING CLINICAL SOURCE:
docs/clinical-libraries/mri-dorsolumbar-clinical-content-library.md

RELATED EXISTING SPECS/LIBRARIES TO AUDIT AND REUSE, NOT CONCATENATE:
docs/tasks/mri-dorsal-submaster-v3.md
docs/clinical-libraries/mri-dorsal-clinical-content-library.md
docs/tasks/mri-lumbar-submaster-v3.md
docs/clinical-libraries/mri-lumbar-clinical-content-library.md

============================================================
0. CORE DECISION
============================================================

A DEDICATED MRI DORSO-LUMBAR STUDY IS ITS OWN STUDY COMPOSITION.

It MUST NOT be implemented as:
Dorsal Screening + LS Screening

and MUST NOT be implemented by simply concatenating:
a complete dedicated Dorsal report + a complete dedicated Lumbar report.

The model is:

ACTUAL ACQUIRED COVERAGE
→ THORACIC OBSERVATIONS
→ THORACOLUMBAR-JUNCTION BRIDGE
→ LUMBAR OBSERVATIONS
→ CORD → CONUS → CAUDA TRANSITION
→ ONE OBSERVATION LEDGER
→ ONE FINDINGS COMPOSER
→ ONE IMPRESSION
→ ONE VALIDATION / CRITICAL WORKFLOW

The thoracolumbar junction is first-class rather than duplicated by the dorsal
and lumbar halves.

============================================================
1. AUDIT FIRST
============================================================

Before coding inspect latest main completely enough to identify:

- existing MRI Dorsal V3 implementation/status
- existing MRI Lumbar V3 implementation/status
- MriDorsalCanvas / MriLumbarCanvas or current equivalents
- DorsalLevelResolver / LumbarNumberingResolver or equivalents
- level-state builders including buildDorsalLevelApplyBundle and
  buildLumbarLevelApplyBundle
- useWorkspace observation ledger
- applyMacroBundle / applyPathologyOverlay
- conflictGroup behavior / undo
- canalApProvenance / setCanalApProvenance
- reportFieldMerge / manual provenance protection
- Findings → Impression refresh/staleness
- sequence/protocol model
- lesion/measurement infrastructure
- screening schemas / SpineScreeningPanel
- billedStudyType/catalog resolver
- actual catalog entries containing DL / DORSO LUMBAR / DORSOLUMBAR
- existing tests

Audit the ACTUAL billed protocol before mapping MRI020 or any "MRI DL SPINE"
label. Do not assume DL means Dorsal. Determine whether CARE uses it for
Dorsal, Dorso-Lumbar, or another local convention.

Provide a concise architecture audit and implementation plan BEFORE coding.

Then:
NEW BRANCH → IMPLEMENT → TEST → SPEC REVIEW → PR

DO NOT MERGE.

============================================================
2. HARD ARCHITECTURAL BINDINGS
============================================================

Reuse CARE's existing:
- reporting canvas architecture
- observation ledger
- Zustand/useWorkspace
- reportFieldMerge/provenance
- reversible macro/pathology overlay infrastructure
- Findings composer
- Impression refresh/staleness
- contradiction validator
- critical-result workflow
- AI Draft / Selected Images workflow
- shared lesion/measurement components
- shared spine-screening infrastructure

NO parallel local React state for:
- observations
- level resolution
- measurements
- screening
- numbering
- Findings/Impression truth

Preset/chip application MUST flow through existing workspace macro/overlay APIs.

Region-specific level entries must use the existing Dorsal and Lumbar level
bundle builders or a thin shared dispatcher around them. Do not create a third
incompatible level-entry model.

AP canal inputs MUST use the existing canal AP provenance mechanism.

============================================================
3. ONE OBSERVATION MODEL, MULTIPLE PALETTES
============================================================

Clinical palettes:

1. ROUTINE / NORMAL
2. DEGENERATIVE / DISC
3. CANAL STENOSIS / NEURAL COMPRESSION
4. THORACOLUMBAR JUNCTION / CONUS
5. OPLL / OLF / DISH
6. TRAUMA
7. INFECTION / SPONDYLODISCITIS
8. TUMOR / MARROW / METASTASIS
9. INTRADURAL / INTRAMEDULLARY
10. VASCULAR / dAVF PATTERN
11. POST-OPERATIVE
12. DEFORMITY / KYPHOSIS / SCOLIOSIS
13. CONGENITAL / DEVELOPMENTAL / LSTV
14. MORE / ADVANCED

These are palettes over ONE report state, not separate editors.

Switching palettes must not delete unrelated observations.

============================================================
4. COVERAGE IS AUTHORITATIVE
============================================================

A study named "Dorso-Lumbar" may not contain the entire T1-S1 spine.

Represent actual superior and inferior acquired coverage.

The resolver must generate active vertebral/disc level keys only for adequately
covered anatomy.

Possible coverage may include a lower-thoracic-to-lumbar examination such as
T8/T9 through sacrum, but DO NOT hard-code this as universal.

Never emit:
- upper thoracic normality outside coverage
- T12-L1 findings when outside coverage
- conus assessment when outside coverage
- L5-S1 assessment when outside coverage

Coverage state must be shared by:
UI
ledger
measurements
Findings
Impression
validation
presets
AI context.

============================================================
5. DORSOLUMBAR LEVEL / NUMBERING RESOLVER
============================================================

Create/reuse a DorsoLumbarCoverageResolver that COMPOSES existing numbering
logic rather than replacing it.

It must bridge:
thoracic numbering
→ thoracolumbar junction
→ lumbar numbering / LSTV logic.

Support numbering confidence:
- whole-spine/localizer-confirmed
- cervicothoracic landmark-supported
- thoracolumbar landmark-supported
- standard morphology with no transitional concern
- manual radiologist designation
- uncertain

If LSTV or uncertain numbering exists, all downstream lumbar level keys and
junction labels must remap consistently.

Never silently renumber existing observations.

When numbering changes:
- preview/remap safely
- preserve provenance
- require visible radiologist review for affected level-specific observations.

============================================================
6. NO DUPLICATE T12-L1 / JUNCTION STATE
============================================================

The bridge is a major requirement.

T10-T11 / T11-T12 / T12-L1 / L1-L2 where covered must have ONE canonical level
identity each.

T12-L1 must NOT exist once as a Dorsal level and again as a Lumbar level with
independent findings.

Define canonical junction keys and adapters so both region-specific UI helpers
write to the same observation slot.

Conflict groups must remain deterministic.

============================================================
7. REGION ROLES
============================================================

Extend/reuse the shared role concept:

RegionRole:
- primary-dedicated
- primary-screening
- accompanying-screening
- absent

For a dedicated Dorso-Lumbar examination, do NOT mark dorsal and LS as two
independent primary-screening regions.

Use a dedicated composition identity, e.g.:
studyComposition = 'dorsolumbar-dedicated'

Within that composition, thoracic/junction/lumbar domains are dedicated
components of one examination.

Additional cervical screening, if actually performed, remains an accompanying
screening region.

============================================================
8. ROUTINE / NORMAL
============================================================

One-click NORMAL DORSO-LUMBAR baseline must be COVERAGE AWARE.

Normal observations can include only adequately assessed anatomy.

Normal-to-abnormal reconciliation must remove conflicting normal slots without
deleting unrelated region findings.

Do not produce one giant normal paragraph copied from Dorsal plus another copied
from Lumbar.

============================================================
9. ALIGNMENT / DEFORMITY
============================================================

Support:
- thoracic kyphosis
- lumbar lordosis
- junctional kyphosis/gibbus
- scoliosis
- vertebral rotation where appropriate
- anterolisthesis/retrolisthesis
- deformity spanning the junction

Do not auto-assign etiology from curvature alone.

============================================================
10. VERTEBRAL BODY / MARROW / ENDPLATE MODEL
============================================================

Shared vertebral object with region-aware behavior:
- height
- fracture/collapse
- marrow signal
- focal lesion
- Modic/endplate change
- Schmorl node
- destructive change
- posterior-wall involvement
- retropulsion

Support pathology crossing T12/L1 without duplicate lesion objects.

============================================================
11. DISC / LEVEL MODEL
============================================================

At thoracic levels retain:
- thoracic disc morphology
- canal/cord effect
- thoracic foramina
- no lumbar root inference

At lumbar levels retain:
- disc morphology
- central canal
- lateral recess
- foramina
- traversing/exiting-root relationships
- facets
- ligamentum flavum

At junction levels choose behavior according to anatomy and neural structure
actually present, not merely which UI panel created the observation.

============================================================
12. CORD → CONUS → CAUDA TRANSITION
============================================================

This is a defining feature of the Dorso-Lumbar module.

Represent separately:
- thoracic cord
- conus medullaris
- cauda equina

Support:
- level of conus termination
- caliber
- compression
- intrinsic T2/STIR signal
- edema/contusion pattern
- crowding/compression of cauda
- intradural lesion

Do not call conus findings "thoracic cord" merely because they are at T12.
Do not call cord findings "cauda equina."

Conus statements require actual coverage.

============================================================
13. CANAL / AP MEASUREMENTS
============================================================

Use one AP measurement/provenance system.

Allow measured AP canal diameter at covered levels.

Do not duplicate T12-L1 measurements.

Do not use questionable universal hard-coded stenosis thresholds to automatically
assign severity.

Radiologist interpretation remains authoritative.

============================================================
14. NEURAL FORAMINA / ROOT LOGIC
============================================================

Thoracic:
- side/level foraminal narrowing
- lesion/extension
- descriptive suspected intercostal nerve involvement only if selected
- NO automatic thoracic root-number inference engine

Lumbar:
reuse established LSTV-aware exiting/traversing root helper.

Any root suggestion remains overridable and numbering-aware.

============================================================
15. POSTERIOR ELEMENTS / FACETS / LIGAMENTS
============================================================

Support:
- pedicles
- laminae
- spinous processes
- thoracic facets where relevant
- lumbar facets
- ligamentum flavum
- interspinous ligament
- posterior ligamentous complex
- pars only in appropriate lumbar anatomy
- posterior-element fracture/marrow lesion

Do not expose lumbar pars workflow at thoracic levels.

============================================================
16. OLF / OPLL / DISH
============================================================

Reuse Dorsal V3 safety:
MRI may suggest ossification; CT may characterize it better.
Do not auto-label low-signal thickening as OLF/OPLL.
Do not diagnose DISH from one bridge.

Allow pathology to extend across the thoracolumbar junction.

============================================================
17. TRAUMA
============================================================

Support:
- compression/wedge/burst fracture
- height loss %
- posterior-wall involvement
- retropulsion
- marrow edema
- posterior-element injury
- PLC observations
- epidural hematoma
- canal compromise
- cord/conus/cauda effect
- paravertebral soft-tissue injury

Provide a junctional burst-fracture preset derived from the canonical library.

Do not auto-declare mechanical instability from supine MRI.
Do not convert nonspecific STIR hyperintensity into complete ligament rupture.

============================================================
18. INFECTION / SPONDYLODISCITIS
============================================================

Model cross-junction infection as ONE pathology object.

Support:
- vertebrae
- disc
- endplate destruction
- marrow edema
- collapse
- kyphosis/gibbus
- epidural extension
- paravertebral extension
- psoas extension when covered
- dimensions/extent
- canal compromise
- cord/conus/cauda effect
- enhancement only if contrast performed

Infective spondylodiscitis and TB/Pott diagnosis remain radiologist-selected.
Do not auto-generate "cold abscess" or TB from collection alone.

============================================================
19. TUMOR / MARROW / EPIDURAL
============================================================

Support lesions spanning regions without duplication:
- focal/multifocal marrow lesion
- pathologic fracture
- posterior-element involvement
- epidural extension
- paravertebral extension
- intradural/intramedullary component
- cord/conus/cauda effect
- contrast-dependent enhancement

Do not auto-diagnose metastasis from an indeterminate marrow lesion.

============================================================
20. INTRADURAL / INTRAMEDULLARY / VASCULAR
============================================================

Support:
- intramedullary lesion
- intradural extramedullary lesion
- cord/conus expansion
- intrinsic signal
- perimedullary serpiginous flow voids
- associated edema
- extent across junction

Specific tumor or dAVF diagnosis is radiologist-selected.

============================================================
21. POST-OPERATIVE
============================================================

Support decompression/fusion/fixation across thoracic, junctional and lumbar
levels, hardware, artifact, postoperative collection, residual/recurrent
compression and adjacent-level disease.

Do not overstate loosening from nonspecific MRI signal.

============================================================
22. SEQUENCE / PROTOCOL AWARENESS
============================================================

Track actual:
- T1
- T2
- STIR/fat-suppressed
- axial coverage
- DWI/ADC if performed
- GRE/SWI if performed
- contrast/postcontrast
- whole-spine/localizer
- dynamic imaging if any
- accompanying screening

Gate:
enhancement
diffusion
hemorrhage/blooming
marrow edema characterization
specific sequence-dependent prose.

============================================================
23. SHARED SPINE SCREENING
============================================================

Reuse the existing three-region screening infrastructure.

Dedicated Dorso-Lumbar is NOT a screening composition.

If cervical screening accompanies the study, use the cervical screening schema.

If another explicitly limited regional screening exists, use the appropriate
shared screening schema without duplicating the dedicated Dorso-Lumbar content.

When any screening contributes, emit exactly once:
"SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE."

============================================================
24. BILLED-STUDY / PROTOCOL RESOLVER
============================================================

Audit live catalog first.

Search all codes/names containing:
DL
DORSAL
DORSO
DORSOLUMBAR
DORSO-LUMBAR
THORACOLUMBAR
THORACO-LUMBAR
WHOLE SPINE

Do not blindly reuse the Dorsal spec's provisional MRI020 mapping.

Document what MRI020 / "MRI DL SPINE" actually means in CARE data.

Create a deterministic mapping only after evidence.

Roles/composition initialized from billing/protocol must remain manually
overridable when the performed examination differs from booking.

============================================================
25. FINDINGS COMPOSER
============================================================

One coherent report.

Recommended order:

TECHNIQUE / COVERAGE
NUMBERING
ALIGNMENT
VERTEBRAL BODIES / MARROW
INTERVERTEBRAL DISCS
LEVEL-BY-LEVEL FINDINGS
THORACIC CENTRAL CANAL / CORD
THORACOLUMBAR JUNCTION / CONUS
LUMBAR CANAL / LATERAL RECESSES / CAUDA
NEURAL FORAMINA
POSTERIOR ELEMENTS / LIGAMENTS
EPIDURAL / INTRADURAL FINDINGS
PARAVERTEBRAL / PSOAS SOFT TISSUES
ACCOMPANYING SCREENING FINDINGS

Avoid repeating the same junctional pathology under multiple sections.

Manual text remains protected by existing provenance rules.

============================================================
26. IMPRESSION
============================================================

Generate from accepted observations.

Priority:
1. acute fracture / infection / destructive lesion
2. cord/conus/cauda compression or intrinsic signal
3. significant thoracolumbar junction pathology
4. major thoracic canal/disc disease
5. major lumbar canal/recess/foraminal disease
6. tumor/intradural disease
7. deformity/postoperative issue
8. important screening finding
9. radiologist-selected recommendation

Use stale-impression detection when linked findings change.

============================================================
27. VALIDATION / CONTRADICTIONS
============================================================

At minimum detect:
- normal + abnormal same level/slot
- duplicate T12-L1 state
- same junction level labeled differently by dorsal/lumbar halves
- conus statement outside coverage
- cauda statement outside lumbar coverage
- thoracic root inference using lumbar logic
- LSTV numbering inconsistency
- observation left on old level after renumbering
- no contrast + enhancement
- no STIR/fat-suppression + unsupported edema-specific preset wording where relevant
- no DWI + diffusion
- no GRE/SWI + blooming
- normal cord/conus + compression/signal abnormality
- no fracture + fracture
- no epidural lesion + epidural collection/mass
- screening limitation duplicated
- dedicated Dorso-Lumbar incorrectly represented as two screening regions

Warnings must not destroy radiologist-controlled manual prose.

============================================================
28. CRITICAL RESULTS
============================================================

Reuse existing CARE critical workflow for radiologist-designated:
- severe cord/conus/cauda compression
- acute fracture with major neural compromise
- epidural hematoma/abscess with compression
- destructive lesion with major compromise
- other selected urgent finding

Never auto-document communication recipient/time.

============================================================
29. AI
============================================================

AI is proposal-only.

Provide AI with:
- actual coverage
- numbering confidence
- active canonical levels
- sequence state
- accepted observations

AI must not:
- silently renumber
- invent levels outside coverage
- convert Dorsal+Lumbar screening into dedicated DL
- auto-diagnose TB/metastasis/dAVF/instability
- overwrite manual radiologist text
- finalize without radiologist acceptance

============================================================
30. TESTS
============================================================

Add/extend tests for:
- routine normal lower-thoracic + lumbar coverage
- partial coverage
- no upper-thoracic normal prose outside coverage
- one canonical T12-L1 state
- junction level edited from either region UI remains one observation
- conus covered vs not covered
- cord→conus→cauda composition
- lumbar root helper only at lumbar levels
- LSTV renumber/remap
- numbering uncertainty
- AP measurement provenance
- thoracolumbar burst fracture
- cross-junction infection
- epidural extension
- tumor crossing junction
- OLF/OPLL safety
- contrast gating
- cervical accompanying screening
- screening limitation exactly once
- dedicated Dorso-Lumbar not represented as Dorsal+LS screening
- billed-study resolver including ambiguous DL label
- normal-to-abnormal reconciliation
- Findings/Impression stale refresh
- manual text protection
- contradictions
- critical workflow
- AI proposal-only behavior

Run relevant tests, typecheck and production build.

============================================================
31. IMPLEMENTATION CONSTRAINTS
============================================================

DO NOT:
- concatenate two full reports
- create two independent ledgers
- duplicate T12-L1
- create parallel local state
- duplicate Findings/Impression truth
- replace stable Dorsal/Lumbar components merely for elegance
- silently change existing Dorsal/Lumbar behavior
- assume DL billing semantics
- run destructive migration
- deploy production
- merge PR

Prefer thin composition/adapters over duplication.

============================================================
32. SPEC COMPLIANCE REVIEW
============================================================

Before PR, review EVERY numbered section.

Report:
IMPLEMENTED
PARTIAL + reason
NOT APPLICABLE + reason

Resolve accidental omissions before opening PR.

============================================================
33. COMPLETION REPORT
============================================================

Report:
1. audit findings
2. actual billed-study mapping found
3. architecture reused
4. files changed
5. DorsoLumbarCoverageResolver / numbering design
6. junction-key deduplication
7. thoracic model integration
8. TL-junction/conus model
9. lumbar model integration
10. cord→conus→cauda behavior
11. measurements/provenance
12. screening composition
13. Findings/Impression
14. validation
15. critical workflow
16. AI behavior
17. tests/typecheck/build
18. backward-compatibility assessment for Dorsal/Lumbar
19. known limitations
20. compliance matrix
21. screenshots if practical
22. recommended next phase

Create PR.

DO NOT MERGE.
DO NOT DEPLOY TO PRODUCTION.
