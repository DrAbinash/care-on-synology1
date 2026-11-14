/**
 * Item 13 — a study the reading queue does not show must still be signable.
 *
 * `workflow.currentRow` is an element of the SERVER-FILTERED queue
 * (`GET /api/radiology/pacs-worklist?modality=&dateFrom=&dateTo=`), so it is null
 * for a study booked on another day, for a deep link or a Report Hub row, and for
 * any study the radiologist's current modality/date filter excludes. The finalize
 * gauntlet opened by requiring it, so those studies could not be signed at all —
 * measured on 2026-11-08 with four real MRI studies: pixels loaded, technique
 * applied, draft saved and reopened, PDF 630-670 kB and Word 480 kB exported, and
 * the enabled "Confirm & Sign" produced nothing but a toast. Setting `study_date`
 * to that day made all four sign, which is the signature of a queue-window
 * dependency, not a data problem.
 *
 * The repository already solved this for the viewer, the key-images rail and the
 * study lock: identity comes from `resolveOpenStudyIdentity`, which reads the
 * by-id worklist row (`GET /api/radiology/pacs-worklist/:id`) and refuses a row
 * that names a different study. This file pins that the gauntlet now goes through
 * the same door, and — the part that matters for a wrong-patient report — that
 * nothing here widens what may be signed:
 *
 *   - identity must still NAME THIS STUDY, or the resolver yields nothing and the
 *     refusal still fires;
 *   - the billed-study key still comes from the row's own FK, never from the
 *     route param, so the two-id-space P0 `finalizeContextForWorkspaceStudy`
 *     exists to prevent is not re-opened by the new source.
 *
 * No DOM in this environment (see `finalizeStudyIdentity.hardening.test.ts`), so
 * the behaviour is exercised through the two real production functions the
 * gauntlet composes, and the wiring is asserted against the hook's own source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenStudyIdentity, type StudyIdentity } from "./openStudyIdentity";
import { finalizeContextForWorkspaceStudy } from "./radiologyReportLifecycle";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const HOOK = "hooks/radiology-workspace/useStudyFinalize.ts";
const CALLER = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";

/** Comments must not satisfy (or defeat) a wiring check: this file's own prose
 *  names the row it forbids. Same helper as `pacsPickerWiring.contract.test.ts`. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** A `radiology_worklist` row as the by-id detail read returns it, for the study
 *  the workspace has open (row 2), billed to study 77 with a real accession. */
const detailRow = (over: Record<string, unknown> = {}) => ({
  id: 2,
  studyId: 77,
  patientId: 9,
  patientName: "SYNTH PATIENT ONE",
  accessionNumber: "ACC-SYNTH-1",
  studyInstanceUID: "1.2.826.0.1.3680043.9.6001",
  modality: "MR",
  studyDescription: "MRI Brain Plain",
  status: "STUDY_RECEIVED",
  ...over,
});

describe("the identity a queue-filtered study signs with", () => {
  it("comes from the by-id read when the queue row is absent", () => {
    const identity = resolveOpenStudyIdentity({ studyId: 2, detail: detailRow(), queueRow: null });
    expect(identity).not.toBeNull();
    expect(identity!.source).toBe("detail");
    // Every field the gauntlet reads, none of it from the queue.
    expect(identity!.patientId).toBe(9);
    expect(identity!.patientName).toBe("SYNTH PATIENT ONE");
    expect(identity!.modality).toBe("MR");
    // The DICOM description is the one field the resolver did not carry before
    // this change, and the gauntlet needs it three times over: the draft
    // validator's rules, the AI quality evaluation, and the signed title chain.
    expect(identity!.studyDescription).toBe("MRI Brain Plain");
    expect(identity!.accessionNumber).toBe("ACC-SYNTH-1");
    expect(identity!.studyInstanceUID).toBe("1.2.826.0.1.3680043.9.6001");
    // radiology_studies.id — the FK, not the row id.
    expect(identity!.studyId).toBe(77);
  });

  it("fills a blank description from the queue row rather than losing it", () => {
    const identity = resolveOpenStudyIdentity({
      studyId: 2,
      detail: detailRow({ studyDescription: "   " }),
      queueRow: { id: 2, studyDescription: "MRI Brain Plain" },
    });
    expect(identity!.studyDescription).toBe("MRI Brain Plain");
    expect(identity!.source).toBe("merged");
  });

  it("is still nothing when no row names this study — the refusal is not relaxed", () => {
    // A detail read that answers with a DIFFERENT worklist row must not be used
    // as this report's identity, and neither may a stale queue row. Both yield
    // null, which is the condition the gauntlet refuses on.
    expect(resolveOpenStudyIdentity({ studyId: 2, detail: detailRow({ id: 5 }), queueRow: null })).toBeNull();
    expect(
      resolveOpenStudyIdentity({ studyId: 2, detail: null, queueRow: { id: 5, patientId: 11 } }),
    ).toBeNull();
    expect(resolveOpenStudyIdentity({ studyId: 2, detail: null, queueRow: null })).toBeNull();
  });
});

describe("the finalize payload built from that identity", () => {
  const identity = (over: Record<string, unknown> = {}) =>
    resolveOpenStudyIdentity({ studyId: 2, detail: detailRow(over), queueRow: null }) as StudyIdentity;

  it("carries the by-id row's own keys, not the route param", () => {
    const ctx = finalizeContextForWorkspaceStudy({ worklistRowId: 2, row: identity(), linked: null });
    expect(ctx.worklistId).toBe(2);
    expect(ctx.studyId).toBe(77);
    expect(ctx.patientId).toBe(9);
    expect(ctx.modality).toBe("MR");
    expect(ctx.studyDescription).toBe("MRI Brain Plain");
    expect(ctx.accessionNumber).toBe("ACC-SYNTH-1");
    expect(ctx.studyInstanceUID).toBe("1.2.826.0.1.3680043.9.6001");
  });

  it("keeps an unbilled study unbilled instead of inventing a study id", () => {
    // The control that makes the check above non-degenerate: the builder must
    // still answer null for a row whose FK is null. A null `studyId` is the
    // lifecycle's signal to attempt `auto-link-billed-study` and, failing that,
    // to report the skip — handing it the row id 2 instead would attach this
    // signature to somebody else's billed test.
    const ctx = finalizeContextForWorkspaceStudy({ worklistRowId: 2, row: identity({ studyId: null }), linked: null });
    expect(ctx.studyId).toBeNull();
    expect(ctx.worklistId).toBe(2);
  });

  it("leaves the linked sibling alone when there is one", () => {
    const ctx = finalizeContextForWorkspaceStudy({
      worklistRowId: 2,
      row: identity(),
      linked: { studyId: 88, accessionNumber: "ACC-SYNTH-2", studyInstanceUID: "1.2.826.0.1.3680043.9.6002" },
    });
    expect(ctx.linkedStudyId).toBe(88);
    expect(ctx.linkedAccessionNumber).toBe("ACC-SYNTH-2");
    expect(ctx.studyId).toBe(77);
  });
});

describe("the gauntlet is wired to the identity, not to the queue", () => {
  const hook = read(HOOK);
  const live = code(hook);

  it("refuses on an unresolved identity", () => {
    expect(live).toMatch(/if\s*\(\s*!studyId\s*\|\|\s*!openIdentity\s*\)\s*\{/);
  });

  it("does not read the filtered queue anywhere", () => {
    // The whole point: one removed guard is not a fix if six reads still need
    // the row. Re-adding a `workflow.currentRow` read fails this, and so does
    // re-offering it on the options type.
    expect(live, "the gauntlet reads the reading-queue row again").not.toContain("workflow.currentRow");
    expect(live).not.toMatch(/currentRow\s*:/);
  });

  it("answers every identity read from the resolved identity", () => {
    for (const field of [
      "openIdentity.modality",
      "openIdentity.studyDescription",
      "openIdentity.patientId",
      "openIdentity.patientName",
      "row: openIdentity,",
    ]) {
      expect(live, `the gauntlet no longer reads ${field} from the identity`).toContain(field);
    }
  });

  it("is handed the caller's resolved identity — not a queue row through a new door", () => {
    const caller = code(read(CALLER));
    expect(caller).toMatch(/openIdentity:\s*reportIdentity,/);
    // `reportIdentity` is the resolver's memo, fed by the by-id read.
    const memo = caller.slice(caller.indexOf("const reportIdentity = useMemo("));
    expect(memo.slice(0, 400)).toContain("resolveOpenStudyIdentity({");
    expect(memo.slice(0, 400)).toContain("detail: worklistDetailQ.data");
  });

  it("has the identity in the gauntlet's dependency set, so a Retry sees it", () => {
    const lines = live.split("\n").filter((l) => /^\}, \[studyId,/.test(l));
    // Exactly one: without this the check could attach to some other callback.
    expect(lines, "the gauntlet's dependency array is not a single identifiable line").toHaveLength(1);
    expect(lines[0]).toContain("openIdentity");
  });
});
