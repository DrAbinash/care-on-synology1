import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_FRAMING, SIDE_RAIL_MAX_IMAGES, clampZoom,
  detectContentBoundingBox, framingImgInline, framingImgStyle, framingInlineStyle, parseImageFraming,
  sideRailCount, suggestFramingFromBox,
} from "./imageFraming";

describe("imageFraming", () => {
  it("defaults cover/1/0/0 and clamps hostile values", () => {
    expect(parseImageFraming(null)).toEqual(DEFAULT_IMAGE_FRAMING);
    expect(parseImageFraming("{not json")).toEqual(DEFAULT_IMAGE_FRAMING);
    expect(parseImageFraming({ zoom: 99, offsetX: -500, fitMode: "contain" })).toEqual({
      zoom: 4, offsetX: -80, offsetY: 0, fitMode: "contain",
    });
    expect(clampZoom(0)).toBe(0.5);
  });

  it("emits CSS variables the report viewport consumes", () => {
    const css = framingInlineStyle({ zoom: 1.35, offsetX: -12, offsetY: 8, fitMode: "cover" });
    expect(css).toContain("--img-zoom:1.35");
    expect(css).toContain("--img-ox:-12%");
    expect(css).toContain("--img-oy:8%");
    expect(css).toContain("--img-fit:cover");
    const img = framingImgStyle({ zoom: 1.35, offsetX: -12, offsetY: 8, fitMode: "cover" });
    expect(img.objectFit).toBe("cover");
    expect(img.transform).toBe("translate(-12%, 8%) scale(1.35)");
    expect(framingImgInline({ zoom: 1.35, offsetX: -12, offsetY: 8, fitMode: "cover" })).toContain("scale(1.35)");
  });

  it("caps the right-hand rail at 6 images", () => {
    expect(sideRailCount(0)).toBe(0);
    expect(sideRailCount(4)).toBe(4);
    expect(sideRailCount(6)).toBe(SIDE_RAIL_MAX_IMAGES);
    expect(sideRailCount(24)).toBe(6);
  });

  it("detects a near-black border and suggests a cover zoom", () => {
    const w = 40;
    const h = 30;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 8; y < 22; y++) {
      for (let x = 10; x < 30; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 200;
        px[i + 3] = 255;
      }
    }
    const box = detectContentBoundingBox(px, w, h);
    expect(box).toEqual({ x: 10, y: 8, w: 20, h: 14 });
    const suggested = suggestFramingFromBox(box!, w, h);
    expect(suggested.fitMode).toBe("cover");
    expect(suggested.zoom).toBeGreaterThan(1);
  });

  it("does not suggest a crop when the frame is already filled", () => {
    const w = 10;
    const h = 10;
    const px = new Uint8ClampedArray(w * h * 4);
    px.fill(200);
    expect(detectContentBoundingBox(px, w, h)).toBeNull();
  });
});
