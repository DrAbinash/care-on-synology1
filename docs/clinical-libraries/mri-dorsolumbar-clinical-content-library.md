# MRI Dorso-Lumbar Spine Clinical Content Library

## Canonical-source note

This dedicated Dorso-Lumbar library is derived from the supplied MRI Dorsal / Dorsolumbar clinical content and the established CARE Lumbar clinical model. It is not a concatenation of the Dorsal and Lumbar reports.

The dedicated examination is modeled around actual acquired coverage with special emphasis on the thoracolumbar transition, cord-to-conus-to-cauda transition, and pathology crossing the junction.

The implementation specification governs architecture, sequence gating, validation, numbering safety and diagnostic escalation. Descriptive observations may be seeded from this library; stronger etiologic/syndromic diagnoses remain radiologist-selected where the imaging feature alone is insufficient.

## 1. Coverage / Numbering

Normal:
- Vertebral numbering and acquired coverage are documented from the available localizer / whole-spine reference where present.
- The thoracolumbar junction is included when actually covered.

Abnormal / caution:
- Transitional vertebral anatomy or uncertain numbering is present; level designation should be correlated with whole-spine/localizer imaging before intervention.
- Limited superior/inferior coverage prevents complete assessment of the entire thoracic or lumbar spine.

Never imply that a dedicated Dorso-Lumbar study automatically covers T1 through S1.

## 2. Alignment & Curvature

Normal:
- Alignment of the visualized dorsal, thoracolumbar and lumbar spine is maintained.
- Thoracic kyphosis and lumbar lordosis are preserved within the imaged coverage.

Abnormal:
- Exaggerated thoracic kyphosis.
- Straightening / reversal of thoracic kyphosis.
- Loss / straightening of lumbar lordosis.
- Focal thoracolumbar junction kyphosis / gibbus deformity.
- Scoliotic curvature convex to the [right/left], apex at [level].
- Anterolisthesis / retrolisthesis of [vertebra] over [vertebra], measuring [X] mm.

## 3. Vertebral Bodies / Marrow / Endplates

Normal:
- Vertebral body heights and marrow signal are maintained within the imaged coverage.
- No acute compression fracture or focal destructive marrow lesion is identified.

Abnormal:
- Acute/subacute compression or wedge fracture with T1 hypointense and STIR hyperintense marrow edema.
- Burst-fracture pattern with posterior cortical involvement and retropulsion.
- Chronic vertebral wedging without marrow edema.
- Endplate irregularity / sclerosis.
- Modic type I / II / III endplate change where sequence criteria are fulfilled.
- Schmorl node with / without surrounding reactive marrow signal.
- Focal T1/T2 hyperintense lesion with fat-suppression characteristics compatible with hemangioma when selected by the radiologist.
- Focal or multifocal marrow-replacing lesion.
- Vertebral collapse / pathological-fracture pattern.

## 4. Intervertebral Discs

For every actually covered level support:
- preserved disc height/signal
- desiccation
- reduced disc space
- diffuse bulge
- broad-based protrusion
- focal protrusion
- extrusion
- migration when demonstrated
- endplate/disc inflammatory signal
- calcified/low-signal disc component as descriptive observation

Thoracic disc observations must retain thoracic cord/canal context.
Lumbar disc observations must retain lateral-recess/foraminal/root context.

## 5. Thoracic Canal / Cord

Normal:
- Visualized thoracic spinal cord demonstrates normal caliber and signal.
- No significant thoracic canal compromise is identified within the imaged coverage.

Abnormal:
- Ventral/dorsal thecal sac indentation.
- Central canal narrowing at [level].
- Cord flattening / compression.
- Intrinsic T2/STIR cord hyperintensity.
- Cord volume loss / myelomalacic pattern when selected.
- Epidural abnormality.
- OLF / OPLL pattern where radiologist-selected; CT may better characterize ossification.

Do not convert low-signal ligamentous thickening automatically into OLF/OPLL.

## 6. Thoracolumbar Junction / Conus

This is a first-class section.

Support:
- T10-L2 junctional alignment.
- T11-T12, T12-L1 and L1-L2 disc/endplate disease where covered.
- Junctional fracture / retropulsion.
- Posterior ligamentous complex observations.
- Epidural collection / hematoma / mass.
- Conus level.
- Conus caliber and signal.
- Conus compression.
- Intrinsic conus T2/STIR signal.
- Transition from cord to conus to cauda equina.
- Paravertebral / psoas extension when included.

Normal:
- Conus medullaris terminates at the documented level and demonstrates normal signal, when adequately covered.

Do not emit a conus statement when the conus is outside or inadequately covered.

## 7. Lumbar Canal / Lateral Recess / Neural Elements

Support at covered lumbar levels:
- thecal sac compression
- central canal narrowing
- right/left lateral recess narrowing
- neural foraminal narrowing
- traversing-root contact/impingement suggestion using the established lumbar level model
- exiting-root contact/impingement suggestion using the established lumbar level model
- facet arthropathy
- ligamentum flavum hypertrophy
- cauda-equina crowding/compression
- epidural abnormality

Root suggestions must remain level-numbering aware and radiologist overridable.

## 8. Neural Foramina

Thoracic:
- right/left foraminal narrowing or lesion at [level].
- Do not import the lumbar traversing/exiting-root inference engine into thoracic levels.

Lumbar:
- right/left foraminal narrowing with exiting-root relationship where supported.

## 9. Posterior Elements / Ligaments

Support:
- pedicles
- laminae
- spinous processes
- facets
- posterior-element marrow lesion
- posterior-element fracture
- interspinous ligament injury pattern
- ligamentum flavum abnormality
- posterior ligamentous complex observations
- pars abnormalities only in anatomically appropriate lumbar coverage

## 10. Costovertebral / Paravertebral / Psoas

Thoracic coverage:
- costovertebral / costotransverse abnormality where visualized.
- paravertebral soft-tissue mass / collection.

Junction/lumbar coverage:
- paravertebral and psoas abnormality when included.

## 11. Degenerative Disease

Support mixed thoracic + lumbar degenerative disease without duplicating prose:
- disc desiccation / disc-space reduction
- osteophytes
- endplate degeneration
- thoracic disc protrusion/extrusion
- lumbar disc bulge/protrusion/extrusion
- facet arthropathy
- ligamentum flavum hypertrophy
- canal/recess/foraminal effects
- cord/conus/cauda effects according to level.

## 12. Trauma

Support:
- compression / wedge / burst fracture
- posterior-wall involvement
- retropulsion
- vertebral height loss %
- marrow edema
- posterior-element injury
- posterior ligamentous complex observations
- epidural hematoma
- canal compromise
- cord / conus compression
- intrinsic cord/conus T2 signal
- paravertebral soft-tissue injury

### Macro: Thoracolumbar Junction Burst Fracture

FINDINGS:
Focal kyphotic angulation at the thoracolumbar junction. Acute burst fracture of the [T12/L1] vertebral body with approximately [X]% height loss and posterior cortical disruption. Retropulsed bony fragment projects approximately [X] mm into the spinal canal. Associated marrow edema is present. Posterior ligamentous complex abnormality is [present/suspected/not identified] on the available sequences. There is [degree] canal compromise with [cord/conus] compression and [presence/absence] of intrinsic T2/STIR signal abnormality.

IMPRESSION:
Acute burst fracture at [level] with retropulsion and [degree] canal compromise. Associated [cord/conus] effect as described. Posterior ligamentous complex injury is reported only when supported and radiologist-selected.

## 13. Infection / Spondylodiscitis

Support:
- involved vertebrae/disc
- endplate erosion/destruction
- marrow edema
- vertebral collapse
- kyphosis/gibbus
- epidural component
- pre/paravertebral collection
- psoas extension when covered
- collection dimensions and craniocaudal extent
- canal compromise
- cord/conus/cauda compression
- enhancement only when contrast performed

### Macro: Junction-crossing Spondylodiscitis

FINDINGS:
Abnormal marrow signal and endplate destruction involve [levels] with abnormal intervening disc signal. Associated pre/paravertebral soft-tissue component extends from [level] to [level], with [epidural/psoas] extension where present. There is [degree] canal compromise with effect on the [cord/conus/cauda].

IMPRESSION:
Imaging features of infective spondylodiscitis involving [levels], with associated soft-tissue/epidural extension as described. Tuberculous etiology / Pott disease is radiologist-selected and must not be generated solely from the presence of a paravertebral collection.

## 14. Tumor / Marrow / Epidural Disease

Support:
- focal/multifocal marrow lesion
- vertebral collapse/pathological fracture
- posterior-element involvement
- epidural extension
- paravertebral extension
- canal compromise
- cord/conus/cauda effect
- intradural/intramedullary lesion where present
- enhancement when contrast exists

Do not automatically diagnose metastasis from an indeterminate marrow lesion.

## 15. Intradural / Intramedullary / Vascular Pattern

Support descriptive observations for:
- intramedullary cord/conus lesion
- intradural extramedullary lesion
- cord/conus expansion
- intrinsic signal abnormality
- serpiginous perimedullary flow-void pattern
- associated cord edema

Spinal dAVF or specific tumor diagnosis remains radiologist-selected unless adequately supported.

## 16. OLF / OPLL / DISH

Support thoracic/junctional:
- ligamentum flavum low-signal thickening / suspected ossification
- posterior longitudinal ligament low-signal thickening / suspected ossification
- canal/cord effect
- flowing/bridging anterior longitudinal ligament ossification pattern

MRI may suggest ossification; CT may be recommended for characterization. DISH must not be generated from a single bridging osteophyte.

## 17. Post-operative

Support:
- decompression / laminectomy
- fixation / fusion
- screws / rods / cages
- operated levels
- alignment
- residual/recurrent canal compromise
- epidural/postoperative collection
- hardware-related artifact
- adjacent-level degeneration

Do not overstate hardware loosening on MRI from nonspecific perihardware signal.

## 18. Deformity / Congenital / Transitional Anatomy

Support:
- scoliosis
- kyphosis/gibbus
- segmentation anomaly
- hemivertebra
- block vertebra
- lumbosacral transitional vertebra when covered
- numbering caution

## 19. AP Canal Measurements

Allow AP canal measurements only where actually measured. Store level and provenance. Do not use questionable universal threshold bands to automatically assign stenosis severity.

## 20. Screening Composition

A dedicated Dorso-Lumbar examination is NOT equivalent to Dorsal Screening + LS Screening.

If additional cervical or other regional screening was actually performed, use the shared spine-screening infrastructure and emit the standard limitation exactly once:

"SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE."

## 21. Impression Priority

1. Acute fracture / destructive lesion / infection.
2. Cord, conus or cauda compression and intrinsic signal abnormality.
3. Significant junctional pathology.
4. Significant thoracic canal/disc disease.
5. Significant lumbar canal/recess/foraminal disease.
6. Tumor/marrow/intradural abnormality.
7. Deformity / postoperative finding.
8. Important accompanying screening finding.
9. Radiologist-selected recommendation.
