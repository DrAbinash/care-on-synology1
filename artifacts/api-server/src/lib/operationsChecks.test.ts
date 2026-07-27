import { describe, it, expect } from "vitest";
import {
  CHECK_DEFS, buildOperationsReport, DEFAULT_THRESHOLDS,
  type OpsCtx, type ProbeResult,
} from "./operationsChecks";
import { runOneCheck, type OpsCheck } from "./operationsHealth";

const NOW = new Date("2026-07-21T12:00:00.000Z");

function defById(id: string) {
  const d = CHECK_DEFS.find((c) => c.id === id);
  if (!d) throw new Error(`no check def ${id}`);
  return d;
}

/** A fully-stubbed context; override per test. */
function ctx(overrides: Partial<OpsCtx> = {}): OpsCtx {
  return {
    now: NOW,
    mode: "cli",
    baseUrl: "http://api.local:8080",
    query: async () => [],
    probe: async (): Promise<ProbeResult> => ({ ok: true, status: 200, ms: 5 }),
    env: () => undefined,
    version: { version: "2.0.0", build: "1", releaseName: "Radiology Stability", commit: "abc12345", branch: "main", buildTime: "2026-07-20", nodeEnv: "production", uptimeSeconds: 42 },
    poolStats: null,
    orthanc: { baseUrl: null, headers: {}, configured: false },
    ollama: { baseUrl: null, model: "qwen3:14b", configured: false },
    ohifUrl: null,
    publicBaseUrl: null,
    displayToken: "tok",
    n8nUrl: null,
    paymentGatewayConfigured: null,
    storageDir: null,
    diskFree: null,
    thresholds: DEFAULT_THRESHOLDS,
    ...overrides,
  };
}

const OPTS = { includeOptional: true, timeoutMs: 500, now: NOW };
async function run(id: string, c: OpsCtx): Promise<OpsCheck> {
  return runOneCheck(defById(id), c, OPTS);
}

describe("Orthanc connectivity — the four distinct states", () => {
  it("not configured → SKIPPED (never a false FAIL)", async () => {
    const c = await run("orthanc.reachable", ctx({ orthanc: { baseUrl: null, headers: {}, configured: false } }));
    expect(c.status).toBe("SKIPPED");
  });
  it("unreachable (no response) → FAIL 'unavailable'", async () => {
    const c = await run("orthanc.reachable", ctx({
      orthanc: { baseUrl: "http://care-orthanc:8042", headers: {}, configured: true },
      probe: async () => ({ ok: false, status: null, ms: 2000, error: "ECONNREFUSED" }),
    }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/unavailable/i);
  });
  it("reachable but auth failed (401) → FAIL 'authentication failed'", async () => {
    const c = await run("orthanc.reachable", ctx({
      orthanc: { baseUrl: "http://care-orthanc:8042", headers: {}, configured: true },
      probe: async () => ({ ok: false, status: 401, ms: 10 }),
    }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/authentication failed/i);
  });
  it("reachable 200 with Version → PASS", async () => {
    const c = await run("orthanc.reachable", ctx({
      orthanc: { baseUrl: "http://care-orthanc:8042", headers: {}, configured: true },
      probe: async () => ({ ok: true, status: 200, ms: 8, json: { Version: "1.12.4" } }),
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).toContain("1.12.4");
    expect(c.metadata?.version).toBe("1.12.4");
  });
});

describe("Sync freshness vs last-DICOM — 'no recent study' is never a FAIL", () => {
  it("no synced studies → SKIPPED", async () => {
    const c = await run("orthanc.sync_fresh", ctx({ query: async () => [{ m: null, n: 0 }] }));
    expect(c.status).toBe("SKIPPED");
  });
  it("stale sync past threshold → WARNING (not FAIL)", async () => {
    const old = new Date(NOW.getTime() - 90 * 60000).toISOString(); // 90 min
    const c = await run("orthanc.sync_fresh", ctx({ query: async () => [{ m: old, n: 3 }] }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/1h 30m ago/);
  });
  it("fresh sync → PASS", async () => {
    const recent = new Date(NOW.getTime() - 5 * 60000).toISOString();
    const c = await run("orthanc.sync_fresh", ctx({ query: async () => [{ m: recent, n: 3 }] }));
    expect(c.status).toBe("PASS");
  });
  it("no study ever received → SKIPPED, never FAIL", async () => {
    const c = await run("radiology.last_dicom", ctx({ query: async () => [{ m: null }] }));
    expect(c.status).toBe("SKIPPED");
  });
  it("old DICOM past threshold → WARNING", async () => {
    const old = new Date(NOW.getTime() - 200 * 60000).toISOString();
    const c = await run("radiology.last_dicom", ctx({ query: async () => [{ m: old }] }));
    expect(c.status).toBe("WARNING");
  });
});

describe("Optional integrations — SKIPPED when unconfigured, not FAIL", () => {
  it("n8n unset → SKIPPED", async () => {
    const c = await run("integ.n8n", ctx({ n8nUrl: null }));
    expect(c.status).toBe("SKIPPED");
  });
  it("n8n configured + reachable → PASS", async () => {
    const c = await run("integ.n8n", ctx({ n8nUrl: "http://n8n:5678/healthz", probe: async () => ({ ok: true, status: 200, ms: 3 }) }));
    expect(c.status).toBe("PASS");
  });
  it("optional check excluded when includeOptional=false → SKIPPED", async () => {
    const c = await runOneCheck(defById("integ.n8n"), ctx({ n8nUrl: "http://n8n:5678" }), { ...OPTS, includeOptional: false });
    expect(c.status).toBe("SKIPPED");
  });
});

describe("Queue routes", () => {
  it("200/401 → PASS (route mounted)", async () => {
    expect((await run("queue.usg", ctx({ probe: async () => ({ ok: true, status: 200, ms: 4 }) }))).status).toBe("PASS");
    expect((await run("queue.mri", ctx({ probe: async () => ({ ok: false, status: 401, ms: 4 }) }))).status).toBe("PASS");
  });
  it("5xx → WARNING", async () => {
    const c = await run("queue.ct", ctx({ probe: async () => ({ ok: false, status: 503, ms: 4 }) }));
    expect(c.status).toBe("WARNING");
  });
  it("server mode → SKIPPED (CLI-probed)", async () => {
    const c = await run("queue.usg", ctx({ mode: "server", baseUrl: null }));
    expect(c.status).toBe("SKIPPED");
  });
});

describe("Application checks", () => {
  it("missing required config → FAIL with the missing keys (never values)", async () => {
    const c = await run("app.config", ctx({ env: (k) => (k === "DATABASE_URL" ? "x" : undefined) }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/JWT_SECRET/);
    expect(c.message).toMatch(/SESSION_SECRET/);
    expect(c.metadata?.missing).toEqual(["JWT_SECRET", "SESSION_SECRET"]);
  });
  it("all config present → PASS", async () => {
    const c = await run("app.config", ctx({ env: () => "set" }));
    expect(c.status).toBe("PASS");
  });
  it("version with a real commit → PASS and carries metadata", async () => {
    const c = await run("app.version", ctx());
    expect(c.status).toBe("PASS");
    expect(c.metadata?.commit).toBe("abc12345");
    expect(c.metadata?.version).toBe("2.0.0");
  });
  it("version with unknown commit → WARNING", async () => {
    const c = await run("app.version", ctx({ version: { ...ctx().version, commit: "unknown" } }));
    expect(c.status).toBe("WARNING");
  });
  it("non-production NODE_ENV → WARNING", async () => {
    const c = await run("app.production_mode", ctx({ version: { ...ctx().version, nodeEnv: "development" } }));
    expect(c.status).toBe("WARNING");
  });
  it("API liveness probe fail in CLI mode → FAIL", async () => {
    const c = await run("app.responding", ctx({ probe: async () => ({ ok: false, status: null, ms: 2000 }) }));
    expect(c.status).toBe("FAIL");
  });
});

describe("Auth guard check (CLI)", () => {
  it("admin endpoint returns 401 for anon → PASS", async () => {
    const c = await run("auth.admin_guard", ctx({ probe: async () => ({ ok: false, status: 401, ms: 5 }) }));
    expect(c.status).toBe("PASS");
  });
  it("admin endpoint returns 200 for anon → FAIL (not protected!)", async () => {
    const c = await run("auth.admin_guard", ctx({ probe: async () => ({ ok: true, status: 200, ms: 5 }) }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/not protected/i);
  });
});

describe("buildOperationsReport — end to end with a fake ctx", () => {
  it("DB failure surfaces required checks as UNKNOWN and overall UNKNOWN, never throws", async () => {
    const report = await buildOperationsReport(
      ctx({ query: async () => { throw new Error("connect ECONNREFUSED postgres://erp:pw@db:5432/x"); }, orthanc: { baseUrl: null, headers: {}, configured: false } }),
      { includeOptional: false, timeoutMs: 500, trigger: "cli" },
    );
    // db.connect is required and errored → UNKNOWN → overall UNKNOWN (no required FAIL here).
    const dbConnect = report.checks.find((c) => c.id === "db.connect")!;
    expect(dbConnect.status).toBe("UNKNOWN");
    expect(dbConnect.message).not.toContain("pw@"); // secret scrubbed
    expect(["UNKNOWN", "FAIL"]).toContain(report.overall);
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.version.version).toBe("2.0.0");
  });

  it("a healthy happy-path (all DB reads succeed, Orthanc PASS) → overall PASS", async () => {
    const healthy = ctx({
      env: (k) => (["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET"].includes(k) ? "set" : undefined),
      orthanc: { baseUrl: "http://care-orthanc:8042", headers: {}, configured: true },
      query: async (text) => {
        if (text.includes("information_schema.tables")) {
          return ["users", "portal_sessions", "patients", "bills", "radiology_worklist", "radiology_report_drafts", "patient_reports"].map((t) => ({ table_name: t }));
        }
        if (text.includes("schema_deploy_state")) return [{ key: "db_patch_ok", value: "true" }, { key: "schema_verify_status", value: "full_pass" }];
        if (text.includes("sync_status = 'synced'")) return [{ m: new Date(NOW.getTime() - 60000).toISOString(), n: 2 }];
        if (text.includes("study_received_at")) return [{ m: new Date(NOW.getTime() - 60000).toISOString() }];
        if (text.includes("backup_job_logs")) return [{ created_at: new Date(NOW.getTime() - 3600000).toISOString(), size_bytes: 1048576 }];
        return [{ c: 0, ok: 1 }];
      },
      probe: async (url) => {
        if (url.includes("/system")) return { ok: true, status: 200, ms: 6, json: { Version: "1.12.4" } };
        if (url.includes("/api/admin/operations/health")) return { ok: false, status: 401, ms: 3 }; // anon correctly rejected
        return { ok: true, status: 200, ms: 4 };
      },
    });
    const report = await buildOperationsReport(healthy, { includeOptional: false, timeoutMs: 500, trigger: "cli" });
    expect(report.overall).toBe("PASS");
    expect(report.summary.fail).toBe(0);
    expect(report.checks.find((c) => c.id === "orthanc.reachable")!.status).toBe("PASS");
  });
});

describe("AI / radiology operational checks (§8 dashboard integration)", () => {
  it("ai.ollama SKIPPED when not configured (manual reporting unaffected)", async () => {
    const c = await run("ai.ollama", ctx());
    expect(c.status).toBe("SKIPPED");
  });

  it("ai.ollama PASS when reachable and the configured model is pulled", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3:14b", configured: true },
      probe: async () => ({ ok: true, status: 200, ms: 5, json: { models: [{ name: "qwen3:14b" }, { name: "gpt-oss:20b" }] } }),
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).toContain("qwen3:14b");
  });

  it("ai.ollama WARNING when reachable but the configured model is not pulled", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3:14b", configured: true },
      probe: async () => ({ ok: true, status: 200, ms: 5, json: { models: [{ name: "gpt-oss:20b" }] } }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.recommendedAction).toContain("ollama pull qwen3:14b");
  });

  it("ai.ollama WARNING (not FAIL) when unreachable — reporting must keep working", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3:14b", configured: true },
      probe: async () => ({ ok: false, status: null, ms: 5000, error: "timeout" }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.required).toBe(false);
  });

  it("queue/lock checks WARN on failures and are UNKNOWN when the table is absent", async () => {
    const withFailures = ctx({ query: async () => [{ n: 3 }] });
    expect((await run("ai.job_queue", withFailures)).status).toBe("WARNING");
    expect((await run("radiology.pacs_return", withFailures)).status).toBe("WARNING");
    expect((await run("radiology.study_locks", withFailures)).status).toBe("WARNING");

    const clean = ctx({ query: async () => [{ n: 0 }] });
    expect((await run("ai.job_queue", clean)).status).toBe("PASS");
    expect((await run("radiology.pacs_return", clean)).status).toBe("PASS");

    const noTable = ctx({ query: async () => { throw new Error('relation "ai_job_queue" does not exist'); } });
    expect((await run("ai.job_queue", noTable)).status).toBe("UNKNOWN");
  });
});
