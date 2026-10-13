import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizeRadiologyReport, SIGNED_REPORT_STATUSES } from "./radiologyReportLifecycle";
import { api, HttpError, NetworkError } from "./fetchApi";
import {
  isSignedArtifact,
  SIGNED_REPORT_STATUSES as SERVER_SIGNED_REPORT_STATUSES,
} from "../../../api-server/src/lib/signedArtifactGuard";

// Real HttpError/NetworkError classes, mocked transport only: the resume
// decision is made by testing `instanceof` against these two, so a mock that
// replaced them would prove nothing about which failures the client resumes.
vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

const CONTENT = {
  title: "MRI CERVICAL SPINE",
  htmlBody: "<h3>Findings</h3><p>C5-C6 disc protrusion, 4 mm, left paracentral.</p>",
  impression: ["C5-C6 left paracentral disc protrusion."],
  isCritical: false,
  criticalNote: null,
  createdBy: "Dr. Sugandha",
  actor: "Dr. Sugandha",
};

const STUDY = { patientId: 2, studyId: 1, worklistId: 1 };
const SUGANDHA = [{ id: 1, name: "Dr. Sugandha", isActive: true }];

/** The row POST /api/patient-reports commits, as GET /api/patient-reports/:id returns it. */
function boundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 13,
    patientId: 2,
    title: CONTENT.title,
    body: CONTENT.htmlBody,
    impression: CONTENT.impression.join("\n"),
    status: "draft",
    signedAt: null,
    structuredJson: null,
    ...overrides,
  };
}

type Harness = {
  createError?: unknown;
  worklist?: unknown;
  report?: unknown;
  signatures?: unknown;
};

/** Call log keyed by leg, so each test can assert what did and did not run. */
let calls: { create: unknown[]; sign: string[]; status: unknown[]; worklistDetail: string[]; reportRead: string[] };

function harness({ createError, worklist, report, signatures = SUGANDHA }: Harness) {
  calls = { create: [], sign: [], status: [], worklistDetail: [], reportRead: [] };
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/patient-reports/from-study/")) {
      return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
    }
    if (path.startsWith("/api/radiology/pacs-worklist/")) {
      calls.worklistDetail.push(path);
      if (worklist === undefined) throw new Error("no worklist row");
      return worklist;
    }
    if (path.startsWith("/api/patient-reports/")) {
      calls.reportRead.push(path);
      if (report === undefined) throw new Error("no report row");
      return report;
    }
    if (path === "/api/signatures") return signatures;
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: unknown) => {
    if (path === "/api/patient-reports") {
      calls.create.push(body);
      if (createError !== undefined) throw createError;
      return { id: 14 };
    }
    if (path.endsWith("/sign")) {
      calls.sign.push(path);
      return { ok: true };
    }
    if (path === "/api/internal/radiology/report-status") {
      calls.status.push(body);
      return undefined;
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

/** The bound row the worklist points at, with the patient the worklist itself records. */
function boundTo(reportId = 13, worklistPatientId = 2, status = "REPORT_IN_PROGRESS") {
  return { worklist: { reportId, patientId: worklistPatientId, status }, report: boundRow() };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// D-5 — a finalize whose create POST never answered.
//
// Reproduced on the isolated synthetic fixture (browser → Vite 5177 → API
// 8082): the workspace showed four failed save attempts while the server had
// already committed patient_reports id 13 and bound radiology_worklist.report_id
// to it in the same transaction. Every later autosave was then refused with
// "This study already has a final report… withdraw it in Report Hub", and the
// withdrawal itself was refused, because nothing was signed. The radiologist
// could neither save nor submit.
//
// The requirement this suite pins: recover the report the server already wrote,
// once and only when the recovery is provable, and never re-sign or re-flip a
// state that already holds.
// ────────────────────────────────────────────────────────────────────────────
describe("finalizeRadiologyReport — recovery after a lost create response (D-5)", () => {
  it("R1 completes the finalize from the row the server committed, creating no second report", async () => {
    harness({ createError: new NetworkError("Failed to fetch"), ...boundTo() });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);

    expect(result.resumedAfterLostResponse).toBe(true);
    expect(result.reportId).toBe(13);
    expect(result.signed).toBe(true);
    expect(result.signError).toBeNull();
    // Not `idempotent`: that flag means the server wrote nothing for this call.
    // Here the committed row holds this call's content (asserted below), so the
    // caller's success path — clear local backups, credit the session — is right.
    expect(result.idempotent).toBe(false);
    // One create attempt only: the recovery reads, it does not post again.
    expect(calls.create).toHaveLength(1);
    expect(calls.sign).toEqual(["/api/patient-reports/13/sign"]);
    expect(calls.status).toHaveLength(1);
    expect(calls.status[0]).toEqual(
      expect.objectContaining({ worklistId: 1, status: "REPORT_FINAL", deliveryStatus: "READY_TO_SEND", reportId: 13 }),
    );
  });

  it("R2 refuses to resume onto a row that does not hold this call's content", async () => {
    // The lost response may be an OLD finalize's row. Silently continuing would
    // tell the radiologist their on-screen edits were signed when the server is
    // holding different words, which is the failure mode this whole path exists
    // to avoid.
    harness({
      createError: new NetworkError("Failed to fetch"),
      ...boundTo(),
      report: boundRow({ impression: "An older impression from a previous finalize." }),
    });

    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(NetworkError);
    expect(calls.sign).toEqual([]);
    expect(calls.status).toEqual([]);
  });

  it("R3 re-throws a 4xx the server actually answered, without even looking for a bound row", async () => {
    // 409 MATCH_GATE_BLOCKED / the content guard / a dead session are the
    // server explaining that it wrote NOTHING. Those refusals and their
    // messages are load-bearing and must reach the caller untouched.
    harness({ createError: new HttpError("Identity could not be confirmed", 409), worklist: { reportId: 13 }, report: boundRow() });

    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(HttpError);
    expect(calls.worklistDetail).toEqual([]);
    expect(calls.sign).toEqual([]);
    expect(calls.status).toEqual([]);
  });

  it("R4 resumes on a gateway 5xx that killed the answer but not the transaction", async () => {
    harness({ createError: new HttpError("Server temporarily unavailable (502)", 502), ...boundTo() });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);
    expect(result.resumedAfterLostResponse).toBe(true);
    expect(result.reportId).toBe(13);
    expect(result.signed).toBe(true);
  });

  it("R5 will not resume onto another patient's report", async () => {
    // Report-to-study identity is the whole point of the binding: a worklist
    // row whose patient disagrees with this study is a different study, and
    // signing its report under this one would put one patient's findings on
    // another patient's document.
    harness({ createError: new NetworkError("Failed to fetch"), ...boundTo(13, 99) });
    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(NetworkError);
    expect(calls.reportRead).toEqual([]);
    expect(calls.sign).toEqual([]);

    // Same refusal when only the report row disagrees.
    harness({ createError: new NetworkError("Failed to fetch"), worklist: { reportId: 13, patientId: 2, status: "REPORT_IN_PROGRESS" }, report: boundRow({ patientId: 99 }) });
    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(NetworkError);
    expect(calls.sign).toEqual([]);
  });

  it("R6 re-throws when the study turns out to be bound to nothing", async () => {
    harness({ createError: new NetworkError("Failed to fetch"), worklist: { reportId: null, patientId: 2, status: "REPORT_IN_PROGRESS" } });
    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(NetworkError);
    expect(calls.reportRead).toEqual([]);
    // Nothing was written, so nothing is marked final.
    expect(calls.status).toEqual([]);
  });

  it("R7 never signs a row that already carries a signature", async () => {
    harness({ createError: new NetworkError("Failed to fetch"), ...boundTo(), report: boundRow({ signedAt: "2026-10-13T09:00:00.000Z", status: "pending_verification" }) });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);
    expect(result.alreadySignedOnServer).toBe(true);
    expect(result.signed).toBe(true);
    expect(calls.sign).toEqual([]);
    // GET /api/signatures is part of the sign leg; a row that needs no sign
    // must not make it eligible for a different signer.
    expect(calls.status).toHaveLength(1);
  });

  it("R8 does not re-log a worklist status the server already reports as final", async () => {
    // The create committed and the status flip also ran; only the answer was
    // lost. A second REPORT_STATUS_UPDATED row would describe a transition that
    // did not happen, and audit history is exactly what this ticket promises to
    // preserve.
    harness({ createError: new NetworkError("Failed to fetch"), ...boundTo(13, 2, "REPORT_FINAL") });

    const result = await finalizeRadiologyReport(STUDY, CONTENT);
    expect(result.resumedAfterLostResponse).toBe(true);
    expect(calls.status).toEqual([]);
    expect(calls.sign).toEqual(["/api/patient-reports/13/sign"]);
  });

  it("R9 still flips the status on a normal (non-resumed) finalize", async () => {
    harness({});
    const result = await finalizeRadiologyReport(STUDY, CONTENT);
    expect(result.resumedAfterLostResponse).toBe(false);
    expect(result.reportId).toBe(14);
    expect(calls.status).toHaveLength(1);
  });

  it("R10 keeps the radiologist's local drafts when the content cannot be proved", async () => {
    // The caller clears draft backups only on a finalize that wrote them. A
    // re-thrown create must leave `idempotent`-style protection intact, so the
    // workspace's cleanup condition has to remain false-for-success-only.
    harness({
      createError: new NetworkError("Failed to fetch"),
      ...boundTo(),
      report: boundRow({ body: "<h3>Findings</h3><p>Something else entirely.</p>" }),
    });
    await expect(finalizeRadiologyReport(STUDY, CONTENT)).rejects.toBeInstanceOf(NetworkError);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The client cannot import the server's signed-artifact authority, so it keeps
// a mirror. A mirror is only safe while it is checked against the original.
// ────────────────────────────────────────────────────────────────────────────
describe("signed-status mirror against the server's isSignedArtifact", () => {
  it("lists exactly the server's signed statuses", () => {
    expect([...SIGNED_REPORT_STATUSES].sort()).toEqual([...SERVER_SIGNED_REPORT_STATUSES].sort());
  });

  const WITNESSES: Array<Record<string, unknown>> = [
    { status: "draft", signedAt: null, structuredJson: null },
    { status: "pending_verification", signedAt: null, structuredJson: null },
    { status: "verified", signedAt: null, structuredJson: null },
    { status: "delivered", signedAt: null, structuredJson: null },
    { status: "draft", signedAt: "2026-10-13T09:00:00.000Z", structuredJson: null },
    { status: "draft", signedAt: null, structuredJson: { audit: { signature: { state: "final" } } } },
    { status: "draft", signedAt: null, structuredJson: { audit: { signature: { state: "draft" } } } },
  ];

  it.each(WITNESSES.map((row, i) => [i, row]))(
    "witness %#: row %j agrees with the server",
    async (_i, row) => {
      const signedAttest = isSignedArtifact(row as Parameters<typeof isSignedArtifact>[0]);
      harness({ createError: new NetworkError("Failed to fetch"), ...boundTo(), report: boundRow(row) });
      const result = await finalizeRadiologyReport(STUDY, CONTENT);
      expect(result.alreadySignedOnServer).toBe(signedAttest);
      // Whatever the predicate decides, the row is never signed twice.
      expect(calls.sign).toEqual(signedAttest ? [] : ["/api/patient-reports/13/sign"]);
    },
  );
});
