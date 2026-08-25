import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";

/** Tiny gray JPEG as a key-image stand-in. */
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";

describe("reportPdfGenerator — signature stays on body page", () => {
  it("keeps radiologist name on page 1 for a long MRI report with key images", () => {
    const findings = [
      "White Matter",
      "Multiple hyperintense foci are seen in the periventricular, deep, and subcortical white matter on FLAIR and T2-weighted sequences.",
      "These changes are consistent with Fazekas Grade II small vessel ischemic changes.",
      "No diffusion restriction is present to suggest acute infarction.",
      "Cerebral Hemispheres",
      "Normal morphology and signal characteristics. Gray-white matter differentiation is preserved.",
      "Basal Ganglia and Thalami",
      "Chronic lacunar infarcts are noted in the bilateral basal ganglia.",
      "Otherwise, morphology and signal intensity are preserved. No evidence of acute hemorrhage or calcification.",
      "Brainstem and Posterior Fossa",
      "Brainstem is normal. Mild cerebellar atrophy is noted.",
      "Other Observations",
      "No mass lesion, midline shift, or hydrocephalus. No abnormal susceptibility foci on SWI.",
      "No extra-axial fluid collections. No Post contrast enhancement.",
    ].join("\n");

    const doc = generateReportPDF(
      {
        patientName: "GULU DEVI",
        age: "60 Yrs",
        sex: "F",
        studyDate: "20260824",
        referringDoctor: "DR. SANJAY KUMAR, MBBS",
        clinicalHistory: "Both lower Limb weakness.",
        technique:
          "MRI Brain was performed on a high-field scanner using standard brain protocol including T1W sagittal, T2W axial, FLAIR axial, DWI with ADC mapping, and T2* / SWI sequences.",
        findings,
        impression:
          "Moderate chronic small vessel ischemic changes (Fazekas Grade II).\nChronic lacunar infarcts in bilateral basal ganglia.\nMild cerebellar atrophy.\nNo acute intracranial abnormality.",
        recommendation: "Please correlate with clinical findings. Follow Up Imaging if clinically indicated.",
        reportTitle: "MRI BRAIN PLAIN",
        keyImages: [TINY_JPEG, TINY_JPEG, TINY_JPEG, TINY_JPEG],
      },
      {
        ...DEFAULT_PRINT_SETTINGS,
        show: { ...DEFAULT_PRINT_SETTINGS.show, keyImages: true },
        fontSize: "medium",
      },
      { name: "CARE DIAGNOSTICS" },
      { save: false },
    );

    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const out = "/opt/cursor/artifacts/gulu-devi-signature-fit.pdf";
    const bytes = Buffer.from(doc.output("arraybuffer"));
    writeFileSync(out, bytes);

    // Regression: Gulu Devi PDF had signature alone on page 2.
    expect(doc.getNumberOfPages()).toBe(1);

    const latin1 = bytes.toString("latin1");
    expect(latin1).toContain("GULU DEVI");
    expect(latin1).toContain("Sugandha");
  });
});
