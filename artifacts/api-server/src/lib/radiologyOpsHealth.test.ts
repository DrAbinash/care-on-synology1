import { describe, it, expect } from "vitest";
import { worstStatus, statusFromPersistedCheck, jobsComponentStatus, migrationsComponentStatus, type OpsStatus } from "./radiologyOpsHealth";
import { startupHealth, type StartupState } from "./startupState";
import { classifyRecipeRows } from "./auditVerification";
import { evaluateBackupFile } from "./restoreVerification";
import { RADIOLOGY_FLAG_REGISTRY, validateFlagDependencies, safeEnableOrder } from "./radiologyFeatureFlagRegistry";

// Ticket BEND-1 Phases 4/7/8/9/10 — the pure derivations behind the ops
// surface. (Database-backed behavior is proven by the PG verification run.)

const NOW = new Date("2026-07-11T10:00:00Z");

describe("Phase 4 — health status derivation", () => {
  it("overall = worst component; UNKNOWN never masquerades as HEALTHY", () => {
    expect(worstStatus(["HEALTHY", "HEALTHY"])).toBe("HEALTHY");
    expect(worstStatus(["HEALTHY", "UNKNOWN"])).toBe("UNKNOWN");
    expect(worstStatus(["UNKNOWN", "DEGRADED"])).toBe("DEGRADED");
    expect(worstStatus(["DEGRADED", "UNHEALTHY", "HEALTHY"])).toBe("UNHEALTHY");
    expect(worstStatus([])).toBe("HEALTHY");
  });

  it("persisted checks: pass/warn/fail map to statuses; stale or missing → UNKNOWN", () => {
    expect(statusFromPersistedCheck({ status: "pass", ranAt: NOW }, NOW, 48)).toBe("HEALTHY");
    expect(statusFromPersistedCheck({ status: "warn", ranAt: NOW }, NOW, 48)).toBe("DEGRADED");
    expect(statusFromPersistedCheck({ status: "fail", ranAt: NOW }, NOW, 48)).toBe("UNHEALTHY");
    expect(statusFromPersistedCheck(null, NOW, 48)).toBe("UNKNOWN");
    const old = new Date(NOW.getTime() - 49 * 3600_000);
    expect(statusFromPersistedCheck({ status: "pass", ranAt: old }, NOW, 48)).toBe("UNKNOWN"); // stale pass ≠ healthy
  });

  it("job backlog: dead-letters or a large due backlog degrade", () => {
    expect(jobsComponentStatus({ pending: 0, running: 1, deadLetter: 0 })).toBe("HEALTHY");
    expect(jobsComponentStatus({ pending: 5, running: 0, deadLetter: 1 })).toBe("DEGRADED");
    expect(jobsComponentStatus({ pending: 500, running: 0, deadLetter: 0 })).toBe("DEGRADED");
  });
});

describe("migrationsComponentStatus — schema_verify_status → OpsStatus", () => {
  it("full_pass (patch ok, sql fully verified): HEALTHY, detail carries no warning", () => {
    const c = migrationsComponentStatus(true, "full_pass");
    expect(c.status).toBe("HEALTHY");
    expect(c.detail).not.toMatch(/warn|fail/i);
    expect(c.detail).toContain("schema_verify_status=full_pass");
  });

  it("sql_pass (earlier-stage pass value) is also HEALTHY", () => {
    expect(migrationsComponentStatus(true, "sql_pass").status).toBe("HEALTHY");
  });

  it("pass_with_warnings: non-fatal (DEGRADED, not UNHEALTHY) and the warning is clearly exposed in detail", () => {
    const c = migrationsComponentStatus(true, "pass_with_warnings");
    expect(c.status).toBe("DEGRADED");
    expect(c.status).not.toBe("UNHEALTHY");
    expect(c.detail).toContain("schema_verify_status=pass_with_warnings");
    // Confirm non-fatal at the overall-health rollup too: with every other
    // component HEALTHY, a lone pass_with_warnings pulls overall to
    // DEGRADED, never UNHEALTHY — it cannot masquerade as fatal.
    expect(worstStatus(["HEALTHY", "HEALTHY", c.status])).toBe("DEGRADED");
  });

  it("failed: reported as a genuine problem, not HEALTHY (current 'failed' and legacy 'full_fail' both covered)", () => {
    for (const verify of ["failed", "full_fail"]) {
      const c = migrationsComponentStatus(true, verify);
      expect(c.status).not.toBe("HEALTHY");
      expect(c.status).toBe("DEGRADED");
      expect(c.detail).toContain(`schema_verify_status=${verify}`);
    }
  });

  it("db-patch-v2 itself not completing is UNHEALTHY regardless of schema_verify_status", () => {
    expect(migrationsComponentStatus(false, "full_pass").status).toBe("UNHEALTHY");
    expect(migrationsComponentStatus(false, undefined).status).toBe("UNHEALTHY");
  });

  it("missing, undefined, null-as-string, or unrecognized schema_verify_status is UNKNOWN — never silently HEALTHY", () => {
    expect(migrationsComponentStatus(true, undefined).status).toBe("UNKNOWN");
    expect(migrationsComponentStatus(true, "").status).toBe("UNKNOWN");
    expect(migrationsComponentStatus(true, "null").status).toBe("UNKNOWN");
    expect(migrationsComponentStatus(true, "some_garbage_value").status).toBe("UNKNOWN");
    // Never masquerades as a pass — this is the actual safety property.
    for (const verify of [undefined, "", "null", "some_garbage_value"]) {
      expect(migrationsComponentStatus(true, verify).status).not.toBe("HEALTHY");
    }
  });

  it("missing schema_verify_status still names it 'missing' in the detail (not a blank/undefined string)", () => {
    expect(migrationsComponentStatus(true, undefined).detail).toContain("schema_verify_status=missing");
  });
});

describe("Phase 9 — startup readiness truth", () => {
  const base: StartupState = {
    phase: "starting", startedAt: NOW.toISOString(),
    startupMigrationsOk: null, startupMigrationError: null, readyAt: null,
  };

  it("STARTING is UNKNOWN — never HEALTHY before startup settles", () => {
    expect(startupHealth(base).status).toBe("UNKNOWN");
  });

  it("migration failure is RECORDED and DEGRADED, not swallowed", () => {
    const failed: StartupState = { ...base, phase: "ready", startupMigrationsOk: false, startupMigrationError: "relation x does not exist", readyAt: NOW.toISOString() };
    const h = startupHealth(failed);
    expect(h.status).toBe("DEGRADED");
    expect(h.detail).toContain("relation x does not exist");
  });

  it("clean startup is HEALTHY", () => {
    const ok: StartupState = { ...base, phase: "ready", startupMigrationsOk: true, readyAt: NOW.toISOString() };
    expect(startupHealth(ok).status).toBe("HEALTHY");
  });
});

describe("Phase 7 — audit recipe classification", () => {
  it("valid app-recipe rows verify; leading mismatches classify as legacy backfill", () => {
    const c = classifyRecipeRows([
      { id: 1, recomputeMatches: false }, // SQL backfill era
      { id: 2, recomputeMatches: false },
      { id: 3, recomputeMatches: true },  // app-written era begins
      { id: 4, recomputeMatches: true },
    ]);
    expect(c).toEqual({ appRecipeVerified: 2, legacyRecipeRows: 2, suspicious: 0, suspiciousIds: [] });
  });

  it("a recompute mismatch AFTER app-recipe rows is SUSPICIOUS — never silently legacy", () => {
    const c = classifyRecipeRows([
      { id: 1, recomputeMatches: false },
      { id: 2, recomputeMatches: true },
      { id: 3, recomputeMatches: false }, // app-era row that no longer recomputes
    ]);
    expect(c.suspicious).toBe(1);
    expect(c.suspiciousIds).toEqual([3]);
    expect(c.legacyRecipeRows).toBe(1);
  });

  it("all-legacy and all-app chains classify cleanly", () => {
    expect(classifyRecipeRows([{ id: 1, recomputeMatches: false }]).legacyRecipeRows).toBe(1);
    expect(classifyRecipeRows([{ id: 1, recomputeMatches: true }]).appRecipeVerified).toBe(1);
    expect(classifyRecipeRows([]).suspicious).toBe(0);
  });
});

describe("Phase 8 — backup file preconditions", () => {
  it("missing and zero-byte archives fail before any restore is attempted", () => {
    expect(evaluateBackupFile({ exists: false, sizeBytes: 0 }).some((s) => !s.ok)).toBe(true);
    expect(evaluateBackupFile({ exists: true, sizeBytes: 0 }).find((s) => s.name === "backup_file_nonempty")?.ok).toBe(false);
    expect(evaluateBackupFile({ exists: true, sizeBytes: 1024 }).every((s) => s.ok)).toBe(true);
  });
});

describe("Phase 10 — feature-flag registry", () => {
  it("every flag defaults OFF and dependencies exist within the registry", () => {
    const keys = new Set(RADIOLOGY_FLAG_REGISTRY.map((e) => e.key));
    for (const entry of RADIOLOGY_FLAG_REGISTRY) {
      expect(entry.defaultValue, entry.key).toBe(false);
      for (const dep of entry.dependsOn) expect(keys.has(dep), `${entry.key} → ${dep}`).toBe(true);
    }
  });

  it("safe enable order never places a flag before its dependencies", () => {
    const order = safeEnableOrder();
    for (const entry of RADIOLOGY_FLAG_REGISTRY) {
      for (const dep of entry.dependsOn) {
        expect(order.indexOf(dep), `${dep} before ${entry.key}`).toBeLessThan(order.indexOf(entry.key));
      }
    }
  });

  it("dependency validation flags enabled-without-dependency states", () => {
    expect(validateFlagDependencies({ ff_radiology_structured_final: true })).toEqual([
      { key: "ff_radiology_structured_final", missingDependencies: ["ff_radiology_structured_d1_draft"] },
    ]);
    expect(validateFlagDependencies({
      ff_radiology_structured_core: true,
      ff_radiology_catalog: true,
      ff_radiology_structured_d1_draft: true,
      ff_radiology_structured_final: true,
    })).toEqual([]);
    expect(validateFlagDependencies({})).toEqual([]); // all off = valid
  });
});

describe("Phase 10 — no unregistered gated flags (source pin)", () => {
  it("every ff_radiology_* literal gated in the backend appears in the registry", async () => {
    const { readFileSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
    const grep = execSync(
      `grep -rhoE --include='*.ts' --exclude='*.test.ts' 'isFeatureEnabledServer\\("ff_radiology_[a-z0-9_]+"\\)' ${JSON.stringify(SRC)} || true`,
      { encoding: "utf8" },
    );
    const used = new Set([...grep.matchAll(/"(ff_radiology_[a-z0-9_]+)"/g)].map((m) => m[1]));
    const registered = new Set(RADIOLOGY_FLAG_REGISTRY.map((e) => e.key));
    for (const key of used) {
      expect(registered.has(key), `flag ${key} is gated in code but missing from the registry`).toBe(true);
    }
    // and the registry truthfully marks wired flags
    for (const entry of RADIOLOGY_FLAG_REGISTRY) {
      if (used.has(entry.key)) expect(entry.wired, `${entry.key} should be wired=true`).toBe(true);
    }
    void readFileSync;
  });
});
