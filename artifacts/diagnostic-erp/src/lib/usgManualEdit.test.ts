import { describe, it, expect } from "vitest";
import { generateUsgFinding, effectiveFindingText } from "./usgFindingBuilder";
import { findingDefById } from "./usgOrganLibrary";
import { manualEditStatus, regenerate, resolveManualEdit } from "./usgManualEdit";

const renalDef = findingDefById("renal_calculus")!;
const base = () => generateUsgFinding(renalDef, { side: "Right", location: "Lower calyx", number: "Single", size: "5", hydronephrosis: "None" }).object;

describe("P2.8 manual-edit safety", () => {
  it("classifies edit status", () => {
    expect(manualEditStatus(base())).toBe("generated_only");
    const edited = { ...base(), editedText: "My own wording." };
    expect(manualEditStatus(edited)).toBe("manual_divergent");
    const acceptedGenerated = { ...base(), editedText: base().findingText };
    expect(manualEditStatus(acceptedGenerated)).toBe("accepted_generated");
  });

  it("regenerate preserves a divergent manual edit and flags reconciliation", () => {
    const o = { ...base(), editedText: "Radiologist wording." };
    const r = regenerate(o, "New generated text.", "New impression.");
    expect(r.needsReconciliation).toBe(true);
    expect(r.manualPreserved).toBe(true);
    expect(r.object.findingText).toBe("New generated text.");     // generated updated
    expect(r.object.editedText).toBe("Radiologist wording.");     // manual kept
    expect(effectiveFindingText(r.object)).toBe("Radiologist wording."); // report still shows manual
  });

  it("regenerate follows generated text when there was no manual edit", () => {
    const r = regenerate(base(), "New generated.", "Imp.");
    expect(r.needsReconciliation).toBe(false);
    expect(effectiveFindingText(r.object)).toBe("New generated.");
  });

  it("reconciliation actions", () => {
    const o = { ...base(), findingText: "Generated v2.", editedText: "Manual." };
    expect(effectiveFindingText(resolveManualEdit(o, "keep_manual"))).toBe("Manual.");
    expect(effectiveFindingText(resolveManualEdit(o, "replace_with_generated"))).toBe("Generated v2.");
    expect(effectiveFindingText(resolveManualEdit(o, "merge", "Merged wording."))).toBe("Merged wording.");
  });
});
