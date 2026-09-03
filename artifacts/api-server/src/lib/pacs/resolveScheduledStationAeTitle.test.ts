import { describe, expect, test } from "vitest";
import { resolveStationAeFromCandidates } from "./resolveScheduledStationAeTitle";
import { buildMwlDumpText } from "./mwlWorklistWriter";

const UIH_MRI = {
  machineName: "UIH MRI",
  modality: "MR",
  aeTitle: "UIH",
  isActive: true,
  autoCreateWorklist: true,
};

const CR_ROOM = {
  machineName: "CR Room 1",
  modality: "CR",
  aeTitle: "CR1",
  isActive: true,
  autoCreateWorklist: true,
};

const US_VOLUSON = {
  machineName: "Voluson USG",
  modality: "US",
  aeTitle: "Voluson",
  isActive: true,
  autoCreateWorklist: true,
};

describe("resolveStationAeFromCandidates (MWL ScheduledStationAETitle)", () => {
  test("A) MRI mapped to UIH produces ScheduledStationAETitle = UIH", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [UIH_MRI, CR_ROOM, US_VOLUSON],
    });
    expect(r.aeTitle).toBe("UIH");
    expect(r.source).toBe("modality_registry");
    expect(r.reason).toBe("ok");
    expect(r.machineName).toBe("UIH MRI");
  });

  test("B) dump does not emit literal ANY when a station mapping exists", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [UIH_MRI],
    });
    const dump = buildMwlDumpText({
      accessionNumber: "ACC-20260903-MR-017",
      patientId: "P1",
      patientName: "TEST PATIENT",
      modality: "MR",
      studyDescription: "MRI BRAIN",
      scheduledDate: "20260903",
      scheduledTime: "100000",
      stationAeTitle: r.aeTitle,
    });
    expect(dump).toMatch(/\(0040,0001\) AE \[UIH\]/);
    expect(dump).not.toMatch(/\(0040,0001\) AE \[ANY\]/);
  });

  test("C) CR/US resolve to their own stations — MRI mapping does not leak", () => {
    const cr = resolveStationAeFromCandidates({
      modality: "CR",
      modalities: [UIH_MRI, CR_ROOM, US_VOLUSON],
    });
    expect(cr.aeTitle).toBe("CR1");
    expect(cr.source).toBe("modality_registry");

    const us = resolveStationAeFromCandidates({
      modality: "US",
      modalities: [UIH_MRI, CR_ROOM, US_VOLUSON],
    });
    expect(us.aeTitle).toBe("Voluson");

    const dumpCr = buildMwlDumpText({
      accessionNumber: "ACC-CR-1",
      modality: "CR",
      stationAeTitle: cr.aeTitle,
      scheduledDate: "20260903",
    });
    expect(dumpCr).toMatch(/\(0040,0001\) AE \[CR1\]/);
    expect(dumpCr).not.toMatch(/UIH/);
  });

  test("E) missing station mapping is deliberate — null, never invent ANY", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [CR_ROOM], // no MR station
    });
    expect(r.aeTitle).toBeNull();
    expect(r.source).toBe("unconfigured");
    expect(r.reason).toBe("no_active_station");

    const dump = buildMwlDumpText({
      accessionNumber: "ACC-MR-UNCFG",
      modality: "MR",
      stationAeTitle: r.aeTitle,
      scheduledDate: "20260903",
    });
    expect(dump).toMatch(/\(0040,0001\) AE \[\]/);
    expect(dump).not.toMatch(/\(0040,0001\) AE \[ANY\]/);
  });

  test("explicit study AE wins over modality registry", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      explicitAeTitle: "MRI2",
      modalities: [UIH_MRI],
    });
    expect(r.aeTitle).toBe("MRI2");
    expect(r.source).toBe("explicit");
  });

  test("literal ANY on study is treated as unset so registry can repair", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      explicitAeTitle: "ANY",
      modalities: [UIH_MRI],
    });
    expect(r.aeTitle).toBe("UIH");
    expect(r.source).toBe("modality_registry");
  });

  test("ambiguous stations for same modality refuse silent pick", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [
        UIH_MRI,
        { ...UIH_MRI, machineName: "Other MRI", aeTitle: "MRI2" },
      ],
    });
    expect(r.aeTitle).toBeNull();
    expect(r.reason).toBe("ambiguous_stations");
  });

  test("inactive or autoCreateWorklist=false stations are ignored", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [
        { ...UIH_MRI, isActive: false },
        { ...UIH_MRI, machineName: "UIH MRI B", aeTitle: "UIHB", autoCreateWorklist: false },
      ],
    });
    expect(r.aeTitle).toBeNull();
    expect(r.reason).toBe("no_active_station");
  });

  test("per-test default overrides modality registry when present", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      testId: 42,
      testDefaults: { "42": { stationAE: "MRI_ROOM2", bodyPart: "BRAIN" } },
      modalities: [UIH_MRI],
    });
    expect(r.aeTitle).toBe("MRI_ROOM2");
    expect(r.source).toBe("test_default");
  });

  test("two stations with the same AE (case-insensitive) are not ambiguous", () => {
    const r = resolveStationAeFromCandidates({
      modality: "MR",
      modalities: [
        UIH_MRI,
        { ...UIH_MRI, machineName: "UIH MRI Backup", aeTitle: "uih" },
      ],
    });
    expect(r.aeTitle?.toUpperCase()).toBe("UIH");
    expect(r.reason).toBe("ok");
  });
});
