import { describe, expect, it } from "vitest";
import { useWorkspace } from "./store";

describe("setStudies idempotency (React #185 guard)", () => {
  it("does not replace studies when content is unchanged", () => {
    const store = useWorkspace.getState();
    const row = {
      id: 1,
      patientId: 9,
      patientName: "Test",
      accessionNumber: "A1",
      studyInstanceUID: "1.2.3",
      modality: "MR",
      status: "received",
      priority: "routine",
      studyDescription: "Brain",
      bodyPart: "Brain",
    };
    store.setStudies([row, { ...row, id: 2, accessionNumber: "A2" }]);
    const first = useWorkspace.getState().studies;
    store.setStudies([row, { ...row, id: 2, accessionNumber: "A2" }]);
    const second = useWorkspace.getState().studies;
    expect(second).toBe(first);
  });

  it("updates when a field changes", () => {
    const store = useWorkspace.getState();
    store.setStudies([{ id: 1, patientName: "A", accessionNumber: "X", modality: "CT" }]);
    const first = useWorkspace.getState().studies;
    store.setStudies([{ id: 1, patientName: "B", accessionNumber: "X", modality: "CT" }]);
    const second = useWorkspace.getState().studies;
    expect(second).not.toBe(first);
    expect(second[0]?.patient.name).toBe("B");
  });
});
