/**
 * C2 — a finalize whose signature never happened must not close the study.
 *
 * Measured at request level (`api-server/src/routes/withdrawAndFailedSignIntegrity
 * .request.test.ts`): with the sign leg refused, the stored state came back
 * `worklist.status=REPORT_FINAL | report.status=draft | signed_at NULL` for every
 * refusal this clinic can produce — `signature_not_active` (the signer's only block
 * was deactivated), `signature_not_yours` (the block belongs to a colleague),
 * `role_cannot_sign` (a typist session) — and for the case where no call is made at
 * all (`autoSignReport` declines when no eligible block is on file, or when more than
 * one is). The study then reads as finished, prints an unsigned draft, and cannot be
 * signed from the workspace, because `finalizeDisabled` IS
 * `workflow.currentRow?.status === "REPORT_FINAL"`.
 *
 * The client owns this decision, not the server: `/api/internal/radiology/report-status`
 * legitimately receives a flip for an unsigned row when a caller closes the worklist
 * first and signs after (`finalizeStudyIdAuthority`, `radiologyHardening`,
 * `signedReportWitness`, `signatureWithdrawalReopensStudy` all do exactly that and
 * assert 200), so a server-side rule would refuse those flows rather than this
 * defect. `finalizeRadiologyReport` knows whether its own signature leg succeeded,
 * and is the only place that can tell the two apart.
 *
 * This suite drives the real function with a mocked transport and asserts the
 * REQUESTS IT MAKES. Every "must not have been sent" below is therefore an executed
 * call log, not a grep.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeRadiologyReport,
  isFinalizeCompletion,
  shouldSendReportFinalFlip,
} from "./radiologyReportLifecycle";
import { api, HttpError } from "./fetchApi";

// Real HttpError class, mocked transport only — the same reason the recovery suite
// keeps it: the sign leg's refusal is decided by `err instanceof Error` on this type.
vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

const CONTENT = {
  title: "MRI BRAIN",
  htmlBody: "<p>Findings</p>",
  impression: ["No acute intracranial abnormality."],
  isCritical: false,
  criticalNote: null,
  createdBy: "Dr. Probe",
  actor: "Dr. Probe",
};

const STUDY = { patientId: 2, studyId: 1, worklistId: 1 };
const ONE_BLOCK = [{ id: 1, name: "Dr. Probe", role: "Radiologist", isActive: true }];
const NO_BLOCKS: never[] = [];
const TWO_BLOCKS = [
  { id: 1, name: "Dr. Probe", role: "Radiologist", isActive: true },
  { id: 2, name: "Dr. Locum", role: "Radiologist", isActive: true },
];

let calls: { create: unknown[]; sign: string[]; signBodies: unknown[]; status: unknown[] };

function harness(opts: {
  signatures?: unknown;
  signError?: unknown;
}) {
  calls = { create: [], sign: [], signBodies: [], status: [] };
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/patient-reports/from-study/")) {
      return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
    }
    if (path === "/api/signatures") return opts.signatures ?? ONE_BLOCK;
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: unknown) => {
    if (path === "/api/patient-reports") {
      calls.create.push(body);
      return { id: 14 };
    }
    if (path.endsWith("/sign")) {
      calls.sign.push(path);
      calls.signBodies.push(body);
      if (opts.signError !== undefined) throw opts.signError;
      return { ok: true };
    }
    if (path === "/api/internal/radiology/report-status") {
      calls.status.push(body);
      return undefined;
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

/** The REPORT_FINAL flip bodies only, so a sibling flip cannot hide in the count. */
const finalFlips = () =>
  calls.status.filter((b) => (b as { status?: string }).status === "REPORT_FINAL");

describe("finalizeRadiologyReport — the flip follows the signature (C2)", () => {
  it("C2-1 a signature the server refused does NOT mark the study REPORT_FINAL", async () => {
    // The exact refusal the route answers with when the signer's only block has
    // been deactivated (measured: HTTP 409, body carries `signature_not_active`).
    harness({ signError: new HttpError("signature_not_active", 409, { code: "signature_not_active" }) });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);

    expect(calls.create, "the report row was still created").toHaveLength(1);
    expect(calls.sign, "the sign leg really ran").toEqual(["/api/patient-reports/14/sign"]);
    expect(result.signed).toBe(false);
    expect(result.signError).toBe("signature_not_active");
    expect(
      finalFlips(),
      `the study was closed over an unsigned report — flip bodies: ${JSON.stringify(calls.status)}`,
    ).toHaveLength(0);
    expect(result.reportStatusSent).toBe(false);
    // Nothing downstream may treat this as finished: no backup cleared, no
    // auto-advance, editors stay open so the signing can be fixed and retried.
    expect(isFinalizeCompletion(result)).toBe(false);
  });

  it("C2-2 no signature block on file: the leg is never attempted, and the study stays open", async () => {
    // `autoSignReport` declines without POSTing anything; the swallow is exactly
    // why the flip used to happen anyway.
    harness({ signatures: NO_BLOCKS });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);

    expect(calls.sign).toHaveLength(0);
    expect(result.signed).toBe(false);
    expect(String(result.signError)).toMatch(/No active signature/);
    expect(finalFlips(), JSON.stringify(calls.status)).toHaveLength(0);
    expect(isFinalizeCompletion(result)).toBe(false);
  });

  it("C2-3 two blocks on file (ambiguous signer) keeps the study open too", async () => {
    harness({ signatures: TWO_BLOCKS });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);

    expect(calls.sign, "an ambiguous signer is never guessed").toHaveLength(0);
    expect(String(result.signError)).toMatch(/More than one active signature/);
    expect(finalFlips(), JSON.stringify(calls.status)).toHaveLength(0);
    expect(isFinalizeCompletion(result)).toBe(false);
  });

  it("C2-4 CONTROL: a finalize that signs still closes the study exactly once", async () => {
    harness({});

    const result = await finalizeRadiologyReport(STUDY, CONTENT);

    expect(result.signed).toBe(true);
    expect(finalFlips(), JSON.stringify(calls.status)).toHaveLength(1);
    expect(finalFlips()[0]).toEqual(
      expect.objectContaining({ worklistId: 1, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId: 14 }),
    );
    expect(result.reportStatusSent).toBe(true);
    expect(isFinalizeCompletion(result)).toBe(true);
  });

  it("C2-5 CONTROL: a study with no patient behind it still flips (the documented unbilled path)", async () => {
    harness({});

    const result = await finalizeRadiologyReport({ patientId: null, studyId: 1, worklistId: 1 }, CONTENT);

    expect(result.reportId).toBeNull();
    expect(result.reportCreationSkipped).toBe("no patient is linked to this study");
    expect(finalFlips(), JSON.stringify(calls.status)).toHaveLength(1);
  });

  it("C2-6 a combined report's sibling is not closed when this report never signed", async () => {
    harness({ signatures: NO_BLOCKS });

    const result = await finalizeRadiologyReport({ ...STUDY, linkedStudyId: "77" }, CONTENT);

    expect(
      calls.status,
      `the sibling flip would close a second study over the same unsigned row: ${JSON.stringify(calls.status)}`,
    ).toHaveLength(0);
    expect(result.linkedMarkedFinal).toBe(false);
  });
});

describe("shouldSendReportFinalFlip — the rule in one place", () => {
  const base = {
    reportId: 14,
    patientLinked: true,
    signatureObtained: true,
    resumedWithWorklistAlreadyFinal: false,
  };

  it("closes the study only when the row behind it carries a signature", () => {
    expect(shouldSendReportFinalFlip(base)).toBe(true);
    expect(shouldSendReportFinalFlip({ ...base, signatureObtained: false })).toBe(false);
  });

  it("keeps the unbilled path (no row possible) flipping, and a patient-linked study without a row not flipping", () => {
    expect(shouldSendReportFinalFlip({ ...base, reportId: null, patientLinked: false })).toBe(true);
    expect(shouldSendReportFinalFlip({ ...base, reportId: null, patientLinked: true })).toBe(false);
  });

  it("never re-sends the flip for a study the server already reports final", () => {
    expect(
      shouldSendReportFinalFlip({ ...base, resumedWithWorklistAlreadyFinal: true, signatureObtained: true }),
    ).toBe(false);
  });
});
