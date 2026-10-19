/**
 * normalBootstrapCoverage.test.ts — the honest automatic normal-first coverage table.
 *
 * Owner review of PR #1077 (2026-10-19): the acceptance journeys applied normal
 * formats manually for some CT / X-ray / mammography examinations, which proves
 * the ENGINE composes those reports and proves nothing about whether a study
 * OPENS with one. This file measures the real resolver against the real shipped
 * format library and pins what it finds — so automatic normal-first coverage is
 * claimed exactly where it is proven, and nowhere else.
 *
 * MEASURED (built-in library, plain study, 2026-10-19):
 *
 *   AUTO-OPENS with a complete normal report (technique, findings, impression,
 *   recommendation all present):
 *     MR Brain (plain → Standard Normal; contrast / epilepsy variants by protocol)
 *     MR Cervical Spine (standard; screening variant by protocol)
 *     MR Dorsal Spine   (standard; screening variant by protocol)
 *     MR LS Spine       (standard; screening variant by protocol)
 *     MR Whole Spine    (screening normal)
 *     MR Knee           (standard normal)
 *     CT Brain          (normal)
 *     CT Chest          (normal)
 *     XR LS Spine       (normal)
 *
 *   SUPPORTED BY QUICK SELECT TILES but NO auto-open — the honest gaps:
 *     CT PNS, MR Pelvis, MR Shoulder — no complete-normal format exists in the
 *     shipped library, so there is nothing for the bootstrap to apply. Closing
 *     these gaps means the owner authoring (or the clinic's Templates screen
 *     carrying) a complete normal for each; the resolver then picks it up with
 *     no code change. NOT silently authored here.
 *
 *   NEVER auto-bootstraps, by design (normalBootstrap.ts rule 1):
 *     MG (mammography — not used at this clinic), US (own companion flow).
 *
 * What this table measures is the BUILT-IN library floor. At the clinic the
 * Templates screen additionally ingests the clinic's own structured normal rows
 * (`ingestStructuredNormalFormats`), which can only ADD candidates; coverage
 * there is at least this table and is proven by the clinic's own template list,
 * which this repo cannot see.
 *
 * The one-time guards (new + empty report, no draft, no backup, not locked) are
 * normalBootstrap.test.ts's territory; this file answers only the question
 * "WHEN the guards pass, which examinations resolve a complete normal?"
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-tiles.data";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  bootstrapModality,
  isNormalBootstrapCandidate,
  resolveNormalBootstrapFormat,
} from "./normalBootstrap";

const FORMATS = DEFAULT_REPORT_FORMATS;

function ctx(input: {
  modality: string;
  region: string;
  studyDescription?: string;
  protocolName?: string;
}): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: input.modality,
    studyDescription: input.studyDescription ?? input.region,
    regions: [input.region],
    source: "auto",
    protocolName: input.protocolName ?? null,
  });
}

function resolve(modality: string, region: string, studyDescription?: string) {
  return resolveNormalBootstrapFormat({
    ctx: ctx({ modality, region, studyDescription }),
    formats: FORMATS,
  });
}

/** The examination identities the shipped library itself serves. */
function libraryIdentities(): Array<{ modality: string; region: string }> {
  const seen = new Set<string>();
  const out: Array<{ modality: string; region: string }> = [];
  for (const f of FORMATS) {
    const key = `${f.modality}|${f.bodyPart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ modality: f.modality, region: f.bodyPart });
  }
  return out.sort((a, b) => a.modality.localeCompare(b.modality) || a.region.localeCompare(b.region));
}

/** Quick Select tile scopes — the examinations the workspace actively supports. */
function tileScopes(): Array<{ modality: string; region: string }> {
  const seen = new Set<string>();
  const out: Array<{ modality: string; region: string }> = [];
  for (const t of DEFAULT_QUICK_SELECT_TILES) {
    if (!t.scopeModality || !t.scopeBodyPart) continue; // cross-region utilities
    const key = `${t.scopeModality}|${t.scopeBodyPart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ modality: t.scopeModality, region: t.scopeBodyPart });
  }
  return out.sort((a, b) => a.modality.localeCompare(b.modality) || a.region.localeCompare(b.region));
}

/** The pinned auto-open set: identity → the one format the resolver must pick. */
const AUTO_OPEN: Record<string, string> = {
  "MR Brain": "MRI Brain — Standard Normal",
  "MR Cervical Spine": "MRI Cervical Spine — Standard Normal",
  "MR Dorsal Spine": "MRI Dorsal Spine — Standard Normal",
  "MR Knee": "MRI Knee — Standard Normal",
  "MR LS Spine": "MRI LS Spine — Standard Normal",
  "MR Whole Spine": "MRI Whole Spine — Screening Normal",
  "CT Brain": "CT Brain — Normal",
  "CT Chest": "CT Chest — Normal",
  "XR LS Spine": "XR LS Spine — Normal",
};

/** Tile-supported examinations with no shipped complete normal — manual Start Report. */
const MANUAL_GAPS = ["CT PNS", "MR Pelvis", "MR Shoulder"];

describe("automatic normal-first coverage — the measured table (owner review of #1077)", () => {
  it("every pinned auto-open identity resolves its one complete normal", () => {
    for (const [identity, expectedFormat] of Object.entries(AUTO_OPEN)) {
      const [modality, ...rest] = identity.split(" ");
      const region = rest.join(" ");
      const decision = resolve(modality, region);
      expect(decision?.status, `${identity} should auto-open a normal`).toBe("apply");
      if (decision?.status !== "apply") continue;
      expect(decision.format.name, `${identity} auto-open format`).toBe(expectedFormat);
      // "Complete normal report" means all four sections carry prose.
      expect(decision.format.technique.trim(), `${identity} technique`).not.toBe("");
      expect(decision.format.findings.trim(), `${identity} findings`).not.toBe("");
      expect(decision.format.impression.trim(), `${identity} impression`).not.toBe("");
      expect(decision.format.recommendation.trim(), `${identity} recommendation`).not.toBe("");
    }
  });

  it("protocol variants still resolve: brain contrast / epilepsy, LS screening", () => {
    const contrast = resolve("MR", "Brain", "MRI BRAIN WITH CONTRAST");
    expect(contrast?.status).toBe("apply");
    expect(contrast?.status === "apply" ? contrast.format.name : "").toBe("MRI Brain — Normal (Contrast)");
    const epilepsy = resolve("MR", "Brain", "MRI BRAIN EPILEPSY PROTOCOL");
    expect(epilepsy?.status).toBe("apply");
    expect(epilepsy?.status === "apply" ? epilepsy.format.name : "").toBe("MRI Brain — Epilepsy Protocol (Normal)");
    const screening = resolve("MR", "LS Spine", "MRI LS SPINE WHOLE SPINE SCREENING");
    expect(screening?.status).toBe("apply");
    expect(screening?.status === "apply" ? screening.format.name : "").toMatch(/Screening/i);
  });

  it("the honest gaps: tile-supported exams with NO shipped normal stay manual, by reason", () => {
    for (const identity of MANUAL_GAPS) {
      const [modality, ...rest] = identity.split(" ");
      const region = rest.join(" ");
      const decision = resolve(modality, region);
      expect(decision?.status, `${identity} has no shipped normal to auto-apply`).toBe("no-match");
      if (decision?.status !== "no-match") continue;
      expect(decision.reason).toMatch(/no complete-normal format/i);
    }
  });

  it("every tile-supported examination is classified: auto-open, honest gap, or whitelist outside", () => {
    const scopes = tileScopes().map((s) => `${s.modality} ${s.region}`);
    for (const identity of scopes) {
      const classified = identity in AUTO_OPEN
        || MANUAL_GAPS.includes(identity)
        || identity.startsWith("MG ")
        || identity.startsWith("US ");
      expect(classified, `${identity} must appear in the coverage table`).toBe(true);
    }
    // And the shipped library serves no identity the table does not name.
    for (const { modality, region } of libraryIdentities()) {
      const identity = `${modality} ${region}`;
      const classified = identity in AUTO_OPEN
        || MANUAL_GAPS.includes(identity)
        || identity.startsWith("MG ")
        || identity.startsWith("US ");
      expect(classified, `library identity ${identity} must appear in the coverage table`).toBe(true);
    }
  });

  it("the modality whitelist is exactly MR / CT / XR (MG and US never auto-bootstrap)", () => {
    expect(bootstrapModality("MR")).toBe("MR");
    expect(bootstrapModality("MRI")).toBe("MR");
    expect(bootstrapModality("CT")).toBe("CT");
    expect(bootstrapModality("XR")).toBe("XR");
    expect(bootstrapModality("DX")).toBe("XR");
    expect(bootstrapModality("CR")).toBe("XR");
    expect(bootstrapModality("IO")).toBe("XR");
    expect(bootstrapModality("MG")).toBeNull();
    expect(bootstrapModality("US")).toBeNull();
    // And the resolver refuses them by name, not by silence.
    const mg = resolve("MG", "Breast");
    expect(mg?.status).toBe("no-match");
    const us = resolve("US", "Abdomen");
    expect(us?.status).toBe("no-match");
    if (mg?.status === "no-match") {
      expect(mg.reason).toMatch(/not in MR\/CT\/XR scope/i);
    }
  });

  it("no abnormal complete-case format is ever a bootstrap candidate (firewall re-pinned)", () => {
    const abnormal = FORMATS.filter((f) => !isNormalBootstrapCandidate(f));
    // The pathological complete cases exist in the library — that is why the
    // assertion check matters — and none of them may ever resolve as a normal.
    expect(abnormal.length).toBeGreaterThan(0);
    for (const f of abnormal) {
      const [modality, ...rest] = `${f.modality} ${f.bodyPart}`.split(" ");
      const decision = resolve(modality, rest.join(" "));
      if (decision?.status === "apply") {
        expect(
          decision.format.name,
          `an abnormal format (${f.name}) must never auto-apply`,
        ).not.toBe(f.name);
      }
    }
  });
});
