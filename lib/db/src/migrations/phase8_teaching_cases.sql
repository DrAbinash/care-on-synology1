-- Phase 8: DICOM-Aware Radiology Copilot + Teaching Files Platform
-- Teaching Cases Database Schema

-- Main teaching cases table
CREATE TABLE IF NOT EXISTS teaching_cases (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  diagnosis TEXT,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'intermediate',
  source TEXT NOT NULL DEFAULT 'manual',
  study_instance_uid TEXT,
  series_instance_uid TEXT,
  sop_instance_uid TEXT,
  pacs_url TEXT,
  patient_age TEXT,
  patient_gender TEXT,
  modality TEXT,
  body_part TEXT,
  study_description TEXT,
  findings TEXT,
  impression TEXT,
  measurements TEXT,
  ai_notes TEXT,
  ai_summary TEXT,
  learning_points TEXT,
  pearls TEXT,
  pitfalls TEXT,
  is_research_candidate BOOLEAN NOT NULL DEFAULT false,
  research_status TEXT,
  tags_json TEXT DEFAULT '[]',
  classification TEXT,
  classification_value TEXT,
  created_by_id INTEGER NOT NULL,
  created_by_name TEXT,
  is_anonymized BOOLEAN NOT NULL DEFAULT false,
  anonymized_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_cases_category_idx ON teaching_cases(category);
CREATE INDEX IF NOT EXISTS teaching_cases_difficulty_idx ON teaching_cases(difficulty);
CREATE INDEX IF NOT EXISTS teaching_cases_status_idx ON teaching_cases(status);
CREATE INDEX IF NOT EXISTS teaching_cases_modality_idx ON teaching_cases(modality);
CREATE INDEX IF NOT EXISTS teaching_cases_body_part_idx ON teaching_cases(body_part);
CREATE INDEX IF NOT EXISTS teaching_cases_diagnosis_idx ON teaching_cases(diagnosis);
CREATE INDEX IF NOT EXISTS teaching_cases_created_by_idx ON teaching_cases(created_by_id);
CREATE INDEX IF NOT EXISTS teaching_cases_research_idx ON teaching_cases(is_research_candidate);

-- Teaching case images
CREATE TABLE IF NOT EXISTS teaching_case_images (
  id SERIAL PRIMARY KEY,
  teaching_case_id INTEGER NOT NULL,
  image_url TEXT,
  image_data TEXT,
  thumbnail_url TEXT,
  study_instance_uid TEXT,
  series_instance_uid TEXT,
  sop_instance_uid TEXT,
  frame_number INTEGER,
  is_key_image BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  annotation_data TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_case_images_case_idx ON teaching_case_images(teaching_case_id);
CREATE INDEX IF NOT EXISTS teaching_case_images_key_idx ON teaching_case_images(is_key_image);

-- Teaching case collections
CREATE TABLE IF NOT EXISTS teaching_case_collections (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id INTEGER,
  owner_name TEXT,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  case_ids_json TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_case_collections_owner_idx ON teaching_case_collections(owner_id);

-- Favorites
CREATE TABLE IF NOT EXISTS teaching_case_favorites (
  id SERIAL PRIMARY KEY,
  teaching_case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(teaching_case_id, user_id)
);

-- Views
CREATE TABLE IF NOT EXISTS teaching_case_views (
  id SERIAL PRIMARY KEY,
  teaching_case_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_case_views_case_idx ON teaching_case_views(teaching_case_id);

-- Notes
CREATE TABLE IF NOT EXISTS teaching_case_notes (
  id SERIAL PRIMARY KEY,
  teaching_case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_case_notes_case_idx ON teaching_case_notes(teaching_case_id);

-- Measurement history
CREATE TABLE IF NOT EXISTS measurement_history (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  measurement_type TEXT NOT NULL,
  measurement_label TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT DEFAULT 'mm',
  body_part TEXT,
  side TEXT,
  level TEXT,
  study_id INTEGER,
  study_instance_uid TEXT,
  accession_number TEXT,
  series_number TEXT,
  image_number TEXT,
  modality TEXT,
  measured_by_id INTEGER,
  measured_by_name TEXT,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS measurement_history_patient_idx ON measurement_history(patient_id);
CREATE INDEX IF NOT EXISTS measurement_history_type_idx ON measurement_history(measurement_type);
CREATE INDEX IF NOT EXISTS measurement_history_study_idx ON measurement_history(study_id);
