import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

// idCardPipeline.ts imports the Ollama/Gemini OCR call paths (for
// runIdCardOcrPipeline, not exercised by these tests), which transitively
// import @workspace/ai-providers' DB-backed provider registry — stub it out
// so preprocessScanImage(), a pure image-processing function with no DB
// dependency of its own, can be tested without a database.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

const { preprocessScanImage, SERVER_BLUR_WARNING_THRESHOLD } = await import("./idCardPipeline");

// preprocessScanImage() is shared by every OCR call site (Form F's ID-card
// scan AND the expense-bill scanner) — these tests cover the "before
// sending an image to Ollama: correct EXIF orientation, resize, compress"
// requirement, independent of which provider ends up receiving the result.

async function makeTestJpeg(opts: { width: number; height: number; orientation?: number }): Promise<Buffer> {
  const { width, height, orientation } = opts;
  let img = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  }).jpeg();
  if (orientation) {
    img = img.withMetadata({ orientation });
  }
  return img.toBuffer();
}

describe("preprocessScanImage — EXIF orientation", () => {
  it("auto-rotates a sideways photo (EXIF orientation 6 = rotate 90° CW) so the output is right-side-up", async () => {
    // A physical ID card photographed in landscape by a phone held in
    // portrait orientation typically gets tagged EXIF orientation 6 rather
    // than actually rotating the pixel data — a naive OCR pipeline that
    // ignores this tag sends a sideways image to the model.
    const wide = await makeTestJpeg({ width: 200, height: 100, orientation: 6 });
    const base64 = wide.toString("base64");

    const result = await preprocessScanImage(base64, "image/jpeg");

    const outputMeta = await sharp(result.buffer).metadata();
    // Orientation 6 swaps width/height when correctly applied: a 200x100
    // source becomes 100x200 once auto-orient rotates it upright.
    expect(outputMeta.width).toBe(100);
    expect(outputMeta.height).toBe(200);
    // The corrected image must not carry a leftover non-1 orientation tag
    // that would cause a second, double rotation downstream — sharp clears
    // it entirely once applied (metadata().orientation comes back undefined).
    expect([undefined, 1]).toContain(outputMeta.orientation);
    expect(result.appliedSteps).toContain("auto-orient");
    expect(result.appliedSteps).toContain("sharpen");
  });

  it("leaves an already-upright image's dimensions alone", async () => {
    const upright = await makeTestJpeg({ width: 100, height: 200 });
    const base64 = upright.toString("base64");

    const result = await preprocessScanImage(base64, "image/jpeg");

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.width).toBe(100);
    expect(outputMeta.height).toBe(200);
  });
});

describe("preprocessScanImage — resize and compress", () => {
  it("downscales an image wider than maxWidth without enlarging a smaller one", async () => {
    const huge = await makeTestJpeg({ width: 4000, height: 3000 });
    const result = await preprocessScanImage(huge.toString("base64"), "image/jpeg", { maxWidth: 2000 });

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.width).toBeLessThanOrEqual(2000);
    expect(result.appliedSteps.some((s) => s.startsWith("downscale"))).toBe(true);
  });

  it("does not enlarge an image smaller than maxWidth", async () => {
    const small = await makeTestJpeg({ width: 300, height: 200 });
    const result = await preprocessScanImage(small.toString("base64"), "image/jpeg", { maxWidth: 2000 });

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.width).toBe(300);
  });

  it("re-encodes to JPEG regardless of a PNG input mimeType", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    const result = await preprocessScanImage(png.toString("base64"), "image/png");

    expect(result.mimeType).toBe("image/jpeg");
  });
});

describe("preprocessScanImage — blur scoring", () => {
  it("returns a numeric blurScore and isBlurred flag for a normal image", async () => {
    const img = await makeTestJpeg({ width: 300, height: 200 });
    const result = await preprocessScanImage(img.toString("base64"), "image/jpeg");

    expect(typeof result.blurScore).toBe("number");
    expect(result.isBlurred).toBe(result.blurScore < SERVER_BLUR_WARNING_THRESHOLD);
  });

  it("passes PDFs through untouched with a neutral non-blurred score rather than running pixel analysis on non-image bytes", async () => {
    const fakePdfBytes = Buffer.from("%PDF-1.4 fake pdf content");
    const result = await preprocessScanImage(fakePdfBytes.toString("base64"), "application/pdf");

    expect(result.buffer.equals(fakePdfBytes)).toBe(true);
    expect(result.isBlurred).toBe(false);
    expect(result.appliedSteps).toEqual([]);
  });
});

describe("preprocessScanImage — graceful degradation", () => {
  it("falls back to the raw input instead of throwing when the bytes aren't a real image", async () => {
    const garbage = Buffer.from("this is not an image at all, just text bytes");

    const result = await preprocessScanImage(garbage.toString("base64"), "image/jpeg");

    expect(result.buffer.equals(garbage)).toBe(true);
    expect(result.isBlurred).toBe(false);
  });
});
