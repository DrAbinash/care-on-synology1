import { describe, expect, it } from "vitest";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { resolveNormalBootstrapFormat } from "../normalBootstrap";
import { DEFAULT_REPORT_FORMATS } from "../report-formats-library";
import { ownedBaselineCatalog } from "./index";

const FORMATS = DEFAULT_REPORT_FORMATS;

function ctx(partial: {
  modality: string;
  region: string;
  studyDescription: string;
}) {
  return buildReportingStudyContext({
    modality: partial.modality,
    studyDescription: partial.studyDescription,
    regions: [partial.region],
    source: "auto",
  });
}

/** Every Phase 2 owned format must resolve status:"apply", never ambiguous. */
describe("Phase 2 normalBootstrap — owned formats resolve uniquely", () => {
  const cases: Array<{ name: string; region: string; studyDescription: string }> = [
    { name: "MRI Brain — Standard Normal", region: "Brain", studyDescription: "MRI BRAIN PLAIN" },
    { name: "MRI Cervical Spine — Standard Normal", region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" },
    { name: "MRI Knee — Standard Normal", region: "Knee", studyDescription: "MRI KNEE" },
    { name: "MRI Brain — Screening Normal", region: "Brain", studyDescription: "MRI BRAIN SCREENING" },
    { name: "MRI Cervical Spine — Screening Normal", region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE SCREENING" },
    { name: "MRI Dorsal Spine — Screening Normal", region: "Dorsal Spine", studyDescription: "MRI DORSAL SPINE SCREENING" },
    { name: "MRI LS Spine — Screening Normal", region: "LS Spine", studyDescription: "MRI LS SPINE SCREENING" },
    { name: "MRI Whole Spine — Screening Normal", region: "Whole Spine", studyDescription: "MRI WHOLE SPINE SCREENING" },
  ];

  it("catalog lists exactly the 8 Phase 2 formats under test", () => {
    expect(ownedBaselineCatalog().map((e) => e.name).sort()).toEqual(
      cases.map((c) => c.name).sort(),
    );
  });

  for (const c of cases) {
    it(`${c.name} → apply (never ambiguous)`, () => {
      const decision = resolveNormalBootstrapFormat({
        ctx: ctx({ modality: "MR", region: c.region, studyDescription: c.studyDescription }),
        formats: FORMATS,
      });
      expect(decision?.status, c.name).toBe("apply");
      expect(decision?.status).not.toBe("ambiguous");
      if (decision?.status === "apply") {
        expect(decision.format.name).toBe(c.name);
        expect(decision.format.baselineManifest?.kind).toBe("care.full_report_baseline.v1");
      }
    });
  }
});
