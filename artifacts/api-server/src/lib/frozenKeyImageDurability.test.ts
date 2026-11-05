/**
 * Frozen key images are clinical evidence: the JPEG a radiologist attached to a
 * signed report is the reason the report can be reprinted years later without
 * the PACS. Production wrote them into the care-api container's ephemeral
 * writable layer instead of the `uploads_data` volume, because the directory was
 * derived from `import.meta.url`, which in the esbuild bundle is one file at
 * /app/dist/index.mjs — so the "package root" was `/`. The nightly 04:00 deploy
 * recreates that container, and with it goes every picture attached since.
 *
 * These tests pin the rule (the served data dir, never the bundle location),
 * prove bytes outlive a container recreate that keeps the volume, and — as a
 * control — prove the old rule does not.
 *
 * No database, no server: this is about where files land.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FROZEN_KEY_IMAGE_DIR,
  FROZEN_KEY_IMAGE_URL_PREFIX,
  frozenKeyImageDirFor,
  frozenKeyImageFilePresent,
  writeFrozenKeyImageFile,
  writeFrozenKeyImageThumbnail,
} from "./frozenKeyImages";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Assert on a path without assuming which separator the runner uses. */
const posix = (p: string) => p.split(path.sep).join("/");

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "kimg-durability-"));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

/** A real JPEG, because a truncated or fake one would not exercise sharp. */
async function makeJpeg(absPath: string, width = 400, height = 300): Promise<void> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 60, b: 90 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buf);
}

/**
 * The production layout as one filesystem tree:
 *
 *   <scratch>/volume        — the `care-erp-github_uploads_data` named volume
 *   <scratch>/fakeroot      — the container's filesystem: recreated, so wiped
 *   <scratch>/fakeroot/app  — WORKDIR /app (image content, also wiped)
 *   …/app/dist/index.mjs    — the esbuild bundle (Dockerfile copies dist, entrypoint execs it)
 *   …/app/data/uploads      — a link to the volume, i.e. the compose mount
 */
async function buildContainer(tag: string): Promise<{ volume: string; fakeroot: string; app: string }> {
  const volume = path.join(scratch, "volume");
  const fakeroot = path.join(scratch, `fakeroot-${tag}`);
  const app = path.join(fakeroot, "app");
  await fs.mkdir(path.join(app, "dist"), { recursive: true });
  await fs.mkdir(path.join(app, "data"), { recursive: true });
  await fs.mkdir(volume, { recursive: true });
  await fs.symlink(volume, path.join(app, "data", "uploads"), "junction");
  return { volume, fakeroot, app };
}

describe("key-image directory resolution (the durability rule)", () => {
  it("A1 resolves inside the data dir the process serves, not inside the bundle", () => {
    // The production shape: WORKDIR /app, entrypoint `exec node ./dist/index.mjs`,
    // compose mount uploads_data:/app/data/uploads.
    const dir = frozenKeyImageDirFor({}, "/app");
    expect(posix(dir)).toContain("/app/data/uploads/radiology-key-images");
  });

  it("A2 honours CARE_DATA_DIR, the env the rest of the uploads tree already honours", () => {
    expect(posix(frozenKeyImageDirFor({ CARE_DATA_DIR: "/mnt/care-data" }, "/app"))).toContain(
      "/mnt/care-data/uploads/radiology-key-images",
    );
  });

  it("A3 is NOT derived from this module's own location — the defect this replaces", () => {
    // The pre-fix expression, kept here so the assertion cannot pass vacuously.
    const bundleDerived = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
      "data",
      "uploads",
      "radiology-key-images",
    );
    expect(frozenKeyImageDirFor({}, "/app")).not.toBe(bundleDerived);
    // And a bundle one level under the app root makes that "package root" the
    // filesystem root — which is how clinical files left the volume.
    const asBundle = path.resolve("/app", "dist", "..", "..");
    expect(path.parse(asBundle).root).toBe(asBundle);
  });

  it("A4 the exported constant is that same rule applied to this process", () => {
    expect(FROZEN_KEY_IMAGE_DIR).toBe(frozenKeyImageDirFor(process.env, process.cwd()));
  });

  it("A5 the deployment really mounts that directory, and the entrypoint really runs from it", async () => {
    const compose = await fs.readFile(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
    const mount = compose.match(/uploads_data:(\/[^\s"]+)/);
    expect(mount, "compose must still mount uploads_data on the api container").not.toBeNull();
    const mountTarget = mount![1];
    // `path.resolve` on Windows qualifies a POSIX-looking cwd with the current
    // drive, so drop only that prefix — the mounted path itself is compared exact.
    const resolved = posix(frozenKeyImageDirFor({}, "/app")).replace(/^\/?[a-z]:/i, "");
    expect(resolved).toBe(`${mountTarget.replace(/\/$/, "")}/radiology-key-images`);
    const dockerfile = await fs.readFile(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^WORKDIR\s+\/app\s*$/m);
    const entry = await fs.readFile(path.join(REPO_ROOT, "docker", "api-entrypoint.sh"), "utf8");
    expect(entry).toMatch(/exec node .*\.\/dist\/index\.mjs/);
  });

  it("A6 the URL prefix and the directory stay one pair", () => {
    expect(FROZEN_KEY_IMAGE_URL_PREFIX).toBe("/uploads/radiology-key-images/");
    expect(path.basename(FROZEN_KEY_IMAGE_DIR)).toBe("radiology-key-images");
  });
});

describe("frozen artifact writes", () => {
  it("B1 stores the bytes and reports the size that is really on disk", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const target = path.join(dir, `${randomUUID()}.jpg`);
    const bytes = Buffer.alloc(4096, 7);
    const r = await writeFrozenKeyImageFile(target, bytes);
    expect(r).toEqual({ ok: true, bytes: 4096 });
    const back = await fs.readFile(target);
    expect(back.equals(bytes)).toBe(true);
    expect(await frozenKeyImageFilePresent(target)).toBe(true);
  });

  it("B2 never replaces bytes that are already at that name", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const target = path.join(dir, `${randomUUID()}.jpg`);
    const first = Buffer.from("original clinical evidence");
    await writeFrozenKeyImageFile(target, first);
    const r = await writeFrozenKeyImageFile(target, Buffer.from("second writer wins"));
    expect(r).toEqual({ ok: false, reason: "already-present" });
    expect((await fs.readFile(target)).toString()).toBe("original clinical evidence");
  });

  it("B3 a failed write leaves no artifact and no leftover temp file", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const target = path.join(dir, `${randomUUID()}.jpg`);
    // Not a Buffer: writeFile rejects after the temp file is opened.
    await expect(
      writeFrozenKeyImageFile(target, { not: "a buffer" } as unknown as Buffer),
    ).rejects.toThrow();
    await expect(fs.stat(target)).rejects.toThrow();
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("B4 an empty file is not evidence — presence refuses it", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    await fs.mkdir(dir, { recursive: true });
    const zero = path.join(dir, `${randomUUID()}.jpg`);
    await fs.writeFile(zero, Buffer.alloc(0));
    expect(await frozenKeyImageFilePresent(zero)).toBe(false);
    expect(await frozenKeyImageFilePresent(path.join(dir, "absent.jpg"))).toBe(false);
  });

  it("B5 the thumbnail is rendered, resized, and lands beside its image with no temp", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const source = path.join(dir, `${randomUUID()}.jpg`);
    await makeJpeg(source, 900, 600);
    const thumb = await writeFrozenKeyImageThumbnail(source);
    expect(thumb).not.toBeNull();
    expect(thumb!.filename).toBe(`${path.parse(source).name}-thumb.jpg`);
    expect(thumb!.url).toBe(`${FROZEN_KEY_IMAGE_URL_PREFIX}${thumb!.filename}`);
    expect(path.dirname(thumb!.absPath)).toBe(dir);
    const meta = await sharp(thumb!.absPath).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(240);
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("B6 a source that cannot be rendered yields no thumbnail and no partial file", async () => {
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    await fs.mkdir(dir, { recursive: true });
    const broken = path.join(dir, `${randomUUID()}.jpg`);
    await fs.writeFile(broken, Buffer.from("this is not a jpeg"));
    expect(await writeFrozenKeyImageThumbnail(broken)).toBeNull();
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("B7 a rename that lands no bytes is a failure, and leaves nothing behind", async () => {
    // Disk-full / interrupted-flush modelled at the seam that decides "stored":
    // the rename claims success, the artifact never appears. Without the size
    // re-check this is exactly how a DB row came to point at nothing.
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const target = path.join(dir, `${randomUUID()}.jpg`);
    const rename = vi.spyOn(fs, "rename").mockImplementation(async () => undefined);
    try {
      const r = await writeFrozenKeyImageFile(target, Buffer.alloc(2048, 3));
      expect(r).toEqual({ ok: false, reason: "verify-failed" });
    } finally {
      rename.mockRestore();
    }
    expect(await frozenKeyImageFilePresent(target)).toBe(false);
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("B8 a rename that lands a truncated file is refused and cleaned up", async () => {
    // Disk full mid-flush: the name exists, so an existence check alone would
    // bless it, and the row would cite half a JPEG.
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const target = path.join(dir, `${randomUUID()}.jpg`);
    const bytes = Buffer.alloc(3000, 9);
    const rename = vi.spyOn(fs, "rename").mockImplementation(async () => {
      await fs.writeFile(target, bytes.subarray(0, 300));
    });
    let r: Awaited<ReturnType<typeof writeFrozenKeyImageFile>> | null = null;
    try {
      r = await writeFrozenKeyImageFile(target, bytes);
    } finally {
      rename.mockRestore();
    }
    expect(r).toEqual({ ok: false, reason: "verify-failed" });
    expect(await frozenKeyImageFilePresent(target)).toBe(false);
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });

  it("B9 a thumbnail whose rename lands nothing yields no URL and no partial file", async () => {
    // The rail cites a thumbnailUrl; a URL for bytes that are not on disk is the
    // same defect the frozen artifact gate closes, one file over.
    const dir = path.join(scratch, "uploads", "radiology-key-images");
    const source = path.join(dir, `${randomUUID()}.jpg`);
    await makeJpeg(source, 600, 400);
    const rename = vi.spyOn(fs, "rename").mockImplementation(async () => undefined);
    let thumb: unknown;
    try {
      thumb = await writeFrozenKeyImageThumbnail(source);
    } finally {
      rename.mockRestore();
    }
    expect(thumb).toBeNull();
    const thumbPath = path.join(dir, `${path.parse(source).name}-thumb.jpg`);
    expect(await frozenKeyImageFilePresent(thumbPath)).toBe(false);
    expect((await fs.readdir(dir)).filter((f) => f.includes(".part"))).toEqual([]);
  });
});

describe("survives a container recreate that keeps the volume", () => {
  it("C1 image and thumbnail are still readable after the layer is destroyed", async () => {
    const { volume, fakeroot, app } = await buildContainer("a");

    // The rule the fixed code uses: the data dir the process serves.
    const dirA = frozenKeyImageDirFor({}, app);
    const target = path.join(dirA, `${randomUUID()}.jpg`);
    await makeJpeg(target, 500, 400);
    const thumb = await writeFrozenKeyImageThumbnail(target);
    expect(thumb).not.toBeNull();
    const original = await fs.readFile(target);
    expect(original.length).toBeGreaterThan(0);
    // Proof it went through the mount, into the volume: resolve the link the
    // way the kernel does, so the claim is about bytes on disk, not about strings.
    const realVolume = posix(await fs.realpath(volume));
    const realTarget = posix(await fs.realpath(target));
    expect(realTarget.startsWith(`${realVolume}/radiology-key-images/`)).toBe(true);

    // Recreate the container: the whole filesystem above the mount is destroyed.
    await fs.rm(fakeroot, { recursive: true, force: true });
    const rebuilt = await buildContainer("b");
    expect(rebuilt.volume).toBe(volume);

    const dirB = frozenKeyImageDirFor({}, rebuilt.app);
    const after = path.join(dirB, path.basename(target));
    const thumbAfter = path.join(dirB, thumb!.filename);
    expect(await frozenKeyImageFilePresent(after)).toBe(true);
    expect((await fs.readFile(after)).equals(original)).toBe(true);
    expect(await frozenKeyImageFilePresent(thumbAfter)).toBe(true);
  });

  it("C2 CONTROL: the pre-fix rule loses the same file in the same scenario", async () => {
    // Same mount, same wipe — only the resolution rule is the old one. If this
    // passed too, C1 would be proving nothing.
    const { volume, fakeroot, app } = await buildContainer("c");
    const bundleRoot = path.resolve(path.join(app, "dist"), "..", "..");
    const dirOld = path.join(bundleRoot, "data", "uploads", "radiology-key-images");
    const target = path.join(dirOld, `${randomUUID()}.jpg`);
    await writeFrozenKeyImageFile(target, Buffer.alloc(1000, 1));
    expect(await frozenKeyImageFilePresent(target)).toBe(true);
    const realVolume = posix(await fs.realpath(volume));
    const realTarget = posix(await fs.realpath(target));
    expect(realTarget.startsWith(`${realVolume}/`)).toBe(false);

    await fs.rm(fakeroot, { recursive: true, force: true });
    expect(await frozenKeyImageFilePresent(target)).toBe(false);
    // And nothing of it ever reached the volume.
    const inVolume = await fs.readdir(volume, { recursive: true, encoding: "utf8" });
    expect(inVolume.filter((f) => f.includes("radiology-key-images"))).toEqual([]);
  });
});
