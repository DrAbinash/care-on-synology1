TASK: CARE ERP — X-RAY CERVICAL SPINE CLINICAL SUB-MASTER REPORTING V3

Repository: DrAbinash/care-on-synology1
CANONICAL SOURCE: docs/clinical-libraries/xray-cervical-spine-clinical-content-library.md

Specification governs architecture/workflow/safety; library governs seeded clinical prose.

============================================================
1. PURPOSE / ARCHITECTURE
============================================================
Extend existing CARE X-ray reporting; no parallel engine. Reuse report canvas/model, observation ledger/provenance, workspace state, reversible macros, Findings/Impression, manual protection, validator, critical workflow and AI proposals. Reuse shared spine concepts where safe, but DO NOT import MRI-only conclusions into radiography.

============================================================
2. VIEW / ADEQUACY
============================================================
First-class performed views: AP, lateral, open-mouth odontoid, R/L oblique, flexion, extension, swimmer's, other. Track adequacy and visualized inferior level. Gate odontoid/C1-C2 statements, foraminal assessment and dynamic interpretation by actual performed/adequate views.

============================================================
3. SUB-MASTERS
============================================================
Routine/Normal; Degenerative/Spondylosis; Trauma; Alignment/Listhesis; Dynamic; Congenital/Developmental; Infection/Destructive; Tumor/Osseous lesion; Post-operative; More/Advanced.

============================================================
4. SHARED CERVICAL CORE
============================================================
Alignment/lordosis; vertebral bodies/endplates; disc spaces C2-3 through C7-T1 when seen; posterior elements; facets; uncovertebral joints; foramina; craniocervical junction/odontoid/C1-C2; prevertebral soft tissues; visible hardware.
Uncovertebral joints ARE cervical-specific and must not be removed by lumbar abstractions.

============================================================
5. NORMAL BASELINE
============================================================
One-click normal baseline. Reconcile abnormal selections with normals. If odontoid/C7-T1 is not adequately seen, normal preset must not falsely certify it.

============================================================
6. ALIGNMENT
============================================================
Support preserved/straightened/reversed lordosis, scoliosis, anterolisthesis, retrolisthesis and four alignment lines. Straightening is descriptive and not automatically "muscle spasm."

============================================================
7. DEGENERATIVE
============================================================
Per-level disc-space narrowing, osteophytes, endplate sclerosis, facet/uncovertebral arthropathy, foraminal narrowing on adequate oblique views, degenerative listhesis. Findings and impression share one observation source.

============================================================
8. CRANIOCERVICAL / C1-C2
============================================================
Support odontoid integrity, C1 lateral masses, atlantoaxial alignment, optional deliberate measurements with provenance. Consider rotation/technical asymmetry. Do not fabricate measurements or interpret inadequately seen anatomy.

============================================================
9. TRAUMA
============================================================
Support fracture location/type, displacement, height loss, facet malalignment/dislocation, spinous process, odontoid/C1 pattern, prevertebral swelling and alignment. Technically inadequate series cannot exclude injury. CT recommendation is radiologist-selected.

============================================================
10. DYNAMIC
============================================================
Activate only when flexion/extension performed. Store level, flexion/extension translation, optional angular change and range limitation with provenance. Radiologist selects instability interpretation. Do not infer dynamic instability from neutral films or apply questionable unreviewed thresholds.

============================================================
11. CONGENITAL / INFECTION / TUMOR
============================================================
Support canonical descriptive observations. Etiologic/disease labels remain radiologist-selected when plain film is nonspecific. Do not auto-diagnose metastasis or infection from one indeterminate sign.

============================================================
12. POST-OPERATIVE
============================================================
Support ACDF/posterior fixation/fusion levels, plate/screws/rods/cages, alignment, gross breakage/migration, convincing perihardware lucency and adjacent-segment degeneration. Do not overstate loosening.

============================================================
13. MEASUREMENTS
============================================================
All measurements must have level/view/provenance. Calculated values derive from source measurements. No hidden hard-coded thresholds that automatically change diagnosis. If existing shared measurement infrastructure can be reused, use it.

============================================================
14. FINDINGS / IMPRESSION
============================================================
Compose in order: technique/views; alignment; vertebrae; discs; posterior elements/facets/uncovertebral/foramina; C1-C2; soft tissues; hardware; other. Impression prioritizes acute injury, instability/listhesis, significant degeneration, destructive lesion, postoperative issue. Protect manual edits; stale-impression detection.

============================================================
15. VALIDATION
============================================================
Detect: normal alignment + listhesis; preserved disc + narrowed same disc; no fracture + fracture; normal prevertebral tissue + swelling; normal study + significant abnormality; foraminal claim without adequate oblique view; odontoid claim without adequate odontoid visualization; dynamic claim without flex/ext; hardware normal + breakage; level/numbering inconsistencies.

============================================================
16. CRITICAL / AI
============================================================
Use existing critical workflow for radiologist-designated unstable injury/dislocation/other urgent finding. Never fabricate communication. AI proposal-only; no silent fracture/instability finalization or manual overwrite.

============================================================
17. TESTS
============================================================
Normal adequate series; inadequate C7-T1; odontoid gating; oblique foraminal gating; degenerative multilevel case; trauma; prevertebral swelling; flex/ext dynamic case; neutral-film no dynamic diagnosis; postoperative hardware; normal-abnormal reconciliation; contradictions; measurement provenance; stale impression; manual protection; critical workflow; AI proposal-only; billed-study/view mapping.
Run tests/typecheck/build.

============================================================
18. PROCESS
============================================================
Audit existing X-ray and shared spine implementation first. Identify actual binding APIs and billed study codes/names; plan before coding. No destructive migration. Preserve old reports.
Perform section-by-section spec compliance review before PR.
Completion report with audit, reused architecture, files changed, view gating, structured model, submasters, measurement/provenance, validation, critical/AI, tests/build, billed mapping, limitations, compliance matrix, screenshots if practical.
CREATE PR. DO NOT MERGE. DO NOT DEPLOY.
