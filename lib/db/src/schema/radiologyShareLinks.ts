import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Tokenized share links for radiology studies. Used by:
//   1. Tele-radiology — radiologists open the study from anywhere via a
//      time-limited token (still requires staff session before any write).
//   2. Patient delivery — the WhatsApp link points at a public viewer that
//      shows the verified report and (optionally) the DICOM image stack.
//
// `audience` controls what the public viewer reveals:
//   - "patient"    — only the verified PDF + summary; no DICOM thumbnails
//   - "radiologist" — full study + draft report (read-only) + image links
//
// Tokens are one-shot-but-reusable: an expiry is set, but each open is logged
// in `accessCount`. Revoking is achieved by setting `revokedAt`.
export const radiologyShareLinksTable = pgTable(
  "radiology_share_links",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull(),
    studyId: integer("study_id").notNull(),
    audience: text("audience").notNull().default("patient"), // patient | radiologist
    createdBy: text("created_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUq: uniqueIndex("radiology_share_links_token_uq").on(t.token),
    byStudy: index("radiology_share_links_study_idx").on(t.studyId),
  }),
);

export type RadiologyShareLink = typeof radiologyShareLinksTable.$inferSelect;
