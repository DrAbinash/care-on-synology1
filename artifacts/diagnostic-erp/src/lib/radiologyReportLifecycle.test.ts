import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizeRadiologyReport, isFinalizeCompletion, loadSignerOfRecord, recordedSignerForReport } from "./radiologyReportLifecycle";
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

  let mockSignatures: Array<{ id: number; name: string; role?: string | null; isActive: boolean }> = [];

  it("auto-signs when exactly one active signature exists (the single-radiologist baseline)", async () => {
    mockSignatures = [{ id: 1, name: "Dr. Sugandha", isActive: true }];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(true);
    expect(result.signError).toBeNull();
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/sign", { signatureId: 1 });
    expect(mockPost).toHaveBeenCalledWith("/api/internal/radiology/report-status", expect.objectContaining({ worklistId: 1 }));
  });

  it("auto-signs the only Radiologist when a referring doctor's block is also active", async () => {
    // The clinic's real shape: the reporting radiologist plus blocks kept for
    // referring doctors. A leftover second signature must not block sign-off — which
    // is why the rule this replaced matched a name. It is now the Role on the record.
    mockSignatures = [
      { id: 1, name: "Dr. Asha Rao", role: "Doctor", isActive: true },
      { id: 2, name: "Dr. Sugandha Priyadarshini", role: "Radiologist", isActive: true },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(true);
    expect(result.signError).toBeNull();
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/sign", { signatureId: 2 });
  });

  it("declines to auto-sign between two radiologists rather than guess an author", async () => {
    // This file used to require the opposite (see the previous test): with two active
    // radiologists it auto-signed the one whose name matched /sugandha/i, which is to
    // say it authorized the second radiologist's report under the first radiologist's
    // identity. Nothing is posted here; the study stays unsigned and the reason says so.
    mockSignatures = [
      { id: 1, name: "Dr. Asha Rao", role: "Radiologist", isActive: true },
      { id: 2, name: "Dr. Sugandha Priyadarshini", role: "Radiologist", isActive: true },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(false);
    expect(result.signError).toMatch(/more than one active signature/i);
    expect(mockPost).not.toHaveBeenCalledWith(expect.stringMatching(/\/sign$/), expect.anything());
  });

  it("signs as the radiologist the dialog chose when two are on file", async () => {
    mockSignatures = [
      { id: 1, name: "Dr. Asha Rao", role: "Radiologist", isActive: true },
      { id: 2, name: "Dr. Sugandha Priyadarshini", role: "Radiologist", isActive: true },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport(
      { patientId: 2, studyId: 1, worklistId: 1 },
      { ...CONTENT, signatureId: 1 },
    );
    expect(result.signed).toBe(true);
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/sign", { signatureId: 1 });
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

  // #134 — the arm that was missing when a Chromium finalize closed a study
  // without signing it: the signer the dialog was shown is not filtered by
  // `isActive` (`GET /api/signatures` answers retired blocks because the admin
  // screen needs them), so a retired block can be the one chosen. The decline
  // must name that, and must not post a signature for it.
  it("declines when the signer chosen in the dialog is not an active block", async () => {
    mockSignatures = [
      { id: 1, name: "Dr. Sugandha Priyadarshini", isActive: true },
      { id: 2, name: "Dr. Retired Locum", isActive: false },
    ];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport(
      { patientId: 2, studyId: 1, worklistId: 1 },
      { ...CONTENT, signatureId: 2 },
    );
    expect(result.signed).toBe(false);
    expect(result.signError).toMatch(/selected signature is not active/i);
    expect(mockPost).not.toHaveBeenCalledWith(expect.stringMatching(/\/sign$/), expect.anything());
  });

  it("marks the linked worklist row REPORT_FINAL as well as the primary study", async () => {    mockSignatures = [{ id: 1, name: "Dr. Sugandha", isActive: true }];
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

// PP-5B — who a printed document may say authorized it.
//
// The report's own record answers, not the printing station. These are the
// states a finalized report, a draft, and a withdrawal actually arrive in,
// against the signature rows `GET /api/signatures` returns.
describe("recordedSignerForReport — the identity a print route may use", () => {
  const SIGNED_AT = "2026-10-19T09:12:00.000Z";
  const BLOCKS = [
    {
      id: 1,
      name: "Dr. Ananya Menon",
      role: "Radiologist",
      isActive: true,
      qualification: "MD (Radiodiagnosis)",
      registrationNo: "REC-4402",
      imageDataUrl: null,
    },
    {
      id: 2,
      name: "Dr. Retired Locum",
      role: "Radiologist",
      isActive: false,
      qualification: "DNB (Radiodiagnosis)",
      registrationNo: "REG-1998",
      imageDataUrl: "data:image/png;base64,AAA=",
    },
  ];

  it("prints the block the report was signed under, qualification and registration number and all", () => {
    expect(
      recordedSignerForReport(
        { id: 7, status: "delivered", signedAt: SIGNED_AT, signedByName: "Dr. Ananya Menon", signatureId: 1 },
        BLOCKS,
      ),
    ).toEqual({
      name: "Dr. Ananya Menon",
      qualification: "MD (Radiodiagnosis)",
      registrationNo: "REC-4402",
      imageDataUrl: null,
    });
  });

  it("uses the block's own name when the row's copy of it is blank", () => {
    const signer = recordedSignerForReport(
      { id: 7, status: "verified", signedAt: SIGNED_AT, signedByName: "   ", signatureId: 1 },
      BLOCKS,
    );
    expect(signer?.name).toBe("Dr. Ananya Menon");
  });

  it("still reads a block that was retired AFTER the report was signed", () => {
    // `isActive` answers who may sign from here on. It cannot rewrite what an
    // older report already said, or withdrawing a signature from the register
    // would silently change every report signed under it.
    expect(
      recordedSignerForReport(
        { id: 8, status: "delivered", signedAt: SIGNED_AT, signedByName: "Dr. Retired Locum", signatureId: 2 },
        BLOCKS,
      ),
    ).toEqual({
      name: "Dr. Retired Locum",
      qualification: "DNB (Radiodiagnosis)",
      registrationNo: "REG-1998",
      imageDataUrl: "data:image/png;base64,AAA=",
    });
  });

  it("prints only the recorded name for a report signed with a staff account and no block", () => {
    // No qualification exists on the record, so none is looked up by name and
    // none is invented: the ability to print a name and designation must not
    // require a handwriting image, and must not fabricate either.
    expect(
      recordedSignerForReport(
        { id: 9, status: "verified", signedAt: SIGNED_AT, signedByName: "Dr. Session Radiologist", signatureId: null },
        BLOCKS,
      ),
    ).toEqual({
      name: "Dr. Session Radiologist",
      qualification: null,
      registrationNo: null,
      imageDataUrl: null,
    });
  });

  it("falls back to the recorded name when the block itself is gone from the table", () => {
    const signer = recordedSignerForReport(
      { id: 10, status: "delivered", signedAt: SIGNED_AT, signedByName: "Dr. Deleted Block", signatureId: 44 },
      BLOCKS,
    );
    expect(signer).toEqual({
      name: "Dr. Deleted Block",
      qualification: null,
      registrationNo: null,
      imageDataUrl: null,
    });
  });

  it("agrees with the badge about a D5-audit signature: signed is signed, and the name it stamped prints", () => {
    // The witness is `rowAlreadySigned`, the same one the status chip and the
    // finalize caption use. If the two drifted, a report the workspace calls
    // signed would print NOT SIGNED.
    const signer = recordedSignerForReport(
      {
        id: 11,
        status: "draft",
        signedAt: null,
        signedByName: "Dr. Structured Signer",
        signatureId: null,
        structuredJson: { audit: { signature: { state: "final" } } },
      },
      BLOCKS,
    );
    expect(signer?.name).toBe("Dr. Structured Signer");
  });

  it("names nobody for a draft, and nobody for a row whose signature was withdrawn", () => {
    const unsigned = { id: 12, status: "draft", signedAt: null, signedByName: null, signatureId: null };
    expect(recordedSignerForReport(unsigned, BLOCKS)).toBeNull();
    // The withdrawal case is this same shape reached from a signed row: the row
    // still exists and is still bound to the study, and the signature columns
    // are what the withdraw route clears. A print after that must not keep
    // printing the name it removed.
    expect(
      recordedSignerForReport(
        { ...unsigned, reportNumber: "RPT-12", version: { superseded: false } },
        BLOCKS,
      ),
    ).toBeNull();
  });

  it("names nobody when the row itself has not been read", () => {
    expect(recordedSignerForReport(null, BLOCKS)).toBeNull();
    expect(recordedSignerForReport(undefined, BLOCKS)).toBeNull();
  });
});

// The print door's read of that record: two calls, one per document, and never
// a guess when the answer is missing.
describe("loadSignerOfRecord — what the export door is allowed to print", () => {
  const BLOCKS = [
    { id: 1, name: "Dr. Ananya Menon", role: "Radiologist", isActive: true, qualification: "MD (Radiodiagnosis)", registrationNo: "REC-4402", imageDataUrl: null },
  ];

  function answers(row: unknown, rows: unknown[] = BLOCKS) {
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/api/signatures") return rows;
      if (path.startsWith("/api/patient-reports/")) return row;
      throw new Error(`unexpected GET ${path}`);
    });
  }

  /**
   * Measured, not inferred: with a page that had no report row behind it, the
   * workspace's Download PDF produced a PDF reading
   * "Dr. Station Alpha MD (Station Default), Reg. No: ALPHA-9" — the signature
   * block sitting in THAT browser's localStorage — and nothing on the page said
   * the report was unsigned. A report no radiologist has signed left the building
   * looking authorized. Reading a missing report id as "not unsigned" was the
   * whole cause; the same page with a report row already printed NOT SIGNED, so
   * two documents of the same legal status printed as two different claims.
   */
  it("a study with no report row behind it is unsigned, and says so", async () => {
    const result = await loadSignerOfRecord(null);
    expect(result).toEqual({ signerOfRecord: null, unsigned: true });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("an absent report id is unsigned too — undefined is not a signature", async () => {
    expect(await loadSignerOfRecord(undefined)).toEqual({ signerOfRecord: null, unsigned: true });
  });

  it("a signed row yields its block, and the door prints that person", async () => {
    answers({ id: 7, status: "delivered", signedAt: "2026-10-19T09:12:00.000Z", signedByName: "Dr. Ananya Menon", signatureId: 1 });
    expect(await loadSignerOfRecord(7)).toEqual({
      signerOfRecord: {
        name: "Dr. Ananya Menon",
        qualification: "MD (Radiodiagnosis)",
        registrationNo: "REC-4402",
        imageDataUrl: null,
      },
      unsigned: false,
    });
  });

  it("a bound row that has not been signed says so instead of falling back to the station", async () => {
    answers({ id: 7, status: "draft", signedAt: null, signedByName: null, signatureId: null });
    expect(await loadSignerOfRecord(7)).toEqual({ signerOfRecord: null, unsigned: true });
  });

  it("a row that cannot be read names nobody — an unchecked signature is not an absent one", async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/api/signatures") return BLOCKS;
      throw new Error("503");
    });
    expect(await loadSignerOfRecord(7)).toEqual({ signerOfRecord: null, unsigned: true });
  });

  it("reads again for the next document, so a signature taken or withdrawn since is reflected", async () => {
    answers({ id: 7, status: "draft", signedAt: null, signedByName: null, signatureId: null });
    expect((await loadSignerOfRecord(7)).unsigned).toBe(true);

    answers({ id: 7, status: "verified", signedAt: "2026-10-20T01:02:03.000Z", signedByName: "Dr. Ananya Menon", signatureId: 1 });
    const second = await loadSignerOfRecord(7);
    expect(second.unsigned).toBe(false);
    expect(second.signerOfRecord?.name).toBe("Dr. Ananya Menon");
  });
});
