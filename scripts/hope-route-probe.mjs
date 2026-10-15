#!/usr/bin/env node
/**
 * hope-route-probe.mjs — measure the CARE→HOPE network route instead of assuming it.
 * ================================================================================
 *
 * WHY THIS EXISTS
 *   The outbox posts to `INTEGRATION_HOPE_CALLBACK_URL` with a plain `fetch`
 *   (artifacts/api-server/src/services/integration/outbox.ts) at whatever address the
 *   operator typed. On this NAS "reachable" is not one fact but several, because the
 *   same URL answers differently depending on WHERE the attempt starts. Measured
 *   read-only on the production box on 2026-10-15, from inside `care-api`:
 *
 *     http://192.168.1.137:7080   (NAS's own LAN IP + HOPE's published port) → TIMEOUT
 *     http://hope_hospital_app:5000 (container DNS, other compose project)   → ENOTFOUND
 *     http://192.168.64.1:7080    (care-api's own bridge gateway)            → 200
 *     http://192.168.48.4:5000    (HOPE's container IP)                      → 200
 *
 *   The first form is the one the deploy template ships, because it is what a person
 *   types into a browser — and it is the one form a container on that same NAS cannot
 *   use. The two that answer are an IP and a bridge gateway, both of which change on
 *   the next recreate of either stack, so neither is a permanent answer either. The
 *   durable shape is one shared user-defined bridge network plus the peer's Docker
 *   network alias; that is what deploy/synology/care-hope-network.override.yml is for,
 *   and this script is how you prove it before letting a report depend on it.
 *
 *   Nothing else in the repository asks any of this. `ops-preflight.mjs`'s
 *   `hope.integration` checks whether a callback URL is SET. A URL can be set,
 *   well-formed, and unreachable from the only place that matters, and the outbox
 *   reports that only as an `http_error` on a dead-lettered row days later.
 *
 * WHAT IT DOES
 *   For each candidate address it attempts one HTTP GET from this host and, with
 *   `--container`, the same GET from inside the API container. Any HTTP status counts
 *   as a route that exists — 401 and 404 are the peer answering, and this measures the
 *   route, not the credential.
 *
 * WHAT IT NEVER DOES
 *   No signed event, no body, no PHI, no credential: the request carries no
 *   `x-care-signature` and no `Authorization`, so a reachable receiver refuses it for
 *   want of a signature, which is the right answer to a route test. It does not read
 *   the signing secret at all, writes nothing, restarts nothing and changes no
 *   network. Read-only inspection, and the exit code is the only machine-facing
 *   output.
 *
 * USAGE
 *   node scripts/hope-route-probe.mjs
 *   node scripts/hope-route-probe.mjs --container care-api
 *   node scripts/hope-route-probe.mjs --container care-api --dns hope_hospital_app --dns-port 5000
 *   node scripts/hope-route-probe.mjs --url http://192.168.1.137:7080/api/integration/care-callback
 *
 * EXIT CODE
 *   0 the configured URL answers from where the outbox runs
 *   1 it does not answer (and, when one is shown, a candidate does)
 *   2 nothing could be attempted — no URL, no docker, no curl. UNKNOWN, never a pass.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export const PASS = "reachable";
export const FAIL_ROUTE = "blocked";
export const UNKNOWN = "unknown";

/**
 * What kind of address a host is. This is a label for the report and the remediation,
 * not a guess about reachability — only an attempt decides that.
 */
export function classifyHost(host) {
  const h = (host || "").trim().toLowerCase();
  if (!h) return { kind: "empty", permanent: false };
  if (h === "localhost" || h === "::1" || h.startsWith("127.")) return { kind: "loopback", permanent: false };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const lan = /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    return { kind: lan ? "lan-ip" : "public-ip", permanent: false };
  }
  // A Docker network alias is the durable form: the NAME is stable even though the IP
  // behind it is not, provided the two containers share a user-defined network.
  return { kind: "container-dns", permanent: true };
}

/** Parse a URL into the origin a route attempt needs. Never throws. */
export function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return {
      url,
      scheme: u.protocol.replace(/:$/, ""),
      host: u.hostname,
      port: u.port || (u.protocol === "https:" ? "443" : "80"),
      path: `${u.pathname}${u.search}` || "/",
    };
  } catch {
    return null;
  }
}

/**
 * The addresses worth trying: the configured one first, because that is the fact that
 * matters, then the container-DNS form the operator says the peer answers on, so a
 * failure names a way forward instead of only a dead end.
 */
export function candidatesFor(opts = {}) {
  const out = [];
  const configured = originOf(opts.url);
  if (configured) {
    out.push({ label: "configured", ...configured, kind: classifyHost(configured.host).kind, role: "configured" });
  }
  if (opts.dns && opts.dnsPort) {
    const scheme = opts.dnsScheme || "http";
    const p = configured ? configured.path : "/";
    out.push({
      label: "container DNS",
      url: `${scheme}://${opts.dns}:${opts.dnsPort}${p}`,
      scheme,
      host: opts.dns,
      port: String(opts.dnsPort),
      path: p,
      kind: "container-dns",
      role: "candidate",
    });
  }
  return out;
}

/**
 * Why one answer came back, in the words an operator can search for. Node's fetch
 * says `ENOTFOUND`; curl says `Could not resolve host`; both mean the same route fact,
 * and the two lines of one report must be comparable.
 */
const REASONS = {
  ENOTFOUND: "the name does not resolve from here",
  ECONNREFUSED: "nothing is listening on that port from here",
  ETIMEDOUT: "no answer before the deadline; on this NAS that is the same-box published-port hairpin block",
  TimeoutError: "no answer before the 5 s deadline; on this NAS that is the same-box published-port hairpin block",
  AbortError: "the request was abandoned at its own deadline — the same shape as a timeout",
  EHOSTUNREACH: "the network has no path to that address from here",
  ENETUNREACH: "the network has no path to that address from here",
  EACCES: "the request was refused by policy before it left",
};

/** curl exits with a number for each failure mode; 6 and 28 are the two that matter here. */
const CURL_EXIT = { 5: "ENOTFOUND", 6: "ENOTFOUND", 7: "ECONNREFUSED", 28: "ETIMEDOUT", 52: "ECONNREFUSED" };

function reasonFor(code) {
  return REASONS[code] ?? REASONS[String(code).toUpperCase()] ?? "the peer was not reached";
}

/** One attempt's raw result → the outcome word the report and the exit code use. */
export function interpretAttempt(res) {
  if (!res) return { outcome: "not-attempted", detail: "no attempt was made" };
  if (res.missing) return { outcome: "not-attempted", detail: res.missing };
  const text = `${res.stderr || ""} ${res.stdout || ""}`.trim();
  const said = `${res.stdout || ""}`.trim();
  // A container whose Node has no global fetch cannot answer this question at all.
  if (/fetch is not defined|ReferenceError/i.test(text)) {
    return { outcome: "not-attempted", detail: "the container's Node has no global fetch — not measurable this way" };
  }
  // Only a LABELLED status counts as an HTTP answer. The first live run of this probe
  // printed `HTTP 319` for a request that took 319 ms, because an unanchored three-digit
  // regex found the latency instead of the status — and a latency is not a route.
  const labelled = /^(?:HTTP|STATUS)\s+(\d{3})\b/i.exec(said);
  if (labelled) return { outcome: PASS, detail: `HTTP ${labelled[1]}` };
  const err = /^ERR\s+(\S+)/i.exec(said);
  if (err) {
    // Printed verbatim: `ENOTFOUND` and `AbortError` are both the exact strings an
    // operator can search for, and upper-casing a Node error name breaks that search.
    const code = err[1];
    if (/^\d+$/.test(code)) {
      // A DOMException's legacy numeric code. 23 is TimeoutError — the shape the
      // hairpin block takes from inside a container — but a number is not something
      // an operator can search for, so it is named here rather than reported bare.
      const named = { 20: "AbortError", 23: "TimeoutError" }[code];
      const detail = named ? `${named} — ${reasonFor(named)}` : `${code} — a failure this probe could not name, but the peer did not answer`;
      return { outcome: named ? "refused" : "not-attempted", detail };
    }
    return { outcome: "refused", detail: `${code} — ${reasonFor(code)}` };
  }
  if (res.code !== 0 && CURL_EXIT[res.code]) {
    const code = CURL_EXIT[res.code];
    return { outcome: "refused", detail: `${code} — ${reasonFor(code)}` };
  }
  const word = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EACCES|timed out|could not resolve|no route to host|aborterror/i
    .exec(text);
  if (word) {
    const s = word[0].toLowerCase();
    const code = /enotfound|could not resolve/.test(s) ? "ENOTFOUND"
      : /econnrefused/.test(s) ? "ECONNREFUSED"
        : /etimedout|timed out/.test(s) ? "ETIMEDOUT"
          : /ehostunreach|no route to host/.test(s) ? "EHOSTUNREACH"
            : /enetunreach/.test(s) ? "ENETUNREACH"
              : /aborterror/.test(s) ? "AbortError" : s.toUpperCase();
    return { outcome: "refused", detail: `${code} — ${reasonFor(code)}` };
  }
  // An answer this tool cannot read is UNKNOWN. It is NOT "connected": the first live
  // run called an aborted request "connected" precisely because a zero exit with no
  // readable status was treated as success, and a hairpin-blocked route was reported
  // as reachable on the production box.
  if (res.code === 0) {
    return { outcome: "not-attempted", detail: said ? `the attempt answered in a form this probe cannot read: ${said.slice(0, 90)}` : "the attempt returned no status and no error" };
  }
  return { outcome: "refused", detail: `exit ${res.code}${text ? ` — ${text.slice(0, 120)}` : ""}` };
}

/**
 * Pair each candidate with its host attempt and, when a container was asked for, its
 * attempt from inside the container.
 */
export function buildRows({ candidates, attempts, container }) {
  const rows = [];
  for (const c of candidates) {
    rows.push({ ...c, from: "this host", ...interpretAttempt(attempts[c.url]) });
    if (container) {
      rows.push({ ...c, from: `inside ${container}`, ...interpretAttempt(attempts[`${c.url}|container`]) });
    }
  }
  return rows;
}

/**
 * The verdict keys off the configured URL as seen from where the outbox actually runs:
 * the container when one was named, because that is the only vantage point that can
 * deliver a report. The host answer is still printed — the difference between the two
 * is the finding.
 */
export function evaluate({ candidates, attempts, container }) {
  const rows = buildRows({ candidates, attempts, container });
  const configured = rows.filter((r) => r.role === "configured");
  if (!configured.length) {
    return { verdict: UNKNOWN, code: 2, rows, why: "no INTEGRATION_HOPE_CALLBACK_URL is configured and none was given — there is no route to ask about" };
  }
  const deciding = (container ? configured.find((r) => r.from === `inside ${container}`) : null) || configured[0];
  if (deciding.outcome === "not-attempted") {
    return { verdict: UNKNOWN, code: 2, rows, why: "the attempt could not be run, so the route is unknown, not working" };
  }
  if (deciding.outcome === PASS) return { verdict: PASS, code: 0, rows };
  const better = rows.find((r) => r.role === "candidate" && r.outcome === PASS);
  return {
    verdict: FAIL_ROUTE,
    code: 1,
    rows,
    better,
    remedy: better
      ? `the configured address does not answer from ${deciding.from}, but ${better.url} does — that is the form to configure, with both stacks on the one shared network`
      : "nothing answers. CARE's api and HOPE's app share no network, so a container name cannot resolve and a same-box published port is hairpin-blocked: attach both to the network in deploy/synology/care-hope-network.override.yml.",
  };
}

export function render(evaluation, opts = {}) {
  const lines = [];
  lines.push(`CARE→HOPE route probe${opts.container ? ` — from this host and from inside ${opts.container}` : " — from this host only"}`);
  for (const r of evaluation.rows) {
    lines.push(`  ${r.role === "configured" ? "CONFIGURED" : "candidate "} [${r.from}] ${r.url}`);
    lines.push(`      kind=${r.kind} outcome=${r.outcome}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  lines.push(`verdict: ${evaluation.verdict}`);
  if (evaluation.why) lines.push(`  why: ${evaluation.why}`);
  if (evaluation.remedy) lines.push(`  remedy: ${evaluation.remedy}`);
  if (evaluation.verdict === FAIL_ROUTE) {
    lines.push("  permanent form: the peer's Docker network alias, not an IP — a container IP and a");
    lines.push("  bridge gateway both answer today and change on the next recreate of either stack.");
  }
  if (evaluation.verdict === UNKNOWN) {
    lines.push("  UNKNOWN is not a pass: nothing was demonstrated about this route.");
  }
  return lines.join("\n");
}

/**
 * curl's `-w %{http_code}` prints `000` when it never connected, so the number alone
 * is ambiguous — exactly the shape that let an earlier version of this probe print
 * `HTTP 319` for a 319 ms latency. Only a real three-digit status gets a label; a
 * failed attempt is left unlabelled and reads as UNKNOWN, and its exit code carries
 * the reason.
 */
export function hostAttempt(res) {
  if (!res || res.missing || res.code === undefined) return res;
  const said = String(res.stdout ?? "").trim();
  if (res.code === 0 && /^[1-9]\d{2}$/.test(said)) return { ...res, stdout: `HTTP ${said}` };
  if (res.code === 0 && said === "000") return { ...res, stdout: "" };
  return res;
}

/**
 * Run inside the container. Global fetch, empty body, no credential header: the
 * question is whether a packet gets there, and any HTTP answer says it does.
 * The answer is LABELLED (`HTTP 401 12ms` / `ERR ENOTFOUND 5ms`) because an elapsed
 * time and a status code are both numbers, and a report that cannot tell them apart
 * is worse than no report.
 *
 * The error is named from `cause.code` → string `code` → `name`, in that order.
 * `AbortSignal.timeout()` rejects with a DOMException whose numeric legacy `code`
 * is 23, so reading `e.code` first printed `ERR 23` on the production box for what
 * was actually a TimeoutError — a real route failure described by a number nobody
 * can search for or interpret.
 */
export const CONTAINER_SNIPPET = [
  "const t=Date.now();",
  "const ms=()=>(Date.now()-t)+\"ms\";",
  "try{",
  "  const r=await fetch(process.argv[1],{method:\"GET\",signal:AbortSignal.timeout(5000)});",
  "  process.stdout.write(\"HTTP \"+r.status+\" \"+ms());",
  "}catch(e){",
  "  const c=(e&&e.cause&&e.cause.code)||(typeof(e&&e.code)===\"string\"&&e.code)||e.name||String(e);",
  "  process.stdout.write(\"ERR \"+c+\" \"+ms());",
  "}",
].join("");

export function probeContainer(run, container, url) {
  return run("docker", ["exec", container, "node", "--input-type=module", "-e", CONTAINER_SNIPPET, url]);
}

function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export function parseArgs(argv) {
  const o = { url: null, container: null, dns: null, dnsPort: null, envFile: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url") o.url = argv[++i];
    else if (a === "--container") o.container = argv[++i];
    else if (a === "--dns") o.dns = argv[++i];
    else if (a === "--dns-port") o.dnsPort = argv[++i];
    else if (a === "--env-file") o.envFile = argv[++i];
    else if (a === "--json") o.json = true;
  }
  return o;
}

/** Where the URL comes from when it is not on the command line: live .env, else template. */
export function envSource(args) {
  return args.envFile
    || (existsSync(path.join(REPO, ".env")) ? path.join(REPO, ".env") : path.join(REPO, "deploy/synology/care.env"));
}

export function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const out = options.stdout ?? ((s) => process.stdout.write(s));
  if (argv.includes("--help") || argv.includes("-h")) {
    out(`${USAGE}\n`);
    return 0;
  }
  // An injected env is the WHOLE environment: a unit test that supplies one must not
  // also pick up whatever the committed template happens to hold today.
  const merged = options.env !== undefined
    ? { ...options.env }
    : { ...parseEnvFile(envSource(args)), ...process.env };
  const url = (args.url || merged.INTEGRATION_HOPE_CALLBACK_URL || "").trim();
  const candidates = candidatesFor({ url, dns: args.dns, dnsPort: args.dnsPort });
  const run = options.run ?? ((cmd, cmdArgs) => {
    const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", timeout: 20_000 });
    if (r.error?.code === "ENOENT") return { missing: `${cmd} is not available on this host` };
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  });

  const attempts = {};
  const curl = (u) => hostAttempt(run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", u]));
  for (const c of candidates) {
    attempts[c.url] = curl(c.url);
    if (args.container) attempts[`${c.url}|container`] = probeContainer(run, args.container, c.url);
  }
  const evaluation = evaluate({ candidates, attempts, container: args.container });
  out(`${args.json ? JSON.stringify(evaluation, null, 2) : render(evaluation, args)}\n`);
  return evaluation.code;
}

export const USAGE = [
  "node scripts/hope-route-probe.mjs                                   # the configured URL, from here",
  "node scripts/hope-route-probe.mjs --container care-api              # and from inside the API container",
  "node scripts/hope-route-probe.mjs --container care-api --dns hope_hospital_app --dns-port 5000",
  "node scripts/hope-route-probe.mjs --url http://192.168.1.137:7080/api/integration/care-callback",
  "",
  "Read-only: one unsigned GET per address, no credential, no write, no restart.",
  "Exit 0 answers · 1 blocked · 2 could not be attempted (UNKNOWN, never a pass).",
].join("\n");

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = main();
}
