# WALKTHROUGH: Phase 3 — Measurement Wiring + Protocol QA Checklist

**Date:** June 27, 2026  
**Commit:** c2e20c93  
**Tag:** phase3/measurement-qa-v1  
**Restore point:** checkpoint/before-phase3-measurements  

---

## What I inspected before writing code

**`MeasurementAssistantPanel.tsx`** (574 lines) — Already complete:
- MRI Brain measurements: 22 fields (Frontal Horn Width, Midline Shift, Pituitary, Optic Nerve Sheath, Evans Index, tumour 3-axis, hematoma ABC/2, etc.)
- MRI Spine: 17 fields (AP canal, foraminal, disc height, Cobb angle, spondylolisthesis, conus level)
- Smart calculations already implemented: Evans Index, tumour volume (L×W×H×0.523), hematoma ABC/2, spondylolisthesis grade, EFW (Hadlock), Doppler RI/SD/PI
- Save to `/api/radiology-lesions/measurements` already working
- History view already working
- Voice command parser already wired
- `onMeasurementsChange` callback existed but **was never called in `RadiologyCommandCenter.tsx`**

**`RadiologyCommandCenter.tsx`** measurements tab:
- `MeasurementAssistantPanel` rendered with `patientId`, `studyId`, `modality`, `bodyPart`
- `onMeasurementsChange` prop not passed — measurements compiled internally but **never reached the findings draft**

**Phase 1 infrastructure** (fully available):
- `mri_protocol_specs` table seeded with 7 protocols
- Each protocol has `quality_checklist` JSON array (7–8 items per brain protocol)
- API endpoint `GET /api/radiology/report-generator/protocols/:key` already live
- API endpoint `POST /api/radiology/report-generator/protocols/quality-result` already live

---

## Files Changed

### 1. `ProtocolQAChecklist.tsx` (NEW — 271 lines)

Self-contained QA checklist component. Uses Phase 1 API entirely.

**Data flow:**
```
Component receives protocolKey (e.g. "MRI_BRAIN_PLAIN")
    ↓
GET /api/radiology/report-generator/protocols/MRI_BRAIN_PLAIN
    ↓ returns: { protocol: { id, qualityChecklist: [{id, label, description, failAction}, ...] } }
Render each checklist item with Pass / Fail / N/A buttons
    ↓
Radiologist ticks each item
    ↓
Compute overallGrade:
  - Any reject item failed → "non-diagnostic"
  - Any warn item failed  → "suboptimal"
  - All pass or N/A       → "acceptable"
    ↓
Click "Save QA"
    ↓
POST /api/radiology/report-generator/protocols/quality-result
  { studyId, protocolId, results: {item_id: "pass"|"fail"|"na"}, overallGrade }
    ↓ Saved to mri_protocol_quality_results table
```

**QA items for MRI Brain Plain (7 items):**

| Item | Fail action |
|---|---|
| No significant motion artifact | reject |
| SNR adequate | warn |
| Coverage foramen magnum to vertex | reject |
| All 6 sequences present | warn |
| FLAIR CSF suppression adequate | reject |
| DWI and ADC map both present | reject |
| SWI assessable | note |

**Fail action behaviour:**
- `reject` → red warning "Study may be non-diagnostic — consider repeating sequence"
- `warn` → counts toward "suboptimal" grade
- `note` → informational only, no grade impact

**Collapsible:** header shows pass/fail count. Collapses to save vertical space.

**Returns null** when:
- `protocolKey` is undefined (non-MRI study)
- API returns 404 (no protocol spec for this key)
- `qualityChecklist` is empty

---

### 2. `RadiologyCommandCenter.tsx` (MODIFIED)

**Change 1 — ProtocolQAChecklist rendered above measurements (MRI only):**

```tsx
{study.modality?.toUpperCase() === "MRI" && (
  <ProtocolQAChecklist
    studyId={study.studyId ?? study.id}
    protocolKey={(() => {
      const bp = (study.bodyPart || study.studyDescription || "").toUpperCase();
      if (bp.includes("BRAIN") || bp.includes("HEAD"))    return "MRI_BRAIN_PLAIN";
      if (bp.includes("STROKE") || bp.includes("CVA"))    return "MRI_STROKE_PROTOCOL";
      if (bp.includes("CERV"))                            return "MRI_CERVICAL_SPINE";
      if (bp.includes("LS") || bp.includes("LUMBAR"))     return "MRI_LS_SPINE";
      if (bp.includes("DORSAL") || bp.includes("THORAC")) return "MRI_DORSAL_SPINE";
      if (bp.includes("SPINE"))                           return "MRI_LS_SPINE";
      if (bp.includes("KNEE"))                            return "MRI_KNEE";
      return "MRI_BRAIN_PLAIN";  // default
    })()}
    completedBy={readStaffSession()?.subjectName ?? "unknown"}
  />
)}
```

**Change 2 — `onMeasurementsChange` now wired to findings draft:**

```tsx
<MeasurementAssistantPanel
  patientId={study.patientId ?? undefined}
  studyId={study.studyId ?? undefined}
  modality={study.modality}
  bodyPart={study.bodyPart ?? undefined}
  onMeasurementsChange={(compiledText) => {
    setRawFindings((prev) => {
      const MARKER = "MEASUREMENTS LOG:";
      const idx = prev.indexOf(MARKER);
      if (idx !== -1) {
        // Replace existing block (idempotent)
        return prev.slice(0, idx).trimEnd() + (prev ? "\n\n" : "") + compiledText;
      }
      // Append after existing findings
      return prev ? prev.trimEnd() + "\n\n" + compiledText : compiledText;
    });
  }}
/>
```

The `compiledText` from `MeasurementAssistantPanel` looks like:
```
MEASUREMENTS LOG:
- Frontal Horn Width: 18 mm
- Third Ventricle Width: 5 mm
- Midline Shift: 2 mm
- Calculated Evans Index: 0.28 (normal)
```

This block is replaced (not duplicated) every time a measurement value changes.

---

## What Dr. Abinash sees in the measurements tab

**For an MRI Brain study:**

```
┌─────────────────────────────────────────────────────┐
│  Protocol QA Checklist    MRI Brain Plain  ▼  2 fail│
├─────────────────────────────────────────────────────┤
│  No significant motion artifact     [Reject]         │
│  [Pass] [Fail] [N/A]                                │
│                                                     │
│  FLAIR CSF suppression adequate     [Reject]         │
│  [Pass] [Fail] [N/A]                                │
│  ⚠ Study may be non-diagnostic                      │
│                                                     │
│  DWI and ADC map both present       [Reject]         │
│  [Pass] [Fail] [N/A]                                │
│                                                     │
│  ...                                                │
│                                                     │
│  Overall: Non-Diagnostic              [Save QA]     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Measurement Assistant                              │
│  [MRI Brain ▾]                                      │
│  Frontal Horn Width:  [18    ] mm  ✓                │
│  Third Ventricle Width: [5   ] mm  ✓                │
│  Midline Shift:       [0     ] mm  ✓                │
│  Evans Index: 0.28 (calculated)                     │
│  ...                                                │
│  [Save Measurements]                                │
└─────────────────────────────────────────────────────┘
```

Simultaneously, in the findings text area:
```
[whatever the radiologist typed previously]

MEASUREMENTS LOG:
- Frontal Horn Width: 18 mm
- Third Ventricle Width: 5 mm
- Calculated Evans Index: 0.28 (Evans Index > 0.3 indicates ventriculomegaly)
```

---

## What was reused (nothing duplicated)

| Existing | Phase 3 uses |
|---|---|
| `mri_protocol_specs` table (Phase 1) | `ProtocolQAChecklist` reads quality_checklist from it |
| `GET /protocols/:key` endpoint (Phase 1) | `ProtocolQAChecklist` fetches protocol spec |
| `POST /protocols/quality-result` endpoint (Phase 1) | `ProtocolQAChecklist` saves QA results |
| `mri_protocol_quality_results` table (Phase 1) | QA results stored here |
| `MeasurementAssistantPanel` component | Unchanged — just wired its callback |
| `setRawFindings` state in RCC | Receives measurement text |
| `onMeasurementsChange` prop | Was already defined, now actually called |

---

## No breaking changes

- `ProtocolQAChecklist` is additive — returns `null` for non-MRI, missing protocol, empty checklist
- `onMeasurementsChange` was an optional prop — passing it does not change existing save behaviour
- The `MEASUREMENTS LOG:` block replaces itself on re-render — no duplication
- Tab count: still 8 (`grid-cols-8`)
- No new API routes, no schema changes, no migration required

---

## Phase 4 Preparation

Phase 4 (Lesion Comparison View — 2 weeks):
- **Entry point:** `artifacts/diagnostic-erp/src/pages/RadiologyCommandCenter.tsx` — Tab 6 `prior-studies` already exists
- **Table:** `radiologyLesions`, `radiologyMeasurements` — already exist
- **API:** `/api/radiology-lesions` — already exists with history endpoint
- **What to build:**
  - `LesionComparisonPanel.tsx` — side-by-side lesion size comparison across prior studies
  - Fetch prior study measurements from `/api/radiology-lesions/measurements?patientId=X`
  - Group by label, compute delta, show progression/regression
  - Insert comparison summary into findings text
- **Migration needed:** None (all tables already exist)

**Phase 3 Status: ✅ COMPLETE**  
**Next:** Phase 4 — Lesion Comparison View  
