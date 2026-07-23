/**
 * Attendance ingestion — idempotent raw-punch preservation + summary update.
 * ============================================================================
 * The stability core for device attendance. Every punch (any source) is:
 *   1. preserved verbatim in the immutable attendance_raw_punches log
 *      (idempotent via a UNIQUE dedupe_key — a re-sent punch is a no-op), then
 *   2. reflected into the per-day staff_attendance summary using the SAME smart
 *      in/out toggle the bridge route already used (behaviour preserved).
 *
 * This does NOT write payroll, does NOT auto-compute salary, and does NOT write
 * a hash-chained audit row per punch (routine punches are high-volume; the
 * immutable raw log is their trail — audit_logs is reserved for sensitive admin
 * actions like enrollment/deletion/corrections). Gated upstream by
 * ff_hr_biometric_attendance + FINGERPRINT_BRIDGE_SECRET (Shadow Mode).
 */
import type { Request } from "express";
import { db } from "@workspace/db";
import {
  staffAttendanceTable,
  attendanceRawPunchesTable,
  type Staff,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { todayIST } from "../istDate";
import { dbSourceFor, type AttendanceSourceKind } from "./attendanceSource";

export interface StaffPunchInput {
  staff: Staff;
  requestedAction: "in" | "out";
  sourceKind?: AttendanceSourceKind; // defaults to usb_bridge
  deviceId?: string | null;
  templateId?: number | null;
  score?: number | null;
  /** Provenance payload preserved on the raw punch (e.g. GPS {lat,lng}). */
  raw?: unknown;
}

export interface StaffPunchResult {
  ok: boolean;
  duplicate: boolean;
  action: "in" | "out";
  attendance?: typeof staffAttendanceTable.$inferSelect;
  error?: string;
}

/**
 * Record a staff attendance punch coming from a device/bridge source.
 * `req` is accepted for parity with other ingestion entry points (IP/UA
 * context) even though routine punches are not individually audit-logged.
 */
export async function recordStaffPunch(
  _req: Request,
  input: StaffPunchInput,
): Promise<StaffPunchResult> {
  const source = dbSourceFor(input.sourceKind ?? "usb_bridge"); // "usb-bridge"
  const today = todayIST();
  const now = new Date();
  const staff = input.staff;

  // Smart toggle (identical to the prior bridge behaviour): an "in" when
  // already punched-in-without-out becomes an "out".
  const [existing] = await db
    .select()
    .from(staffAttendanceTable)
    .where(
      and(
        eq(staffAttendanceTable.staffId, staff.id),
        eq(staffAttendanceTable.attendanceDate, today),
      ),
    );
  const resolved: "in" | "out" =
    input.requestedAction === "in" && existing?.punchIn && !existing.punchOut
      ? "out"
      : input.requestedAction;

  const dedupeKey = `${source}:${input.deviceId ?? "na"}:${input.templateId ?? staff.id}:${resolved}:${now.toISOString()}`;

  const outcome = await db
    .transaction(async (tx) => {
      // 1) Preserve the raw punch. UNIQUE(dedupe_key) → duplicate re-send is a no-op.
      const rawInserted = await tx
        .insert(attendanceRawPunchesTable)
        .values({
          staffId: staff.id,
          source,
          direction: resolved,
          punchTs: now,
          deviceId: input.deviceId ?? null,
          templateId: input.templateId ?? null,
          score: input.score ?? null,
          dedupeKey,
          raw: input.raw ?? null,
        })
        .onConflictDoNothing({ target: attendanceRawPunchesTable.dedupeKey })
        .returning({ id: attendanceRawPunchesTable.id });

      if (rawInserted.length === 0) {
        return { duplicate: true as const, attendance: existing };
      }

      // 2) Reflect into the per-day summary.
      if (resolved === "in") {
        const ins = await tx
          .insert(staffAttendanceTable)
          .values({ staffId: staff.id, attendanceDate: today, punchIn: now, source })
          .onConflictDoNothing({
            target: [staffAttendanceTable.staffId, staffAttendanceTable.attendanceDate],
          })
          .returning();
        if (ins.length > 0) return { duplicate: false as const, attendance: ins[0] };
        const upd = await tx
          .update(staffAttendanceTable)
          .set({ punchIn: now, source })
          .where(
            and(
              eq(staffAttendanceTable.staffId, staff.id),
              eq(staffAttendanceTable.attendanceDate, today),
              sql`${staffAttendanceTable.punchIn} IS NULL`,
            ),
          )
          .returning();
        if (upd.length > 0) return { duplicate: false as const, attendance: upd[0] };
        throw new Error("Already punched in today");
      } else {
        const upd = await tx
          .update(staffAttendanceTable)
          .set({ punchOut: now })
          .where(
            and(
              eq(staffAttendanceTable.staffId, staff.id),
              eq(staffAttendanceTable.attendanceDate, today),
              sql`${staffAttendanceTable.punchIn} IS NOT NULL`,
              sql`${staffAttendanceTable.punchOut} IS NULL`,
            ),
          )
          .returning();
        if (upd.length === 0) throw new Error("Must punch in first");
        return { duplicate: false as const, attendance: upd[0] };
      }
    })
    .catch((e: Error) => ({ error: e.message }));

  if (outcome && "error" in outcome) {
    return { ok: false, duplicate: false, action: resolved, error: outcome.error };
  }
  return {
    ok: true,
    duplicate: outcome.duplicate,
    action: resolved,
    attendance: outcome.attendance ?? undefined,
  };
}
