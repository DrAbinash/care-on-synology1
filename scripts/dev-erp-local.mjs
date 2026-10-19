#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `new URL(...).pathname` yields "/C:/Users/..." on Windows, and path.resolve then
// produces "C:\C:\Users\…" — a directory that never exists. fileURLToPath is the
// only form that works on both platforms; without this fix the root .env is simply
// never found on Windows and the launcher reports DATABASE_URL as missing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function loadDotenv() {
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (env[key] == null) env[key] = value;
  }
  return env;
}

const ISOLATED_DEFAULTS = {
  apiHost: "127.0.0.1",
  apiPort: "8181",
  erpHost: "127.0.0.1",
  erpPort: "5173",
  database: "127.0.0.1:5411/care_dev",
};

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`usage: node scripts/dev-erp-local.mjs [--isolated]

  (default)   API on \${PORT:-8080}, ERP dev server on \${PORT:-5173}, background
              consumers as the code decides.
  --isolated  CARE_DEV_ISOLATED=1: API on 127.0.0.1:${ISOLATED_DEFAULTS.apiPort}, ERP dev server on
              127.0.0.1:${ISOLATED_DEFAULTS.erpPort} proxying /api and /uploads there, and NO schedulers,
              pollers, warmers, reconcilers, job consumers or outbound production
              integrations. DATABASE_URL must point at the approved development
              database (${ISOLATED_DEFAULTS.database}) or the API refuses to start.
              Frontend hot reload still works — nothing is built into Docker.
`);
  process.exit(0);
}

const env = loadDotenv();
const isolated = argv.includes("--isolated") || /^(1|true|yes|on)$/i.test(String(env.CARE_DEV_ISOLATED ?? ""));
if (isolated) env.CARE_DEV_ISOLATED = "1";

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Run `pnpm dev:doctor` for setup guidance.");
  process.exit(1);
}

if (isolated) {
  // The two children inherit one environment, and root `.env` carries `PORT=8080`
  // for the API. 8080 belongs to the separate Windows emergency ERP on this machine,
  // so neither child is allowed to read it here: the API decides its own port from
  // CARE_DEV_ISOLATED, and Vite is given its own variable instead of PORT.
  delete env.PORT;
  env.CARE_DEV_ERP_PORT = env.CARE_DEV_ERP_PORT ?? ISOLATED_DEFAULTS.erpPort;
  console.log(
    [
      "CARE_DEV_ISOLATED — isolated development mode",
      `  API      http://${ISOLATED_DEFAULTS.apiHost}:${ISOLATED_DEFAULTS.apiPort}   (loopback only)`,
      `  ERP dev  http://${ISOLATED_DEFAULTS.erpHost}:${ISOLATED_DEFAULTS.erpPort}   (hot reload, no Docker build)`,
      `  proxies  /api and /uploads → http://${ISOLATED_DEFAULTS.apiHost}:${ISOLATED_DEFAULTS.apiPort}`,
      `  database must be ${ISOLATED_DEFAULTS.database} — the API refuses to start against anything else`,
      "  disabled schedulers, DICOM/Orthanc polling, study warming, reconciliation,",
      "            job consumers, outbound callbacks, WhatsApp, SMTP, payments",
      `  DATABASE_URL currently: ${maskUrl(env.DATABASE_URL)}`,
      "",
    ].join("\n"),
  );
}

const children = [
  spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], { cwd: root, env, stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@workspace/diagnostic-erp", "run", "dev"], { cwd: root, env, stdio: "inherit" }),
];

function stop(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => { stop("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { stop("SIGTERM"); process.exit(143); });

Promise.race(children.map((child) => new Promise((resolve) => child.on("exit", resolve)))).then((code) => {
  stop();
  process.exit(typeof code === "number" ? code : 1);
});

/** Print the database target without the password, so the banner is safe to paste. */
function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = u.username ? `${u.username.slice(0, 3)}***` : u.username;
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}
