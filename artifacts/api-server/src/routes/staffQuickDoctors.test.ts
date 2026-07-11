import { describe, expect, test, vi, beforeEach } from "vitest";

// Regression coverage for: non-admin staff getting 403 "Failed to save quick
// doctor" on the Billing Desk. Root cause: quickDoctorIds was written via
// PUT /api/clinic-settings, gated by requireStaffSubPermission("/settings",
// "clinic") for any payload key outside BILLING_OWNED_SETTINGS_KEYS
// (["quickTestIds", "billPrintCopies"] — quickDoctorIds was never added to
// that whitelist). This endpoint replaces that shared-clinic-wide write path
// with a per-staff-member table (staff_quick_doctors), gated by
// requireStaffAuth alone, always scoped server-side to the caller's own
// staffId.
//
// The mock's staffId column is a REAL drizzle-orm pgTable column (not a
// plain string stand-in) — eq(realColumn, value) renders a stable "Param"
// query chunk holding the compared value; eq() renders a fake string column
// differently (both sides boxed as primitives with no common "Param" shape),
// so a real column is what makes the fake db able to filter by staffId at
// all without reimplementing drizzle's SQL builder.
const { mockStaffTable, extractEqParamValue } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pgTable, integer, text } = require("drizzle-orm/pg-core");
  const mockStaffTable = pgTable("staff_quick_doctors", {
    staffId: integer("staff_id"),
    quickDoctorIds: text("quick_doctor_ids"),
  });
  function extractEqParamValue(condition: any): unknown {
    const chunk = condition?.queryChunks?.find((c: any) => c?.constructor?.name === "Param");
    return chunk?.value;
  }
  return { mockStaffTable, extractEqParamValue };
});

let rowsByStaffId: Map<number, { staffId: number; quickDoctorIds: string }>;
let clinicRow: { quickDoctorIds: string } | undefined;
let insertCalls: Array<{ staffId: number; quickDoctorIds: string }>;

vi.mock("@workspace/db", () => ({
  db: {
    select: (_cols?: unknown) => ({
      from: (table: any) => ({
        where: (condition: any) => ({
          limit: async () => {
            const staffId = extractEqParamValue(condition);
            const row = rowsByStaffId.get(staffId as number);
            return row ? [{ quickDoctorIds: row.quickDoctorIds }] : [];
          },
        }),
        // clinic-settings fallback read has no .where() — just .limit()
        limit: async () => (clinicRow ? [clinicRow] : []),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (v: { staffId: number; quickDoctorIds: string }) => ({
        onConflictDoUpdate: async ({ set }: { set: { quickDoctorIds: string } }) => {
          insertCalls.push({ staffId: v.staffId, quickDoctorIds: v.quickDoctorIds });
          rowsByStaffId.set(v.staffId, { staffId: v.staffId, quickDoctorIds: set.quickDoctorIds });
        },
      }),
    }),
  },
  staffQuickDoctorsTable: mockStaffTable,
  clinicSettingsTable: { quickDoctorIds: "quick_doctor_ids" },
}));

function getHandler(router: any, method: "get" | "put") {
  const layer = router.stack.find((l: any) => l.route && l.route.path === "/" && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} / handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq(staffId: number, body?: unknown) {
  return { staffSession: { subjectId: staffId }, body } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const VALID = JSON.stringify([1, null, 2, null, null, null, null, null]);

describe("GET/PUT /api/my/quick-doctors — per-staff personal layout, no /settings.clinic permission required", () => {
  beforeEach(() => {
    rowsByStaffId = new Map();
    clinicRow = undefined;
    insertCalls = [];
  });

  test("a non-admin staff member (no /settings.clinic permission whatsoever) can save their own layout", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "put");
    // Note: no permission/role field on the request at all — this endpoint
    // never checks one. requireStaffAuth (mounted in routes/index.ts) is the
    // only gate, and it does not require any module permission.
    const req = makeReq(42, { quickDoctorIds: VALID });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, quickDoctorIds: VALID });
    expect(insertCalls).toEqual([{ staffId: 42, quickDoctorIds: VALID }]);
  });

  test("saving does not accept or use a client-supplied staffId — always the session's own subjectId", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "put");
    // Attacker/buggy-client attempt: body claims to be staff 99, but the
    // authenticated session is staff 7.
    const req = makeReq(7, { staffId: 99, quickDoctorIds: VALID });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(insertCalls).toEqual([{ staffId: 7, quickDoctorIds: VALID }]);
    expect(rowsByStaffId.has(99)).toBe(false);
  });

  test("two different staff members have fully isolated layouts — one cannot see or overwrite the other's", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const putHandler = getHandler(router, "put");
    const getHandlerFn = getHandler(router, "get");

    const aliceIds = JSON.stringify([1, null, null, null, null, null, null, null]);
    const bobIds = JSON.stringify([null, 2, null, null, null, null, null, null]);

    await putHandler(makeReq(1, { quickDoctorIds: aliceIds }), makeRes());
    await putHandler(makeReq(2, { quickDoctorIds: bobIds }), makeRes());

    const aliceRes = makeRes();
    await getHandlerFn(makeReq(1), aliceRes);
    expect(aliceRes.body).toEqual({ quickDoctorIds: aliceIds });

    const bobRes = makeRes();
    await getHandlerFn(makeReq(2), bobRes);
    expect(bobRes.body).toEqual({ quickDoctorIds: bobIds });
  });

  test("GET bootstraps from the legacy clinic-wide default when no personal row exists yet", async () => {
    clinicRow = { quickDoctorIds: JSON.stringify([5, null, null, null, null, null, null, null]) };
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "get");
    const res = makeRes();
    await handler(makeReq(3), res);
    expect(res.body).toEqual({ quickDoctorIds: clinicRow.quickDoctorIds });
  });

  test("GET falls back to the all-null default when neither a personal row nor a clinic default exists", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "get");
    const res = makeRes();
    await handler(makeReq(3), res);
    expect(res.body).toEqual({ quickDoctorIds: "[null,null,null,null,null,null,null,null]" });
  });

  test("rejects a malformed quickDoctorIds payload with 400 (same contract as the legacy clinic-settings field)", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "put");
    const res = makeRes();
    await handler(makeReq(1, { quickDoctorIds: JSON.stringify([1, 2]) }), res); // only 2 entries, not 8
    expect(res.statusCode).toBe(400);
    expect(insertCalls).toEqual([]);
  });

  test("rejects a non-string quickDoctorIds payload with 400", async () => {
    const { default: router } = await import("./staffQuickDoctors");
    const handler = getHandler(router, "put");
    const res = makeRes();
    await handler(makeReq(1, { quickDoctorIds: [1, 2, 3, 4, 5, 6, 7, 8] }), res); // array, not JSON string
    expect(res.statusCode).toBe(400);
  });
});
