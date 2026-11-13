import { describe, it, expect } from "vitest";
import {
  CHECK_DEFS, buildOperationsReport, DEFAULT_THRESHOLDS, parseDaemonState, parseGuardState,
  type OpsCtx, type OpsDaemonState, type OpsGuardState, type ProbeResult,
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
    ollama: { baseUrl: null, model: "qwen3-vl:8b", configured: false },
    localOpenAi: { baseUrl: null, model: null, configured: false, enabled: true },
    ohifUrl: null,
    publicBaseUrl: null,
    displayToken: "tok",
    n8nUrl: null,
    paymentGatewayConfigured: null,
    storageDir: null,
    diskFree: null,
    guardState: null,
    daemonState: null,
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
    expect(c.message).toMatch(/1h 30m/);
  });
  it("fresh sync → PASS", async () => {
    const recent = new Date(NOW.getTime() - 5 * 60000).toISOString();
    const c = await run("orthanc.sync_fresh", ctx({ query: async () => [{ m: recent, n: 3 }] }));
    expect(c.status).toBe("PASS");
  });
  it("orthanc.sync_fresh reads radiology_worklist, never dicom_studies", async () => {
    // dicom_studies.sync_status is only written by the study manager's manual
    // retry button, so a check against it reported SKIPPED for ever while the
    // Orthanc bridge delivered normally into radiology_worklist.
    let sql = "";
    const recent = new Date(NOW.getTime() - 5 * 60000).toISOString();
    const c = await run("orthanc.sync_fresh", ctx({
      query: async (text) => { sql = text; return [{ m: recent, n: 3 }]; },
    }));
    expect(sql).toContain("radiology_worklist");
    expect(sql).not.toContain("dicom_studies");
    expect(c.status).toBe("PASS");
  });
  it("radiology.last_dicom reads the intake table the Orthanc path writes", async () => {
    let sql = "";
    const old = new Date(NOW.getTime() - 200 * 60000).toISOString();
    const c = await run("radiology.last_dicom", ctx({
      query: async (text) => { sql = text; return [{ m: old }]; },
    }));
    expect(sql).toContain("radiology_worklist");
    expect(sql).not.toContain("dicom_studies");
    expect(c.status).toBe("WARNING");
  });
  it("no study ever received → SKIPPED, never FAIL", async () => {
    const c = await run("radiology.last_dicom", ctx({ query: async () => [{ m: null }] }));
    expect(c.status).toBe("SKIPPED");
  });
});

/** One Orthanc QIDO-RS study. PS3.15 JSON: tag uppercase, `vr` lower, `Value` capital. */
function orthancStudy(uid: string, studyDate: string, studyTime?: string) {
  return {
    "0020000D": { vr: "UI", Value: [uid] },
    "00080020": { vr: "DA", Value: [studyDate] },
    ...(studyTime ? { "00080030": { vr: "TM", Value: [studyTime] } } : {}),
  };
}

const ORTHANC_CFG = { baseUrl: "http://care-orthanc:8042", headers: {}, configured: true };

describe("orthanc.sync_divergence — is Orthanc actually delivering into the ERP", () => {
  it("Orthanc unconfigured → SKIPPED (never a FAIL)", async () => {
    const c = await run("orthanc.sync_divergence", ctx());
    expect(c.status).toBe("SKIPPED");
  });

  it("Orthanc does not answer → UNKNOWN, not a fabricated PASS", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: false, status: null, ms: 3000, error: "ETIMEDOUT" }),
    }));
    expect(c.status).toBe("UNKNOWN");
  });

  it("a 200 that is not a study list → UNKNOWN (a proxy login page is not an empty PACS)", async () => {
    for (const json of [undefined, "<html>sign in</html>", { Error: "unauthorized" }]) {
      const c = await run("orthanc.sync_divergence", ctx({
        orthanc: ORTHANC_CFG,
        probe: async () => ({ ok: true, status: 200, ms: 6, json }),
      }));
      expect(c.status).toBe("UNKNOWN");
    }
  });

  it("Orthanc answers 401 for the study window → UNKNOWN, not 'nothing to deliver'", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 401, ms: 6 }),
    }));
    expect(c.status).toBe("UNKNOWN");
  });

  it("every due study in the worklist → PASS", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({
        ok: true, status: 200, ms: 6,
        json: [orthancStudy("1.2.3.10", "20260721", "090000"), orthancStudy("1.2.3.11", "20260720", "230000")],
      }),
      query: async () => [{ study_instance_uid: "1.2.3.10" }, { study_instance_uid: "1.2.3.11" }],
    }));
    expect(c.status).toBe("PASS");
    expect(c.metadata?.missing).toBe(0);
    expect(c.metadata?.due).toBe(2);
  });

  it("a study that is in Orthanc but never reached the worklist → FAIL naming the count", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({
        ok: true, status: 200, ms: 6,
        json: [orthancStudy("1.2.3.10", "20260721", "090000"), orthancStudy("1.2.3.11", "20260720", "230000")],
      }),
      query: async () => [{ study_instance_uid: "1.2.3.10" }],
    }));
    expect(c.status).toBe("FAIL");
    expect(c.metadata?.missing).toBe(1);
    expect(c.message).toContain("1 of 2");
    expect(c.recommendedAction).toMatch(/care-erp-sync/);
  });

  it("a study scanned inside the polling grace is NOT treated as lost", async () => {
    // Orthanc marks a study stable and care-erp-sync polls /changes every 60s,
    // so an absent brand-new study is normal. Counting it would flash red on
    // every examination.
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 200, ms: 6, json: [orthancStudy("1.2.3.99", "20260721", "114500")] }),
      query: async () => [],
    }));
    expect(c.status).toBe("SKIPPED");
    expect(c.message).toMatch(/not due|no Orthanc study/i);
  });

  it("date-only precision: a study dated today is still in flight", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 200, ms: 6, json: [orthancStudy("1.2.3.99", "20260721")] }),
      query: async () => [],
    }));
    expect(c.status).toBe("SKIPPED");
  });

  it("date-only precision: a study dated yesterday is overdue", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 200, ms: 6, json: [orthancStudy("1.2.3.99", "20260720")] }),
      query: async () => [],
    }));
    expect(c.status).toBe("FAIL");
    expect(c.metadata?.missing).toBe(1);
  });

  it("studies with no readable UID → UNKNOWN, never a vacuous '0 missing'", async () => {
    // The trap this exists to refuse: an empty comparison is not a clean one.
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({
        ok: true, status: 200, ms: 6,
        json: [{ ID: "abc" }, { ID: "def" }],
      }),
      query: async () => [],
    }));
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).not.toMatch(/0 missing|all 0/);
  });

  it("an empty Orthanc window → SKIPPED", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 200, ms: 6, json: [] }),
    }));
    expect(c.status).toBe("SKIPPED");
  });

  it("Orthanc lists nothing but the ERP received a study minutes ago → UNKNOWN, not a quiet PACS", async () => {
    // The false all-clear this guards: a StudyDate range this Orthanc does not
    // understand answers with an empty array, which is indistinguishable from a
    // genuinely empty PACS unless the ERP side is consulted.
    const recent = new Date(NOW.getTime() - 10 * 60000).toISOString();
    let crossCheckSql = "";
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({ ok: true, status: 200, ms: 6, json: [] }),
      query: async (text) => {
        if (text.includes("max(created_at)")) { crossCheckSql = text; return [{ m: recent }]; }
        return [];
      },
    }));
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).toMatch(/either that StudyDate range is not answering as expected, or what arrived here carries a DICOM date outside/);
    // The tie-breaker has to read the intake table: dicom_studies is empty on
    // this pathway, so consulting it would make every quiet window look broken.
    expect(crossCheckSql).toContain("radiology_worklist");
    expect(crossCheckSql).not.toContain("dicom_studies");
  });

  // A PASS is only a statement about the studies that could be matched, so the
  // ones Orthanc returned without a readable UID + date must be said out loud.
  it("a clean delivery still names the studies it could not compare", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({
        ok: true, status: 200, ms: 6,
        json: [orthancStudy("1.2.3.10", "20260721", "090000"), { ID: "x" }, { ID: "y" }],
      }),
      query: async () => [{ study_instance_uid: "1.2.3.10" }],
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).toContain("2 returned without a readable UID + StudyDate were not compared");
    expect(c.metadata?.undated).toBe(2);
  });

  it("a delivery failure names the studies it could not compare too", async () => {
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async () => ({
        ok: true, status: 200, ms: 6,
        json: [orthancStudy("1.2.3.10", "20260721", "090000"), { ID: "x" }],
      }),
      query: async () => [],
    }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toContain("1 returned without a readable UID + StudyDate were not compared");
  });

  it("Orthanc lists nothing and the ERP has received nothing inside the window → SKIPPED, not UNKNOWN", async () => {
    for (const m of [new Date(NOW.getTime() - 3 * 86400000).toISOString(), null]) {
      const c = await run("orthanc.sync_divergence", ctx({
        orthanc: ORTHANC_CFG,
        probe: async () => ({ ok: true, status: 200, ms: 6, json: [] }),
        query: async (text) => (text.includes("max(created_at)") ? [{ m }] : []),
      }));
      expect(c.status).toBe("SKIPPED");
    }
  });

  it("queries the worklist by parameter, and bounds Orthanc by StudyDate", async () => {
    let sql = "";
    let params: unknown[] | undefined;
    let url = "";
    const c = await run("orthanc.sync_divergence", ctx({
      orthanc: ORTHANC_CFG,
      probe: async (u) => {
        url = u;
        return { ok: true, status: 200, ms: 6, json: [orthancStudy("1.2.3.10", "20260721", "090000")] };
      },
      query: async (text, p) => { sql = text; params = p; return []; },
    }));
    expect(c.status).toBe("FAIL");
    expect(sql).toContain("radiology_worklist");
    expect(sql).toContain("= ANY($1::text[])");
    expect(params).toEqual([["1.2.3.10"]]); // bound as a parameter, never interpolated
    expect(sql).not.toContain("1.2.3.10");
    expect(url).toContain("/dicom-web/studies?StudyDate=20260719-20260721");
    // One comparison must fit the details panel's 4.5-second probe budget, so the
    // window is capped rather than "however many studies exist".
    expect(url).toContain("&limit=100");
    expect(url).not.toContain("query=StudyDate"); // the native form is unproven on this deployment
  });
});

describe("radiology.sync_failures — the failure ledger the PACS agents really write", () => {
  it("reads pacs_logs, not dicom_studies.sync_status", async () => {
    let sql = "";
    const c = await run("radiology.sync_failures", ctx({
      query: async (text) => { sql = text; return [{ c: 0 }]; },
    }));
    expect(sql).toContain("pacs_logs");
    expect(sql).not.toContain("dicom_studies");
    expect(c.status).toBe("PASS");
  });
  it("an error reported in the last 24h → WARNING", async () => {
    const c = await run("radiology.sync_failures", ctx({ query: async () => [{ c: 2 }] }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toContain("2 PACS errors");
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
        if (text.includes("radiology_worklist") && text.includes("= ANY($1::text[])")) return [{ study_instance_uid: "1.2.3.10" }];
        if (text.includes("radiology_worklist") && text.includes("max(created_at)")) return [{ m: new Date(NOW.getTime() - 60000).toISOString(), n: 2 }];
        if (text.includes("backup_job_logs")) return [{ created_at: new Date(NOW.getTime() - 3600000).toISOString(), size_bytes: 1048576 }];
        if (text.includes("restore_verification")) {
          return [{
            status: "pass",
            ran_at: new Date(NOW.getTime() - 3600000).toISOString(),
            detail: { steps: [{ name: "restore", ok: true, detail: "ok" }] },
          }];
        }
        return [{ c: 0, ok: 1 }];
      },
      probe: async (url) => {
        if (url.includes("/dicom-web/studies?StudyDate")) {
          return { ok: true, status: 200, ms: 4, json: [orthancStudy("1.2.3.10", "20260721", "090000")] };
        }
        if (url.includes("/system")) return { ok: true, status: 200, ms: 6, json: { Version: "1.12.4" } };
        if (url.includes("/api/admin/operations/health")) return { ok: false, status: 401, ms: 3 }; // anon correctly rejected
        return { ok: true, status: 200, ms: 4 };
      },
    });
    const report = await buildOperationsReport(healthy, { includeOptional: false, timeoutMs: 500, trigger: "cli" });
    expect(report.overall).toBe("PASS");
    expect(report.summary.fail).toBe(0);
    expect(report.checks.find((c) => c.id === "orthanc.reachable")!.status).toBe("PASS");
    expect(report.checks.find((c) => c.id === "orthanc.sync_divergence")!.status).toBe("PASS");
  });
});

describe("AI / radiology operational checks (§8 dashboard integration)", () => {
  it("ai.ollama SKIPPED when not configured (manual reporting unaffected)", async () => {
    const c = await run("ai.ollama", ctx());
    expect(c.status).toBe("SKIPPED");
  });

  it("ai.ollama PASS when reachable and the configured model is pulled", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3-vl:8b", configured: true },
      probe: async () => ({ ok: true, status: 200, ms: 5, json: { models: [{ name: "qwen3-vl:8b" }, { name: "gpt-oss:20b" }] } }),
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).toContain("qwen3-vl:8b");
  });

  it("ai.ollama WARNING when reachable but the configured model is not pulled", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3-vl:8b", configured: true },
      probe: async () => ({ ok: true, status: 200, ms: 5, json: { models: [{ name: "gpt-oss:20b" }] } }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.recommendedAction).toContain("ollama pull qwen3-vl:8b");
  });

  it("ai.ollama WARNING (not FAIL) when unreachable — reporting must keep working", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3-vl:8b", configured: true },
      probe: async () => ({ ok: false, status: null, ms: 5000, error: "timeout" }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.required).toBe(false);
  });

  it("ai.ollama is NOT failed by an unreachable local OpenAI-compatible server", async () => {
    const c = await run("ai.ollama", ctx({
      ollama: { baseUrl: "http://172.16.1.140:11434", model: "qwen3-vl:8b", configured: true },
      localOpenAi: { baseUrl: "http://192.168.1.250:8080/v1", model: "bonsai", configured: true, enabled: true },
      probe: async (url) =>
        url.includes("/models")
          ? { ok: false, status: null, ms: 5 }
          : { ok: true, status: 200, ms: 5, json: { models: [{ name: "qwen3-vl:8b" }] } },
    }));
    expect(c.status).toBe("PASS");
  });

  describe("ai.local_openai_compatible — the OpenAI-wire local server is asked its own way", () => {
  const LOCAL = { baseUrl: "http://192.168.1.250:8080/v1", model: "bonsai", configured: true, enabled: true };

  it("SKIPPED when the clinic never configured one", async () => {
    const c = await run("ai.local_openai_compatible", ctx());
    expect(c.status).toBe("SKIPPED");
  });

  it("SKIPPED, with the route consequence stated, when it is configured but switched off", async () => {
    const c = await run("ai.local_openai_compatible", ctx({ localOpenAi: { ...LOCAL, enabled: false } }));
    expect(c.status).toBe("SKIPPED");
    expect(c.message).toContain("switched off");
  });

  it("probes GET <endpoint>/models and never /api/tags", async () => {
    const urls: string[] = [];
    await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, ms: 3, json: { data: [{ id: "bonsai" }] } };
      },
    }));
    expect(urls).toEqual(["http://192.168.1.250:8080/v1/models"]);
    expect(urls.some((u) => u.includes("/api/tags"))).toBe(false);
  });

  it("PASS when reachable and the saved model is served", async () => {
    const c = await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async () => ({ ok: true, status: 200, ms: 4, json: { data: [{ id: "bonsai" }, { id: "other" }] } }),
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).toContain("bonsai is served");
  });

  it("WARNING when the endpoint is down — and it is a warning, not a hard fail", async () => {
    const c = await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async () => ({ ok: false, status: null, ms: 4 }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.recommendedAction).toContain("Model Routing");
  });

  it("PASS on 401 — the server is alive; the saved key is used by inference, not this probe", async () => {
    const c = await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async () => ({ ok: true, status: 401, ms: 4 }),
    }));
    expect(c.status).toBe("PASS");
    expect(c.metadata).toMatchObject({ modelListing: "auth_required" });
  });

  it("WARNING on 404 — usually a base URL missing the /v1 suffix", async () => {
    const c = await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async () => ({ ok: true, status: 404, ms: 4 }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.recommendedAction).toContain("/v1");
  });

  it("WARNING when reachable but the saved model is not the one served", async () => {
    const c = await run("ai.local_openai_compatible", ctx({
      localOpenAi: LOCAL,
      probe: async () => ({ ok: true, status: 200, ms: 4, json: { models: [{ name: "something-else" }] } }),
    }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toContain("NOT served");
  });
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
    expect((await run("ai.job_queue", noTable)).status).toBe("SKIPPED");
  });
});

describe("ops.recovery_guard — is the unattended recovery still armed?", () => {
  const tick = (rc: string, minutesAgo: number, lockStreak = 0): OpsGuardState => ({
    rc,
    atSeconds: NOW.getTime() / 1000 - minutesAgo * 60,
    lockStreak,
  });
  const guard = (s: OpsGuardState | null) => ctx({ guardState: () => s });

  it("no guard directory on this host → SKIPPED, not a false alarm", async () => {
    expect((await run("ops.recovery_guard", ctx({ guardState: null }))).status).toBe("SKIPPED");
  });

  it("mounted but no readable tick record → UNKNOWN with the install hint", async () => {
    const c = await run("ops.recovery_guard", guard(null));
    expect(c.status).toBe("UNKNOWN");
    expect(c.recommendedAction).toContain("recover-guard.sh");
  });

  it("rc=0 two minutes ago → PASS 'armed'", async () => {
    const c = await run("ops.recovery_guard", guard(tick("0", 2)));
    expect(c.status).toBe("PASS");
    expect(c.message).toMatch(/armed/);
    expect(c.metadata).toMatchObject({ ageMinutes: 2, rc: "0", lockStreak: 0 });
  });

  // The reason the light exists: a DSM Task Scheduler save rewrites
  // /etc/crontab and silently drops the hand-added line, after which the guard
  // simply stops being called and nothing else reports it.
  it("a tick older than the threshold → FAIL naming the crontab entry", async () => {
    const c = await run("ops.recovery_guard", guard(tick("0", 16)));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/not ticked in 16 min/);
    expect(c.recommendedAction).toMatch(/\/etc\/crontab/);
  });

  it("the threshold is the boundary, not decoration: 15 min is still armed", async () => {
    expect((await run("ops.recovery_guard", guard(tick("0", DEFAULT_THRESHOLDS.guardStaleMinutes)))).status).toBe("PASS");
  });

  // Ordering proof. A disarmed guard ALSO looks stale, because refusing the tick
  // means never rewriting the status file. Checking staleness first would send
  // him hunting a cron problem he does not have.
  it("a FAILED recovery (rc 5-8) reports the failure, never bare staleness", async () => {
    for (const rc of ["5", "6", "7", "8"]) {
      const c = await run("ops.recovery_guard", guard(tick(rc, 90)));
      expect(c.status).toBe("FAIL");
      expect(c.message).toContain(`rc=${rc}`);
      expect(c.message).toMatch(/disarmed/);
      expect(c.message).not.toMatch(/crontab entry is gone/);
    }
  });

  it("rc=4 / rc=9 → WARNING: the guard saw something it deliberately does not act on", async () => {
    expect((await run("ops.recovery_guard", guard(tick("4", 3)))).status).toBe("WARNING");
    expect((await run("ops.recovery_guard", guard(tick("9", 3)))).status).toBe("WARNING");
  });

  it("rc=3 is a deploy standing down, until the streak says the lock is stale", async () => {
    const one = await run("ops.recovery_guard", guard(tick("3", 3, 1)));
    expect(one.status).toBe("PASS");
    expect(one.message).toMatch(/standing down/i);

    // A blocked guard still ticks and still rewrites its record, so the streak
    // is the only thing that can distinguish "deploy in progress" from "stale
    // lock, guard silently disabled".
    const stuck = await run("ops.recovery_guard", guard(tick("3", 2, DEFAULT_THRESHOLDS.guardLockStuckTicks)));
    expect(stuck.status).toBe("FAIL");
    expect(stuck.message).toMatch(/stale lock/i);
    expect(stuck.recommendedAction).toContain("/tmp/care-deploy.lock");
  });

  it("rc=3 AND quiet is a cron problem, not a lock problem", async () => {
    const c = await run("ops.recovery_guard", guard(tick("3", 120, 1)));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/crontab entry is gone/);
    expect(c.message).not.toMatch(/stale lock/i);
  });

  it("a clock ahead of the guard never renders a negative age", async () => {
    const c = await run("ops.recovery_guard", guard(tick("0", -5)));
    expect(c.metadata).toMatchObject({ ageMinutes: 0 });
    expect(c.status).toBe("PASS");
  });

  it("an unexpected rc is not silently green", async () => {
    const c = await run("ops.recovery_guard", guard(tick("10", 3)));
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).toContain("rc=10");
  });

  it("the report carries the check so the daily summary can paint it", async () => {
    const report = await buildOperationsReport(
      ctx({ guardState: () => tick("0", 1) }),
      { includeOptional: true, timeoutMs: 500, trigger: "admin" },
    );
    expect(report.checks.map((k) => k.id)).toContain("ops.recovery_guard");
  });
});

describe("parseGuardState — only the guard's own three-field line means armed", () => {
  it("accepts the format recover-guard.sh writes", () => {
    expect(parseGuardState("0 1794503718 0\n")).toEqual({ rc: "0", atSeconds: 1794503718, lockStreak: 0 });
  });

  it("rejects anything that is not exactly rc epoch streak", () => {
    for (const bad of ["", "0", "0 1794503718", "0 abc 0", "x 1794503718 0", "0 1794503718 0 9", "0 -5 0", "NaN NaN NaN"]) {
      expect(parseGuardState(bad), bad).toBeNull();
    }
  });
});

const SAMPLE_AT = NOW.getTime() / 1000;

/**
 * The key=value text docker-daemon-probe.sh renames into place, defaults first
 * and overrides last. Written as TEXT rather than hand-built objects on
 * purpose: the script and this parser are deployed independently (the script
 * lives on the NAS checkout, the parser inside the image), so a test that
 * invented its own field names would stay green while the real record parsed to
 * null every tick and the light read UNKNOWN forever.
 */
function daemonSample(over: Record<string, string | number> = {}): string {
  const f: Record<string, string | number> = {
    at: SAMPLE_AT,
    ping: "ok",
    ping_rc: 0,
    ping_http: 200,
    ping_ms: 4,
    daemon_start: SAMPLE_AT - 30 * 3600,
    host_boot: SAMPLE_AT - 5 * 86400,
    down_since: 0,
    live_restore: "on",
    server_version: "24.0.2",
    containers_seen: 4,
    containers_running: 4,
    stamps: "care-db:2026-11-12T16:32:52Z care-api:2026-11-12T16:32:55Z",
    ev_at: 0,
    ev_kind: "none",
    ev_open: 0,
    ev_dark_s: "unknown",
    ev_stamps: "unknown",
    ev_live_restore: "unknown",
    ev_server_version: "unknown",
    ...over,
  };
  return Object.entries(f).map(([k, v]) => `${k}=${v}\n`).join("");
}

describe("ops.docker_daemon — can this page answer 'what did the daemon do last night'?", () => {
  const daemon = (over: Record<string, string | number> = {}): OpsCtx =>
    ctx({ daemonState: (): OpsDaemonState | null => parseDaemonState(daemonSample(over)) });

  it("no probe record on this host → SKIPPED (a dev box is not a silent daemon)", async () => {
    const c = await run("ops.docker_daemon", ctx({ daemonState: null }));
    expect(c.status).toBe("SKIPPED");
    expect(c.message).toMatch(/this light is for the NAS deploy/);
  });

  it("directory mounted but no readable record → UNKNOWN with the run-it-once proof", async () => {
    const c = await run("ops.docker_daemon", ctx({ daemonState: () => null }));
    expect(c.status).toBe("UNKNOWN");
    expect(c.recommendedAction).toContain("docker-daemon-probe.sh");
  });

  it("the probe's healthy output → PASS naming uptime, engine, live-restore and containers", async () => {
    const c = await run("ops.docker_daemon", daemon());
    expect(c.status).toBe("PASS");
    expect(c.message).toMatch(/dockerd has been up 30 h, engine 24\.0\.2, live-restore on, 4\/4 ERP containers running/);
    expect(c.metadata).toMatchObject({ ageMinutes: 0, ping: "ok", liveRestore: "on", eventKind: "none" });
  });

  it("live-restore unreadable is stated as unreadable, never assumed on", async () => {
    const c = await run("ops.docker_daemon", daemon({ live_restore: "unknown" }));
    expect(c.status).toBe("PASS");
    expect(c.message).toMatch(/live-restore unreadable \(not assumed to be on\)/);
  });

  // The probe's word for "I could not read that" is the literal `unknown`. As a
  // version string it would reach the page as "engine unknown", which reads as a
  // version number — so it is the ABSENCE of the fact, and the clause drops out.
  it("an unreadable engine version is left out of the sentence, not printed as a version", async () => {
    const c = await run("ops.docker_daemon", daemon({
      server_version: "unknown", ev_server_version: "unknown", daemon_start: "unknown",
    }));
    expect(c.status).toBe("PASS");
    expect(c.message).not.toMatch(/engine unknown/);
    expect(c.message).toMatch(/the daemon's start instant was unreadable/);
    expect(c.metadata).toMatchObject({ serverVersion: null });
  });

  it("a tick that could not read the containers does not report zero of them running", async () => {
    const c = await run("ops.docker_daemon", daemon({ containers_seen: "unknown", containers_running: "unknown" }));
    expect(c.status).toBe("PASS");
    expect(c.message).toMatch(/ERP containers unreadable on that tick/);
    expect(c.metadata).toMatchObject({ containersRunning: null, containersSeen: null });
  });

  // The failure mode this light shares with the guard's: saving a Task Scheduler
  // job rewrites /etc/crontab from DSM's own database, the hand-added line
  // disappears, and the file stops changing while still saying "ok" inside it.
  it("a sample nobody refreshed is a FAIL about the cron line", async () => {
    const c = await run("ops.docker_daemon", daemon({ at: SAMPLE_AT - 16 * 60 }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/has not written a sample in 16 min/);
    expect(c.recommendedAction).toMatch(/\/etc\/crontab/);
  });

  // Ordering proof, in the same direction as the guard's: a two-hour-old "down"
  // record would otherwise report a live outage that ended while he was asleep.
  it("staleness outranks the recorded state — a stale 'down' must not read as a live outage", async () => {
    const c = await run("ops.docker_daemon", daemon({
      at: SAMPLE_AT - 120 * 60, ping: "down", ping_rc: 7, down_since: SAMPLE_AT - 119 * 60,
    }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/crontab entry is gone/);
    expect(c.message).not.toMatch(/dockerd is not answering/);
  });

  it("the threshold is the boundary, not decoration: daemonStaleMinutes is still fresh", async () => {
    const c = await run("ops.docker_daemon", daemon({ at: SAMPLE_AT - DEFAULT_THRESHOLDS.daemonStaleMinutes * 60 }));
    expect(c.status).toBe("PASS");
  });

  it("a proved refusal → FAIL, carrying the reason containers can look healthy anyway", async () => {
    const c = await run("ops.docker_daemon", daemon({ ping: "down", ping_rc: 7, down_since: SAMPLE_AT - 200 }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/dockerd is not answering \(no reply for 3 m 20 s\) — curl rc=7/);
    expect(c.message).toMatch(/embedded DNS that resolves "api" for care-web is served by dockerd/);
    expect(c.recommendedAction).toContain("recover-after-daemon-restart.sh --check");
  });

  it("a refusal whose window the probe never saw says so instead of claiming 0 s dark", async () => {
    const c = await run("ops.docker_daemon", daemon({ ping: "down", ping_rc: 28, down_since: 0 }));
    expect(c.status).toBe("FAIL");
    expect(c.message).not.toMatch(/no reply for/);
    expect(c.metadata).toMatchObject({ darkSeconds: null });
  });

  // `unknown` is the probe's own failure (no curl in cron's PATH, missing socket
  // path, a tool that errored). Painting that red would send him off to restart
  // a daemon that is answering, which is how a daemon reload becomes an outage.
  it("a probe that could not tell is UNKNOWN — not an outage, not health", async () => {
    const c = await run("ops.docker_daemon", daemon({ ping: "unknown", ping_rc: 127, ping_http: "000" }));
    expect(c.status).toBe("UNKNOWN");
    expect(c.message).toMatch(/could not tell whether dockerd answers \(curl rc=127\)/);
    expect(c.message).not.toMatch(/is not answering/);
    expect(c.recommendedAction).toContain("--unix-socket");
  });

  it("live-restore off is a FAIL while everything answers — that is the 2026-11-10 shape", async () => {
    const c = await run("ops.docker_daemon", daemon({ live_restore: "off" }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/live-restore is OFF in the running daemon, engine 24\.0\.2/);
    expect(c.message).not.toMatch(/And it happened/);
    expect(c.recommendedAction).toMatch(/approved window/);
  });

  it("live-restore off AND last night's restart reports both, with the event's age", async () => {
    const c = await run("ops.docker_daemon", daemon({
      live_restore: "off", ev_at: SAMPLE_AT - 3600, ev_kind: "daemon", ev_dark_s: 60, ev_live_restore: "off",
    }));
    expect(c.status).toBe("FAIL");
    expect(c.message).toMatch(/live-restore is OFF/);
    expect(c.message).toMatch(/And it happened: dockerd restarted 1h ago and did not answer for 1 m 0 s/);
  });

  it("a restart the daemon came back from is a WARNING all morning, with the dark length named as unknown", async () => {
    const c = await run("ops.docker_daemon", daemon({ ev_at: SAMPLE_AT - 11 * 3600, ev_kind: "daemon", ev_live_restore: "on" }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/dockerd restarted 11h ago and the probe never saw it refuse, so how long it was dark is unknown/);
    expect(c.message).toMatch(/stamps could not be compared/);
    expect(c.recommendedAction).toContain("docker-daemon-events");
  });

  // Not naming the cause is the honest reading: the recovery script's own
  // restart and a deploy's recreate change the same stamps a daemon kill does.
  it("a measured window and changed stamps are reported, and the cause is left un-named", async () => {
    const c = await run("ops.docker_daemon", daemon({
      ev_at: SAMPLE_AT - 3600, ev_kind: "stall", ev_dark_s: 34 * 60 + 49, ev_stamps: "2/4", ev_live_restore: "on",
    }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/stopped answering and recovered without becoming a new process 1h ago and did not answer for 34 m 49 s/);
    expect(c.message).toMatch(/2\/4 ERP containers have a different start stamp across it/);
    expect(c.message).toMatch(/reports the change and names no cause/);
  });

  it("a NAS boot is told apart from a dockerd restart", async () => {
    const c = await run("ops.docker_daemon", daemon({ ev_at: SAMPLE_AT - 2 * 3600, ev_kind: "boot" }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/the NAS rebooted, and dockerd came up with it 2h ago/);
  });

  it("an engine change across the incident reads as the package upgrade it probably was", async () => {
    const c = await run("ops.docker_daemon", daemon({ ev_at: SAMPLE_AT - 3600, ev_kind: "daemon", ev_server_version: "20.10.3" }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/the engine also changed \(20\.10\.3 at the event, 24\.0\.2 now\)/);
  });

  it("a window the probe opened but never saw close says that, rather than implying it ended", async () => {
    const c = await run("ops.docker_daemon", daemon({ ev_at: SAMPLE_AT - 3600, ev_kind: "daemon", ev_open: 1, ev_live_restore: "on" }));
    expect(c.status).toBe("WARNING");
    expect(c.message).toMatch(/still marks that window open although dockerd answers now/);
  });

  it("an incident older than the notice window drops to PASS but is still named", async () => {
    const c = await run("ops.docker_daemon", daemon({ ev_at: SAMPLE_AT - 30 * 3600, ev_kind: "daemon" }));
    expect(c.status).toBe("PASS");
    expect(c.message).toMatch(/last daemon incident 30h ago, outside the 24 h notice window/);
  });

  it("the report carries the light, and optional means it can never fail a deploy", async () => {
    expect(defById("ops.docker_daemon").required).toBe(false);
    const report = await buildOperationsReport(
      daemon({ ping: "down", ping_rc: 7, down_since: SAMPLE_AT - 60 }),
      { includeOptional: true, timeoutMs: 500, trigger: "admin" },
    );
    expect(report.checks.map((k) => k.id)).toContain("ops.docker_daemon");
    expect(report.checks.find((k) => k.id === "ops.docker_daemon")?.status).toBe("FAIL");
  });
});

describe("parseDaemonState — only the probe's own record counts as a sample", () => {
  it("accepts the full output docker-daemon-probe.sh renames into place", () => {
    const s = parseDaemonState(daemonSample());
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      atSeconds: SAMPLE_AT,
      ping: "ok",
      pingRc: 0,
      daemonStart: SAMPLE_AT - 30 * 3600,
      liveRestore: "on",
      serverVersion: "24.0.2",
      containersRunning: 4,
      containersSeen: 4,
      downSince: null,
      event: { atSeconds: null, kind: "none", open: false, darkSeconds: null, stamps: null },
    });
  });

  // `at` and `ping` are load-bearing: without them the sample cannot be dated
  // or said to describe the daemon at all, and a truncated rename or a future
  // format must surface as UNKNOWN, never as a green light.
  it("rejects a record that is missing or lies about either load-bearing field", () => {
    for (const bad of ["", "ping=ok", "at=0\nping=ok", "at=abc\nping=ok", "at=-5\nping=ok",
      "at=1794500000", "at=1794500000\nping=maybe", "at=1794500000\nping="]) {
      expect(parseDaemonState(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("reads the probe's zero and unknown sentinels as 'nothing happened', not as 1970", () => {
    const s = parseDaemonState(daemonSample({ down_since: 0, ev_at: 0, ev_dark_s: "unknown", ev_stamps: "unknown" }));
    expect(s?.downSince).toBeNull();
    expect(s?.event.atSeconds).toBeNull();
    expect(s?.event.darkSeconds).toBeNull();
    expect(s?.event.stamps).toBeNull();
  });

  it("reads the probe's 'unknown' free-text fields as absent, not as the word", () => {
    const s = parseDaemonState(daemonSample({
      server_version: "unknown", ev_server_version: "unknown", daemon_start: "unknown", host_boot: "unknown",
    }));
    expect(s?.serverVersion).toBeNull();
    expect(s?.event.serverVersion).toBeNull();
    expect(s?.daemonStart).toBeNull();
    expect(s?.hostBoot).toBeNull();
  });

  it("parses a changed-stamp ratio and refuses to invent one out of prose", () => {
    expect(parseDaemonState(daemonSample({ ev_stamps: "2/4" }))?.event.stamps).toEqual({ changed: 2, compared: 4 });
    expect(parseDaemonState(daemonSample({ ev_stamps: "2 of 4" }))?.event.stamps).toBeNull();
    expect(parseDaemonState(daemonSample({ ev_stamps: "-1/4" }))?.event.stamps).toBeNull();
  });

  it("tolerates CRLF, because the record is written by sh on the NAS and read in a container", () => {
    expect(parseDaemonState(daemonSample({ ping: "down" }).replace(/\n/g, "\r\n"))?.ping).toBe("down");
  });

  it("an ev_kind this version does not know degrades to 'none' instead of losing the sample", () => {
    const s = parseDaemonState(daemonSample({ ev_at: SAMPLE_AT - 60, ev_kind: "some_future_kind" }));
    expect(s?.event.kind).toBe("none");
    expect(s?.atSeconds).toBe(SAMPLE_AT);
  });
});
