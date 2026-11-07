/**
 * What the client does with an IDENTITY refusal on the create leg.
 *
 * `POST /api/patient-reports` runs `bindRadiologyReportIdentity` before it
 * resolves a patient, a test or an insert, so every code that guard raises means
 * one provable thing: nothing was written. Until now none of them reached the
 * radiologist as that. They landed in `useStudyFinalize`'s generic catch and were
 * printed as "Finalize failed: <server sentence>", which is the same dead-end
 * shape `finalizeContentRefusal.test.ts` exists to prevent — a refusal that names
 * an action ("Approve the correct match in Match Center") inside a message that
 * says the press crashed, and leaves the caller's completion bookkeeping
 * whatever the throw happened to skip.
 *
 * The tests below are split by that boundary:
 *   - a guard code is a RESULT with nothing written (no signature, no flip,
 *     `isFinalizeCompletion` false, the draft kept);
 *   - a 409 the guard does not raise still propagates, because a caller that
 *     cannot name the recovery must not invent one;
 *   - a lost answer still resumes, because "no answer" is not "refused";
 *   - the code set is pinned against the server function that raises it, so this
 *     file cannot silently outlive a new refusal reason.
 *
 * Real `HttpError` with the route's real body shape (`{ error, code }`,
 * patient-reports.ts:2246), mocked transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  finalizeRadiologyReport,
  isFinalizeCompletion,
  identityGuardRefusalCode,
  IDENTITY_GUARD_REFUSAL_CODES,
  type FinalizeReportContent,
} from "./radiologyReportLifecycle";
import { api, HttpError } from "./fetchApi";

vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

const STUDY = { patientId: 2, studyId: 1, worklistId: 1 };

const BODY = `<div class="section-heading">TECHNIQUE</div><p>MRI without contrast.</p>`
  + `<div class="section-heading">FINDINGS</div><p>No acute abnormality.</p>`
  + `<div class="section-heading">IMPRESSION</div><p>No acute abnormality.</p>`;

function content(): FinalizeReportContent {
  return {
    title: "MRI BRAIN",
    htmlBody: BODY,
    impression: ["No acute abnormality."],
    isCritical: false,
    criticalNote: null,
    createdBy: "Reporting radiologist",
    actor: "Reporting radiologist",
    signatureId: 1,
  };
}

/** The 409 the create route answers when the identity guard refuses. */
function identityRefusal(code: string, error: string): HttpError {
  return new HttpError(error, 409, { error, code });
}

const MATCH_GATE = identityRefusal(
  "MATCH_GATE_BLOCKED",
  "Report finalization is blocked. Match score is RED (mismatch / possible wrong study). "
  + "Approve the correct match in Match Center, or relink the correct study.",
);

let calls: { create: unknown[]; sign: unknown[]; status: unknown[] };

function harness(opts: { createError?: unknown } = {}) {
  calls = { create: [], sign: [], status: [] };
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/patient-reports/from-study/")) {
      return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
    }
    if (path === "/api/signatures") return [{ id: 1, name: "Reporting radiologist", isActive: true }];
    throw new Error(`unexpected GET ${path}`);
  });
  mockPost.mockImplementation(async (path: string, body: unknown) => {
    if (path === "/api/patient-reports") {
      calls.create.push(body);
      if (opts.createError !== undefined) throw opts.createError;
      return { id: 14 };
    }
    if (path.endsWith("/sign")) {
      calls.sign.push(body);
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

describe("an identity refusal on the create is a refusal, not a crash", () => {
  it("a blocked match returns instead of throwing", async () => {
    harness({ createError: MATCH_GATE });
    await expect(finalizeRadiologyReport(STUDY, content())).resolves.toBeTruthy();
  });

  it("says nothing was written, and the study stays open with its draft", async () => {
    harness({ createError: MATCH_GATE });
    const result = await finalizeRadiologyReport(STUDY, content());

    expect(result.reportId).toBeNull();
    expect(result.signed).toBe(false);
    expect(result.reportStatusSent).toBe(false);
    expect(result.reportStatusError ?? null).toBeNull();
    expect(isFinalizeCompletion(result)).toBe(false);
    // The refusal is the only request this finalize makes.
    expect(calls.create).toHaveLength(1);
    expect(calls.sign).toHaveLength(0);
    expect(calls.status).toHaveLength(0);
  });

  it("carries the server's own sentence as the reason no row was created", async () => {
    harness({ createError: MATCH_GATE });
    const result = await finalizeRadiologyReport(STUDY, content());

    expect(result.reportCreationSkipped).toContain("Match score is RED");
    expect(result.reportCreationSkipped).toContain("Match Center");
    expect(result.reportCreationCode).toBe("MATCH_GATE_BLOCKED");
  });

  it("classifies every code the guard raises before its insert", async () => {
    const raised = [
      ["WORKLIST_REQUIRED", "Radiology finalize requires a linked worklist/study."],
      ["UNLINKED_CONFIRM_REQUIRED", "This worklist row is not linked to a billed examination."],
      ["PATIENT_UNMATCHED", "This DICOM study is not linked to a CARE patient."],
      ["PATIENT_MISMATCH", "Submitted patient does not match the worklist patient."],
      ["TEST_REQUIRED", "This worklist has no billed examination to attach the report to."],
    ] as const;
    for (const [code, error] of raised) {
      harness({ createError: identityRefusal(code, error) });
      const result = await finalizeRadiologyReport(STUDY, content());
      expect(result.reportCreationCode, code).toBe(code);
      expect(result.signed, code).toBe(false);
      expect(calls.sign, code).toHaveLength(0);
    }
  });

  it("still tells the no-patient study what it was told before", async () => {
    // The branch this refusal now shares is the one `reportCreationSkipped` has
    // always used, and its wording for an unbilled study is load-bearing.
    harness({ createError: identityRefusal("PATIENT_UNMATCHED", "This DICOM study is not linked to a CARE patient.") });
    const result = await finalizeRadiologyReport(STUDY, content());
    expect(result.reportCreationCode).toBe("PATIENT_UNMATCHED");
    expect(result.reportCreationSkipped).toContain("CARE patient");
  });
});

describe("the boundary of that classification", () => {
  it("a 409 the identity guard never raises still propagates", async () => {
    const err = new HttpError("No published presentation template.", 409, {
      error: "No published presentation template.",
      code: "report_presentation_unresolved",
    });
    harness({ createError: err });
    await expect(finalizeRadiologyReport(STUDY, content())).rejects.toBe(err);
  });

  it("a 400 with no code at all still propagates", async () => {
    const err = new HttpError("patientId and testId are required", 400, { error: "patientId and testId are required" });
    harness({ createError: err });
    await expect(finalizeRadiologyReport(STUDY, content())).rejects.toBe(err);
  });

  it("a lost answer is not a refusal: the resume path is untouched", async () => {
    const err = new HttpError("Bad gateway", 502, { error: "Bad gateway", code: "MATCH_GATE_BLOCKED" });
    harness({ createError: err });
    // The create throws 502, and the recovery lookup finds the row the server
    // already committed with exactly this content.
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/patient-reports/from-study/")) {
        return { patientId: 2, testId: 10, orderTestId: null, orderId: null, billId: null };
      }
      if (path === "/api/radiology/pacs-worklist/1") {
        return { reportId: 14, patientId: 2, status: "STUDY_RECEIVED" };
      }
      if (path === "/api/patient-reports/14") {
        return { id: 14, patientId: 2, title: "MRI BRAIN", body: BODY, impression: "No acute abnormality." };
      }
      if (path === "/api/signatures") return [{ id: 1, name: "Reporting radiologist", isActive: true }];
      throw new Error(`unexpected GET ${path}`);
    });
    const result = await finalizeRadiologyReport(STUDY, content());
    expect(result.resumedAfterLostResponse).toBe(true);
    expect(result.reportCreationCode ?? null).toBeNull();
  });

  it("reads the code from the body, not from the sentence", () => {
    expect(identityGuardRefusalCode(identityRefusal("MATCH_GATE_BLOCKED", "anything at all"))).toBe("MATCH_GATE_BLOCKED");
    expect(identityGuardRefusalCode(new Error("Match score is RED, MATCH_GATE_BLOCKED"))).toBeNull();
    expect(identityGuardRefusalCode(undefined)).toBeNull();
  });
});

describe("the client's code set matches the server guard", () => {
  it("covers every code bindRadiologyReportIdentity can raise, and no more", () => {
    const source = readFileSync(
      new URL("../../../api-server/src/lib/radiologyIdentity.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function bindRadiologyReportIdentity");
    const end = source.indexOf("export async function assertReportBelongsToWorklist");
    expect(start, "the guard function must still exist").toBeGreaterThan(-1);
    expect(end, "its body must still be delimited by the next export").toBeGreaterThan(start);

    const raised = new Set<string>();
    const re = /new RadiologyIdentityError\(\s*(\d+)\s*,\s*"([A-Z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source.slice(start, end)))) raised.add(m[2]!);

    expect([...raised].sort(), "codes the server raises today").toEqual([...IDENTITY_GUARD_REFUSAL_CODES].sort());
  });
});
