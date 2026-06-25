import { db, radiologyWorklistTable } from "../lib/db/src/index.ts";
import { sql, desc } from "../lib/db/node_modules/drizzle-orm";

async function run() {
  process.env.DATABASE_URL = "postgresql://erp:changeme@192.168.1.137:5400/diagnostic_erp";
  console.log("Database URL set to:", process.env.DATABASE_URL);

  try {
    console.log("Executing Drizzle PACS Worklist query...");
    const rows = await db
      .select({
        id: radiologyWorklistTable.id,
        studyId: radiologyWorklistTable.studyId,
        patientId: radiologyWorklistTable.patientId,
        dicomPatientId: radiologyWorklistTable.dicomPatientId,
        patientMatchStatus: radiologyWorklistTable.patientMatchStatus,
        patientName: radiologyWorklistTable.patientName,
        age: radiologyWorklistTable.age,
        sex: radiologyWorklistTable.sex,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
        studyDate: radiologyWorklistTable.studyDate,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        aeTitle: radiologyWorklistTable.aeTitle,
        ipAddress: radiologyWorklistTable.ipAddress,
        port: radiologyWorklistTable.port,
        referringDoctor: radiologyWorklistTable.referringDoctor,
        weasisUrl: radiologyWorklistTable.weasisUrl,
        sourcePacs: radiologyWorklistTable.sourcePacs,
        sourceAeTitle: radiologyWorklistTable.sourceAeTitle,
        dicomMetadata: radiologyWorklistTable.dicomMetadata,
        status: radiologyWorklistTable.status,
        assignedRadiologist: radiologyWorklistTable.assignedRadiologist,
        aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
        aiDraftJson: radiologyWorklistTable.aiDraftJson,
        aiFeedback: radiologyWorklistTable.aiFeedback,
        aiFeedbackAt: radiologyWorklistTable.aiFeedbackAt,
        reportId: radiologyWorklistTable.reportId,
        deliveryStatus: radiologyWorklistTable.deliveryStatus,
        createdAt: radiologyWorklistTable.createdAt,
        updatedAt: radiologyWorklistTable.updatedAt,
        lockUserId: sql<number | null>`NULL`,
        lockUserName: sql<string | null>`NULL`,
        lockTime: sql<Date | null>`NULL`,
        lockLastActivityAt: sql<Date | null>`NULL`,
        lockWorkstation: sql<string | null>`NULL`,
      })
      .from(radiologyWorklistTable)
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(500);

    console.log("Success! Fetched rows:", rows.length);
    if (rows.length > 0) {
      console.log("Sample row:", JSON.stringify(rows[0], null, 2));
    }
  } catch (err: any) {
    console.error("Drizzle query failed:", err);
  }
}

run();
