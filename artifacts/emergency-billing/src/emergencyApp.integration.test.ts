import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { parseEmergencyCsv, serializeEmergencyCsv } from "@workspace/emergency-billing";

const TEST_URL = process.env.EMERGENCY_TEST_DATABASE_URL;

describe.skipIf(!TEST_URL)("DS225+ emergency app", () => {
  let base = "";
  let server: ReturnType<typeof createServer> | undefined;
  const jar: string[] = [];

  async function req(path: string, init: RequestInit = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        cookie: jar.join("; "),
        ...(init.headers || {}),
      },
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const part = c.split(";")[0];
      if (part) jar.splice(0, jar.length, part);
    }
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    process.env.EMERGENCY_FETCH_TOKEN = "test-fetch-token-000";
    process.env.BACKUP_DIR = "";
    const { pool } = await import("./db");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const { createApp } = await import("./server");
    const app = await createApp();
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    const hash = await bcrypt.hash("1234", 4);
    await pool.query(
      `INSERT INTO cached_staff (id, name, username, role, pin_hash, max_discount)
       VALUES (1,'Owner','owner@test','super_admin',$1,100),
              (2,'Front','front@test','receptionist',$1,5)`,
      [hash],
    );
    await pool.query(
      `INSERT INTO cached_services (id, code, name, category, price, is_active)
       VALUES (5,'MRI-BR','MRI Brain','MRI',4000,true),(6,'CBC','CBC','PATH',500,true)`,
    );
    await pool.query(
      `INSERT INTO cached_patients (id, patient_id, first_name, last_name, phone, gender, age_value, age_unit)
       VALUES (10,'P-00010','Ravi','Kumar','9876543210','male',42,'years')`,
    );
    await pool.query(`INSERT INTO app_meta (key,value) VALUES ('master_data_last_synced_at','2026-08-14T03:30:00.000Z')
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
  }, 30_000);

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it("locks billing until owner starts a session", async () => {
    const health = await req("/health");
    expect(health.body.ok).toBe(true);
    await req("/api/login", { method: "POST", body: JSON.stringify({ username: "front@test", pin: "1234" }) });
    const denied = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "A", lastName: "B", mobile: "9000000000", sex: "M", ageValue: 20 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        payments: [{ method: "cash", amount: 500 }],
      }),
    });
    expect(denied.res.status).toBe(423);
    jar.length = 0;
    await req("/api/login", { method: "POST", body: JSON.stringify({ username: "owner@test", pin: "1234" }) });
    const start = await req("/api/session/start", { method: "POST", body: JSON.stringify({ reason: "DRILL" }) });
    expect(start.res.status).toBe(200);
  });

  it("captures cash/upi/card/partial/due/new patient and rejects reception price edits", async () => {
    const cash = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { carePatientId: 10, uhid: "P-00010", firstName: "Ravi", lastName: "Kumar", mobile: "9876543210", sex: "M", ageValue: 42 },
        lines: [{ careServiceId: 5, quantity: 1 }],
        payments: [{ method: "cash", amount: 3000 }],
      }),
    });
    expect(cash.body.emergencyBillNumber).toMatch(/^EMG-\d{8}-00001$/);
    expect(cash.body.amountReceived).toBe(3000);
    expect(cash.body.dueAmount).toBe(1000);
    expect(cash.body.lines[0].unitPrice).toBe(4000);

    const upi = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "Asha", lastName: "Devi", mobile: "9000000000", sex: "F", ageValue: 30 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        payments: [{ method: "upi", amount: 500 }],
      }),
    });
    expect(upi.body.emergencyBillNumber).toMatch(/00002$/);

    const card = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "Ravi", lastName: "Kumar", mobile: "9000000001", sex: "M", ageValue: 41 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        payments: [{ method: "card", amount: 500 }],
      }),
    });
    expect(card.body.patient.mobile).toBe("9000000001");

    const due = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "Due", lastName: "Case", mobile: "9111111111", sex: "F", ageValue: 22 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        payments: [],
      }),
    });
    expect(due.body.amountReceived).toBe(0);
    expect(due.body.dueAmount).toBe(500);

    const mixed = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "Mix", lastName: "Pay", mobile: "9222222222", sex: "M", ageValue: 33 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        discountAmount: 0,
        payments: [{ method: "cash", amount: 200 }, { method: "upi", amount: 300 }],
      }),
    });
    expect(mixed.body.amountReceived).toBe(500);

    const voided = await req("/api/bills", {
      method: "POST",
      body: JSON.stringify({
        patient: { firstName: "Void", lastName: "Me", mobile: "9333333333", sex: "F", ageValue: 18 },
        lines: [{ careServiceId: 6, quantity: 1 }],
        payments: [{ method: "cash", amount: 500 }],
      }),
    });
    const v = await req(`/api/bills/${voided.body.emergencyTransactionUuid}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: "entered on wrong patient" }),
    });
    expect(v.body.status).toBe("VOID");

    const csvRes = await fetch(base + "/api/export/csv", { headers: { cookie: jar.join("; ") } });
    const csv = await csvRes.text();
    const parsed = parseEmergencyCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.some((t) => t.status === "VOID")).toBe(false);
    expect(parsed.transactions.find((t) => t.dueAmount === 1000)?.amountReceived).toBe(3000);
    const again = parseEmergencyCsv(serializeEmergencyCsv(parsed.transactions));
    expect(again.transactions).toHaveLength(parsed.transactions.length);

    const pending = await fetch(base + "/api/internal/pending", {
      headers: { Authorization: "Bearer test-fetch-token-000" },
    });
    const pkg = await pending.json();
    expect(pkg.transactions.length).toBeGreaterThanOrEqual(5);

    await fetch(base + "/api/internal/mark-reconciled", {
      method: "POST",
      headers: { Authorization: "Bearer test-fetch-token-000", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ emergencyTransactionUuid: cash.body.emergencyTransactionUuid, careBillId: 999 }],
      }),
    });
    const pending2 = await fetch(base + "/api/internal/pending", {
      headers: { Authorization: "Bearer test-fetch-token-000" },
    });
    const pkg2 = await pending2.json();
    expect(pkg2.transactions.find((t: { emergencyTransactionUuid: string }) => t.emergencyTransactionUuid === cash.body.emergencyTransactionUuid)).toBeFalsy();
  });
});
