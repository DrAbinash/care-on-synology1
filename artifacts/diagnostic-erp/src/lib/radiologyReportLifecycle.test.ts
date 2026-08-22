import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizeRadiologyReport } from "./radiologyReportLifecycle";
import { api } from "./fetchApi";

vi.mock("./fetchApi", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

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

  it("reports a clear reason when no active signature exists at all", async () => {
    mockSignatures = [{ id: 1, name: "Dr. Retired", isActive: false }];
    mockHappyReportCreation();
    const result = await finalizeRadiologyReport({ patientId: 2, studyId: 1, worklistId: 1 }, CONTENT);
    expect(result.signed).toBe(false);
    expect(result.signError).toMatch(/no active signature/i);
  });
});
