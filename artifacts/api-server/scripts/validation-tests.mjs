// Lightweight request-validation test suite for @workspace/api-server.
//
// Hits the live api-server on localhost:80 (via the shared proxy), authenticated
// the DB (bypasses /staff-login PIN flow).
//
// Runs a table of cases and asserts each one returns the expected status and
// (where applicable) the standard `{ error, details }` shape. Exits non-zero
// on the first failure, which makes it CI-friendly.

import crypto from "node:crypto";
import { Pool } from "pg";

const BASE = process.env.API_BASE_URL || "http://localhost:80";
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const pool = new Pool({ connectionString: DB_URL });

async function mintStaffToken() {
  const { rows } = await pool.query(
  );
  const user = rows[0];
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
  await pool.query(
    `insert into portal_sessions (token, scope, subject_id, subject_name, expires_at)
     values ($1, 'staff', $2, $3, $4)`,
    [token, user.id, user.name ?? "", expiresAt],
  );
  return { token, userId: user.id };
}

async function dropStaffToken(token) {
  await pool.query(`delete from portal_sessions where token = $1`, [token]);
}

let pass = 0;
let fail = 0;
const failures = [];

async function check(name, run) {
  try {
    await run();
    pass++;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    fail++;
    failures.push({ name, message: err?.message ?? String(err) });
    process.stdout.write(`  FAIL ${name}\n        ${err?.message ?? err}\n`);
  }
}

function expectStatus(actual, expected, body) {
  if (actual !== expected) {
    throw new Error(`expected status ${expected}, got ${actual} (body: ${JSON.stringify(body).slice(0, 300)})`);
  }
}

function expectErrorEnvelope(body) {
  if (!body || typeof body !== "object" || typeof body.error !== "string") {
    throw new Error(`expected { error: string, ... } envelope, got ${JSON.stringify(body).slice(0, 200)}`);
  }
}

async function req(token, method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}

async function main() {
  console.log(`> validation-tests against ${BASE}`);
  const { token } = await mintStaffToken();

  try {
    console.log("\n# auth + ledgerId guards");

    await check("GET /api/tokens/today without ledgerId → 400", async () => {
      const r = await req(token, "GET", "/api/tokens/today");
      expectStatus(r.status, 400, r.body);
      expectErrorEnvelope(r.body);
    });
    await check("GET /api/tokens/today?ledgerId=abc → 400", async () => {
      const r = await req(token, "GET", "/api/tokens/today?ledgerId=abc");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/tokens/today?ledgerId=-1 → 400", async () => {
      const r = await req(token, "GET", "/api/tokens/today?ledgerId=-1");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/tokens/today?ledgerId=1 → 200 (deprecated)", async () => {
      const r = await req(token, "GET", "/api/tokens/today?ledgerId=1");
      expectStatus(r.status, 200, r.body);
      if (!Array.isArray(r.body)) throw new Error("expected array");
      const dep = r.headers.get("deprecation") || r.headers.get("Deprecation");
      if (!dep) throw new Error("expected Deprecation header on legacy /api/tokens");
    });

    await check("GET /api/test-tokens/today without ledgerId → 400", async () => {
      const r = await req(token, "GET", "/api/test-tokens/today");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/test-tokens/today?ledgerId=1 → 200", async () => {
      const r = await req(token, "GET", "/api/test-tokens/today?ledgerId=1");
      expectStatus(r.status, 200, r.body);
    });

    await check("GET /api/display/queue without ledgerId → 400", async () => {
      const r = await req(token, "GET", "/api/display/queue");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/display/queue?ledgerId=1 → 200", async () => {
      const r = await req(token, "GET", "/api/display/queue?ledgerId=1");
      expectStatus(r.status, 200, r.body);
    });

    console.log("\n# orders: discontinued / unknown tests");

    await check("POST /api/orders empty body → 400", async () => {
      const r = await req(token, "POST", "/api/orders", {});
      expectStatus(r.status, 400, r.body);
      expectErrorEnvelope(r.body);
    });
    await check("POST /api/orders unknown testIds → 400", async () => {
      const r = await req(token, "POST", "/api/orders", {
        patientId: 1, doctorId: null, testIds: [999999],
      });
      expectStatus(r.status, 400, r.body);
    });

    console.log("\n# bills: ledger / doctor required for /preview-number");

    await check("GET /api/bills/preview-number with no ledger / doctor → 400", async () => {
      const r = await req(token, "GET", "/api/bills/preview-number");
      expectStatus(r.status, 400, r.body);
      expectErrorEnvelope(r.body);
    });
    await check("GET /api/bills/preview-number?ledgerId=abc → 400", async () => {
      const r = await req(token, "GET", "/api/bills/preview-number?ledgerId=abc");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/bills/preview-number?ledgerId=999999 → 400 (unknown ledger)", async () => {
      const r = await req(token, "GET", "/api/bills/preview-number?ledgerId=999999");
      expectStatus(r.status, 400, r.body);
    });

    console.log("\n# generic body validation");

    await check("PATCH /api/tokens/9999 with garbage status → 400", async () => {
      const r = await req(token, "PATCH", "/api/tokens/9999", { status: "garbage" });
      expectStatus(r.status, 400, r.body);
    });
    await check("PATCH /api/test-tokens/9999 with priority=99 → 400", async () => {
      const r = await req(token, "PATCH", "/api/test-tokens/9999", { priority: 99 });
      expectStatus(r.status, 400, r.body);
    });

    console.log("\n# numeric path-param coercion (NaN guards)");

    for (const path of [
      "/api/expenses/abc",
      "/api/appointments/abc",
      "/api/hr-forms/abc",
    ]) {
      await check(`GET ${path} → 400 (NaN id)`, async () => {
        const r = await req(token, "GET", path);
        expectStatus(r.status, 400, r.body);
      });
      await check(`DELETE ${path} → 400 (NaN id)`, async () => {
        const r = await req(token, "DELETE", path);
        // hr-forms has no DELETE; tolerate 404 from express
        if (r.status === 404 && path.includes("hr-forms")) return;
        expectStatus(r.status, 400, r.body);
      });
    }

    console.log("\n# accounting: NaN id guards + body validation");

    for (const path of [
      "/api/accounting/accounts/abc",
      "/api/accounting/vouchers/abc",
      "/api/accounting/vouchers/abc/audits",
    ]) {
      await check(`${path} → 400 (NaN id)`, async () => {
        const r = await req(token, "GET", path);
        // PATCH/DELETE for accounts/vouchers also share the guard, but a GET
        // probe is enough to confirm the parser fires before drizzle.
        if (path.endsWith("/audits")) {
          expectStatus(r.status, 400, r.body);
        } else {
          // /accounts/abc and /vouchers/abc are not GET routes — express will
          // 404. Probe with PATCH instead so we hit the guard.
          const r2 = await req(token, "PATCH", path, {});
          expectStatus(r2.status, 400, r2.body);
        }
      });
    }
    await check("DELETE /api/accounting/vouchers/abc → 400 (NaN id)", async () => {
      const r = await req(token, "DELETE", "/api/accounting/vouchers/abc");
      expectStatus(r.status, 400, r.body);
    });
    await check("POST /api/accounting/accounts {} → 400 (zod)", async () => {
      const r = await req(token, "POST", "/api/accounting/accounts", {});
      expectStatus(r.status, 400, r.body);
      expectErrorEnvelope(r.body);
    });
    await check("POST /api/accounting/vouchers {} → 400 (zod)", async () => {
      const r = await req(token, "POST", "/api/accounting/vouchers", {});
      expectStatus(r.status, 400, r.body);
      expectErrorEnvelope(r.body);
    });

    console.log("\n# radiology: staffId guard");

    await check("GET /api/radiology/worklist?assigned=mine&staffId=abc → 400", async () => {
      const r = await req(token, "GET", "/api/radiology/worklist?assigned=mine&staffId=abc");
      expectStatus(r.status, 400, r.body);
    });
    await check("GET /api/radiology/worklist?assigned=mine (no staffId) → 400", async () => {
      const r = await req(token, "GET", "/api/radiology/worklist?assigned=mine");
      expectStatus(r.status, 400, r.body);
    });

    console.log("\n# backup-replication: admin-only endpoints");

    await check("GET /api/admin/backup-replication/jobs → 200", async () => {
      const r = await req(token, "GET", "/api/admin/backup-replication/jobs");
      expectStatus(r.status, 200, r.body);
      if (!Array.isArray(r.body)) throw new Error("expected array of jobs");
    });

    await check("POST /api/admin/backup-replication/jobs → 201", async () => {
      const r = await req(token, "POST", "/api/admin/backup-replication/jobs", {
        jobName: "Test Backup Job",
        backupType: "DB",
        destinationType: "LOCAL",
        schedule: "MANUAL",
      });
      expectStatus(r.status, 201, r.body);
      if (!r.body.id) throw new Error("expected job id in response");
      // Clean up the test job
      await req(token, "DELETE", `/api/admin/backup-replication/jobs/${r.body.id}`);
    });

    console.log("\n# backup-replication: export endpoints");

    await check("POST /api/admin/backup-replication/export-db → 200", async () => {
      const r = await req(token, "POST", "/api/admin/backup-replication/export-db", {});
      expectStatus(r.status, 200, r.body);
      if (!r.body.ok || !r.body.filename || !r.body.filePath) {
        throw new Error("expected { ok, filename, filePath } in response");
      }
    });

    await check("POST /api/admin/backup-replication/export-files → 200", async () => {
      const r = await req(token, "POST", "/api/admin/backup-replication/export-files", {});
      expectStatus(r.status, 200, r.body);
      if (!r.body.ok || !r.body.filename) {
        throw new Error("expected { ok, filename } in response");
      }
    });

    await check("POST /api/admin/backup-replication/export-snapshot → 200", async () => {
      const r = await req(token, "POST", "/api/admin/backup-replication/export-snapshot", {});
      expectStatus(r.status, 200, r.body);
      if (!r.body.ok || !r.body.filename || !r.body.metadata) {
        throw new Error("expected { ok, filename, metadata } in response");
      }
    });
  } finally {
    await dropStaffToken(token);
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});