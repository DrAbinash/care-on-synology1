#!/usr/bin/env node
// Development launcher for the CARE monorepo: starts the API server and the
// diagnostic ERP together, with the workspace-root .env sourced into both
// processes (the API needs that — @workspace/db reads DATABASE_URL at import
// time, before dotenv would run).
//
// `--isolated` adds CARE_DEV_ISOLATED=1: no schedulers, no polling, no outbound
// production integrations, loopback binds on 8181/5173. See
// artifacts/api-server/src/lib/devIsolation.ts and docs/CARE_ERP_ENVIRONMENT_MATRIX.md.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `new URL(import.meta.url).pathname` yields "/C:/Users/..." on Windows, and path.resolve then
// produces "C:\C:\Users\…" — a directory that never exists. fileURLToPath is the
// only form that works on both platforms; without this the root .env is simply
// never found on Windows and the launcher reports DATABASE_URL as missing.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");

export const ISOLATED_DEFAULTS = {
  apiHost: "127.0.0.1",
  apiPort: "8181",
  erpHost: "127.0.0.1",
  erpPort: "5173",
  database: "127.0.0.1:5411/care_dev",
};

const PACKAGES = [
  { label: "api", pkg: "@workspace/api-server" },
  { label: "erp", pkg: "@workspace/diagnostic-erp" },
];

/**
 * How the package runner itself must be invoked.
 *
 * On Windows `pnpm` is a shell shim: the installer puts an extensionless `pnpm`,
 * a `pnpm.CMD` and a `pnpm.ps1` on PATH, and `pnpm.exe` lives under a
 * version-hashed `global\v11\<id>\node_modules\@pnpm\exe` directory that no
 * launcher may hard-code. Node's spawn refuses to execute a `.CMD`/`.bat`
 * without a shell and does not apply PATHEXT, so a plain `spawn("pnpm", …)`
 * fails with ENOENT — the launcher would print nothing and start nothing.
 * Going through cmd.exe is what makes `pnpm` resolvable there.
 */
export function runnerInvocation(platform = process.platform) {
  return platform === "win32" ? { command: "pnpm", shell: true } : { command: "pnpm", shell: false };
}

export function childSpecs({ root = ROOT, platform = process.platform } = {}) {
  const runner = runnerInvocation(platform);
  return PACKAGES.map((p) => ({
    label: p.label,
    pkg: p.pkg,
    command: runner.command,
    args: ["--filter", p.pkg, "run", "dev"],
    options: {
      cwd: root,
      stdio: "inherit",
      // Only Windows gets a shell: it needs cmd.exe to resolve the shim.
      // Everywhere else keeps the argument array intact.
      shell: runner.shell,
    },
  }));
}

export function loadDotenv(envPath = path.join(ROOT, ".env"), baseEnv = process.env) {
  const env = { ...baseEnv };
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

export function detectIsolation(argv, env) {
  return argv.includes("--isolated") || /^(1|true|yes|on)$/i.test(String(env.CARE_DEV_ISOLATED ?? "").trim());
}

/**
 * The environment the two children run with. Isolated mode owns its own ports:
 * the restored root `.env` carries `PORT=8080` for the API, and 8080 belongs to
 * the separate Windows emergency ERP, so neither child may read it.
 */
export function prepareEnv(argv, baseEnv) {
  const env = loadDotenv(path.join(ROOT, ".env"), baseEnv);
  const isolated = detectIsolation(argv, env);
  if (isolated) {
    env.CARE_DEV_ISOLATED = "1";
    delete env.PORT;
    env.CARE_DEV_ERP_PORT = env.CARE_DEV_ERP_PORT ?? ISOLATED_DEFAULTS.erpPort;
  }
  return { isolated, env };
}

export function helpText() {
  return `usage: node scripts/dev-erp-local.mjs [--isolated]

  (default)   API on \${PORT:-8080}, ERP dev server on \${PORT:-5173}, background
              consumers as the code decides.
  --isolated  CARE_DEV_ISOLATED=1: API on 127.0.0.1:${ISOLATED_DEFAULTS.apiPort}, ERP dev server on
              127.0.0.1:${ISOLATED_DEFAULTS.erpPort} proxying /api and /uploads there, and NO schedulers,
              pollers, warmers, reconcilers, job consumers or outbound production
              integrations. DATABASE_URL must point at the approved development
              database (${ISOLATED_DEFAULTS.database}) or the API refuses to start.
              Frontend hot reload still works — nothing is built into Docker.
`;
}

/** Print the database target without the password, so the banner is safe to paste. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = u.username ? `${u.username.slice(0, 3)}***` : u.username;
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * Stop a child. On Windows the launcher's child is cmd.exe, so its real
 * descendants (pnpm.exe, then the node process running vite or the bundle) are
 * NOT killed by child.kill() — they keep holding 8181/5173. taskkill /T walks
 * the tree.
 */
export function killChild(child, platform = process.platform, signal = "SIGTERM") {
  if (!child || child.killed || child.exitCode !== null) return;
  if (platform === "win32") {
    if (Number.isInteger(child.pid)) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    }
    return;
  }
  child.kill(signal);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText());
    process.exit(0);
  }

  const { isolated, env } = prepareEnv(argv, process.env);

  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Run `pnpm dev:doctor` for setup guidance.");
    process.exit(1);
  }

  if (isolated) {
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
      ].join("\n")
    );
  }

  const children = childSpecs({ root: ROOT }).map((spec) => {
    const child = spawn(spec.command, spec.args, { ...spec.options, env });
    // Without this a failed spawn is invisible: the launcher prints nothing and
    // waits, which is exactly how the Windows ENOENT presented itself.
    child.on("error", (err) => {
      console.error(
        `[dev-erp-local] could not start ${spec.pkg}: ${err.message}. ` +
          "Is pnpm installed and on PATH? (PowerShell: `pnpm --version`)"
      );
    });
    return child;
  });

  function stop(signal) {
    for (const child of children) killChild(child, process.platform, signal);
  }

  process.on("SIGINT", () => {
    stop("SIGINT");
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop("SIGTERM");
    process.exit(143);
  });

  Promise.race(
    children.map(
      (child) =>
        new Promise((resolve) => {
          child.on("exit", resolve);
          // A spawn that never started reports only "error"; treat it as an exit
          // so the launcher stops the other child instead of hanging forever.
          child.on("error", () => resolve(1));
        })
    )
  ).then((code) => {
    stop("SIGTERM");
    process.exit(typeof code === "number" ? code : 1);
  });
}

// Importing this module must not start anything: the launcher's own test suite
// reads these exports and asserts the specs without spawning a dev server.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
