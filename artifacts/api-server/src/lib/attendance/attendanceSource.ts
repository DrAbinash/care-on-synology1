/**
 * Attendance source abstraction — one interface, one canonical event.
 * ============================================================================
 * CARE People Management platform.
 *
 * Owner decision (ADR-003): every attendance source is abstracted behind a
 * single interface, and every source ultimately produces the SAME normalized
 * attendance event. Adding a future device = adding a provider, never rewriting
 * the pipeline or the existing (dormant) USB fingerprint bridge.
 *
 * This module is INTENTIONALLY pure design-as-code: types, a source registry,
 * and a normalizer. It performs NO hardware communication, NO DB writes, and is
 * NOT wired to any route. Ingestion, raw-punch persistence, daily summaries,
 * corrections and device polling are Phase 2 (behind ff_hr_attendance_management
 * / ff_hr_biometric_attendance, shadow mode). Nothing here activates attendance
 * automation or touches payroll.
 */

/**
 * Every attendance source kind CARE will support. The current live/dormant set
 * (manual, usb_bridge, webauthn) plus the owner's future roadmap.
 */
export type AttendanceSourceKind =
  | "manual"
  | "usb_bridge"
  | "webauthn"
  | "fingerprint_device"
  | "csv_import"
  | "api_import"
  | "face_recognition"
  | "rfid"
  | "mobile_gps"
  | "admin_correction"
  | "system_generated";

export type PunchDirection = "in" | "out" | "unknown";

/**
 * The canonical event EVERY source normalizes to. Downstream ingestion (Phase 2)
 * turns a stream of these into raw punches → daily summaries. Kept minimal and
 * provider-agnostic on purpose.
 */
export interface AttendanceEvent {
  /** Which source produced this event. */
  source: AttendanceSourceKind;
  /**
   * How the source identifies the subject. Resolution to a CARE staff id is the
   * ingestion layer's job (e.g. biometric templateId → bridge_fingerprint_templates,
   * device user id → employee_biometric_mappings). Never a person's name.
   */
  subjectRef: { kind: "staff_id" | "template_id" | "biometric_user_id" | "device_user_id" | "username"; value: string };
  /** Event instant in ISO-8601 (UTC or with offset). Ingestion applies IST/shift rules. */
  timestamp: string;
  direction: PunchDirection;
  /** Optional device provenance for audit + import-run correlation. */
  deviceId?: string;
  location?: string;
  /** Optional match/quality score (biometric) for audit. */
  score?: number;
  /**
   * Idempotency key: stable across re-imports of the same physical punch so a
   * re-sync is a no-op. Ingestion enforces uniqueness on this (Phase 2).
   */
  dedupeKey?: string;
  raw?: unknown;
}

export interface AttendanceSourceDescriptor {
  kind: AttendanceSourceKind;
  label: string;
  /** The existing staff_attendance.source string this kind persists as. */
  dbSource: string;
  /** Whether this source is available today, dormant, or a future roadmap item. */
  status: "live" | "dormant" | "planned";
  /** True when the event stream can arrive without a live browser session. */
  offlineCapable: boolean;
  notes?: string;
}

/**
 * A provider adapts one physical/logical source into AttendanceEvents. Phase 2
 * implements concrete providers (ManualProvider, UsbBridgeProvider,
 * CsvImportProvider, …); the existing bridge becomes UsbBridgeProvider WITHOUT
 * being rewritten. `normalize` is pure — no I/O.
 */
export interface AttendanceProvider {
  readonly kind: AttendanceSourceKind;
  normalize(input: unknown): AttendanceEvent[];
}

/**
 * Registry of every source kind and how it maps onto the existing
 * staff_attendance.source values (so new abstraction never breaks existing data).
 * The three current db values are "manual", "fingerprint" and "usb-bridge".
 */
export const ATTENDANCE_SOURCES: Record<AttendanceSourceKind, AttendanceSourceDescriptor> = {
  manual: { kind: "manual", label: "Manual entry", dbSource: "manual", status: "live", offlineCapable: false },
  usb_bridge: { kind: "usb_bridge", label: "USB fingerprint bridge", dbSource: "usb-bridge", status: "dormant", offlineCapable: true, notes: "routes/bridge.ts + bridge-service/; disabled until FINGERPRINT_BRIDGE_SECRET set" },
  webauthn: { kind: "webauthn", label: "Device biometric (WebAuthn)", dbSource: "fingerprint", status: "live", offlineCapable: false },
  fingerprint_device: { kind: "fingerprint_device", label: "Networked fingerprint device", dbSource: "fingerprint_device", status: "planned", offlineCapable: true },
  csv_import: { kind: "csv_import", label: "CSV import", dbSource: "csv_import", status: "planned", offlineCapable: true },
  api_import: { kind: "api_import", label: "API import", dbSource: "api_import", status: "planned", offlineCapable: true },
  face_recognition: { kind: "face_recognition", label: "Face recognition", dbSource: "face_recognition", status: "planned", offlineCapable: true },
  rfid: { kind: "rfid", label: "RFID / access card", dbSource: "rfid", status: "planned", offlineCapable: true },
  mobile_gps: { kind: "mobile_gps", label: "Mobile check-in (GPS)", dbSource: "mobile_gps", status: "planned", offlineCapable: true },
  admin_correction: { kind: "admin_correction", label: "Administrative correction", dbSource: "admin_correction", status: "live", offlineCapable: false },
  system_generated: { kind: "system_generated", label: "System generated", dbSource: "system_generated", status: "planned", offlineCapable: true },
};

/** The staff_attendance.source string a given kind persists as. */
export function dbSourceFor(kind: AttendanceSourceKind): string {
  return ATTENDANCE_SOURCES[kind].dbSource;
}

export function isKnownSourceKind(value: string): value is AttendanceSourceKind {
  return Object.prototype.hasOwnProperty.call(ATTENDANCE_SOURCES, value);
}

/**
 * Build a canonical event with defaults filled in. Pure; no validation side
 * effects beyond normalizing direction/subject. Ingestion (Phase 2) is
 * responsible for staff resolution, shift/grace rules, and idempotent storage.
 */
export function toAttendanceEvent(input: {
  source: AttendanceSourceKind;
  subjectRef: AttendanceEvent["subjectRef"];
  timestamp: string;
  direction?: PunchDirection;
  deviceId?: string;
  location?: string;
  score?: number;
  dedupeKey?: string;
  raw?: unknown;
}): AttendanceEvent {
  return {
    source: input.source,
    subjectRef: input.subjectRef,
    timestamp: input.timestamp,
    direction: input.direction ?? "unknown",
    deviceId: input.deviceId,
    location: input.location,
    score: input.score,
    dedupeKey: input.dedupeKey,
    raw: input.raw,
  };
}
