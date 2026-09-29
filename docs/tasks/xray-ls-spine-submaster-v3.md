TASK: CARE ERP — X-RAY LUMBOSACRAL SPINE CLINICAL SUB-MASTER REPORTING V3

Repository: DrAbinash/care-on-synology1
CANONICAL SOURCE: docs/clinical-libraries/xray-ls-spine-clinical-content-library.md

Specification governs architecture/workflow/safety; library governs seeded clinical prose.

============================================================
1. PURPOSE / ARCHITECTURE
============================================================
Extend existing CARE X-ray reporting with dedicated LS Spine structured reporting. Reuse current report canvas/model, observation ledger/provenance, workspace state, reversible macros, Findings/Impression, manual protection, validator, critical workflow and AI proposals. Reuse MRI lumbar concepts only where modality-appropriate. Never let X-ray generate MRI-only canal/root/disc-signal conclusions.

============================================================
2. VIEW / ADEQUACY
============================================================
First-class performed views: AP, lateral, R/L oblique, flexion, extension, spot L5-S1, other. Track adequacy/coverage. Gate pars, dynamic and junction-specific claims by actual views.

============================================================
3. SUB-MASTERS
============================================================
Routine/Normal; Degenerative; Spondylolisthesis/Pars; Trauma; Deformity/Scoliosis; Transitional Anatomy; Infection/Destructive; Tumor/Osseous lesion; Post-operative; Dynamic Instability; Sacroiliac/Associated; More/Advanced.

============================================================
4. NUMBERING — HIGH PRIORITY
============================================================
Reuse conceptual safety of LumbarNumberingResolver where technically compatible. Support standard, LSTV, sacralization, lumbarization, designated L5, whole-spine/localizer-based and manual numbering. Numbering must remain consistent across Findings, levels, measurements and Impression. Do not silently assume lowest mobile segment is L5-S1. Display caution when confidence is reduced.

============================================================
5. SHARED LS CORE
============================================================
Alignment/lordosis; vertebral bodies/endplates; disc spaces T12-L1 if included and L1-2 through L5-S1; posterior elements/facets/pars; sacrum where visible; SI joints; transitional anatomy; hardware. One observation source across palettes.

============================================================
6. NORMAL BASELINE
============================================================
One-click normal baseline with coverage-aware wording. Abnormal selections reconcile normals. Transitional anatomy/numbering uncertainty must prevent falsely confident level-specific normal prose.

============================================================
7. DEGENERATIVE
============================================================
Support per-level disc-space narrowing, osteophytes, endplate sclerosis/irregularity, vacuum phenomenon, facet arthropathy and degenerative listhesis. Do not infer disc desiccation, nerve-root compression or canal stenosis from plain radiographs.

============================================================
8. SPONDYLOLISTHESIS / PARS
============================================================
Store level, direction, measured translation, vertebral AP reference if used, calculated slip percentage, Meyerding grade when validly derived, pars observation and radiologist-selected etiology. Calculations must derive from visible source measurements with provenance. Slip alone does not determine degenerative vs isthmic etiology.

============================================================
9. DYNAMIC
============================================================
Only when flexion/extension performed. Store neutral/flexion/extension translation and optional angular measurements with provenance; calculate change from source values. Radiologist selects instability interpretation. Do not hard-code questionable thresholds or infer dynamic instability from neutral films.

============================================================
10. TRAUMA
============================================================
Support compression/wedge/burst-pattern suspicion, level, height loss measurement, cortical disruption, alignment, visible retropulsion and posterior-element injury. Do not overstate canal/neural/ligamentous injury. Allow CT/MRI recommendation selected by radiologist.

============================================================
11. DEFORMITY / SCOLIOSIS
============================================================
Support curve direction, apex, Cobb angle when deliberately measured on appropriate image, optional coronal imbalance and selected rotation description. Measurement provenance mandatory. Do not fabricate Cobb angle from prose.

============================================================
12. TRANSITIONAL ANATOMY
============================================================
Support enlarged transverse process, pseudoarticulation/fusion, sacralization/lumbarization and radiologist-selected Castellvi classification when adequately demonstrated. Transitional anatomy does not automatically equal Bertolotti syndrome.

============================================================
13. SI JOINTS
============================================================
Support gross preserved/sclerosis/irregularity/narrowing/ankylosis/asymmetry. Do not auto-diagnose inflammatory sacroiliitis or axial spondyloarthritis from nonspecific sclerosis.

============================================================
14. INFECTION / TUMOR
============================================================
Support canonical descriptive destructive/lytic/sclerotic/pathologic-fracture observations. Disease/etiology labels require radiologist selection and appropriate context.

============================================================
15. POST-OPERATIVE
============================================================
Support laminectomy, posterior fusion, pedicle screws/rods, interbody cages, vertebroplasty/kyphoplasty, alignment, breakage/migration, convincing perihardware lucency and adjacent degeneration. Do not auto-diagnose loosening from equivocal lucency.

============================================================
16. MEASUREMENTS / PROVENANCE
============================================================
Measurements: vertebral height loss, translation, slip %, Cobb angle, optional other. Each stores view/level/source/provenance. Derived values recompute from source measurements. Manual override is explicit/provenanced. No hidden threshold should silently create a diagnosis.

============================================================
17. FINDINGS / IMPRESSION
============================================================
Order: technique/views; numbering; alignment; vertebrae; discs; posterior elements/facets/pars; SI joints; hardware; other. Impression priority: fracture/destructive lesion; listhesis/radiologist-selected instability; major degeneration; deformity; transitional anatomy; postoperative issue. Protect manual prose; stale-impression detection.

============================================================
18. VALIDATION
============================================================
Detect: normal alignment + listhesis; preserved disc + narrowed same level; no fracture + fracture; normal study + significant abnormality; pars claim from unsupported/inadequate view where configured; dynamic diagnosis without flex/ext; inconsistent level numbering; LSTV with conflicting labels; SI normal + ankylosis; hardware intact + breakage; derived measurement inconsistency.

============================================================
19. CRITICAL / AI
============================================================
Use existing critical workflow for radiologist-designated acute unstable/destructive findings. Never fabricate communication. AI proposal-only; no silent fracture, instability, malignancy, infection or inflammatory sacroiliitis diagnosis.

============================================================
20. TESTS
============================================================
Normal LS; coverage limitation; degenerative multilevel; LSTV numbering; designated L5 consistency; spondylolisthesis measurement/grade; pars uncertainty; flex/ext; no dynamic diagnosis on neutral films; compression fracture; scoliosis/Cobb provenance; SI sclerosis without auto-SpA; postoperative hardware; normal-abnormal reconciliation; contradictions; stale impression; manual protection; critical; AI; billed-study/view resolver.
Run tests/typecheck/build.

============================================================
21. PROCESS
============================================================
Audit existing X-ray code, MRI lumbar numbering/measurement infrastructure and billed study catalog first. Reuse only modality-safe pieces. Provide plan before coding. No destructive migration; preserve historical reports.
Perform section-by-section spec compliance review before PR.
Completion report: audit, reused architecture, files changed, view/coverage model, numbering resolver integration, submasters, measurements/provenance, validation, critical/AI, tests/build, billed mapping, limitations, compliance matrix, screenshots if practical.
CREATE PR. DO NOT MERGE. DO NOT DEPLOY.
