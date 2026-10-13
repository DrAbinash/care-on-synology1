/**
 * PRIORITY 2 — a report must not acquire anatomy through the template it is given.
 *
 * The examination the clinic bills as "with Whole Spine Screening" genuinely documents
 * cervical, dorsal and lumbar coverage, and its normal report says so. That is correct
 * while the report still describes that examination. The moment the radiologist records a
 * move to one segment — ADR-004's transition, the same provenance #967 made authoritative
 * for Generate and PR #970 made visible on the paper — the report no longer documents the
 * screened segments, and a template that speaks for them must not be the one that opens.
 *
 * Nothing here edits a template and nothing rewrites its prose: the shipped screening rows
 * keep every sentence they were authored with, for the studies they were authored for. The
 * rule decides only WHICH format may be chosen, and it reads the recorded decision — never
 * findings text — to do it.
 *
 * Four examinations the product must keep apart:
 *   dedicated segment            → its own normal
 *   segment + documented screening (no recorded move) → the screening row, limitation phrase intact
 *   whole spine                  → the whole-spine screening normal
 *   narrowed by a recorded move  → nothing that documents a retired segment
 */
import { describe, expect, it } from "vitest";
import { coverageOfRegionLabel } from "@workspace/report-quality";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import {
  billedStudyContextForNormal,
  resolveNormalBootstrapFormat,
} from "@/lib/zai-workspace/normalBootstrap";
import { structuredTemplateToNormalFormat, type StructuredNormalRow } from "@/lib/zai-workspace/structuredNormalFormats";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { coverageOfRegion } from "@/lib/regionTransition";
import type { RegionTransitionRecord } from "@/lib/regionTransition";
import type { ReportFormat } from "@/lib/zai-workspace/types";

/**
 * The shipped Templates-screen preset, copied from
 * `artifacts/api-server/src/routes/structuredReportTemplates.ts` (row
 * "MRI Cervical Spine with Whole Spine Screening"). It is the examination the clinic
 * actually offers, and the one whose body speaks for the dorsal and lumbosacral spine.
 */
const CERVICAL_WITH_SCREENING_ROW: StructuredNormalRow = {
  id: 901,
  templateName: "MRI Cervical Spine with Whole Spine Screening",
  modality: "MRI",
  bodyPart: "SPINE_CERVICAL",
  studyType: "SCREENING_WHOLE_SPINE",
  sectionsJson: JSON.stringify({
    technique:
      "MRI Cervical Spine with whole spine screening: T1W and T2W sagittal of the cervical spine with axial T2W at the disc levels, together with sagittal T1W/T2W screening sequences of the dorsal and lumbosacral spine.",
    findingsItems: [
      { label: "C5-C6", normal: "Normal disc height and signal. No disc herniation. No cord compression." },
      { label: "Screening — Dorsal Spine", normal: "Normal alignment and vertebral marrow signal." },
      { label: "Screening — Lumbosacral Spine", normal: "Normal alignment and vertebral marrow signal." },
    ],
  }),
  defaultFindings:
    "Cervical lordosis is maintained. Disc heights and T2 signal are preserved at C2-C3 through C7-T1 with no herniation. Whole spine screening sagittals of the dorsal and lumbosacral spine show normal alignment, marrow signal and cord signal.",
  defaultImpression: "Normal MRI Cervical Spine. Whole spine screening is unremarkable.",
};

/** The same examination as the Templates screen edits it, in the workspace's own shape. */
const SCREENING_FORMAT: ReportFormat = structuredTemplateToNormalFormat(
  CERVICAL_WITH_SCREENING_ROW,
  "2026-10-13T00:00:00.000Z",
)!;

/** Library the workspace really holds: built-in baselines plus the on-screen row. */
const FORMATS = [...DEFAULT_REPORT_FORMATS, SCREENING_FORMAT];

function ctx(input: {
  region: string;
  regions?: string[];
  studyDescription: string;
  source?: ReportingStudyContext["source"];
}): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: input.studyDescription,
    regions: input.regions ?? [input.region],
    source: input.source ?? "billed",
    protocolName: null,
  });
}

/** A recorded move, shaped exactly like `care.region_transition.v1`. */
function moved(toRegion: string, fromRegion = "Whole Spine"): RegionTransitionRecord {
  return {
    kind: "care.region_transition.v1",
    fromRegion,
    toRegion,
    retired: [],
    keptAbnormalities: [],
    manualLinesPreserved: 0,
    decidedBy: "Dr Abinash Kumar",
    at: "2026-10-13T04:00:00.000Z",
  };
}

/** What the study documents, after the recorded decision — the ceiling under test. */
const ceilingOf = (records: RegionTransitionRecord[]) =>
  coverageOfRegion(records[records.length - 1]!.toRegion);

const chosen = (decision: ReturnType<typeof resolveNormalBootstrapFormat>) =>
  decision && decision.status === "apply" ? decision.format.name : `(${decision?.status})`;

/** Every anatomy a format's own sentences speak for, as the shipped rule states it. */
function documentedSegments(format: ReportFormat): Set<string> | null {
  const covered = coverageOfRegion(format.bodyPart);
  if (!covered) return null;
  const wholeSpine = /whole.?spine/i.test(`${(format.diagnosisTags ?? []).join(" ")} ${format.protocolScope ?? ""}`);
  return wholeSpine ? new Set(["cervical", "dorsal", "lumbar"]) : covered;
}
const documents = (format: ReportFormat) => {
  const s = documentedSegments(format);
  return s ? [...s].sort().join("+") : "no-spine-opinion";
};
/** True when the format speaks for anatomy the ceiling does not cover. */
const exceeds = (format: ReportFormat, ceiling: Set<string> | null) => {
  const s = documentedSegments(format);
  if (!s || !ceiling) return false;
  return [...s].some((x) => !ceiling.has(x));
};

describe("normal bootstrap — a recorded region move caps what a template may document", () => {
  it("N1 the shipped screening row DOES document the dorsal and lumbosacral spine", () => {
    // Not an assumption about the preset: the sentences are in its own findings.
    expect(SCREENING_FORMAT.findings).toMatch(/dorsal and lumbosacral/i);
    expect(documents(SCREENING_FORMAT)).toBe("cervical+dorsal+lumbar");
    // and the ceiling a cervical move sets cannot contain them
    expect([...ceilingOf([moved("Cervical Spine")])!]).toEqual(["cervical"]);
  });

  it("N2 a whole-spine booking narrowed to Cervical Spine must not open the screening row", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: billedStudyContextForNormal(
        ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
        "MRI Whole Spine Screening",
      ),
      formats: FORMATS,
      records: [moved("Cervical Spine")],
    });
    expect(chosen(decision)).not.toBe(SCREENING_FORMAT.name);
    if (decision?.status === "apply") {
      expect(documents(decision.format)).toBe("cervical");
    }
  });

  it("N3 with no recorded move the same booking keeps its screening row — nothing is retired", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: billedStudyContextForNormal(
        ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
        "MRI Cervical Spine with Whole Spine Screening",
      ),
      formats: FORMATS,
      records: [],
    });
    expect(chosen(decision)).toBe(SCREENING_FORMAT.name);
    // The clinic's screening discipline sentence belongs to that row and stays with it.
    expect(decision && decision.status === "apply" ? decision.format.technique : "").toMatch(/whole spine screening/i);
  });

  it("N4 a whole-spine study still reports as whole spine", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Whole Spine", studyDescription: "MRI WHOLE SPINE SCREENING" }),
      formats: FORMATS,
      records: [],
    });
    expect(decision?.status).toBe("apply");
    expect(decision && decision.status === "apply" ? decision.format.name : "").toContain("Whole Spine");
  });

  it("N5 an explicit widening back to the screened spine is never blocked", () => {
    // The radiologist moved it away and has now moved it back; the last record wins.
    const decision = resolveNormalBootstrapFormat({
      ctx: billedStudyContextForNormal(
        ctx({ region: "Whole Spine", studyDescription: "MRI WHOLE SPINE" }),
        "MRI Whole Spine Screening",
      ),
      formats: FORMATS,
      records: [moved("Cervical Spine"), moved("Whole Spine", "Cervical Spine")],
    });
    expect(decision?.status).toBe("apply");
    expect(decision && decision.status === "apply" ? documents(decision.format) : "").toBe("cervical+dorsal+lumbar");
  });

  it("N6 a two-segment ceiling admits both segments and refuses the third", () => {
    // The multi-select case: the record names two regions, so the report may
    // document those two — and the row that speaks for the dorsal spine still
    // documents one region this ceiling retired.
    expect([...coverageOfRegionLabel("Cervical Spine + LS Spine")!].sort()).toEqual(["cervical", "lumbar"]);
    const dedicated = FORMATS.filter((f) => f.name === "MRI Cervical Spine — Normal");
    expect(dedicated).toHaveLength(1);
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({
        region: "Cervical Spine",
        regions: ["Cervical Spine", "LS Spine"],
        studyDescription: "MRI CERVICAL SPINE AND LS SPINE",
      }),
      formats: [SCREENING_FORMAT, ...dedicated],
      records: [moved("Cervical Spine + LS Spine")],
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.name).toBe("MRI Cervical Spine — Normal");
      expect(exceeds(decision.format, coverageOfRegionLabel("Cervical Spine + LS Spine"))).toBe(false);
    }
  });

  it("N7 a regional limited-sequence screening normal survives a narrowing of its own segment", () => {
    // "MRI Cervical Spine — Screening" screens one region; it documents nothing else.
    const regional = FORMATS.find((f) => f.name === "MRI Cervical Spine — Screening")!;
    expect(documents(regional)).toBe("cervical");
    const decision = resolveNormalBootstrapFormat({
      ctx: billedStudyContextForNormal(
        ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
        "MRI Cervical Spine Screening",
      ),
      formats: FORMATS.filter((f) => f.name !== SCREENING_FORMAT.name),
      records: [moved("Cervical Spine")],
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      // Screening is still the right protocol for this study; only the extra
      // segments were retired. So a screening variant must win, and it must
      // document the cervical spine and nothing else.
      expect(decision.format.name.toLowerCase()).toContain("screening");
      expect(documents(decision.format)).toBe("cervical");
    }
  });

  it("N8 when only an over-wide format exists for the segment, say so instead of documenting a retired spine", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
      formats: [SCREENING_FORMAT],
      records: [moved("Cervical Spine")],
    });
    expect(decision?.status).toBe("no-match");
    expect(decision && decision.status === "no-match" ? decision.reason : "").toMatch(/recorded|region/i);
  });

  it("N9 a record CARE cannot read retires nothing — the study behaves exactly as it did", () => {
    const unreadable = { ...moved("Cervical Spine"), toRegion: "   " };
    const withBad = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
      formats: [SCREENING_FORMAT],
      // stale/malformed provenance must not silently re-scope the report
      records: [unreadable as unknown as RegionTransitionRecord],
    });
    const without = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
      formats: [SCREENING_FORMAT],
      records: [],
    });
    expect(chosen(withBad)).toBe(chosen(without));
  });

  it("N10a widening by an explicit region choice is never trapped behind the older record", () => {
    // Widening back out retires nothing, so it writes no new record. ADR-004 already
    // settles who wins that disagreement: choosing the region in the control is the
    // radiologist re-declaring the examination in front of CARE, and CARE's own reading
    // of the booking is what it defers to. The ceiling must not outlive that decision,
    // or the control the product points the radiologist at would refuse to work.
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({
        region: "Whole Spine",
        studyDescription: "MRI WHOLE SPINE SCREENING",
        source: "override",
      }),
      formats: FORMATS,
      records: [moved("Cervical Spine")],
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(documents(decision.format)).toBe("cervical+dorsal+lumbar");
    }
  });

  it("N10c an explicit narrowing also caps what the booked name would otherwise prefer", () => {
    // The state CASE C reaches in the real workspace: booked "MRI Whole Spine Screening",
    // the radiologist has just chosen Cervical Spine in the Region control. The resolver
    // folds the billed name into its reading — correctly, so a plain booking does not open
    // a contrast technique — and with an explicit choice answering "no opinion" that
    // marker won: the report was handed "MRI Cervical Spine with Whole Spine Screening"
    // and its sentence "Whole spine screening sagittals of the dorsal and lumbosacral
    // spine show normal alignment, marrow signal and cord signal" landed under a heading
    // the radiologist had themselves just narrowed. Declaring one region is not a
    // declaration of the examination the booking names.
    const narrowed: RegionTransitionRecord[][] = [[], [moved("Cervical Spine")]];
    for (const records of narrowed) {
      const decision = resolveNormalBootstrapFormat({
        ctx: billedStudyContextForNormal(
          ctx({ region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE", source: "override" }),
          "MRI Whole Spine Screening",
        ),
        formats: FORMATS,
        records,
      });
      expect(decision?.status).toBe("apply");
      if (decision?.status === "apply") {
        expect(documents(decision.format)).toBe("cervical");
        expect(decision.format.name).not.toMatch(/Whole Spine/i);
      }
    }
    // and the same explicit choice made at the whole spine still reaches the screening
    // document, because there the selection and the booking agree.
    const widened = resolveNormalBootstrapFormat({
      ctx: billedStudyContextForNormal(
        ctx({ region: "Whole Spine", studyDescription: "MRI WHOLE SPINE SCREENING", source: "override" }),
        "MRI Whole Spine Screening",
      ),
      formats: FORMATS,
      records: [],
    });
    expect(widened?.status).toBe("apply");
    if (widened?.status === "apply") {
      expect(documents(widened.format)).toBe("cervical+dorsal+lumbar");
    }
  });

  it("N10b a reloaded report still READ as the booked whole spine does not re-widen itself", () => {
    // The state the browser measured: the move to Cervical Spine is recorded and
    // hydrated from the draft, while the region control — React state, not saved — is
    // back on the booked "Whole Spine". Reading that as permission to document the whole
    // spine is what put eleven retired screening sentences back on the page on study open,
    // before anyone pressed anything. Only an explicit choice can widen it again (N10a).
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Whole Spine", studyDescription: "MRI WHOLE SPINE SCREENING" }),
      formats: FORMATS,
      records: [moved("Cervical Spine")],
    });
    // Every whole-spine normal documents the segments the record retired, so nothing may
    // be written automatically. This is the same disagreement #967 already refuses on
    // Generate, reached here by the mount-time bootstrap instead of by a press.
    expect(decision?.status).toBe("no-match");
    if (decision?.status === "no-match") {
      expect(decision.reason).toMatch(/outside the recorded move to Cervical Spine/);
    }
  });

  it("N11 a non-spine study is never given a spine opinion", () => {
    const decision = resolveNormalBootstrapFormat({
      ctx: ctx({ region: "Brain", studyDescription: "MRI BRAIN PLAIN" }),
      formats: FORMATS,
      records: [moved("Cervical Spine")],
    });
    expect(decision?.status).toBe("apply");
    expect(chosen(decision)).toBe("MRI Brain — Standard Normal");
  });

  it("N12 nothing here rewrites a template: the screening row keeps its own words", () => {
    // The rule only refuses to CHOOSE a format. Its prose is untouched, so a study that
    // legitimately screens the whole spine prints exactly what the clinic authored.
    const again = structuredTemplateToNormalFormat(CERVICAL_WITH_SCREENING_ROW, "2026-10-13T00:00:01.000Z")!;
    expect(again.findings).toBe(SCREENING_FORMAT.findings);
    expect(again.technique).toBe(SCREENING_FORMAT.technique);
    expect(again.impression).toBe(SCREENING_FORMAT.impression);
  });
});

/**
 * The unit rule above is only worth anything if the workspace's own action reaches it.
 * `generateProfessionalReport` is the one path both Start Report and Quick Normal go
 * through, so the ceiling is proved on the store — with the state captured and restored
 * wholesale rather than a hand-listed reset that silently misses a field.
 */
describe("the workspace's Generate path honours the ceiling", () => {
  const cervical = () =>
    buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI CERVICAL SPINE",
      regions: ["Cervical Spine"],
      source: "billed",
    });

  it("N13 a recorded move to Cervical Spine puts no screening sentence on the page", () => {
    const before = useWorkspace.getState();
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      patchUndoStack: [],
      confirmOverwriteOpen: false,
      mergePreviewOpen: false,
      pendingPathologyPatch: null,
      isFinalized: false,
      isDirty: false,
      regionTransitions: [moved("Cervical Spine")],
      reportingContext: cervical(),
      reportFormats: FORMATS,
    });
    try {
      // Exactly what the two buttons hand the store: the context the study resolves to,
      // with the booked examination name folded in the way `handleStartReport` and the
      // Quick Normal button both do. Without the fold this study never asks for a
      // screening normal, and the test would prove nothing.
      const ctxForAction = billedStudyContextForNormal(cervical(), "MRI Whole Spine Screening");
      const outcome = useWorkspace.getState().generateProfessionalReport(ctxForAction);
      expect(outcome.status).toBe("generated");
      const findings = useWorkspace.getState().findingsText;
      expect(findings).not.toMatch(/whole spine screening/i);
      expect(findings).not.toMatch(/dorsal and lumbosacral/i);
      expect(useWorkspace.getState().appliedFormatName).not.toBe(SCREENING_FORMAT.name);
    } finally {
      useWorkspace.setState(before);
    }
  });
});

/**
 * Every production caller must hand the resolver the record. A ceiling that only the
 * unit tests know about is a ceiling that a later refactor silently drops, so the three
 * sites are read out of the shipped source — bounded on the call itself, not on a
 * character budget that a longer comment would quietly empty.
 */
describe("all three callers of the resolver carry the recorded decision", () => {
  const read = (rel: string) => {
    const raw = require("node:fs").readFileSync(
      new URL(`../../${rel}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "utf8",
    ) as string;
    return raw.replace(/\r/g, "");
  };

  /** The literal text of one `resolveNormalBootstrapFormat({ … })` argument object. */
  const callSite = (src: string, needle: string) => {
    const start = src.indexOf(needle);
    expect(start, `no call site containing ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("});", start));
    expect(body.length).toBeGreaterThan(needle.length);
    return body;
  };

  const SITES: Array<[string, string]> = [
    ["src/lib/zai-workspace/store.ts", "const decision = resolveNormalBootstrapFormat({"],
    ["src/hooks/radiology-workspace/useWorkspaceClinicalUi.tsx", "const decision = resolveNormalBootstrapFormat({"],
    ["src/components/radiology/workspace/ReportCanvas.tsx", "const decision = resolveNormalBootstrapFormat({"],
  ];

  it.each(SITES)("N14 %s passes regionTransitions", (rel, needle) => {
    const body = callSite(read(rel), needle);
    expect(/records:\s*[^\n]*regionTransitions/.test(body)).toBe(true);
  });

  it("N15 the ceiling is asked once, in the resolver — not re-derived at each call site", () => {
    const resolver = read("src/lib/zai-workspace/normalBootstrap.ts");
    expect((resolver.match(/coverageExceeds\(/g) ?? []).length).toBe(1);
    expect((resolver.match(/formatDocumentedCoverage\(/g) ?? []).length).toBe(1);
    // and it reads the record, never the report's prose, to decide
    expect(resolver).not.toMatch(/findings\.match\([\s\S]{0,80}whole spine/i);
  });
});
