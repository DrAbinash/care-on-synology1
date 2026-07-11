import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D8 — PACS archive surface: the encapsulated-PDF export must archive
// the LATEST signed version by default, label the DICOM series with the
// delivered revision, and keep an auditable requested-vs-delivered record.

let studyRow: Record<string, unknown> | null;
let reportRow: Record<string, unknown> | null;
let auditInserts: Record<string, unknown>[];
let studyUpdates: Record<string, unknown>[];
let fetchCalls: { url: string; body: Record<string, unknown> }[];

vi.mock("@workspace/db/schema", () => ({
  radiologyStudiesTable: { __name: "radiology_studies" },
  patientsTable: { __name: "patients" },
  patientReportsTable: { __name: "patient_reports" },
  radiologyAuditLogTable: { __name: "radiology_audit_log" },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { __name?: string }) => ({
        where: () => ({
          limit: async () => {
            if (tbl?.__name === "radiology_studies") return studyRow ? [studyRow] : [];
            if (tbl?.__name === "patients") return [{ id: 12, firstName: "Asha", lastName: "P", patientId: "PAT-1", gender: "F", dateOfBirth: null }];
            if (tbl?.__name === "patient_reports") return reportRow ? [reportRow] : [];
            return [];
          },
        }),
      }),
    }),
    insert: (tbl: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (tbl?.__name === "radiology_audit_log") auditInserts.push(v);
        return { catch: () => undefined, then: (r: (x: unknown) => void) => r(undefined) };
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { studyUpdates.push(v); } }) }),
  },
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        pdf: async () => Buffer.from("PDFBYTES"),
      }),
      close: async () => undefined,
    }),
  },
}));

vi.mock("./logger.js", () => {
  const noop = { info: () => undefined, error: () => undefined, warn: () => undefined };
  return { logger: noop };
});

vi.mock("./pacs/pacsConfig", () => ({
  getRadiologyConfig: async () => ({ orthanc: { dicomWebUrl: "http://orthanc:8042/dicom-web" } }),
}));

const buildReportArtifactMock = vi.fn();
vi.mock("../routes/patient-reports.js", () => ({
  buildReportArtifact: (...args: unknown[]) => buildReportArtifactMock(...args),
}));

import { archiveReportToPacs } from "./pacsArchive";

function versionResult(overrides: Record<string, unknown> = {}) {
  return {
    requestedReportId: 900, resolvedReportId: 909, rootReportId: 900, latestReportId: 909,
    sequenceNumber: 2, totalVersions: 2, superseded: false, resolvedSuperseded: false,
    amendmentReason: "laterality corrected", latestAmendmentReason: "laterality corrected",
    resolutionReason: "resolved_to_latest", warnings: [],
    resolvedReport: { id: 909, reportNumber: "RPT-A1" },
    ...overrides,
  };
}

beforeEach(() => {
  studyRow = {
    id: 55, patientId: 12, accessionNumber: "ACC-1", modality: "MRI",
    studyInstanceUid: "1.2.3", studyDate: "2026-07-10", referringDoctor: "Dr. M",
    finalReport: null, prelimReport: null,
  };
  reportRow = { id: 900, reportNumber: "RPT-ROOT" };
  auditInserts = [];
  studyUpdates = [];
  fetchCalls = [];
  buildReportArtifactMock.mockReset();
  global.fetch = (async (url: string, init: { body: string }) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ID: "orthanc-1", Path: "/instances/orthanc-1" }) };
  }) as unknown as typeof fetch;
});

describe("D8 — PACS archives the latest signed version", () => {
  test("default archive resolves to latest; series labeled with the revision; audit records requested vs delivered", async () => {
    buildReportArtifactMock.mockResolvedValue({ html: "<html>AMENDED</html>", version: versionResult() });
    const result = await archiveReportToPacs(55);
    expect(result.success).toBe(true);

    // buildReportArtifact was asked for the PACS surface with default (latest) policy.
    expect(buildReportArtifactMock).toHaveBeenCalledWith(900, { surface: "pacs", versionMode: undefined });

    // DICOM series description states the delivered revision.
    const created = fetchCalls.find((c) => c.url.includes("/tools/create-dicom"));
    expect(created).toBeTruthy();
    const tags = (created!.body as { Tags: Record<string, string> }).Tags;
    expect(tags.SeriesDescription).toBe("Radiology Report PDF v2/2 (amended)");

    // Auditable requested-vs-delivered record on the success entry.
    const success = auditInserts.find((a) => a.action === "ORTHANC_UPLOAD_SUCCESS");
    expect(success).toBeTruthy();
    const details = JSON.parse(String(success!.details));
    expect(details).toMatchObject({ requestedReportId: 900, deliveredReportId: 909, reportVersion: "2/2", superseded: false });
  });

  test("explicit historical archive is labeled SUPERSEDED", async () => {
    buildReportArtifactMock.mockResolvedValue({
      html: "<html>OLD</html>",
      version: versionResult({ resolvedReportId: 900, sequenceNumber: 1, resolvedSuperseded: true, resolutionReason: "explicit_specific", resolvedReport: { id: 900, reportNumber: "RPT-ROOT" } }),
    });
    const result = await archiveReportToPacs(55, { versionMode: "specific" });
    expect(result.success).toBe(true);
    expect(buildReportArtifactMock).toHaveBeenCalledWith(900, { surface: "pacs", versionMode: "specific" });
    const tags = (fetchCalls[0].body as { Tags: Record<string, string> }).Tags;
    expect(tags.SeriesDescription).toBe("Radiology Report PDF v1/2 SUPERSEDED");
    const details = JSON.parse(String(auditInserts.find((a) => a.action === "ORTHANC_UPLOAD_SUCCESS")!.details));
    expect(details.superseded).toBe(true);
  });

  test("single-version report keeps the plain series description", async () => {
    buildReportArtifactMock.mockResolvedValue({
      html: "<html>ONLY</html>",
      version: versionResult({ resolvedReportId: 900, sequenceNumber: 1, totalVersions: 1, resolutionReason: "no_chain", amendmentReason: null, resolvedReport: { id: 900, reportNumber: "RPT-ROOT" } }),
    });
    await archiveReportToPacs(55);
    const tags = (fetchCalls[0].body as { Tags: Record<string, string> }).Tags;
    expect(tags.SeriesDescription).toBe("Radiology Report PDF");
  });
});
