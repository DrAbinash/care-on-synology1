// Clean-boot + upgrade-safety migration smoke as a test gate (CARE ERP §2/§3).
//
// Runs scripts/migration-bootstrap-smoke.mjs, which creates its own throwaway
// scratch database, applies the authentic production migration path
// (docker/db-patch-entrypoint.sh semantics) into it, and asserts:
//   §2  a COMPLETELY EMPTY database boots end-to-end (all core tables + the
//       feature_flags backbone present; legacy admin_sessions removed cleanly),
//   §3  re-running every migration over populated data loses/mutates/duplicates
//       nothing — a signed report stays byte-identical.
//
// It self-skips (exit 0, "SKIPPED") when no Postgres is configured, so this
// gate is safe in a DB-less CI runner but fully exercised wherever a database
// is available (set MIGRATION_SMOKE_ADMIN_URL / DATABASE_URL / DB_*).
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

test("clean-boot + upgrade-safety migration smoke (scripts/migration-bootstrap-smoke.mjs)", () => {
  const script = path.join(here, "migration-bootstrap-smoke.mjs");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 180_000 });
  if (result.status !== 0) {
    // Surface the full smoke report so the failing assertion is obvious in CI.
    throw new Error(`migration smoke failed:\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  expect(result.status).toBe(0);
}, 190_000);
