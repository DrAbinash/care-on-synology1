/**
 * MWL atomic publish / staging path / EXDEV safety.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  resolveMwlStagingDir,
  getMwlStagingDir,
  publishWorklistAtomically,
  writeWorklistFile,
  buildMwlDumpText,
  assertValidMwlDump,
} from "./mwlWorklistWriter";
import { probeAtomicPublish } from "./mwlAtomicPublishProbe";

const ORIG_MWL = process.env.ORTHANC_WORKLIST_DIR;
const ORIG_STAGING = process.env.ORTHANC_WORKLIST_STAGING_DIR;

describe("resolveMwlStagingDir — same mount as live", () => {
  afterEach(() => {
    if (ORIG_STAGING === undefined) delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
    else process.env.ORTHANC_WORKLIST_STAGING_DIR = ORIG_STAGING;
  });

  it("defaults to <live>/staging (subdirectory on the same filesystem)", () => {
    expect(resolveMwlStagingDir("/orthanc-worklists")).toBe(path.resolve("/orthanc-worklists/staging"));
  });

  it("honors ORTHANC_WORKLIST_STAGING_DIR override", () => {
    expect(
      resolveMwlStagingDir("/orthanc-mwl/worklists", {
        ORTHANC_WORKLIST_STAGING_DIR: "/orthanc-mwl/worklists-staging",
      }),
    ).toBe(path.resolve("/orthanc-mwl/worklists-staging"));
  });

  it("getMwlStagingDir follows ORTHANC_WORKLIST_DIR", () => {
    process.env.ORTHANC_WORKLIST_DIR = "/orthanc-worklists";
    delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
    expect(getMwlStagingDir()).toBe(path.resolve("/orthanc-worklists/staging"));
  });
});

describe("atomic publish policy", () => {
  let root: string;
  let live: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mwl-atomic-"));
    live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
    delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
  });

  afterEach(async () => {
    if (ORIG_MWL === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
    else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL;
    if (ORIG_STAGING === undefined) delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
    else process.env.ORTHANC_WORKLIST_STAGING_DIR = ORIG_STAGING;
    await rm(root, { recursive: true, force: true });
  });

  it("same-filesystem stage → final rename succeeds (probe)", async () => {
    const staging = resolveMwlStagingDir(live);
    const r = await probeAtomicPublish(live, staging);
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
  });

  it("simulated EXDEV remains a hard failure; no copyFile fallback in writer", async () => {
    const src = await readFile(path.join(__dirname, "mwlWorklistWriter.ts"), "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/\bcopyFile\s*\(/);
    expect(src).toMatch(/refusing non-atomic copy/);
    expect(src).toContain('reason: "atomic_rename"');

    const err = Object.assign(new Error("EXDEV: cross-device link not permitted, rename"), {
      code: "EXDEV",
    }) as NodeJS.ErrnoException;
    expect(err.code === "EXDEV" || /cross-device|EXDEV/i.test(err.message)).toBe(true);
  });

  it("source refuses non-atomic copy on rename failure", async () => {
    const src = await readFile(path.join(__dirname, "mwlWorklistWriter.ts"), "utf8");
    const codeOnly = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/\bcopyFile\s*\(/);
    expect(src).toContain("atomic publish/rename failed");
  });

  it("compose no longer binds a separate worklists-staging volume", async () => {
    const compose = await readFile(path.join(__dirname, "../../../../..", "docker-compose.yml"), "utf8");
    expect(compose).not.toMatch(/worklists-staging:\/worklists-staging/);
    expect(compose).toMatch(/ORTHANC_WORKLIST_DIR/);
    expect(compose).toMatch(/\/orthanc-worklists/);
  });
});

describe("publishWorklistAtomically integration (dump2dcm when available)", () => {
  let root: string;
  let live: string;
  const hasDump2dcm = (() => {
    try {
      const r = spawnSync("dump2dcm", ["--version"], { encoding: "utf8" });
      return r.status === 0 || ((r.stdout || "") + (r.stderr || "")).length > 0;
    } catch {
      return false;
    }
  })();

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mwl-pub-"));
    live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
    delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
  });

  afterEach(async () => {
    if (ORIG_MWL === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
    else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL;
    delete process.env.ORTHANC_WORKLIST_STAGING_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!hasDump2dcm)("final .wl appears in live worklists and staging temp is removed", async () => {
    const dump = buildMwlDumpText({
      accessionNumber: "ACC-EXDEV-FIX-001",
      patientName: "Test Patient",
      modality: "MR",
      scheduledDate: "20260903",
    });
    assertValidMwlDump(dump);
    const finalPath = path.join(live, "ACC-EXDEV-FIX-001.wl");
    const result = await publishWorklistAtomically(dump, finalPath);
    expect(result.ok).toBe(true);
    await access(finalPath);
    const staging = resolveMwlStagingDir(live);
    const leftovers = await readdir(staging).catch(() => [] as string[]);
    expect(leftovers.filter((f) => f.includes("ACC-EXDEV-FIX-001"))).toEqual([]);
  });

  it.skipIf(!hasDump2dcm)("writeWorklistFile publishes MRI/CT/USG modalities unchanged", async () => {
    for (const modality of ["MR", "CT", "US"] as const) {
      const acc = `ACC-${modality}-PUB-1`;
      const ok = await writeWorklistFile({
        accessionNumber: acc,
        patientName: "Modality Test",
        modality,
        scheduledDate: "20260903",
      });
      expect(ok).toBe(true);
      await access(path.join(live, `${acc}.wl`));
    }
  });

  it("dump2dcm failure is reported as dump2dcm reason (not atomic_rename)", async () => {
    const prevPath = process.env.PATH;
    process.env.PATH = "/nonexistent-bin-for-mwl-test";
    try {
      const dump = buildMwlDumpText({
        accessionNumber: "ACC-NO-DUMP2DCM",
        patientName: "X",
        modality: "MR",
        scheduledDate: "20260903",
      });
      const finalPath = path.join(live, "ACC-NO-DUMP2DCM.wl");
      const result = await publishWorklistAtomically(dump, finalPath);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("dump2dcm");
      await expect(access(finalPath)).rejects.toThrow();
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

describe("misleading log regression", () => {
  it("writeWorklistFile distinguishes dump2dcm vs atomic rename in source", async () => {
    const src = await readFile(path.join(__dirname, "mwlWorklistWriter.ts"), "utf8");
    expect(src).not.toMatch(/if \(!ok\) logger\.warn\(\{ accession: p\.accessionNumber \}, "mwl: dump2dcm failed/);
    expect(src).toContain("dump2dcm conversion failed");
    expect(src).toContain("atomic publish/rename failed");
    expect(src).toContain("post-conversion validation failed");
  });
});
