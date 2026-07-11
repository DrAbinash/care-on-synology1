import { describe, it, expect } from "vitest";
import {
  analyzeConfiguredUrl,
  certVerdict,
  classifyHttpResponse,
  classifySettings,
  corsVerdict,
  deriveDeploymentVerdict,
  KNOWN_PACS_SETTINGS,
  opsToCheckStatus,
  redirectLoopVerdict,
  sectionOf,
  trafficLight,
  worstCheckStatus,
  type DiagnosticSection,
} from "./radiologyDiagnosticsRules";

// Ticket M1.3 — pure rules behind the Flight Deck. Every verdict the admin
// page can show is derived here, so every failure mode is provable without a
// broken network.

const NOW = new Date("2026-07-11T10:00:00Z");

describe("check status algebra", () => {
  it("FAIL > WARNING > UNKNOWN > PASS; empty is honestly UNKNOWN", () => {
    expect(worstCheckStatus(["PASS", "PASS"])).toBe("PASS");
    expect(worstCheckStatus(["PASS", "UNKNOWN"])).toBe("UNKNOWN");
    expect(worstCheckStatus(["UNKNOWN", "WARNING"])).toBe("WARNING");
    expect(worstCheckStatus(["WARNING", "FAIL", "PASS"])).toBe("FAIL");
    expect(worstCheckStatus([])).toBe("UNKNOWN");
  });

  it("ops statuses map 1:1 and traffic lights are fixed", () => {
    expect(opsToCheckStatus("HEALTHY")).toBe("PASS");
    expect(opsToCheckStatus("DEGRADED")).toBe("WARNING");
    expect(opsToCheckStatus("UNHEALTHY")).toBe("FAIL");
    expect(opsToCheckStatus("UNKNOWN")).toBe("UNKNOWN");
    expect(trafficLight("PASS")).toBe("green");
    expect(trafficLight("WARNING")).toBe("yellow");
    expect(trafficLight("FAIL")).toBe("red");
    expect(trafficLight("UNKNOWN")).toBe("gray");
  });

  it("sectionOf rolls up to the worst contained check", () => {
    const s = sectionOf("x", "X", [
      { id: "a", name: "a", status: "PASS", detail: "" },
      { id: "b", name: "b", status: "WARNING", detail: "" },
    ]);
    expect(s.status).toBe("WARNING");
  });
});

describe("HTTP response classification", () => {
  it("no response is FAIL with the transport error preserved", () => {
    expect(classifyHttpResponse(undefined, "timeout after 4000ms")).toEqual({ status: "FAIL", note: "no response (timeout after 4000ms)" });
  });
  it("2xx passes; 401/403 warn (auth); 404 fails as wrong path; 5xx fails", () => {
    expect(classifyHttpResponse(200).status).toBe("PASS");
    expect(classifyHttpResponse(401).status).toBe("WARNING");
    expect(classifyHttpResponse(403).status).toBe("WARNING");
    expect(classifyHttpResponse(404).status).toBe("FAIL");
    expect(classifyHttpResponse(404).note).toContain("wrong subpath");
    expect(classifyHttpResponse(405).status).toBe("WARNING");
    expect(classifyHttpResponse(500).status).toBe("FAIL");
    expect(classifyHttpResponse(418).status).toBe("WARNING");
  });
});

describe("configured-URL misconfiguration detection", () => {
  it("empty / unparseable / bad scheme / embedded credentials", () => {
    expect(analyzeConfiguredUrl("", { role: "OHIF" })[0].code).toBe("EMPTY");
    expect(analyzeConfiguredUrl("not a url", { role: "OHIF" })[0].code).toBe("UNPARSEABLE");
    expect(analyzeConfiguredUrl("ftp://x.example", { role: "OHIF" }).some((i) => i.code === "BAD_SCHEME")).toBe(true);
    expect(analyzeConfiguredUrl("http://user:pass@host:3010", { role: "OHIF" }).some((i) => i.code === "EMBEDDED_CREDENTIALS")).toBe(true);
  });

  it("Docker bridge IPs are flagged; the clinic's real 172.16.1.x LAN is not", () => {
    expect(analyzeConfiguredUrl("http://172.18.0.5:3010", { role: "OHIF" }).some((i) => i.code === "DOCKER_BRIDGE_IP")).toBe(true);
    expect(analyzeConfiguredUrl("http://172.16.1.139:3010", { role: "OHIF" }).some((i) => i.code === "DOCKER_BRIDGE_IP")).toBe(false);
  });

  it("localhost, mixed content, placeholders and doubled slashes", () => {
    expect(analyzeConfiguredUrl("http://localhost:3010", { role: "OHIF" }).some((i) => i.code === "LOCALHOST_ONLY")).toBe(true);
    expect(analyzeConfiguredUrl("http://192.168.1.10:3010", { role: "OHIF", erpServedHttps: true }).some((i) => i.code === "MIXED_CONTENT")).toBe(true);
    expect(analyzeConfiguredUrl("http://192.168.1.10:3010", { role: "OHIF", erpServedHttps: false }).some((i) => i.code === "MIXED_CONTENT")).toBe(false);
    expect(analyzeConfiguredUrl("https://YOUR_DOMAIN.replit.app", { role: "ERP" }).some((i) => i.code === "PLACEHOLDER")).toBe(true);
    expect(analyzeConfiguredUrl("https://pacs.clinic.com/erp//ohif", { role: "OHIF" }).some((i) => i.code === "DOUBLE_SLASH_PATH")).toBe(true);
  });

  it("a clean URL yields no issues and every issue carries a fix", () => {
    expect(analyzeConfiguredUrl("https://ohif.clinic.example/viewer", { role: "OHIF" })).toEqual([]);
    for (const issue of analyzeConfiguredUrl("http://user:p@172.18.0.5//x", { role: "OHIF", erpServedHttps: true })) {
      expect(issue.fix.length, issue.code).toBeGreaterThan(10);
    }
  });
});

describe("redirect loops", () => {
  it("detects revisits (trailing slashes normalized) and passes clean chains", () => {
    expect(redirectLoopVerdict(["http://a/", "http://b", "http://a"]).loop).toBe(true);
    expect(redirectLoopVerdict(["http://a", "http://b", "http://c"]).loop).toBe(false);
    expect(redirectLoopVerdict([]).loop).toBe(false);
  });
});

describe("CORS verdicts", () => {
  it("same-origin needs no CORS; wildcard and exact-match pass", () => {
    expect(corsVerdict({ viewerOrigin: "http://x:3010", dicomWebOrigin: "http://x:3010", allowOrigin: null }).status).toBe("PASS");
    expect(corsVerdict({ viewerOrigin: "http://x:3010", dicomWebOrigin: "http://y:8042", allowOrigin: "*" }).status).toBe("PASS");
    expect(corsVerdict({ viewerOrigin: "http://x:3010", dicomWebOrigin: "http://y:8042", allowOrigin: "http://x:3010" }).status).toBe("PASS");
  });
  it("missing or mismatched ACAO fails with the blank-study symptom named", () => {
    const missing = corsVerdict({ viewerOrigin: "http://x:3010", dicomWebOrigin: "http://y:8042", allowOrigin: null });
    expect(missing.status).toBe("FAIL");
    expect(missing.note).toContain("blank study");
    expect(corsVerdict({ viewerOrigin: "http://x:3010", dicomWebOrigin: "http://y:8042", allowOrigin: "http://z:1" }).status).toBe("FAIL");
  });
  it("unconfigured endpoints are UNKNOWN, not fake passes", () => {
    expect(corsVerdict({ viewerOrigin: null, dicomWebOrigin: "http://y", allowOrigin: null }).status).toBe("UNKNOWN");
  });
});

describe("TLS certificate verdicts", () => {
  it("expired fails, expiring-soon warns, healthy passes, missing is UNKNOWN", () => {
    expect(certVerdict({ validTo: new Date("2026-07-01T00:00:00Z"), now: NOW }).status).toBe("FAIL");
    expect(certVerdict({ validTo: new Date("2026-07-20T00:00:00Z"), now: NOW }).status).toBe("WARNING");
    expect(certVerdict({ validTo: new Date("2027-07-11T00:00:00Z"), now: NOW }).status).toBe("PASS");
    expect(certVerdict({ validTo: null, now: NOW }).status).toBe("UNKNOWN");
    expect(certVerdict({ validFrom: new Date("2026-08-01T00:00:00Z"), validTo: new Date("2027-08-01T00:00:00Z"), now: NOW }).status).toBe("FAIL");
  });
});

describe("settings verification (Phase 9)", () => {
  it("registry keys are unique per key and every deprecated key names its note", () => {
    const keys = KNOWN_PACS_SETTINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of KNOWN_PACS_SETTINGS) {
      if (d.deprecated) expect(d.deprecated.note.length).toBeGreaterThan(5);
    }
  });

  it("clean canonical settings produce no findings", () => {
    const findings = classifySettings([
      { key: "ohif_base_url", category: "viewer", value: "http://192.168.1.137:3010" },
      { key: "orthanc_ip", category: "orthanc", value: "192.168.1.137" },
    ]);
    expect(findings).toEqual([]);
  });

  it("unknown keys are reported as orphaned with a review-only recommendation (never auto-deleted)", () => {
    const findings = classifySettings([
      { key: "ohif_base_url", category: "viewer", value: "http://a:1" },
      { key: "old_experiment_toggle", category: "general", value: "1" },
    ]);
    const orphan = findings.find((f) => f.kind === "unknown");
    expect(orphan?.key).toBe("old_experiment_toggle");
    expect(orphan?.recommendation).toContain("NOT deleted automatically");
  });

  it("duplicates across categories are flagged, naming the authoritative category", () => {
    const findings = classifySettings([
      { key: "ohif_base_url", category: "viewer", value: "http://a:1" },
      { key: "ohif_base_url", category: "general", value: "http://b:2" },
    ]);
    const dup = findings.find((f) => f.kind === "duplicate");
    expect(dup?.message).toContain("DIFFERENT values");
    expect(dup?.recommendation).toContain('"viewer"');
    // and the misplaced row is a conflict (readers cannot see it)
    expect(findings.some((f) => f.kind === "conflict" && f.category === "general")).toBe(true);
  });

  it("deprecated + shadowed legacy keys (wado_uri_base_url, public_pacs_host)", () => {
    const findings = classifySettings([
      { key: "wado_uri_base_url", category: "viewer", value: "http://old:8042/wado" },
      { key: "weasis_wado_url", category: "viewer", value: "http://new:8042/wado" },
      { key: "public_pacs_host", category: "viewer", value: "pacs.clinic.com" },
      { key: "ohif_base_url_public", category: "viewer", value: "https://pacs.clinic.com/ohif" },
      { key: "ohif_base_url", category: "viewer", value: "http://a:1" },
    ]);
    expect(findings.filter((f) => f.kind === "deprecated").map((f) => f.key).sort())
      .toEqual(["public_pacs_host", "wado_uri_base_url"]);
    expect(findings.filter((f) => f.kind === "shadowed").map((f) => f.key).sort())
      .toEqual(["public_pacs_host", "wado_uri_base_url"]);
  });

  it("out-of-range numerics, bad enums and invalid URLs are invalid_value", () => {
    const findings = classifySettings([
      { key: "ohif_base_url", category: "viewer", value: "http://a:1" },
      { key: "viewer_probe_timeout_ms", category: "viewer", value: "999999" },
      { key: "viewer_network_mode", category: "viewer", value: "WIFI" },
      { key: "orthanc_dicomweb_url", category: "orthanc", value: "not-a-url" },
    ]);
    expect(findings.filter((f) => f.kind === "invalid_value").map((f) => f.key).sort())
      .toEqual(["orthanc_dicomweb_url", "viewer_network_mode", "viewer_probe_timeout_ms"]);
  });

  it("env divergence is a conflict and missing recommended keys warn", () => {
    const conflict = classifySettings(
      [{ key: "ohif_base_url", category: "viewer", value: "http://a:1" }],
      { ohifUrlEnv: "http://b:2" },
    );
    expect(conflict.some((f) => f.kind === "conflict" && f.key === "ohif_base_url")).toBe(true);
    const missing = classifySettings([]);
    expect(missing.some((f) => f.kind === "missing" && f.key === "ohif_base_url")).toBe(true);
  });
});

describe("deployment verdict (Phase 8) — never vague", () => {
  const sections = (statusA: "PASS" | "FAIL" | "WARNING" | "UNKNOWN", id: string): DiagnosticSection[] => [
    sectionOf("s", "S", [
      { id, name: "n", status: statusA, detail: "orthanc answered HTTP 502", fix: "restart care-orthanc" },
      { id: "other.ok", name: "ok", status: "PASS", detail: "fine" },
    ]),
  ];

  it("a FAIL on a critical check is BROKEN with a BLOCKER finding", () => {
    const { verdict, findings } = deriveDeploymentVerdict(sections("FAIL", "viewer.orthanc_http"));
    expect(verdict).toBe("BROKEN");
    expect(findings[0]).toEqual({
      severity: "BLOCKER",
      where: "viewer.orthanc_http",
      why: "orthanc answered HTTP 502",
      fix: "restart care-orthanc",
    });
  });

  it("a FAIL on a non-critical check degrades but does not break", () => {
    expect(deriveDeploymentVerdict(sections("FAIL", "network.public.tls")).verdict).toBe("DEGRADED");
  });

  it("warnings degrade; all-pass is HEALTHY with zero findings", () => {
    expect(deriveDeploymentVerdict(sections("WARNING", "settings.missing.x")).verdict).toBe("DEGRADED");
    const healthy = deriveDeploymentVerdict(sections("PASS", "viewer.orthanc_http"));
    expect(healthy.verdict).toBe("HEALTHY");
    expect(healthy.findings).toEqual([]);
  });

  it("UNKNOWN on a critical check degrades (never verified ≠ healthy); elsewhere it is tolerated", () => {
    expect(deriveDeploymentVerdict(sections("UNKNOWN", "viewer.dicomweb_qido")).verdict).toBe("DEGRADED");
    expect(deriveDeploymentVerdict(sections("UNKNOWN", "workflow.amendment")).verdict).toBe("HEALTHY");
  });

  it("every finding has non-empty where/why/fix (the 'never vague' contract)", () => {
    const { findings } = deriveDeploymentVerdict([
      sectionOf("s", "S", [
        { id: "a.b", name: "n", status: "FAIL", detail: "broke" }, // no fix given
      ]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].where.length).toBeGreaterThan(0);
    expect(findings[0].why.length).toBeGreaterThan(0);
    expect(findings[0].fix.length).toBeGreaterThan(10); // fallback fix text, still actionable
  });
});
