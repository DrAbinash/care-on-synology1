/**
 * radiologyStatus.ts — Unified, user-facing radiology status vocabulary.
 *
 * PHASE C (Radiology V2): staff see SEVEN simple statuses everywhere:
 *   Registered → Study Received → Reporting Pending → Draft Saved
 *   → Final Report → Printed / Shared → Delivered
 *
 * The backend keeps its existing internal statuses untouched (no DB
 * migration). This module is the single mapping layer — any screen that
 * shows a radiology status should import from here so labels stay
 * consistent across Worklist, Cockpit, delivery screens, etc.
 */

export type UnifiedRadiologyStatus =
  | "REGISTERED"
  | "STUDY_RECEIVED"
  | "REPORTING_PENDING"
  | "DRAFT_SAVED"
  | "FINAL_REPORT"
  | "PRINTED_SHARED"
  | "DELIVERED";

export interface UnifiedStatusInfo {
  key: UnifiedRadiologyStatus;
  label: string;
  /** Tailwind classes for the badge (kept consistent with existing palette). */
  color: string;
  /** Ordering for sorting / progress display. */
  order: number;
}

export const UNIFIED_STATUSES: Record<UnifiedRadiologyStatus, UnifiedStatusInfo> = {
  REGISTERED:        { key: "REGISTERED",        label: "Registered",        color: "bg-slate-100 text-slate-700 border-slate-200",   order: 1 },
  STUDY_RECEIVED:    { key: "STUDY_RECEIVED",    label: "Study Received",    color: "bg-blue-100 text-blue-800 border-blue-200",      order: 2 },
  REPORTING_PENDING: { key: "REPORTING_PENDING", label: "Reporting Pending", color: "bg-purple-100 text-purple-800 border-purple-200",order: 3 },
  DRAFT_SAVED:       { key: "DRAFT_SAVED",       label: "Draft Saved",       color: "bg-yellow-100 text-yellow-800 border-yellow-200",order: 4 },
  FINAL_REPORT:      { key: "FINAL_REPORT",      label: "Final Report",      color: "bg-green-100 text-green-800 border-green-200",   order: 5 },
  PRINTED_SHARED:    { key: "PRINTED_SHARED",    label: "Printed / Shared",  color: "bg-teal-100 text-teal-800 border-teal-200",      order: 6 },
  DELIVERED:         { key: "DELIVERED",         label: "Delivered",         color: "bg-gray-100 text-gray-700 border-gray-200",      order: 7 },
};

/**
 * Map the internal radiology_worklist status (+ delivery status) to the
 * unified vocabulary. Internal statuses stay untouched in the database.
 *
 * Internal → Unified:
 *   SCHEDULED / REGISTERED              → Registered
 *   STUDY_RECEIVED                      → Study Received
 *   AI_DRAFT_READY                      → Reporting Pending (radiologist has
 *                                         not started; an AI draft is only an aid)
 *   REPORT_IN_PROGRESS                  → Draft Saved
 *   REPORT_FINAL                        → Final Report
 *   deliveryStatus READY_TO_SEND        → Printed / Shared
 *   deliveryStatus SENT / DELIVERED     → Delivered
 */
export function toUnifiedStatus(
  internalStatus: string | null | undefined,
  deliveryStatus?: string | null,
): UnifiedStatusInfo {
  const d = (deliveryStatus || "").toUpperCase();
  if (d === "SENT" || d === "DELIVERED") return UNIFIED_STATUSES.DELIVERED;

  const s = (internalStatus || "").toUpperCase();
  if (s === "DELIVERED") return UNIFIED_STATUSES.DELIVERED;
  if (s === "REPORT_FINAL" || s === "FINAL") {
    if (d === "READY_TO_SEND") return UNIFIED_STATUSES.PRINTED_SHARED;
    return UNIFIED_STATUSES.FINAL_REPORT;
  }
  if (s === "REPORT_IN_PROGRESS" || s === "IN_PROGRESS" || s === "DRAFT")
    return UNIFIED_STATUSES.DRAFT_SAVED;
  if (s === "AI_DRAFT_READY" || s === "PENDING_PRELIM" || s === "PRELIM_READY" || s === "REPORTING_PENDING")
    return UNIFIED_STATUSES.REPORTING_PENDING;
  if (s === "STUDY_RECEIVED" || s === "RECEIVED" || s === "ACQUIRED")
    return UNIFIED_STATUSES.STUDY_RECEIVED;
  if (s === "SCHEDULED" || s === "REGISTERED" || s === "ORDERED")
    return UNIFIED_STATUSES.REGISTERED;

  // Unknown internal status → show Study Received (safest neutral stage)
  // but keep the raw value visible via tooltip at the call site.
  return UNIFIED_STATUSES.STUDY_RECEIVED;
}

/** Filter options for worklist dropdowns (unified vocabulary). */
export const UNIFIED_FILTER_OPTIONS: Array<{ value: string; label: string; internal: string[] }> = [
  { value: "all",                label: "All Statuses",      internal: [] },
  { value: "STUDY_RECEIVED",     label: "Study Received",    internal: ["STUDY_RECEIVED"] },
  { value: "REPORTING_PENDING",  label: "Reporting Pending", internal: ["AI_DRAFT_READY"] },
  { value: "DRAFT_SAVED",        label: "Draft Saved",       internal: ["REPORT_IN_PROGRESS"] },
  { value: "FINAL_REPORT",       label: "Final Report",      internal: ["REPORT_FINAL"] },
  { value: "DELIVERED",          label: "Delivered",         internal: ["DELIVERED"] },
];

// ─── Role-based worklist views (Phase C) ─────────────────────────────────────

export type WorklistRoleView = "reception" | "technician" | "radiologist" | "owner";

/**
 * Derive the default worklist view from the staff role string.
 * This affects ONLY defaults and which action buttons render; actual
 * page access continues to be enforced by the existing permission system
 * (staffSession.canAccess) — this module does not change permissions.
 */
export function worklistRoleView(normalizedRole: string): WorklistRoleView {
  const r = (normalizedRole || "").toLowerCase();
  if (r === "admin" || r === "super_admin") return "owner";
  if (r.includes("radiolog") || r.includes("sonolog") || r.includes("doctor") || r.includes("consultant"))
    return "radiologist";
  if (r.includes("tech")) return "technician";
  if (r.includes("recep") || r.includes("billing") || r.includes("front") || r.includes("cashier") || r.includes("desk"))
    return "reception";
  // Unknown roles keep the fullest non-owner behavior so no existing staff
  // workflow silently loses buttons (backward compatibility).
  return "radiologist";
}

// ─── Priority display (Phase C) ──────────────────────────────────────────────
// Reuses the EXISTING radiology_studies.priority vocabulary:
//   stat | emergency | urgent | routine | vip

export interface PriorityInfo {
  label: string;
  color: string;
  /** True for stat/emergency/urgent/vip — rows staff should notice first. */
  highlight: boolean;
}

export function priorityInfo(priority: string | null | undefined): PriorityInfo {
  const p = (priority || "routine").toLowerCase();
  if (p === "stat" || p === "emergency")
    return { label: p.toUpperCase(), color: "bg-red-100 text-red-800 border-red-300", highlight: true };
  if (p === "urgent")
    return { label: "URGENT", color: "bg-orange-100 text-orange-800 border-orange-300", highlight: true };
  if (p === "vip")
    return { label: "VIP", color: "bg-purple-100 text-purple-800 border-purple-300", highlight: true };
  return { label: "Routine", color: "bg-slate-100 text-slate-600 border-slate-200", highlight: false };
}
