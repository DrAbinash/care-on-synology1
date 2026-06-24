import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const API_BASE = process.env.API_BASE_URL || "http://localhost:8080";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "1234";

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function runTests() {
  console.log("🚀 Starting PACS Sync Integration Verification...");

  const prefix = `T-${Date.now().toString().slice(-4)}`;

  // Helper to create a specific patient
  async function getOrCreatePatient(patId, name) {
    const res = await pool.query(
      `INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
       VALUES ($1, $2, $3, '1990-01-01', 'male', '0000000000')
       ON CONFLICT DO NOTHING RETURNING id`,
      [patId, name.split("^")[0], name.split("^")[1] || ""]
    );
    let id = res.rows[0]?.id;
    if (!id) {
      const existing = await pool.query(`SELECT id FROM patients WHERE patient_id = $1`, [patId]);
      id = existing.rows[0].id;
    }
    return id;
  }

  // Helper to insert a billing/radiology study
  async function createRadiologyStudy(patDbId, accNum, testId = 1, status = "scheduled", studyInstanceUid = null) {
    const res = await pool.query(
      `INSERT INTO radiology_studies (accession_number, patient_id, test_id, modality, status, study_date, study_instance_uid)
       VALUES ($1, $2, $3, 'CT', $4, CURRENT_DATE, $5)
       RETURNING id, status, accession_number, study_instance_uid`,
      [accNum, patDbId, testId, status, studyInstanceUid]
    );
    return res.rows[0];
  }

  // Helper to post to the intake API
  async function postIntake(payload) {
    const res = await fetch(`${API_BASE}/api/internal/radiology/studies`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INTERNAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  // --- TEST SCENARIO 1: Post payload with numeric studyId ---
  console.log("\n--- TEST SCENARIO 1: Link by numeric studyId ---");
  const patId1 = `${prefix}-P1`;
  const patDbId1 = await getOrCreatePatient(patId1, "John^One");
  const acc1 = `${prefix}-ACC-1`;
  const study1 = await createRadiologyStudy(patDbId1, acc1);
  console.log(`Created study ID ${study1.id} with accession ${acc1}`);

  const payload1 = {
    studyId: study1.id,
    accessionNumber: acc1,
    patientName: "John^One",
    patientId: patId1,
    studyInstanceUID: `1.2.3.4.999.1.${Date.now()}`,
    modality: "CT",
    studyDescription: "CT HEAD"
  };

  const res1 = await postIntake(payload1);
  console.log("Response:", res1);
  if (res1.status !== 201) throw new Error("Scenario 1 failed: status not 201");

  const dbStudy1 = await pool.query(`SELECT status, study_instance_uid FROM radiology_studies WHERE id = $1`, [study1.id]);
  console.log("DB State study 1:", dbStudy1.rows[0]);
  if (dbStudy1.rows[0].status !== "acquired") throw new Error("Scenario 1 failed: status is not acquired");
  if (dbStudy1.rows[0].study_instance_uid !== payload1.studyInstanceUID) throw new Error("Scenario 1 failed: study_instance_uid not set");

  // --- TEST SCENARIO 2: Post payload with accessionNumber only ---
  console.log("\n--- TEST SCENARIO 2: Link by accessionNumber only ---");
  const patId2 = `${prefix}-P2`;
  const patDbId2 = await getOrCreatePatient(patId2, "John^Two");
  const acc2 = `${prefix}-ACC-2`;
  const study2 = await createRadiologyStudy(patDbId2, acc2);
  console.log(`Created study ID ${study2.id} with accession ${acc2}`);

  const payload2 = {
    accessionNumber: acc2,
    patientName: "John^Two",
    patientId: patId2,
    studyInstanceUID: `1.2.3.4.999.2.${Date.now()}`,
    modality: "CT",
    studyDescription: "CT HEAD"
  };

  const res2 = await postIntake(payload2);
  console.log("Response:", res2);
  if (res2.status !== 201) throw new Error("Scenario 2 failed: status not 201");

  const dbStudy2 = await pool.query(`SELECT status, study_instance_uid FROM radiology_studies WHERE id = $1`, [study2.id]);
  console.log("DB State study 2:", dbStudy2.rows[0]);
  if (dbStudy2.rows[0].status !== "acquired") throw new Error("Scenario 2 failed: status is not acquired");

  // --- TEST SCENARIO 3 & 5: Post payload with StudyInstanceUID and repost same study ---
  console.log("\n--- TEST SCENARIO 3 & 5: StudyInstanceUID only & repost deduplication ---");
  const patId3 = `${prefix}-P3`;
  const patDbId3 = await getOrCreatePatient(patId3, "John^Three");
  const acc3 = `${prefix}-ACC-3`;
  const specUID = `1.2.3.4.999.3.SPECIAL.${Date.now()}`;
  const study3 = await createRadiologyStudy(patDbId3, acc3, 1, "scheduled", specUID);
  console.log(`Created study ID ${study3.id} with accession ${acc3} and UID ${specUID}`);

  const payload3 = {
    accessionNumber: `${acc3}-ALT`, // different accession, should match by StudyInstanceUID
    patientName: "John^Three",
    patientId: patId3,
    studyInstanceUID: specUID,
    modality: "CT",
    studyDescription: "CT HEAD"
  };

  const res3_1 = await postIntake(payload3);
  console.log("Response (first post):", res3_1);
  if (res3_1.status !== 201) throw new Error("Scenario 3 failed: first post status not 201");

  const dbStudy3_1 = await pool.query(`SELECT status FROM radiology_studies WHERE id = $1`, [study3.id]);
  console.log("DB State study 3 after first post:", dbStudy3_1.rows[0]);
  if (dbStudy3_1.rows[0].status !== "acquired") throw new Error("Scenario 3 failed: status not acquired");

  // Repost the same study
  const res3_2 = await postIntake(payload3);
  console.log("Response (second post):", res3_2);
  if (res3_2.status !== 201) throw new Error("Scenario 5 failed: repost status not 201");

  const worklistCount = await pool.query(`SELECT count(*)::int as count FROM radiology_worklist WHERE study_instance_uid = $1`, [specUID]);
  console.log(`Worklist row count for ${specUID}:`, worklistCount.rows[0].count);
  if (worklistCount.rows[0].count !== 1) throw new Error("Scenario 5 failed: duplicates found in worklist!");

  // --- TEST SCENARIO 4: Python-style payload (case-insensitivity / fallback demographics) ---
  console.log("\n--- TEST SCENARIO 4: Python-style puller payload (fallback demographics) ---");
  const patId4 = `${prefix}-P4`;
  const patDbId4 = await getOrCreatePatient(patId4, "John^Four");
  const acc4 = `${prefix}-ACC-4`;
  const study4 = await createRadiologyStudy(patDbId4, acc4);
  console.log(`Created study ID ${study4.id} with accession ${acc4} for demographics fallback matching`);

  const specUID4 = `1.2.3.4.999.4.FALLBACK.${Date.now()}`;
  const payload4 = {
    AccessionNumber: `${acc4}-PACS-ONLY`, 
    PatientID: patId4,
    PatientName: "John^Four",
    StudyDate: new Date().toISOString().split("T")[0].replace(/-/g, ""), // YYYYMMDD
    ModalitiesInStudy: "CT",
    StudyDescription: "CT HEAD",
    StudyInstanceUID: specUID4
  };

  const res4 = await postIntake(payload4);
  console.log("Response:", res4);
  if (res4.status !== 201) throw new Error("Scenario 4 failed: status not 201");

  const dbStudy4 = await pool.query(`SELECT status, study_instance_uid, accession_number FROM radiology_studies WHERE id = $1`, [study4.id]);
  console.log("DB State study 4 (linked via demographics):", dbStudy4.rows[0]);
  if (dbStudy4.rows[0].status !== "acquired") throw new Error("Scenario 4 failed: study4 status is not acquired");
  if (dbStudy4.rows[0].study_instance_uid !== specUID4) throw new Error("Scenario 4 failed: studyInstanceUid not updated");

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY! Restored pathway is 100% verified.");
}

runTests()
  .catch(err => {
    console.error("❌ Verification Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
