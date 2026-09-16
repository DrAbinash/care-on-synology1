import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ERP_SRC = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

describe("FrozenKeyImagesRail capture camera", () => {
  const rail = read("components/radiology/FrozenKeyImagesRail.tsx");
  const viewer = read("components/EmbeddedWadoViewer.tsx");
  const workspace = read("pages/RadiologyReportingWorkspace.tsx");

  it("exposes a clickable capture control separate from the expand toggle", () => {
    expect(rail).toContain('data-testid="frozen-key-images-capture"');
    expect(rail).toContain("onCaptureRequest");
    // Toggle must not own the only Camera — capture is a sibling button.
    expect(rail).toMatch(/data-testid="frozen-key-images-rail-toggle"[\s\S]*?Key Images/);
    expect(rail).toContain("Click the camera to capture the active viewer");
  });

  it("wires the viewer captureKeyImage handle into the reporting workspace", () => {
    expect(viewer).toContain("captureKeyImage:");
    expect(viewer).toContain('return ok ? "frames" : "unavailable"');
    expect(workspace).toContain("requestFrozenKeyImageCapture");
    expect(workspace).toContain("onCaptureRequest=");
    expect(workspace).toContain("captureKeyImage");
  });
});
