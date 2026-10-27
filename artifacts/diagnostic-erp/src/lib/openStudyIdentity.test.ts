import { describe, it, expect } from "vitest";
import { resolveOpenStudyIdentity } from "./openStudyIdentity";

/**
 * The defect these tests exist for: a report stays open while the reading queue is
 * filtered to a modality/date that excludes its study, `workflow.currentRow` goes
 * null, and the image controls vanished with it because identity rode on the queue
 * row. Identity must come from the by-id worklist read instead.
 */
const MRI_UID = "1.2.826.0.1.3680043.9.5500.3";
const US_UID = "1.2.826.0.1.3680043.9.5500.7";

const detailRow = (over: Record<string, unknown> = {}) => ({
  id: 2,
  studyId: 77,
  patientId: 9,
  patientName: "US SYNTH CASE",
  accessionNumber: "ACC-US-5507",
  studyInstanceUID: US_UID,
  modality: "US",
  status: "STUDY_RECEIVED",
  ...over,
});

describe("resolveOpenStudyIdentity", () => {
  it("still knows the study when the queue filter excludes it", () => {
    const identity = resolveOpenStudyIdentity({ studyId: 2, detail: detailRow(), queueRow: null });
    expect(identity).toMatchObject({
      worklistId: 2,
      studyId: 77,
      patientId: 9,
      accessionNumber: "ACC-US-5507",
      studyInstanceUID: US_UID,
      source: "detail",
    });
  });

  it("uses the queue row while the by-id read is in flight, so nothing flickers", () => {
    const identity = resolveOpenStudyIdentity({
      studyId: 2,
      detail: null,
      queueRow: { id: 2, studyInstanceUID: US_UID, accessionNumber: "ACC-US-5507" },
    });
    expect(identity).toMatchObject({ studyInstanceUID: US_UID, accessionNumber: "ACC-US-5507", source: "queue" });
  });

  it("prefers the by-id row field by field, and fills gaps from the queue", () => {
    const identity = resolveOpenStudyIdentity({
      studyId: 2,
      detail: detailRow({ patientName: null }),
      queueRow: { id: 2, patientName: "US SYNTH CASE", studyInstanceUID: "  " },
    });
    expect(identity).toMatchObject({ patientName: "US SYNTH CASE", studyInstanceUID: US_UID, source: "merged" });
  });

  it("refuses a row that names a different study — never borrow another report's identity", () => {
    expect(resolveOpenStudyIdentity({ studyId: 2, detail: detailRow({ id: 3 }), queueRow: null })).toBeNull();
    expect(resolveOpenStudyIdentity({
      studyId: 2,
      detail: null,
      queueRow: { id: 1, studyInstanceUID: MRI_UID, accessionNumber: "ACC-MRI-5503" },
    })).toBeNull();
  });

  it("keeps the good row when only one of the two is foreign", () => {
    const identity = resolveOpenStudyIdentity({
      studyId: 2,
      detail: detailRow({ id: 1, studyInstanceUID: MRI_UID }),
      queueRow: detailRow(),
    });
    expect(identity?.studyInstanceUID).toBe(US_UID);
    expect(identity?.source).toBe("queue");
  });

  it("returns nothing without a study to identify", () => {
    for (const studyId of [null, undefined, 0, -1, Number.NaN]) {
      expect(resolveOpenStudyIdentity({ studyId, detail: detailRow(), queueRow: detailRow() })).toBeNull();
    }
  });

  it("treats blank and non-numeric fields as absent rather than as values", () => {
    const identity = resolveOpenStudyIdentity({
      studyId: 2,
      detail: detailRow({ patientId: 0, accessionNumber: "   ", studyId: null }),
      queueRow: { id: 2, patientId: 9, accessionNumber: "ACC-US-5507", studyId: 77 },
    });
    expect(identity).toMatchObject({ patientId: 9, accessionNumber: "ACC-US-5507", studyId: 77 });
  });

  it("keeps a null bill link null instead of inventing one", () => {
    const identity = resolveOpenStudyIdentity({ studyId: 2, detail: detailRow({ studyId: null }), queueRow: null });
    expect(identity?.studyId).toBeNull();
    expect(identity?.worklistId).toBe(2);
  });
});
