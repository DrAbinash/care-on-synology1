/**
 * framesViewerErrorStates.test.ts — the Frames viewer must show real error
 * states with a Retry, not an eternal loading spinner (audit F-13).
 *
 * Series and instance fetches returned early on !res.ok and caught silently;
 * the frame <img> onerror only cleared the spinner; the series panel kept
 * saying 'Loading series...' forever. A proxy or credentials problem
 * rendered as a black viewport with no error state and no retry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const viewer = readFileSync(
  resolve(PKG_DIR, "src/components/EmbeddedWadoViewer.tsx"),
  "utf8",
).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("F-13: fetch failures surface with status and retry", () => {
  it("the series fetch reports the HTTP status instead of returning silently", () => {
    expect(viewer).toMatch(/if \(!res\.ok\) \{\s*setListError\(\{ scope: "series", status: res\.status \}\);/);
  });

  it("the instances fetch does the same", () => {
    expect(viewer).toMatch(/setListError\(\{ scope: "instances", status: res\.status \}\);/);
  });

  it("network catches set the error instead of ignoring it", () => {
    expect(viewer).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
    expect(viewer.match(/message: err instanceof Error \? err\.message : "network error"/g)?.length)
      .toBeGreaterThanOrEqual(2);
  });

  it("the frame onerror surfaces a retry-able error, not just a cleared spinner", () => {
    expect(viewer).toMatch(/img\.onerror = \(\) => \{\s*setLoadingFrames\(false\);\s*setFrameUrl\(null\);\s*setListError\(\{ scope: "frame", message:/);
  });

  it("both surfaces render an error banner with a Retry button", () => {
    expect(viewer).toContain('data-testid="frames-list-error"');
    expect(viewer).toContain('data-testid="frames-list-retry"');
    expect(viewer).toContain('data-testid="frames-frame-error"');
    expect(viewer).toContain('data-testid="frames-frame-retry"');
  });

  it("retry actually re-runs the loads (reloadKey in every dependency list)", () => {
    expect(viewer).toMatch(/useEffect\(\(\) => \{ fetchSeries\(\); \}, \[fetchSeries, reloadKey\]\);/);
    expect(viewer).toMatch(/useEffect\(\(\) => \{ fetchInstances\(\); \}, \[fetchInstances, reloadKey\]\);/);
    expect(viewer).toMatch(/selectedInstIdx, reloadKey\]\);/);
    expect(viewer).toMatch(/setReloadKey\(\(k\) => k \+ 1\)/);
  });
});
