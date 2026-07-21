import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/hooks/useApi";

/**
 * Admin-curated app content from GET /api/public/mobile-config
 * (Settings → Mobile App in the ERP). Every field has a built-in fallback so
 * the app renders sensibly offline, on first launch, or before the admin has
 * configured anything.
 */

export type MobileAppConfig = {
  promoBanner: { enabled: boolean; text: string };
  services: { icon: string; label: string }[];
  trustChips: string[];
  showDoctorsTab: boolean;
  showReportsTab: boolean;
  showStaffPortal: boolean;
  whatsappNumber: string;
  emergencyPhone: string;
  timings: string;
  aboutText: string;
};

export type MobileConfigResponse = {
  clinic: { name: string; tagline: string; address: string; phone: string; email: string };
  onlineBookingEnabled: boolean;
  config: MobileAppConfig;
};

export const MOBILE_CONFIG_FALLBACK: MobileConfigResponse = {
  clinic: {
    name: "Care Diagnostics",
    tagline: "",
    address: "Subhash Chowk, Castair's Town, Deoghar",
    phone: "9973497200",
    email: "CARE.DEOGHAR@GMAIL.COM",
  },
  onlineBookingEnabled: true,
  config: {
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
  },
};

export function useMobileConfig(): MobileConfigResponse {
  const api = useApi();
  const { data } = useQuery({
    queryKey: ["mobile-config"],
    queryFn: () => api.get("/api/public/mobile-config") as Promise<MobileConfigResponse>,
    staleTime: 5 * 60 * 1000,
  });

  if (!data || typeof data !== "object" || !data.config) return MOBILE_CONFIG_FALLBACK;
  return {
    clinic: { ...MOBILE_CONFIG_FALLBACK.clinic, ...(data.clinic ?? {}) },
    onlineBookingEnabled: data.onlineBookingEnabled ?? true,
    config: { ...MOBILE_CONFIG_FALLBACK.config, ...data.config },
  };
}
