-- Knowledge Base — initial seed.
--
-- Without any seed content, every WhatsApp AI query escalates to staff
-- per the new "no KB hit, escalate, don't improvise" behavior added to
-- routes/whatsapp.ts's handleAiReply. That's the correct safety default,
-- but it would be a real functional regression versus the prior behavior
-- if shipped with zero content. This seed is intentionally minimal and
-- derived from real data (clinic_settings), not fabricated placeholder
-- text, per this project's standing discipline against inventing claims.
--
-- Idempotent via NOT EXISTS guards, safe to re-run.

-- Hospital info, pulled live from clinic_settings at migration time, not
-- hardcoded, so it reflects whatever this specific deployment actually
-- has configured. If clinic_settings is later edited, this seed entry
-- will not auto-update, since it is a one-time seed, not a live view —
-- staff should treat it as a starting point to review and edit via the
-- Knowledge Base API, the same as any other entry.
INSERT INTO knowledge_base_entries (category, title, content, keywords, status, created_by, published_at)
SELECT
  'hospital_info',
  cs.name || ' - Contact and Location',
  trim(both E'\n' from
    'Name: ' || cs.name ||
    CASE WHEN cs.tagline <> '' THEN E'\n' || cs.tagline ELSE '' END ||
    CASE WHEN cs.address <> '' THEN E'\nAddress: ' || cs.address ELSE '' END ||
    CASE WHEN cs.phone <> '' THEN E'\nPhone: ' || cs.phone ELSE '' END ||
    CASE WHEN cs.email <> '' THEN E'\nEmail: ' || cs.email ELSE '' END ||
    CASE WHEN cs.website <> '' THEN E'\nWebsite: ' || cs.website ELSE '' END
  ),
  'hours, address, location, contact, phone, timing, where',
  'published',
  'system_seed',
  now()
FROM clinic_settings cs
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base_entries WHERE category = 'hospital_info' AND created_by = 'system_seed'
)
LIMIT 1;

-- Starter FAQ template, deliberately left in 'draft' status, not
-- 'published', and deliberately generic placeholder text rather than an
-- invented specific claim such as asserting free home collection exists,
-- since that may not be true for every deployment. Staff must edit and
-- publish this; it is not live-usable as seeded.
INSERT INTO knowledge_base_entries (category, title, content, keywords, status, created_by)
SELECT
  'faqs',
  '[EDIT ME] Sample FAQ - Test Preparation',
  'This is a placeholder Knowledge Base entry. Edit this content with your actual test preparation instructions (fasting requirements, what to bring), then change status to published via the Knowledge Base admin screen. Until published, the AI Receptionist will never use this content.',
  'preparation, fasting, instructions',
  'draft',
  'system_seed'
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base_entries WHERE category = 'faqs' AND created_by = 'system_seed'
);
