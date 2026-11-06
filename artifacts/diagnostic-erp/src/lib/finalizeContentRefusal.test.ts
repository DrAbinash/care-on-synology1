/**
 * What the client does with a content refusal (ruling 3).
 *
 * The door answers 409 `report_content_incomplete` for a report whose Findings
 * was never written. Two things have to be true on this side of that answer, and
 * neither is visible in the refusal message:
 *
 *  1. the refusal is a RESULT, not an exception. An exception lands in the
 *     gauntlet's generic catch, which tells the radiologist "Finalize failed"
 *     and — worse — leaves `isFinalizeCompletion` never consulted, so the
 *     study's own completion bookkeeping is whatever the throw happened to
 *     skip. As a result, `isFinalizeCompletion` says false and the study
 *     demonstrably stays open with its drafts intact.
 *  2. the documented reason travels on BOTH writes that classify the body. The
 *     create judges the HTML this call built; the sign judges the row it just
 *     stored, which is the same unfinished text. Forwarding the reason to only
 *     the first would create the report and then refuse its signature — a
 *     study that reads as final with an unsigned draft behind it, the precise
 *     state C2 in this file's history exists to prevent.
 *
 * Real `HttpError` with the server's real refusal object; mocked transport, the
 * same split `finalizePartialFailure.recovery.test.ts` uses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  finalizeRadiologyReport,
  isFinalizeCompletion,
  type FinalizeReportContent,
} from "./radiologyReportLifecycle";
import { api, HttpError } from "./fetchApi";
import { classifySignedReportBody, signedContentRefusal } from "../../../api-server/src/lib/signedReportContentGuard";

vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);

const STUDY = { patientId: 2, studyId: 1, worklistId: 1 };

/** Technique and Impression written, Findings drawn and left empty. */
const UNFINISHED_BODY = `<div class="section-heading">TECHNIQUE</div><p>MRI without contrast.</p>`
  + `<div class="section-heading">FINDINGS</div><p></p>`
  + `<div class="section-heading">IMPRESSION</div><p>No acute abnormality.</p>`;
const FINISHED_BODY = `<div class="section-heading">TECHNIQUE</div><p>MRI without contrast.</p>`
  + `<div class="section-heading">FINDINGS</div><p>No acute abnormality.</p>`
  + `<div class="section-heading">IMPRESSION</div><p>No acute abnormality.</p>`;

function content(reason?: string): FinalizeReportContent {
  return {
    title: "MRI BRAIN",
    htmlBody: UNFINISHED_BODY,
    impression: ["No acute abnormality."],
    isCritical: false,
    criticalNote: null,
    createdBy: "Reporting radiologist",
    actor: "Reporting radiologist",
    signatureId: 1,
    ...(reason ? { contentOverride: true as const, contentOverrideReason: reason } : {}),
  };
}

/** The 409 the create route actually answers for this body. */
function contentRefusalError(body: string): HttpError {
  const refusal = signedContentRefusal(classifySignedReportBody(body));
  return new HttpError(refusal.error, 409, refusal);
}

let calls: { create: Record<string, unknown>[]; sign: Record<string, unknown>[]; status: unknown[] };

function harness(opts: {
  /** Thrown by POST /api/patient-reports. */
  createError?: unknown;
  /** Thrown by POST /:id/sign. */
  signError?: unknown;
  body?: string;
}) {
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
      calls.create.push(body as Record<string, unknown>);
      if (opts.createError !== undefined) throw opts.createError;
      return { id: 14 };
    }
    if (path.endsWith("/sign")) {
      calls.sign.push(body as Record<string, unknown>);
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

describe("a content refusal is a result the workspace can act on", () => {
  it("returns the refusal with its level and sections instead of throwing", async () => {
    harness({ createError: contentRefusalError(UNFINISHED_BODY) });

    const result = await finalizeRadiologyReport(STUDY, content());

    expect(result.contentRefusal).not.toBeNull();
    expect(result.contentRefusal!.level).toBe("incomplete");
    expect(result.contentRefusal!.sections).toEqual(["findings"]);
    expect(result.contentRefusal!.minReasonChars).toBeGreaterThan(0);
    // The sentence the door wrote, unchanged: this is the text the screen shows.
    expect(result.contentRefusal!.sentence).toContain("Findings is empty");
  });

  it("writes nothing at all, so the study stays open with its drafts", async () => {
    harness({ createError: contentRefusalError(UNFINISHED_BODY) });

    const result = await finalizeRadiologyReport(STUDY, content());

    expect(result.reportId).toBeNull();
    expect(result.reportStatusSent).toBe(false);
    expect(result.signed).toBe(false);
    expect(isFinalizeCompletion(result)).toBe(false);
    // No signature was consumed and no status flip was sent: the refusal is the
    // only request this finalize makes, so nothing can be half-applied.
    expect(calls.sign).toHaveLength(0);
    expect(calls.status).toHaveLength(0);
  });

  it("sends no override on the first attempt, whatever the caller's state", async () => {
    // The pair exists only to answer a refusal. A finalize that carries it
    // unprompted would sign an unfinished report and audit a documented reason
    // nobody was ever asked for.
    harness({});
    await finalizeRadiologyReport(STUDY, content());
    expect(calls.create[0]).not.toHaveProperty("contentOverride");
    expect(calls.create[0]).not.toHaveProperty("contentOverrideReason");
  });

  it("leaves a finished report's finalize exactly as it was", async () => {
    harness({});
    const result = await finalizeRadiologyReport(STUDY, { ...content(), htmlBody: FINISHED_BODY });
    expect(result.contentRefusal ?? null).toBeNull();
    expect(result.signed).toBe(true);
    expect(result.reportStatusSent).toBe(true);
    expect(isFinalizeCompletion(result)).toBe(true);
  });

  it("still re-throws a 409 that is not about content", async () => {
    // PR-1 (F1)'s presentation certificate refuses for a different reason and
    // has always propagated; the content branch must not swallow it into a
    // reason box, because documenting a reason cannot publish a template.
    const err = new HttpError("No published presentation template.", 409, {
      error: "No published presentation template.",
      code: "report_presentation_unresolved",
    });
    harness({ createError: err });
    await expect(finalizeRadiologyReport(STUDY, content())).rejects.toBe(err);
  });
});

describe("the documented reason is carried by every leg that judges the body", () => {
  it("sends the pair on the create and on the sign, and signs", async () => {
    harness({});

    const result = await finalizeRadiologyReport(
      STUDY,
      content("  Findings dictated by phone; addendum to follow in the same session.  "),
    );

    const pair = {
      contentOverride: true,
      contentOverrideReason: "Findings dictated by phone; addendum to follow in the same session.",
    };
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]).toMatchObject(pair);
    // The leg this suite exists for: without it the report is created, the
    // signature is refused, and the study closes over an unsigned draft.
    expect(calls.sign).toHaveLength(1);
    expect(calls.sign[0]).toMatchObject(pair);
    expect(calls.sign[0]).toHaveProperty("signatureId", 1);
    expect(result.signed).toBe(true);
    expect(result.reportStatusSent).toBe(true);
  });

  it("sends an empty string nowhere: no reason means no pair", async () => {
    harness({});
    // `contentOverride: true` with a blank reason is the door's own refusal
    // case; the client must not construct one even if a caller passes "".
    await finalizeRadiologyReport(STUDY, {
      ...content(),
      contentOverride: true,
      contentOverrideReason: "",
    });
    expect(calls.create[0]).not.toHaveProperty("contentOverride");
  });
});
