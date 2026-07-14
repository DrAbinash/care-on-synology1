-- Lets the clinic admin control the /book page hero's overlay intensity and
-- text color themselves, instead of every low-contrast hero photo needing a
-- code fix. See siteSettings.ts's bookHeroOverlayOpacity/bookHeroTextColor
-- and clinic-site/src/pages/book.tsx for where these are consumed.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.

ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS book_hero_overlay_opacity INTEGER NOT NULL DEFAULT 55;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS book_hero_text_color TEXT NOT NULL DEFAULT 'light';
