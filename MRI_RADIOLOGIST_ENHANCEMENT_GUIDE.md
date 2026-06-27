# MRI Radiologist Reporting Enhancement Guide

**For:** Dr. Abinash (Radiologist)  
**Date:** June 27, 2026  
**Purpose:** Detailed technical guide for leveraging & enhancing MRI reporting capabilities

---

## PART 1: CURRENT SYSTEM CAPABILITIES

### What's Already Built ✅

#### 1. MRI Brain Templates
**Location:** `artifacts/api-server/src/routes/radiology-report-generator.ts`

Current templates:
```typescript
MRI_BRAIN_PLAIN: {
  modality: "MRI",
  technique: "Multiplanar multisequence MRI of the brain...",
  sections: [
    "Sequences and Technique",
    "Brain Parenchyma",
    "Ventricular System",
    "Cranial Nerves",
    "Vascular Assessment",
    "Enhancement Pattern",
    "Impression"
  ]
}

MRI_BRAIN_CONTRAST: {
  modality: "MRI",
  technique: "Pre- and post-contrast T1W imaging...",
  sections: [
    "Sequences and Technique",
    "Brain Parenchyma",
    "Gd Enhancement",
    "White Matter Changes",
    "Posterior Fossa",
    "Impression"
  ]
}
```

#### 2. MRI Spine Templates
**Variants:**
- `MRI_SPINE_CERVICAL` — C1-C7 protocol
- `MRI_SPINE_LS` — Lumbar-Sacral L1-S1
- `MRI_SPINE_THORACIC` — T1-T12

#### 3. AI Impression Generation
**Supported Providers:**
```typescript
✓ Ollama (local, uncapped)
  - gpt-oss:20b
  - gemma3:12b

✓ OpenAI
  - gpt-4o (vision capable)
  - gpt-4-turbo

✓ Google Gemini
  - gemini-2.0-flash
  - gemini-1.5-pro

✓ Anthropic Claude
  - claude-3-5-sonnet-20241022
```

**How it works:**
1. Radiologist types findings in dictation pane
2. Click "Generate Impression" → AI processes text
3. System sends to configured provider
4. Response appears in editor for review
5. Radiologist edits, verifies, signs

#### 4. Smart Findings Extraction
**File:** `artifacts/api-server/src/routes/radiologySmartFindings.ts`

Automatically identifies key findings from your dictation:
```
INPUT:  "Brain MRI shows acute right MCA territory infarct with FLAIR 
         hyperintensity and restricted diffusion on DWI. Old lacunar infarcts 
         in bilateral basal ganglia. Ventricular system normal. No mass effect."

OUTPUT: [
  {
    finding: "Acute infarct right MCA territory",
    modality: "MRI_BRAIN",
    severity: "high",
    actionable: true
  },
  {
    finding: "Old lacunar infarcts bilateral basal ganglia",
    severity: "low",
    actionable: false
  }
]
```

#### 5. Lesion Tracking System
**Tables:**
- `radiologyLesions` — Master lesion records
- `radiologyAnnotations` — Image markup coordinates
- `radiologyMeasurements` — Quantitative tracking

**Capabilities:**
- Multi-study lesion comparison
- Measurement evolution timeline
- Follow-up interval tracking
- Regression/progression scoring

#### 6. Key Image & Annotation
**File:** `artifacts/api-server/src/routes/radiology-report-generator.ts`

- Upload key images during reporting
- Tag with anatomic location
- Link measurements to images
- Auto-include in final PDF

---

## PART 2: SEQUENCE-SPECIFIC PROTOCOLS

### Brain MRI Standard Protocol

#### What Should Be Documented:

**1. CONVENTIONAL SEQUENCES:**
```
T1-weighted Sagittal (Localizer)
├── TR/TE: 500/20 ms
├── Slice thickness: 5 mm
├── Gap: 1 mm
└── Uses: Anatomic reference

T2-weighted Axial
├── TR/TE: 4000-5000/100-120 ms
├── Slice thickness: 5 mm
├── Coverage: Foramen magnum to vertex
└── Detects: Edema, hypersignal, pathology

FLAIR Axial (Fluid-Attenuated Inversion Recovery)
├── TR/TE/TI: 8000-9000/120/2300 ms
├── Slice thickness: 5 mm
├── Uses: White matter disease, subtle edema, cortical lesions
├── Suppresses: CSF signal
└── Key for: MS, small infarcts, TBI

Gradient Echo (GRE) / SWI (Susceptibility-Weighted)
├── Detects: Microhemorrhages, calcifications, iron deposition
├── Uses: Vascular pathology, trauma, Parkinson's
└── Sensitivity: Excellent for bleed detection
```

**2. DIFFUSION SEQUENCES:**
```
DWI (Diffusion-Weighted Imaging) Axial
├── b-values: 1000 (primary)
├── ADC (Apparent Diffusion Coefficient) map
├── Restriction = bright on DWI, dark on ADC
├── Uses: Acute stroke, tumors, infection
└── Timing: Must read <24 hours for acute infarct

DTI (Diffusion Tensor Imaging) - Optional
├── Provides: Fractional anisotropy (FA)
├── Uses: White matter tract integrity
├── Research/specialized: Less routine
```

**3. PERFUSION:**
```
MR Perfusion (if available)
├── PWI (Perfusion-Weighted Imaging)
├── Provides: CBF, CBV, MTT maps
├── Clinical use: Ischemic penumbra, tumor grading
├── Timing: Usually with contrast bolus
```

**4. VASCULAR:**
```
MRA Brain (Magnetic Resonance Angiography)
├── TOF (Time-of-flight) - non-contrast
├── Coverage: Circle of Willis + major branches
├── Detects: Stenosis, occlusion, aneurysm
├── Sensitivity: Good for proximal large vessels

Contrast-Enhanced MRA (if available)
├── Better for distal vessels
├── Timing: Arterial phase critical
```

**5. CONTRAST-ENHANCED SEQUENCES:**
```
Post-Gd T1-weighted
├── Agent: Gadolinium-DTPA, 0.1 mmol/kg IV
├── Timing: 5-10 minutes post-injection
├── Uses: BBB disruption, inflammation, tumors
├── Enhancement patterns:
   - Ring enhancement: Tumor, abscess
   - Homogeneous: Meningioma, benign
   - Nodular: Metastasis
   - Leptomeningeal: Meningitis, carcinomatosis
```

---

### Current System's Handling

**Template includes:** "Sequences and Technique" section  
**Gap:** Doesn't specify parameter expectations

**Enhancement Needed:** Add sequence specification to template

---

## PART 3: KEY FINDING CATEGORIES FOR MRI BRAIN

### Checklist for Structured Reporting

#### 1. PARENCHYMA
```
Normal findings:
✓ Gray matter/white matter differentiation preserved
✓ Cortical signal normal
✓ Basal ganglia symmetric
✓ Thalami unremarkable

Pathologic findings to document:
✗ Edema (T2/FLAIR hyperintensity)
✗ Infarction (restricted diffusion, territory-specific)
✗ Hemorrhage (T2 hypointensity, SWI blooming)
✗ Mass (T1/T2 characteristics, enhancement pattern)
✗ White matter disease (FLAIR hyperintensity, extent)
✗ Atrophy (cortical sulci, ventricular size)
```

#### 2. VENTRICULAR SYSTEM
```
Dimensions:
- Frontal horn width: Normal <20 mm
- Temporal horn: Should not be visible if normal
- Third ventricle: 5-8 mm
- Fourth ventricle: 8-12 mm

Abnormalities:
✗ Hydrocephalus (enlarged ventricles, transependymal edema)
✗ Obstruction (location? level?)
✗ Asymmetry (mass effect?)
```

#### 3. SUBARACHNOID SPACES
```
Observe:
- Basilar cisterns (patent or obscured?)
- Sylvian fissures (symmetric?)
- Interhemispheric space
- Cortical sulci prominence

Abnormal findings:
✗ Subarachnoid hemorrhage (hyperdense on CT, hyperintense on FLAIR)
✗ Subdural hematoma (crescent-shaped collection)
✗ Cerebrospinal fluid obstruction
```

#### 4. MAJOR VASCULATURE
```
Standard reporting:
- Circle of Willis (complete, partial, variant)
- ICA/MCA/ACA/PCA (patent)
- Vertebral arteries (caliber, patency)
- Basilar artery (patent, atherosclerosis)

Special attention:
✗ Occlusion (where? acute vs. chronic?)
✗ Stenosis (degree? hemodynamically significant?)
✗ Dissection (intimal flap, pearl sign)
✗ Aneurysm (size, location, flow void)
✗ Arteriovenous malformation (feeders, drains)
```

#### 5. MENINGES & DURA
```
Normal state:
✓ Dura intact
✓ Arachnoid clean

Abnormal findings:
✗ Dural enhancement (meningitis, subdural hematoma)
✗ Subdural space fluid (hemorrhage vs. hygroma)
✗ Subdural empyema
```

#### 6. ENHANCEMENT PATTERN (Post-Gd)
```
Key observations:
- Normal: Minimal enhancement (dural, choroid plexus only)
- BBB disruption indicates:
  → Tumor
  → Infection/inflammation
  → Infarction (if acute)
  → Trauma (if severe)

Document:
✗ Location of enhancement
✗ Pattern: Rim, ring, homogeneous, nodular, linear
✗ Intensity: Subtle, moderate, intense
✗ Timing behavior (early vs. delayed)
```

#### 7. SKULL & OSSEOUS
```
Incidental findings:
- Fractures (description, location)
- Abnormal signal (marrow replacement, neoplasm)
- Sinus disease (name the sinuses involved)
```

---

## PART 4: TECHNICAL IMPLEMENTATION ROADMAP

### Phase 1: Protocol Documentation (IMMEDIATE - 1 week)

**File to create:** `lib/db/src/schema/mriProtocolSpecs.ts`

```typescript
export const MRI_BRAIN_PROTOCOLS = {
  standard_plain: {
    name: "MRI Brain Plain",
    indications: [
      "Headache, migraine, neuro complaint",
      "TIA workup",
      "Epilepsy",
      "Cognitive changes"
    ],
    sequences: [
      {
        name: "T1 Sagittal",
        technique: "Localizer, 3D acquisition",
        tr_ms: 500,
        te_ms: 20,
        slice_mm: 5,
        gap_mm: 1,
        purpose: "Anatomic reference"
      },
      {
        name: "T2 Axial",
        technique: "Fast spin echo",
        tr_ms: 4500,
        te_ms: 110,
        slice_mm: 5,
        purpose: "Detect edema, signal abnormality"
      },
      {
        name: "FLAIR Axial",
        technique: "Inversion recovery",
        tr_ms: 8500,
        te_ms: 120,
        ti_ms: 2300,
        slice_mm: 5,
        purpose: "White matter disease, subtle edema, cortical lesions"
      },
      {
        name: "DWI Axial",
        technique: "Echo-planar, b=1000",
        purpose: "Acute infarction, tumor, infection",
        includes_adc: true
      },
      {
        name: "GRE/SWI Axial",
        technique: "Gradient echo, susceptibility",
        purpose: "Microhemorrhage, calcification, iron"
      },
      {
        name: "MRA TOF",
        technique: "Non-contrast angiography",
        purpose: "Vascular anatomy, stenosis, occlusion"
      }
    ],
    quality_checklist: [
      "No motion artifact",
      "Adequate signal-to-noise",
      "Coverage foramen magnum to vertex",
      "Sequences match protocol",
      "All sequences acquired"
    ]
  },

  with_contrast: {
    name: "MRI Brain with Contrast",
    // ... similar structure, includes post-Gd T1
  }
};
```

**Update report templates:**

```typescript
// In radiology-report-generator.ts

MRI_BRAIN_PLAIN: {
  templateId: "MRI_BRAIN_PLAIN",
  modality: "MRI",
  studyName: "MRI BRAIN PLAIN",
  protocolId: "standard_plain",  // NEW
  
  technique: `
    Multiplanar multisequence MRI of the brain performed without contrast.
    
    SEQUENCES ACQUIRED:
    • T1-weighted sagittal scout
    • T2-weighted axial FSE
    • FLAIR axial inversion recovery (TR/TE/TI: 8500/120/2300)
    • DWI axial echo-planar (b=1000) with ADC
    • Gradient echo (susceptibility) axial
    • MR angiography TOF (Circle of Willis)
    
    TECHNIQUE NOTES:
    - 5mm slice thickness with 1mm gap
    - Coverage: Foramen magnum to vertex
    - Standard field strength: 1.5T or 3T
    - Total scan time: ~30-35 minutes
  `,
  
  sections: [
    "Quality Assessment",
    "Brain Parenchyma",
    "Ventricular System & Subarachnoid Spaces",
    "Vasculature",
    "Meninges & Extraaxial Spaces",
    "Osseous & Incidental Findings",
    "Impression"
  ]
}
```

### Phase 2: Measurement Integration (1-2 weeks)

**File:** `artifacts/diagnostic-erp/src/components/MRIBrainMeasurements.tsx`

```typescript
import React from 'react';

export const MRIBrainMeasurements = () => {
  // Quick measurement buttons integrated in reporting interface
  
  const BRAIN_MEASUREMENTS = [
    {
      id: "frontal_horn",
      name: "Frontal Horn Width",
      normal_max_mm: 20,
      instructions: "Measure widest distance between frontal horns"
    },
    {
      id: "temporal_horn",
      name: "Temporal Horn Size",
      normal_max_mm: "Should not be visible",
      instructions: "If visible, measure oblique distance"
    },
    {
      id: "third_ventricle",
      name: "Third Ventricle Width",
      normal_range_mm: "5-8",
      instructions: "Transverse measurement at widest point"
    },
    {
      id: "mri_lesion_size",
      name: "Lesion Dimensions",
      format: "mm x mm x mm (AP x TR x SI)",
      instructions: "Measure largest axis in 3 planes"
    }
  ];

  return (
    <div className="mri-measurements-panel">
      {BRAIN_MEASUREMENTS.map(m => (
        <MeasurementButton key={m.id} measurement={m} />
      ))}
    </div>
  );
};
```

### Phase 3: Neuro-Specific AI Prompts (1 week)

**File:** `lib/db/src/schema/radiologyPromptsTable.ts`

Add pre-built prompts:

```typescript
export const NEURO_AI_PROMPTS = [
  {
    name: "Standard Brain Impression",
    modality: "MRI_BRAIN",
    content: `You are a senior neuroradiologist. Based on the findings below, 
             generate a concise, clinically-relevant IMPRESSION. 
             Include:
             1. Primary pathology (or "No acute abnormality")
             2. Differential diagnosis if applicable
             3. Recommendation for follow-up
             Keep to 3-5 lines. Use standard neuro terminology.
             
             Findings:`,
    category: "standard"
  },
  
  {
    name: "Acute Stroke Protocol",
    modality: "MRI_BRAIN",
    content: `Given these DWI/ADC findings, describe:
             1. Location and size of restricted diffusion
             2. Arterial territory (MCA, ACA, PCA, etc.)
             3. Corresponding perfusion abnormality if present
             4. Age of infarct (acute, subacute, chronic)
             5. Eligibility for thrombolysis based on timing
             Keep clinical urgency evident.
             
             Findings:`,
    category: "stroke"
  },
  
  {
    name: "Tumor Assessment",
    modality: "MRI_BRAIN",
    content: `For this mass/lesion:
             1. Exact location (anatomic detail)
             2. Size in mm (3 axes)
             3. T1/T2 characteristics
             4. Enhancement pattern
             5. Differential diagnosis (primary vs. metastatic)
             6. Degree of mass effect
             7. Recommendation (biopsy, staging, follow-up)
             
             Findings:`,
    category: "oncology"
  },
  
  {
    name: "White Matter Disease",
    modality: "MRI_BRAIN",
    content: `Describe white matter abnormalities:
             1. Distribution (periventricular, subcortical, mixed)
             2. Extent (minimal, moderate, extensive)
             3. FLAIR signal characteristics
             4. Associated atrophy
             5. Differential (demyelinating, ischemic, infectious)
             6. Correlation with clinical symptoms
             
             Findings:`,
    category: "degen"
  }
];
```

**Frontend Integration:**

```typescript
// In RadiologyCommandCenter.tsx

const handleLoadPrompt = async (promptId: string) => {
  const prompt = await queryClient.fetchQuery({
    queryKey: ['neuroPrompt', promptId],
    queryFn: () => api.get(`/radiology/prompts/${promptId}`)
  });
  
  // Auto-populate AI prompt field
  setAiPromptField(prompt.content);
  
  // User clicks "Generate" → AI uses this prompt
};
```

### Phase 4: Lesion Comparison Interface (2 weeks)

**File:** `artifacts/diagnostic-erp/src/components/LesionComparisonView.tsx`

```typescript
export const LesionComparisonView = () => {
  // Show current study + prior study side-by-side
  // Overlay measurements
  // Track size changes
  // Suggest progression/regression
  
  return (
    <div className="lesion-comparison">
      <div className="current-study">
        <h3>Current Study</h3>
        <DicomViewer studyId={currentStudyId} />
        <LesionMeasurements studyId={currentStudyId} />
      </div>
      
      <div className="prior-study">
        <h3>Prior Study ({priorDate})</h3>
        <DicomViewer studyId={priorStudyId} />
        <LesionMeasurements studyId={priorStudyId} />
      </div>
      
      <div className="comparison-metrics">
        <EvolutionTimeline lesionId={selectedLesionId} />
        <ChangeCalculator current={currentMeasurement} prior={priorMeasurement} />
      </div>
    </div>
  );
};
```

### Phase 5: Reporting Analytics (1 week)

**Database Schema:**

```typescript
export const radiologyReportingAnalyticsTable = pgTable("radiology_reporting_analytics", {
  id: serial("id").primaryKey(),
  radiologistId: integer("radiologist_id").notNull(),
  modality: text("modality").notNull(), // MRI_BRAIN, MRI_SPINE, etc.
  studyDate: date("study_date").notNull(),
  
  // Timing metrics
  reportStartTime: timestamp("report_start_time", { withTimezone: true }),
  reportEndTime: timestamp("report_end_time", { withTimezone: true }),
  reportDurationMinutes: integer("report_duration_minutes"),
  
  // AI assistance metrics
  aiRequestCount: integer("ai_request_count").default(0),
  aiRequestsApproved: integer("ai_requests_approved").default(0),
  aiEditsCount: integer("ai_edits_count").default(0), // Lines radiologist changed
  
  // Report content metrics
  impressionLength: integer("impression_length"), // Character count
  findingsCount: integer("findings_count"),
  measurementsCount: integer("measurements_count"),
  keyImagesCount: integer("key_images_count"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Dashboard for Dr. Abinash:**

```
MRI BRAIN REPORTING ANALYTICS (Weekly View)

Total Studies: 28
Average Report Time: 12.5 minutes
AI Usage: 85% of reports used assistance

Finding Categories (This Week):
├── Acute Infarction: 3 studies
├── Chronic Ischemia: 5 studies
├── Tumor: 2 studies
├── White Matter Disease: 8 studies
├── Normal: 10 studies

AI Impression Approval Rate: 92%
  (% of AI-generated impressions you approved as-is)

Most Used AI Provider: Ollama (local)
Average Edits per Report: 1.2 lines

Follow-up Recommendations: 14 studies (50%)
  Critical findings requiring urgent follow-up: 2
```

---

## PART 5: RADIOLOGIST WORKFLOW OPTIMIZATION

### Ideal MRI Reporting Workflow

```
STEP 1: Study Appears in Worklist
        ↓
STEP 2: Click "Report" → Load MRI Brain Plain template
        ↓
STEP 3: Verify Protocol Quality
        - Check all 6 sequences acquired
        - Assess motion artifact, signal-to-noise
        - Mark in "Quality Assessment" section
        ↓
STEP 4: Review DICOM Images
        - Open in OHIF viewer (3D rendering)
        - Scroll through all sequences
        - Identify abnormalities
        ↓
STEP 5: Perform Quick Measurements (if indicated)
        - Click "Measure Frontal Horns" → Draw line on image
        - Auto-populates table with value + normal range
        - Repeat for any other critical measurements
        ↓
STEP 6: Dictate Findings
        - Use template structure (Parenchyma → Ventricles → Vasculature, etc.)
        - Dictation auto-transcribed by speech-to-text
        ↓
STEP 7: AI-Assisted Impression
        - Click "Generate Impression"
        - Select prompt (Standard Brain / Acute Stroke / Tumor / etc.)
        - AI generates draft impression
        ↓
STEP 8: Review & Edit AI Output
        - Highlight any AI text you modify
        - System tracks "AI edits" for QA
        ↓
STEP 9: Add Key Images
        - Select 1-3 representative images from viewer
        - Annotate with arrow/circle to highlight finding
        - Link to measurements if applicable
        ↓
STEP 10: Final Review
         - Read entire report
         - Check finding codes/terminology
         - Verify no contradictions
         ↓
STEP 11: Sign & Archive
         - Click "Sign Report"
         - Auto-generates PDF
         - Sends to PACS archive
         - Email to referring physician
         - SMS alert to patient (if configured)
```

---

## PART 6: DATABASE QUERIES FOR REPORTING INSIGHTS

### SQL Queries for Analytics

**Find all MRI Brain studies you signed this week:**

```sql
SELECT 
  rs.id,
  rs.accessionNumber,
  p.firstName || ' ' || p.lastName as patientName,
  rs.studyDate,
  rs.finalReportedAt,
  EXTRACT(EPOCH FROM (rs.finalReportedAt - rs.createdAt)) / 60 as reportMinutes,
  sf.findingCount,
  rm.measurementCount
FROM radiologyStudies rs
JOIN patients p ON rs.patientId = p.id
LEFT JOIN radiologySmartFindings sf ON sf.studyId = rs.id
LEFT JOIN radiologyMeasurements rm ON rm.studyId = rs.id
WHERE rs.modality = 'MRI'
  AND rs.bodyPart = 'BRAIN'
  AND rs.finalReportedBy = 'Dr. Abinash'
  AND rs.finalReportedAt >= NOW() - INTERVAL '7 days'
ORDER BY rs.finalReportedAt DESC;
```

**Compare lesion sizes across studies:**

```sql
SELECT 
  rl.id,
  rl.lesionName,
  rs1.studyDate as currentDate,
  rm1.measurementValue as currentSizeMm,
  rs2.studyDate as priorDate,
  rm2.measurementValue as priorSizeMm,
  ROUND((
    (CAST(rm1.measurementValue AS FLOAT) - CAST(rm2.measurementValue AS FLOAT)) 
    / CAST(rm2.measurementValue AS FLOAT) * 100
  )::numeric, 1) as percentChange
FROM radiologyLesions rl
JOIN radiologyMeasurements rm1 ON rm1.lesionId = rl.id AND rm1.isLatest = true
JOIN radiologyStudies rs1 ON rs1.id = rm1.studyId
JOIN radiologyMeasurements rm2 ON rm2.lesionId = rl.id AND rm2.isSeries = true
JOIN radiologyStudies rs2 ON rs2.id = rm2.studyId
WHERE rl.patientId = :patientId
  AND rl.modalityType = 'MRI_BRAIN'
ORDER BY rs1.studyDate DESC;
```

**AI assistance usage pattern:**

```sql
SELECT 
  DATE(rra.reportDate) as reportDate,
  COUNT(DISTINCT rra.studyId) as totalReports,
  COUNT(DISTINCT CASE WHEN rra.aiAssistanceUsed THEN rra.studyId END) 
    as reportsWithAI,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN rra.aiAssistanceUsed THEN rra.studyId END)
    / COUNT(DISTINCT rra.studyId),
    1
  ) as aiUsagePercent,
  COUNT(DISTINCT rra.aiProvider) as providersUsed
FROM radiologyReportingAnalytics rra
WHERE rra.radiologistId = :radiologistId
  AND rra.modality = 'MRI_BRAIN'
GROUP BY DATE(rra.reportDate)
ORDER BY reportDate DESC
LIMIT 30;
```

---

## PART 7: QUICK REFERENCE FOR COMMON FINDINGS

### MRI Brain Finding Codes & Descriptions

**Acute Infarction:**
```
Finding: Acute ischemic stroke (specify territory)
Code: I63.* (ICD-10)
AI Prompt: "Acute Stroke Protocol"
Required: Location, size, DWI confirmation, eligibility for thrombectomy
```

**Tumor (Malignant):**
```
Finding: Brain mass (primary vs. metastatic)
Code: C71.* or C79.31 (secondary)
AI Prompt: "Tumor Assessment"
Required: Size, location, enhancement, edema, mass effect, hemorrhage
```

**White Matter Disease:**
```
Finding: Leukoaraiosis / Chronic ischemic changes
Code: G89.29 (if symptomatic)
AI Prompt: "White Matter Disease"
Required: Extent, distribution, correlation with symptoms
```

**Hemorrhage (Intracerebral):**
```
Finding: ICH (specify lobar vs. basal ganglia vs. brainstem)
Code: I61.* (intracerebral)
AI Prompt: "Acute Hemorrhage Assessment"
Required: Size, location, mass effect, IVH presence
```

---

## PART 8: IMPLEMENTATION TIMELINE

### Week 1: Foundation
- [ ] Review existing templates
- [ ] Create MRI protocol specifications table
- [ ] Update report templates with protocol details
- [ ] Run git checkpoint: `git tag -a protocol-docs-v1`

### Week 2: AI Enhancement
- [ ] Add neuro-specific AI prompts to database
- [ ] Test with each provider (Ollama, OpenAI, Gemini)
- [ ] Verify prompt quality with sample studies
- [ ] Create prompt library UI in portal

### Week 3: Measurements
- [ ] Implement brain measurement components
- [ ] Integrate with DICOM viewer (OHIF)
- [ ] Add measurement validation (normal ranges)
- [ ] Test with actual patient scans

### Week 4: Comparison View
- [ ] Build lesion comparison interface
- [ ] Implement evolution timeline visualization
- [ ] Add progression/regression scoring
- [ ] Train yourself on new UI

### Week 5: Analytics
- [ ] Deploy reporting analytics tables
- [ ] Build dashboard for personal metrics
- [ ] Configure alerts for critical findings
- [ ] Set up weekly performance reports

### Week 6: Optimization
- [ ] Gather your feedback on workflows
- [ ] Fine-tune prompts based on usage
- [ ] Optimize measurement defaults per lesion type
- [ ] Create specialized templates for your cases

---

## PART 9: TESTING CHECKLIST

Before going live with enhanced reporting:

### Functional Testing
- [ ] All MRI Brain templates load without errors
- [ ] Protocol specifications display correctly
- [ ] Measurements calculate and validate properly
- [ ] AI prompts integrate smoothly
- [ ] Lesion comparison renders correctly
- [ ] Key images upload and link properly
- [ ] Report PDF generation includes all sections
- [ ] Analytics data captures accurately

### Clinical Testing
- [ ] Test with 10 actual MRI Brain studies
- [ ] Verify all findings can be documented
- [ ] Confirm measurements are clinically accurate
- [ ] Ensure AI impressions are acceptable with minimal edits
- [ ] Check that follow-up recommendations appear appropriate
- [ ] Validate that reports match your normal standard

### Performance Testing
- [ ] Average report time < 15 minutes
- [ ] No lag when scrolling DICOM images
- [ ] Measurements respond instantly
- [ ] AI response time < 30 seconds
- [ ] PDF generation < 5 seconds
- [ ] Database queries complete within 2 seconds

### Integration Testing
- [ ] Reports successfully archive to Orthanc
- [ ] PDFs send to referring physicians
- [ ] Patient notifications work
- [ ] Audit logs capture all actions
- [ ] No financial system interference
- [ ] Backup/restore includes new tables

---

## PART 10: SUPPORT & ESCALATION

### If Something Breaks

1. **Can't generate impression (AI error)**
   ```
   Check: /api/radiology/smart-engine endpoint status
   Try: Different AI provider (switch Ollama → OpenAI)
   Contact: Tech team with error message
   ```

2. **Measurements not saving**
   ```
   Check: Network connection
   Verify: Study ID is correct
   Clear: Browser cache
   Report: Screenshot + study accession number
   ```

3. **Template won't load**
   ```
   Clear: Application cache
   Hard refresh: Ctrl+Shift+R
   Try: Different browser
   Report: Browser console error (F12)
   ```

4. **Report won't sign**
   ```
   Check: All required sections filled
   Verify: No validation errors shown
   Wait: 30 seconds (might be saving draft)
   Report: Error message text
   ```

### Emergency Hotline
- **Backend API Issues:** Check `artifacts/api-server/logs/`
- **DICOM Viewer Issues:** Check OHIF health status
- **Database Issues:** Check PostgreSQL connection

---

## CONCLUSION

Your MRI reporting system already has:
✅ Professional templates
✅ Multi-provider AI assistance  
✅ Lesion tracking
✅ Key image integration
✅ Comprehensive audit trails

**Next step:** Implement the 5 enhancements above to create a world-class neuroradiology reporting platform.

**Expected outcome:** 
- Report time: 12-15 minutes (vs. 18-20 manual)
- AI assistance approval rate: >90%
- Follow-up compliance: Improved with automated suggestions
- Audit trail: Complete for every report

---

**Document created:** June 27, 2026  
**For:** Dr. Abinash, Radiologist  
**Next review:** After implementation of Phase 1

