import { describe, expect, test, vi, beforeEach } from "vitest";
import { appointmentsTable, appointmentCounterTable, patientsTable, doctorsTable } from "@workspace/db/schema";

// Double-booking: POST /appointments and PATCH /appointments/:id previously
// had NO check at all against a doctor already holding the same
// date+timeSlot — any number of appointments could be booked onto the same
// doctor at the same time. This adds an application-level conflict check
// (409 on collision) against other appointments in an ACTIVE state
// (scheduled/confirmed) — cancelled/completed/no-show appointments no
// longer hold the slot and are not treated as a conflict.
//
// The mock evaluates the REAL eq()/and()/inArray()/ne() query trees
// drizzle-orm builds (only the top-level operator functions are mocked, not
// @workspace/db/schema — appointments.ts imports tables from a SEPARATE
// module specifier, @workspace/db/schema, which is left completely real and
// unmocked here, so a mismatched column reference in the route code makes
// these tests fail loudly instead of silently matching everything). Field
// names are resolved generically from whatever real table object the route
// code passes to .from()/.insert()/.update() at call time, rather than a
// fixed pre-imported table list — this avoids needing the workspace's
// TS-source schema package inside a synchronous vi.hoisted() factory, which
// its extensionless internal imports can't resolve under plain require().
const { tableStores, storeFor, matches, pick } = vi.hoisted(() => {
  const tableStores = new WeakMap<any, any[]>();
  function storeFor(table: any): any[] {
    if (!tableStores.has(table)) tableStores.set(table, []);
    return tableStores.get(table)!;
  }
  function fieldNameFor(col: any, table: any): string {
    for (const [key, val] of Object.entries(table)) {
      if (val === col) return key;
    }
    throw new Error("appointments.conflictCheck.test.ts: unmapped column in mock predicate evaluator");
  }
  function matches(row: any, cond: any, table: any): boolean {
    if (!cond) return true;
    switch (cond.__op) {
      case "and": return cond.conds.every((c: any) => matches(row, c, table));
      case "eq": return row[fieldNameFor(cond.col, table)] === cond.val;
      case "ne": return row[fieldNameFor(cond.col, table)] !== cond.val;
      case "inArray": return cond.vals.includes(row[fieldNameFor(cond.col, table)]);
      default: throw new Error(`appointments.conflictCheck.test.ts: unhandled op ${cond.__op}`);
    }
  }
  function pick(row: any, cols: Record<string, any> | undefined, table: any) {
    if (!cols) return { ...row };
    const out: any = {};
    for (const [key, col] of Object.entries(cols)) out[key] = row[fieldNameFor(col, table)];
    return out;
  }
  return { tableStores, storeFor, matches, pick };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", col, val }),
  ne: (col: any, val: any) => ({ __op: "ne", col, val }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", col, vals }),
  and: (...conds: any[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: (col: any) => ({ __op: "desc", col }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (cols?: Record<string, any>) => ({
      from: (table: any) => {
        const store = storeFor(table);
        const build = (matched: any[]) => {
          const mapped = matched.map((r) => pick(r, cols, table));
          (mapped as any).limit = async (n: number) => mapped.slice(0, n);
          return mapped;
        };
        return {
          where: (cond: any) => build(store.filter((r) => matches(r, cond, table))),
          limit: async (n: number) => build(store).slice(0, n),
        };
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const store = storeFor(table);
        const row = { id: v.id ?? store.length + 1, ...v };
        store.push(row);
        const result: any = [row];
        result.returning = async () => [row];
        return result;
      },
    }),
    update: (table: any) => ({
      set: (updates: any) => ({
        where: (cond: any) => {
          const store = storeFor(table);
          const idx = store.findIndex((r) => matches(r, cond, table));
          if (idx !== -1) store[idx] = { ...store[idx], ...updates };
          const result: any = idx !== -1 ? [store[idx]] : [];
          result.returning = async () => result;
          return result;
        },
      }),
    }),
  },
}));

function getHandler(router: any, method: "post" | "patch", path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq(body?: unknown, params?: Record<string, string>) {
  return { body, params: params ?? {} } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function seed(table: any, rows: any[]) {
  const store = storeFor(table);
  store.length = 0;
  store.push(...rows);
}

const BASE = { patientId: 1, doctorId: 7, appointmentDate: "2026-07-27", timeSlot: "10:00-10:15" };

describe("POST /appointments — double-booking conflict check", () => {
  beforeEach(() => {
    seed(appointmentsTable, [
      { id: 500, appointmentId: "APT-2607-0500", patientId: 2, doctorId: 7, appointmentDate: "2026-07-27", timeSlot: "10:00-10:15", status: "scheduled" },
    ]);
    seed(appointmentCounterTable, []);
    seed(patientsTable, [{ id: 1, ledgerId: 1 }, { id: 2, ledgerId: 1 }]);
    seed(doctorsTable, [{ id: 7, ledgerId: 1 }, { id: 42, ledgerId: 1 }, { id: 99, ledgerId: 1 }]);
  });

  test("blocks with 409 when the same doctor already has a SCHEDULED appointment in that exact slot", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(BASE), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.conflictingAppointmentId).toBe("APT-2607-0500");
    expect(storeFor(appointmentsTable)).toHaveLength(1); // nothing was inserted
  });

  test("blocks with 409 against a CONFIRMED appointment too", async () => {
    storeFor(appointmentsTable)[0].status = "confirmed";
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(BASE), res);
    expect(res.statusCode).toBe(409);
  });

  test("does NOT block against a CANCELLED appointment in the same slot — the slot is free again", async () => {
    storeFor(appointmentsTable)[0].status = "cancelled";
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(BASE), res);
    expect(res.statusCode).toBe(201);
  });

  test.each(["no-show", "completed"])("does NOT block against a %s appointment in the same slot", async (status) => {
    storeFor(appointmentsTable)[0].status = status;
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(BASE), res);
    expect(res.statusCode).toBe(201);
  });

  test("does NOT block a walk-in with no doctorId assigned — there is no doctor slot to double-book", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq({ ...BASE, doctorId: undefined }), res);
    expect(res.statusCode).toBe(201);
  });

  test("does NOT block a different doctor in the same date+timeSlot", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq({ ...BASE, doctorId: 99 }), res);
    expect(res.statusCode).toBe(201);
  });

  test("does NOT block creating directly with status: cancelled — it never holds the slot itself", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq({ ...BASE, status: "cancelled" }), res);
    expect(res.statusCode).toBe(201);
  });

  test("succeeds and inserts when no conflict exists", async () => {
    seed(appointmentsTable, []);
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "post", "/");
    const res = makeRes();
    await handler(makeReq(BASE), res);
    expect(res.statusCode).toBe(201);
    expect(storeFor(appointmentsTable)).toHaveLength(1);
  });
});

describe("PATCH /appointments/:id — double-booking conflict check", () => {
  beforeEach(() => {
    seed(appointmentsTable, [
      { id: 1, appointmentId: "APT-2607-0001", patientId: 1, doctorId: 7, appointmentDate: "2026-07-27", timeSlot: "09:00-09:15", status: "scheduled" },
      { id: 2, appointmentId: "APT-2607-0002", patientId: 2, doctorId: 7, appointmentDate: "2026-07-27", timeSlot: "10:00-10:15", status: "scheduled" },
    ]);
  });

  test("blocks with 409 when moving appointment 1 into appointment 2's slot (same doctor, same date+timeSlot)", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ timeSlot: "10:00-10:15" }, { id: "1" }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.conflictingAppointmentId).toBe("APT-2607-0002");
    expect(storeFor(appointmentsTable)[0].timeSlot).toBe("09:00-09:15"); // unchanged
  });

  test("does NOT conflict with itself — re-saving the same doctor/date/timeSlot (e.g. confirming) succeeds", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ status: "confirmed" }, { id: "1" }), res);
    expect(res.statusCode).toBe(200);
    expect(storeFor(appointmentsTable)[0].status).toBe("confirmed");
  });

  test("updating only `notes` never triggers a conflict check, even if the slot is otherwise taken elsewhere", async () => {
    // id 1 and id 2 are in DIFFERENT slots already (no actual collision) —
    // this proves the notes-only path doesn't even evaluate doctorId/date/
    // timeSlot/status, by using a value that would 409 if it did.
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ notes: "called patient to confirm" }, { id: "1" }), res);
    expect(res.statusCode).toBe(200);
    expect(storeFor(appointmentsTable)[0].notes).toBe("called patient to confirm");
  });

  test("moving to CANCELLED status never conflicts, even onto an occupied slot", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ status: "cancelled", timeSlot: "10:00-10:15" }, { id: "1" }), res);
    expect(res.statusCode).toBe(200);
  });

  test("reassigning to a doctor who is free at that date+timeSlot succeeds", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ doctorId: 42 }, { id: "1" }), res);
    expect(res.statusCode).toBe(200);
    expect(storeFor(appointmentsTable)[0].doctorId).toBe(42);
  });

  test("404s when the appointment being updated does not exist", async () => {
    const { appointmentsRouter } = await import("./appointments");
    const handler = getHandler(appointmentsRouter, "patch", "/:id");
    const res = makeRes();
    await handler(makeReq({ timeSlot: "11:00-11:15" }, { id: "999" }), res);
    expect(res.statusCode).toBe(404);
  });
});
