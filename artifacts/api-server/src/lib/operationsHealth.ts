/**
 * operationsHealth.ts — canonical Deployment Smoke Test / Operational Health
 * model (pure core).
 *
 * ONE vocabulary + aggregation shared by the admin endpoint
 * (GET /api/admin/operations/health), the `pnpm smoke:production` CLI, and the
 * Admin Operational Health dashboard. This file has NO database or network
 * imports — every DB/HTTP capability is injected via `OpsCtx` (see
 * operationsChecks.ts), so the whole thing is unit-testable with fakes, exactly
 * like radiologyDeploymentDiagnostics.probe.test.ts injects its IO.
 *
 * It deliberately does NOT replace the existing radiology-integrity aggregator
 * (radiologyOpsHealth.ts, HEALTHY/DEGRADED/UNHEALTHY/UNKNOWN). That one answers
 * "is radiology data consistent"; this one answers "is the deployment
 * operational after a Container Manager rebuild" across every service, in the
 * PASS/WARNING/FAIL/SKIPPED/UNKNOWN vocabulary the smoke test needs.
 */

export type OpsCheckStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN";

export type OpsCategory =
  | "application"
  | "database"
  | "authentication"
  | "core_erp"
  | "radiology_pacs"
  | "queue_displays"
  | "integrations"
  | "storage_backup";

export const OPS_CATEGORY_LABELS: Record<OpsCategory, string> = {
  application: "Application",
  database: "Database",
  authentication: "Authentication",
  core_erp: "Core ERP",
  radiology_pacs: "Radiology / PACS",
  queue_displays: "Queue Displays",
  integrations: "Integrations",
  storage_backup: "Storage & Backup",
};

export interface OpsCheck {
  id: string;
  name: string;
  category: OpsCategory;
  status: OpsCheckStatus;
  message: string;
  checkedAt: string; // ISO 8601
  durationMs: number;
  /** Required checks drive FAIL; optional checks can only WARN the overall. */
  required: boolean;
  /** SAFE metadata only — never secrets or PHI (scrubbed on the way out). */
  metadata?: Record<string, unknown>;
  recommendedAction?: string;
}

export interface OpsVersionInfo {
  version: string;
  build: string;
  releaseName: string | null;
  commit: string;
  branch: string | null;
  buildTime: string | null;
  nodeEnv: string;
  /** Process uptime seconds — present when the report is produced in-process. */
  uptimeSeconds?: number | null;
}

export interface OpsHealthReport {
  overall: OpsCheckStatus;
  generatedAt: string;
  durationMs: number;
  trigger: OpsRunTrigger;
  version: OpsVersionInfo;
  checks: OpsCheck[];
  summary: OpsSummary;
}

export type OpsRunTrigger = "deployment" | "cli" | "admin" | "scheduled";

export interface OpsSummary {
  pass: number;
  warning: number;
  fail: number;
  skipped: number;
  unknown: number;
  total: number;
}

// ── Overall aggregation ─────────────────────────────────────────────────────
// Precedence when rolling individual checks up to one overall status:
//   • SKIPPED checks are ignored (not applicable / optional-not-configured).
//   • A REQUIRED FAIL fails the whole deployment.
//   • A REQUIRED UNKNOWN cannot be confirmed → surfaces as UNKNOWN overall.
//   • An OPTIONAL failure/unknown is downgraded to WARNING — an unconfigured or
//     flaky optional integration must never fail the deploy.
type OverallRank = "pass" | "warn" | "unknown" | "fail";
const OVERALL_ORDER: OverallRank[] = ["pass", "warn", "unknown", "fail"];

function effectiveOverall(check: OpsCheck): OverallRank | null {
  if (check.status === "SKIPPED") return null;
  if (check.required) {
    switch (check.status) {
      case "FAIL": return "fail";
      case "UNKNOWN": return "unknown";
      case "WARNING": return "warn";
      default: return "pass";
    }
  }
  // Optional: never fails the deploy; failure/unknown degrade to a warning.
  switch (check.status) {
    case "FAIL":
    case "UNKNOWN":
    case "WARNING": return "warn";
    default: return "pass";
  }
}

const RANK_TO_STATUS: Record<OverallRank, OpsCheckStatus> = {
  pass: "PASS", warn: "WARNING", unknown: "UNKNOWN", fail: "FAIL",
};

export function aggregateOverall(checks: OpsCheck[]): OpsCheckStatus {
  let worst: OverallRank = "pass";
  for (const c of checks) {
    const eff = effectiveOverall(c);
    if (eff && OVERALL_ORDER.indexOf(eff) > OVERALL_ORDER.indexOf(worst)) worst = eff;
  }
  return RANK_TO_STATUS[worst];
}

export function summarize(checks: OpsCheck[]): OpsSummary {
  const s: OpsSummary = { pass: 0, warning: 0, fail: 0, skipped: 0, unknown: 0, total: checks.length };
  for (const c of checks) {
    if (c.status === "PASS") s.pass++;
    else if (c.status === "WARNING") s.warning++;
    else if (c.status === "FAIL") s.fail++;
    else if (c.status === "SKIPPED") s.skipped++;
    else s.unknown++;
  }
  return s;
}

/**
 * CLI exit code. Default: only a hard FAIL is non-zero (matches "exit 0 when
 * all required checks pass; non-zero when a required check fails"; warnings are
 * reported but non-fatal). `strict` also fails on an unverifiable (UNKNOWN)
 * overall for stricter CI gating.
 */
export function exitCodeFor(overall: OpsCheckStatus, opts: { strict?: boolean } = {}): number {
  if (overall === "FAIL") return 1;
  if (opts.strict && overall === "UNKNOWN") return 1;
  return 0;
}

// ── Secret / PHI redaction (safety net) ─────────────────────────────────────
// Checks are authored never to include secrets, but every outgoing message and
// string metadata value is scrubbed anyway so a stray error string can't leak a
// connection string, token, or credential to the browser or terminal.
const REDACTIONS: Array<[RegExp, string]> = [
  // Auth-scheme tokens first so a "Authorization: Bearer <jwt>" is fully caught
  // before the generic key=value rule can consume just the scheme word.
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***redacted***"],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic ***redacted***"],
  [/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***redacted***"],
  [/\b[A-Za-z0-9._%+-]+:[^@\s/]+@([A-Za-z0-9.-]+)/g, "***:***@$1"], // user:pass@host in any URL
  [/([A-Za-z0-9_]*(?:password|passwd|pwd|secret|api[_-]?key|token))\s*[=:]\s*[^\s;,"']+/gi, "$1=***redacted***"],
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/** Error → short, secret-free message. Never includes a stack trace. */
export function safeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw).slice(0, 300);
}

/** Deep-scrub a metadata object's string values (one level of nesting). */
export function redactMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string") out[k] = redactSecrets(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redactMetadata(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

// ── Check definition + runner ───────────────────────────────────────────────
export interface OpsCheckResult {
  status: OpsCheckStatus;
  message: string;
  metadata?: Record<string, unknown>;
  recommendedAction?: string;
}

export interface OpsCheckDef<Ctx> {
  id: string;
  name: string;
  category: OpsCategory;
  required: boolean;
  /** When true the check only runs if includeOptional is set; otherwise SKIPPED. */
  optional?: boolean;
  run: (ctx: Ctx) => Promise<OpsCheckResult>;
}

export interface RunChecksOptions {
  includeOptional: boolean;
  timeoutMs: number;
  now: Date;
}

/** Race a check against a timeout so one hung probe can't stall the whole run. */
async function withTimeout(p: Promise<OpsCheckResult>, ms: number): Promise<OpsCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OpsCheckResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "UNKNOWN", message: `check timed out after ${ms}ms` }), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run one check def to a fully-formed, scrubbed OpsCheck. Never throws — an
 * error inside a check becomes an UNKNOWN result with a safe message, so a
 * single broken probe can never take the aggregator down.
 */
export async function runOneCheck<Ctx>(def: OpsCheckDef<Ctx>, ctx: Ctx, opts: RunChecksOptions): Promise<OpsCheck> {
  const checkedAt = opts.now.toISOString();
  if (def.optional && !opts.includeOptional) {
    return {
      id: def.id, name: def.name, category: def.category, required: def.required,
      status: "SKIPPED", message: "optional check skipped (enable with --include-optional)",
      checkedAt, durationMs: 0,
    };
  }
  const started = Date.now();
  let result: OpsCheckResult;
  try {
    result = await withTimeout(def.run(ctx), opts.timeoutMs);
  } catch (err) {
    result = { status: "UNKNOWN", message: safeError(err) };
  }
  return {
    id: def.id, name: def.name, category: def.category, required: def.required,
    status: result.status,
    message: redactSecrets(result.message).slice(0, 500),
    checkedAt,
    durationMs: Date.now() - started,
    metadata: redactMetadata(result.metadata),
    recommendedAction: result.recommendedAction ? redactSecrets(result.recommendedAction) : undefined,
  };
}

/** Run all check defs concurrently → scrubbed OpsCheck[] preserving def order. */
export async function runAllChecks<Ctx>(defs: Array<OpsCheckDef<Ctx>>, ctx: Ctx, opts: RunChecksOptions): Promise<OpsCheck[]> {
  return Promise.all(defs.map((d) => runOneCheck(d, ctx, opts)));
}
