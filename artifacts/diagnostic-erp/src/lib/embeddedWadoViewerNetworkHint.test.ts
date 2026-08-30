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
});
