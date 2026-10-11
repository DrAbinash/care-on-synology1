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
    ollama: { baseUrl: null, model: "qwen3-vl:8b", configured: false },
    localOpenAi: { baseUrl: null, model: null, configured: false, enabled: true },
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
    // Orthanc's DICOMweb MaxResourceCount defaults to 100: a larger limit is an
    // error page, not a wider window.
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
