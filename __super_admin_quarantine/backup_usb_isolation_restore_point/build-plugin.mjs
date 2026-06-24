import { build as esbuild } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_DIR, "../..");

async function buildPlugin() {
  const fs = await import("node:fs/promises");
  const backupDir = path.resolve(REPO_ROOT, "backup_usb_isolation_restore_point/api-routes");
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

  console.log("[build-plugin] Temporarily restoring routes from backup for compilation...");
  for (const file of routeFiles) {
    const src = path.join(backupDir, file);
    const dest = path.join(routesDir, file);
    await fs.copyFile(src, dest);
  }

  try {
    console.log("[build-plugin] Building backend plugin (esbuild)...");
    await esbuild({
      entryPoints: [path.resolve(API_DIR, "src/superadmin-plugin.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: path.resolve(API_DIR, "dist/superadmin-api.js"),
      sourcemap: false,
      minify: true,
      external: [
        "express",
        "zod",
        "bcryptjs",
        "drizzle-orm",
        "pino",
        "node-cron",
        "nodemailer",
        "sharp",
        "@workspace/db",
        "@workspace/db/schema",
        "@workspace/api-zod",
        "@workspace/crypto",
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
        "express-rate-limit"
      ]
    });
    console.log("[build-plugin] Backend plugin built at dist/superadmin-api.js");
  } finally {
    console.log("[build-plugin] Cleaning up (restoring trace-free routes)...");
    for (const file of routeFiles) {
      const dest = path.join(routesDir, file);
      await fs.writeFile(dest, "// Trace-free: moved to USB plugin\n", "utf8");
    }
  }
  
  // Build frontend plugin
  console.log("[build-plugin] Building frontend plugin (Vite)...");
  const portalDir = path.resolve(REPO_ROOT, "artifacts/super-admin-portal");
  const { stdout, stderr } = await execPromise("pnpm run build", { cwd: portalDir });
  console.log(stdout);
  if (stderr) console.error(stderr);
  
  // Copy vite output superadmin-ui.js to dist/
  const srcUi = path.resolve(portalDir, "dist/public/superadmin-ui.js");
  const destUi = path.resolve(API_DIR, "dist/superadmin-api-server-ui-copy.js");
  const destUiFinal = path.resolve(API_DIR, "dist/superadmin-ui.js");
  
  const fs = await import("node:fs/promises");
  await fs.copyFile(srcUi, destUiFinal);
  
  console.log("[build-plugin] Frontend plugin built at dist/superadmin-ui.js");
  console.log("[build-plugin] ✓ All plugins compiled successfully! Copy dist/superadmin-api.js and dist/superadmin-ui.js to your USB.");
}

buildPlugin().catch((err) => {
  console.error("[build-plugin] Build failed:", err);
  process.exit(1);
});
