-- Phase 7A: AI Prompt Library and Version History

CREATE TABLE IF NOT EXISTS ai_prompt_library (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT 'OTHER',
  prompts_json JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  library_owner TEXT NOT NULL DEFAULT 'care_diagnostics',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_prompt_lib_modality_idx ON ai_prompt_library(modality);
CREATE INDEX IF NOT EXISTS ai_prompt_lib_owner_idx ON ai_prompt_library(library_owner);
CREATE INDEX IF NOT EXISTS ai_prompt_lib_active_idx ON ai_prompt_library(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_lib_name_owner_uq ON ai_prompt_library(name, library_owner);

CREATE TABLE IF NOT EXISTS ai_prompt_library_versions (
  id SERIAL PRIMARY KEY,
  library_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  prompts_json JSONB NOT NULL DEFAULT '{}',
  change_notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_prompt_lib_ver_lib_id_idx ON ai_prompt_library_versions(library_id);
CREATE INDEX IF NOT EXISTS ai_prompt_lib_ver_ver_idx ON ai_prompt_library_versions(library_id, version);

-- Seed with default prompts for Care Diagnostics library
INSERT INTO ai_prompt_library (name, modality, prompts_json, version, library_owner, is_system, is_active, created_by)
VALUES
  ('MRI Brain', 'MRI', '{"system":"You are a board-certified neuroradiologist. Provide detailed, structured reports. Include sequence-specific findings. Measurements in mm. Use standard neuroanatomy terminology.","image_review":"Review the provided MRI brain images. Sequence by sequence: T1W, T2W, FLAIR, DWI/ADC, T1W+Contrast, SWI/GRE. Note any abnormal signal, enhancement, mass effect, hemorrhage, or diffusion restriction.","findings":"Describe the brain parenchyma, ventricles, sulci, basal ganglia, thalami, brainstem, cerebellum, extra-axial spaces, and vascular structures. Mention any mass, edema, hemorrhage, or infarct.","impression":"Summarize the most significant findings. Differential diagnosis if applicable. Clinical correlation recommended.","differential":"Consider: glioma, metastasis, abscess, demyelination, infarct, hemorrhage, encephalitis, neurodegenerative disease, vascular malformation, normal variant.","followup":"MRI with contrast if not done. Follow-up MRI in 3-6 months for indeterminate lesions. Neurosurgery referral for mass with mass effect.","quality":"Check for: impression present, measurements included, no placeholders, no contradictions, conclusion clear, anatomy described.","polish":"Refine grammar and clarity. Ensure professional medical language. Do not change medical facts.","formatting":"Use structured headings: CLINICAL HISTORY, TECHNIQUE, COMPARISON, FINDINGS, IMPRESSION."}', 1, 'care_diagnostics', true, true, 'system'),
  ('CT Brain', 'CT', '{"system":"You are a board-certified neuroradiologist. Provide CT brain reports with attention to hemorrhage, mass effect, and bony windows.","image_review":"Review CT brain images. Check for acute hemorrhage (hyperdense), mass effect (midline shift), hydrocephalus, skull fractures, and subtle hypodensities (early infarct).","findings":"Describe brain parenchyma density, ventricles, sulci, basal cisterns, skull vault, and facial bones. Note any hyperdensity, hypodensity, mass effect, or fracture.","impression":"Summarize acute findings. Rule out hemorrhage, large vessel occlusion, or fracture. Mention if CT is normal.","differential":"Consider: acute hemorrhage, subdural/epidural hematoma, infarct, tumor, abscess, contusion, normal aging changes.","followup":"CTA if vascular cause suspected. MRI for better characterization. Neurosurgery for hemorrhage with mass effect. Repeat CT if clinical deterioration.","quality":"Check for: impression present, acute findings highlighted, no placeholders, measurements included, bone windows mentioned.","polish":"Refine grammar. Ensure concise, urgent language for acute findings.","formatting":"Use structured headings: CLINICAL HISTORY, TECHNIQUE, COMPARISON, FINDINGS, IMPRESSION."}', 1, 'care_diagnostics', true, true, 'system'),
  ('X-Ray', 'X-Ray', '{"system":"You are a radiologist. Provide concise X-ray reports with systematic review.","image_review":"Review the X-ray systematically. Check for alignment, bone integrity, joint spaces, soft tissue, and any visible pathology.","findings":"Describe bones, joints, soft tissues, and any visible pathology. Note alignment, fractures, dislocations, or degenerative changes.","impression":"Summarize key findings. Mention normal if no significant pathology.","differential":"Consider: fracture, dislocation, osteoarthritis, osteoporosis, infection, tumor, normal variant.","followup":"CT/MRI if further characterization needed. Orthopedic referral for fractures. Follow-up X-ray for healing assessment.","quality":"Check for: impression present, systematic review, no placeholders, no contradictions.","polish":"Refine grammar. Ensure concise, clear language.","formatting":"Use structured headings: CLINICAL HISTORY, TECHNIQUE, COMPARISON, FINDINGS, IMPRESSION."}', 1, 'care_diagnostics', true, true, 'system')
ON CONFLICT (name, library_owner) DO NOTHING;
