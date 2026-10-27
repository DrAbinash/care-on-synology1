/**
 * devIsolation.ts — the policy behind CARE_DEV_ISOLATED=1.
 *
 * WHY THIS FILE EXISTS
 * A Windows development checkout runs against a database RESTORED FROM THE
 * PRODUCTION SNAPSHOT. That copy carries every real integration target the
 * clinic has ever configured: Orthanc at 172.16.1.139, partner callback URLs in
 * `integration_partners`, SMTP credentials in `email_settings`, WhatsApp provider
 * config, payment gateway rows, `dicom_nodes` IPs. The API server's boot sequence
 * starts consumers, pollers, warmers and reconcilers that read exactly those rows.
 * So "run it locally to look at something" can send a real clinical report to a
 * real partner, mail a real patient, or write into the live archive — while the
 * developer believes they are on a sandbox.
 *
 * This mode makes the sandbox explicit and fail-closed:
 *   1. no automatic background consumer, scheduler, poller, warmer, reconciler or
 *      integration bootstrap starts at all;
 *   2. outbound production integrations are refused, while loopback and
 *      explicitly allowlisted local development services keep working;
 *   3. it will not start against a database that is not the approved development
 *      database — a restored `.env` pointing at production refuses to boot rather
 *      than silently running "isolated" against the live clinic.
 *
 * When the flag is unset every function here reports "not isolated" and the
 * production behaviour is byte-for-byte unchanged.
 *
 * PURE — no DB, no network, no logger, no `process.env` read except through the
 * `env` argument. Everything above that touches the world lives in
 * `src/devIsolationBoot.ts`, so this file stays unit-testable in isolation.
 */

export const DEV_ISOLATION_ENV = "CARE_DEV_ISOLATED";

/** Comma/space-separated `host` or `host:port` entries permitted by the egress guard. */
export const DEV_EGRESS_ALLOW_ENV = "CARE_DEV_EGRESS_ALLOW";

/**
 * Optional override of the one database this mode will attach to. The default is
 * the approved development database; overriding it is allowed so the recipe works
 * on another machine, but the override still has to be a loopback URL.
 */
export const DEV_DATABASE_URL_ENV = "CARE_DEV_DATABASE_URL";

/** Optional override of the dev API port (default 8181). */
export const DEV_API_PORT_ENV = "CARE_DEV_API_PORT";

export type Env = Record<string, string | undefined>;

/** The approved local development database, per the CARE development setup. */
export const APPROVED_DEV_DATABASE = Object.freeze({
  host: "127.0.0.1",
  port: 5411,
  database: "care_dev",
});

/** The API binds loopback-only on this port so the emergency ERP keeps 8080. */
export const DEV_API_HOST = "127.0.0.1";
export const DEV_API_PORT = 8181;
export const DEV_ERP_PORT = 5173;

/**
 * A denied destination is re-pointed here instead of being connected at all.
 * Port 1 is reserved and nothing listens on it, so the attempt is refused
 * immediately, on loopback, without a packet ever leaving the machine — and the
 * caller still gets an ordinary asynchronous connection error rather than a
 * synchronous throw from inside Node's http client.
 */
export const EGRESS_SINKHOLE = Object.freeze({ host: "127.0.0.1", port: 1 });

export const EGRESS_BLOCKED_CODE = "CARE_DEV_ISOLATED_EGRESS_BLOCKED";

export function isIsolated(env: Env = process.env): boolean {
  const raw = env[DEV_ISOLATION_ENV];
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Startup side effects that isolation suppresses, and the reason each one is on
 * the list. This is a REGISTRY, not a comment: `decideStartupStep` throws on an
 * unregistered name, so a new background consumer cannot be added to the boot
 * sequence and quietly opt out of the audit — the author has to either register
 * it (and say why it is dangerous) or prove it is safe to run.
 */
export const BLOCKED_STARTUP_STEPS = Object.freeze({
  radiologyJobConsumer:
    "claims overnight AI/shadow jobs and writes to dicom_retry_queue on every tick",
  aiReportComposeJobConsumer:
    "drains ai_report_compose_jobs and opens provider sockets on every tick",
  cronScheduler: "all ~40 scheduled jobs: mail, WhatsApp, backups, audit purge, banking sync",
  integrationScheduler: "outbox dispatch, status reconcile, electronic-film poll",
  dicomPullAgent: "in-process DIMSE C-FIND/C-MOVE to the DICOM nodes stored in the database",
  startupMigrations: "ALTER TABLE / UPDATE backfills on boot (schema changes are db-patch-v2's job)",
  ensureDefaultLedger: "inserts a default ledger row",
  backfillExpirePublicTokens: "UPDATEs public report-token expiry on boot",
  missingStudyReconciliation: "creates radiology_studies rows from billed order_tests",
  orthancChangesPoller: "polls the clinic Orthanc and self-POSTs study intake with INTERNAL_API_KEY",
  mriStudyWarmer: "repeatedly reads today's and yesterday's MR studies from Orthanc/DICOMweb",
  hopeIntegrationBootstrap: "creates/updates the HOPE partner row and its feature flag",
  pacsSettingsSeed: "seeds production LAN host/URL defaults into pacs_settings",
  radiologyConfigValidation: "startup validation probes of the PACS/viewer configuration",
  pluginLoaderUsbScan: "scans every removable drive D:-Z: every 5s and import()s code it finds",
}) satisfies Record<string, string>;

export type IsolatedStartupStep = keyof typeof BLOCKED_STARTUP_STEPS;

export type StepDecision = { run: boolean; step: string; reason: string };

/**
 * Decide whether a named boot side effect may run. Unknown names throw: the
 * registry is the control, and a silent default of "allowed" would make every
 * future consumer invisible to it.
 */
export function decideStartupStep(step: string, env: Env = process.env): StepDecision {
  const reason = (BLOCKED_STARTUP_STEPS as Record<string, string>)[step];
  if (reason === undefined) {
    throw new Error(
      `CARE_DEV_ISOLATED: unregistered startup step "${step}". Add it to ` +
        `BLOCKED_STARTUP_STEPS with its reason, or prove it has no side effects.`,
    );
  }
  if (!isIsolated(env)) return { run: true, step, reason };
  return { run: false, step, reason };
}

/**
 * Canonical form of a host for comparison: trimmed, lower-cased, IPv6 brackets
 * removed, and a trailing DNS-root dot dropped (`localhost.` is `localhost`, and
 * `new URL("http://localhost./")` really does report it that way).
 */
export function canonicalHost(raw: string): string {
  const value = String(raw ?? "").trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1]) return bracketed[1];
  return value.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

export function isLoopbackHost(host: string): boolean {
  const h = canonicalHost(host);
  if (h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // IPv4-mapped IPv6 loopback, in either the dotted or the hex form.
  if (/^::ffff:127\./.test(h) || /^::ffff:7f00:1$/.test(h)) return true;
  return false;
}

export type AllowEntry = { host: string; port: number | null };

/** Parse `CARE_DEV_EGRESS_ALLOW` — `host`, `host:port`, `[ipv6]:port`, comma or space separated. */
export function parseEgressAllowlist(raw: string | undefined): AllowEntry[] {
  if (!raw) return [];
  const out: AllowEntry[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const token = piece.trim();
    if (!token) continue;
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(token);
    if (bracketed) {
      const host = canonicalHost(token);
      if (!host) continue;
      out.push({ host, port: bracketed[2] ? Number(bracketed[2]) : null });
      continue;
    }
    const colon = token.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(token.slice(colon + 1))) {
      const host = canonicalHost(token.slice(0, colon));
      if (host) out.push({ host, port: Number(token.slice(colon + 1)) });
      continue;
    }
    const host = canonicalHost(token);
    if (host) out.push({ host, port: null });
  }
  return out;
}

/** Cloud metadata services are never a development target, even if allowlisted. */
export function isCloudMetadataHost(host: string): boolean {
  const h = canonicalHost(host);
  return h === "169.254.169.254" || /^metadata(\.google)?\.internal$/.test(h) || h === "fd00:ec2::254";
}

export type EgressTarget = { host: string; port?: number | null };

export type EgressDecision = { allowed: boolean; reason: string };

/**
 * The single egress decision used by every guard in `devIsolationEgress.ts`.
 * Loopback is always permitted (development Postgres on 5411, the Vite server,
 * a local Ollama, a local Orthanc on 127.0.0.1); everything else needs an
 * explicit entry in CARE_DEV_EGRESS_ALLOW. Private/LAN ranges are NOT implied by
 * "local" here — on this network the clinic's production NAS *is* a LAN address
 * (172.16.1.139, the baked default in `lib/networkDefaults.ts`), so a LAN-wide
 * allowance would defeat the entire purpose of the mode.
 */
export function evaluateEgress(target: EgressTarget, env: Env = process.env): EgressDecision {
  if (!isIsolated(env)) return { allowed: true, reason: "isolation not enabled" };
  const host = canonicalHost(String(target.host ?? ""));
  if (!host) return { allowed: false, reason: "no destination host to judge" };
  if (isCloudMetadataHost(host)) {
    return { allowed: false, reason: `cloud metadata endpoint ${host} is never permitted` };
  }
  if (isLoopbackHost(host)) return { allowed: true, reason: "loopback is a local development service" };
  const port = target.port == null ? null : Number(target.port);
  for (const entry of parseEgressAllowlist(env[DEV_EGRESS_ALLOW_ENV])) {
    if (entry.host !== host) continue;
    if (entry.port == null || port == null || entry.port === port) {
      return { allowed: true, reason: `explicitly allowed by ${DEV_EGRESS_ALLOW_ENV}` };
    }
  }
  return {
    allowed: false,
    reason:
      `${host}${port == null ? "" : ":" + port} is not a local development service. ` +
      `If it is one, add it to ${DEV_EGRESS_ALLOW_ENV}; if it is the clinic's, this is the guard working.`,
  };
}

export type DatabaseTarget = { host: string; port: number; database: string };

/**
 * The approved database = `CARE_DEV_DATABASE_URL` when set, else the development
 * default. An override that is not loopback is rejected, so the override cannot
 * be used to point "isolated" mode at the production server.
 */
export function approvedDatabaseTarget(env: Env = process.env): DatabaseTarget | { error: string } {
  const raw = env[DEV_DATABASE_URL_ENV];
  if (!raw || !raw.trim()) return { ...APPROVED_DEV_DATABASE };
  const parsed = parseDatabaseUrl(raw);
  if ("error" in parsed) return { error: `${DEV_DATABASE_URL_ENV} is not a usable URL: ${parsed.error}` };
  if (!isLoopbackHost(parsed.host)) {
    return { error: `${DEV_DATABASE_URL_ENV} must be a loopback host, got "${parsed.host}"` };
  }
  return { host: parsed.host, port: parsed.port, database: parsed.database };
}

export function parseDatabaseUrl(raw: string): DatabaseTarget | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "not a parseable URL" };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { error: `unsupported scheme "${url.protocol}" (expected postgresql://)` };
  }
  const host = canonicalHost(url.hostname);
  if (!host) return { error: "no host in URL" };
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return { error: `invalid port "${url.port}"` };
  const database = decodeURIComponent(url.pathname.replace(/^\//, "").replace(/\/.*$/, ""));
  if (!database) return { error: "no database name in URL" };
  return { host, port, database };
}

/**
 * Compare a real DATABASE_URL to the approved development database. Any
 * mismatch — production host, the operator's own 5432 cluster, a different
 * database name on the right port — is a refusal.
 */
export function evaluateDatabaseUrl(
  databaseUrl: string | undefined,
  env: Env = process.env,
): EgressDecision {
  if (!isIsolated(env)) return { allowed: true, reason: "isolation not enabled" };
  if (!databaseUrl || !databaseUrl.trim()) {
    return { allowed: false, reason: "DATABASE_URL is not set, so it cannot be verified as the development database" };
  }
  const approved = approvedDatabaseTarget(env);
  if ("error" in approved) return { allowed: false, reason: approved.error };
  const actual = parseDatabaseUrl(databaseUrl);
  if ("error" in actual) {
    return { allowed: false, reason: `DATABASE_URL: ${actual.error}` };
  }
  const sameHost =
    actual.host === approved.host ||
    (isLoopbackHost(actual.host) && isLoopbackHost(approved.host));
  if (!sameHost || actual.port !== approved.port || actual.database !== approved.database) {
    return {
      allowed: false,
      reason:
        `DATABASE_URL points at ${actual.host}:${actual.port}/${actual.database} but isolated mode ` +
        `requires ${approved.host}:${approved.port}/${approved.database}. Refusing to start: a ` +
        `production or unrelated database must never be reached by a development instance.`,
    };
  }
  return { allowed: true, reason: "matches the approved development database" };
}

/**
 * What the HTTP listener should bind to. Isolated mode ignores PORT/HOST from the
 * environment: the restored `.env` still says `PORT=8080`, which on this Windows
 * machine belongs to the separate emergency ERP, and a 0.0.0.0 bind would expose a
 * database copy of production records to the clinic LAN.
 *
 * Outside isolated mode `host` is deliberately `undefined` — the caller must omit
 * the option rather than pass "0.0.0.0", because Node's default is the dual-stack
 * wildcard while an explicit "0.0.0.0" would silently drop IPv6.
 */
export function resolveListenConfig(env: Env = process.env): { host?: string; port: number } {
  if (!isIsolated(env)) {
    const rawPort = env["PORT"] ?? "8080";
    const port = Number(rawPort);
    return { port: Number.isFinite(port) && port > 0 ? port : 8080 };
  }
  const override = env[DEV_API_PORT_ENV];
  const port = override ? Number(override) : DEV_API_PORT;
  return { host: DEV_API_HOST, port: Number.isFinite(port) && port > 0 ? port : DEV_API_PORT };
}

/** A one-line description for the boot log and `/health`, so "why is nothing running" is answerable. */
export function describeIsolation(env: Env = process.env): string {
  if (!isIsolated(env)) return "off (production behaviour)";
  const allow = parseEgressAllowlist(env[DEV_EGRESS_ALLOW_ENV]);
  const approved = approvedDatabaseTarget(env);
  const target = "error" in approved ? `INVALID (${approved.error})` : `${approved.host}:${approved.port}/${approved.database}`;
  return (
    `ON — ${Object.keys(BLOCKED_STARTUP_STEPS).length} background steps suppressed, ` +
    `database ${target}, egress loopback-only${allow.length ? ` + ${allow.length} allowlisted target(s)` : ""}`
  );
}
