/**
 * Viewport-true capture geometry — DOM rect relative draw (not zoom*natural).
 */
import { describe, expect, it } from "vitest";
import { layoutViewportCapture } from "./framesViewportCapture";

describe("layoutViewportCapture", () => {
  it("zoom = 1, centered: image fills/fits inside viewport with black letterbox margins", () => {
    // Landscape viewport 800×600; image centered at natural display size 640×480
    const viewport = { left: 100, top: 50, width: 800, height: 600 };
    const image = { left: 180, top: 110, width: 640, height: 480 };
    const layout = layoutViewportCapture(viewport, image, 1600);
    expect(layout.scale).toBe(1);
    expect(layout.canvasW).toBe(800);
    expect(layout.canvasH).toBe(600);
    expect(layout.dx).toBe(80);
    expect(layout.dy).toBe(60);
    expect(layout.dw).toBe(640);
    expect(layout.dh).toBe(480);
    // Image fully inside canvas — no clip
    expect(layout.dx).toBeGreaterThanOrEqual(0);
    expect(layout.dy).toBeGreaterThanOrEqual(0);
    expect(layout.dx + layout.dw).toBeLessThanOrEqual(layout.canvasW);
    expect(layout.dy + layout.dh).toBeLessThanOrEqual(layout.canvasH);
  });

  it("zoom > 1: viewport clips oversized image (negative offsets / overflow)", () => {
    const viewport = { left: 0, top: 0, width: 400, height: 300 };
    // Zoomed image larger than viewport, centered → extends past edges
    const image = { left: -100, top: -75, width: 600, height: 450 };
    const layout = layoutViewportCapture(viewport, image, 1600);
    expect(layout.canvasW).toBe(400);
    expect(layout.canvasH).toBe(300);
    expect(layout.dx).toBe(-100);
    expect(layout.dy).toBe(-75);
    expect(layout.dw).toBe(600);
    expect(layout.dh).toBe(450);
    // Overflow past canvas → browser/canvas clip matches viewport
    expect(layout.dx).toBeLessThan(0);
    expect(layout.dy).toBeLessThan(0);
    expect(layout.dx + layout.dw).toBeGreaterThan(layout.canvasW);
    expect(layout.dy + layout.dh).toBeGreaterThan(layout.canvasH);
  });

  it("positive pan shifts image right/down relative to viewport", () => {
    const viewport = { left: 10, top: 20, width: 500, height: 400 };
    const centered = { left: 60, top: 70, width: 400, height: 300 };
    const panned = { left: 60 + 40, top: 70 + 25, width: 400, height: 300 };
    const a = layoutViewportCapture(viewport, centered);
    const b = layoutViewportCapture(viewport, panned);
    expect(b.dx - a.dx).toBeCloseTo(40);
    expect(b.dy - a.dy).toBeCloseTo(25);
  });

  it("negative pan shifts image left/up relative to viewport", () => {
    const viewport = { left: 0, top: 0, width: 500, height: 400 };
    const centered = { left: 50, top: 50, width: 400, height: 300 };
    const panned = { left: 50 - 60, top: 50 - 30, width: 400, height: 300 };
    const a = layoutViewportCapture(viewport, centered);
    const b = layoutViewportCapture(viewport, panned);
    expect(b.dx - a.dx).toBeCloseTo(-60);
    expect(b.dy - a.dy).toBeCloseTo(-30);
  });

  it("portrait image in landscape viewport: letterbox left/right", () => {
    const viewport = { left: 0, top: 0, width: 800, height: 450 };
    const image = { left: 275, top: 0, width: 250, height: 450 };
    const layout = layoutViewportCapture(viewport, image);
    expect(layout.canvasW).toBe(800);
    expect(layout.canvasH).toBe(450);
    expect(layout.dx).toBe(275);
    expect(layout.dy).toBe(0);
    expect(layout.dw).toBe(250);
    expect(layout.dh).toBe(450);
    expect(layout.dx).toBeGreaterThan(0);
    expect(layout.dx + layout.dw).toBeLessThan(layout.canvasW);
  });

  it("landscape image in portrait viewport: letterbox top/bottom", () => {
    const viewport = { left: 0, top: 0, width: 360, height: 640 };
    const image = { left: 0, top: 160, width: 360, height: 320 };
    const layout = layoutViewportCapture(viewport, image);
    expect(layout.canvasW).toBe(360);
    expect(layout.canvasH).toBe(640);
    expect(layout.dx).toBe(0);
    expect(layout.dy).toBe(160);
    expect(layout.dw).toBe(360);
    expect(layout.dh).toBe(320);
    expect(layout.dy).toBeGreaterThan(0);
    expect(layout.dy + layout.dh).toBeLessThan(layout.canvasH);
  });

  it("downscales large viewports to maxEdge while preserving aspect ratios", () => {
    const viewport = { left: 0, top: 0, width: 3200, height: 1800 };
    const image = { left: 0, top: 0, width: 3200, height: 1800 };
    const layout = layoutViewportCapture(viewport, image, 1600);
    expect(layout.scale).toBe(0.5);
    expect(layout.canvasW).toBe(1600);
    expect(layout.canvasH).toBe(900);
    expect(layout.dw).toBe(1600);
    expect(layout.dh).toBe(900);
  });
});
