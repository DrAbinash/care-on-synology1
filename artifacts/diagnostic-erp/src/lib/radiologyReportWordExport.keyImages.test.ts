/**
 * The Word export's key-image vocabulary — pinned RED-first for the
 * "Word export prints ZERO images" defect.
 *
 * For years the .docx builder parsed only text blocks: the server-layout
 * branch received hydrated HTML whose `<figure class="image-cell">` rail was
 * silently unmatched (images AND captions vanished), and the client-fallback
 * branch printed a text-only stand-in list ("Image 1 (KEY): …"). The PDF door
 * had a full image rail; the Word door had none — silent content loss on a
 * patient-visible document.
 *
 * These tests pin the pure layer of the fix: the explicit `keyImages` param is
 * parsed into block-level specs, and the client fallback's textual stand-in is
 * dropped when real images are supplied. The docx ImageRun wiring itself is
 * pinned by printExportBacklog.contract.test.ts (source contract — the repo's
 * convention for browser-only assembly).
 */
import { describe, expect, it } from "vitest";
import {
  dropKeyImagesTextBlocks,
  parseReportHtmlToBlocks,
  parseWordKeyImages,
} from "./radiologyReportWordExport";

const JPEG = `data:image/jpeg;base64,${"A".repeat(120)}`;
const PNG = `data:image/png;base64,${"B".repeat(120)}`;

describe("parseWordKeyImages", () => {
  it("a readable jpeg data URL is an image spec with jpg mime and a trimmed caption", () => {
    const out = parseWordKeyImages([{ src: JPEG, caption: "  Sagittal T2  " }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "image", src: JPEG, mime: "jpg", caption: "Sagittal T2" });
  });

  it("a readable png data URL is an image spec with png mime", () => {
    const out = parseWordKeyImages([{ src: PNG, caption: null }]);
    expect(out[0]).toEqual({ kind: "image", src: PNG, mime: "png", caption: "" });
  });

  it("an empty src is an unreadable spec — the placeholder names nothing it was not told", () => {
    const out = parseWordKeyImages([{ src: "", caption: "Axial DWI" }]);
    expect(out[0]).toEqual({ kind: "unreadable", caption: "Axial DWI" });
  });

  it("a src that is not a data URL cannot be typed for docx ImageRun — unreadable, not guessed", () => {
    const out = parseWordKeyImages([{ src: "https://pacs.example/rendered/1.2.3", caption: "Remote" }]);
    expect(out[0]).toEqual({ kind: "unreadable", caption: "Remote" });
  });

  it("an unknown data URL mime is unreadable — docx needs a real type", () => {
    const out = parseWordKeyImages([{ src: "data:image/webp;base64,AAAA", caption: "" }]);
    expect(out[0]).toEqual({ kind: "unreadable", caption: "" });
  });

  it("order and identity are preserved — the rail's order is the radiologist's", () => {
    const out = parseWordKeyImages([
      { src: JPEG, caption: "First" },
      { src: "", caption: "Second" },
      { src: PNG, caption: "Third" },
    ]);
    expect(out.map((o) => o.kind)).toEqual(["image", "unreadable", "image"]);
    expect(out.map((o) => o.caption)).toEqual(["First", "Second", "Third"]);
  });
});

describe("dropKeyImagesTextBlocks", () => {
  const blocksWithStandIn = parseReportHtmlToBlocks(`
    <div class="section-heading">Findings</div><p>Text.</p>
    <h3><u>KEY IMAGES</u></h3>
    <ul><li>Image 1 (KEY): Axial mid-ventricle</li><li>Image 2: Sagittal T2</li></ul>
    <div class="section-heading">Impression</div><p>Normal study.</p>
  `);

  it("drops the KEY IMAGES heading and the list immediately after it", () => {
    const out = dropKeyImagesTextBlocks(blocksWithStandIn);
    const texts = out.map((b) => (b.type === "heading2" ? b.text : b.type));
    expect(texts).not.toContain("KEY IMAGES");
    expect(out.some((b) => b.type === "list")).toBe(false);
    // Everything around the stand-in survives.
    expect(out.map((b) => (b.type === "heading2" ? b.text : b.type)))
      .toEqual(["Findings", "paragraph", "Impression", "paragraph"]);
  });

  it("an unrelated list is never touched", () => {
    const blocks = parseReportHtmlToBlocks(`
      <div class="section-heading">Impression</div>
      <ul><li>Mild cardiomegaly</li></ul>
    `);
    const out = dropKeyImagesTextBlocks(blocks);
    expect(out.some((b) => b.type === "list")).toBe(true);
  });

  it("a KEY IMAGES heading with no following list drops just the heading", () => {
    const blocks = parseReportHtmlToBlocks(`
      <div class="section-heading">Findings</div><p>Text.</p>
      <h3><u>KEY IMAGES</u></h3>
      <div class="section-heading">Impression</div><p>Normal.</p>
    `);
    const out = dropKeyImagesTextBlocks(blocks);
    expect(out.map((b) => (b.type === "heading2" ? b.text : b.type)))
      .toEqual(["Findings", "paragraph", "Impression", "paragraph"]);
  });
});
