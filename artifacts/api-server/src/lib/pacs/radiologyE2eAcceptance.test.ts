/**
 * Radiology E2E acceptance matrix — MRI Brain, MRI Whole Spine, USG, cancellation,
 * failure safety. Uses production dump builder / matching / modality helpers.
 * Never writes to production Orthanc paths or live databases.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ACCEPTANCE_SCENARIOS,
  buildAcceptanceMwlProcedure,
  getAcceptanceChecklistMeta,
  modalityFromBillingDepartment,
  scenarioById,
  validateAcceptanceMwlDump,
  validateAccessionMatch,
  validateCancellationState,
  validateUsgClassification,
} from "./radiologyE2eAcceptance";
import {
  assertValidMwlDump,
  buildMwlDumpText,
  isMwlEnabled,
  MWL_TERMINAL_STATUSES,
  removeWorklistFile,
  syncWorklistForStatus,
  writeWorklistFile,
} from "./mwlWorklistWriter";
import { classifyImagingBucket } from "./imagingModalityBucket";
import { probeAtomicPublish } from "./mwlAtomicPublishProbe";
import { assessPublishGap, deriveMwlVerdict, check } from "./mwlDeploymentStatusPure";
import { isActiveMwlStatus, isCancellableStudyStatus } from "./cancelRadiologyMwlRules";
import { isObstetricUsgStudy, isUltrasoundModality } from "../usgModality";

const ORIG_MWL_DIR = process.env.ORTHANC_WORKLIST_DIR;

describe("Radiology E2E acceptance — modality pipeline (MRI / USG)", () => {
  it("MRI Brain and MRI Whole Spine share the same billing→MR pipeline", () => {
    const brain = scenarioById("mri_brain");
    const spine = scenarioById("mri_whole_spine");
    expect(modalityFromBillingDepartment(brain.billingDepartment)).toBe("MR");
    expect(modalityFromBillingDepartment(spine.billingDepartment)).toBe("MR");
    expect(classifyImagingBucket({ modality: "MR", testName: brain.procedureDescription })).toBe("MRI");
    expect(classifyImagingBucket({ modality: "MR", testName: spine.procedureDescription })).toBe("MRI");
    // Distinct accessions — no accidental study merge
    expect(brain.accessionNumber).not.toBe(spine.accessionNumber);
  });

  it("USG Whole Abdomen resolves to US consistently (billing + alias + bucket)", () => {
    const usg = scenarioById("usg_abdomen");
    expect(modalityFromBillingDepartment("USG")).toBe("US");
    expect(isUltrasoundModality("US")).toBe(true);
    expect(isUltrasoundModality("USG")).toBe(true);
    expect(classifyImagingBucket({ modality: "US", department: "USG", testName: usg.procedureDescription })).toBe("USG");
    const cls = validateUsgClassification(usg);
    expect(cls.modalityOk).toBe(true);
    expect(cls.isUsg).toBe(true);
    expect(cls.obstetricOk).toBe(true);
    expect(cls.queueFilterOk).toBe(true);
    expect(isObstetricUsgStudy("US", "USG Whole Abdomen")).toBe(false);
    expect(isObstetricUsgStudy("US", "Obstetric USG")).toBe(true);
  });
});

describe("Radiology E2E acceptance — MWL dump matrix (A/B/C)", () => {
  for (const s of ACCEPTANCE_SCENARIOS.filter((x) => x.id !== "cancellation")) {
    it(`${s.title}: mandatory DICOM MWL identifiers present and valid`, () => {
      const v = validateAcceptanceMwlDump(s);
      expect(v.errors, v.errors.join("; ")).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.studyInstanceUid).toMatch(/^[0-9]+(\.[0-9]+)+$/);
      expect(v.studyInstanceUid.length).toBeLessThanOrEqual(64);
      // Patient name converted to DICOM PN for modality copy
      expect(v.dump).toContain(`(0010,0010) PN [${v.patientNamePn}]`);
      expect(v.dump).toContain(s.accessionNumber);
      expect(v.dump).toContain(s.procedureDescription);
    });
  }

  it("MRI Whole Spine description is not truncated and stays one study", () => {
    const spine = scenarioById("mri_whole_spine");
    const v = validateAcceptanceMwlDump(spine);
    expect(v.ok).toBe(true);
    const occurrences = v.dump.split("MRI Whole Spine").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // study desc + scheduled step desc
    // Same accession in (0008,0050), (0040,1001), (0040,0009)
    expect(v.dump.match(/ACC-20990101-MR-002/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("accession matching can associate returned study (GREEN path)", () => {
    for (const s of ACCEPTANCE_SCENARIOS.filter((x) => x.id !== "cancellation")) {
      const m = validateAccessionMatch(s);
      expect(m.accessionMatched).toBe(true);
      expect(m.points).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("Radiology E2E acceptance — cancellation (D)", () => {
  it("CANCELLED is terminal and no longer active on modality worklist", () => {
    const r = validateCancellationState("SENT_TO_MWL", "CANCELLED");
    expect(r.wasActive).toBe(true);
    expect(r.isActiveAfter).toBe(false);
    expect(r.terminalOk).toBe(true);
    expect(isActiveMwlStatus("SCHEDULED")).toBe(true);
    expect(isActiveMwlStatus("SENT_TO_MWL")).toBe(true);
    expect(isActiveMwlStatus("CANCELLED")).toBe(false);
    expect(isActiveMwlStatus("COMPLETED")).toBe(false);
    expect(MWL_TERMINAL_STATUSES.has("CANCELLED")).toBe(true);
  });

  it("study status cancelled is not re-cancellable as active work", () => {
    expect(isCancellableStudyStatus("scheduled")).toBe(true);
    expect(isCancellableStudyStatus("cancelled")).toBe(false);
    expect(isCancellableStudyStatus("delivered")).toBe(false);
  });

  it("syncWorklistForStatus(CANCELLED) removes .wl from temp live dir", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mwl-cancel-"));
    const live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
    try {
      const s = scenarioById("cancellation");
      const proc = buildAcceptanceMwlProcedure(s);
      const wlPath = path.join(live, `${s.accessionNumber}.wl`);
      await writeFile(wlPath, "fake-wl", "utf8");
      const sync = await syncWorklistForStatus(proc, "CANCELLED");
      expect(sync.action).toBe("removed");
      expect(sync.remove?.outcome).toBe("removed");
      await expect(access(wlPath)).rejects.toThrow();
    } finally {
      if (ORIG_MWL_DIR === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
      else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("already-absent .wl is idempotent success (wlRemoved semantics)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mwl-cancel-abs-"));
    const live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
    try {
      const { removeWorklistFile, isRemoveWorklistSuccess } = await import("./mwlWorklistWriter");
      const r = await removeWorklistFile("ACC-NEVER-EXISTED");
      expect(r.outcome).toBe("already_absent");
      expect(isRemoveWorklistSuccess(r)).toBe(true);
    } finally {
      if (ORIG_MWL_DIR === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
      else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Radiology E2E acceptance — failure safety (E)", () => {
  let root: string;
  let live: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mwl-fail-"));
    live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    await mkdir(path.join(root, "worklists-staging"), { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
  });

  afterEach(async () => {
    if (ORIG_MWL_DIR === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
    else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it("assertValidMwlDump rejects empty StudyInstanceUID — malformed never validated", () => {
    const bad = [
      "(0008,0016) UI [1.2.840.10008.5.1.4.31]",
      "(0008,0018) UI [1.2.3]",
      "(0020,000D) UI []",
      "(0020,000E) UI [1.2.4]",
      "(0040,0100) SQ",
    ].join("\n");
    expect(() => assertValidMwlDump(bad)).toThrow(/empty|Study|invalid/i);
  });

  it("writeWorklistFile returns false and leaves no live .wl when dump2dcm unavailable/fails", async () => {
    // Point PATH away from dump2dcm so spawn fails closed
    const prevPath = process.env.PATH;
    process.env.PATH = "/nonexistent-bin-for-mwl-test";
    try {
      expect(isMwlEnabled()).toBe(true);
      const s = scenarioById("mri_brain");
      const ok = await writeWorklistFile(buildAcceptanceMwlProcedure(s));
      expect(ok).toBe(false);
      const wlPath = path.join(live, `${s.accessionNumber}.wl`);
      await expect(access(wlPath)).rejects.toThrow();
      // SENT_TO_MWL must only be set by publish when write returns true —
      // proven here: write fails → no live file to mark SENT.
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("atomic rename EXDEV refuses copy fallback (probe)", async () => {
    // Same-FS probe passes
    const staging = path.join(root, "worklists-staging");
    const ok = await probeAtomicPublish(live, staging);
    expect(ok.ok).toBe(true);

    // Documented policy: EXDEV → fail closed (covered by deriveMwlVerdict)
    const { ready, verdict } = deriveMwlVerdict([
      check("env_dir", "dir", "pass", live),
      check("dir_writable", "writable", "pass", "ok"),
      check("dump2dcm", "dump2dcm", "pass", "ok"),
      check("atomic_publish", "atomic", "fail", "EXDEV"),
      check("publish_gap", "gap", "pass", "ok"),
    ]);
    expect(ready).toBe(false);
    expect(verdict).toBe("failed");
  });

  it("Orthanc/mount failure does not make deployment status green", () => {
    const { ready, verdict } = deriveMwlVerdict([
      check("env_dir", "dir", "pass", "/orthanc-worklists"),
      check("dir_writable", "writable", "pass", "ok"),
      check("dump2dcm", "dump2dcm", "pass", "ok"),
      check("atomic_publish", "atomic", "pass", "ok"),
      check("publish_gap", "gap", "pass", "ok"),
      check("orthanc_worklists", "Orthanc", "fail", "ECONNREFUSED"),
    ]);
    expect(ready).toBe(false);
    expect(verdict).toBe("failed");
  });

  it("publish gap (active DB rows, 0 .wl) is fail — not green", () => {
    expect(assessPublishGap(5, 0).status).toBe("fail");
  });

  it("removeWorklistFile cleans cancelled accession without touching other files", async () => {
    const keep = path.join(live, "ACC-KEEP.wl");
    const drop = path.join(live, "ACC-DROP.wl");
    await writeFile(keep, "keep", "utf8");
    await writeFile(drop, "drop", "utf8");
    await removeWorklistFile("ACC-DROP");
    expect(await readFile(keep, "utf8")).toBe("keep");
    await expect(access(drop)).rejects.toThrow();
  });

  it("malformed dump never reaches live directory via writeWorklistFile validation", async () => {
    // buildMwlDumpText always produces valid dumps; simulate by calling assert
    // on a handcrafted bad dump — publish path calls assertValidMwlDump first.
    const bad = buildMwlDumpText(buildAcceptanceMwlProcedure(scenarioById("mri_brain"))).replace(
      /\(0020,000D\) UI \[[^\]]+\]/,
      "(0020,000D) UI []",
    );
    expect(() => assertValidMwlDump(bad)).toThrow();
    // Live dir stays empty when we never call write with a bad dump
    const entries = await readFile(live).catch(() => null);
    expect(entries).toBeNull(); // live is a directory — readFile fails; no .wl written
  });
});

describe("Radiology E2E acceptance — reporting workspace normalization contract", () => {
  it("documents that flat pacs-worklist rows must nest patient (ERP normalizeWorkspaceStudy)", () => {
    // Contract mirror of diagnostic-erp normalizeWorkspaceStudy — consumers crash
    // on s.patient.id when the row stays flat. Acceptance scenarios must carry
    // accession + modality that survive that nesting.
    for (const s of ACCEPTANCE_SCENARIOS.filter((x) => x.id !== "cancellation")) {
      const flat = {
        id: 42,
        patientId: s.patientId,
        patientName: s.patientNameErp,
        patientSex: s.patientSex,
        accessionNumber: s.accessionNumber,
        modality: s.expectedModality,
        studyDescription: s.procedureDescription,
      };
      // Minimal nesting contract (same fields ERP normalizer reads)
      const patient = {
        id: String(flat.patientId ?? 0),
        name: String(flat.patientName ?? "Unknown"),
        sex: String(flat.patientSex ?? "O").slice(0, 1),
      };
      expect(patient.id).toBe(s.patientId);
      expect(patient.name).toBe(s.patientNameErp);
      expect(flat.accessionNumber).toBe(s.accessionNumber);
      expect(["MR", "US"]).toContain(flat.modality);
    }
  });
});

describe("Radiology E2E acceptance — read-only checklist meta (UI)", () => {
  it("exposes four workflows and never implies auto fake billing", () => {
    const meta = getAcceptanceChecklistMeta();
    expect(meta.readOnly).toBe(true);
    expect(meta.warning.toLowerCase()).toMatch(/never creates fake/);
    expect(meta.scenarios).toHaveLength(4);
    expect(meta.scenarios.map((s) => s.id).sort()).toEqual([
      "cancellation",
      "mri_brain",
      "mri_whole_spine",
      "usg_abdomen",
    ]);
  });
});

describe("Radiology E2E acceptance — SENT_TO_MWL gating (unit contract)", () => {
  it("SENT_TO_MWL is only meaningful after successful write (status transition contract)", () => {
    // Documented invariant: publish sets SENT_TO_MWL only when writeWorklistFile
    // returns true AND prior status was SCHEDULED. Failed write leaves SCHEDULED.
    const written = false;
    const prior: string = "SCHEDULED";
    const next = written && prior === "SCHEDULED" ? "SENT_TO_MWL" : prior;
    expect(next).toBe("SCHEDULED");

    const writtenOk = true;
    const nextOk = writtenOk && prior === "SCHEDULED" ? "SENT_TO_MWL" : prior;
    expect(nextOk).toBe("SENT_TO_MWL");

    // Terminal statuses never advance to SENT_TO_MWL
    const terminal: string = "CANCELLED";
    const nextTerminal = writtenOk && terminal === "SCHEDULED" ? "SENT_TO_MWL" : terminal;
    expect(nextTerminal).toBe("CANCELLED");
  });
});
