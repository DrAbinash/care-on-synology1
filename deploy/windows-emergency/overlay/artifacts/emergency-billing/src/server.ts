import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import bcrypt from "bcryptjs";
import {
  advertisedEmergencyCapability,
  buildEmergencyJsonPackage,
  countsFromSnapshot,
  formatEmgBillNumber,
  istYyyymmdd,
  parseMasterSnapshot,
  searchCachedDoctors,
  serializeEmergencyCsv,
  sha256Hex,
  snapshotAgeBand,
  snapshotAgeHours,
  SOURCE,
  UnsupportedContractError,
  type EmergencySessionRecord,
  type EmergencyTransaction,
  type MasterDataSnapshot,
} from "@workspace/emergency-billing";
import { bootstrapSchema, pool } from "./db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = "emg_session";
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const FETCH_TOKEN = process.env.EMERGENCY_FETCH_TOKEN || "";
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const PRIMARY_CARE_URL = String(process.env.PRIMARY_CARE_URL || "").replace(/\/+$/, "");
const DEVICE_ID = process.env.EMERGENCY_DEVICE_ID || "windows-emergency";
const CARE_OFFLINE_GRACE_MS = Math.max(15_000, Number(process.env.CARE_OFFLINE_GRACE_MS || 90_000));
const MASTER_PULL_INTERVAL_HOURS = Math.max(0, Number(process.env.MASTER_PULL_INTERVAL_HOURS || 6));

type CareReachability = {
  state: "online" | "offline" | "unknown";
  label: string;
  consecutiveFailures: number;
  lastOkAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

const careReach: CareReachability = {
  state: "unknown",
  label: "Not configured",
  consecutiveFailures: 0,
  lastOkAt: null,
  lastCheckedAt: null,
  lastError: null,
};

type Staff = {
  id: number;
  name: string;
  username: string;
  role: string;
  maxDiscount: number;
};

interface AuthedRequest extends Request {
  staff?: Staff;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return ha.length === hb.length && ha.equals(hb) && a.length === b.length;
}

async function audit(staff: Staff | null, action: string, entityUuid: string | null, detail: string, ip?: string) {
  await pool.query(
    `INSERT INTO emergency_audit (staff_id, staff_name, action, entity_uuid, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [staff?.id ?? null, staff?.name ?? "system", action, entityUuid, detail, ip ?? null],
  );
}

async function getMeta(key: string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(`SELECT value FROM app_meta WHERE key=$1`, [key]);
  return rows[0]?.value ?? "";
}

async function setMeta(key: string, value: string) {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [key, value],
  );
}

async function activeSession(): Promise<EmergencySessionRecord | null> {
  const { rows } = await pool.query(
    `SELECT uuid, started_at, started_by_staff_id, started_by_staff_name, reason, workstation,
            ended_at, ended_by_staff_id, ended_by_staff_name
     FROM emergency_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    emergencySessionUuid: r.uuid,
    startedAt: new Date(r.started_at).toISOString(),
    startedByStaffId: r.started_by_staff_id,
    startedByStaffName: r.started_by_staff_name,
    reason: r.reason,
    workstation: r.workstation,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    endedByStaffId: r.ended_by_staff_id,
    endedByStaffName: r.ended_by_staff_name,
  };
}

function rowToTxn(row: { uuid: string; bill_number: string; payload_json: EmergencyTransaction; status: string }): EmergencyTransaction {
  const p = row.payload_json;
  return { ...p, emergencyTransactionUuid: row.uuid, emergencyBillNumber: row.bill_number, status: row.status as EmergencyTransaction["status"] };
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "");
  if (!token) {
    res.status(401).json({ error: "Please log in" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT staff_id, staff_name, role, max_discount, expires_at FROM staff_sessions WHERE token=$1`,
    [token],
  );
  const s = rows[0];
  if (!s || new Date(s.expires_at) < new Date()) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  req.staff = {
    id: s.staff_id,
    name: s.staff_name,
    username: "",
    role: s.role,
    maxDiscount: Number(s.max_discount || 0),
  };
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.staff || !ADMIN_ROLES.has(req.staff.role)) {
    res.status(403).json({ error: "Owner / admin only" });
    return;
  }
  next();
}

function requireFetchToken(req: Request, res: Response, next: NextFunction) {
  if (!FETCH_TOKEN) {
    res.status(503).json({ error: "EMERGENCY_FETCH_TOKEN is not configured on this NAS" });
    return;
  }
  const got = String(req.headers["x-emergency-fetch-token"] || "").replace(/^Bearer\s+/i, "")
    || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!got || !timingSafeEqualStr(got, FETCH_TOKEN)) {
    res.status(401).json({ error: "Invalid fetch token" });
    return;
  }
  next();
}

async function masterSyncStatus() {
  const synced = await getMeta("master_data_last_synced_at");
  const syncedAt = synced || null;
  const { rows: svc } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cached_services`);
  const { rows: doc } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cached_doctors`);
  const { rows: pat } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cached_patients`);
  const { rows: staff } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cached_staff`);
  return {
    masterDataLastSyncedAt: syncedAt,
    neverSynced: !syncedAt,
    ageBand: snapshotAgeBand(syncedAt),
    snapshotAgeHours: snapshotAgeHours(syncedAt),
    counts: {
      serviceCount: Number(svc[0]?.n || 0),
      doctorCount: Number(doc[0]?.n || 0),
      patientCount: Number(pat[0]?.n || 0),
      staffCount: Number(staff[0]?.n || 0),
    },
  };
}

export async function applyMasterSnapshot(snap: MasterDataSnapshot): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM cached_services");
    for (const s of snap.services) {
      await client.query(
        `INSERT INTO cached_services (id, code, name, category, price, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.id, s.code, s.name, s.category, s.price, s.isActive],
      );
    }
    await client.query("DELETE FROM cached_doctors");
    for (const d of snap.doctors) {
      await client.query(`INSERT INTO cached_doctors (id, name, specialization) VALUES ($1,$2,$3)`, [d.id, d.name, d.specialization]);
    }
    await client.query("DELETE FROM cached_patients");
    for (const p of snap.patients) {
      await client.query(
        `INSERT INTO cached_patients (id, patient_id, first_name, last_name, phone, gender, date_of_birth, age_value, age_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, p.patientId, p.firstName, p.lastName, p.phone, p.gender, p.dateOfBirth, p.ageValue, p.ageUnit],
      );
    }
    await client.query("DELETE FROM cached_staff");
    for (const u of snap.staff) {
      await client.query(
        `INSERT INTO cached_staff (id, name, username, role, pin_hash, max_discount, permissions)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [u.id, u.name, u.username, u.role, u.pinHash, u.maxDiscount, u.permissions],
      );
    }
    await client.query("DELETE FROM cached_discount_reasons");
    for (const reason of snap.discountReasons) {
      await client.query(`INSERT INTO cached_discount_reasons (reason) VALUES ($1) ON CONFLICT DO NOTHING`, [reason]);
    }
    await client.query(
      `INSERT INTO app_meta (key, value) VALUES ('master_data_last_synced_at', $1)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [snap.syncedAt],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function capabilityPayload() {
  let databaseHealthy = false;
  let masterSnapshotCreatedAt: string | null = null;
  try {
    await pool.query("SELECT 1");
    databaseHealthy = true;
    const synced = await getMeta("master_data_last_synced_at");
    masterSnapshotCreatedAt = synced || null;
  } catch {
    databaseHealthy = false;
  }
  return advertisedEmergencyCapability({
    status: databaseHealthy ? "ok" : "degraded",
    appVersion: process.env.APP_VERSION || process.env.npm_package_version || "1.0.0",
    buildSha: process.env.BUILD_SHA || process.env.GIT_COMMIT || "unknown",
    databaseHealthy,
    masterSnapshotPresent: !!masterSnapshotCreatedAt,
    masterSnapshotCreatedAt,
  });
}

export async function createApp() {
  await bootstrapSchema();
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "8mb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "care-emergency-billing" });
  });
  app.get("/api/capability", async (_req, res) => {
    res.json(await capabilityPayload());
  });
  app.get("/api/health", async (_req, res) => {
    const cap = await capabilityPayload();
    res.status(cap.databaseHealthy ? 200 : 503).json({ ok: cap.databaseHealthy, service: "care-emergency-billing", ...cap });
  });

  app.get("/api/status", async (req: AuthedRequest, res) => {
    const session = await activeSession();
    const sync = await masterSyncStatus();
    res.json({
      locked: !session,
      session,
      ...sync,
      source: SOURCE,
      loggedIn: !!req.staff,
    });
  });

  app.post("/api/login", async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const pin = String(req.body?.pin || "");
    if (!username || !pin) {
      res.status(400).json({ error: "Username and PIN required" });
      return;
    }
    const { rows } = await pool.query(`SELECT * FROM cached_staff WHERE lower(username)=$1`, [username]);
    const u = rows[0];
    if (!u || !u.pin_hash || !(await bcrypt.compare(pin, u.pin_hash))) {
      await audit(null, "login_failed", null, username, req.ip);
      res.status(401).json({ error: "Invalid username or PIN" });
      return;
    }
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await pool.query(
      `INSERT INTO staff_sessions (token, staff_id, staff_name, role, max_discount, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, u.id, u.name, u.role, u.max_discount, expires],
    );
    const staff: Staff = { id: u.id, name: u.name, username: u.username, role: u.role, maxDiscount: Number(u.max_discount || 0) };
    await audit(staff, "login", null, "ok", req.ip);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 3600_000 });
    res.json({ name: staff.name, role: staff.role, maxDiscount: staff.maxDiscount });
  });

  app.post("/api/logout", requireAuth, async (req: AuthedRequest, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) await pool.query(`DELETE FROM staff_sessions WHERE token=$1`, [token]);
    await audit(req.staff!, "logout", null, "ok", req.ip);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth, async (req: AuthedRequest, res) => {
    const session = await activeSession();
    const sync = await masterSyncStatus();
    res.json({ staff: req.staff, locked: !session, session, ...sync });
  });

  app.post("/api/session/start", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) {
      res.status(400).json({ error: "Reason is required" });
      return;
    }
    const existing = await activeSession();
    if (existing) {
      res.status(409).json({ error: "An emergency session is already active", session: existing });
      return;
    }
    const uuid = randomUUID();
    const workstation = String(req.body?.workstation || req.headers["x-forwarded-for"] || req.ip || "");
    await pool.query(
      `INSERT INTO emergency_sessions (uuid, started_by_staff_id, started_by_staff_name, reason, workstation)
       VALUES ($1,$2,$3,$4,$5)`,
      [uuid, req.staff!.id, req.staff!.name, reason, workstation],
    );
    await audit(req.staff!, "session_start", uuid, reason, req.ip);
    res.json(await activeSession());
  });

  app.post("/api/session/end", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const current = await activeSession();
    if (!current) {
      res.status(409).json({ error: "No active emergency session" });
      return;
    }
    await pool.query(
      `UPDATE emergency_sessions SET ended_at=now(), ended_by_staff_id=$1, ended_by_staff_name=$2 WHERE uuid=$3`,
      [req.staff!.id, req.staff!.name, current.emergencySessionUuid],
    );
    await audit(req.staff!, "session_end", current.emergencySessionUuid, "closed", req.ip);
    res.json({ ok: true, sessionUuid: current.emergencySessionUuid });
  });

  app.get("/api/patients", requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const like = `%${q.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT * FROM cached_patients
       WHERE lower(first_name) LIKE $1 OR lower(last_name) LIKE $1
          OR lower(first_name || ' ' || last_name) LIKE $1
          OR phone LIKE $2 OR lower(patient_id) LIKE $1
       ORDER BY id DESC LIMIT 25`,
      [like, `%${q.replace(/\D/g, "")}%`],
    );
    res.json(rows);
  });

  app.get("/api/services", requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT * FROM cached_services WHERE is_active=true
       AND ($1='' OR lower(name) LIKE $2 OR lower(code) LIKE $2 OR lower(category) LIKE $2)
       ORDER BY name LIMIT 40`,
      [q, `%${q}%`],
    );
    res.json(rows);
  });

  app.get("/api/doctors", requireAuth, async (req, res) => {
    const q = String(req.query.q || "");
    const { rows } = await pool.query(
      `SELECT id, name, specialization FROM cached_doctors ORDER BY name`,
    );
    res.json(searchCachedDoctors(rows, q));
  });

  app.get("/api/discount-reasons", requireAuth, async (_req, res) => {
    const { rows } = await pool.query(`SELECT reason FROM cached_discount_reasons ORDER BY reason`);
    res.json(rows.map((r) => r.reason));
  });

  app.get("/api/bills", requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT uuid, bill_number, status, created_at, created_by_staff_name, payload_json, care_bill_id, reconciled_at,
              sync_status, sync_error, synced_at, source_device_id, care_destination_id
       FROM emergency_transactions ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(rows.map((r) => ({
      ...rowToTxn(r),
      careBillId: r.care_bill_id,
      reconciledAt: r.reconciled_at,
      syncStatus: r.sync_status || (r.status === "RECONCILED" ? "synced" : r.status === "VOID" ? "void" : "pending"),
      syncError: r.sync_error,
      syncedAt: r.synced_at,
      sourceDeviceId: r.source_device_id,
      careDestinationId: r.care_destination_id,
    })));
  });

  app.post("/api/bills", requireAuth, async (req: AuthedRequest, res) => {
    const session = await activeSession();
    if (!session) {
      res.status(423).json({ error: "EMERGENCY BILLING LOCKED. Ask the owner to start an emergency session." });
      return;
    }
    const body = req.body ?? {};
    const patient = body.patient ?? {};
    const firstName = String(patient.firstName || "").trim();
    const lastName = String(patient.lastName || "").trim() || "-";
    const mobile = String(patient.mobile || "").trim();
    if (!firstName || !mobile) {
      res.status(400).json({ error: "Patient name and mobile are required" });
      return;
    }
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    if (!linesIn.length) {
      res.status(400).json({ error: "Add at least one service" });
      return;
    }
    const lines = [];
    let gross = 0;
    for (const raw of linesIn) {
      const id = Number(raw.careServiceId);
      const { rows: svcRows } = await pool.query(`SELECT * FROM cached_services WHERE id=$1 AND is_active=true`, [id]);
      const svc = svcRows[0];
      if (!svc) {
        res.status(400).json({ error: `Unknown or inactive service ${id}` });
        return;
      }
      const qty = Math.max(1, Number(raw.quantity || 1));
      const unit = Number(svc.price);
      const lineGross = Math.round(qty * unit * 100) / 100;
      gross += lineGross;
      lines.push({
        careServiceId: svc.id,
        serviceCode: svc.code,
        serviceName: svc.name,
        category: svc.category,
        quantity: qty,
        unitPrice: unit,
        lineGross,
      });
    }
    gross = Math.round(gross * 100) / 100;
    const discount = Math.max(0, Number(body.discountAmount || 0));
    if (discount > gross) {
      res.status(400).json({ error: "Discount cannot exceed gross" });
      return;
    }
    if (discount > 0 && !String(body.discountReason || "").trim()) {
      res.status(400).json({ error: "Discount reason is required" });
      return;
    }
    if (!ADMIN_ROLES.has(req.staff!.role) && discount > 0) {
      const maxAllowed = Math.round((gross * (req.staff!.maxDiscount || 0) / 100) * 100) / 100;
      if (discount > maxAllowed + 0.01) {
        res.status(403).json({ error: `Your maximum discount is ${req.staff!.maxDiscount}% (₹${maxAllowed.toFixed(2)})` });
        return;
      }
    }
    const net = Math.round((gross - discount) * 100) / 100;
    const payments = (Array.isArray(body.payments) ? body.payments : [])
      .map((p: { method?: string; amount?: number; referenceNumber?: string }) => ({
        method: p.method === "upi" || p.method === "card" ? p.method : "cash" as const,
        amount: Number(p.amount || 0),
        referenceNumber: p.referenceNumber || null,
      }))
      .filter((p: { amount: number }) => p.amount > 0);
    const received = Math.round(payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0) * 100) / 100;
    if (received > net + 0.01) {
      res.status(400).json({ error: "Amount received cannot exceed net" });
      return;
    }
    const due = Math.round((net - received) * 100) / 100;
    const uuid = randomUUID();
    const tariffSyncedAt = (await getMeta("master_data_last_synced_at")) || null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('emg_bill_number'))");
      const ymd = istYyyymmdd();
      const prefix = `EMG-${ymd}-`;
      const { rows: seqRows } = await client.query<{ maxseq: number | null }>(
        `SELECT MAX(CAST(split_part(bill_number, '-', 3) AS int)) AS maxseq
         FROM emergency_transactions WHERE bill_number LIKE $1`,
        [prefix + "%"],
      );
      const seq = Number(seqRows[0]?.maxseq || 0) + 1;
      const billNumber = formatEmgBillNumber(ymd, seq);
      const txn: EmergencyTransaction = {
        emergencyTransactionUuid: uuid,
        emergencyBillNumber: billNumber,
        emergencySessionUuid: session.emergencySessionUuid,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        createdByStaffId: req.staff!.id,
        createdByStaffName: req.staff!.name,
        patient: {
          carePatientId: patient.carePatientId ? Number(patient.carePatientId) : null,
          uhid: patient.uhid || null,
          firstName,
          lastName,
          sex: patient.sex || "O",
          ageValue: patient.ageValue != null ? Number(patient.ageValue) : null,
          ageUnit: patient.ageUnit || "years",
          dateOfBirth: patient.dateOfBirth || null,
          mobile,
        },
        referringDoctorId: body.referringDoctorId ? Number(body.referringDoctorId) : null,
        referringDoctorName: body.referringDoctorName || null,
        lines,
        grossAmount: gross,
        discountAmount: discount,
        discountReason: body.discountReason || null,
        netAmount: net,
        amountReceived: received,
        dueAmount: due,
        payments,
        notes: body.notes || null,
        tariffSyncedAt,
      };
      await client.query(
        `INSERT INTO emergency_transactions
           (uuid, bill_number, session_uuid, status, created_by_staff_id, created_by_staff_name, payload_json, sync_status, source_device_id)
         VALUES ($1,$2,$3,'PENDING',$4,$5,$6::jsonb,'pending',$7)`,
        [uuid, billNumber, session.emergencySessionUuid, req.staff!.id, req.staff!.name, JSON.stringify(txn), DEVICE_ID],
      );
      await client.query("COMMIT");
      await audit(req.staff!, discount > 0 ? "bill_create_discount" : "bill_create", uuid, billNumber, req.ip);
      for (const p of payments) {
        await audit(req.staff!, "payment", uuid, `${p.method} ₹${p.amount}`, req.ip);
      }
      res.status(201).json(txn);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/api/bills/:uuid/void", requireAuth, async (req: AuthedRequest, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) {
      res.status(400).json({ error: "Void reason is required" });
      return;
    }
    const uuid = String(req.params.uuid);
    const { rows } = await pool.query(`SELECT * FROM emergency_transactions WHERE uuid=$1`, [uuid]);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status === "VOID") {
      res.json(rowToTxn(row));
      return;
    }
    if (row.status === "RECONCILED") {
      res.status(409).json({ error: "Already reconciled into CARE — void on CARE instead" });
      return;
    }
    const payload = { ...row.payload_json, status: "VOID", voidedAt: new Date().toISOString(), voidedByStaffName: req.staff!.name, voidReason: reason };
    await pool.query(
      `UPDATE emergency_transactions
       SET status='VOID', voided_at=now(), voided_by_staff_name=$1, void_reason=$2, payload_json=$3::jsonb
       WHERE uuid=$4`,
      [req.staff!.name, reason, JSON.stringify(payload), uuid],
    );
    await audit(req.staff!, "void", uuid, reason, req.ip);
    res.json(payload);
  });

  app.post("/api/bills/:uuid/reprint", requireAuth, async (req: AuthedRequest, res) => {
    await audit(req.staff!, "reprint", String(req.params.uuid), "print", req.ip);
    res.json({ ok: true });
  });

  app.get("/api/export/csv", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const pendingOnly = String(req.query.pending || "1") !== "0";
    const { rows } = await pool.query(
      pendingOnly
        ? `SELECT uuid, bill_number, payload_json, status FROM emergency_transactions WHERE status != 'VOID' ORDER BY created_at`
        : `SELECT uuid, bill_number, payload_json, status FROM emergency_transactions ORDER BY created_at`,
    );
    const csv = serializeEmergencyCsv(rows.map(rowToTxn));
    await audit(req.staff!, "export_csv", null, `${rows.length} rows`, req.ip);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="CARE_EMERGENCY_BILLING_V1_${istYyyymmdd()}.csv"`);
    res.send(csv);
  });

  app.get("/api/export/json", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const { rows: sessRows } = await pool.query(`SELECT * FROM emergency_sessions ORDER BY started_at`);
    const { rows } = await pool.query(`SELECT uuid, bill_number, payload_json, status FROM emergency_transactions ORDER BY created_at`);
    const sessions: EmergencySessionRecord[] = sessRows.map((r) => ({
      emergencySessionUuid: r.uuid,
      startedAt: new Date(r.started_at).toISOString(),
      startedByStaffId: r.started_by_staff_id,
      startedByStaffName: r.started_by_staff_name,
      reason: r.reason,
      workstation: r.workstation,
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      endedByStaffId: r.ended_by_staff_id,
      endedByStaffName: r.ended_by_staff_name,
    }));
    const pkg = buildEmergencyJsonPackage({
      sessions,
      transactions: rows.map(rowToTxn),
      masterDataLastSyncedAt: (await getMeta("master_data_last_synced_at")) || null,
    });
    await audit(req.staff!, "export_json", null, `${rows.length} rows`, req.ip);
    res.setHeader("Content-Disposition", `attachment; filename="CARE_EMERGENCY_BILLING_JSON_V1_${istYyyymmdd()}.json"`);
    res.json(pkg);
  });

  app.get("/api/export/usb-package", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const { rows: sessRows } = await pool.query(`SELECT * FROM emergency_sessions ORDER BY started_at`);
    const { rows } = await pool.query(`SELECT uuid, bill_number, payload_json, status FROM emergency_transactions ORDER BY created_at`);
    const txns = rows.map(rowToTxn);
    const sessions: EmergencySessionRecord[] = sessRows.map((r) => ({
      emergencySessionUuid: r.uuid,
      startedAt: new Date(r.started_at).toISOString(),
      startedByStaffId: r.started_by_staff_id,
      startedByStaffName: r.started_by_staff_name,
      reason: r.reason,
      workstation: r.workstation,
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      endedByStaffId: r.ended_by_staff_id,
      endedByStaffName: r.ended_by_staff_name,
    }));
    const csv = serializeEmergencyCsv(txns);
    const json = buildEmergencyJsonPackage({
      sessions,
      transactions: txns,
      masterDataLastSyncedAt: (await getMeta("master_data_last_synced_at")) || null,
    });
    const manifest = {
      format: "CARE_EMERGENCY_BACKUP_PACKAGE_V1",
      exportedAt: new Date().toISOString(),
      exportedBy: req.staff!.name,
      transactionCount: txns.length,
      csvSha256: sha256Hex(csv),
      jsonSha256: json.checksumSha256,
      note: "Disaster copy only. Do not run live billing from USB storage.",
    };
    await audit(req.staff!, "export_usb", null, `${txns.length} rows`, req.ip);
    res.json({ manifest, csv, json });
  });

  app.get("/api/internal/ops-status", requireFetchToken, async (_req, res) => {
    const { rows: pending } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM emergency_transactions WHERE status = 'PENDING'`,
    );
    const { rows: openSess } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM emergency_sessions WHERE ended_at IS NULL`,
    );
    const sync = await masterSyncStatus();
    res.json({
      pendingTransactionCount: pending[0]?.n ?? 0,
      openSessionCount: openSess[0]?.n ?? 0,
      masterDataLastSyncedAt: sync.masterDataLastSyncedAt,
      ageBand: sync.ageBand,
      neverSynced: sync.neverSynced,
    });
  });

  app.get("/api/internal/pending", requireFetchToken, async (_req, res) => {
    const { rows: sessRows } = await pool.query(`SELECT * FROM emergency_sessions ORDER BY started_at DESC`);
    const { rows } = await pool.query(
      `SELECT uuid, bill_number, payload_json, status FROM emergency_transactions
       WHERE status = 'PENDING' ORDER BY created_at`,
    );
    const pkg = buildEmergencyJsonPackage({
      sessions: sessRows.map((r) => ({
        emergencySessionUuid: r.uuid,
        startedAt: new Date(r.started_at).toISOString(),
        startedByStaffId: r.started_by_staff_id,
        startedByStaffName: r.started_by_staff_name,
        reason: r.reason,
        workstation: r.workstation,
        endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
        endedByStaffId: r.ended_by_staff_id,
        endedByStaffName: r.ended_by_staff_name,
      })),
      transactions: rows.map(rowToTxn),
      masterDataLastSyncedAt: (await getMeta("master_data_last_synced_at")) || null,
    });
    res.json(pkg);
  });

  app.post("/api/internal/master-sync", requireFetchToken, async (req, res) => {
    let snap: MasterDataSnapshot;
    try {
      snap = parseMasterSnapshot(req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof UnsupportedContractError ? 409 : 400;
      res.status(status).json({ error: message });
      return;
    }
    await applyMasterSnapshot(snap);
    const counts = countsFromSnapshot(snap);
    await audit(null, "master_sync", null, `${counts.serviceCount} services`);
    res.json({ ok: true, syncedAt: snap.syncedAt, format: snap.format, version: snap.version, ...counts });
  });

  app.post("/api/internal/mark-reconciled", requireFetchToken, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let n = 0;
    for (const it of items) {
      const uuid = String(it.emergencyTransactionUuid || "");
      const careBillId = Number(it.careBillId);
      if (!uuid || !careBillId) continue;
      const result = await pool.query(
        `UPDATE emergency_transactions
         SET status='RECONCILED', care_bill_id=$1, reconciled_at=now(),
             sync_status='synced', sync_error=NULL, synced_at=now(), care_destination_id=$1,
             payload_json = jsonb_set(payload_json, '{status}', '"RECONCILED"')
         WHERE uuid=$2 AND status != 'VOID'`,
        [careBillId, uuid],
      );
      n += result.rowCount ?? 0;
    }
    await audit(null, "mark_reconciled", null, `${n} rows`);
    res.json({ ok: true, updated: n });
  });

  // ── Main CARE reachability + Windows Emergency ops ─────────────────────────
  async function probeMainCare(): Promise<CareReachability> {
    careReach.lastCheckedAt = new Date().toISOString();
    if (!PRIMARY_CARE_URL) {
      careReach.state = "unknown";
      careReach.label = "PRIMARY_CARE_URL not set";
      return careReach;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(`${PRIMARY_CARE_URL}/api/emergency-bridge/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      careReach.consecutiveFailures = 0;
      careReach.lastOkAt = new Date().toISOString();
      careReach.lastError = null;
      careReach.state = "online";
      careReach.label = "ONLINE";
    } catch (err) {
      clearTimeout(t);
      careReach.consecutiveFailures += 1;
      careReach.lastError = err instanceof Error ? err.message : String(err);
      const sinceOk = careReach.lastOkAt ? Date.now() - new Date(careReach.lastOkAt).getTime() : Number.POSITIVE_INFINITY;
      // Grace: do not flip to OFFLINE on a single blip.
      if (careReach.consecutiveFailures >= 3 || sinceOk > CARE_OFFLINE_GRACE_MS) {
        careReach.state = "offline";
        careReach.label = "OFFLINE — EMERGENCY MODE ACTIVE";
      } else {
        careReach.state = careReach.lastOkAt ? "online" : "unknown";
        careReach.label = careReach.lastOkAt ? "ONLINE (retrying)" : "Checking…";
      }
    }
    return careReach;
  }

  app.get("/api/care/status", async (_req, res) => {
    res.json(await probeMainCare());
  });

  app.get("/api/ops/status", requireAuth, async (_req, res) => {
    let databaseHealthy = true;
    try {
      await pool.query("SELECT 1");
    } catch {
      databaseHealthy = false;
    }
    const { rows: pending } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM emergency_transactions WHERE status = 'PENDING'`,
    );
    const { rows: failed } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM emergency_transactions WHERE sync_status = 'failed'`,
    );
    const { rows: conflict } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM emergency_transactions WHERE sync_status = 'conflict'`,
    );
    const sync = await masterSyncStatus();
    res.json({
      databaseHealthy,
      pendingTransactionCount: pending[0]?.n ?? 0,
      failedTransactionCount: failed[0]?.n ?? 0,
      conflictTransactionCount: conflict[0]?.n ?? 0,
      masterDataLastSyncedAt: sync.masterDataLastSyncedAt,
      ageBand: sync.ageBand,
      care: careReach,
      deviceId: DEVICE_ID,
    });
  });

  async function pullMasterFromCare(): Promise<Record<string, unknown>> {
    if (!PRIMARY_CARE_URL) throw new Error("PRIMARY_CARE_URL is not configured");
    if (!FETCH_TOKEN) throw new Error("EMERGENCY_FETCH_TOKEN is not configured");
    const res = await fetch(`${PRIMARY_CARE_URL}/api/emergency-bridge/master-snapshot`, {
      headers: { "X-Emergency-Fetch-Token": FETCH_TOKEN },
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!res.ok) {
      const err = (body as { error?: string } | null)?.error || `Main CARE returned HTTP ${res.status}`;
      throw new Error(err);
    }
    const snap = parseMasterSnapshot(body);
    await applyMasterSnapshot(snap);
    const counts = countsFromSnapshot(snap);
    await audit(null, "master_pull", null, `${counts.serviceCount} services from ${PRIMARY_CARE_URL}`);
    return { ok: true, syncedAt: snap.syncedAt, ...counts };
  }

  app.post("/api/care/sync-master", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    try {
      const result = await pullMasterFromCare();
      await probeMainCare();
      res.json(result);
    } catch (err) {
      await probeMainCare();
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  async function pushPendingToCare(opts?: { onlyFailed?: boolean }): Promise<Record<string, unknown>> {
    if (!PRIMARY_CARE_URL) throw new Error("PRIMARY_CARE_URL is not configured");
    if (!FETCH_TOKEN) throw new Error("EMERGENCY_FETCH_TOKEN is not configured");
    const where = opts?.onlyFailed
      ? `status = 'PENDING' AND sync_status = 'failed'`
      : `status = 'PENDING'`;
    const { rows: sessRows } = await pool.query(`SELECT * FROM emergency_sessions ORDER BY started_at DESC`);
    const { rows } = await pool.query(
      `SELECT uuid, bill_number, payload_json, status FROM emergency_transactions WHERE ${where} ORDER BY created_at`,
    );
    if (!rows.length) {
      return { created: 0, alreadyReconciled: 0, duplicates: 0, failures: 0, conflicts: 0, supplied: 0 };
    }
    const pkg = buildEmergencyJsonPackage({
      sessions: sessRows.map((r) => ({
        emergencySessionUuid: r.uuid,
        startedAt: new Date(r.started_at).toISOString(),
        startedByStaffId: r.started_by_staff_id,
        startedByStaffName: r.started_by_staff_name,
        reason: r.reason,
        workstation: r.workstation,
        endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
        endedByStaffId: r.ended_by_staff_id,
        endedByStaffName: r.ended_by_staff_name,
      })),
      transactions: rows.map(rowToTxn),
      masterDataLastSyncedAt: (await getMeta("master_data_last_synced_at")) || null,
    });
    const res = await fetch(`${PRIMARY_CARE_URL}/api/emergency-bridge/import-json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emergency-Fetch-Token": FETCH_TOKEN,
      },
      body: JSON.stringify({ package: pkg, sourceDeviceId: DEVICE_ID, onlySafe: true }),
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!res.ok) throw new Error(body?.error || `Main CARE returned HTTP ${res.status}`);

    const failureUuids = new Set((body.failureDetails || []).map((f: { uuid: string }) => f.uuid));
    const previewRows: Array<{
      emergencyTransactionUuid?: string;
      matchClass?: string;
      alreadyImported?: boolean;
      careBillId?: number | null;
      transaction?: { emergencyTransactionUuid?: string };
    }> = Array.isArray(body.preview?.rows)
      ? body.preview.rows
      : Array.isArray(body.preview)
        ? body.preview
        : [];

    for (const row of rows) {
      const uuid = row.uuid;
      const preview = previewRows.find(
        (p) => p.emergencyTransactionUuid === uuid || p.transaction?.emergencyTransactionUuid === uuid,
      );
      const matchClass = String(preview?.matchClass || "");
      if (failureUuids.has(uuid)) {
        const detail = (body.failureDetails || []).find((f: { uuid: string }) => f.uuid === uuid);
        await pool.query(
          `UPDATE emergency_transactions SET sync_status='failed', sync_error=$1 WHERE uuid=$2`,
          [detail?.error || "import failed", uuid],
        );
        continue;
      }
      if (matchClass === "CONFLICT" || matchClass === "PROBABLE_MATCH") {
        await pool.query(
          `UPDATE emergency_transactions SET sync_status='conflict', sync_error=$1 WHERE uuid=$2`,
          [`Needs CARE review (${matchClass}) — resolve in Main CARE Emergency Billing`, uuid],
        );
        continue;
      }
      if (
        preview?.alreadyImported ||
        matchClass === "EXACT_MATCH" ||
        matchClass === "NEW_PATIENT" ||
        matchClass === ""
      ) {
        // Empty matchClass: CARE accepted the batch; treat as synced (idempotent UUIDs).
        const careBillId = preview?.careBillId ?? null;
        await pool.query(
          `UPDATE emergency_transactions
           SET status='RECONCILED', sync_status='synced', sync_error=NULL, synced_at=now(),
               care_bill_id=COALESCE($1, care_bill_id), care_destination_id=COALESCE($1, care_destination_id),
               reconciled_at=COALESCE(reconciled_at, now()),
               payload_json = jsonb_set(payload_json, '{status}', '"RECONCILED"')
           WHERE uuid=$2 AND status = 'PENDING'`,
          [careBillId, uuid],
        );
        continue;
      }
      await pool.query(
        `UPDATE emergency_transactions SET sync_status='failed', sync_error=$1 WHERE uuid=$2`,
        [`Unrecognized match class: ${matchClass || "none"}`, uuid],
      );
    }

    await audit(null, "push_to_care", null, `supplied ${rows.length}; created ${body.created ?? 0}`);
    return {
      supplied: rows.length,
      created: body.created ?? 0,
      alreadyReconciled: body.alreadyReconciled ?? 0,
      duplicates: body.duplicates ?? 0,
      failures: body.failures ?? 0,
      conflicts: body.conflicts ?? 0,
      skippedReview: body.skippedReview ?? 0,
      batchUuid: body.batchUuid,
    };
  }

  app.post("/api/care/push-transactions", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await pushPendingToCare();
      await probeMainCare();
      res.json(result);
    } catch (err) {
      await probeMainCare();
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/care/retry-failed", requireAuth, requireAdmin, async (_req, res) => {
    try {
      // Clear failed flag back to pending-style retry of failed rows only.
      await pool.query(`UPDATE emergency_transactions SET sync_error=NULL WHERE sync_status='failed' AND status='PENDING'`);
      const result = await pushPendingToCare({ onlyFailed: false });
      // Re-push only previously failed: filter after reset — actually push all pending is safer/idempotent.
      await probeMainCare();
      res.json(result);
    } catch (err) {
      await probeMainCare();
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/export/backup.sql", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const dir = process.env.BACKUP_DIR || "/tmp";
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `care_emergency_download_${stamp}.sql`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("pg_dump", ["--no-owner", "--format=plain", `--dbname=${process.env.DATABASE_URL}`, `--file=${file}`], {
          stdio: "ignore",
        });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("pg_dump exit " + code))));
      });
      await audit(req.staff!, "backup_download", null, file, req.ip);
      res.download(file, `care_emergency_${stamp}.sql`);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api") || req.path === "/health") return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Background Main CARE probe + optional master pull (never interrupts billing).
  void probeMainCare();
  setInterval(() => { void probeMainCare(); }, 30_000);
  if (MASTER_PULL_INTERVAL_HOURS > 0 && PRIMARY_CARE_URL && FETCH_TOKEN) {
    const pullMs = MASTER_PULL_INTERVAL_HOURS * 3600_000;
    setInterval(() => {
      void pullMasterFromCare().catch((err) => {
        console.warn("[emergency] auto master pull failed:", err instanceof Error ? err.message : err);
      });
    }, pullMs);
  }

  return app;
}

async function main() {
  const port = Number(process.env.PORT || 8898);
  const app = await createApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`care-emergency-billing listening on ${port}`);
  });
  scheduleLogicalBackups();
}

function scheduleLogicalBackups() {
  const dir = process.env.BACKUP_DIR;
  if (!dir) {
    console.warn("[emergency] BACKUP_DIR not set — logical dumps disabled");
    return;
  }
  const hours = Number(process.env.BACKUP_EVERY_HOURS || 6);
  const keep = Number(process.env.BACKUP_KEEP || 14);
  const run = async () => {
    try {
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(dir, `care_emergency_${stamp}.sql`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn("pg_dump", ["--no-owner", "--format=plain", `--dbname=${process.env.DATABASE_URL}`, `--file=${file}`], {
          stdio: "inherit",
        });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("pg_dump exit " + code))));
      });
      const files = (await readdir(dir)).filter((f) => f.startsWith("care_emergency_") && f.endsWith(".sql")).sort();
      while (files.length > keep) {
        const old = files.shift();
        if (old) await unlink(path.join(dir, old));
      }
      console.log("[emergency] logical backup", file);
    } catch (err) {
      console.warn("[emergency] backup failed", err instanceof Error ? err.message : err);
    }
  };
  run();
  setInterval(run, Math.max(1, hours) * 3600_000);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
