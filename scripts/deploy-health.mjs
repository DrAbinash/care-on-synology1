/**
 * deploy-health.mjs — does the Synology deployment actually work?
 *
 * Why this exists: `deploy-synology.sh` waited on `http://localhost:8080/...`,
 * and nothing publishes port 8080 on the NAS host. `grep -n ':8080'
 * docker-compose.yml` returns only care-api's *in-container* healthcheck; the
 * ERP is published as `${HOST_PORT:-8888}:80` and the API has no `ports:` block
 * at all. The probe therefore failed on every deploy, the wait loop ran out its
 * budget, fell through, and the script printed DEPLOYMENT COMPLETE — so a deploy
 * in which the API never started was indistinguishable from a good one. The
 * migration loop had the same shape: a missing container yields `missing 0` from
 * `docker inspect`, and the script continued.
 *
 * This file is the gate. It checks the endpoints that are really reachable and
 * the containers that really have to be in a given state, and it exits non-zero
 * when any of them is not. Everything it prints is what it measured.
 *
 * What it checks, and why each one is the honest gate:
 *
 *   care-db            long-run  healthy     the app's own readiness depends on it
 *   care-db-patch-v2   one-shot  exited(0)   the ONLY thing that mutates the clinic DB
 *   care-schema-verify one-shot  exited(0)   the schema matches the code being served
 *   care-api           long-run  healthy     its healthcheck is `curl -fsS /health`
 *   care-web           long-run  healthy     nginx is serving, not just running
 *
 *   GET /nginx-health         200 body "ok"  answered by nginx itself, not the app
 *   GET /api/healthz          200 status=ok  DB reachable; 503 while "starting"
 *   GET /api/health/schema    200 ok=true    db_patch_ok + schema verification passed
 *
 * The last one is the important one: it returns 503 with its own reason when
 * `care-db-patch-v2` did not complete (app.ts:145, Gate 1), so a deploy that
 * started the app on a half-migrated schema fails here rather than printing a
 * success banner.
 *
 * Nothing here restarts, recreates or removes a container, and nothing writes to
 * the database: it is `docker inspect` and GET requests only.
 *
 * Usage on the NAS (the deploy script calls this; run it by hand any time):
 *   sudo node scripts/deploy-health.mjs
 *   sudo node scripts/deploy-health.mjs --wait --timeout-seconds 240
 *   node scripts/deploy-health.mjs --base-url http://localhost:8888 --skip-docker
 *
 * Requires Node 12+ (uses `node:http`, not global fetch) so it works on whatever
 * runtime Synology ships.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The published ERP port when `.env` does not say otherwise. */
export const DEFAULT_HOST_PORT = 8888;

/** Containers a completed deploy must have, and the state each must be in. */
export const REQUIRED_CONTAINERS = [
  { name: "care-db", kind: "long-run" },
  { name: "care-db-patch-v2", kind: "one-shot" },
  { name: "care-schema-verify", kind: "one-shot" },
  { name: "care-api", kind: "long-run" },
  { name: "care-web", kind: "long-run" },
];

/**
 * The HTTP probes, all reached through the single port the NAS actually
 * publishes. `expect` says exactly what has to be true; a probe that is merely
 * "answered" is not a pass.
 */
export const REQUIRED_PROBES = [
  { name: "nginx is serving", path: "/nginx-health", expect: "nginx-ok" },
  { name: "API reaches the database", path: "/api/healthz", expect: "healthz-ok" },
  { name: "schema is migrated and verified", path: "/api/health/schema", expect: "schema-ok" },
];

export function parseArgs(argv, env = process.env) {
  const opts = {
    baseUrl: null,
    hostPort: null,
    dockerPrefix: [],
    skipDocker: false,
    skipHttp: false,
    wait: false,
    timeoutSeconds: 180,
    intervalSeconds: 5,
    envFile: ".env",
    hopeProbe: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--base-url") opts.baseUrl = next();
    else if (a === "--host-port") opts.hostPort = Number(next());
    else if (a === "--docker-prefix") opts.dockerPrefix = String(next()).split(/\s+/).filter(Boolean);
    else if (a === "--skip-docker") opts.skipDocker = true;
    else if (a === "--skip-http") opts.skipHttp = true;
    else if (a === "--wait") opts.wait = true;
    else if (a === "--timeout-seconds") opts.timeoutSeconds = Number(next());
    else if (a === "--interval-seconds") opts.intervalSeconds = Number(next());
    else if (a === "--env-file") opts.envFile = next();
    else if (a === "--no-hope-probe") opts.hopeProbe = false;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(opts.timeoutSeconds) || opts.timeoutSeconds <= 0) opts.timeoutSeconds = 180;
  if (!Number.isFinite(opts.intervalSeconds) || opts.intervalSeconds <= 0) opts.intervalSeconds = 5;
  // Without --wait this is a single pass: the deploy script uses it as a gate
  // after its own build, where waiting twice would only slow the rollback path.
  if (!opts.baseUrl) {
    const port = Number.isFinite(opts.hostPort) ? opts.hostPort : DEFAULT_HOST_PORT;
    opts.baseUrl = `http://localhost:${port}`;
  }
  return opts;
}

/**
 * Read the published app port out of the compose `.env`, so the gate checks the
 * address the clinic actually uses rather than a hard-coded one. Only
 * unquoted `KEY=value` lines count, and a comment never overrides.
 */
export function hostPortFromEnvText(text) {
  if (typeof text !== "string") return null;
  let found = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^HOST_PORT\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim().replace(/^["']|["']$/g, "");
    const n = Number(value);
    if (Number.isFinite(n) && n > 0 && n < 65536) found = n;
  }
  return found;
}

/**
 * One container's inspect output → whether it is in the state a completed
 * deploy requires. `oneshot` containers must have EXITED 0; treating a still
 * running migration container as healthy would let a wedged deploy pass.
 */
export function evaluateContainer(name, kind, state) {
  if (!state || typeof state !== "object") {
    return { name, kind, ok: false, actual: "not found", why: `no container named ${name} — it was never created, so the deploy did not run` };
  }
  const status = String(state.Status || state.status || "");
  const exit = Number(state.ExitCode ?? state.ExitCode2 ?? 0);
  const health = String(state.Health || state.health || "");
  if (kind === "one-shot") {
    if (status === "running") {
      return { name, kind, ok: false, actual: "running", why: "the one-shot has not finished, so the schema is not settled" };
    }
    if (status !== "exited") {
      return { name, kind, ok: false, actual: status || "unknown", why: `expected a completed run, got "${status || "unknown"}"` };
    }
    if (exit !== 0) {
      return { name, kind, ok: false, actual: `exited(${exit})`, why: `exited ${exit} — the migration/verification step failed` };
    }
    return { name, kind, ok: true, actual: "exited(0)", why: "" };
  }
  // Long-running services: a container that is merely "running" is not enough
  // when it has a healthcheck — care-api's own probe is `curl -fsS /health`.
  if (health && health !== "healthy") {
    return { name, kind, ok: false, actual: `${status || "?"}/${health}`, why: `health is "${health}"` };
  }
  if (status !== "running") {
    return { name, kind, ok: false, actual: status || "unknown", why: `expected a running service, got "${status || "unknown"}"` };
  }
  if (exit !== 0) {
    return { name, kind, ok: false, actual: `running exit=${exit}`, why: `a previous run exited ${exit}` };
  }
  return { name, kind, ok: true, actual: health ? "healthy" : "running", why: "" };
}

/**
 * A probe's outcome → pass/fail with the server's own words where it has any.
 * The 503 bodies from `/api/healthz` and `/api/health/schema` say *why* (e.g.
 * "db-patch-v2 did not complete"), and that reason is what the operator needs,
 * so it is carried through instead of flattened into "unhealthy".
 */
export function evaluateProbe(name, path, expect, result) {
  if (!result) {
    return { name, path, ok: false, actual: "no response", why: "the request never completed" };
  }
  const { status, body, error } = result;
  if (error) {
    const kind = /ECONNREFUSED/.test(error) ? "connection refused"
      : /ETIMEDOUT|ESOCKETTIMEDOUT|timed out/.test(error) ? "timed out"
      : error;
    return { name, path, ok: false, actual: kind, why: `${path} was not reachable (${kind}) — is care-web up and is the port published?` };
  }
  if (status === null || status === undefined) {
    return { name, path, ok: false, actual: "no status", why: "no HTTP status came back" };
  }
  if (expect === "nginx-ok") {
    // nginx's health location is `return 200 "ok\n"` (docker/nginx.conf:203).
    // Requiring the body, not just a 2xx, is what stops a SPA fallback from
    // passing: measured against the Vite dev server, GET /nginx-health answers
    // 200 with index.html — a page being served is not the same proof as nginx
    // answering its own probe.
    const answered = status >= 200 && status < 300 && String(body || "").trim() === "ok";
    if (answered) return { name, path, ok: true, actual: `HTTP ${status} "ok"`, why: "" };
    const lookedLikeHtml = /<!doctype html|<html/i.test(String(body || ""));
    return { name, path, ok: false, actual: `HTTP ${status}`,
      why: lookedLikeHtml
        ? `${path} returned HTML, not nginx's "ok" — the app is answering, not the health location`
        : `${path} did not answer 200 "ok" (nginx is not serving)` };
  }

  // The readiness and schema probes are parsed before their status code is
  // trusted: both answer 503 with a body that says *which* problem it is
  // ("starting" vs "degraded"/db unreachable vs "db-patch-v2 did not
  // complete"), and collapsing those into "HTTP 503" would throw away the one
  // sentence that tells the operator what to do.
  let json = null;
  try { json = JSON.parse(String(body || "")); } catch { json = null; }
  if (!json || typeof json !== "object") {
    return { name, path, ok: false, actual: status >= 200 && status < 300 ? "unparsable body" : `HTTP ${status}`,
      why: status >= 200 && status < 300
        ? `${path} answered ${status} but not with JSON`
        : `${path} returned HTTP ${status} with no readable reason` };
  }
  if (expect === "healthz-ok") {
    if (json.status === "ok" && status >= 200 && status < 300) {
      // `startupMigrations: "failed"` is a truthful degradation the server
      // reports while still serving; the one-shot migrator is the authority, so
      // that is judged by the schema probe, not here.
      return { name, path, ok: true, actual: "status=ok", why: "" };
    }
    if (json.status === "starting") {
      return { name, path, ok: false, actual: "status=starting", why: "the API bound its socket but startup has not settled" };
    }
    if (json.status === "degraded" || json.db === "unreachable") {
      return { name, path, ok: false, actual: "status=degraded", why: `readiness reported "degraded"${json.db === "unreachable" ? " — the database is unreachable" : ""}` };
    }
    return { name, path, ok: false, actual: `status=${json.status ?? "?"}`, why: `${path} did not report ok (HTTP ${status})` };
  }
  if (expect === "schema-ok") {
    if (json.ok === true && status >= 200 && status < 300) return { name, path, ok: true, actual: "ok=true", why: "" };
    return { name, path, ok: false, actual: json.ok === false ? "ok=false" : `HTTP ${status}`,
      why: json.error ? `${path} says: ${json.error}` : `the schema probe did not report ok:true (HTTP ${status})` };
  }
  return { name, path, ok: false, actual: `HTTP ${status}`, why: `unknown expectation "${expect}"` };
}

/** Aggregate one pass into a verdict. Pure, so the failure modes are testable. */
export function classifyPass(containers, probes) {
  const failed = [
    ...containers.filter((c) => !c.ok).map((c) => ({ check: `container ${c.name}`, why: `${c.why} (actual: ${c.actual})` })),
    ...probes.filter((p) => !p.ok).map((p) => ({ check: `http ${p.path}`, why: `${p.why} (actual: ${p.actual})` })),
  ];
  return { ok: failed.length === 0, failed };
}

export function formatVerdict(verdict, containers, probes, notes = []) {
  const lines = [];
  lines.push("  Deployment health");
  for (const c of containers) {
    lines.push(`   ${c.ok ? "✓" : "✗"} ${c.name.padEnd(19)} ${String(c.actual).padEnd(14)} ${c.ok ? "" : `← ${c.why}`}`);
  }
  for (const p of probes) {
    lines.push(`   ${p.ok ? "✓" : "✗"} ${`GET ${p.path}`.padEnd(19)} ${String(p.actual).padEnd(14)} ${p.ok ? "" : `← ${p.why}`}`);
  }
  for (const n of notes) lines.push(`   · ${n}`);
  if (!verdict.ok) {
    lines.push("");
    lines.push(`  ${verdict.failed.length} check(s) failed:`);
    for (const f of verdict.failed) lines.push(`   - ${f.check}: ${f.why}`);
  }
  return lines.join("\n");
}

/** GET a path with node:http so an older Synology Node still works. */
export function httpGet(baseUrl, path, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(path, baseUrl); } catch (e) { resolve({ error: String(e && e.message || e) }); return; }
    const req = request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: "GET", timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8").slice(0, 8000) }));
    });
    req.on("timeout", () => { req.destroy(new Error("timed out")); });
    req.on("error", (e) => resolve({ error: e.code ? `${e.code} ${e.message}` : e.message, status: null, body: "" }));
    req.end();
  });
}

/**
 * `docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.Health}}'`
 * → the three facts the gate needs. `none` is what the template prints when the
 * image declares no healthcheck: distinct from "healthy", which it must never be
 * confused with.
 */
export function parseInspectLine(line) {
  const parts = String(line || "").trim().split(/\s+/);
  if (parts.length < 2 || !parts[0]) return null;
  const health = parts[2] === undefined || parts[2] === "none" ? "" : parts[2];
  const exit = Number(parts[1]);
  return { status: parts[0], ExitCode: Number.isFinite(exit) ? exit : -1, Health: health };
}

/**
 * One container, one `docker inspect`.
 *
 * Batched inspect — passing all five names to a single call — pairs its output
 * back to names by position, and Docker omits the block for a name it cannot
 * find while printing `Error: No such object: <name>` to stderr. So a missing
 * care-db-patch-v2 hands care-schema-verify's state to the migrator's check:
 * the exact false green this whole gate replaces. One call per container is a
 * few milliseconds more and cannot shift.
 */
export function inspectOne(name, opts = {}) {
  const dockerPrefix = opts.dockerPrefix || [];
  const spawn = opts.spawnImpl || ((a) => spawnSync("docker", a, { encoding: "utf8" }));
  const res = spawn([...dockerPrefix, "inspect", "--format",
    "{{.State.Status}} {{.State.ExitCode}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", name]);
  if (res && res.error) {
    return { state: null, reason: /ENOENT/.test(String(res.error)) ? "docker is not available on this host" : String(res.error) };
  }
  if (!res || res.status !== 0) return { state: null, reason: "no such container" };
  const state = parseInspectLine(res.stdout);
  return state ? { state } : { state: null, reason: "inspect returned nothing readable" };
}

export function runDockerInspect(dockerPrefix, names, spawnImpl) {
  const byName = new Map();
  const notes = [];
  for (const name of names) {
    const { state, reason } = inspectOne(name, { dockerPrefix, spawnImpl });
    if (state) byName.set(name, state);
    else notes.push(`${name}: ${reason}`);
  }
  return { byName, notes };
}

/**
 * The CARE→HOPE callback target, reported only. It never gates a CARE deploy:
 * HOPE being down is not a failed CARE deployment, and a check that could fail
 * the build for a partner outage would be a reason to skip the gate.
 */
export function hopeOriginFromEnvText(text) {
  if (typeof text !== "string") return null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^INTEGRATION_HOPE_CALLBACK_URL\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim().replace(/^["']|["']$/g, "");
    try { return new URL(value).origin; } catch { return null; }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function onePass(opts) {
  const inspect = opts.skipDocker
    ? { byName: new Map(), notes: [] }
    : runDockerInspect(opts.dockerPrefix, REQUIRED_CONTAINERS.map((c) => c.name), opts.spawnImpl);
  const containers = REQUIRED_CONTAINERS.map((c) => {
    if (opts.skipDocker) return { name: c.name, kind: c.kind, ok: true, actual: "skipped", why: "" };
    return evaluateContainer(c.name, c.kind, inspect.byName.get(c.name));
  });
  const probes = [];
  for (const p of opts.skipHttp ? [] : REQUIRED_PROBES) {
    const result = await httpGet(opts.baseUrl, p.path);
    probes.push(evaluateProbe(p.name, p.path, p.expect, result));
  }
  if (opts.skipHttp) for (const p of REQUIRED_PROBES) probes.push({ name: p.name, path: p.path, ok: true, actual: "skipped", why: "" });
  return { containers, probes, verdict: classifyPass(containers, probes) };
}

/**
 * The HOPE side is reported, never gated — see hopeOriginFromEnvText. Returns
 * one sentence for the notes list, or null when nothing is configured.
 */
async function hopeNote(opts) {
  if (!opts.hopeProbe) return null;
  let text = "";
  try { text = readFileSync(opts.envFile, "utf8"); } catch { return null; }
  const origin = hopeOriginFromEnvText(text);
  if (!origin) return null;
  const res = await httpGet(origin, "/", 5_000);
  if (res.error) return `HOPE at ${origin} is not answering (${res.error}) — CARE referrals queue and retry; this does not gate a CARE deploy`;
  return `HOPE at ${origin} answered HTTP ${res.status} — CARE↔HOPE endpoint reachable`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv, env);
  const started = Date.now();
  let last = null;
  for (;;) {
    last = await onePass(opts);
    if (last.verdict.ok) break;
    if (!opts.wait) break;
    if ((Date.now() - started) / 1000 > opts.timeoutSeconds) break;
    await sleep(opts.intervalSeconds * 1000);
  }
  const notes = [];
  const timedOut = !last.verdict.ok && opts.wait && (Date.now() - started) / 1000 > opts.timeoutSeconds;
  if (timedOut) notes.push(`waited ${opts.timeoutSeconds}s and the checks are still failing`);
  if (opts.skipDocker) notes.push("container checks skipped (--skip-docker)");
  if (opts.skipHttp) notes.push("HTTP checks skipped (--skip-http)");
  notes.push(`probing ${opts.baseUrl} — the port the ERP actually publishes`);
  const hope = await hopeNote(opts);
  if (hope) notes.push(hope);
  console.log(formatVerdict(last.verdict, last.containers, last.probes, notes));
  return last.verdict.ok ? 0 : 1;
}

// Only run as a CLI when this file *is* the entry point, so importing it from a
// test does not fire a live probe of localhost.
const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`  ✗ health check crashed: ${e && e.stack || e}`);
    process.exitCode = 2;
  });
}
