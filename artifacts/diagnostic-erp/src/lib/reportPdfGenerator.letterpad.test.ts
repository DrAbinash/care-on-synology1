import { describe, it, expect } from "vitest";
import { writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";

describe("letter-pad PDF preview artifact", () => {
  it("builds a letter-pad style PDF without browser download", () => {
    const doc = generateReportPDF(
      {
        patientName: "Yashpal Ranjan",
        age: "42 Y",
        sex: "M",
        studyDate: "20260804",
        referringDoctor: "Dr S K Biswas MD FIAMS",
        clinicalHistory: "Low backache.",
        technique: "Multiplanar, multisequence MRI of the lumbosacral spine was performed including T1, T2, and STIR sequences.",
        findings:
          "ALIGNMENT & CURVATURE: Straightening / loss of normal lumbar lordosis is noted, likely due to muscular spasm.\n\nL5-S1: Reduced IV disc space with disc desiccation. Mild diffuse disc bulge with anterior ventral thecal sac compression.\n\nVERTEBRAL BODIES: Endplate marrow signal changes at L5-S1 (Modic changes).\n\nCORD / CAUDA EQUINA: Cord terminates at L1-L2. Normal signal.",
        impression:
          "Straightening / loss of normal lumbar lordosis, likely due to muscular spasm.\nL5-S1 disc desiccation with mild diffuse bulge causing anterior thecal sac compression.\nModic endplate changes at L5-S1.",
        recommendation: "Please correlate with clinical findings.",
        reportTitle: "MRI LUMBOSACRAL (LS) SPINE",
        accessionNumber: "ACC123",
      },
      DEFAULT_PRINT_SETTINGS,
      {
        name: "CARE DIAGNOSTICS",
        address: "Near Bajla Mahila College, St. Francis School Road, Castair's Town, DEOGHAR-814 112 (JHARKHAND)",
        phone: "75490 99099, 99734 97200",
        email: "care.deoghar@gmail.com",
      },
      { save: false },
    );
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const out = "/opt/cursor/artifacts/letterpad-sample.pdf";
    writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
    expect(existsSync(out)).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
