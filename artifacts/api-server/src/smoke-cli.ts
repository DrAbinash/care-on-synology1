/**
 * smoke-cli.ts — `pnpm smoke:production` Deployment Smoke Test.
 *
 * Runs the SAME operations checks as GET /api/admin/operations/health, but
 * standalone: it queries the DB directly and HTTP-probes the running API over
 * --base-url. No browser, no admin token required (it is a trusted in-container
 * script). Prints a compact terminal summary or machine-readable JSON and sets
 * an exit code: 0 = all required checks passed (warnings are non-fatal), 1 = a
 * required check FAILed (or, with --strict, an UNKNOWN overall).
 *
 * Options:
 *   --json                 machine-readable JSON to stdout
 *   --base-url <url>       API base to probe (default $SMOKE_BASE_URL / $API_BASE_URL / http://localhost:$PORT)
 *   --include-optional     also run optional integration checks (n8n, Evolution, …)
 *   --timeout <ms>         per-check timeout (default 5000)
 *   --save-result          persist the run into operational_health_runs
 *   --transactional        also run the rollback-isolated create/read/update probe
 *   --strict               make an UNKNOWN overall non-zero too
 *   --trigger <name>       deployment | cli | scheduled (default cli)
 */
import { aggregateOverall, summarize, exitCodeFor, type OpsCheck, type OpsHealthReport, type OpsRunTrigger } from "./lib/operationsHealth";
import { buildOperationsReport } from "./lib/operationsChecks";
import { buildOpsContext, makeHttpProbe } from "./lib/operationsContext";

interface Args {
  json: boolean; baseUrl: string; includeOptional: boolean; timeout: number;
  save: boolean; transactional: boolean; strict: boolean; trigger: OpsRunTrigger;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  const port = process.env.PORT || "8080";
  const trigger = (get("--trigger") as OpsRunTrigger) || "cli";
  return {
    json: has("--json"),
    baseUrl: (get("--base-url") || process.env.SMOKE_BASE_URL || process.env.API_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    includeOptional: has("--include-optional"),
    timeout: Number(get("--timeout")) || 5000,
    save: has("--save-result"),
    transactional: has("--transactional"),
    strict: has("--strict"),
    trigger: ["deployment", "cli", "scheduled", "admin"].includes(trigger) ? trigger : "cli",
  };
}

// ── terminal rendering ───────────────────────────────────────────────────────
const LABEL: Record<OpsCheck["status"], string> = { PASS: "PASS", WARNING: "WARN", FAIL: "FAIL", SKIPPED: "SKIP", UNKNOWN: "UNKN" };
function colorize(status: OpsCheck["status"], text: string): string {
  if (!process.stdout.isTTY) return text;
  const c: Record<OpsCheck["status"], string> = { PASS: "\x1b[32m", WARNING: "\x1b[33m", FAIL: "\x1b[31m", SKIPPED: "\x1b[90m", UNKNOWN: "\x1b[35m" };
  return `${c[status]}${text}\x1b[0m`;
}

function printReport(report: OpsHealthReport): void {
  const out: string[] = ["CARE-ERP DEPLOYMENT SMOKE TEST"];
  for (const c of report.checks) {
    out.push(`${colorize(c.status, LABEL[c.status].padEnd(4))}  ${c.name.padEnd(30)} ${c.message}`);
  }
  out.push("");
  out.push(`Overall: ${colorize(report.overall, report.overall)}`);
  const s = report.summary;
  out.push(`Summary: ${s.pass} pass · ${s.warning} warn · ${s.fail} fail · ${s.skipped} skip · ${s.unknown} unknown`);
  out.push(`Version: ${report.version.version} (build ${report.version.build}) commit ${report.version.commit}`);
  out.push(`Duration: ${report.durationMs}ms`);
  process.stdout.write(out.join("\n") + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    process.stderr.write("smoke: DATABASE_URL is required (run inside the api container or set it explicitly).\n");
    process.exit(1);
  }

  // Import DB-backed pieces only after the env guard so the failure is friendly.
  const { pool } = await import("@workspace/db");
  const query = async (text: string, params?: unknown[]) => (await pool.query(text, params as unknown[] | undefined)).rows as Array<Record<string, unknown>>;

  const ctx = await buildOpsContext({
    now: new Date(),
    mode: "cli",
    baseUrl: args.baseUrl,
    query,
    probe: makeHttpProbe(args.timeout),
    uptimeSeconds: null,
  });

  let report = await buildOperationsReport(ctx, { includeOptional: args.includeOptional, timeoutMs: args.timeout, trigger: args.trigger });

  if (args.transactional) {
    const { runTransactionalSmoke } = await import("./lib/operationsSmokeTransaction");
    const txChecks = await runTransactionalSmoke(new Date());
    const checks = [...report.checks, ...txChecks];
    report = { ...report, checks, overall: aggregateOverall(checks), summary: summarize(checks) };
  }

  if (args.save) {
    try {
      const { recordOpsRun } = await import("./lib/operationsHistory");
      const { randomUUID } = await import("node:crypto");
      await recordOpsRun({ report, runId: randomUUID(), initiatedBy: null });
    } catch (e) {
      process.stderr.write(`smoke: --save-result failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else printReport(report);

  await pool.end().catch(() => { /* ignore */ });
  process.exit(exitCodeFor(report.overall, { strict: args.strict }));
}

main().catch((err) => {
  process.stderr.write(`smoke: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
