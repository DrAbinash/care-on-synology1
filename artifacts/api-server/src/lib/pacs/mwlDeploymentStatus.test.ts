import { describe, expect, it } from "vitest";
import {
  assessPublishGap,
  check,
  deriveMwlVerdict,
  resolveOrthancInternalUrl,
  type MwlCheck,
} from "./mwlDeploymentStatusPure";
import { probeAtomicPublish } from "./mwlAtomicPublishProbe";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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
