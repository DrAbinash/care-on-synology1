import { describe, expect, test, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Corridor audit F1 — reprint attribution.
//
// Root cause under test: POST /api/bills/:id/reprint-log took the reprinting
// staff member's name from the client body (`reprintedBy`) and wrote it into
// the bill_audits trail AND the admin email. Anyone with a valid session
// could log (and email) a reprint under any other person's name.
//
// The hardening mirrors the finance-audit fix already pinned for PUT /:id in
// bills.editAudit.test.ts: the actor comes from the authenticated session,
// and the body value survives only as a defensive fallback for a blank
// session name. The reason, audit shape, per-bill sequence numbering, and
// email are unchanged.

let billRow: Record<string, unknown> | null;
let insertedAudits: Array<Record<string, unknown>>;
let auditUpdates: Array<Record<string, unknown>>;
let auditCounts: Array<{ count: number }>;
let patientRow: Record<string, unknown> | null;
let emailCalls: Array<Record<string, unknown>>;

// Real drizzle tables arrive here through bills.ts's deep import graph
// (radiology, pacs, …) — dispatch on the SQL table name when available,
// falling back to the __name tag on the three tables this test overrides.
import { getTableName } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameOf(t: any): string {
  try {
    return t?.__name || getTableName(t);
  } catch {
    return "";
  }
}

vi.mock("@workspace/db", () => {
  const chainFor = (table: unknown) => {
    const name = nameOf(table);
    // Drizzle query builders are thenables: production awaits them both
    // directly (`.where(cond)` with no limit) and via chained
    // `.limit()/.orderBy().limit()/.for().limit()` calls.
    const rows = async () => {
      if (name === "bills") return billRow ? [billRow] : [];
      if (name === "patients") return patientRow ? [patientRow] : [];
      return [];
    };
    const thenable: Record<string, unknown> = {
      limit: rows,
      orderBy: () => ({ limit: rows }),
      for: () => ({ limit: rows }),
      then: (
        onFulfilled: (v: unknown) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => Promise.resolve().then(rows).then(onFulfilled, onRejected),
    };
    return { where: () => thenable, ...thenable };
  };
  const dbLike = {
    select: (fields?: Record<string, unknown>) => ({
      from: (t: unknown) => {
        const base = chainFor(t);
        // count(*) select on bill_audits
        if (nameOf(t) === "bill_audits" && fields && "count" in fields) {
          return { where: async () => auditCounts };
        }
        return base;
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (nameOf(table) === "bill_audits") insertedAudits.push(vals);
        const result = [{ id: insertedAudits.length, ...vals }];
        const thenable = Promise.resolve(result) as Promise<typeof result> & {
          returning: () => Promise<typeof result>;
        };
        thenable.returning = async () => result;
        return thenable;
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (nameOf(table) === "bill_audits") auditUpdates.push(vals);
          return [];
        },
      }),
    }),
  };
  return {
    db: dbLike,
    // bills.ts imports some tables from "@workspace/db" (the client barrel
    // re-exports the schema) — provide the same overrides there.
    billsTable: {
      __name: "bills",
      id: "id",
      patientId: "patient_id",
      billNumber: "bill_number",
      totalAmount: "total_amount",
    },
    paymentsTable: { __name: "payments", id: "id", billId: "bill_id" },
    ordersTable: { __name: "orders", id: "id" },
    patientsTable: {
      __name: "patients",
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
    },
    orderTestsTable: { __name: "order_tests", id: "id" },
    testsTable: { __name: "tests", id: "id" },
    doctorsTable: { __name: "doctors", id: "id" },
    clinicSettingsTable: { __name: "clinic_settings", id: "id" },
  };
});

vi.mock("@workspace/db/schema", async (importOriginal) => {
  // Keep every real table bills.ts's import graph touches at module level;
  // override only the three this test intercepts, tagged with __name.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    billsTable: {
      __name: "bills",
      id: "id",
      patientId: "patient_id",
      billNumber: "bill_number",
      totalAmount: "total_amount",
    },
    patientsTable: {
      __name: "patients",
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
    },
    billAuditsTable: {
      __name: "bill_audits",
      billId: "bill_id",
      editedBy: "edited_by",
      reason: "reason",
      changeType: "change_type",
      oldValue: "old_value",
      newValue: "new_value",
      id: "id",
    },
  };
});

const { sendBillReprintEmailSpy } = vi.hoisted(() => ({
  sendBillReprintEmailSpy: vi.fn(),
}));
vi.mock("../email", () => ({
  sendBillEditEmail: vi.fn(),
  sendBillReprintEmail: sendBillReprintEmailSpy,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { billsRouter } from "./bills";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(path: string, method: "post" | "get" | "put") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (billsRouter as any).stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const reprintLog = getHandler("/:id/reprint-log", "post");

function makeReq(body: Record<string, unknown>, sessionName: string | null) {
  return {
    body,
    params: { id: "42" },
    staffSession:
      sessionName === null
        ? undefined
        : { subjectName: sessionName, subjectId: 7, role: "staff" },
  };
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  billRow = {
    id: 42,
    billNumber: "0042",
    patientId: 7,
    totalAmount: "500.00",
    status: "paid",
  };
  patientRow = { id: 7, firstName: "Ravi", lastName: "Kumar" };
  insertedAudits = [];
  auditUpdates = [];
  auditCounts = [{ count: 1 }];
  emailCalls = [];
  sendBillReprintEmailSpy.mockReset();
  sendBillReprintEmailSpy.mockImplementation(
    async (opts: Record<string, unknown>) => {
      emailCalls.push(opts);
      return Promise.resolve();
    },
  );
});

describe("POST /api/bills/:id/reprint-log — attribution comes from the session", () => {
  test("the audit row and email carry the SESSION name even when the body names someone else", async () => {
    const res = makeRes();
    await reprintLog(
      makeReq(
        { reprintedBy: "Someone Else Entirely", reason: "printer jam" },
        "Priya Sharma",
      ),
      res,
    );

    expect(insertedAudits).toHaveLength(1);
    expect(insertedAudits[0]["editedBy"]).toBe("Priya Sharma");
    expect(insertedAudits[0]["editedBy"]).not.toBe("Someone Else Entirely");

    // Reason, audit shape, and sequence numbering are preserved.
    expect(insertedAudits[0]["reason"]).toBe("printer jam");
    expect(insertedAudits[0]["changeType"]).toBe("reprint");
    expect(auditUpdates).toHaveLength(1);
    expect(auditUpdates[0]["newValue"]).toBe("reprint #1");

    // The admin email is attributed to the session identity too.
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0]["reprintedBy"]).toBe("Priya Sharma");
    expect(emailCalls[0]["reason"]).toBe("printer jam");
    expect(emailCalls[0]["reprintCount"]).toBe(1);

    expect(res.statusCode).toBe(200);
  });

  test("REGRESSION (behaviour preserved): reason and sequence flow through exactly as before", async () => {
    await reprintLog(
      makeReq(
        { reprintedBy: "Desk Cashier", reason: "patient lost the copy" },
        "Desk Cashier",
      ),
      makeRes(),
    );
    expect(insertedAudits[0]["reason"]).toBe("patient lost the copy");
    expect(insertedAudits[0]["changeType"]).toBe("reprint");
    expect(auditUpdates[0]["newValue"]).toBe("reprint #1");
    expect(emailCalls[0]["reason"]).toBe("patient lost the copy");
  });

  test("defensive fallback: a blank session name falls back to the body value so editedBy is never empty", async () => {
    await reprintLog(
      makeReq({ reprintedBy: "Legacy Client Name", reason: "reprint" }, "  "),
      makeRes(),
    );
    expect(insertedAudits[0]["editedBy"]).toBe("Legacy Client Name");
  });

  test("bill not found is still a 404 with no audit row", async () => {
    billRow = null;
    const res = makeRes();
    await reprintLog(
      makeReq({ reprintedBy: "Anyone", reason: "r" }, "Priya Sharma"),
      res,
    );
    expect(res.statusCode).toBe(404);
    expect(insertedAudits).toHaveLength(0);
  });
});

// ── Source contracts — the wiring the mock cannot reach ─────────────────────

describe("reprint attribution — source contracts", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dirname, "bills.ts"), "utf8");

  function reprintRegion(): string {
    const start = src.indexOf('billsRouter.post("/:id/reprint-log"');
    expect(start, "reprint-log route must exist").toBeGreaterThan(-1);
    const end = src.indexOf('billsRouter.get("/:id/audits"', start);
    expect(end, "audits route (region boundary) must exist").toBeGreaterThan(
      start,
    );
    return src.slice(start, end);
  }

  test("the actor is derived from req.staffSession BEFORE the body value", () => {
    const region = reprintRegion();
    expect(region).toContain("staffSession?.subjectName?.trim()");
    expect(region).toMatch(/staffSession\?\.subjectName\?\.trim\(\)\s*\|\|/);
  });

  test("the reason still comes from the request body, unchanged", () => {
    const region = reprintRegion();
    expect(region).toContain("const reason = bodyParsed.data.reason.trim()");
  });

  test("the audit row and the email both use the session-derived actor", () => {
    const region = reprintRegion();
    expect(region).toContain("editedBy: reprintedBy");
    expect(region).toContain("reprintedBy,");
  });
});
