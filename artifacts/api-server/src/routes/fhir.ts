/**
 * fhir.ts — read-only FHIR R4 façade over CARE diagnostic data.
 *
 * Exposes existing patients, reports (+ their structured parameters as
 * Observations) and orders as FHIR R4 resources for interoperability with
 * hospital systems, national health stacks (see abdm.ts) and research tooling.
 *
 * SECURITY / ACTIVATION:
 *   - The entire façade is OFF until FHIR_API_KEY is set in the environment.
 *     With no key configured every route returns 503 — so simply not setting
 *     the variable keeps patient data unexposed.
 *   - When configured, every request must carry `Authorization: Bearer <key>`,
 *     compared in constant time. Read-only: only GET is implemented.
 *
 * All mapping is done by pure functions in lib/fhirMappers.ts (unit-tested);
 * this module only does I/O.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { patientsTable, patientReportsTable, ordersTable, orderTestsTable, testsTable } from "@workspace/db/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import {
  mapPatient, mapDiagnosticReport, mapReportWithObservations, mapObservation,
  mapServiceRequest, parseParameters, makeSearchBundle, operationOutcome, capabilityStatement,
  type FhirResource,
} from "../lib/fhirMappers";

const router = Router();
const FHIR_API_KEY = process.env.FHIR_API_KEY ?? "";
const MAX_SEARCH = 200;

if (!FHIR_API_KEY && process.env.NODE_ENV === "production") {
  console.warn("[fhir] FHIR_API_KEY not set — the FHIR façade is disabled (returns 503).");
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}
function keysMatch(provided: string): boolean {
  // Constant-time compare over fixed-length digests (avoids length leaks).
  return timingSafeEqual(sha256(provided), sha256(FHIR_API_KEY));
}

// Content negotiation + auth gate for every route.
function fhirJson(res: Response): Response {
  res.type("application/fhir+json");
  return res;
}
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!FHIR_API_KEY) {
    fhirJson(res).status(503).json(operationOutcome("error", "not-supported", "FHIR façade not configured on this server"));
    return;
  }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !keysMatch(token)) {
    fhirJson(res).status(401).json(operationOutcome("error", "security", "Valid Bearer token required"));
    return;
  }
  next();
});

function baseUrl(req: Request): string {
  if (process.env.FHIR_BASE_URL) return process.env.FHIR_BASE_URL.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host") ?? "localhost"}/api/fhir`;
}

// ── Capability statement ─────────────────────────────────────────────────────
router.get("/metadata", (req, res) => {
  fhirJson(res).json(capabilityStatement(baseUrl(req)));
});

// ── Patient ──────────────────────────────────────────────────────────────────
router.get("/Patient/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { fhirJson(res).status(400).json(operationOutcome("error", "value", "Invalid id")); return; }
  const [row] = await db.select().from(patientsTable).where(eq(patientsTable.id, id)).limit(1);
  if (!row) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "Patient not found")); return; }
  fhirJson(res).json(mapPatient(row));
});

router.get("/Patient", async (req, res) => {
  const identifier = typeof req.query.identifier === "string" ? req.query.identifier.trim() : "";
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const conds = [];
  if (identifier) conds.push(eq(patientsTable.patientId, identifier));
  if (name) conds.push(or(ilike(patientsTable.firstName, `%${name}%`), ilike(patientsTable.lastName, `%${name}%`)));
  const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;
  const rows = await (where ? db.select().from(patientsTable).where(where) : db.select().from(patientsTable)).limit(MAX_SEARCH);
  fhirJson(res).json(makeSearchBundle(rows.map(mapPatient), baseUrl(req)));
});

// ── DiagnosticReport ─────────────────────────────────────────────────────────
async function loadReportWithTest(id: number) {
  const [row] = await db.select({
    id: patientReportsTable.id, reportNumber: patientReportsTable.reportNumber, type: patientReportsTable.type,
    patientId: patientReportsTable.patientId, title: patientReportsTable.title, impression: patientReportsTable.impression,
    status: patientReportsTable.status, parameters: patientReportsTable.parameters,
    signedAt: patientReportsTable.signedAt, verifiedAt: patientReportsTable.verifiedAt, createdAt: patientReportsTable.createdAt,
    testCode: testsTable.code, testName: testsTable.name,
  }).from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.id, id)).limit(1);
  return row;
}

router.get("/DiagnosticReport/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { fhirJson(res).status(400).json(operationOutcome("error", "value", "Invalid id")); return; }
  const row = await loadReportWithTest(id);
  if (!row) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "DiagnosticReport not found")); return; }
  fhirJson(res).json(mapDiagnosticReport(row, { testCode: row.testCode, testName: row.testName }));
});

router.get("/DiagnosticReport", async (req, res) => {
  const patient = patientRefParam(req.query.patient);
  const rows = await db.select({
    id: patientReportsTable.id, reportNumber: patientReportsTable.reportNumber, type: patientReportsTable.type,
    patientId: patientReportsTable.patientId, title: patientReportsTable.title, impression: patientReportsTable.impression,
    status: patientReportsTable.status, parameters: patientReportsTable.parameters,
    signedAt: patientReportsTable.signedAt, verifiedAt: patientReportsTable.verifiedAt, createdAt: patientReportsTable.createdAt,
    testCode: testsTable.code, testName: testsTable.name,
  }).from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(patient != null ? eq(patientReportsTable.patientId, patient) : undefined)
    .limit(MAX_SEARCH);
  const resources: FhirResource[] = rows.map((r) => mapDiagnosticReport(r, { testCode: r.testCode, testName: r.testName }));
  fhirJson(res).json(makeSearchBundle(resources, baseUrl(req)));
});

// ── Observation (id is "<reportId>-<index>") ─────────────────────────────────
router.get("/Observation/:id", async (req, res) => {
  const m = String(req.params.id).match(/^(\d+)-(\d+)$/);
  if (!m) { fhirJson(res).status(400).json(operationOutcome("error", "value", "Observation id must be <reportId>-<index>")); return; }
  const reportId = Number(m[1]);
  const index = Number(m[2]);
  const row = await loadReportWithTest(reportId);
  if (!row) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "Observation not found")); return; }
  const params = parseParameters(row.parameters);
  const param = params[index];
  if (!param) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "Observation not found")); return; }
  const effective = row.signedAt ?? row.verifiedAt ?? row.createdAt ?? null;
  fhirJson(res).json(mapObservation(reportId, index, param, row.patientId, row.status, effective));
});

// Convenience: full report + contained observations in one Bundle.
router.get("/DiagnosticReport/:id/$everything", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { fhirJson(res).status(400).json(operationOutcome("error", "value", "Invalid id")); return; }
  const row = await loadReportWithTest(id);
  if (!row) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "DiagnosticReport not found")); return; }
  const { report, observations } = mapReportWithObservations(row, { testCode: row.testCode, testName: row.testName });
  fhirJson(res).json(makeSearchBundle([report, ...observations], baseUrl(req)));
});

// ── ServiceRequest (one per ordered test) ────────────────────────────────────
async function loadOrderTest(id: number) {
  const [row] = await db.select({
    id: orderTestsTable.id, status: orderTestsTable.status, displayName: orderTestsTable.displayName,
    orderNumber: ordersTable.orderNumber, patientId: ordersTable.patientId, createdAt: ordersTable.createdAt,
    testCode: testsTable.code, testName: testsTable.name,
  }).from(orderTestsTable)
    .innerJoin(ordersTable, eq(orderTestsTable.orderId, ordersTable.id))
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(eq(orderTestsTable.id, id)).limit(1);
  return row;
}

router.get("/ServiceRequest/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { fhirJson(res).status(400).json(operationOutcome("error", "value", "Invalid id")); return; }
  const row = await loadOrderTest(id);
  if (!row) { fhirJson(res).status(404).json(operationOutcome("error", "not-found", "ServiceRequest not found")); return; }
  fhirJson(res).json(mapServiceRequest(
    { id: row.id, status: row.status, displayName: row.displayName },
    { orderNumber: row.orderNumber, patientId: row.patientId, createdAt: row.createdAt },
    { testCode: row.testCode, testName: row.testName },
  ));
});

router.get("/ServiceRequest", async (req, res) => {
  const patient = patientRefParam(req.query.patient);
  const rows = await db.select({
    id: orderTestsTable.id, status: orderTestsTable.status, displayName: orderTestsTable.displayName,
    orderNumber: ordersTable.orderNumber, patientId: ordersTable.patientId, createdAt: ordersTable.createdAt,
    testCode: testsTable.code, testName: testsTable.name,
  }).from(orderTestsTable)
    .innerJoin(ordersTable, eq(orderTestsTable.orderId, ordersTable.id))
    .leftJoin(testsTable, eq(orderTestsTable.testId, testsTable.id))
    .where(patient != null ? eq(ordersTable.patientId, patient) : undefined)
    .limit(MAX_SEARCH);
  const resources: FhirResource[] = rows.map((r) => mapServiceRequest(
    { id: r.id, status: r.status, displayName: r.displayName },
    { orderNumber: r.orderNumber, patientId: r.patientId, createdAt: r.createdAt },
    { testCode: r.testCode, testName: r.testName },
  ));
  fhirJson(res).json(makeSearchBundle(resources, baseUrl(req)));
});

/** Accept either `Patient/42` or a bare `42` for a ?patient= search param. */
function patientRefParam(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.includes("/") ? v.split("/").pop()! : v;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

export default router;
