// ── Phase 6: Follow-Up Recommendation Engine ──
// Condition-based follow-up recommendations. NO AI.
// Deterministic, rule-based. User must explicitly insert.

export interface FollowUpRecommendation {
  condition: string;
  followUp: string;
  interval: string;
  priority: string;
  rationale: string;
}

export const FOLLOW_UP_DATABASE: Record<string, FollowUpRecommendation[]> = {
  "meningioma": [
    { condition: "Meningioma — Small, asymptomatic", followUp: "MRI Brain", interval: "6-12 months", priority: "routine", rationale: "Monitor growth. If stable, extend interval." },
    { condition: "Meningioma — Large / symptomatic", followUp: "Neurosurgical referral", interval: "Immediate", priority: "urgent", rationale: "Symptomatic or large lesions require surgical evaluation." },
    { condition: "Meningioma — Atypical / anaplastic", followUp: "MRI + oncology referral", interval: "3 months", priority: "urgent", rationale: "Atypical/anaplastic variants require aggressive surveillance." },
  ],
  "bi-rads-3": [
    { condition: "BI-RADS 3 — Probably benign", followUp: "Mammogram / Ultrasound", interval: "6 months", priority: "routine", rationale: "Short-interval follow-up to confirm stability." },
  ],
  "bi-rads-4": [
    { condition: "BI-RADS 4 — Suspicious", followUp: "Biopsy", interval: "Immediate", priority: "urgent", rationale: "Tissue diagnosis required." },
  ],
  "bi-rads-5": [
    { condition: "BI-RADS 5 — Highly suspicious", followUp: "Biopsy + staging", interval: "Immediate", priority: "urgent", rationale: "High probability of malignancy. Tissue diagnosis and staging." },
  ],
  "disc-prolapse": [
    { condition: "Disc prolapse — Mild, no neurologic deficit", followUp: "Conservative management + follow-up MRI", interval: "6-12 weeks", priority: "routine", rationale: "Conservative management: physiotherapy, NSAIDs." },
    { condition: "Disc prolapse — Severe / progressive deficit", followUp: "Neurosurgical / orthopedic referral", interval: "Immediate", priority: "urgent", rationale: "Progressive neurologic deficit requires surgical evaluation." },
  ],
  "cervical-stenosis": [
    { condition: "Cervical canal stenosis — Mild", followUp: "Clinical follow-up", interval: "6 months", priority: "routine", rationale: "Monitor for progression." },
    { condition: "Cervical canal stenosis — Moderate", followUp: "MRI + neurosurgical referral", interval: "3 months", priority: "urgent", rationale: "Moderate stenosis may require surgical decompression." },
    { condition: "Cervical canal stenosis — Severe / cord signal change", followUp: "Urgent neurosurgical referral", interval: "Immediate", priority: "critical", rationale: "Severe stenosis with cord signal change is high risk for myelopathy." },
  ],
  "lumbar-stenosis": [
    { condition: "Lumbar canal stenosis — Mild", followUp: "Conservative management", interval: "6 months", priority: "routine", rationale: "Physiotherapy, activity modification." },
    { condition: "Lumbar canal stenosis — Severe", followUp: "Neurosurgical referral", interval: "2-4 weeks", priority: "urgent", rationale: "Severe stenosis may require surgical decompression." },
  ],
  "hcc": [
    { condition: "HCC — Small (<2 cm)", followUp: "MRI + hepatology referral", interval: "1-3 months", priority: "urgent", rationale: "Small HCC: consider ablation/resection." },
    { condition: "HCC — Intermediate (2-5 cm)", followUp: "Multidisciplinary tumor board", interval: "2 weeks", priority: "urgent", rationale: "Intermediate HCC: consider resection, TACE, or transplant." },
    { condition: "HCC — Large (>5 cm) / multifocal", followUp: "Staging + oncology referral", interval: "Immediate", priority: "urgent", rationale: "Large/multifocal HCC requires comprehensive staging." },
  ],
  "renal-mass": [
    { condition: "Renal mass — Bosniak IIF", followUp: "CT/MRI", interval: "6 months", priority: "routine", rationale: "Bosniak IIF requires surveillance for progression." },
    { condition: "Renal mass — Bosniak III", followUp: "Urological referral + surgical evaluation", interval: "Immediate", priority: "urgent", rationale: "Bosniak III has significant malignancy risk." },
    { condition: "Renal mass — Bosniak IV", followUp: "Urological referral + surgical evaluation", interval: "Immediate", priority: "urgent", rationale: "Bosniak IV is highly suspicious for malignancy." },
  ],
  "thyroid-nodule": [
    { condition: "Thyroid nodule — TI-RADS 3", followUp: "Ultrasound", interval: "12 months", priority: "routine", rationale: "Low suspicion. Annual surveillance." },
    { condition: "Thyroid nodule — TI-RADS 4", followUp: "FNA biopsy", interval: "Immediate", priority: "urgent", rationale: "Moderate suspicion. Tissue diagnosis required." },
    { condition: "Thyroid nodule — TI-RADS 5", followUp: "FNA biopsy + endocrine referral", interval: "Immediate", priority: "urgent", rationale: "High suspicion. Tissue diagnosis and management." },
  ],
  "pulmonary-nodule": [
    { condition: "Pulmonary nodule — <6 mm, low risk", followUp: "CT Chest", interval: "12 months", priority: "routine", rationale: "Low risk nodule: annual surveillance." },
    { condition: "Pulmonary nodule — 6-8 mm", followUp: "CT Chest", interval: "3-6 months", priority: "routine", rationale: "Intermediate size: short interval to confirm stability." },
    { condition: "Pulmonary nodule — >8 mm or suspicious", followUp: "CT + PET-CT / biopsy", interval: "Immediate", priority: "urgent", rationale: "Large or suspicious nodule requires further evaluation." },
  ],
  "aortic-aneurysm": [
    { condition: "AAA — <3 cm", followUp: "Ultrasound", interval: "5 years", priority: "routine", rationale: "Small AAA: low rupture risk." },
    { condition: "AAA — 3-3.9 cm", followUp: "Ultrasound", interval: "12 months", priority: "routine", rationale: "Moderate size: annual surveillance." },
    { condition: "AAA — 4-4.9 cm", followUp: "Ultrasound / CT", interval: "6 months", priority: "routine", rationale: "Larger size: more frequent surveillance." },
    { condition: "AAA — >5 cm or rapid growth", followUp: "Vascular surgical referral", interval: "Immediate", priority: "urgent", rationale: "Large or rapidly growing AAA requires intervention." },
  ],
  "gallbladder-polyp": [
    { condition: "Gallbladder polyp — <6 mm", followUp: "Ultrasound", interval: "12 months", priority: "routine", rationale: "Small polyp: low malignancy risk." },
    { condition: "Gallbladder polyp — 6-10 mm", followUp: "Ultrasound", interval: "6 months", priority: "routine", rationale: "Intermediate size: surveillance." },
    { condition: "Gallbladder polyp — >10 mm or sessile", followUp: "Surgical referral", interval: "Immediate", priority: "urgent", rationale: "Large or sessile polyp: high malignancy risk." },
  ],
  "hepatic-hemangioma": [
    { condition: "Hepatic hemangioma — Typical, <5 cm", followUp: "None", interval: "N/A", priority: "routine", rationale: "Typical hemangioma: no follow-up needed." },
    { condition: "Hepatic hemangioma — >5 cm or atypical", followUp: "MRI / follow-up", interval: "6-12 months", priority: "routine", rationale: "Large or atypical: confirm stability." },
  ],
  "fibroadenoma": [
    { condition: "Fibroadenoma — Classic, <3 cm", followUp: "Ultrasound", interval: "12 months", priority: "routine", rationale: "Classic fibroadenoma: annual surveillance." },
    { condition: "Fibroadenoma — >3 cm or complex", followUp: "Biopsy / excision", interval: "Immediate", priority: "urgent", rationale: "Large or complex: tissue diagnosis." },
  ],
  "ovarian-cyst": [
    { condition: "Simple ovarian cyst — <5 cm, premenopausal", followUp: "Ultrasound", interval: "2-3 months", priority: "routine", rationale: "Simple cyst: likely physiological." },
    { condition: "Simple ovarian cyst — >5 cm or postmenopausal", followUp: "MRI / follow-up", interval: "3 months", priority: "routine", rationale: "Large or postmenopausal: further evaluation." },
    { condition: "Complex ovarian cyst", followUp: "MRI + gynecology referral", interval: "Immediate", priority: "urgent", rationale: "Complex cyst: rule out malignancy." },
  ],
  "pancreatic-cyst": [
    { condition: "Pancreatic cyst — <2 cm, no features", followUp: "MRI/MRCP", interval: "12 months", priority: "routine", rationale: "Small cyst: surveillance." },
    { condition: "Pancreatic cyst — >2 cm or high-risk features", followUp: "EUS + surgical referral", interval: "Immediate", priority: "urgent", rationale: "Large or high-risk features: tissue diagnosis." },
  ],
  "prostate-lesion": [
    { condition: "PI-RADS 3", followUp: "MRI + clinical correlation", interval: "6 months", priority: "routine", rationale: "Equivocal: short interval follow-up." },
    { condition: "PI-RADS 4", followUp: "Targeted biopsy", interval: "Immediate", priority: "urgent", rationale: "Likely clinically significant cancer." },
    { condition: "PI-RADS 5", followUp: "Targeted biopsy + staging", interval: "Immediate", priority: "urgent", rationale: "Highly likely clinically significant cancer." },
  ],
};

export function getFollowUp(id: string): FollowUpRecommendation[] | undefined {
  return FOLLOW_UP_DATABASE[id];
}

export function getAllFollowUpIds(): string[] {
  return Object.keys(FOLLOW_UP_DATABASE);
}

export function searchFollowUp(query: string): string[] {
  const q = query.toLowerCase();
  return Object.keys(FOLLOW_UP_DATABASE).filter((id) => {
    const items = FOLLOW_UP_DATABASE[id];
    if (!items) return false;
    return items.some((item) =>
      item.condition.toLowerCase().includes(q) ||
      item.followUp.toLowerCase().includes(q)
    );
  });
}
