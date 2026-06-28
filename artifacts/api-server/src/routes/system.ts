/**
 * system.ts — System version and deployment information
 *
 * GET /api/system/version
 *   Returns full ERP version, build, git info, schema status.
 *   Used by: Settings → About, login footer, admin dashboard.
 *   No authentication required (version info is not sensitive).
 *
 * GET /api/system/version/short
 *   Returns minimal { version, build } for lightweight polling.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const router = Router();

// Read version.json (baked into the image at /app/version.json)
function readVersionJson(): {
  version: string;
  buildNumber: number;
  releaseName?: string;
  notes?: string;
} {
  try {
    const candidates = [
      path.join(process.cwd(), "version.json"),
      path.join(__dirname, "../../version.json"),
      path.join(__dirname, "../../../version.json"),
      "/app/version.json",
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  } catch { /* ignore */ }
  return { version: "0.0.0", buildNumber: 0 };
}

// Read schema_deploy_state from DB (non-fatal)
async function readDeployState(): Promise<Record<string, string>> {
  try {
    const rows = await db.execute<{ key: string; value: string }>(
      sql`SELECT key, value FROM public.schema_deploy_state LIMIT 50`
    );
    const state: Record<string, string> = {};
    for (const r of (rows.rows ?? [])) state[r.key] = r.value;
    return state;
  } catch { return {}; }
}

// Full version response
router.get("/api/system/version", async (_req, res) => {
  try {
    const ver     = readVersionJson();
    const state   = await readDeployState();

    // Runtime env vars (baked into image by Dockerfile ARG → ENV)
    const erpVersion  = process.env.ERP_VERSION   || ver.version     || "0.0.0";
    const buildNumber = process.env.BUILD_NUMBER   || String(ver.buildNumber || 0);
    const releaseName = process.env.RELEASE_NAME   || ver.releaseName || "";
    const gitCommit   = process.env.GIT_COMMIT     || state.git_commit   || "unknown";
    const gitBranch   = process.env.GIT_BRANCH     || state.git_branch   || "unknown";
    const gitTag      = process.env.GIT_TAG        || state.git_tag      || "unknown";
    const buildDate   = process.env.BUILD_DATE     || state.build_date   || "unknown";

    // DB-level version info
    let pgVersion = "unknown";
    try {
      const pgr = await db.execute<{ v: string }>(sql`SELECT version() AS v`);
      pgVersion = (pgr.rows ?? [])[0]?.v?.split(" ").slice(0, 2).join(" ") ?? "unknown";
    } catch { /* ignore */ }

    res.json({
      // ERP Identity
      name:           "Care Diagnostics ERP",
      version:        erpVersion,
      build:          Number(buildNumber),
      releaseName:    releaseName || undefined,
      releaseNotes:   ver.notes   || undefined,

      // Git provenance
      gitCommit:      gitCommit,
      gitBranch:      gitBranch,
      gitTag:         gitTag,
      buildDate:      buildDate,
      deployedAt:     state.schema_verify_at || state.deploy_started_at || "unknown",

      // Database
      pgVersion,
      schemaVersion:        state.total_migrations          || state.schema_version || "unknown",
      drizzleMigrations:    state.total_migrations          || "unknown",
      featureMigrations:    state.feature_migration_count   || "unknown",
      schemaVerifyStatus:   state.schema_verify_status      || "unknown",
      schemaVerifyAt:       state.schema_verify_at          || "unknown",
      liveTableCount:       state.live_table_count          || "unknown",
      liveColumnCount:      state.live_column_count         || "unknown",
      dbPatchOk:            state.db_patch_ok               || "unknown",

      // Runtime
      nodeVersion:    process.version,
      environment:    process.env.NODE_ENV || "unknown",
      uptime:         Math.floor(process.uptime()),
      ts:             new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Version check failed" });
  }
});

// Lightweight short version for polling / footer display
router.get("/api/system/version/short", (_req, res) => {
  const ver = readVersionJson();
  res.json({
    version:  process.env.ERP_VERSION  || ver.version     || "0.0.0",
    build:    process.env.BUILD_NUMBER || String(ver.buildNumber || 0),
    release:  process.env.RELEASE_NAME || ver.releaseName || "",
    commit:   (process.env.GIT_COMMIT  || "unknown").slice(0, 8),
  });
});

export default router;
