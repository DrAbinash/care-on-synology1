/**
 * One-time seed: imports Radiology (186) + Pathology (122) tests from the
 * two Excel sheets provided by the clinic.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run import:test-catalog
 *
 * Safe to re-run — existing tests (matched by uppercased name) are skipped.
 *
 * Room numbers per clinic instructions:
 *   USG  → Room 1 | CT Scan → Room 2 | MRI → Room 4 | Pathology → Room 7
 *   X-Ray / others → blank (left as default "")
 */
import "dotenv/config";
import { db, testsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

// ─── type ────────────────────────────────────────────────────────────────────
interface TestRow {
  code: string;
  name: string;
  category: string;
  price: string;
  duration: string;
  department: string;
  roomNumber: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

// ─── build dataset ───────────────────────────────────────────────────────────

/** [name, price] tuples per department */
const USG_TESTS: [string, number][] = [
  ["ECHO-Color", 2000],
  ["FETAL ANOMALY SCAN (LEVEL II)", 2000],
  ["FETAL ECHO", 3000],
  ["FIBROSCAN/ELASTOGRAPHY", 3600],
  ["FOLLICULAR MONITORING", 2500],
  ["NT-SCAN", 1500],
  ["SONOMAMMOGRAPHY B/L", 3000],
  ["SONOMAMMOGRAPHY U/L", 2000],
  ["SONOSALPINGOGRAPHY", 3000],
  ["TRANSVAGINAL SONOGRAPHY (TVS)", 1800],
  ["USG ANOMALY SCAN (4D)", 3000],
  ["USG BRAIN", 2500],
  ["USG CHEST", 2000],
  ["USG COLOR DOPPLER", 2400],
  ["USG FETAL DOPPLER", 3000],
  ["USG FETAL WELL BEING", 1300],
  ["USG GUIDED ASPIRATION", 2500],
  ["USG GUIDED FNAC", 1000],
  ["USG LIMB DOPPLER B/L", 4800],
  ["USG LIMB DOPPLER U/L", 2500],
  ["USG LOWER ABDOMEN", 1300],
  ["USG SCROTUM/TESTIS", 2200],
  ["USG THYROID", 2400],
  ["USG UPPER ABDOMEN", 1300],
  ["USG WHOLE ABDOMEN", 1300],
  ["USG WHOLE+PREGNANCY", 2000],
  ["USG THIGH DOPPLER", 2400],
  ["USG PENIS DOPPLER", 2400],
  ["USG RENAL DOPPLER B/L", 4800],
  ["USG RENAL DOPPLER U/L", 2400],
  ["USG WHOLE ABDOMEN WITH INGUINAL REGION", 2000],
  ["USG INGUINAL REGION", 2400],
  ["USG EYE", 2000],
];

const XRAY_TESTS: [string, number][] = [
  ["BARIUM ENEMA", 2800],
  ["BARIUM MEAL", 3000],
  ["BARIUM MEAL FOLLOW THROUGH", 3500],
  ["BARIUM SWALLOW", 2500],
  ["CEPHALOMETRY", 600],
  ["INVERTOGRAM", 800],
  ["IVU/IVP", 3200],
  ["OPG OPEN/CLOSE MOUTH", 600],
  ["OPG PAN VIEW", 600],
  ["RGU", 2800],
  ["SINOGRAM/FISTULOGRAM", 2400],
  ["X-RAY TM JOINT", 700],
  ["T-TUBE CHOLANGIOGRAM", 4000],
  ["URETHROGRAM (RGU+MCU)", 3400],
  ["X RAY ERECT/SUPINE", 800],
  ["X-RAY ANKLE JOINT AP/LAT", 800],
  ["X-RAY AP", 400],
  ["XRAY AP/LAT", 800],
  ["X-RAY AP/LAT 11X14", 1200],
  ["XRAY CERVICAL SPINE AP/LAT", 800],
  ["X-RAY CHEST", 400],
  ["XRAY DL SPINE AP/LAT", 800],
  ["X-RAY ELBOW JOINT AP/LAT", 800],
  ["X-RAY HIP JOINT AP/LAT", 800],
  ["X-RAY KNEE JOINT AP/LAT", 800],
  ["XRAY KUB", 400],
  ["X-RAY LAT", 400],
  ["XRAY LS SPINE AP/LAT", 800],
  ["X-RAY NASAL BONE", 400],
  ["X-RAY PELVIS AP", 400],
  ["X-RAY PNS", 400],
  ["X-RAY SHOULDER JOINT AP/LAT", 800],
  ["X-RAY SKULL AP/LAT", 800],
  ["X-RAY WRIST JOINT AP/LAT", 800],
  ["DIGITAL MAMMOGRAPHY (SINGLE)", 2000],
  ["DIGITAL MAMMOGRAPHY (BOTH)", 3000],
  ["LOOPOGRAM", 3200],
  ["X-RAY BOTH FOREARMS AP/LAT VIEW", 1600],
  ["X-RAY HAND - AP & LAT", 800],
  ["X-RAY MASTOIDS", 800],
  ["X-RAY THIGH - AP & LAT", 800],
  ["X-RAY THUMB - AP & LAT", 800],
  ["X-RAY WRIST - AP & LAT", 800],
  ["X-RAY DORSAL SPINE AP/LAT", 800],
  ["X-RAY FEMUR AP/LAT", 800],
  ["X-RAY FINGER AP/LAT", 800],
  ["X-RAY FOOT AP & OBL", 800],
  ["X-RAY FOREARM AP/LAT", 800],
  ["HSG", 2200],
];

const CT_TESTS: [string, number][] = [
  ["CBCT", 5000],
  ["CECT HEAD", 4000],
  ["CECT NECK", 7500],
  ["CECT ORBIT", 7500],
  ["CECT PNS", 7500],
  ["CT ANKLE JOINT", 7500],
  ["CT BODY PART", 7500],
  ["CT BRAIN", 3000],
  ["CT BRAIN EMRG", 3600],
  ["CT CERVICAL SPINE", 7500],
  ["CT CHEST", 7500],
  ["CT DL SPINE", 7500],
  ["CT FACE WITH 3D RECONSTRUCTION", 7500],
  ["CT HIP JOINT", 7500],
  ["CT KNEE JOINT", 7500],
  ["CT KNEE U/L", 7500],
  ["CT LOWER ABDOMEN CONTRAST", 7500],
  ["CT LS SPINE", 7500],
  ["CT ORBIT", 7500],
  ["CT PELVIS", 7500],
  ["CT PELVIS WITH 3D RECONSTRUCTION", 7500],
  ["CT TEMPORAL & MASTOID", 7500],
  ["CT THORACIC SPINE", 7500],
  ["CT TLS SPINE", 10000],
  ["CT TM JOINT", 7500],
  ["CT UPPER ABDOMEN CONTRAST", 7500],
  ["CT UROGRAM", 8000],
  ["CT WHOLE ABDOMEN CONTRAST", 10000],
  ["CT WRIST JOINT", 7500],
  ["NCCT HEAD", 2500],
  ["NCCT KUB", 7000],
];

const MRI_TESTS: [string, number][] = [
  ["DYNAMIC MR SELLA WITH CONTRAST", 11500],
  ["MR ANGIOGRAPHY", 4500],
  ["MR SPECTROSCOPY", 3000],
  ["MR VENOGRAPHY", 3500],
  ["MRA OF NECK AND CEREBRAL VESSELS", 10000],
  ["MRCP", 7000],
  ["MRI BRACHIAL PLEXUS", 8500],
  ["MRI BRAIN", 7500],
  ["MRI BRAIN + ANGIO", 11000],
  ["MRI BRAIN WITH EPILEPSY PROTOCOL", 10000],
  ["MRI BRAIN WITH SPECTROSCOPY", 10500],
  ["MRI BRAIN WITH TACTOGRAPHY", 10000],
  ["MRI CARDIAC", 15000],
  ["MRI CARTIGRAPHY", 8500],
  ["MRI CERVICAL SPINE", 8500],
  ["MRI CERVICAL SPINE SCREENING", 3000],
  ["MRI CHEST/ MEDIASTINUM", 8500],
  ["MRI CISTERNOGRAPHY", 9500],
  ["MRI CV JUNCTION", 8500],
  ["MRI DL SPINE", 8500],
  ["MRI DORSAL SPINE SCREENING", 3000],
  ["MRI ENTEROGRAPHY", 12500],
  ["MRI FETAL", 11000],
  ["MRI FISTULOGRAM", 8500],
  ["MRI HAND/ PALM/ FINGER(SINGLE)", 8500],
  ["MRI JOINT", 8500],
  ["MRI JOINT- SHOULDER JOINT( SINGLE)", 8500],
  ["MRI JOINT-ANKLE JOINT(SINGLE)", 8500],
  ["MRI JOINT-ELBOW JOINT(SINGLE)", 8500],
  ["MRI JOINT-HIP JOINT(B/L)/ PELVIS", 8500],
  ["MRI JOINT-KNEE JONIT(SINGLE)", 8500],
  ["MRI JOINT-T.M. JOINT(SINGLE)", 8500],
  ["MRI JOINT-WRIST JOINT(SINGLE)", 8500],
  ["MRI L.S PLEXUS", 8500],
  ["MRI LOWER ABDOMEN", 8500],
  ["MRI LS SPINE", 8500],
  ["MRI LS SPINE SCREENING", 3000],
  ["MRI LS SPINE WITH SCREENING WHOLE SPINE", 14500],
  ["MRI MAMMOGRAPHY B/L", 15000],
  ["MRI MAMMOGRAPHY U/L", 8500],
  ["MRI MANDIBLE/ JAW", 8500],
  ["MRI MYELOGRAM", 6000],
  ["MRI NECK (PLAIN WITH CONTRAST)", 11000],
  ["MRI NECK VESSELS / CAROTID ARTERY", 8500],
  ["MRI NECK+ANGIO", 12500],
  ["MRI ORBIT/ FACE", 8500],
  ["MRI PITUITARY DYNAMIC STUDY", 10500],
  ["MRI PNS", 8500],
  ["MRI PROSTATE (DYNAMIC CONTRAST + SPECTRO)", 12500],
  ["MRI PROTOCOL", 2500],
  ["MRI RENAL ANGIOGRAPHY", 8500],
  ["MRI REPRODUCTIVE SYSTEM", 8500],
  ["MRI S.I. JOINT", 8500],
  ["MRI SCREENING", 3000],
  ["MRI SCROTUM", 8500],
  ["MRI TONGUE", 8500],
  ["MRI UPPER ABDOMEN", 8500],
  ["MRI UPPER LIMB ANGIOGRAPHY", 12500],
  ["MRI UROGRAM", 8500],
  ["MRI VENOGRAM LOWER LIMB U/L", 11000],
  ["MRI WHOLE ABDOMEN", 12500],
  ["MRI WHOLE SPINE SCREENING", 9000],
];

// Miscellaneous Radiology
const CARDIOLOGY_TESTS: [string, number][] = [
  ["ECG", 400],
  ["TMT", 2500],
];

const NEUROLOGY_TESTS: [string, number][] = [
  ["EEG", 2000],
  ["EMG/NCV B/L", 4000],
  ["EMG/NCV U/L", 2500],
];

const PROCEDURE_TESTS: [string, number][] = [
  ["BLOOD TRANSFUSION", 2000],
  ["DIALYSIS", 1300],
  ["DIALYSIS DOUBLE LUMEN CATHETER", 9000],
  ["DIALYSIS WITH DAILYZER", 2200],
];

const ENDOSCOPY_TESTS: [string, number][] = [
  ["ENDOSCOPY GI UPPER", 2500],
];

const PULMONOLOGY_TESTS: [string, number][] = [
  ["PFT", 2500],
];

const PATHOLOGY_TESTS: [string, number][] = [
  ["24 Hour Urine Proteine", 1200],
  ["ABO(RH)", 50],
  ["AFB", 1500],
  ["ALBUMIN", 100],
  ["ALKALINE PHOSPHATASE", 100],
  ["ALLERGY (SERUM)", 9500],
  ["AMH", 2800],
  ["AMYLASE", 700],
  ["ANA PROFILE", 3500],
  ["Anemia Profile", 5000],
  ["ANTI CCP", 2250],
  ["ASO TITRE", 250],
  ["B HCG", 1200],
  ["BILE SALT PIGMENT URO", 100],
  ["BILIRUBIN", 100],
  ["Bilirubin (Total)", 100],
  ["BIOPSY BIG", 3500],
  ["BIOPSY MEDIUM", 2500],
  ["BIOPSY SMALL", 1800],
  ["BLOOD SUGAR ( FASTING )", 50],
  ["BLOOD SUGAR ( PP )", 50],
  ["BLOOD SUGAR ( RANDOM)", 50],
  ["BLOOD UREA", 100],
  ["BT,CT", 50],
  ["C3", 800],
  ["C4", 800],
  ["CA 15.3", 1000],
  ["CA 19.9", 1800],
  ["CA-125", 2000],
  ["CA125", 2000],
  ["CALCIUM ( Ca)", 200],
  ["CB-NAAT", 2500],
  ["CBC(COMPLETE BLOOD COUNT)", 350],
  ["CBC,BS,BU,S.CREAT,TSH", 1500],
  ["CEA", 1200],
  ["CHLORIDE (Cl)", 200],
  ["CHOLESTROL", 200],
  ["COOMB'S TEST", 2000],
  ["CORTISOL", 1200],
  ["CPK MP", 1000],
  ["CRP", 300],
  ["D - DIMER", 1600],
  ["DENGU", 1200],
  ["DOUBLE MARKER", 3000],
  ["ESR", 50],
  ["FASTING  INSULIN", 1250],
  ["FILARIA( ANTIGEN)", 900],
  ["FNAC", 2000],
  ["FSH", 900],
  ["FT3,FT4,TSH", 1500],
  ["FT4,TSH", 1250],
  ["HB", 50],
  ["HB ELECTROPHORESIS", 1500],
  ["HB,TC,DC,ESR", 150],
  ["HBAIC", 700],
  ["HBSAG", 150],
  ["HCV", 600],
  ["HIV I & II", 300],
  ["HLA-B27", 2500],
  ["HSF", 200],
  ["IGA", 800],
  ["IGE", 1200],
  ["IRON", 650],
  ["IRON & TIBC", 700],
  ["IRON PROFILE", 2500],
  ["KALAZAR", 900],
  ["KFT ( RENAL FUNCTION TEST)", 800],
  ["LDH", 600],
  ["LFT ( LIVER FUNCTION TEST)", 550],
  ["LH", 900],
  ["LIPASE", 700],
  ["LIPID PROFILE", 600],
  ["MP(SLIDE)", 100],
  ["MT", 100],
  ["OGTT", 200],
  ["PERIPHERAL BLOOD SMEAR", 500],
  ["PHOSPHORUS", 700],
  ["Platelet Counts", 200],
  ["PLEURAL FLUID", 2500],
  ["POTTASIUM (K)", 200],
  ["PROTHROMBIN TIME", 300],
  ["PSA", 1200],
  ["PVPF ANTIGEN", 300],
  ["QUADRAPLE MARKER", 3500],
  ["RA FACTOR", 250],
  ["Rubella IgG Antiboby", 1200],
  ["RUBELLA IGM ANTIBODY", 1200],
  ["SERUM CREATININE", 100],
  ["SERUM LITHIUM", 1000],
  ["SERUM PROLACTIN", 1500],
  ["SGOT", 100],
  ["SGPT", 100],
  ["SKIN AFB", 1500],
  ["SODIUM (Na)", 200],
  ["SPUTAM CB", 4000],
  ["SPUTAM GOLD", 3500],
  ["STOOL R/E", 200],
  ["SWAB CULTURE", 1500],
  ["T3,T4,TSH", 700],
  ["TB GOLD", 3500],
  ["TC,DC", 50],
  ["TESTOSTERONE FREE", 1800],
  ["TESTOSTERONE TOTAL", 1000],
  ["THALASSEMIA PROFILE", 1700],
  ["THROAT SWAB CULTURE", 1500],
  ["TORCH PROFILE", 4500],
  ["TOTAL PROTEIN", 200],
  ["TRIGLYCERIDES", 200],
  ["TROP-T", 800],
  ["TSH", 300],
  ["UPT", 150],
  ["URIC ACID", 100],
  ["URINE C/S", 350],
  ["URINE PCR(UPCR)", 1000],
  ["URINE PROTEIN CREATININE", 900],
  ["URINE R/E", 100],
  ["VDRL", 100],
  ["VIT- B12", 1500],
  ["VIT -D", 1600],
  ["VIT -D 3", 2300],
  ["Vitamine A", 3000],
  ["WIDAL", 100],
];

// ─── assemble all rows ───────────────────────────────────────────────────────
function makeRows(
  tests: [string, number][],
  prefix: string,
  category: string,
  department: string,
  roomNumber: string,
  startIdx = 1,
): TestRow[] {
  return tests.map(([name, price], i) => ({
    code: `${prefix}${pad(startIdx + i)}`,
    name,
    category,
    price: String(price),
    duration: "1 Day",
    department,
    roomNumber,
  }));
}

const ALL_ROWS: TestRow[] = [
  ...makeRows(USG_TESTS,        "USG",  "Radiology",    "USG",         "1"),
  ...makeRows(XRAY_TESTS,       "XR",   "Radiology",    "X-Ray",       ""),
  ...makeRows(CT_TESTS,         "CT",   "Radiology",    "CT Scan",     "2"),
  ...makeRows(MRI_TESTS,        "MRI",  "Radiology",    "MRI",         "4"),
  ...makeRows(CARDIOLOGY_TESTS, "CARD", "Cardiology",   "Cardiology",  ""),
  ...makeRows(NEUROLOGY_TESTS,  "NEU",  "Neurology",    "Neurology",   ""),
  ...makeRows(PROCEDURE_TESTS,  "PROC", "Procedure",    "Procedure",   ""),
  ...makeRows(ENDOSCOPY_TESTS,  "ENDO", "Endoscopy",    "Endoscopy",   ""),
  ...makeRows(PULMONOLOGY_TESTS,"PUL",  "Pulmonology",  "Pulmonology", ""),
  ...makeRows(PATHOLOGY_TESTS,  "PATH", "Pathology",    "Pathology",   "7"),
];

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Processing ${ALL_ROWS.length} test entries…`);

  // 1. Fetch existing test names (case-insensitive) and codes
  const existingRows = await db
    .select({ name: testsTable.name, code: testsTable.code })
    .from(testsTable);

  const existingNames = new Set(existingRows.map((r) => r.name.toUpperCase().trim()));
  const existingCodes = new Set(existingRows.map((r) => r.code));

  // 2. Filter out already-present tests
  const toInsert = ALL_ROWS.filter(
    (r) => !existingNames.has(r.name.toUpperCase().trim()),
  );

  console.log(
    `Already in DB: ${existingNames.size} matched. ` +
    `Inserting ${toInsert.length} new tests…`,
  );

  if (toInsert.length === 0) {
    console.log("Nothing to insert — all tests already exist.");
    process.exit(0);
  }

  // 3. Resolve any code collisions (edge-case: re-run after partial import)
  //    Just bump the numeric suffix until we find a free code.
  for (const row of toInsert) {
    let code = row.code;
    let n = 1000;
    while (existingCodes.has(code)) {
      const prefix = code.replace(/\d+$/, "");
      code = `${prefix}${pad(n++, 4)}`;
    }
    row.code = code;
    existingCodes.add(code);
  }

  // 4. Batch insert in chunks of 50
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const result = await db
      .insert(testsTable)
      .values(
        chunk.map((r) => ({
          code: r.code,
          name: r.name,
          category: r.category,
          price: r.price,
          duration: r.duration,
          department: r.department,
          roomNumber: r.roomNumber,
          testType: "inhouse",
          isActive: true,
        })),
      )
      .returning({ id: testsTable.id });
    inserted += result.length;
    process.stdout.write(`  Inserted: ${inserted}/${toInsert.length}\r`);
  }

  console.log(`\nDone. ${inserted} new tests inserted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
