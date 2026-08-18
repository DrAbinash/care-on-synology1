import { describe, it, expect } from "vitest";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { generateReportPDF, DEFAULT_PRINT_SETTINGS } from "./reportPdfGenerator";
import { CARE_LETTERHEAD_LOGO_DATA_URL, CARE_LETTERHEAD_LOGO_SIZE } from "./careLetterheadLogo";

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
      {
        ...DEFAULT_PRINT_SETTINGS,
        // Stale clinic/settings logos must NOT replace the letter-pad brand.
        header: {
          ...DEFAULT_PRINT_SETTINGS.header,
          logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      },
      {
        name: "CARE DIAGNOSTICS",
        address: "WRONG ADDRESS THAT MUST NOT PRINT",
        phone: "0000000000",
        email: "care.deoghar@gmail.com",
        logoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      },
      { save: false },
    );
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const out = "/opt/cursor/artifacts/letterpad-sample.pdf";
    const bytes = Buffer.from(doc.output("arraybuffer"));
    writeFileSync(out, bytes);
    expect(existsSync(out)).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);

    // Extract text layer (avoids false hits inside embedded PNG binary).
    const text = execFileSync("pdftotext", ["-layout", out, "-"], { encoding: "utf8" });
    expect(text).toContain("DEOGHAR-814 112");
    expect(text).toContain("75490 99099");
    expect(text).toContain("St. Francis School Road");
    expect(text).toMatch(/DEOGHAR-814 112\s*\n\s*\(JHARKHAND\)/);
    expect(text).not.toContain("WRONG ADDRESS");
    expect(text).not.toContain("0000000000");

    // Bundled brand PNG must be present and sized for letter-pad aspect.
    expect(CARE_LETTERHEAD_LOGO_SIZE.width).toBe(1556);
    expect(CARE_LETTERHEAD_LOGO_SIZE.height).toBe(530);
    expect(CARE_LETTERHEAD_LOGO_DATA_URL.startsWith("data:image/png;base64,")).toBe(true);
    expect(bytes.length).toBeGreaterThan(80_000);

    // Public PNG and embedded data URL stay in sync.
    const publicPng = readFileSync(
      new URL("../../public/care-diagnostics-letterhead-logo.png", import.meta.url),
    );
    expect(CARE_LETTERHEAD_LOGO_DATA_URL).toContain(publicPng.toString("base64").slice(0, 80));
  });
});
