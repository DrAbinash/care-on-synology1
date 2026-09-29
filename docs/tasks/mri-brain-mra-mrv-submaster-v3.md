TASK: CARE ERP — MRI BRAIN MRA / MRV CLINICAL SUB-MASTER REPORTING V3
WITH LIGHTWEIGHT BASIC INTRACRANIAL MRA SCREENING IN MRI BRAIN

Repository: DrAbinash/care-on-synology1

============================================================
0. PURPOSE / BINDING ARCHITECTURE
============================================================

Implement vascular neuro structured reporting by extending the EXISTING CARE
MRI Brain reporting architecture.

This task contains four related capabilities:

1. Dedicated intracranial MRA / Circle of Willis
2. Dedicated extracranial MRA neck (carotid + vertebral)
3. Dedicated MRV brain
4. Lightweight BASIC INTRACRANIAL MRA SCREENING integrated into MRI Brain

Do NOT create a second reporting system, second observation ledger, parallel
Findings/Impression engine, or independent AI workflow.

Reuse existing MRI Brain:
- report canvas and report model
- observation ledger / provenance model
- Zustand/useWorkspace state
- Findings and Impression composition
- manual-text protection
- reversible macro/preset infrastructure
- lesion/measurement infrastructure where applicable
- sequence/protocol awareness
- contradiction validation
- critical-result workflow
- AI proposal/accept/edit/reject workflow

Audit the repository first and bind to the actual current APIs/components rather
than inventing duplicate infrastructure.

============================================================
1. CANONICAL CLINICAL SOURCE
============================================================

Canonical clinical content library:

docs/clinical-libraries/mri-brain-mra-mrv-clinical-content-library.md

That file is authoritative for supplied clinical terminology and starting
clinical prose.

This V3 specification is authoritative for:
- architecture
- workflow
- structured fields
- safety
- sequence/technique gating
- validation
- diagnostic escalation
- dedicated-vs-screening behavior

Where canonical prose states a diagnosis more strongly than the available
technique alone supports, preserve the source content but DO NOT automatically
emit that stronger conclusion. Store the descriptive observation and require
radiologist selection/approval for the stronger interpretation.

Existing production prose is not silently canonical. If it conflicts with this
library, preserve safe production behavior and document the discrepancy.

============================================================
2. STUDY COMPOSITION / REGION ROLES
============================================================

Support composition rather than duplicated canvases.

VascularModuleRole:
- dedicated
- basic-screening
- accompanying
- absent

At minimum support:
- MRI Brain alone
- MRI Brain + Basic MRA Screening
- MRI Brain + dedicated intracranial MRA
- MRI Brain + dedicated MRV
- MRI Brain + dedicated MRA + MRV
- dedicated MRA brain
- dedicated MRA neck
- combinations actually present in the CARE billed-study catalog

Audit billed study codes/names before hard-coding mappings.

Performed protocol/sequence availability is authoritative and manually
overridable by the radiologist. Billing label alone must not fabricate a
performed vascular sequence.

Routine MRI Brain already covers CP angles as part of brain anatomy. Do NOT
create a separate CPA/IAC sub-master in this task.

============================================================
3. SHARED VASCULAR OBSERVATION MODEL
============================================================

One vascular observation model must feed:
- chips/presets
- structured panels
- Findings
- Impression
- validation
- critical workflow
- AI proposals

Use conflict groups/slots so mutually exclusive observations replace each other
safely and undo restores the prior state.

Do not maintain separate free-floating arterial/venous state that can contradict
the observation ledger.

Every measurement should support provenance:
- manual
- image-derived/manual-on-image if current architecture supports it
- AI-proposed but radiologist accepted
- imported/other only if already supported

============================================================
4. TECHNIQUE / SEQUENCE AWARENESS
============================================================

Track what was actually acquired.

MRA techniques:
- TOF MRA
- contrast-enhanced MRA
- vessel-wall / black-blood imaging if performed
- other/manual

MRV techniques:
- TOF MRV
- phase-contrast MRV
- contrast-enhanced MRV
- other/manual

Supporting MRI sequences:
- T1
- T2
- FLAIR
- DWI/ADC
- GRE/SWI
- post-contrast T1
- source images / MIP where applicable

Sequence-gate dependent prose.

Examples:
- do not mention enhancement if contrast was not performed
- do not mention restricted diffusion without DWI/ADC
- do not mention hemorrhagic blooming without GRE/SWI
- do not claim T1 intramural hematoma unless the relevant vessel-wall/source
  sequence exists
- do not infer temporal "early draining veins" from a non-time-resolved
  technique merely because an AVM is suspected

============================================================
5. DEDICATED INTRACRANIAL MRA
============================================================

Structured arterial tree:

Anterior circulation:
- right/left intracranial ICA
- ICA terminus
- ACA A1/A2 where assessable
- ACom region
- MCA M1/M2 and major branches where assessable

Posterior circulation:
- right/left vertebral arteries
- PICA origin/termination variant where assessable
- basilar artery
- PCA P1/P2 where assessable
- PCom/fetal PCA configuration where assessable

For each vessel/segment support:
- patent/normal
- caliber asymmetry
- focal narrowing
- multifocal narrowing
- flow-related signal loss
- nonvisualization
- suspected occlusion
- confirmed/selected occlusion
- ectasia
- aneurysmal outpouching
- variant
- other/manual

Do NOT equate TOF signal loss with stenosis or occlusion automatically.

Do NOT assign acuity from MRA nonvisualization alone.

============================================================
6. ANEURYSM STRUCTURED OBJECT
============================================================

Support one or multiple aneurysms.

Fields:
- parent vessel
- exact segment/junction
- side
- morphology: saccular/fusiform/other
- dome height
- maximum width
- neck width
- calculated dome-to-neck ratio
- orientation
- branch incorporation when assessable
- daughter sac/irregularity when selected
- thrombus when assessable
- adjacent mass effect
- associated hemorrhage only when supporting brain sequences exist
- additional aneurysm(s)

Calculated values must derive from entered measurements and remain editable only
through their source measurements.

Do not automatically label an aneurysm "ruptured" or "unruptured" from MRA
appearance alone. "Unruptured" may be radiologist-selected when supported by
the complete study/clinical context.

============================================================
7. STENOSIS / OCCLUSION
============================================================

Separate:
- visible luminal narrowing
- flow-related signal loss
- estimated stenosis
- measured stenosis
- nonvisualization
- suspected occlusion
- radiologist-confirmed/selected occlusion

Do not automatically generate numeric intracranial stenosis percentages from
visual TOF signal loss.

If a percentage is manually entered, preserve provenance.

Do not automatically call an occlusion acute. Acuity requires appropriate
clinical/imaging support and radiologist selection.

============================================================
8. MOYAMOYA-PATTERN OBSERVATIONS
============================================================

Support:
- terminal ICA narrowing/occlusion right/left
- proximal ACA/MCA involvement
- basal/lenticulostriate collateral network
- asymmetric/bilateral pattern
- associated ischemic/hemorrhagic findings from brain MRI

Keep:
"moyamoya-pattern vasculopathy / findings raising suspicion"

separate from:
"Moyamoya disease"

The disease diagnosis must be radiologist-selected and not automatically
generated from the angiographic pattern.

============================================================
9. AVM / VASCULAR MALFORMATION
============================================================

Support:
- location/lobe
- nidus present
- AP/transverse/CC dimensions
- dominant arterial feeder(s)
- venous drainage
- superficial/deep drainage where assessable
- associated aneurysm
- associated hemorrhage
- surrounding gliosis/edema
- mass effect
- other/manual

Do not claim temporal early venous drainage unless the technique supports it.

Do not attempt automatic formal AVM grading unless the required grading inputs
are explicitly captured and the radiologist activates that workflow.

============================================================
10. ANATOMIC VARIANTS
============================================================

First-class non-pathologic variant slots should include:
- fetal / partial fetal PCA
- hypoplastic/aplastic A1
- vertebral artery dominance
- hypoplastic vertebral artery
- vertebral artery terminating in PICA
- asymmetric PCom
- other/manual

Variant observations must not conflict with pathology merely because a vessel is
small/nonvisualized on one technique.

============================================================
11. DEDICATED MRA NECK
============================================================

Structured vessels:
- right/left CCA
- carotid bifurcation
- proximal/cervical ICA
- ECA where relevant
- right/left vertebral arteries
- vertebral origins where adequately covered

Support:
- plaque/luminal irregularity
- stenosis
- occlusion
- dissection pattern
- pseudoaneurysm
- vertebral dominance/hypoplasia
- tortuosity
- other/manual

NASCET SAFETY:
Do not generate a NASCET percentage merely from an appearance preset.

If NASCET stenosis is reported, support:
- minimum residual lumen measurement
- distal normal ICA reference measurement
- calculated percentage where appropriate
- measurement provenance
- manual radiologist override with provenance

Do not automatically call an intramural hematoma "acute" solely because it is
T1 hyperintense.

Technique-gate dissection wording and allow recommendation for CTA/other
correlation when selected by the radiologist.

============================================================
12. DEDICATED MRV BRAIN
============================================================

Structured venous anatomy:

Dural sinuses:
- superior sagittal sinus
- inferior sagittal sinus where assessable
- straight sinus
- torcular
- right/left transverse sinuses
- right/left sigmoid sinuses
- cavernous sinuses when relevant/adequately assessed

Deep venous system:
- internal cerebral veins
- vein of Galen
- basal veins where assessable

Other:
- cortical veins when assessable
- jugular bulbs/proximal IJV when included

For each relevant structure support:
- patent/preserved flow signal
- reduced flow signal
- flow gap/nonvisualization
- filling defect
- thrombus signal
- partial thrombosis
- occlusive thrombosis
- recanalization
- collateral veins
- developmental hypoplasia/aplasia
- other/manual

Do not automatically equate a transverse-sinus flow gap with thrombosis.

============================================================
13. CVST / DEEP VENOUS THROMBOSIS
============================================================

Support:
- sinus/vein involved
- side
- segment/extent
- occlusive/non-occlusive
- thrombus signal where source sequences support it
- filling defect where technique supports it
- extension
- recanalization
- collateralization

Associated brain findings:
- edema
- venous infarction
- hemorrhagic venous infarction
- petechial hemorrhage
- mass effect
- midline shift
- bilateral thalamic edema for deep venous involvement
- diffusion restriction when DWI/ADC exists

Do not assign acute/subacute/chronic stage solely from one signal characteristic.
Stage is a radiologist-selected interpretation supported by the available
sequences/context.

============================================================
14. LIGHTWEIGHT BASIC INTRACRANIAL MRA SCREENING
============================================================

This is intentionally NOT a second dedicated MRA editor.

It is a compact screening module available within MRI Brain when a limited/basic
intracranial angiographic acquisition was actually performed.

Display a compact arterial checklist for:
- intracranial ICA R/L
- ACA R/L
- MCA R/L
- PCA R/L
- vertebral arteries R/L
- basilar artery

Quick observations:
- major intracranial arteries grossly patent
- focal flow-related signal reduction/narrowing
- significant stenosis suspected
- vessel nonvisualization/occlusion suspected
- gross aneurysmal outpouching
- major anatomic variant
- other significant vascular abnormality

Normal screening seed:
"Major intracranial arteries demonstrate preserved flow-related signal without
gross focal stenosis, occlusion or aneurysmal dilatation."

The module must support a single limitation statement:
"SCREENING MR ANGIOGRAPHY IS A LIMITED VASCULAR ASSESSMENT AND DOES NOT REPLACE A DEDICATED MRA/CTA/DSA WHEN CLINICALLY INDICATED."

Emit that limitation exactly once when the basic screening module contributes to
the report.

BASIC SCREENING MUST NOT expose:
- full aneurysm morphology workflow
- formal neck/dome ratio workflow
- NASCET calculations
- detailed AVM angioarchitecture/grading
- detailed vessel-wall characterization
- exhaustive segment-by-segment stenosis grading

If screening identifies a significant abnormality, allow concise description and
radiologist-selected recommendation for dedicated vascular evaluation.

Do not silently promote the screening module into dedicated MRA.

============================================================
15. NORMAL PRESETS
============================================================

Provide separate normal baselines for:
- Dedicated intracranial MRA
- Dedicated MRA neck
- Dedicated MRV
- Basic intracranial MRA screening

Normal-to-abnormal reconciliation must remove/replace conflicting normal
observations rather than leaving contradictory prose.

============================================================
16. CANONICAL MACROS / PRESETS
============================================================

Seed at least the supplied:
1. Intracranial saccular aneurysm
2. Dural venous sinus thrombosis

Also support clinically useful structured presets assembled from canonical
observations:
- focal intracranial stenosis
- intracranial vessel occlusion
- moyamoya-pattern vasculopathy
- AVM pattern
- carotid stenosis
- carotid dissection pattern
- deep cerebral venous thrombosis
- transverse sinus developmental hypoplasia/aplasia

Preset application MUST be reversible and use existing macro/overlay
infrastructure.

Do not silently generate unsupported diagnoses from preset selection.

============================================================
17. FINDINGS COMPOSITION
============================================================

Dedicated intracranial MRA order:
1. Technique
2. Circle of Willis / configuration
3. Anterior circulation
4. Posterior circulation
5. Focal vascular abnormality
6. Variants
7. Associated brain findings when applicable

MRA neck order:
1. Technique
2. Right carotid system
3. Left carotid system
4. Vertebral arteries
5. Focal abnormality / measurements
6. Variants

MRV order:
1. Technique
2. Dural venous sinuses
3. Deep venous system
4. Other veins
5. Thrombus/abnormality
6. Associated brain findings

Basic MRA screening should contribute only a concise screening subsection to the
MRI Brain report, plus its limitation statement once.

============================================================
18. IMPRESSION
============================================================

Impression is generated from accepted observations, not independently typed
shadow state.

Prioritize clinically significant vascular abnormalities.

Support stale-impression detection when linked vascular findings change.

Manual radiologist editing/reordering must remain protected from automatic
overwrite according to the existing CARE provenance model.

Do not infer:
- acute occlusion from flow loss alone
- ruptured aneurysm from aneurysm alone
- Moyamoya disease from pattern alone
- thrombosis from a transverse sinus flow gap alone
- AVM temporal drainage from static MRA alone

============================================================
19. CONTRADICTION / VALIDATION RULES
============================================================

At minimum detect:
- vessel normal + same vessel occluded
- vessel normal + same vessel severe stenosis
- no aneurysm + aneurysm present
- MRV normal + thrombosis present
- sinus patent + same sinus occlusively thrombosed
- transverse sinus hypoplasia/aplasia + incompatible normal-caliber statement
- no hemorrhage + hemorrhage observation
- screening-only protocol + unsupported detailed dedicated-MRA claims
- no contrast + enhancement wording
- no DWI + diffusion wording
- no SWI/GRE + blooming wording
- numeric NASCET without required measurement/provenance if calculator used
- aneurysm ratio inconsistent with entered source measurements

Warnings should be clinically useful and not prevent radiologist-controlled
manual reporting when explicitly acknowledged.

============================================================
20. CRITICAL FINDINGS
============================================================

Integrate with the EXISTING critical-result workflow.

Potential critical observations may include:
- major arterial occlusion when radiologist-confirmed
- ruptured/suspected ruptured aneurysm with hemorrhage
- significant AVM-related acute hemorrhage
- extensive CVST with hemorrhagic venous infarction
- deep venous thrombosis with major edema
- other radiologist-designated urgent vascular finding

Do not automatically document communication.
Do not fabricate recipient/time.
Use existing acknowledgement/communication workflow.

============================================================
21. AI
============================================================

AI is proposal-only.

AI may propose:
- vessel observation
- lesion type/location
- aneurysm measurements
- stenosis description
- venous abnormality
- associated brain finding
- impression text

Radiologist must accept/edit/reject.

AI must not silently:
- finalize a vascular diagnosis
- assign acuity
- generate unsupported percentage stenosis
- declare rupture
- declare Moyamoya disease
- declare CVST from a flow gap alone
- trigger/document critical communication

============================================================
22. UI / UX
============================================================

Keep the dedicated vascular panels clinically dense but fast.

Use:
- compact vessel rows
- side-aware chips
- expandable advanced details
- measurement fields beside the relevant lesion
- visible technique/protocol state
- clear distinction between observation and interpretation
- compact Basic MRA Screening inside MRI Brain

Do not overload routine MRI Brain with the entire dedicated MRA/MRV editor.

============================================================
23. TESTS
============================================================

Add/extend tests for:
- normal dedicated intracranial MRA
- normal MRA neck
- normal MRV
- normal Basic MRA Screening
- normal-to-abnormal reconciliation
- aneurysm measurement + calculated dome/neck ratio
- multiple aneurysms
- TOF flow loss does not auto-create numeric stenosis
- nonvisualization does not auto-create acute occlusion
- NASCET calculation/provenance
- carotid dissection sequence gating
- Moyamoya pattern vs disease separation
- AVM temporal wording gating
- MRV flow gap vs thrombosis separation
- transverse sinus hypoplasia variant
- deep venous thrombosis + bilateral thalamic edema
- DWI/SWI/contrast sequence gating
- screening limitation exactly once
- screening does not expose dedicated workflow
- Findings/Impression stale refresh
- manual text protection
- contradiction validation
- critical workflow
- AI proposal-only behavior
- billed-study/performed-protocol resolver
- no duplicate observation state

Run relevant unit/integration tests, typecheck and production build.

============================================================
24. AUDIT / IMPLEMENTATION PROCESS
============================================================

Before coding:
1. Audit current MRI Brain canvas and observation ledger.
2. Identify existing MRA/MRV code, presets, schemas and billed-study mappings.
3. Identify reusable lesion/measurement/provenance infrastructure.
4. Identify current sequence/protocol model.
5. Identify Findings/Impression and critical workflow bindings.
6. Identify any existing basic MRA screening behavior.
7. Provide a concise implementation plan tied to existing files/APIs.

During implementation:
- prefer extension over replacement
- no destructive data migration
- preserve existing production reports
- preserve manual prose
- keep backward compatibility
- document any canonical-source discrepancy

============================================================
25. CONSTRAINTS
============================================================

DO NOT:
- build a second MRI Brain reporting engine
- create parallel local React observation state
- create a separate Findings/Impression truth
- create a second lesion engine unnecessarily
- create a separate CPA/IAC module in this task
- treat routine CP-angle assessment as a reason to expand this vascular task
- make Basic MRA Screening equivalent to dedicated MRA
- hard-code questionable stenosis thresholds
- auto-diagnose from isolated flow artifacts
- alter PACS/DICOM data
- alter billing behavior except safe resolver wiring required for this feature
- deploy to production
- merge the PR

============================================================
26. SPEC COMPLIANCE REVIEW
============================================================

Before opening the PR, perform a section-by-section compliance review against
this specification.

For every section report:
- implemented
- partially implemented + reason
- not applicable + reason

Resolve accidental omissions before PR creation.

============================================================
27. COMPLETION REPORT
============================================================

Report:
1. audit findings
2. architecture reused
3. files changed
4. schemas/types added or extended
5. dedicated intracranial MRA implementation
6. MRA neck implementation
7. MRV implementation
8. Basic MRA Screening implementation
9. technique/sequence gating
10. aneurysm measurement model
11. stenosis/NASCET handling
12. variant handling
13. Findings/Impression integration
14. validation/contradiction rules
15. critical workflow
16. AI proposal workflow
17. tests/typecheck/build results
18. billed-study mapping audit
19. known limitations
20. spec compliance matrix
21. screenshots of important UI states if practical
22. recommended next phase

Create the PR.

DO NOT MERGE.
DO NOT DEPLOY TO PRODUCTION.
