/**
 * PRIORITY 2 (RIS/PACS integration review, 2026-10-16) — the embedded DICOM viewer kept
 * rendering the previous study after a study switch.
 *
 * `ViewerContent` is where all of the panel's study-scoped state lives: `selectedSeriesUID`,
 * `instances`, `frameUrl`, `zoom`/`pan`/brightness/contrast. Nothing in it was reset when the
 * `studyInstanceUID` prop changed, and React reuses a subtree whenever the element type AND key
 * match — so a switch of study was a props update on the same live component, not a new one.
 * The consequence is not cosmetic: `fetchSeries` selects a series only `if (!selectedSeriesUID)`,
 * so the previous study's selection actively blocks the new study's first series; the instance
 * fetch then asks for `/studies/<new>/series/<old>/instances`, gets an error it swallows
 * (`if (!res.ok) return;`), and leaves `instances`/`frameUrl` holding the previous patient's
 * images under the new patient's header and UID badge.
 *
 * This file pins the wiring that performs the reset. It is a source-contract test on purpose:
 * `artifacts/diagnostic-erp` has no DOM test harness — no jsdom, no @testing-library, nothing
 * that can mount a component (verified 2026-10-16 against this tree's full dependency graph) —
 * so React's reuse semantics cannot be asserted at runtime here. The runtime behaviour was
 * instead checked in a real browser against the shipped component with a stubbed DICOMweb
 * archive; that evidence is recorded on the pull request, not claimed by this file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viewerSrc = readFileSync(resolve(__dirname, "../components/EmbeddedWadoViewer.tsx"), "utf8");

/** The JSX opening tag of the element React uses to identify the panel instance. */
function openingTagOf(src: string, element: string): string {
  const at = src.indexOf(`<${element}`);
  expect(at, `<${element}> is not rendered`).toBeGreaterThan(-1);
  const end = src.indexOf("/>", at);
  expect(end, `<${element}> is never closed`).toBeGreaterThan(at);
  return src.slice(at, end + 2);
}

describe("the embedded viewer panel is scoped to the study it renders", () => {
  it("keys ViewerContent by the effective StudyInstanceUID", () => {
    const tag = openingTagOf(viewerSrc, "ViewerContent");
    // Not `key={studyInstanceUID}`: when the UID is resolved from the worklist row after mount,
    // `effectiveUid` carries the server's answer, and a panel keyed on the prop alone would keep
    // its state across that transition.
    expect(tag).toMatch(/key=\{\s*effectiveUid\s*\}/);
    expect(tag).toMatch(/studyInstanceUID=\{\s*effectiveUid\s*\}/);
  });

  it("owns the reset inside the component, so every mount point inherits it", () => {
    // Two surfaces mount the viewer today — the reporting workspace's viewer column and the
    // Command Center's viewport. Keying them at the call site would leave the second one to be
    // remembered; a third mount would not be keyed at all. The census is where that is noticed.
    const mounts = [
      "../components/radiology/workspace/ViewerColumn.tsx",
      "../pages/RadiologyCommandCenter.tsx",
    ];
    for (const rel of mounts) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src, `${rel} no longer mounts the embedded viewer`).toContain("<EmbeddedWadoViewer");
      // Neither call site may re-key it, which would fight the internal scoping.
      expect(openingTagOf(src, "EmbeddedWadoViewer")).not.toMatch(/\bkey=/);
    }
    // The scoping is unconditional: no branch may render the panel without the UID that keys it.
    expect(viewerSrc).toMatch(/if \(!effectiveUid\)/);
  });
});
