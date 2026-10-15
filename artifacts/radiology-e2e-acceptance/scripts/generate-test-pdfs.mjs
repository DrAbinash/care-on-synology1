/**
 * Generate 10 test PDFs from the synthetic test case manifest.
 * Uses the existing reportPdfGenerator from the CARE codebase.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the PDF generator from the CARE codebase
const generatorPath = join(__dirname, "../../diagnostic-erp/src/lib/reportPdfGenerator.ts");
const generatorUrl = `file:///${generatorPath.replace(/\\/g, "/")}`;
const { generateReportPDF, DEFAULT_PRINT_SETTINGS } = await import(generatorUrl);

// Load test cases
const manifestPath = join(__dirname, "../manifests/test-cases.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// Output directory
const reportsDir = join(__dirname, "../reports");
mkdirSync(reportsDir, { recursive: true });

// Clinic info (synthetic)
const clinic = {
  name: "CARE DIAGNOSTICS (TEST)",
  address: "TEST ADDRESS — NOT FOR CLINICAL USE",
  phone: "TEST PHONE",
  email: "test@example.com",
};

// Print settings with watermark
const settings = {
  ...DEFAULT_PRINT_SETTINGS,
  watermark: "SYNTHETIC TEST REPORT — NOT FOR CLINICAL USE",
  watermarkOpacity: 0.15,
  show: {
    ...DEFAULT_PRINT_SETTINGS.show,
    keyImages: false, // No actual images in this test
  },
};

console.log(`Generating ${manifest.cases.length} test PDFs...\n`);

for (const testCase of manifest.cases) {
  console.log(`Generating PDF for ${testCase.id}: ${testCase.exam} (${testCase.polarity})`);

  // Build ReportData from test case
  const reportData = {
    patientName: testCase.patient.name,
    age: String(testCase.patient.age),
    sex: testCase.patient.sex,
    accessionNumber: testCase.patient.accession,
    uhid: testCase.patient.uhid,
    studyDate: new Date().toISOString().split("T")[0],
    referringDoctor: "TEST REFERRING DOCTOR",
    modality: testCase.study.modality,
    bodyPart: testCase.study.bodyPart,
    clinicalHistory: testCase.clinicalIndication,
    technique: testCase.technique,
    findings: testCase.findings,
    impression: testCase.impression,
    recommendation: testCase.recommendation || "",
    comparison: "",
    measurements: testCase.measurements.map((m) => ({
      label: `${m.level} Canal AP`,
      value: `${m[m.unit === "mm" ? "canalAP" : m.unit]} ${m.unit}`,
    })),
    keyImages: [], // No actual images
    reportTitle: testCase.exam,
    reportingScopeNote: testCase.screeningLimitation || "",
    printedBy: "E2E ACCEPTANCE TEST",
  };

  try {
    const pdf = generateReportPDF(reportData, settings, clinic);
    const pdfPath = join(reportsDir, `${testCase.id}.pdf`);
    writeFileSync(pdfPath, pdf.output("arraybuffer"));
    console.log(`  ✓ Saved: ${pdfPath}\n`);
  } catch (error) {
    console.error(`  ✗ Error generating PDF for ${testCase.id}:`, error.message);
    console.error(error.stack);
  }
}

console.log("\nPDF generation complete.");
console.log(`Output directory: ${reportsDir}`);
