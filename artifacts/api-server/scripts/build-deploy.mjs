#!/usr/bin/env node
// =============================================================================
// build-deploy.mjs
//
// Single-process deployment build for Replit Autoscale (Cloud Run).
//
// Autoscale runs ONE container with ONE port, so we cannot deploy 4 separate
// web artifacts. Instead we let api-server serve everything from a single
// Express process: REST API at /api/*, plus the 3 Vite-built SPAs as static
// assets at /, /site/, and //.
//
// Layout produced under artifacts/api-server/dist/:
//   dist/index.mjs          — esbuild bundle of the API server
//   dist/web/site/          — clinic-site build         (BASE_PATH=/)        ← public root
//   dist/web/erp/           — diagnostic-erp build      (BASE_PATH=/erp/)    ← staff app
//   dist/web// — super-admin build    (BASE_PATH=//)
//
// At runtime SERVE_STATIC_DIR=artifacts/api-server/dist/web tells app.ts to
// mount the SPA folders. Has no effect when SERVE_STATIC_DIR is unset (Replit
// dev workflows where each artifact runs its own Vite dev server).
// =============================================================================

import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_DIR, "../..");
const WEB_OUT = path.join(API_DIR, "dist", "web");

function log(msg) {
  process.stdout.write(`[build-deploy] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const { cwd = REPO_ROOT, env = {} } = opts;
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    c.on("error", reject);
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

async function buildFrontend(slug, basePath, stageName) {
  log(`building ${slug} (BASE_PATH=${basePath})`);
  await run("pnpm", ["--filter", `@workspace/${slug}`, "run", "build"], {
    env: { BASE_PATH: basePath },
  });
  const src = path.join(REPO_ROOT, "artifacts", slug, "dist", "public");
  const dest = path.join(WEB_OUT, stageName);
  log(`staging ${slug} → dist/web/${stageName}`);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true });
}

async function main() {
  log("building api-server (esbuild bundle)…");
  await run("node", ["./build.mjs"], { cwd: API_DIR });

  await rm(WEB_OUT, { recursive: true, force: true });
  await mkdir(WEB_OUT, { recursive: true });

  // Public clinic website is the new root (/), diagnostic ERP moves under
  // /erp so the patient-facing domain shows the marketing site by default.
  // Staff bookmarks must be updated to the new /erp prefix; the patient
  // portal (which lives inside the ERP SPA) is now reached via /erp/portal.
  await buildFrontend("clinic-site", "/", "site");
  await buildFrontend("diagnostic-erp", "/erp/", "erp");

  log("✓ deploy build complete");
  log(`  api bundle: dist/index.mjs`);
  log(`  static dir: dist/web/{erp,site}`);

}

main().catch((err) => {
  console.error("[build-deploy] FAILED:", err);
  process.exit(1);
});
