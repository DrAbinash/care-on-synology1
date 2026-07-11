import { describe, it, expect } from "vitest";
import {
  checkToText, countByStatus, exportFileName, reportToMarkdown, trafficLight,
  type DeploymentReport,
} from "./flightDeckReport";

// Ticket M1.3 — pure presentation/export helpers for the Flight Deck page.

const REPORT: DeploymentReport = {
  generatedAt: "2026-07-11T10:15:30.123Z",
  verdict: "DEGRADED",
  findings: [
    { severity: "BLOCKER", where: "viewer.orthanc_http", why: "HTTP 502", fix: "restart care-orthanc" },
    { severity: "WARNING", where: "network.public.tls", why: "expires in 3 days", fix: "renew the certificate" },
  ],
  sections: [
    {
      id: "viewer",
      title: "Viewer & DICOMweb",
      status: "FAIL",
      checks: [
        { id: "viewer.orthanc_http", name: "Orthanc REST API", status: "FAIL", detail: "HTTP 502", fix: "restart care-orthanc", endpoint: "http://care-orthanc:8042/system", httpStatus: 502, latencyMs: 12 },
        { id: "viewer.launch_url", name: "Viewer launch URL", status: "PASS", detail: "builds cleanly" },
      ],
    },
    {
      id: "settings",
      title: "Settings verification",
      status: "WARNING",
      checks: [
        { id: "settings.unknown.old_key", name: "Setting — old_key", status: "WARNING", detail: "orphaned", fix: "review manually" },
        { id: "settings.registry", name: "Settings registry", status: "PASS", detail: "checked" },
        { id: "settings.x", name: "x", status: "UNKNOWN", detail: "?" },
      ],
    },
  ],
  version: { app: "1.0.0", commit: "abcd1234" },
};

describe("traffic lights + counts", () => {
  it("maps statuses to the fixed green/yellow/red/gray palette", () => {
    expect(trafficLight("PASS")).toBe("green");
    expect(trafficLight("WARNING")).toBe("yellow");
    expect(trafficLight("FAIL")).toBe("red");
    expect(trafficLight("UNKNOWN")).toBe("gray");
  });

  it("counts every check across sections", () => {
    expect(countByStatus(REPORT.sections)).toEqual({ PASS: 2, WARNING: 1, FAIL: 1, UNKNOWN: 1 });
  });
});

describe("markdown export", () => {
  const md = reportToMarkdown(REPORT);

  it("carries verdict, version, findings with why+fix, and every check", () => {
    expect(md).toContain("# CARE Radiology — Deployment Diagnostics");
    expect(md).toContain("Verdict: **DEGRADED**");
    expect(md).toContain("Version: 1.0.0 (abcd1234)");
    expect(md).toContain("**BLOCKER** `viewer.orthanc_http`");
    expect(md).toContain("Fix: restart care-orthanc");
    expect(md).toContain("## Viewer & DICOMweb — FAIL");
    expect(md).toContain("🔴 **Orthanc REST API**");
    expect(md).toContain("Endpoint: http://care-orthanc:8042/system");
    expect(md).toContain("Latency: 12ms · HTTP 502");
    expect(md).toContain("🟢 **Viewer launch URL**");
    expect(md).toContain("⚪ **x**");
  });

  it("is deterministic for identical input", () => {
    expect(reportToMarkdown(REPORT)).toBe(md);
  });

  it("says explicitly when there is nothing to fix", () => {
    const clean = reportToMarkdown({ ...REPORT, findings: [] });
    expect(clean).toContain("No blockers or warnings — all checks passed.");
  });
});

describe("per-check copy text + export filenames", () => {
  it("checkToText includes status, id, detail, endpoint and fix", () => {
    const text = checkToText(REPORT.sections[0].checks[0]);
    expect(text).toContain("[FAIL] viewer.orthanc_http — Orthanc REST API: HTTP 502");
    expect(text).toContain("endpoint: http://care-orthanc:8042/system");
    expect(text).toContain("fix: restart care-orthanc");
  });

  it("filenames are timestamped and extension-correct", () => {
    expect(exportFileName("json", REPORT.generatedAt)).toBe("radiology-diagnostics_2026-07-11_10-15-30.json");
    expect(exportFileName("md", REPORT.generatedAt)).toBe("radiology-diagnostics_2026-07-11_10-15-30.md");
  });
});
