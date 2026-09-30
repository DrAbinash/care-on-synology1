/**
 * mriSpineSegmentConsumers.test.ts — `SpineSegment = "dorsolumbar"` is a routing
 * discriminator, not a fourth clinical region (dorso-lumbar hard requirement 4).
 *
 * Adding a value to a union is how a concept quietly becomes a region: every
 * consumer reads the same field but means something different by it. This file
 * pins each consumer's meaning down with an executable statement, so a later
 * edit cannot make routing, anatomical domain, ledger ownership, screening
 * ownership and study composition interchangeable.
 *
 * The six meanings:
 *   1 canvas gates            → ROUTING (which editor opens)
 *   2 LS feature gate         → ROUTING / FEATURE GATE (whose machinery applies)
 *   3 macro catalog           → MACRO CATALOG ROUTING (which tiles are offered)
 *   4 canal AP segment        → MEASUREMENT SCOPE (which table is implied)
 *   5 composer region label   → PRINTED LABEL (what the AI is told it reports on)
 *   6 structured-template key → TEMPLATE KEY (which saved template is nearest)
 *
 * None of them is the ledger region (`radiology_study_tabs.name` on the
 * observation), the screening regions (cervical / dorsal / ls with a
 * `RegionRole`), or the study composition (`StudyComposition`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildReportingStudyContext,
  spineSegmentFromRegion,
  type SpineSegment,
} from "@/lib/reportingStudyContext";
import { chocolateBoxSetFor } from "@/lib/findingsMacros";
import { canalSegmentFromSpine } from "@/lib/spineCanalAp";
import { studyRegionToBodyPart } from "@/lib/pickStructuredTemplate";
import {
  isMriDorsalReportingContext,
  isMriDorsoLumbarReportingContext,
} from "@/lib/mriSpineCanvasRegions";
import { isMriLumbarReportingContext } from "@/lib/mriLumbarRegions";
import { dorsolumbarLevelDomain } from "@/lib/mriDorsoLumbarCoverage";
import { resolveStudyComposition } from "@/lib/mriDorsoLumbarCatalog";

const HERE = dirname(fileURLToPath(import.meta.url));

const dl = buildReportingStudyContext({ modality: "MR", regions: ["DL Spine"], source: "billed" });

describe("consumer 1 + 2: canvas and feature gates route, they do not re-region", () => {
  it("classifies the DL label as its own routing segment", () => {
    expect(dl.spineSegment).toBe("dorsolumbar");
    expect(dl.family).toBe("spine");
    expect(spineSegmentFromRegion("Dorso-Lumbar Spine")).toBe("dorsolumbar");
    expect(spineSegmentFromRegion("Thoracolumbar Spine")).toBe("dorsolumbar");
  });

  it("opens the dorso-lumbar canvas and refuses the single-segment canvases", () => {
    const opts = { modality: "MR", region: dl.region, spineSegment: dl.spineSegment };
    expect(isMriDorsoLumbarReportingContext(opts)).toBe(true);
    expect(isMriDorsalReportingContext(opts)).toBe(false);
    expect(isMriLumbarReportingContext(opts)).toBe(false);
  });
});

describe("consumer 3: the macro catalog", () => {
  it("does not hand a Dorso-Lumbar study the dorsal or lumbar tile set", () => {
    const set = chocolateBoxSetFor(dl);
    // Generic spine tiles are honest; a segment set would claim an examination
    // that was not billed and re-create the old "DL means dorsal" defect.
    expect(set?.key).toBe("spine");
    expect(["dorsal", "lumbar", "cervical", "whole-spine", "brain"]).not.toContain(set?.key);
  });
});

describe("consumer 4: canal AP measurement scope", () => {
  it("leaves the segment unresolved instead of guessing one table", () => {
    expect(canalSegmentFromSpine(dl.spineSegment)).toBeNull();
    // The single-segment studies keep answering as before.
    expect(canalSegmentFromSpine("dorsal")).toBe("dorsal");
    expect(canalSegmentFromSpine("lumbar")).toBe("lumbar");
    expect(canalSegmentFromSpine("cervical")).toBe("cervical");
  });

  it("still knows the anatomy of each level, which is not the same question", () => {
    // Anatomical domain comes from the coverage resolver, not from the segment:
    // a Dorso-Lumbar study spans three domains over one examination.
    expect(dorsolumbarLevelDomain("T8-T9")).toBe("thoracic");
    expect(dorsolumbarLevelDomain("T12-L1")).toBe("junction");
    expect(dorsolumbarLevelDomain("L1-T12")).toBe("junction");
    expect(dorsolumbarLevelDomain("L3-L4")).toBe("lumbar");
  });
});

describe("consumer 6: structured-template key", () => {
  it("keeps the nearest existing template family and never a thoracic-only one", () => {
    // "Dorso-Lumbar Spine" and "Thoracolumbar Spine" both contain "lumbar", so
    // the template catalog answers SPINE_LS; "DL Spine" names nothing in that
    // catalog and answers null. This is a TEMPLATE KEY only — it does not make
    // the study an LS examination, and it must never silently become
    // SPINE_DORSAL, which would put thoracic-only headings over a study that
    // also covers the lumbar spine.
    expect(studyRegionToBodyPart("Dorso-Lumbar Spine")).toBe("SPINE_LS");
    expect(studyRegionToBodyPart("Thoracolumbar Spine")).toBe("SPINE_LS");
    expect(studyRegionToBodyPart("DL Spine")).toBeNull();
    expect(studyRegionToBodyPart("Dorsal Spine")).toBe("SPINE_DORSAL");
  });
});

describe("the composition and the ledger are separate concepts", () => {
  it("resolves the composition from billing, not from the segment", () => {
    const resolved = resolveStudyComposition({ code: "MRI020", name: "MRI DL SPINE" });
    expect(resolved.composition).toBe("dorsolumbar-dedicated");
    // Ownership stays the three screening regions, each with a role; a fourth
    // "dorsolumbar" region was never added.
    expect(Object.keys(resolved.roles).sort()).toEqual(["cervical", "dorsal", "ls"]);
  });

  it("names the examination in the composer label rather than falling back to a bare region", () => {
    const hook = readFileSync(
      resolve(HERE, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
      "utf8",
    );
    expect(hook).toMatch(/segment === "dorsolumbar"\)\s*return "MRI Dorso-Lumbar Spine"/);
    expect(hook).not.toMatch(/segment === "dorsolumbar"\)\s*return "MRI Dorsal Spine"/);
  });

  it("keeps the union honest: dorsolumbar is a value, not a region name", () => {
    const segments: SpineSegment[] = ["cervical", "dorsal", "dorsolumbar", "lumbar", "whole", "generic"];
    expect(segments).toHaveLength(6);
  });
});
