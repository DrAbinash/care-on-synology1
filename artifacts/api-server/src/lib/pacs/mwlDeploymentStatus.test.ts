import { describe, expect, it } from "vitest";
import {
  assessPublishGap,
  check,
  deriveMwlVerdict,
  resolveOrthancInternalUrl,
  resolveWorklistBadDirs,
  sanitizeQuarantineReason,
  type MwlCheck,
} from "./mwlDeploymentStatusPure";
import { inspectWorklistQuarantine } from "./mwlQuarantineInspect";
import { probeAtomicPublish } from "./mwlAtomicPublishProbe";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("resolveOrthancInternalUrl", () => {
  it("shows the actual env value for separate-network LAN deployments", () => {
    const info = resolveOrthancInternalUrl({
      ORTHANC_INTERNAL_URL: "http://172.16.1.139:8042",
    } as NodeJS.ProcessEnv);
    expect(info.source).toBe("env");
    expect(info.display).toBe("http://172.16.1.139:8042");
    expect(info.probeUrl).toBe("http://172.16.1.139:8042");
    expect(info.display).not.toContain("care-orthanc");
  });

  it("does not invent care-orthanc when unset", () => {
    const info = resolveOrthancInternalUrl({} as NodeJS.ProcessEnv);
    expect(info.source).toBe("unset");
    expect(info.probeUrl).toBeNull();
    expect(info.display.toLowerCase()).toContain("not set");
    expect(info.display).not.toContain("http://care-orthanc");
    expect(info.networkNote.toLowerCase()).toContain("separate");
  });
});

describe("assessPublishGap", () => {
  it("FAILS when many scheduled procedures exist but 0 live .wl files", () => {
    const c = assessPublishGap(1173, 0);
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/1173/);
    expect(c.detail).toMatch(/0 live/);
  });

  it("passes when live files exist for active procedures", () => {
    const c = assessPublishGap(10, 10);
    expect(c.status).toBe("pass");
  });

  it("skips when no active procedures", () => {
    expect(assessPublishGap(0, 0).status).toBe("skip");
  });
});

describe("deriveMwlVerdict", () => {
  function baseCritical(overrides: Partial<Record<string, MwlCheck["status"]>> = {}): MwlCheck[] {
    const ids = ["env_dir", "dir_writable", "dump2dcm", "atomic_publish", "publish_gap"] as const;
    return ids.map((id) =>
      check(id, id, overrides[id] ?? "pass", "ok"),
    );
  }

  it("healthy when criticals pass", () => {
    const { ready, verdict } = deriveMwlVerdict(baseCritical());
    expect(ready).toBe(true);
    expect(verdict).toBe("healthy");
  });

  it("failed on EXDEV / atomic publish failure even if dir exists", () => {
    const { ready, verdict } = deriveMwlVerdict(
      baseCritical({ atomic_publish: "fail" }),
    );
    expect(ready).toBe(false);
    expect(verdict).toBe("failed");
  });

  it("failed on publish gap (scheduled but 0 written)", () => {
    const checks = [
      ...baseCritical({ publish_gap: "fail" }),
      check("env_dir", "ORTHANC_WORKLIST_DIR set", "pass", "/orthanc-worklists"),
    ];
    const { ready, verdict } = deriveMwlVerdict(checks);
    expect(ready).toBe(false);
    expect(verdict).toBe("failed");
  });

  it("degraded when only warnings", () => {
    const checks = [
      ...baseCritical(),
      check("quarantine", "Quarantined", "warn", "2 files"),
    ];
    const { ready, verdict } = deriveMwlVerdict(checks);
    expect(ready).toBe(true);
    expect(verdict).toBe("degraded");
  });

  it("failed when Orthanc unreachable (non-critical fail still fails overall)", () => {
    const checks = [
      ...baseCritical(),
      check("orthanc_worklists", "Orthanc worklists plugin", "fail", "ECONNREFUSED"),
    ];
    const { ready, verdict } = deriveMwlVerdict(checks);
    expect(ready).toBe(false);
    expect(verdict).toBe("failed");
  });
});

describe("probeAtomicPublish", () => {
  it("passes when staging and live share a filesystem", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mwl-atomic-"));
    const live = path.join(root, "worklists");
    const staging = path.join(root, "worklists-staging");
    await mkdir(live, { recursive: true });
    await mkdir(staging, { recursive: true });
    try {
      const r = await probeAtomicPublish(live, staging);
      expect(r.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when staging equals live", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mwl-same-"));
    try {
      const r = await probeAtomicPublish(root, root);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("SAME_DIR");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("secrets are never embedded in orthanc url helper", () => {
  it("does not read password env into display", () => {
    const info = resolveOrthancInternalUrl({
      ORTHANC_INTERNAL_URL: "http://172.16.1.139:8042",
      ORTHANC_PASSWORD: "super-secret",
      INTERNAL_API_KEY: "1234",
    } as NodeJS.ProcessEnv);
    expect(JSON.stringify(info)).not.toContain("super-secret");
    expect(JSON.stringify(info)).not.toContain("1234");
  });
});

describe("resolveWorklistBadDirs", () => {
  it("always includes /worklists-bad for liveDir=/orthanc-worklists (dirname is /)", () => {
    const dirs = resolveWorklistBadDirs("/orthanc-worklists", {});
    expect(dirs).toContain("/worklists-bad");
  });

  it("prefers ORTHANC_WORKLIST_BAD_DIR", () => {
    const dirs = resolveWorklistBadDirs("/orthanc-worklists", {
      ORTHANC_WORKLIST_BAD_DIR: "/custom-bad",
    } as NodeJS.ProcessEnv);
    expect(dirs[0]).toBe("/custom-bad");
    expect(dirs).toContain("/worklists-bad");
  });

  it("adds sibling worklists-bad for /orthanc-mwl/worklists", () => {
    const dirs = resolveWorklistBadDirs("/orthanc-mwl/worklists", {});
    expect(dirs).toContain("/orthanc-mwl/worklists-bad");
    expect(dirs).toContain("/worklists-bad");
  });
});

describe("sanitizeQuarantineReason", () => {
  it("keeps a technical UID reason", () => {
    expect(sanitizeQuarantineReason("missing/invalid StudyInstanceUID\n")).toMatch(/StudyInstanceUID/);
  });

  it("redacts PN-looking lines without a technical keyword", () => {
    expect(sanitizeQuarantineReason("SINGH^ABINASH\n")).toMatch(/do not copy/i);
  });
});

describe("inspectWorklistQuarantine", () => {
  it("counts .wl files and samples .reason.txt from the fullest folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mwl-q-"));
    const empty = path.join(root, "empty-bad");
    const full = path.join(root, "worklists-bad");
    await mkdir(empty, { recursive: true });
    await mkdir(full, { recursive: true });
    await writeFile(path.join(full, "ACC-20260801-CR-001.wl"), "dicom");
    await writeFile(path.join(full, "ACC-20260811-CR-005__20260811T152050Z.wl"), "dicom");
    await writeFile(path.join(full, "ACC-20260811-CR-005__20260811T152050Z.wl.reason.txt"), "missing/invalid StudyInstanceUID\n");
    try {
      const r = await inspectWorklistQuarantine(path.join(root, "worklists"), {
        ORTHANC_WORKLIST_BAD_DIR: empty,
      } as NodeJS.ProcessEnv);
      expect(r.count).toBe(2);
      expect(r.dir).toBe(full);
      expect(r.sampleReason).toMatch(/StudyInstanceUID/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
