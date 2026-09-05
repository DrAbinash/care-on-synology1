import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EmbeddedWadoViewer LAN/Tailscale selector + mixed-content hint", () => {
  const src = readFileSync(
    resolve(__dirname, "../components/EmbeddedWadoViewer.tsx"),
    "utf8",
  );

  it("exposes LAN | Tailscale | Auto on the DICOM Viewer toolbar", () => {
    expect(src).toContain('data-testid="viewer-network-toggle"');
    expect(src).toContain("embedNetworkModeOptions");
    expect(src).toContain('data-testid={`viewer-network-${opt.id.toLowerCase()}`}');
  });

  it("points mixed-content failures at that toggle and offers Try Tailscale", () => {
    expect(src).toContain('data-testid="ohif-mixed-content-blocked"');
    expect(src).toContain("LAN | Tailscale | Auto");
    expect(src).toContain('data-testid="ohif-try-tailscale"');
    expect(src).toContain('chooseNetworkMode("TAILSCALE")');
    expect(src).toContain("Viewer Network Routes");
  });

  it("keeps annotated capture as a compact toolbar tab (not a full-width ribbon)", () => {
    expect(src).toContain('data-testid="ohif-capture-fallback-hint"');
    expect(src).toContain('data-testid="ohif-request-annotated-capture"');
    expect(src).toContain('"Annotate"');
    // Must sit on the OHIF toolbar row before the column-expand size control.
    const tabAt = src.indexOf('data-testid="ohif-capture-fallback-hint"');
    const expandAt = src.indexOf('data-testid="viewer-column-expand"');
    expect(tabAt).toBeGreaterThan(-1);
    expect(expandAt).toBeGreaterThan(tabAt);
    // No full-width amber strip above the iframe.
    expect(src).not.toMatch(/ohif-capture-fallback-hint[\s\S]{0,200}ohif-embed/);
    expect(src).not.toContain("Request annotated capture");
  });
});
