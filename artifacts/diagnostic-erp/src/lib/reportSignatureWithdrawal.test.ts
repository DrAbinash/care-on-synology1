/**
 * reportSignatureWithdrawal.test.ts — the client half of the withdrawal
 * correction path.
 *
 * THE GAP UNDER GUARD
 *   POST /api/patient-reports/:id/withdraw-signature does the whole job on the
 *   server: it nulls the signature, returns the report to "draft", reopens the
 *   bound radiology worklist row to REPORT_IN_PROGRESS, clears a delivery
 *   status that would otherwise keep advertising an unsigned report as ready to
 *   hand over, and writes an attributed audit event carrying the reason. What
 *   it never had was a caller. Nothing in diagnostic-erp invoked it, so the
 *   only way to take a signature back was to issue the request by hand — and
 *   Report Hub's own locked-report notice told the radiologist that "a
 *   correction has to be issued as an amendment", which for a legacy-signed row
 *   is a path the server refuses.
 *   Meanwhile the server's own signed-artifact refusal says the opposite:
 *   "Use Amend to create a corrected version, or withdraw the signature first."
 *
 *   So these tests guard three things that can each fail independently:
 *     1. the client gate agrees with the server's refusals, so the button is
 *        not offered for a row that would be refused;
 *     2. a refusal reaches the radiologist as the server's sentence rather than
 *        as a machine token or a thrown exception;
 *     3. Report Hub actually renders the path — a perfect module nobody calls
 *        is exactly the defect this file exists for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, HttpError } from "./fetchApi";
import {
  canWithdrawSignature,
  withdrawReportSignature,
  withdrawalRefusalText,
  type WithdrawableReportRow,
} from "./reportSignatureWithdrawal";

// Only `api` is replaced; HttpError/isHttpError stay the real ones, because the
// refusal-text mapping is the thing under test and must run against the class
// fetchApi actually throws.
vi.mock("./fetchApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fetchApi")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockPost = vi.mocked(api.post);

beforeEach(() => {
  mockPost.mockReset();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const REPO = resolve(ERP_SRC, "../../..");
/** Line endings are normalised because this repo is checked out with
 *  core.autocrlf=true on the Windows dev box (CRLF in the working tree) and LF
 *  in CI. Without this, every multi-line needle passes on one and fails on the
 *  other. */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const LIB = read(resolve(HERE, "reportSignatureWithdrawal.ts"));
const REPORT_HUB = read(resolve(ERP_SRC, "pages/ReportHub.tsx"));
const REPORTS_ROUTE = read(resolve(REPO, "artifacts/api-server/src/routes/patient-reports.ts"));
const SIGNED_GUARD = read(resolve(REPO, "artifacts/api-server/src/lib/signedArtifactGuard.ts"));

/** The withdraw-signature handler only, so a token found here is found in the
 *  route these tests claim to mirror rather than somewhere else in a 3,000-line
 *  file. */
function withdrawRoute(): string {
  const at = REPORTS_ROUTE.indexOf('patientReportsRouter.post("/:id/withdraw-signature"');
  expect(at, "the withdraw-signature route must still exist").toBeGreaterThan(-1);
  const ends = [
    REPORTS_ROUTE.indexOf("\npatientReportsRouter.", at + 10),
    REPORTS_ROUTE.indexOf("\nfunction ", at + 10),
  ].filter((n) => n > -1);
  return REPORTS_ROUTE.slice(at, ends.length ? Math.min(...ends) : at + 9000);
}

/** A signed legacy row awaiting counter-signature — the clinic's real case. */
const row = (over: Partial<WithdrawableReportRow> = {}): WithdrawableReportRow => ({
  status: "pending_verification",
  signedAt: "2026-10-06T09:00:00.000Z",
  signedByName: "Dr. Sugandha",
  structuredJson: null,
  ...over,
});

describe("canWithdrawSignature — offered exactly where the server would accept it", () => {
  it("offers withdrawal on a signed row awaiting verification", () => {
    expect(canWithdrawSignature(row())).toBe(true);
  });

  it("offers it on a draft row that carries a signature stamp", () => {
    // The structured finalize path stamps signedAt while leaving status at
    // "draft", so status alone would hide a signed report.
    expect(canWithdrawSignature(row({ status: "draft" }))).toBe(true);
  });

  it("withholds it from a row that was never signed", () => {
    expect(canWithdrawSignature(row({ status: "draft", signedAt: null, signedByName: null }))).toBe(false);
  });

  it("withholds it once verified, even though the signature stamp is still there", () => {
    expect(canWithdrawSignature(row({ status: "verified" }))).toBe(false);
  });

  it("withholds it once delivered", () => {
    expect(canWithdrawSignature(row({ status: "delivered" }))).toBe(false);
  });

  it("withholds it from a structured-signed row in the list shape", () => {
    const structured = { audit: { signature: { state: "final" } } };
    expect(canWithdrawSignature(row({ status: "draft", structuredJson: structured }))).toBe(false);
  });

  it("withholds it from a structured-signed row in the detail shape", () => {
    // GET /:id reports structuredSigned on lifecycle; the list does not carry
    // it. Both must reach the same answer or the two surfaces disagree.
    expect(canWithdrawSignature(row({ structuredSigned: true }))).toBe(false);
  });

  it("treats a structured document that is not final as an ordinary signed row", () => {
    const structured = { audit: { signature: { state: "draft" } } };
    expect(canWithdrawSignature(row({ structuredJson: structured }))).toBe(true);
  });

  it("reads a missing status as unsigned rather than as withdrawable", () => {
    expect(canWithdrawSignature({ status: null })).toBe(false);
  });
});

describe("withdrawReportSignature — the call", () => {
  it("posts the reason to the route and reports the status the server returned", async () => {
    mockPost.mockResolvedValueOnce({ status: "draft", signedByName: null });
    const out = await withdrawReportSignature(99, "  Signed the lumbar study instead of the cervical.  ");
    expect(out).toEqual({ withdrawn: true, status: "draft" });
    expect(mockPost).toHaveBeenCalledWith("/api/patient-reports/99/withdraw-signature", {
      reason: "Signed the lumbar study instead of the cervical.",
    });
  });

  it("refuses a blank reason locally instead of spending a round trip on a certain 400", async () => {
    const out = await withdrawReportSignature(99, "   ");
    expect(mockPost).not.toHaveBeenCalled();
    expect(out.withdrawn).toBe(false);
    // The server's own sentence for the same refusal, so the two cannot drift
    // into saying different things about the same rule.
    const route = withdrawRoute();
    const serverSentence = /if \(!reason\) \{\s*\n\s*res\.status\(400\)\.json\(\{ error: "[^"]*", message: "([^"]*)"/.exec(route)?.[1];
    expect(serverSentence, "the route must still refuse a blank reason with a sentence").toBeTruthy();
    expect((out as { error: string }).error).toBe(serverSentence);
  });
});

describe("withdrawReportSignature — a refusal reaches the radiologist as a sentence", () => {
  it("surfaces the server's sentence rather than its token", async () => {
    mockPost.mockRejectedValueOnce(new HttpError("not_the_signer", 403, {
      error: "not_the_signer",
      message: "Only the signer or an administrator can withdraw this signature.",
    }));
    const out = await withdrawReportSignature(99, "Locum covering today");
    expect(out).toEqual({
      withdrawn: false,
      error: "Only the signer or an administrator can withdraw this signature.",
    });
  });

  it("reads `detail` too, because the refusals raised inside the transaction use it", async () => {
    // patient-reports.ts answers those as { error: <code>, detail: <sentence> },
    // not { error, message } — a mapping that only knew `message` would fall
    // through to the token for exactly the refusal about a delivered study.
    mockPost.mockRejectedValueOnce(new HttpError("already_delivered", 409, {
      error: "already_delivered",
      detail: "This study is marked delivered, so its report cannot be un-signed.",
    }));
    const out = await withdrawReportSignature(99, "Sent in error");
    expect(out).toEqual({
      withdrawn: false,
      error: "This study is marked delivered, so its report cannot be un-signed.",
    });
  });

  it("does not throw when the failure is not an HTTP answer at all", async () => {
    mockPost.mockRejectedValueOnce(new TypeError("network went away"));
    await expect(withdrawReportSignature(99, "reason")).resolves.toEqual({
      withdrawn: false,
      error: "network went away",
    });
  });

  it("falls back to a sentence of its own when the error carries nothing usable", async () => {
    mockPost.mockRejectedValueOnce(new HttpError("", 500, {}));
    const out = await withdrawReportSignature(99, "reason");
    expect(out.withdrawn).toBe(false);
    expect((out as { error: string }).error).toBe("Could not withdraw the signature.");
  });

  it("prefers `message` over `detail` when a body somehow carries both", () => {
    const err = new HttpError("token", 409, { message: "the sentence", detail: "the other one" });
    expect(withdrawalRefusalText(err)).toBe("the sentence");
  });

  it("ignores a non-string detail rather than rendering [object Object]", () => {
    const err = new HttpError("token", 409, { detail: { reason: "structured" } });
    expect(withdrawalRefusalText(err)).toBe("token");
  });
});

describe("the server contract the client gate claims to mirror", () => {
  it("still refuses the four conditions the gate encodes", () => {
    const route = withdrawRoute();
    for (const code of ["not_signed", "already_verified", "structured_signed_report", "not_the_signer", "already_delivered"]) {
      expect(route, `the route must still refuse ${code}`).toContain(`"${code}"`);
    }
  });

  it("blocks exactly the statuses the gate blocks", () => {
    const route = withdrawRoute();
    expect(route).toContain('if (existing.status === "verified" || existing.status === "delivered") {');
    // The same two statuses, in the same order, in the client gate — so one
    // cannot widen without the test noticing.
    expect(LIB).toContain('if (row.status === "verified" || row.status === "delivered") return false;');
  });

  it("counts pending_verification as signed, which is why the gate accepts it", () => {
    expect(SIGNED_GUARD).toContain(
      'export const SIGNED_REPORT_STATUSES = ["pending_verification", "verified", "delivered"] as const;',
    );
    expect(LIB).toContain('return row.signedAt != null || row.status === "pending_verification";');
  });

  it("really does answer in-transaction refusals with `detail`, not `message`", () => {
    const route = withdrawRoute();
    expect(route).toContain("detail: outcome.refused.detail ?? null");
  });

  it("still requires a reason, and still records who withdrew it and why", () => {
    const route = withdrawRoute();
    expect(route).toContain("if (!reason) {");
    expect(route).toContain('"signature_withdrawn"');
    expect(route).toMatch(/\{ reportId: id, reason, withdrawn, outcome: "withdrawn", reopenedWorklist: worklist \}/);
  });
});

describe("wiring — Report Hub renders the path, on both surfaces", () => {
  it("imports the module rather than reaching for the endpoint itself", () => {
    const imp = /import \{([^}]*)\} from "@\/lib\/reportSignatureWithdrawal";/.exec(REPORT_HUB);
    expect(imp, "ReportHub must import the withdrawal module").not.toBeNull();
    expect(imp![1].split(",").map((s) => s.trim()).filter(Boolean).sort())
      .toEqual(["canWithdrawSignature", "withdrawReportSignature"]);
    // The endpoint lives in the lib. A second copy in the page is how the two
    // surfaces start disagreeing about what a withdrawal does.
    expect(REPORT_HUB).not.toContain("/withdraw-signature");
  });

  it("gates the list-row button on the shared predicate", () => {
    expect(REPORT_HUB).toContain("{canWithdrawSignature(r) && <Button");
    expect(REPORT_HUB).toContain('data-testid={`btn-withdraw-${r.id}`}');
  });

  it("gates the editor-sidebar button on the same predicate, through one local", () => {
    expect(REPORT_HUB).toContain("const withdrawable = report");
    expect(REPORT_HUB).toContain("{withdrawable && <Button onClick={() => onWithdraw(report)}");
    expect(REPORT_HUB).toContain('data-testid="btn-sidebar-withdraw"');
    // The detail row carries lifecycle.structuredSigned, which the list row does
    // not; the sidebar must pass it or it will offer withdrawal on a
    // structured-signed report.
    expect(REPORT_HUB).toContain("structuredSigned: report.lifecycle?.structuredSigned,");
  });

  it("requires a reason before Confirm is enabled", () => {
    expect(REPORT_HUB).toContain("disabled={busy || !reason.trim()}");
    expect(REPORT_HUB).toContain("await withdrawReportSignature(report.id, reason)");
  });

  it("states the consequence before the radiologist confirms", () => {
    // Withdrawal is not cosmetic: the study reopens and a delivered flag is
    // cleared. The dialog has to say so while it is still a choice.
    expect(REPORT_HUB).toContain("Its study reopens for");
    expect(REPORT_HUB).toContain("stops being marked ready to send");
  });

  it("no longer tells a signed report that amendment is its only correction, when withdrawal is available", () => {
    expect(REPORT_HUB).toContain("Withdrawing the signature puts the report back to draft");
    // And the amendment sentence survives for the rows withdrawal cannot help —
    // verified, delivered and structured-signed. Deleting it would leave those
    // with no stated path at all.
    expect(REPORT_HUB).toContain("A correction has to be issued as an amendment, which preserves this version.");
    // Both are driven by the same `withdrawable` local, so the notice cannot
    // promise a withdrawal the button is not offering.
    expect(REPORT_HUB).toMatch(/\{withdrawable\s*\?\s*" Withdrawing the signature/);
  });
});
