import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const API_DIR = path.resolve(REPO_ROOT, "artifacts/api-server");

// Quarantine folder is outside the pnpm workspace — resolve esbuild from
// api-server's installed deps.
const requireFromApi = createRequire(path.join(API_DIR, "package.json"));
const { build: esbuild } = requireFromApi("esbuild");

// ─── Put back exactly what we overwrote ──────────────────────────────────────
// This build temporarily writes real source into artifacts/api-server/src, then
// has to undo that. It used to undo it by writing the trace-free stub over all
// eight route files — which was wrong twice over:
//
//   * system.ts is NOT a stub in the repository, it is real, so the build left
//     the working tree dirty every single time;
//   * recovering from that meant `git checkout artifacts/api-server/src/routes/`,
//     a blanket revert that silently threw away any unrelated edit anyone had in
//     progress in that directory. It ate a route change twice while this module
//     was being written, and both times the result still typechecked, because
//     the file had reverted to a valid earlier state.
//
// So instead of assuming what each file should contain, snapshot the bytes
// before touching it and write those same bytes back. Files that did not exist
// beforehand are deleted rather than recreated. Nothing else in the tree is
// touched, and no git command is involved.
function snapshot(paths) {
  const saved = new Map();
  for (const p of paths) {
    try {
      saved.set(p, readFileSync(p));
    } catch (err) {
      if (err.code === "ENOENT") saved.set(p, null);   // absent before the build
      else throw err;
    }
  }
  return saved;
}

// Synchronous on purpose: this also runs from a signal handler, where the
// process may not survive long enough to await anything.
function restore(saved) {
  for (const [p, content] of saved) {
    if (content === null) {
      try { unlinkSync(p); } catch { /* already gone */ }
    } else {
      writeFileSync(p, content);
    }
  }
}

async function buildPlugin() {
  const backupDir = path.resolve(__dirname, "backup_usb_isolation_restore_point/api-routes");
  const routesDir = path.resolve(API_DIR, "src/routes");

  const routeFiles = [
    "super-admin.ts",
    "backup.ts",
    "system.ts",
    "audit-logs.ts",
    "role-permissions.ts",
    "system-health.ts",
    "commission.ts",
    "doctor-ledger.ts"
  ];

  const pluginDest = path.resolve(API_DIR, "src/superadmin-plugin.ts");
  const touched = [...routeFiles.map(f => path.join(routesDir, f)), pluginDest];

  // Take the snapshot BEFORE the first write, so the restore is exact.
  const saved = snapshot(touched);
  let alreadyRestored = false;
  const restoreOnce = () => {
    if (alreadyRestored) return;
    alreadyRestored = true;
    restore(saved);
  };

  // A Ctrl-C part-way through would otherwise leave the real super-admin source
  // sitting in artifacts/api-server/src — the exact trace this whole arrangement
  // exists to avoid.
  const onSignal = (sig) => {
    console.log(`\n[build-plugin] ${sig} — restoring the working tree before exit...`);
    restoreOnce();
    process.exit(1);
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  console.log("[build-plugin] Temporarily restoring routes from backup for compilation...");
  for (const file of routeFiles) {
    const src = path.join(backupDir, file);
    const dest = path.join(routesDir, file);
    await fs.copyFile(src, dest);
  }

  console.log("[build-plugin] Copying superadmin-plugin.ts to src...");
  await fs.copyFile(path.resolve(__dirname, "superadmin-plugin.ts"), pluginDest);

  try {
    console.log("[build-plugin] Building backend plugin (esbuild)...");
    await esbuild({
      entryPoints: [path.resolve(API_DIR, "src/superadmin-plugin.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: path.resolve(__dirname, "dist/superadmin-api.js"),
      sourcemap: false,
      minify: true,
      banner: {
        js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
      },
      external: [
        // npm packages the care-api container already ships — resolved from node_modules.
        "express",
        "zod",
        "bcryptjs",
        "drizzle-orm",
        "pino",
        "node-cron",
        "nodemailer",
        "sharp",
        "express-rate-limit",
        // Node built-ins
        "node:crypto",
        "node:fs",
        "node:path",
        "node:url",
        "node:child_process",
        "crypto",
        "fs",
        "path",
        "url",
        "child_process",
        // @workspace/* MUST be bundled: those packages export .ts entrypoints and
        // plain `import()` of the uploaded plugin cannot load them at runtime.
      ],
    });
    console.log("[build-plugin] Backend plugin built at __super_admin_quarantine/dist/superadmin-api.js");
  } finally {
    console.log("[build-plugin] Cleaning up (restoring the working tree exactly as it was)...");
    restoreOnce();
  }


  // Build frontend plugin
  console.log("[build-plugin] Building frontend plugin (Vite)...");
  const portalDir = path.resolve(__dirname, "super-admin-portal");
  const { stdout, stderr } = await execPromise("pnpm run build", { cwd: portalDir });
  console.log(stdout);
  if (stderr) console.error(stderr);
  
  // Copy vite output superadmin-ui.js to dist/
  const srcUi = path.resolve(portalDir, "dist/public/superadmin-ui.js");
  const destUiFinal = path.resolve(__dirname, "dist/superadmin-ui.js");
  
  await fs.copyFile(srcUi, destUiFinal);
  
  console.log("[build-plugin] Frontend plugin built at __super_admin_quarantine/dist/superadmin-ui.js");
  console.log("[build-plugin] ✓ All plugins compiled successfully! Copy dist/superadmin-api.js and dist/superadmin-ui.js to your USB.");
  console.log("[build-plugin]   (The working tree was restored to exactly its pre-build state —");
  console.log("[build-plugin]    no `git checkout` is needed, and none should be run.)");
}

buildPlugin().catch((err) => {
  console.error("[build-plugin] Build failed:", err);
  process.exit(1);
});
