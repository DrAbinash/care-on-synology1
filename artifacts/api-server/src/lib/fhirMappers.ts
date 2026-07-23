/**
 * fhirMappers.ts — pure, DB-free mappers from CARE rows to FHIR R4 resources.
 *
 * This is a READ façade: it exposes existing CARE data (patients, reports,
 * parameters, orders) as FHIR R4 resources for interoperability with hospital
 * information systems, national health stacks and research tooling. It never
 * writes and introduces no new dependency — the resource shapes below are the
 * narrow subset of FHIR R4 we actually emit.
 *
 * Kept side-effect-free so every mapping rule (status codes, value typing,
 * interpretation flags, date normalisation) is unit-tested exhaustively; the
 * route layer (routes/fhir.ts) does the I/O and calls these.
 */

// ── Minimal FHIR R4 shapes (only what we emit) ───────────────────────────────

export interface FhirCoding { system?: string; code?: string; display?: string }
export interface FhirCodeableConcept { coding?: FhirCoding[]; text?: string }
export interface FhirIdentifier { system?: string; value: string }
export interface FhirReference { reference: string; display?: string }
export interface FhirHumanName { family?: string; given?: string[]; text?: string }
export interface FhirContactPoint { system: "phone" | "email" | "url"; value: string }
export interface FhirQuantity { value: number; unit?: string }

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  telecom?: FhirContactPoint[];
  address?: { text: string }[];
}

export interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: string;
  code: FhirCodeableConcept;
  subject: FhirReference;
  effectiveDateTime?: string;
  valueQuantity?: FhirQuantity;
  valueString?: string;
  interpretation?: FhirCodeableConcept[];
  referenceRange?: { text: string }[];
}

export interface FhirDiagnosticReport {
  resourceType: "DiagnosticReport";
  id: string;
  identifier?: FhirIdentifier[];
  status: string;
  category?: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject: FhirReference;
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
  result?: FhirReference[];
}

export interface FhirServiceRequest {
  resourceType: "ServiceRequest";
  id: string;
  identifier?: FhirIdentifier[];
  status: string;
  intent: string;
  code?: FhirCodeableConcept;
  subject: FhirReference;
  authoredOn?: string;
}

export type FhirResource =
  | FhirPatient
  | FhirObservation
  | FhirDiagnosticReport
  | FhirServiceRequest;

export interface FhirBundleEntry { fullUrl?: string; resource: FhirResource }
export interface FhirBundle {
  resourceType: "Bundle";
  type: "searchset";
  total: number;
  entry: FhirBundleEntry[];
}

export interface FhirOperationOutcome {
  resourceType: "OperationOutcome";
  issue: { severity: string; code: string; diagnostics?: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const IDENTIFIER_SYSTEM = "urn:care:patient-id";
const TEST_CODE_SYSTEM = "urn:care:test-code";
const REPORT_NUMBER_SYSTEM = "urn:care:report-number";
const ORDER_NUMBER_SYSTEM = "urn:care:order-number";
const V2_0074 = "http://terminology.hl7.org/CodeSystem/v2-0074"; // diagnostic service section
const V3_INTERP = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

/** Normalise a Date|string|null to an ISO-8601 instant, or undefined. */
export function toIso(d: Date | string | null | undefined): string | undefined {
  if (d == null) return undefined;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

/** FHIR birthDate must be YYYY, YYYY-MM or YYYY-MM-DD. Free-text DOB is coerced. */
export function normalizeBirthDate(dob: string | null | undefined): string | undefined {
  if (!dob) return undefined;
  const s = dob.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const ym = s.match(/^(\d{4}-\d{2})$/);
  if (ym) return ym[1];
  const y = s.match(/^(\d{4})$/);
  if (y) return y[1];
  return undefined; // unparseable free text (e.g. "35 yrs") → omit; age is not a birthDate
}

/** CARE gender free-text → FHIR administrative-gender. */
export function normalizeGender(g: string | null | undefined): FhirPatient["gender"] {
  const v = (g ?? "").trim().toLowerCase();
  if (v === "m" || v === "male") return "male";
  if (v === "f" || v === "female") return "female";
  if (v === "o" || v === "other" || v === "transgender" || v === "trans") return "other";
  return "unknown";
}

/** patient_reports.status → FHIR DiagnosticReport.status. */
export function mapReportStatus(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "draft": return "partial";
    case "pending_verification": return "preliminary";
    case "verified": return "final";
    case "delivered": return "final";
    case "amended": return "amended";
    case "cancelled": return "cancelled";
    default: return "unknown";
  }
}

/** Observation.status mirrors the parent report's lifecycle. */
export function mapObservationStatus(reportStatus: string | null | undefined): string {
  switch ((reportStatus ?? "").toLowerCase()) {
    case "draft": return "preliminary";
    case "pending_verification": return "preliminary";
    case "verified": return "final";
    case "delivered": return "final";
    case "amended": return "amended";
    case "cancelled": return "cancelled";
    default: return "unknown";
  }
}

/** A structured pathology parameter row as stored in patient_reports.parameters. */
export interface ParameterRow {
  name?: string;
  value?: string | number | null;
  unit?: string | null;
  refRange?: string | null;
  flag?: string | null;
}

/** Parse the parameters JSON string; tolerant of null / malformed input. */
export function parseParameters(json: string | null | undefined): ParameterRow[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is ParameterRow => r != null && typeof r === "object");
  } catch {
    return [];
  }
}

const INTERPRETATION: Record<string, FhirCoding> = {
  h: { system: V3_INTERP, code: "H", display: "High" },
  high: { system: V3_INTERP, code: "H", display: "High" },
  l: { system: V3_INTERP, code: "L", display: "Low" },
  low: { system: V3_INTERP, code: "L", display: "Low" },
  hh: { system: V3_INTERP, code: "HH", display: "Critical high" },
  ll: { system: V3_INTERP, code: "LL", display: "Critical low" },
  n: { system: V3_INTERP, code: "N", display: "Normal" },
  normal: { system: V3_INTERP, code: "N", display: "Normal" },
  a: { system: V3_INTERP, code: "A", display: "Abnormal" },
  abnormal: { system: V3_INTERP, code: "A", display: "Abnormal" },
  critical: { system: V3_INTERP, code: "AA", display: "Critical abnormal" },
};

function mapInterpretation(flag: string | null | undefined): FhirCodeableConcept[] | undefined {
  const raw = (flag ?? "").trim();
  if (!raw) return undefined;
  const known = INTERPRETATION[raw.toLowerCase()];
  return [known ? { coding: [known], text: known.display } : { text: raw }];
}

// ── Patient ──────────────────────────────────────────────────────────────────

export interface PatientRow {
  id: number;
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email?: string | null;
  address?: string | null;
}

export function mapPatient(p: PatientRow): FhirPatient {
  const telecom: FhirContactPoint[] = [];
  if (p.phone?.trim()) telecom.push({ system: "phone", value: p.phone.trim() });
  if (p.email?.trim()) telecom.push({ system: "email", value: p.email.trim() });
  const out: FhirPatient = {
    resourceType: "Patient",
    id: String(p.id),
    identifier: [{ system: IDENTIFIER_SYSTEM, value: p.patientId }],
    name: [{ family: p.lastName, given: p.firstName ? [p.firstName] : undefined, text: `${p.firstName} ${p.lastName}`.trim() }],
    gender: normalizeGender(p.gender),
  };
  const bd = normalizeBirthDate(p.dateOfBirth);
  if (bd) out.birthDate = bd;
  if (telecom.length) out.telecom = telecom;
  if (p.address?.trim()) out.address = [{ text: p.address.trim() }];
  return out;
}

// ── Observation (one per structured parameter row) ───────────────────────────

export function mapObservation(
  reportId: number,
  index: number,
  param: ParameterRow,
  patientDbId: number,
  reportStatus: string | null | undefined,
  effective?: Date | string | null,
): FhirObservation {
  const obs: FhirObservation = {
    resourceType: "Observation",
    id: `${reportId}-${index}`,
    status: mapObservationStatus(reportStatus),
    code: { text: param.name?.trim() || `Parameter ${index + 1}` },
    subject: { reference: `Patient/${patientDbId}` },
  };
  const eff = toIso(effective);
  if (eff) obs.effectiveDateTime = eff;

  const rawValue = param.value;
  const asString = rawValue == null ? "" : String(rawValue).trim();
  const num = Number(asString);
  if (asString !== "" && Number.isFinite(num) && /^-?\d*\.?\d+$/.test(asString)) {
    obs.valueQuantity = { value: num, ...(param.unit?.trim() ? { unit: param.unit.trim() } : {}) };
  } else if (asString !== "") {
    obs.valueString = asString;
  }

  const interp = mapInterpretation(param.flag);
  if (interp) obs.interpretation = interp;
  if (param.refRange?.trim()) obs.referenceRange = [{ text: param.refRange.trim() }];
  return obs;
}

// ── DiagnosticReport ─────────────────────────────────────────────────────────

export interface ReportRow {
  id: number;
  reportNumber: string;
  type?: string | null; // pathology | radiology
  patientId: number;    // CARE patients.id (db id)
  title: string;
  impression?: string | null;
  status: string;
  parameters?: string | null;
  signedAt?: Date | string | null;
  verifiedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export function mapDiagnosticReport(
  r: ReportRow,
  opts?: { testCode?: string | null; testName?: string | null },
): FhirDiagnosticReport {
  const isRad = (r.type ?? "").toLowerCase() === "radiology";
  const category: FhirCodeableConcept = isRad
    ? { coding: [{ system: V2_0074, code: "RAD", display: "Radiology" }] }
    : { coding: [{ system: V2_0074, code: "LAB", display: "Laboratory" }] };

  const code: FhirCodeableConcept = { text: r.title };
  if (opts?.testCode) code.coding = [{ system: TEST_CODE_SYSTEM, code: opts.testCode, display: opts.testName ?? undefined }];

  const effective = toIso(r.signedAt) ?? toIso(r.verifiedAt) ?? toIso(r.createdAt);
  const issued = toIso(r.verifiedAt) ?? toIso(r.signedAt) ?? toIso(r.createdAt);

  const out: FhirDiagnosticReport = {
    resourceType: "DiagnosticReport",
    id: String(r.id),
    identifier: [{ system: REPORT_NUMBER_SYSTEM, value: r.reportNumber }],
    status: mapReportStatus(r.status),
    category: [category],
    code,
    subject: { reference: `Patient/${r.patientId}` },
  };
  if (effective) out.effectiveDateTime = effective;
  if (issued) out.issued = issued;
  if (r.impression?.trim()) out.conclusion = r.impression.trim();

  const params = parseParameters(r.parameters);
  if (params.length) out.result = params.map((_p, i) => ({ reference: `Observation/${r.id}-${i}` }));
  return out;
}

/** The report plus its contained Observations, for a fully-resolved read. */
export function mapReportWithObservations(
  r: ReportRow,
  opts?: { testCode?: string | null; testName?: string | null },
): { report: FhirDiagnosticReport; observations: FhirObservation[] } {
  const report = mapDiagnosticReport(r, opts);
  const effective = r.signedAt ?? r.verifiedAt ?? r.createdAt ?? null;
  const observations = parseParameters(r.parameters).map((p, i) =>
    mapObservation(r.id, i, p, r.patientId, r.status, effective),
  );
  return { report, observations };
}

// ── ServiceRequest (one per ordered test) ────────────────────────────────────

export interface OrderTestRow {
  id: number;
  status?: string | null; // active | cancelled
  displayName?: string | null;
}
export interface OrderRow {
  orderNumber: string;
  patientId: number;
  createdAt?: Date | string | null;
}

export function mapServiceRequest(
  ot: OrderTestRow,
  order: OrderRow,
  opts?: { testCode?: string | null; testName?: string | null },
): FhirServiceRequest {
  const status = (ot.status ?? "active").toLowerCase() === "cancelled" ? "revoked" : "active";
  const code: FhirCodeableConcept = { text: ot.displayName?.trim() || opts?.testName || "Diagnostic test" };
  if (opts?.testCode) code.coding = [{ system: TEST_CODE_SYSTEM, code: opts.testCode, display: opts.testName ?? undefined }];
  const out: FhirServiceRequest = {
    resourceType: "ServiceRequest",
    id: String(ot.id),
    identifier: [{ system: ORDER_NUMBER_SYSTEM, value: order.orderNumber }],
    status,
    intent: "order",
    code,
    subject: { reference: `Patient/${order.patientId}` },
  };
  const authored = toIso(order.createdAt);
  if (authored) out.authoredOn = authored;
  return out;
}

// ── Bundles + OperationOutcome ───────────────────────────────────────────────

export function makeSearchBundle(resources: FhirResource[], baseUrl?: string): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    entry: resources.map((resource) => ({
      fullUrl: baseUrl ? `${baseUrl}/${resource.resourceType}/${resource.id}` : undefined,
      resource,
    })),
  };
}

export function operationOutcome(severity: string, code: string, diagnostics?: string): FhirOperationOutcome {
  return { resourceType: "OperationOutcome", issue: [{ severity, code, diagnostics }] };
}

// ── CapabilityStatement (/fhir/metadata) ─────────────────────────────────────

export function capabilityStatement(baseUrl: string): Record<string, unknown> {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    kind: "instance",
    fhirVersion: "4.0.1",
    format: ["json"],
    software: { name: "CARE ERP FHIR façade" },
    implementation: { description: "Read-only FHIR R4 façade over CARE diagnostic data", url: baseUrl },
    rest: [
      {
        mode: "server",
        security: { description: "Bearer token (FHIR_API_KEY). Read-only." },
        resource: [
          { type: "Patient", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "identifier", type: "token" }, { name: "name", type: "string" }] },
          { type: "DiagnosticReport", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
          { type: "Observation", interaction: [{ code: "read" }] },
          { type: "ServiceRequest", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        ],
      },
    ],
  };
}
