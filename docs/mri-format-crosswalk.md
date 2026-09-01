# MRI Format Crosswalk: mri-reports → CARE

## Overview

This document maps the clinical MRI report format library from the
`DrAbinash/mri-reports` reference repository to CARE's existing Full Report
Format / Quick Select / observation catalog.

**Source repo:** `DrAbinash/mri-reports` (tagged `legacy-mri-reports`)
**Target repo:** `DrAbinash/care-on-synology1`

## 1. MRI Reference Repo Audit

### Repository structure
```
mri-reports/
  src/lib/
    formats/
      mrBrain.ts           (164 lines — 8 complete-report formats)
      mrBrainPathology.ts  (293 lines — 15 pathology formats)
      mrSpine.ts           (325 lines — 14 spine formats)
      mrJoints.ts           (196 lines — 7 joint formats)
      mrOther.ts            (101 lines — 4 other formats)
    seedData.ts            (381 lines — PHRASE_SEEDS concept catalog)
    compile.ts             (114 lines — Findings/Impression compiler)
    slot.ts                 (68 lines — slot identity)
    store.ts               (Zustand store)
    seed.ts                (216 lines — DB seeding)
  prisma/
    schema.prisma          (FindingRow model)
```

### Original Word/docx files
**NOT FOUND in git history.** The README references `docs/mri-report-formats`
but that directory was never committed. The curated TypeScript format library
(`src/lib/formats/mr*.ts`) IS the canonical representation — it was created
by manually transcribing the doctor's clinic report formats into typed
modules. The code comments confirm: "curated from the doctor's own report
library (docs/mri-report-formats). Language kept verbatim (typos normalized)."

The `upload/` directory contains screenshots and CSV logs but NO Word/docx
files. The `docs/` directory contains only `care-erp-bridge.md`.

## 2. How the Old App Transformed Clinic Formats

### Data model
```
FormatSeed (complete-report format)
  ├── key, name, modality, region
  ├── studyTitle (printed heading — SHORT)
  ├── titleSuffix (composed findings opening — RICH)
  ├── technique (technique text)
  ├── recommendation
  ├── isNormal (boolean)
  ├── sortOrder
  └── rows: FormatRowSeed[]
        ├── region, concept, text
        ├── inImpression (boolean)
        ├── impressionOnly (boolean — exists for Impression, not Findings)
        ├── newParagraph (boolean)
        ├── level, laterality, severity
        └── sortOrder
```

### Compilation (compile.ts)
- **Findings narrative**: rows grouped by region, level-prefixed, new-paragraph
  respected, blank lines between regions.
- **Impression**: numbered lines from `inImpression` rows.
- **Normal impression auto-yields**: the `normal_impression` concept row
  automatically hides when any real impression-worthy finding exists, and
  returns when none remain.
- **Findings opening**: `studyTitle + " WITH " + titleSuffix + finding fragments`
  — uppercased, comma-joined, "and" before last.

### Slot identity (slot.ts)
```
slotKey = region | concept | level | laterality
```
- Notes (`concept = "note"`) always get unique slots.
- `sameSlot(a, b)` → true when slotKeys match.
- Severity is NOT part of the slot (mild/moderate share a slot → same-slot
  replacement).

### UX pattern
1. Pick a complete-report format → fills study, technique, findings,
   impression, recommendation in one tap.
2. Add phrase chips (level/side/severity) → same-slot replacement.
3. Auto-compiled impression updates as findings change.
4. Manual edit protection — once edited, impression stays until divergence
   detected.

## 3. Format → CARE Crosswalk

### MRI Brain

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-brain-normal` (Normal 3T) | `MRI Brain — Normal` | EXACT MATCH |
| `mr-brain-normal-epilepsy` | (not in CARE defaults) | MISSING — low priority (epilepsy protocol rare) |
| `mr-brain-ce-normal` | (not in CARE defaults) | MISSING — low priority (CE brain normal) |
| `mr-brain-fazekas1` | `MRI Brain — Fazekas 1` | EXACT MATCH |
| `mr-brain-fazekas1-senile` | `MRI Brain — Fazekas Grade 1 + Senile Changes` | EXACT MATCH |
| `mr-brain-fazekas2` | (not in CARE defaults) | MISSING — HIGH VALUE (add) |
| `mr-brain-fazekas2-lacunar` | (not in CARE defaults) | MISSING — medium value |
| `mr-brain-fazekas3` | (not in CARE defaults) | MISSING — medium value |
| `mr-brain-acute-infarct` | `MRI Brain — Acute infarct (MCA)` | CLOSE MATCH (CARE is more structured) |
| `mr-brain-chronic-infarct` | (not in CARE defaults) | MISSING — low priority |
| `mr-brain-lacunar-infarct` | (not in CARE defaults) | MISSING — low priority |
| `mr-brain-sdh-contusion` | (not in CARE defaults) | MISSING — medium value (trauma) |
| `mr-brain-edh` | (not in CARE defaults) | MISSING — medium value (trauma) |
| `mr-brain-contusion-midline-shift` | (not in CARE defaults) | MISSING — low priority |
| `mr-brain-dai` | (not in CARE defaults) | MISSING — low priority (DAI rare) |
| `mr-brain-meningioma` | (not in CARE defaults) | MISSING — medium value (CE) |
| `mr-brain-gbm` | `MRI Brain — Glioma recurrence` | CLOSE MATCH |
| `mr-brain-ncc` | (not in CARE defaults) | MISSING — medium value (endemic) |
| `mr-brain-ms` | (not in CARE defaults) | MISSING — medium value |
| `mr-brain-hydrocephalus` | (Quick Select tile "Hydrocephalus" exists) | COVERED by Quick Select |
| `mr-brain-hie` | (not in CARE defaults) | MISSING — low priority (pediatric) |
| `mr-brain-arachnoid` | (not in CARE defaults) | MISSING — low priority |
| `mr-brain-atrophy` | (Quick Select tile exists) | COVERED by Quick Select |
| `mr-brain-cp-angle` | (not in CARE defaults) | MISSING — low priority |

### MRI LS Spine

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-ls-normal` | `MRI LS Spine — Normal` | EXACT MATCH |
| `mr-ls-finding-mild` | `MRI LS Spine — Disc herniation L4-L5` | CLOSE MATCH |
| `mr-ls-finding-mild-mod` | (not in CARE defaults) | MISSING — low priority (specific combo) |
| `mr-ls-spondylolisthesis` | (Quick Select tiles for spondylolisthesis) | COVERED by Quick Select |
| `mr-ls-compression-fracture` | (Quick Select tile "Compression fracture L1") | COVERED by Quick Select |
| `mr-ls-screening` | (not in CARE defaults) | MISSING — low priority (screening variant) |

### MRI Cervical Spine

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-cervical-normal` | `MRI Cervical Spine — Normal` | EXACT MATCH |
| `mr-cervical-finding` | (Quick Select tiles for disc bulge + canal stenosis) | COVERED by Quick Select |
| `mr-cervical-loss-lordosis` | NEW Quick Select tile "Loss of cervical lordosis" | ADDED in this PR |
| `mr-cervical-cord-oedema` | (not in CARE defaults) | MISSING — low priority |
| `mr-cervical-tm` | (not in CARE defaults) | MISSING — low priority (rare) |
| `mr-cervical-acm-syrinx` | (not in CARE defaults) | MISSING — low priority (rare) |

### MRI Dorsal Spine

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-dl-normal` | `MRI Dorsal Spine — Screening` | CLOSE MATCH (CARE is screening-only) |
| `mr-dl-finding` | (not in CARE defaults) | MISSING — low priority |
| `mr-dl-tb-spine` | (not in CARE defaults) | MISSING — medium value (endemic) |

### MRI Whole Spine Screening

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-wss-cervical-dorsal` | `MRI Whole Spine — Screening` | EXACT MATCH |
| `mr-wss-ls-detail` | (not in CARE defaults) | MISSING — medium value (combined LS+screening) |

### MRI Joints

| mri-reports format | CARE equivalent | Status |
|---|---|---|
| `mr-knee-normal` | (not in CARE defaults) | MISSING — documented for future |
| `mr-knee-effusion` | (not in CARE defaults) | MISSING — documented for future |
| `mr-shoulder-normal` | (not in CARE defaults) | MISSING — documented for future |
| `mr-shoulder-bursitis` | (not in CARE defaults) | MISSING — documented for future |
| (others) | (not in CARE defaults) | Documented for future |

## 4. Phrase → Quick Select Crosswalk

| mri-reports concept | CARE Quick Select tile | Status |
|---|---|---|
| `disc_contour` (bulge) | "Disc bulge L3-L4" / "Disc herniation L4-L5" / "Disc protrusion L5-S1" | EXISTING |
| `disc_signal` (desiccation) | "Disc desiccation L4-L5" + NEW "Disc desiccation L5-S1" | ADDED L5-S1 |
| `disc_height` | "Reduced disc height L4-L5" | EXISTING |
| `canal_stenosis` | "Mild/Moderate/Severe canal stenosis L4-L5" | EXISTING |
| `foraminal_stenosis` | NEW "Foraminal stenosis L4-L5" | ADDED |
| `facet_joint` | "Facet arthropathy L4-L5" | EXISTING |
| `ligamentum_flavum` | NEW "LF hypertrophy L4-L5" | ADDED |
| `endplate` | "Modic type 1/2 L4-L5" | EXISTING |
| `spondylolisthesis` | "Grade 1/2 spondylolisthesis L4-L5" | EXISTING |
| `fracture` | "Compression fracture L1" | EXISTING |
| `schmorl` | NEW "Schmorl node L1" | ADDED |
| `hemangioma` | NEW "Vertebral hemangioma L1" | ADDED |
| `alignment` | NEW "Loss of cervical lordosis" | ADDED |
| `fazekas` | "Fazekas 1" / "Fazekas 2" | EXISTING |
| `ventricles` / `hydrocephalus` | "Normal ventricles" / "Hydrocephalus" | EXISTING |
| `infarct` | "Acute infarct (DWI)" | EXISTING |
| `hemorrhage` | "Basal ganglia hemorrhage" / "Acute hemorrhage" | EXISTING |
| `sinus` | "Maxillary sinusitis" | EXISTING |
| `mass` | (not a Quick Select — part of Full Report Format) | COVERED |

## 5. Anatomy-Section Crosswalk

### Brain
| mri-reports concept | Anatomical section (CARE catalog) | Conflict group |
|---|---|---|
| `fazekas`, `wmh`, `svd` | White Matter | `fazekas` |
| `ventricles`, `hydrocephalus` | Ventricular System | `ventricular` / `hydrocephalus` |
| `parenchyma`, `atrophy` | Parenchyma | `parenchyma` / `atrophy` |
| `basal_ganglia`, `infarct`, `hemorrhage` | Basal Ganglia | various |
| `posterior_fossa` | Posterior Fossa | `posterior_fossa` |
| `sella`, `empty_sella` | Sella | `sella` / `empty_sella` |
| `vessels` | Vessels | `vessels` |
| `sinus` | Sinuses | `sinus` |
| `hippocampus` | Mesial Temporal | `hippocampus` |
| `mass`, `dural_tail` | Extra-axial | `mass` / `dural_tail` |

### LS Spine
| mri-reports concept | Anatomical section (CARE catalog) | Conflict group |
|---|---|---|
| `disc_contour`, `disc_signal`, `disc_height` | Intervertebral Disc | `disc_contour` / `disc_signal` / `disc_height` |
| `canal_stenosis`, `canal_ap` | Spinal Canal | `canal_stenosis` / `canal_ap` |
| `foraminal_stenosis` | Neural Foramina | `foraminal_stenosis` |
| `facet_joint` | Facet Joints | `facet_joint` |
| `ligamentum_flavum` | Ligamentum Flavum | `ligamentum_flavum` |
| `vertebrae`, `endplate`, `fracture`, `spondylolisthesis`, `hemangioma`, `schmorl` | Vertebral Bodies | various |
| `conus`, `cord` | Conus & Cauda Equina | `conus` / `cord` |
| `alignment` | Alignment | `alignment` |
| `marrow`, `lesion` | Bone Marrow | `marrow` / `lesion` |

## 6. Technique Crosswalk

| mri-reports technique | CARE technique | Status |
|---|---|---|
| `T.plain` (3T standard) | CARE Brain Plain technique | EXACT MATCH (wording differs slightly; CARE's is more structured) |
| `T.ce` (3T contrast) | CARE Brain Contrast technique | EXACT MATCH |
| `T.epilepsy` (epilepsy protocol) | (not in CARE defaults) | MISSING — low priority |
| `T.ls` (LS spine plain) | CARE LS Spine technique | EXACT MATCH |
| `T.cervical` | CARE Cervical Spine technique | EXACT MATCH |
| `T.dl` (dorsolumbar) | (not in CARE defaults) | MISSING — low priority |
| `T.screening` ("limited sections") | CARE Screening technique ("limited planar and limited sequence") | EXACT MATCH — CARE's wording is clinically safer (§16 screening rule) |

## 7. Wording Conflicts / Unsafe Legacy Phrases

| mri-reports phrase | Issue | CARE resolution |
|---|---|---|
| `T.screening` = "Images are acquired in limited sections." | Too vague — does not explicitly state limited-planar/limited-sequence | CARE uses "limited planar and limited sequence" — clinically safer per §16 |
| `recommendation: "Clinico-pathological correlation."` | "Clinico-pathological" implies histology — radiology reports should say "Clinico-radiological" or "Clinical correlation" | CARE uses "Clinical correlation" — safer |
| `recommendation: "Not for medico-legal purpose."` | Appears on several mri-reports formats — medico-legal disclaimer is a clinic policy decision, not a per-report default | CARE does NOT import this phrase — left to clinic policy |
| `s/o` (abbreviation for "suggestive of") | Outdated SMS-style abbreviation | CARE uses full "suggestive of" or "consistent with" — preserve CARE wording |
| `D/D` (differential diagnosis abbreviation) | Outdated abbreviation | CARE uses "Differential diagnosis:" — preserve CARE wording |

## 8. Comparison with Successful USG Pattern

CARE's USG implementation (built from a similar clinical-format library)
successfully uses:
1. **Full Report Format** for one-tap complete baseline.
2. **Quick Select tiles** for atomic pathology overlays.
3. **Same-slot replacement** via `conflictGroup`.
4. **Auto-compiled impression** from observation ledger.
5. **Manual text protection** via provenance tracking.

The MRI crosswalk follows the same architectural pattern — NO new reporting
engine is created. The Clinical Anatomy Context module is a READ-ONLY
reference catalog that improves the Finding Composer's concept suggestions
without introducing a parallel state model.

## 9. Summary

- **EXACT MATCH**: 7 formats already exist in CARE (Brain Normal, Fazekas 1,
  Fazekas 1+Senile, LS Spine Normal, Cervical Normal, Whole Spine Screening,
  Dorsal Screening).
- **CLOSE MATCH**: 3 formats exist with slightly different wording (CARE's is
  clinically safer — preserved).
- **ADDED**: 7 new Quick Select tiles cross-referenced from mri-reports
  (ligamentum_flavum, foraminal_stenosis, schmorl, hemangioma, loss of
  cervical lordosis, L5-S1 desiccation).
- **MISSING HIGH-VALUE**: Fazekas 2, meningioma (CE), NCC, MS, combined
  LS+screening — documented for future PR.
- **DOCUMENTED for future**: Knee/Shoulder/Elbow/Wrist/Hip/SI/Ankle joints.
- **NO new DB schema. NO new reporting engine. NO parallel state model.**
