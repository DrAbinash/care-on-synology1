-- Phase 4: Radiology Knowledge Platform
-- Migration for master templates, personal library, knowledge base, profiles

-- 1. Master Templates
CREATE TABLE IF NOT EXISTS radiology_master_templates (
  id SERIAL PRIMARY KEY,
  group_name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  modality TEXT NOT NULL,
  study_type TEXT,
  body_part TEXT,
  findings TEXT NOT NULL,
  impression TEXT NOT NULL,
  recommendations TEXT,
  tags TEXT DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  modified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_master_group_name_uq ON radiology_master_templates(group_name, template_name);
CREATE INDEX IF NOT EXISTS radiology_master_group_idx ON radiology_master_templates(group_name);
CREATE INDEX IF NOT EXISTS radiology_master_modality_idx ON radiology_master_templates(modality);
CREATE INDEX IF NOT EXISTS radiology_master_bodypart_idx ON radiology_master_templates(body_part);
CREATE INDEX IF NOT EXISTS radiology_master_studytype_idx ON radiology_master_templates(study_type);
CREATE INDEX IF NOT EXISTS radiology_master_active_idx ON radiology_master_templates(is_active);

-- 2. Template Versions
CREATE TABLE IF NOT EXISTS radiology_template_versions (
  id SERIAL PRIMARY KEY,
  master_template_id INTEGER NOT NULL REFERENCES radiology_master_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  findings TEXT NOT NULL,
  impression TEXT NOT NULL,
  recommendations TEXT,
  tags TEXT DEFAULT '[]',
  change_notes TEXT,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_template_versions_uq ON radiology_template_versions(master_template_id, version);
CREATE INDEX IF NOT EXISTS radiology_template_versions_master_idx ON radiology_template_versions(master_template_id);

-- 3. Personal Templates
CREATE TABLE IF NOT EXISTS radiology_personal_templates (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  folder TEXT NOT NULL DEFAULT 'General',
  template_name TEXT NOT NULL,
  modality TEXT,
  study_type TEXT,
  body_part TEXT,
  findings TEXT,
  impression TEXT,
  recommendations TEXT,
  measurements TEXT DEFAULT '[]',
  macros TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  source_master_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_personal_staff_folder_uq ON radiology_personal_templates(staff_id, folder, template_name);
CREATE INDEX IF NOT EXISTS radiology_personal_staff_idx ON radiology_personal_templates(staff_id);
CREATE INDEX IF NOT EXISTS radiology_personal_folder_idx ON radiology_personal_templates(folder);
CREATE INDEX IF NOT EXISTS radiology_personal_modality_idx ON radiology_personal_templates(modality);
CREATE INDEX IF NOT EXISTS radiology_personal_bodypart_idx ON radiology_personal_templates(body_part);

-- 4. Template Packs
CREATE TABLE IF NOT EXISTS radiology_template_packs (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  pack_name TEXT NOT NULL,
  description TEXT,
  modality TEXT,
  template_ids TEXT DEFAULT '[]',
  template_sources TEXT DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_template_packs_staff_uq ON radiology_template_packs(staff_id, pack_name);
CREATE INDEX IF NOT EXISTS radiology_template_packs_staff_idx ON radiology_template_packs(staff_id);

-- 5. Knowledge Base
CREATE TABLE IF NOT EXISTS radiology_knowledge_base (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  classification_system TEXT,
  classification_grades TEXT DEFAULT '[]',
  measurement_references TEXT DEFAULT '[]',
  reporting_tips TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_kb_category_idx ON radiology_knowledge_base(category);
CREATE INDEX IF NOT EXISTS radiology_kb_classification_idx ON radiology_knowledge_base(classification_system);
CREATE INDEX IF NOT EXISTS radiology_kb_active_idx ON radiology_knowledge_base(is_active);

-- 6. Radiologist Profiles
CREATE TABLE IF NOT EXISTS radiologist_profiles (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL DEFAULT 'Default',
  default_master_group TEXT DEFAULT 'DR_SUGANDHA_MASTER',
  default_modality TEXT,
  default_body_part TEXT,
  default_template_ids TEXT DEFAULT '[]',
  auto_impression BOOLEAN DEFAULT false,
  auto_priority BOOLEAN DEFAULT false,
  show_knowledge_base BOOLEAN DEFAULT true,
  show_template_packs BOOLEAN DEFAULT true,
  ai_draft_enabled BOOLEAN DEFAULT false,
  ai_comparison_enabled BOOLEAN DEFAULT false,
  ai_voice_enabled BOOLEAN DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiologist_profiles_staff_idx ON radiologist_profiles(staff_id);

-- 7. Template Usage Analytics
CREATE TABLE IF NOT EXISTS radiology_template_usage (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL,
  template_source TEXT NOT NULL,
  template_name TEXT NOT NULL,
  modality TEXT,
  body_part TEXT,
  action TEXT NOT NULL,
  study_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_template_usage_staff_idx ON radiology_template_usage(staff_id);
CREATE INDEX IF NOT EXISTS radiology_template_usage_template_idx ON radiology_template_usage(template_id, template_source);
CREATE INDEX IF NOT EXISTS radiology_template_usage_action_idx ON radiology_template_usage(action);
CREATE INDEX IF NOT EXISTS radiology_template_usage_date_idx ON radiology_template_usage(created_at);

-- 8. Template Favorites
CREATE TABLE IF NOT EXISTS radiology_template_favorites (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL,
  template_source TEXT NOT NULL,
  folder TEXT DEFAULT 'Favorites',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS radiology_template_favorites_uq ON radiology_template_favorites(staff_id, template_id, template_source);
CREATE INDEX IF NOT EXISTS radiology_template_favorites_staff_idx ON radiology_template_favorites(staff_id);

-- 9. Template Comparison
CREATE TABLE IF NOT EXISTS radiology_template_comparison (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  personal_template_id INTEGER NOT NULL REFERENCES radiology_personal_templates(id) ON DELETE CASCADE,
  master_template_id INTEGER NOT NULL REFERENCES radiology_master_templates(id) ON DELETE CASCADE,
  personal_snapshot TEXT NOT NULL,
  master_snapshot TEXT NOT NULL,
  differences JSONB DEFAULT '[]',
  compared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_template_comparison_staff_idx ON radiology_template_comparison(staff_id);
