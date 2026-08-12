import { describe, it, expect } from "vitest";
import { db } from "@workspace/db";
import { radiologyWorklistTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { saveDraftAutomation } from "./clinicalConfigService";
import { scheduleStudyOnDicomArrival } from "./schedulerService";

describe("on-arrival draft scheduling smoke", () => {
  it("enables automation and enqueues on DICOM arrival for MR", async () => {
    const saved = await saveDraftAutomation({
      draftTiming: "on_arrival",
      modalities: ["MR"],
      enableAi: true,
      updatedBy: "vitest-smoke",
    });
    expect(saved.scheduler.draftTiming).toBe("on_arrival");
    expect(saved.masterEnabled).toBe(true);
    expect(saved.policies.find((p) => p.modality === "MR")?.mode).toBe("immediate");

    const uid = `1.2.840.dummy.arrival.${Date.now()}`;
    const [wl] = await db
      .insert(radiologyWorklistTable)
      .values({
        patientName: "ARRIVAL^TEST",
        modality: "MR",
        studyInstanceUID: uid,
        status: "STUDY_RECEIVED",
        aiDraftStatus: "NONE",
        dicomPatientId: "ARR1",
      })
      .returning({ id: radiologyWorklistTable.id });

    const sched = await scheduleStudyOnDicomArrival({ studyInstanceUid: uid, modality: "MR" });
    expect(sched.enqueued).toBe(true);

    const [row] = await db
      .select({ aiDraftStatus: radiologyWorklistTable.aiDraftStatus })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, wl.id));
    expect(row.aiDraftStatus).toBe("PENDING");
  }, 60_000);
});
