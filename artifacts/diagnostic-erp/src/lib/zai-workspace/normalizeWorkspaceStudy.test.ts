import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceStudy,
  normalizeWorkspaceStudies,
} from "./normalizeWorkspaceStudy";

describe("normalizeWorkspaceStudy", () => {
  it("nests flat pacs-worklist rows so consumers can safely read patient.id", () => {
    const study = normalizeWorkspaceStudy({
      id: 42,
      patientId: 7,
      patientName: "Anita Devi",
      patientAge: 45,
      patientSex: "F",
      accessionNumber: "ACC-1",
      studyInstanceUID: "1.2.3",
      modality: "MR",
      studyDescription: "BRAIN",
      bodyPart: "Brain",
      priority: "urgent",
      status: "RECEIVED",
    });
    expect(study).not.toBeNull();
    expect(study!.patient.id).toBe("7");
    expect(study!.patient.name).toBe("Anita Devi");
    expect(study!.patient.sex).toBe("F");
    expect(study!.id).toBe("42");
    expect(study!.accession).toBe("ACC-1");
    expect(study!.modality).toBe("MR");
    expect(study!.priority).toBe("urgent");
  });

  it("maps referringDoctor from flat pacs-worklist rows", () => {
    const study = normalizeWorkspaceStudy({
      id: 10,
      patientName: "Sourav Kumar",
      age: 28,
      sex: "M",
      referringDoctor: "Dr. Mehta",
      modality: "MR",
    });
    expect(study!.patient.referringDoctor).toBe("Dr. Mehta");
    expect(study!.patient.age).toBe(28);
    expect(study!.patient.sex).toBe("M");
  });

  it("falls back to doctorName / referredBy aliases", () => {
    expect(normalizeWorkspaceStudy({ id: 1, doctorName: "Dr. Rao" })!.patient.referringDoctor).toBe("Dr. Rao");
    expect(normalizeWorkspaceStudy({ id: 2, referredBy: "Dr. Sen" })!.patient.referringDoctor).toBe("Dr. Sen");
  });

  it("does not crash on missing patient / priority / modality", () => {
    const study = normalizeWorkspaceStudy({
      id: "99",
      patientName: "Unknown",
      priority: "emergency",
      modality: "MRI",
    });
    expect(study!.patient.id).toBe("0");
    expect(study!.patient.name).toBe("Unknown");
    expect(study!.priority).toBe("routine");
    expect(study!.modality).toBe("MR");
    expect(study!.slaMinutes).toBe(240);
  });

  it("preserves already-nested Study shapes", () => {
    const study = normalizeWorkspaceStudy({
      id: "1",
      accession: "A",
      studyInstanceUID: "1.2",
      patient: { id: "5", name: "Rukhsana", age: 30, sex: "F", uhid: "5", referringDoctor: "Dr X" },
      modality: "CT",
      bodyPart: "Chest",
      studyDescription: "CT Chest",
      clinicalHistory: "cough",
      status: "draft",
      priority: "stat",
      receivedAt: "2026-08-11",
      priorCount: 1,
      criticalFlag: false,
      aiDraftReady: false,
      tatMinutes: 10,
      slaMinutes: 60,
      series: 2,
      images: 40,
    });
    expect(study!.patient.name).toBe("Rukhsana");
    expect(study!.priority).toBe("stat");
  });

  it("returns null for junk and filters lists", () => {
    expect(normalizeWorkspaceStudy(null)).toBeNull();
    expect(normalizeWorkspaceStudy({})).toBeNull();
    const list = normalizeWorkspaceStudies({
      studies: [
        { id: 1, patientName: "A" },
        { patientName: "no-id" },
        null,
        { id: 2, patientId: 9, patientName: "B", priority: null },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0].patient.name).toBe("A");
    expect(list[1].patient.id).toBe("9");
    expect(list[1].priority).toBe("routine");
  });

  it("marks aiDraftReady from worklist aiDraftStatus READY", () => {
    const study = normalizeWorkspaceStudy({
      id: 3,
      patientName: "X",
      modality: "MR",
      aiDraftStatus: "READY",
    });
    expect(study!.aiDraftReady).toBe(true);
    const none = normalizeWorkspaceStudy({
      id: 4,
      patientName: "Y",
      modality: "CT",
      aiDraftStatus: "NONE",
    });
    expect(none!.aiDraftReady).toBe(false);
  });
});
