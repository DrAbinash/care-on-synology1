import { pgTable, serial, text, boolean, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * queue_display_settings — configuration for TV / kiosk queue-display screens
 * (e.g. USG Room, X-Ray Room, Reception waiting area).
 *
 * One row per "room key" (e.g. "usg", "xray", "reception"). This lets the
 * clinic run multiple TV displays, each independently branded and configured,
 * without hardcoding anything into the frontend.
 *
 * Follows the same convention as clinic_settings: JSON payloads (like
 * instruction_items) are stored as TEXT and parsed/stringified at the API
 * boundary, rather than using jsonb, to stay consistent with the rest of the
 * codebase's settings tables and avoid a mixed-type migration surface.
 *
 * This table is presentation/config only. It does not touch test_tokens,
 * billing, or any protected business logic — it only reads from the existing
 * /api/display/queue(-stream) feed for live token data.
 */
export const queueDisplaySettingsTable = pgTable("queue_display_settings", {
  id: serial("id").primaryKey(),

  // Unique key identifying which physical display this row configures,
  // e.g. "usg", "xray-1", "reception". Used in the route /display/:roomKey.
  roomKey: text("room_key").notNull(),

  // ── Header ──────────────────────────────────────────────────────────────
  displayName: text("display_name").notNull().default("Care Diagnostics"),
  location: text("location").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  showLogo: boolean("show_logo").notNull().default(true),
  showDisplayName: boolean("show_display_name").notNull().default(true),
  showLocation: boolean("show_location").notNull().default(true),

  // ── Room title ──────────────────────────────────────────────────────────
  roomTitle: text("room_title").notNull().default("USG ROOM"),
  showRoomTitle: boolean("show_room_title").notNull().default(true),

  // ── Now serving / next patients ─────────────────────────────────────────
  showNowServing: boolean("show_now_serving").notNull().default(true),
  showNextPatients: boolean("show_next_patients").notNull().default(true),
  nextPatientCount: integer("next_patient_count").notNull().default(5),

  // ── QR booking card ─────────────────────────────────────────────────────
  showQrBooking: boolean("show_qr_booking").notNull().default(true),
  qrImageUrl: text("qr_image_url").notNull().default(""),
  qrHeading: text("qr_heading").notNull().default("AVOID THE QUEUE"),
  qrSubheading: text("qr_subheading").notNull().default("BOOK ONLINE"),
  qrDescription: text("qr_description").notNull().default("Scan the QR code to book your appointment online"),
  qrButtonText: text("qr_button_text").notNull().default("SCAN TO BOOK"),

  // ── Instruction rows — JSON array of { id, icon, text, color, enabled } ──
  instructionItems: text("instruction_items").notNull().default(
    JSON.stringify([
      { id: "1", icon: "👤", text: "Please keep your token ready", color: "#fbbf24", enabled: true },
      { id: "2", icon: "🧑‍🤝‍🧑", text: "One attendant per patient", color: "#60a5fa", enabled: true },
      { id: "3", icon: "🔇", text: "Silence your mobile phone", color: "#4ade80", enabled: true },
    ]),
  ),

  // ── Announcement strip ───────────────────────────────────────────────────
  showAnnouncement: boolean("show_announcement").notNull().default(true),
  announcementText: text("announcement_text").notNull().default(
    "Token numbers may change. Please listen for your number.",
  ),

  // ── Footer ───────────────────────────────────────────────────────────────
  phone: text("phone").notNull().default(""),
  showPhone: boolean("show_phone").notNull().default(true),
  website: text("website").notNull().default(""),
  showWebsite: boolean("show_website").notNull().default(true),
  slogan: text("slogan").notNull().default("We care for you"),
  showSlogan: boolean("show_slogan").notNull().default(true),

  // ── Theme ────────────────────────────────────────────────────────────────
  themeMode: text("theme_mode").notNull().default("dark"),
  primaryColor: text("primary_color").notNull().default("#03a814"),
  secondaryColor: text("secondary_color").notNull().default("#075fe0"),
  accentColor: text("accent_color").notNull().default("#ffe600"),
  // "" for any of these three = fall back to the built-in dark-gradient
  // look (same as before these columns existed) so old rows keep working.
  backgroundColor: text("background_color").notNull().default(""),
  cardBackgroundColor: text("card_background_color").notNull().default(""),
  textColor: text("text_color").notNull().default(""),

  // ── Layout ───────────────────────────────────────────────────────────────
  // "portrait" (1080x1920 signage board, the original design) or
  // "landscape" (1920x1080 — header/footer full-width, two-column body).
  layoutOrientation: text("layout_orientation").notNull().default("portrait"),

  // ── Kiosk mode — unattended-TV hardening ───────────────────────────────
  kioskWakeLock: boolean("kiosk_wake_lock").notNull().default(true),
  kioskAutoFullscreen: boolean("kiosk_auto_fullscreen").notNull().default(true),
  kioskAutoReload: boolean("kiosk_auto_reload").notNull().default(true),
  kioskPreventExit: boolean("kiosk_prevent_exit").notNull().default(true),

  // ── Queue data source — links this display to an existing ledger/department
  // so it can reuse /api/display/queue(-stream) without any new queue logic.
  ledgerId: integer("ledger_id").notNull().default(1),
  departments: text("departments").notNull().default(""), // comma-separated, "" = all

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  roomKeyIdx: uniqueIndex("queue_display_settings_room_key_idx").on(table.roomKey),
}));
