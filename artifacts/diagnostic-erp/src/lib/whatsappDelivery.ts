/**
 * WhatsApp Delivery v2 — pure client-safe helpers (Lane 1 = wa.me).
 *
 * No DOM. No network. Unit-testable.
 * Lane 2 (Cloud API / BSP) plugs into DeliveryChannel without rework.
 * NEVER silent auto-send — every send is one human click (caller owns that).
 */

export type DeliveryRouting = "patient_only" | "patient_and_doctor" | "doctor_only";

export type DeliveryTargetKind = "patient" | "doctor" | "missing";

export type DeliveryTarget = {
  kind: DeliveryTargetKind;
  role: "patient" | "doctor";
  /** E.164-ish digits without + (e.g. 919876543210), or null when missing. */
  phone: string | null;
  /** Original display string when present. */
  rawPhone?: string | null;
};

export type DeliveryMessageKind = "report" | "bill" | "booking";

export type DeliveryChannel =
  | { kind: "wa-me" }
  | { kind: "cloud-api"; notConfigured: true };

const DEFAULT_CC = "91";

/** Strip to digits; apply default country code for 10-digit IN mobiles. */
export function normalizePhoneForWa(
  input: string | null | undefined,
  defaultCC: string = DEFAULT_CC,
): string | null {
  if (input == null) return null;
  let digits = String(input).replace(/\D/g, "");
  if (!digits) return null;
  // Leading 0 + 10-digit local (09876543210)
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  // Bare 10-digit Indian mobile
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = `${defaultCC.replace(/\D/g, "") || DEFAULT_CC}${digits}`;
  }
  // Already has country code (e.g. 91xxxxxxxxxx) — keep
  if (digits.length < 10 || digits.length > 15) return null;
  // Reject obvious garbage (all same digit, etc.)
  if (/^(\d)\1+$/.test(digits)) return null;
  return digits;
}

/** Build https://wa.me/<phone>?text=<encoded> — Lane 1 deep link. */
export function buildWaLink(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizePhoneForWa(phone);
  if (!normalized) return null;
  const text = encodeURIComponent(message ?? "");
  return `https://wa.me/${normalized}?text=${text}`;
}

/**
 * Ordered delivery targets from routing preference.
 * Missing phones are marked {kind:"missing"} so UI can clipboard + honest toast.
 */
export function resolveDeliveryTargets(opts: {
  routing: DeliveryRouting;
  patientPhone?: string | null;
  doctorPhone?: string | null;
  defaultCC?: string;
}): DeliveryTarget[] {
  const cc = opts.defaultCC ?? DEFAULT_CC;
  const patientNorm = normalizePhoneForWa(opts.patientPhone, cc);
  const doctorNorm = normalizePhoneForWa(opts.doctorPhone, cc);

  const patientTarget = (): DeliveryTarget =>
    patientNorm
      ? { kind: "patient", role: "patient", phone: patientNorm, rawPhone: opts.patientPhone }
      : { kind: "missing", role: "patient", phone: null, rawPhone: opts.patientPhone };

  const doctorTarget = (): DeliveryTarget =>
    doctorNorm
      ? { kind: "doctor", role: "doctor", phone: doctorNorm, rawPhone: opts.doctorPhone }
      : { kind: "missing", role: "doctor", phone: null, rawPhone: opts.doctorPhone };

  switch (opts.routing) {
    case "patient_only":
      return [patientTarget()];
    case "doctor_only":
      return [doctorTarget()];
    case "patient_and_doctor":
      return [patientTarget(), doctorTarget()];
    default:
      return [patientTarget()];
  }
}

/**
 * PHI-minimal message bodies.
 * report/bill: clinic name + link + expiry ONLY (no diagnosis, no amounts).
 * booking: name + slot + ref — never clinical data.
 */
export function deliveryMessage(
  kind: DeliveryMessageKind,
  opts: {
    clinicName: string;
    tokenUrl?: string | null;
    bookingRef?: string | null;
    patientName?: string | null;
    slotLabel?: string | null;
    expiryDays?: number;
  },
): string {
  const clinic = (opts.clinicName || "Care Diagnostics").trim() || "Care Diagnostics";
  const days = Number.isFinite(opts.expiryDays) ? Math.max(1, Number(opts.expiryDays)) : 7;

  if (kind === "booking") {
    const name = (opts.patientName || "Patient").trim();
    const slot = (opts.slotLabel || "your appointment").trim();
    const ref = (opts.bookingRef || "").trim();
    const refBit = ref ? ` Ref: ${ref}.` : "";
    return (
      `Hello ${name}, your booking at ${clinic} is confirmed for ${slot}.${refBit} `
      + `Reply here if you need help.`
    );
  }

  const url = (opts.tokenUrl || "").trim() || "[link]";
  const noun = kind === "bill" ? "bill" : "report";
  return (
    `${clinic}: Your ${noun} is ready. View (expires in ${days} days): ${url}`
  );
}

/** Active channel — Lane 1 only until Cloud API is configured. */
export function resolveDeliveryChannel(_opts?: {
  cloudConfigured?: boolean;
}): DeliveryChannel {
  if (_opts?.cloudConfigured) {
    // Lane 2 stub — still notConfigured until adapter lands.
    return { kind: "cloud-api", notConfigured: true };
  }
  return { kind: "wa-me" };
}

/** Mask phone for audit (last 4 digits). */
export function maskPhoneForAudit(phone: string | null | undefined): string {
  const d = normalizePhoneForWa(phone) ?? String(phone ?? "").replace(/\D/g, "");
  if (d.length < 4) return "****";
  return `****${d.slice(-4)}`;
}

/** Assert a message body is PHI-minimal (test helper / guard). */
export function assertPhiMinimalMessage(
  kind: DeliveryMessageKind,
  body: string,
  forbidden: string[] = [],
): { ok: boolean; violations: string[] } {
  const lower = body.toLowerCase();
  const defaults =
    kind === "booking"
      ? [
          "diagnosis",
          "impression",
          "findings",
          "mri",
          "ct scan",
          "pathology",
          "₹",
          "rs.",
          "inr",
          "amount due",
          "balance",
        ]
      : [
          "diagnosis",
          "impression",
          "findings",
          "herniation",
          "stenosis",
          "infarct",
          "₹",
          "rs.",
          "inr ",
          "amount",
          "balance",
          "total due",
          "paid",
        ];
  const checks = [...defaults, ...forbidden.map((f) => f.toLowerCase())];
  const violations = checks.filter((f) => f && lower.includes(f));
  return { ok: violations.length === 0, violations };
}

/** Workstation memory keys (localStorage) — pure key builders. */
export const WA_STATION_MEMORY_KEY = "care.whatsapp.delivery.lastChoice";
export const WA_STATION_REMEMBER_KEY = "care.whatsapp.delivery.rememberChoice";

export type StationDeliveryChoice = {
  routing: DeliveryRouting;
  preferDoctor?: boolean;
};

export function parseStationChoice(raw: string | null | undefined): StationDeliveryChoice | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as StationDeliveryChoice;
    if (
      j.routing === "patient_only"
      || j.routing === "patient_and_doctor"
      || j.routing === "doctor_only"
    ) {
      return j;
    }
  } catch {
    /* ignore */
  }
  return null;
}
