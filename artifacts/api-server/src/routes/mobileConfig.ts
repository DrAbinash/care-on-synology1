import { Router } from "express";
import { db, clinicSettingsTable } from "@workspace/db";

/**
 * Public mobile-app display config for diagno-booking-mobile.
 *
 * Admin edits Settings → Mobile App in the ERP, which stores a JSON blob in
 * clinic_settings.mobile_app_config_json; this endpoint serves it to the app
 * WHITELISTED — only known, non-secret display keys ever leave the server,
 * so a future admin typo (or a compromised admin session writing extra keys
 * into the blob) cannot leak gateway credentials or internal settings.
 *
 * Unauthenticated by design (the app shows this before any login), mirroring
 * GET /clinic-settings/branding. Never add secrets here.
 */

const mobileConfigRouter = Router();

type PromoBanner = { enabled: boolean; text: string };
type ServiceItem = { icon: string; label: string };

export type MobileAppConfig = {
  promoBanner: PromoBanner;
  services: ServiceItem[];
  trustChips: string[];
  showDoctorsTab: boolean;
  showReportsTab: boolean;
  showStaffPortal: boolean;
  whatsappNumber: string;
  emergencyPhone: string;
  timings: string;
  aboutText: string;
};

export const MOBILE_CONFIG_DEFAULTS: MobileAppConfig = {
  promoBanner: { enabled: false, text: "" },
  services: [
    { icon: "droplet", label: "Pathology" },
    { icon: "camera", label: "X-Ray" },
    { icon: "monitor", label: "Ultrasound" },
    { icon: "cpu", label: "CT / MRI" },
    { icon: "heart", label: "ECG" },
    { icon: "package", label: "Packages" },
  ],
  trustChips: ["NABL Accredited", "Same-day Reports"],
  showDoctorsTab: true,
  showReportsTab: true,
  showStaffPortal: true,
  whatsappNumber: "",
  emergencyPhone: "",
  timings: "Mon-Sat: 7:00 AM - 7:00 PM | Sun: 8:00 AM - 2:00 PM",
  aboutText: "",
};

const str = (v: unknown, fallback: string, max = 600): string =>
  typeof v === "string" ? v.slice(0, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

/** Parse + whitelist the stored blob; anything malformed falls back per-key. */
export function sanitizeMobileConfig(raw: unknown): MobileAppConfig {
  const d = MOBILE_CONFIG_DEFAULTS;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;

  const banner = (typeof o.promoBanner === "object" && o.promoBanner !== null
    ? o.promoBanner
    : {}) as Record<string, unknown>;

  const services = Array.isArray(o.services)
    ? o.services
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .map((s) => ({ icon: str(s.icon, "activity", 40), label: str(s.label, "", 60) }))
        .filter((s) => s.label.length > 0)
        .slice(0, 12)
    : d.services;

  const trustChips = Array.isArray(o.trustChips)
    ? o.trustChips.filter((c): c is string => typeof c === "string" && c.length > 0).map((c) => c.slice(0, 60)).slice(0, 6)
    : d.trustChips;

  return {
    promoBanner: {
      enabled: bool(banner.enabled, d.promoBanner.enabled),
      text: str(banner.text, d.promoBanner.text, 240),
    },
    services: services.length > 0 ? services : d.services,
    trustChips,
    showDoctorsTab: bool(o.showDoctorsTab, d.showDoctorsTab),
    showReportsTab: bool(o.showReportsTab, d.showReportsTab),
    showStaffPortal: bool(o.showStaffPortal, d.showStaffPortal),
    whatsappNumber: str(o.whatsappNumber, d.whatsappNumber, 20),
    emergencyPhone: str(o.emergencyPhone, d.emergencyPhone, 20),
    timings: str(o.timings, d.timings, 200),
    aboutText: str(o.aboutText, d.aboutText, 2000),
  };
}

// ── GET /api/public/mobile-config ────────────────────────────────────────────
mobileConfigRouter.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  let row: typeof clinicSettingsTable.$inferSelect | undefined;
  try {
    [row] = await db.select().from(clinicSettingsTable).limit(1);
  } catch {
    row = undefined;
  }

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(
      (row as { mobileAppConfigJson?: string } | undefined)?.mobileAppConfigJson || "{}",
    );
  } catch {
    parsed = {};
  }

  return res.json({
    clinic: {
      name: row?.name || "Care Diagnostics",
      tagline: row?.tagline || "",
      address: row?.address || "",
      phone: row?.phone || "",
      email: row?.email || "",
    },
    onlineBookingEnabled: !!row?.onlineBookingEnabled,
    config: sanitizeMobileConfig(parsed),
  });
});

export { mobileConfigRouter };
