import { describe, expect, it } from "vitest";
import { useWorkspace } from "./store";

describe("setField / mergeField idempotency (React #185 guard)", () => {
  it("setField is a no-op when text and provenance are unchanged", () => {
    const store = useWorkspace.getState();
    store.setField("findings", "Normal liver.", { source: "manual", replaceProvenance: true });
    const beforeDirty = useWorkspace.getState().isDirty;
    const beforeProv = useWorkspace.getState().fieldProvenance.findings;
    store.setField("findings", "Normal liver.", { source: "manual", replaceProvenance: true });
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe("Normal liver.");
    expect(after.fieldProvenance.findings).toBe(beforeProv);
    expect(after.isDirty).toBe(beforeDirty);
  });

  it("mergeField is a no-op when merge produces identical text and provenance", () => {
    const store = useWorkspace.getState();
    store.replaceField("impression", "No acute abnormality.", "template");
    const before = useWorkspace.getState().impressionText;
    store.mergeField("impression", "", "quick-findings");
    expect(useWorkspace.getState().impressionText).toBe(before);
  });

  it("setEditorContent is a no-op when all fields already match", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      findings: "F",
      impression: "I",
      recommendation: "R",
      technique: "T",
      clinicalHistory: "H",
    });
    const snap = useWorkspace.getState();
    store.setEditorContent({
      findings: snap.findingsText,
      impression: snap.impressionText,
      recommendation: snap.recommendationText,
      technique: snap.techniqueText,
      clinicalHistory: snap.clinicalHistoryText,
    });
    expect(useWorkspace.getState().findingsText).toBe("F");
    expect(useWorkspace.getState().isDirty).toBe(true);
  });
});
