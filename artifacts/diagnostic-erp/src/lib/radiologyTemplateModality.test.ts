import { describe, expect, it } from "vitest";
import { templateCatalogModality, templateModalityMatches } from "./radiologyTemplateModality";

describe("templateCatalogModality", () => {
  it("maps worklist MR to template MRI", () => {
    expect(templateCatalogModality("MR")).toBe("MRI");
    expect(templateCatalogModality("MRI")).toBe("MRI");
  });

  it("maps ultrasound aliases to USG", () => {
    expect(templateCatalogModality("US")).toBe("USG");
    expect(templateCatalogModality("USG")).toBe("USG");
  });

  it("matches MR studies to MRI templates", () => {
    expect(templateModalityMatches("MR", "MRI")).toBe(true);
    expect(templateModalityMatches("MR", "CT")).toBe(false);
  });
});
