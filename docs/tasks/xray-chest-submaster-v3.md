TASK: CARE ERP — X-RAY CHEST CLINICAL SUB-MASTER REPORTING V3

Repository: DrAbinash/care-on-synology1

CANONICAL CLINICAL SOURCE:
docs/clinical-libraries/xray-chest-clinical-content-library.md

This specification is binding for architecture/workflow/safety. The clinical library is authoritative for seeded clinical prose.

============================================================
1. PURPOSE
============================================================
Extend the EXISTING CARE radiology reporting architecture with a dedicated X-ray Chest Clinical Sub-Master. Do not build a parallel reporting engine.

Audit first and reuse current canvas/model, observation ledger/provenance, Zustand/workspace state, reversible macros/overlays, Findings/Impression composition, manual-text protection, validation, critical workflow, AI proposal workflow, worklist/study binding and PACS/OHIF launch.

============================================================
2. VIEW / ADEQUACY — FIRST-CLASS STATE
============================================================
Track performed projection(s): PA, AP erect, AP supine, portable AP, lateral, lordotic, other.
Track adequacy: inspiration, rotation, penetration, motion, field inclusion.
Projection/adequacy must gate interpretation. AP magnification must not be treated like PA for cardiac size. Never claim a view was assessed if not performed.

============================================================
3. CLINICAL SUB-MASTERS
============================================================
Routine/Normal; Infection/Pneumonia; TB-pattern; Pulmonary edema/Cardiac failure pattern; Pleural disease; Pneumothorax; Collapse/Atelectasis; COPD/Emphysema; ILD/Diffuse lung disease; Nodule/Mass; Trauma; Cardiac/Mediastinal; Pediatric; Post-procedure/ICU; Post-operative; More/Advanced.
One observation model, multiple palettes.

============================================================
4. SHARED CHEST CORE
============================================================
Structured observations for trachea/central airways, right/left lungs by zones, hila, pulmonary vasculature, pleura/costophrenic angles, cardiac silhouette, mediastinum/aorta, diaphragms, visible upper abdomen, bones and soft tissues.

Lung observations: air-space opacity, consolidation, interstitial/reticular/reticulonodular opacity, nodular opacity, mass-like opacity, cavitation, fibrosis, hyperinflation, bullae, collapse/atelectasis. Store side, zone/lobe where supportable, extent and relevant measurement.

============================================================
5. NORMAL BASELINE
============================================================
One-click Normal Chest baseline from canonical library. Abnormal selections must reconcile conflicting normal observations. Do not leave "lungs clear" alongside consolidation, or "no effusion" alongside effusion.

============================================================
6. INFECTION / TB
============================================================
Support focal/multifocal consolidation, air bronchograms, cavitation, associated effusion and interval change.
TB-pattern observations are descriptive. Do not automatically convert upper-zone opacity/cavity/fibrosis into active tuberculosis. Diagnostic label requires radiologist selection/context.

============================================================
7. EDEMA / CARDIAC
============================================================
Support vascular congestion/redistribution, interstitial/air-space edema pattern, effusions and cardiomegaly where projection permits. Do not infer heart failure from one nonspecific sign.

============================================================
8. PLEURA / PNEUMOTHORAX
============================================================
Support effusion size/side, loculation, pleural thickening/calcification, pneumothorax size/side, hydropneumothorax and tension-pattern signs. Tension is not inferred from size alone.

============================================================
9. COLLAPSE / COPD / ILD
============================================================
Support radiographic signs from canonical library. Keep descriptive observations separate from final disease labels when radiography is nonspecific.

============================================================
10. NODULE / MASS
============================================================
Support one/multiple lesions, side/zone, dimensions, margins/appearance when visible and calcification. Do not auto-classify malignancy. Allow radiologist-selected CT recommendation.

============================================================
11. CARDIOMEDIASTINAL / DIAPHRAGM
============================================================
Support cardiac size appropriate to projection, aortic contour/calcification, mediastinal width, hilar/pulmonary artery prominence, tracheal deviation, elevated/flattened diaphragm, eventration, hiatus-hernia pattern and subdiaphragmatic free gas.

============================================================
12. TRAUMA
============================================================
Support visible rib/clavicle fractures, pneumothorax/hemothorax pattern, contusion pattern, subcutaneous emphysema and mediastinal widening. Normal radiograph must not be presented as excluding occult thoracic injury.

============================================================
13. LINES / TUBES / DEVICES
============================================================
Structured device objects: ET tube, enteric tube, CVC, PICC, chest drain, pacemaker, ICD, prosthetic valve, sternotomy wires, other. Store side/course/tip position/measurement only when actually available, satisfactory vs malpositioned, complication. Never invent a tip distance.

============================================================
14. PEDIATRIC / POST-OP / ICU
============================================================
Provide age/projection-aware pediatric observations and compact ICU/post-operative palette. Do not treat normal thymic contour as mass automatically.

============================================================
15. COMPARISON — FIRST-CLASS
============================================================
If prior imaging is available, allow lesion/device-level: new, increased, decreased, improving, resolved, unchanged/stable, interval development, removed/repositioned. Never generate comparison language without an actual prior study/reference.

============================================================
16. FINDINGS / IMPRESSION
============================================================
Compose from accepted ledger observations. Impression priority: urgent abnormality; dominant pulmonary finding; pleural finding; cardiomediastinal finding; device issue; important incidental finding. Manual radiologist text/provenance remains protected. Stale-impression detection when linked findings change.

============================================================
17. VALIDATION
============================================================
Detect at minimum: clear lungs + focal opacity; no effusion + effusion; no pneumothorax + pneumothorax; normal cardiac size + cardiomegaly; normal mediastinum + widening; no device + device object; normal study + significant abnormality; comparison wording without prior; PA-only assumption on AP; technique-dependent unsupported statements.

============================================================
18. CRITICAL RESULTS
============================================================
Integrate with existing CARE critical workflow for radiologist-designated urgent findings such as tension-pattern pneumothorax, large/new pneumothorax, major device malposition, free subdiaphragmatic gas, major acute traumatic abnormality, other selected urgent finding. Never fabricate communication recipient/time.

============================================================
19. AI
============================================================
AI proposal-only. It may propose observations, localization, measurements, comparison and impression, but cannot silently finalize, communicate critical results or overwrite manual prose.

============================================================
20. TESTS
============================================================
Test normal PA; normal AP portable; AP cardiac-size gating; low-volume/rotation limitations; pneumonia; TB-pattern not auto-active-TB; edema; effusion; pneumothorax/tension separation; collapse; COPD; ILD; nodule; device positions; trauma; comparison with/without prior; normal-abnormal reconciliation; contradictions; stale impression; manual protection; critical workflow; AI proposal-only; billed-study/view resolver.
Run tests, typecheck, production build.

============================================================
21. PROCESS / COMPLETION
============================================================
Audit existing X-ray code and billed study names first. Provide concise plan before implementation. Prefer extension over replacement; no destructive migration; preserve historical reports.
Before PR, perform section-by-section spec compliance review.
Completion report: audit, reused architecture, files changed, model/schema, UI, view gating, submasters, comparison, devices, validation, critical/AI, tests/build, billed-study mapping, limitations, compliance matrix, screenshots if practical.
CREATE PR. DO NOT MERGE. DO NOT DEPLOY.
