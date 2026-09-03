import { describe, expect, it } from "vitest";
import { validateComposerOutput } from "./validateOutput";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

function snap(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Cervical Spine",
    regions: ["Cervical Spine"],
    bodyPart: "SPINE_CERVICAL",
    family: "spine",
    spineSegment: "cervical",
    findings: "",
    impression: "",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

function draft(findings: string, impression: string) {
  return {
    findings,
    impression,
    recommendation: "",
    unresolvedQuestions: [] as string[],
    warnings: [] as string[],
  };
}

describe("definite clinical mutations → hard failures", () => {
  it("exact measurement preserved passes", () => {
    const s = snap({
      findings: "The canal measures 8.2 mm at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          findingsText: "Canal AP 8.2 mm at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("The canal measures 8.2 mm at C5-C6.", "Canal stenosis at C5-C6."),
    );
    expect(v.errors).not.toContain("measurement_mutation");
    expect(v.ok).toBe(true);
  });

  it("changed unique measurement fails hard", () => {
    const s = snap({
      findings: "The canal measures 8.2 mm at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          findingsText: "Canal AP 8.2 mm at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("The canal measures 11.0 mm at C5-C6.", "Mild narrowing."),
    );
    expect(v.errors).toContain("measurement_mutation");
    expect(v.ok).toBe(false);
  });

  it("dropped unique measurement fails hard", () => {
    const s = snap({
      findings: "The canal measures 8.2 mm at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          findingsText: "Canal AP 8.2 mm at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "There is canal stenosis at C5-C6 without a recorded measurement.",
        "Canal stenosis.",
      ),
    );
    expect(v.errors).toContain("measurement_mutation");
    expect(v.ok).toBe(false);
  });

  it("right lesion becoming left fails hard", () => {
    const s = snap({
      findings: "Right foraminal disc protrusion at C5-C6.",
      observations: [
        {
          region: "foramen",
          concept: "disc_protrusion",
          level: "C5-C6",
          laterality: "right",
          findingsText: "Right foraminal disc protrusion at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "There is a left foraminal disc protrusion at C5-C6.",
        "Left foraminal protrusion.",
      ),
    );
    expect(v.errors).toContain("laterality_swap");
    expect(v.ok).toBe(false);
  });

  it("bilateral multi-lesion wording does not generate a false hard failure", () => {
    const s = snap({
      findings: "Bilateral foraminal disc protrusions at C5-C6.",
      observations: [
        {
          region: "foramen",
          concept: "disc_protrusion",
          level: "C5-C6",
          laterality: "right",
          findingsText: "Right foraminal disc protrusion at C5-C6",
        },
        {
          region: "foramen",
          concept: "disc_protrusion",
          level: "C5-C6",
          laterality: "left",
          findingsText: "Left foraminal disc protrusion at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "There are bilateral foraminal disc protrusions at C5-C6, right greater than left.",
        "Bilateral foraminal protrusions.",
      ),
    );
    expect(v.errors).not.toContain("laterality_swap");
  });

  it("C5-C6 becoming C4-C5 fails hard", () => {
    const s = snap({
      findings: "Canal stenosis at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          findingsText: "Canal stenosis at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("There is canal stenosis at C4-C5.", "C4-C5 stenosis."),
    );
    expect(v.errors).toContain("level_change");
    expect(v.ok).toBe(false);
  });

  it("legitimate multiple supplied levels pass", () => {
    const s = snap({
      findings: "Canal stenosis at C4-C5 and C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C4-C5",
          findingsText: "Canal stenosis at C4-C5",
        },
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          findingsText: "Canal stenosis at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "Canal stenosis is present at C4-C5 and C5-C6.",
        "Multilevel canal stenosis.",
      ),
    );
    expect(v.errors).not.toContain("level_change");
    expect(v.ok).toBe(true);
  });

  it("mild→severe in the same slot fails hard", () => {
    const s = snap({
      findings: "Mild canal stenosis at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          severity: "mild",
          findingsText: "Mild canal stenosis at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft("There is severe canal stenosis at C5-C6.", "Severe canal stenosis."),
    );
    expect(v.errors).toContain("severity_escalation");
    expect(v.ok).toBe(false);
  });

  it("separate mild and severe lesions do not create a false failure", () => {
    const s = snap({
      findings: "Mild canal stenosis at C4-C5. Severe canal stenosis at C5-C6.",
      observations: [
        {
          region: "canal",
          concept: "stenosis",
          level: "C4-C5",
          severity: "mild",
          findingsText: "Mild canal stenosis at C4-C5",
        },
        {
          region: "canal",
          concept: "stenosis",
          level: "C5-C6",
          severity: "severe",
          findingsText: "Severe canal stenosis at C5-C6",
        },
      ],
    });
    const v = validateComposerOutput(
      s,
      draft(
        "There is mild canal stenosis at C4-C5 and severe canal stenosis at C5-C6.",
        "Multilevel canal stenosis.",
      ),
    );
    expect(v.errors).not.toContain("severity_escalation");
    expect(v.ok).toBe(true);
  });
});
