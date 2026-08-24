import { describe, expect, it } from "vitest";
import {
  impressionMatchesStudyContext,
  resolveBuiltinPromptForStudy,
} from "./aiDraftStudyContext";

describe("aiDraftStudyContext (api-server)", () => {
  it("rejects chest radiograph on CT Brain", () => {
    expect(
      impressionMatchesStudyContext("Normal chest radiograph with no acute abnormalities.", {
        modality: "CT",
        studyDescription: "CT Brain Plain",
      }),
    ).toBe(false);
  });

  it("resolves CT Brain builtin prompt instead of bare modality", () => {
    const templates = {
      "CT Brain Report": "CT BRAIN PROMPT",
      "X-ray Report": "XR PROMPT",
    };
    expect(resolveBuiltinPromptForStudy(templates, "CT", "NCCT Brain")).toBe("CT BRAIN PROMPT");
  });
});
