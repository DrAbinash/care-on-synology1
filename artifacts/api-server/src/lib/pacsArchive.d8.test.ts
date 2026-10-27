import { describe, expect, test, vi, beforeEach } from "vitest";

// Ticket D8 — PACS archive surface: the encapsulated-PDF export must archive
// the LATEST signed version by default, label the DICOM series with the
// delivered revision, and keep an auditable requested-vs-delivered record.

let studyRow: Record<string, unknown> | null;
let reportRow: Record<string, unknown> | null;
let auditInserts: Record<string, unknown>[];
let studyUpdates: Record<string, unknown>[];
let revisionInserts: Record<string, unknown>[];
let fetchCalls: { url: string; body: Record<string, unknown> }[];

vi.mock("@workspace/db/schema", () => ({
  radiologyStudiesTable: { __name: "radiology_studies" },
  radiologyWorklistTable: { __name: "radiology_worklist" },
  patientsTable: { __name: "patients" },
  patientReportsTable: { __name: "patient_reports" },
  radiologyAuditLogTable: { __name: "radiology_audit_log" },
  // BEND-1 — per-revision archive records written alongside the study columns.
  radiologyPacsArchiveRevisionsTable: { __name: "radiology_pacs_archive_revisions", reportId: "report_id" },
}));

// DECISION 5 — the archive now takes a PostgreSQL advisory lock before it does anything. This mocked
// file grants the lock so its version-resolution cases can still reach the upload.
vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({
      query: async () => ({ rows: [{ locked: true }] }),
      release: () => undefined,
    }),
  },
  db: {
    select: () => ({
      from: (tbl: { __name?: string }) => ({
        // The real builder is awaitable AND chainable: `.where(c)`, `.where(c).limit(1)` and
        // `.where(c).orderBy(x).limit(1)` are all legal terminations, and the archive's report pick
        // uses the last two (a bare await for every worklist row bound to the study, `.limit(1)`
        // for the deterministic newest report). One shape answers all three.
        where: () => {
          const rows = () => {
            if (tbl?.__name === "radiology_studies") return studyRow ? [studyRow] : [];
            if (tbl?.__name === "radiology_worklist") return [{ id: 3629 }];
            if (tbl?.__name === "patients") return [{ id: 12, firstName: "Asha", lastName: "P", patientId: "PAT-1", gender: "F", dateOfBirth: null }];
            if (tbl?.__name === "patient_reports") return reportRow ? [reportRow] : [];
            return [];
          };
          // NOTE: `where` discards its argument. That is why this file cannot prove association
          // safety in either direction — pacsArchive.reportScope.request.test.ts runs the same pick
          // against PostgreSQL, where the predicate is what is actually under test.
          const chain: Record<string, unknown> = {
            then: (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(rows()).then(onFulfilled),
            limit: () => Promise.resolve(rows()),
          };
          chain.orderBy = () => chain;
          return chain;
        },
      }),
    }),
    insert: (tbl: { __name?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (tbl?.__name === "radiology_audit_log") auditInserts.push(v);
        if (tbl?.__name === "radiology_pacs_archive_revisions") revisionInserts.push(v);
        const thenable = { catch: () => undefined, then: (r: (x: unknown) => void) => r(undefined) };
        // BEND-1 — the revisions upsert chains onConflictDoUpdate/DoNothing.
        return { ...thenable, onConflictDoUpdate: () => thenable, onConflictDoNothing: () => thenable };
      },
    }),
    update: (tbl: { __name?: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => { if (tbl?.__name !== "radiology_pacs_archive_revisions") studyUpdates.push(v); },
      }),
    }),
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
  reportRow = {
    id: 900,
    reportNumber: "RPT-ROOT",
    // DECISION 1 reads the row's finality facts, so the mock carries what the schema has. Without
    // these two columns every archive in this file would correctly refuse, and the cases below would
    // prove nothing about version resolution.
    status: "final",
    signedAt: new Date(),
  };
  auditInserts = [];
  studyUpdates = [];
  revisionInserts = [];
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

  test("an explicitly historical (superseded) revision is refused, never filed as current", async () => {
    // DECISION 1, reusing usgPacsReturnPolicy's own `superseded_report` block. Before it, `specific`
    // mode archived a superseded row with a SUPERSEDED series label; a labelled wrong-version document
    // in the image archive is still a wrong-version document in the image archive. Nothing in the
    // product passes versionMode today — every caller uses the default — so this refusal closes a
    // reachable-only-by-code path, and the label it replaces is still asserted where the row IS the
    // delivered revision (the case above).
    buildReportArtifactMock.mockResolvedValue({
      html: "<html>OLD</html>",
      version: versionResult({ resolvedReportId: 900, sequenceNumber: 1, resolvedSuperseded: true, resolutionReason: "explicit_specific", resolvedReport: { id: 900, reportNumber: "RPT-ROOT" } }),
    });
    const result = await archiveReportToPacs(55, { versionMode: "specific" });
    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.blockReasons).toContain("superseded_report");
    expect(fetchCalls).toHaveLength(0);
    expect(revisionInserts).toHaveLength(0);
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
