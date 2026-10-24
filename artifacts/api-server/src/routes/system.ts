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
import { buildIdentityPayload } from "../lib/buildIdentity";
import fs from "fs";
import path from "path";

const router = Router();

// Read version.json (baked into the image at /app/version.json).
// May also carry gitCommit/gitBranch/gitTag/buildDate stamped by deploy-synology.sh.
function readVersionJson(): {
  version: string;
  buildNumber: number;
  releaseName?: string;
  notes?: string;
  gitCommit?: string;
  gitBranch?: string;
  gitTag?: string;
  buildDate?: string;
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

/** Treat Dockerfile/compose placeholder defaults as unset (same idea as resolveVersionInfo). */
function unsetPlaceholder(v: string | undefined | null, placeholders: string[]): string | undefined {
  const t = (v ?? "").trim();
  if (!t || placeholders.includes(t)) return undefined;
  return t;
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

    // Runtime env (Dockerfile ARG→ENV) with version.json / deploy-state fallbacks.
    // Placeholder defaults (unknown / 0.0.0 / 0 / dev) must not drown stamped values.
    const erpVersion =
      unsetPlaceholder(process.env.ERP_VERSION, ["0.0.0"]) || ver.version || "0.0.0";
    const buildNumber =
      unsetPlaceholder(process.env.BUILD_NUMBER, ["0"]) ||
      String(ver.buildNumber ?? 0);
    const releaseName =
      unsetPlaceholder(process.env.RELEASE_NAME, ["dev"]) || ver.releaseName || "";
    // The image resolves its own commit at build time (`/app/build-info.json`) and that
    // outranks any stamped value, because only `deploy-synology.sh` refreshes `GIT_COMMIT`
    // in `.env` — a Container Manager rebuild otherwise re-bakes the previous SHA.
    const identityCommit = unsetPlaceholder(buildIdentityPayload().commit, ["unknown"]);
    const gitCommit =
      identityCommit ||
      unsetPlaceholder(process.env.GIT_COMMIT, ["unknown"]) ||
      unsetPlaceholder(ver.gitCommit, ["unknown"]) ||
      unsetPlaceholder(state.git_commit, ["unknown"]) ||
      "unknown";
    const gitBranch =
      unsetPlaceholder(process.env.GIT_BRANCH, ["unknown"]) ||
      unsetPlaceholder(ver.gitBranch, ["unknown"]) ||
      unsetPlaceholder(state.git_branch, ["unknown"]) ||
      "unknown";
    const gitTag =
      unsetPlaceholder(process.env.GIT_TAG, ["unknown"]) ||
      unsetPlaceholder(ver.gitTag, ["unknown"]) ||
      unsetPlaceholder(state.git_tag, ["unknown"]) ||
      "none";
    const buildDate =
      unsetPlaceholder(process.env.BUILD_DATE, ["unknown"]) ||
      unsetPlaceholder(ver.buildDate, ["unknown"]) ||
      unsetPlaceholder(state.build_date, ["unknown"]) ||
      "unknown";

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
  const displayCommit =
    unsetPlaceholder(buildIdentityPayload().commit, ["unknown"]) ||
    unsetPlaceholder(process.env.GIT_COMMIT, ["unknown"]) ||
    unsetPlaceholder(ver.gitCommit, ["unknown"]) ||
    "unknown";
  res.json({
    version:  process.env.ERP_VERSION  || ver.version     || "0.0.0",
    build:    process.env.BUILD_NUMBER || String(ver.buildNumber || 0),
    release:  process.env.RELEASE_NAME || ver.releaseName || "",
    commit:   displayCommit.slice(0, 8),
  });
});

export default router;
