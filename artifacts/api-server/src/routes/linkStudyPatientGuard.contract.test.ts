/**
 * Source contracts for PR #1170 — cross-patient linking protection.
 *
 * The verification round found the manual link door with no spine:
 *   (a) POST /pacs-worklist/:id/link-study bound ANY studyId and copied the
 *       study's patient onto the worklist row — no check, no reason, no
 *       override record (the auto-link path refuses cross-patient writes under
 *       an APPROVED decision; match-decision requires a reason — this door had
 *       nothing).
 *   (b) the finalize path could CREATE + SIGN a combined report whose linked
 *       sibling belongs to another patient: the sibling's own REPORT_FINAL
 *       flip is guarded by assertReportBelongsToWorklist, but the report row
 *       (with the sibling's findings section inside its body) was written
 *       anyway.
 *   (c) the Match Center UI offered no authorized-override door for the
 *       legitimate patient-correction workflow the owner mandated.
 *
 * Pure-gate behaviour is pinned in lib/pacs/linkStudyPatientGate.test.ts.
 * These contracts pin the WIRING: the gate is actually consulted at the
 * write, the refusal reaches the client as a coded 409, the override is
 * audited with its reason, and the finalize door refuses the cross-patient
 * combine before any report row exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const ROUTE = "routes/radiology.ts";
const IDENTITY = "lib/radiologyIdentity.ts";
const REPORTS = "routes/patient-reports.ts";
const UI = "../../diagnostic-erp/src/pages/MyCollection.tsx";

describe("PR #1170 — the manual link door consults the identity gate", () => {
  const src = read(ROUTE);
  const at = src.indexOf('"/pacs-worklist/:id/link-study"');

  it("1. the route calls evaluateLinkStudyPatientGate after the study row resolves and before any write", () => {
    expect(at).toBeGreaterThan(-1);
    const route = src.slice(at);
    const gateAt = route.indexOf("evaluateLinkStudyPatientGate(");
    expect(gateAt).toBeGreaterThan(-1);
    const study404At = route.indexOf('"Study not found"');
    const updateAt = route.indexOf(".update(radiologyWorklistTable)");
    expect(study404At).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(study404At);
    expect(gateAt).toBeLessThan(updateAt);
  });

  it("2. the gate's inputs are the two server-read patient ids plus the request's overrideReason", () => {
    const route = src.slice(at);
    const gateAt = route.indexOf("evaluateLinkStudyPatientGate(");
    const block = route.slice(gateAt, gateAt + 400);
    expect(block).toContain("worklistPatientId: worklistItem.patientId");
    expect(block).toContain("studyPatientId: study.patientId");
    expect(block).toContain("overrideReason");
  });

  it("3. a refusal answers 409 with the gate's code — the client can detect it", () => {
    const route = src.slice(at);
    const gateAt = route.indexOf("evaluateLinkStudyPatientGate(");
    const refuseAt = route.indexOf('patientGate.decision === "refuse"', gateAt);
    expect(refuseAt).toBeGreaterThan(-1);
    const block = route.slice(refuseAt, refuseAt + 300);
    expect(block).toContain("res.status(409)");
    expect(block).toContain("code: patientGate.code");
  });

  it("4. an overridden link is audited as MANUAL_LINK_OVERRIDE with the reason and the from/to patients", () => {
    const route = src.slice(at);
    const auditAt = route.indexOf('"MANUAL_LINK_OVERRIDE"');
    expect(auditAt).toBeGreaterThan(-1);
    // The audit row around the action: the conditional action, the reason,
    // and the from/to patient ids all sit in one values({...}) block.
    const block = route.slice(auditAt - 900, auditAt + 900);
    expect(block).toContain("patientGate.overridden");
    expect(block).toContain("overrideReason: patientGate.overrideReason");
    expect(block).toContain("patientFrom");
    expect(block).toContain("patientTo");
    // The ordinary same-patient link keeps its existing audit action.
    expect(route).toContain('"MANUAL_LINK"');
  });
});

describe("PR #1170 — the finalize door refuses a cross-patient combined report", () => {
  const identity = read(IDENTITY);
  const reports = read(REPORTS);

  it("5. radiologyIdentity exports assertCombinedSiblingSamePatient, reading the draft envelope the finalize itself reads", () => {
    expect(identity).toContain("export async function assertCombinedSiblingSamePatient");
    const fnAt = identity.indexOf("export async function assertCombinedSiblingSamePatient");
    const block = identity.slice(fnAt, fnAt + 1400);
    expect(block).toContain("extractCareLinkedStudy");
    // Same draft-choice rule as resolveAuthorizedCombinedSiblingWorklistId —
    // latest by (updatedAt, id): the draft that finalize would promote.
    expect(block).toContain("orderBy(desc(radiologyReportDraftsTable.updatedAt), desc(radiologyReportDraftsTable.id))");
  });

  it("6. the guard refuses only a PROVABLE mismatch — a sibling with no recorded patient is not refused here", () => {
    const fnAt = identity.indexOf("export async function assertCombinedSiblingSamePatient");
    const block = identity.slice(fnAt, fnAt + 1600);
    expect(block).toMatch(/sibling\.patientId != null && sibling\.patientId !== reportPatientId/);
    expect(block).toContain('"COMBINED_REPORT_PATIENT_MISMATCH"');
  });

  it("7. POST /api/patient-reports runs the guard before the D5 structured finalize AND the legacy insert", () => {
    const createAt = reports.indexOf('patientReportsRouter.post("/",');
    expect(createAt).toBeGreaterThan(-1);
    const route = reports.slice(createAt);
    const guardAt = route.indexOf("assertCombinedSiblingSamePatient(");
    expect(guardAt).toBeGreaterThan(-1);
    const d5At = route.indexOf("structuredFinalizeTransaction(req as StaffAuthRequest");
    const legacyAt = route.indexOf("db.transaction(async (tx) => {\n            await claimWorklistForFinalize");
    expect(d5At).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(d5At);
    // The legacy insert path is also after the guard (or the guard blocks both).
    if (legacyAt > -1) expect(guardAt).toBeLessThan(legacyAt);
  });

  it("8. the guard's RadiologyIdentityError answers with its status and code", () => {
    const createAt = reports.indexOf('patientReportsRouter.post("/",');
    const route = reports.slice(createAt);
    const guardAt = route.indexOf("assertCombinedSiblingSamePatient(");
    const block = route.slice(guardAt, guardAt + 600);
    expect(block).toContain("err instanceof RadiologyIdentityError");
    expect(block).toContain("res.status(err.httpStatus).json({ error: err.message, code: err.code })");
  });
});

describe("PR #1170 — Match Center offers the authorized override door", () => {
  const ui = read(UI);

  it("9. the link mutation forwards the overrideReason to the server", () => {
    const mutAt = ui.indexOf("linkMutation = useMutation");
    expect(mutAt).toBeGreaterThan(-1);
    const block = ui.slice(mutAt, mutAt + 900);
    const urlAt = block.indexOf("/link-study`");
    expect(urlAt).toBeGreaterThan(-1);
    // The overrideReason must ride in THIS mutation's POST body — not just
    // anywhere in the page (the neighbouring decisionMutation has its own).
    const body = block.slice(urlAt, urlAt + 200);
    expect(body).toContain("overrideReason");
  });

  it("10. a coded 409 refusal opens the reason dialog instead of a dead-end toast", () => {
    expect(ui).toContain("LINK_PATIENT_MISMATCH");
    expect(ui).toContain("LINK_PATIENT_UNPROVABLE");
    const detectAt = ui.indexOf("LINK_PATIENT_REFUSAL_CODES.has");
    expect(detectAt).toBeGreaterThan(-1);
    // The detection itself: an HttpError 409 whose body carries one of the
    // gate's codes — read backwards from the .has() call to cover the
    // isHttpError/status guard on the lines just above it.
    const block = ui.slice(detectAt - 500, detectAt + 200);
    expect(block).toContain("isHttpError");
    expect(block).toContain("err.status === 409");
  });

  it("11. the override requires a real reason and resends the link with it", () => {
    const inputAt = ui.indexOf('data-testid="link-override-reason"');
    expect(inputAt).toBeGreaterThan(-1);
    const confirmAt = ui.indexOf('data-testid="link-override-confirm"');
    expect(confirmAt).toBeGreaterThan(-1);
    const block = ui.slice(confirmAt, confirmAt + 900);
    expect(block).toMatch(/disabled=\{[^}]*linkOverrideReason\.trim\(\)\.length\s*<\s*3/);
    expect(block).toContain("linkMutation.mutate({");
    expect(block).toContain("overrideReason: linkOverrideReason");
  });
});
