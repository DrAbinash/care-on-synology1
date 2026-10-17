import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizeRadiologyReport, isFinalizeCompletion } from "./radiologyReportLifecycle";
import { api } from "./fetchApi";

// Keep the real HttpError/NetworkError classes: the module under test decides
// whether a failed create is worth recovering from by testing `instanceof`
// against them, so a mock that omitted them would make any thrown create error
// surface as a confusing "export is defined on the mock" failure instead.
vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

const CONTENT = {
  title: "MRI SPINE",
  htmlBody: "<p>Findings</p>",
  impression: ["No acute abnormality."],
  isCritical: false,
  criticalNote: null,
  createdBy: "Dr. Test",
  actor: "Dr. Test",
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

// R1.4 review finding: no patient at all (an unmatched DICOM study) used to
// leave reportCreationSkipped unset, so callers fell into the generic
// signing-failed toast instead of the true "no patient linked" reason.
describe("finalizeRadiologyReport — no patient linked", () => {
  it("skips report creation with an explicit reason instead of silently attempting to sign nothing", async () => {
    mockPost.mockResolvedValueOnce(undefined); // report-status flip
    const result = await finalizeRadiologyReport({ patientId: null, studyId: 1 }, CONTENT);
    expect(result.reportId).toBeNull();
    expect(result.reportCreationSkipped).toBe("no patient is linked to this study");
    expect(result.signed).toBe(false);
    expect(result.signError).toBeNull();
    // No from-study prefill, no report creation, no sign attempt — only the
    // worklist status-flip call.
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/api/internal/radiology/report-status", expect.any(Object));
  });
});

// R1.4 review finding: auto-signing must never guess an identity when the
// signer is ambiguous (2+ active signatures — a locum or a growing
// practice) — it must decline with a clear, actionable reason instead.
describe("finalizeRadiologyReport — auto-sign identity safety", () => {
  function mockHappyReportCreation() {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/patient-reports/from-study/")) {
        return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
      }
      if (path === "/api/signatures") {
        return mockSignatures;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    mockPost.mockImplementation(async (path: string) => {
      if (path === "/api/patient-reports") return { id: 99 };
      if (path.endsWith("/sign")) return { ok: true };
      if (path === "/api/internal/radiology/report-status") return undefined;
      throw new Error(`unexpected POST ${path}`);
    });
  }

  let mockSignatures: Array<{ id: number; name: string; isActive: boolean }> = [];

  it("auto-signs when exactly one active signature exists (the single-radiologist baseline)", async () => {
    mockSignatures = [{ id: 1, name: "Dr. Sugandha", isActive: true }];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(true);
    expect(result.signError).toBeNull();
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/sign", { signatureId: 1 });
    expect(mockPost).toHaveBeenCalledWith("/api/internal/radiology/report-status", expect.objectContaining({ worklistId: 1 }));
  });

  it("auto-signs as Dr. Sugandha when she is among several active signatures", async () => {
    mockSignatures = [
      { id: 1, name: "Dr. Asha Rao", isActive: true },
      { id: 2, name: "Dr. Sugandha Priyadarshini", isActive: true },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(true);
    expect(result.signError).toBeNull();
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/sign", { signatureId: 2 });
  });

  it("declines to auto-sign when 2+ active signatures exist and none is the clinic radiologist", async () => {
    mockSignatures = [
      { id: 1, name: "Dr. Asha Rao", isActive: true },
      { id: 2, name: "Dr. Locum", isActive: true },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(false);
    expect(result.signError).toMatch(/more than one active signature/i);
    // Never called /sign with a guessed signatureId.
    expect(mockPost).not.toHaveBeenCalledWith(expect.stringMatching(/\/sign$/), expect.anything());
  });

  it("marks the linked worklist row REPORT_FINAL as well as the primary study", async () => {
    mockSignatures = [{ id: 1, name: "Dr. Sugandha", isActive: true }];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport(
      {
        patientId: 2,
        studyId: 1,
        worklistId: 1,
        linkedStudyId: 44,
        linkedAccessionNumber: "ACC-44",
        linkedStudyInstanceUID: "1.2.3",
      },
      CONTENT,
    );
    expect(result.linkedMarkedFinal).toBe(true);
    expect(result.linkedMarkError).toBeNull();
    expect(mockPost).toHaveBeenCalledWith(
      "/api/internal/radiology/report-status",
      expect.objectContaining({ worklistId: 1, status: "REPORT_FINAL" }),
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/api/internal/radiology/report-status",
      expect.objectContaining({ worklistId: 44, status: "REPORT_FINAL", accessionNumber: "ACC-44" }),
    );
  });

  it("reports a clear reason when no active signature exists at all", async () => {
    mockSignatures = [{ id: 1, name: "Dr. Retired", isActive: false }];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(false);
    expect(result.signError).toMatch(/no active signature/i);
  });
});

// P0 — "the call returned" is not "the study was finalized".
//
// Reproduced against real PostgreSQL on the synthetic fixture: a CT row with a
// linked patient whose billed test could not be resolved created no report row
// and sent no status flip, yet the workspace locked the editors, deleted both
// local backups, removed the study from the queue and advanced to the next row —
// while that row's own queue entry still read `{status: "STUDY_RECEIVED",
// reportId: null}`. The lifecycle was truthful; the caller had no field to be
// truthful about. These pin the two that now exist.
describe("finalizeRadiologyReport — what a completion actually is", () => {
  it("sends NO status flip when a patient-linked study's billed test cannot be resolved", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/patient-reports/from-study/")) {
        return { patientId: 2, testId: null, orderTestId: null, orderId: null, billId: null };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    mockPost.mockImplementation(async (path: string) => {
      throw new Error(`unexpected POST ${path}`);
    });

    const result = await finalizeRadiologyReport(
      { patientId: 2, studyId: 303, worklistId: 4, accessionNumber: "ACC-C3-4" },
      CONTENT,
    );

    expect(result.reportId).toBeNull();
    expect(result.reportCreationSkipped).toMatch(/billed test could not be resolved/);
    expect(result.reportStatusSent).toBe(false);
    expect(isFinalizeCompletion(result)).toBe(false);
    // Nothing ran after the failed prefill: no create, no sign, no flip. The
    // study is exactly where it was, and the caller must leave it there.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("still soft-finals a study with no patient linked, and that IS a completion", async () => {
    mockPost.mockResolvedValueOnce(undefined);
    const result = await finalizeRadiologyReport(
      { patientId: null, studyId: null, worklistId: 4 },
      CONTENT,
    );
    expect(result.reportStatusSent).toBe(true);
    expect(isFinalizeCompletion(result)).toBe(true);
  });

  it("binds the report row to the worklist ROW id while resolving the test from the BILLED study id", async () => {
    // The two ids live in different sequences and overlap by design, which is
    // why the workspace's route param must never be sent as the billed study id:
    // GET /api/patient-reports/from-study/:id is keyed on radiology_studies.id
    // and answers with whichever study shares the number — its patient, its
    // test, its order, its bill.
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/patient-reports/from-study/")) {
        expect(path).toBe("/api/patient-reports/from-study/303");
        return { patientId: 2, testId: 10, orderTestId: 20, orderId: 30, billId: 40 };
      }
      if (path === "/api/signatures") return [{ id: 1, name: "Dr. Sugandha", isActive: true }];
      throw new Error(`unexpected GET ${path}`);
    });
    mockPost.mockImplementation(async (path: string, body: unknown) => {
      if (path === "/api/patient-reports") return { id: 99 };
      if (path.endsWith("/sign")) return { ok: true };
      if (path === "/api/internal/radiology/report-status") return undefined;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });

    const result = await finalizeRadiologyReport(
      { patientId: 2, studyId: 303, worklistId: 4, accessionNumber: "ACC-C3-4" },
      CONTENT,
    );

    expect(mockPost).toHaveBeenCalledWith(
      "/api/patient-reports",
      expect.objectContaining({ studyId: 4, testId: 10, orderId: 30 }),
    );
    expect(result.reportStatusSent).toBe(true);
    expect(isFinalizeCompletion(result)).toBe(true);
  });

  it("still attempts auto-link for a patient-linked row that has no billed study id yet", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/patient-reports/from-study/")) {
        expect(path).toBe("/api/patient-reports/from-study/555");
        return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
      }
      if (path === "/api/signatures") return [{ id: 1, name: "Dr. Sugandha", isActive: true }];
      throw new Error(`unexpected GET ${path}`);
    });
    mockPost.mockImplementation(async (path: string) => {
      if (path.endsWith("/auto-link-billed-study")) return { success: true, studyId: 555 };
      if (path === "/api/patient-reports") return { id: 99 };
      if (path.endsWith("/sign")) return { ok: true };
      if (path === "/api/internal/radiology/report-status") return undefined;
      throw new Error(`unexpected POST ${path}`);
    });

    const result = await finalizeRadiologyReport(
      { patientId: 2, studyId: null, worklistId: 4 },
      CONTENT,
    );

    expect(mockPost).toHaveBeenCalledWith("/api/radiology/pacs-worklist/4/auto-link-billed-study", {});
    expect(result.reportStatusSent).toBe(true);
    expect(isFinalizeCompletion(result)).toBe(true);
  });
});
