import { describe, expect, test, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Corridor audit F5 — share tokens for unverified/draft reports (and draft bills).
//
// Root cause under test: POST /api/whatsapp-delivery/share-token checked only
// that the row EXISTS. A draft report — clinical content never finalized —
// got a 7-day signed public link, and /api/share/report/:token then showed
// patient name + title + "draft" status to anyone with the link. The bill
// branch blocked only `cancelled`, so unissued drafts were shareable
// server-side even though the desktop UI disables the button.
//
// Policy (verified against every adjacent door before writing this):
//   - POST /patient-reports/:id/public-link  → 409 unless verified/delivered
//   - printed report QR (generateReportQrDataUrl) → verified/delivered only
//   - POST /patient-reports/:id/share (Cloud API send) → pending_verification
//     allowed — the approved signed-but-not-countersigned workflow, untouched
// No existing workflow mints THIS route's token for a pending_verification
// report (the dialog that calls it is mounted only for kind="bill"), so the
// gate regresses nothing.

let billRow: Record<string, unknown> | null;
let reportRow: Record<string, unknown> | null;

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
  // Drizzle query builders are thenables; production awaits them directly
  // (`.where(cond)`) and via chained `.limit()` / `.leftJoin().where()`.
  const rowsFor = (name: string) => {
    if (name === "bills") return billRow ? [billRow] : [];
    if (name === "patient_reports") return reportRow ? [reportRow] : [];
    if (name === "patients")
      return [
        { id: 7, firstName: "Ravi", lastName: "Kumar", patientId: "P-7" },
      ];
    if (name === "clinic_settings")
      return [{ id: 1, name: "Care Diagnostics" }];
    return [];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chainFor = (table: unknown): any => {
    const name = nameOf(table);
    const rows = async () => rowsFor(name);
    const thenable: Record<string, unknown> = {
      limit: rows,
      orderBy: () => ({ limit: rows }),
      for: () => ({ limit: rows }),
      then: (
        onFulfilled: (v: unknown) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => Promise.resolve().then(rows).then(onFulfilled, onRejected),
    };
    return {
      where: () => thenable,
      leftJoin: () => ({ where: () => thenable }),
      ...thenable,
    };
  };
  return {
    db: {
      select: (_fields?: Record<string, unknown>) => ({
        from: (t: unknown) => chainFor(t),
      }),
      insert: () => ({ values: async () => [] }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    },
    billsTable: {
      __name: "bills",
      id: "id",
      status: "status",
      patientId: "patient_id",
      orderId: "order_id",
      billNumber: "bill_number",
    },
    patientsTable: {
      __name: "patients",
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      patientId: "patient_id",
    },
    paymentsTable: { __name: "payments", billId: "bill_id" },
    patientReportsTable: {
      __name: "patient_reports",
      id: "id",
      status: "status",
      patientId: "patient_id",
    },
    orderTestsTable: {
      __name: "order_tests",
      orderId: "order_id",
      testId: "test_id",
    },
    testsTable: { __name: "tests", id: "id" },
    clinicSettingsTable: { __name: "clinic_settings", id: "id" },
    waDeliveryQueueTable: { __name: "wa_delivery_queue", id: "id" },
    waDeliveryAuditTable: { __name: "wa_delivery_audit", id: "id" },
    onlineBookingsTable: { __name: "online_bookings", id: "id" },
  };
});

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "corridor-f5-test-secret";

import { whatsappDeliveryRouter, publicShareRouter } from "./whatsappDelivery";
import { mintShareToken } from "../lib/whatsappShareToken";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandler(router: any, path: string, method: "post" | "get") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const mintHandler = getHandler(whatsappDeliveryRouter, "/share-token", "post");
const billViewHandler = getHandler(publicShareRouter, "/bill/:token", "get");
const reportViewHandler = getHandler(
  publicShareRouter,
  "/report/:token",
  "get",
);

function makeReq(
  body: Record<string, unknown>,
  params: Record<string, string> = {},
) {
  return {
    body,
    params,
    headers: {},
    protocol: "http",
    get: (h: string) => (h === "host" ? "care.example" : undefined),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRes(): any {
  const res: Record<string, unknown> = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    setHeader(k: string, v: string) {
      (this.headers as Record<string, string>)[k] = v;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  billRow = {
    id: 42,
    billNumber: "0042",
    status: "paid",
    patientId: 7,
    orderId: 3,
    totalAmount: "500.00",
    paidAmount: "500.00",
    balanceAmount: "0.00",
    createdAt: new Date("2026-01-01T10:00:00Z"),
  };
  reportRow = {
    id: 55,
    reportNumber: "RPT-0055",
    status: "verified",
    title: "MRI Brain",
    patientId: 7,
    verifiedAt: new Date("2026-01-02T10:00:00Z"),
    publicToken: null,
  };
});

describe("POST /api/whatsapp-delivery/share-token — report branch is gated to released reports", () => {
  test("a DRAFT report is refused (409) — no public link for unfinalized clinical content", async () => {
    reportRow = { ...reportRow!, status: "draft" };
    const res = makeRes();
    await mintHandler(makeReq({ kind: "report", recordId: 55 }), res);
    expect(res.statusCode).toBe(409);
    expect((res.payload as { error: string }).error).toContain("verified");
  });

  test("a pending_verification report is refused — countersigned-first policy, like /public-link", async () => {
    reportRow = { ...reportRow!, status: "pending_verification" };
    const res = makeRes();
    await mintHandler(makeReq({ kind: "report", recordId: 55 }), res);
    expect(res.statusCode).toBe(409);
  });

  test("verified and delivered reports still mint (regression — the approved flow is unchanged)", async () => {
    for (const status of ["verified", "delivered"]) {
      reportRow = { ...reportRow!, status };
      const res = makeRes();
      await mintHandler(makeReq({ kind: "report", recordId: 55 }), res);
      expect(res.statusCode).toBe(200);
      const payload = res.payload as {
        token: string;
        url: string;
        expiryDays: number;
      };
      expect(payload.token).toBeTruthy();
      expect(payload.url).toContain("/erp/share/report/");
      expect(payload.expiryDays).toBe(7);
    }
  });

  test("unknown report id is still 404", async () => {
    reportRow = null;
    const res = makeRes();
    await mintHandler(makeReq({ kind: "report", recordId: 999 }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/whatsapp-delivery/share-token — bill branch blocks drafts like the UI does", () => {
  test("a DRAFT bill is refused with the same wording the desktop shows", async () => {
    billRow = { ...billRow!, status: "draft" };
    const res = makeRes();
    await mintHandler(makeReq({ kind: "bill", recordId: 42 }), res);
    expect(res.statusCode).toBe(409);
    expect((res.payload as { error: string }).error).toContain(
      "issue the bill first",
    );
  });

  test("cancelled bill is still refused (regression)", async () => {
    billRow = { ...billRow!, status: "cancelled" };
    const res = makeRes();
    await mintHandler(makeReq({ kind: "bill", recordId: 42 }), res);
    expect(res.statusCode).toBe(400);
    expect((res.payload as { error: string }).error).toContain("Cancelled");
  });

  test("issued bills (pending/partial/paid) still mint (regression)", async () => {
    for (const status of ["pending", "partial", "paid"]) {
      billRow = { ...billRow!, status };
      const res = makeRes();
      await mintHandler(makeReq({ kind: "bill", recordId: 42 }), res);
      expect(res.statusCode).toBe(200);
      expect((res.payload as { url: string }).url).toContain(
        "/erp/share/bill/",
      );
    }
  });
});

describe("GET /api/share/report/:token — the public view enforces the same policy", () => {
  const secret = process.env.SESSION_SECRET!;

  test("a token pointing at a draft report serves the expired/invalid shape, never PHI", async () => {
    reportRow = { ...reportRow!, status: "draft" };
    const { token } = mintShareToken("report", 55, { secret });
    const res = makeRes();
    await reportViewHandler(makeReq({}, { token }), res);
    expect(res.statusCode).toBe(410);
    const payload = res.payload as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
  });

  test("a token pointing at a verified report still serves the PHI-minimal view (regression)", async () => {
    const { token } = mintShareToken("report", 55, { secret });
    const res = makeRes();
    await reportViewHandler(makeReq({}, { token }), res);
    expect(res.statusCode).toBe(200);
    const payload = res.payload as {
      ok: boolean;
      report: { patientName: string; status: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.report.status).toBe("verified");
    expect(payload.report.patientName).toBe("Ravi Kumar");
  });

  test("a report that is verified-then-…-nothing-else: non-verified statuses are all refused", async () => {
    for (const status of ["draft", "pending_verification", "amended"]) {
      reportRow = { ...reportRow!, status };
      const { token } = mintShareToken("report", 55, { secret });
      const res = makeRes();
      await reportViewHandler(makeReq({}, { token }), res);
      expect(res.statusCode).toBe(410);
    }
  });

  test("expired / malformed tokens still serve the expired shape (regression)", async () => {
    for (const token of [
      "garbage",
      "x.y",
      mintShareToken("report", 55, {
        secret,
        ttlDays: 1,
        nowMs: Date.now() - 10 * 24 * 3600 * 1000,
      }).token,
    ]) {
      const res = makeRes();
      await reportViewHandler(makeReq({}, { token }), res);
      expect(res.statusCode).toBe(410);
    }
  });
});

describe("GET /api/share/bill/:token — draft bills answer expired/invalid too", () => {
  const secret = process.env.SESSION_SECRET!;

  test("a token pointing at a draft bill serves the expired/invalid shape", async () => {
    billRow = { ...billRow!, status: "draft" };
    const { token } = mintShareToken("bill", 42, { secret });
    const res = makeRes();
    await billViewHandler(makeReq({}, { token }), res);
    expect(res.statusCode).toBe(410);
  });

  test("a token pointing at a paid bill still serves the public view (regression)", async () => {
    const { token } = mintShareToken("bill", 42, { secret });
    const res = makeRes();
    await billViewHandler(makeReq({}, { token }), res);
    expect(res.statusCode).toBe(200);
    const payload = res.payload as {
      ok: boolean;
      bill: { billNumber: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.bill.billNumber).toBe("0042");
  });

  test("cancelled bills still answer expired/invalid (regression)", async () => {
    billRow = { ...billRow!, status: "cancelled" };
    const { token } = mintShareToken("bill", 42, { secret });
    const res = makeRes();
    await billViewHandler(makeReq({}, { token }), res);
    expect(res.statusCode).toBe(410);
  });
});

// ── Cross-side contracts — one policy, both sides of the wire ───────────────

describe("cross-side contracts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const erpRoot = join(here, "../../../diagnostic-erp/src");

  test("the server bill gate mirrors the desktop UI's isBillIssuableForWhatsApp", () => {
    const dialog = readFileSync(
      join(erpRoot, "components/WhatsAppDeliveryDialog.tsx"),
      "utf8",
    );
    // UI: if (!s || s === "draft" || s === "cancelled") return false;
    expect(dialog).toMatch(
      /if \(!s \|\| s === "draft" \|\| s === "cancelled"\) return false;/,
    );
  });

  test("the /share Cloud-API workflow (pending_verification allowed) is a DIFFERENT, untouched door", () => {
    // Documents the deliberate asymmetry: the ERP's whatsappShareGate mirrors
    // POST /patient-reports/:id/share, which may deliver a signed-but-not-
    // countersigned report. This route is stricter on purpose; if someone
    // "unifies" them by relaxing this gate, that intent should surface here.
    const gate = readFileSync(
      join(erpRoot, "lib/whatsappShareGate.ts"),
      "utf8",
    );
    expect(gate).toContain('"pending_verification"');
    const route = readFileSync(join(here, "whatsappDelivery.ts"), "utf8");
    expect(route).toContain(
      'report.status !== "verified" && report.status !== "delivered"',
    );
    // …and it appears in BOTH the mint route and the public view.
    expect(
      route.match(
        /report\.status !== "verified" && report\.status !== "delivered"/g,
      )?.length,
    ).toBe(2);
  });
});
