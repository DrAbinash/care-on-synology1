/**
 * Impression-worthiness is a property of (concept, role), not of the concept id
 * alone.
 *
 * The content-pack flag describes the ABNORMAL reading of a concept. Several
 * shipped catalogs also use the same concept to emit a normal baseline sentence
 * (XR cervical "Visualized posterior elements are intact." is the case that
 * forced this), and a baseline statement must never suppress the system-owned
 * "Normal study." impression. Before this rule the registry could only answer
 * per concept id, so a concept shared by a normal baseline and an abnormal
 * finding had to be registered with the wrong answer for one of the two — and
 * the ledger kept a second, private copy of the exclusion.
 *
 * These tests pin THREE things:
 *   1. one authoritative implementation (the registry), every caller delegates;
 *   2. the unioned posterior_elements registration resolves identically for
 *      radiography and MR and is collision-free;
 *   3. shipped prose is byte-identical to the previous behaviour everywhere the
 *      role rule does not apply.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLINICAL_CONTENT_PACKS,
  contentPackForConcept,
  isImpressionworthyAbnormal,
} from "@/lib/conceptCanon/contentPacks";
import { resolveCanonicalConcept } from "@/lib/conceptCanon/conceptCanon";
import {
  SYSTEM_NORMAL_IMPRESSION_TEXT,
  SYSTEM_NORMAL_PATCH_ID,
} from "@/lib/conceptCanon/normalImpression";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  XRAY_CERVICAL_PRESETS,
  XRAY_CERVICAL_SUB_MASTERS,
  buildCervicalTilePatch,
} from "@/lib/xrayCervicalSubMasters";
import { parseXrayCervicalViews } from "@/lib/xrayCervicalViews";
import { useWorkspace } from "@/lib/zai-workspace/store";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(HERE, rel), "utf8");

/** Roles that answer with the pack flag. `baseline` is the discriminator. */
const ABNORMAL_ROLES = [undefined, null, "finding", "impression", "recommendation", "screening"] as const;

function resetWorkspace(region = "Cervical Spine", modality = "XR", description = "X-ray cervical spine") {
  useWorkspace.setState({
    studies: [],
    activeStudyId: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    canalApProvenance: {},
    coverageMarks: [],
    coverageByScope: {},
    reportingContext: buildReportingStudyContext({
      modality: modality as never,
      studyDescription: description,
      regions: [region],
      source: "auto",
    }),
  });
}

/** A posterior-elements statement as the ledger receives it, with a chosen role. */
function applyPosteriorElements(
  id: string,
  role: "baseline" | "finding",
  wording: { findings: string; impression: string; concept: string },
  level = "T8",
) {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: wording.findings, impression: wording.impression },
    templates: { findings: wording.findings, impression: wording.impression },
    ownership: { conflictGroup: "posterior_elements", concept: "posterior_elements", level },
    source: "structured-template",
    region: "Dorsal Spine",
    concept: wording.concept,
    role,
    level,
    findingsText: wording.findings,
    id,
  } as never);
}

// ─── 1. the rule itself ──────────────────────────────────────────────────

describe("isImpressionworthyAbnormal — the authoritative (concept, role) rule", () => {
  it("never treats a baseline observation as impression-worthy, for EVERY registered concept", () => {
    for (const pack of CLINICAL_CONTENT_PACKS) {
      expect(isImpressionworthyAbnormal(pack.concept, { role: "baseline" }), pack.concept).toBe(false);
    }
  });

  it("answers with the pack flag for every other role, for EVERY registered concept", () => {
    for (const pack of CLINICAL_CONTENT_PACKS) {
      const flag = pack.impressionworthyAbnormal === true;
      for (const role of ABNORMAL_ROLES) {
        expect(isImpressionworthyAbnormal(pack.concept, { role }), `${pack.concept} as ${String(role)}`).toBe(flag);
      }
      // The one-argument form is the concept-only reading and keeps its meaning.
      expect(isImpressionworthyAbnormal(pack.concept), pack.concept).toBe(flag);
    }
  });

  it("pins the impression-worthy set so a silent flag flip fails loudly", () => {
    // Ratchet, not a tautology: this number is measured against current main
    // plus `posterior_elements`, which is the ONLY flag this PR changes.
    const impressionWorthy = CLINICAL_CONTENT_PACKS.filter((p) => p.impressionworthyAbnormal === true);
    expect(impressionWorthy.length).toBe(228);
    const ids = new Set(impressionWorthy.map((p) => p.concept));
    for (const abnormal of [
      "posterior_elements",
      "cord_compression",
      "epidural_collection",
      "vertebral_collapse",
      "spondylodiscitis",
      "bone_lesion",
    ]) {
      expect(ids.has(abnormal), abnormal).toBe(true);
    }
    for (const normal of [
      "normal_study",
      "cervical_alignment",
      "vertebral_body_height",
      "cervical_disc_space",
      "facet_joint_normal",
      "prevertebral_soft_tissue",
      "disc_height",
    ]) {
      expect(ids.has(normal), normal).toBe(false);
    }
  });

  it("stays conservative for unknown and empty concepts, whatever the role", () => {
    for (const role of [...ABNORMAL_ROLES, "baseline" as const]) {
      expect(isImpressionworthyAbnormal("no-such-concept", { role })).toBe(false);
      expect(isImpressionworthyAbnormal(null, { role })).toBe(false);
      expect(isImpressionworthyAbnormal("", { role })).toBe(false);
      expect(isImpressionworthyAbnormal(undefined, { role })).toBe(false);
    }
  });
});

// ─── 2. one canonical posterior_elements concept ─────────────────────────

describe("posterior_elements — ONE canonical concept for radiography and MR", () => {
  const XR_ALIASES = ["posterior_elements", "posterior elements intact", "neural arches intact"];
  const DORSAL_ALIASES = [
    "posterior elements",
    "pedicle",
    "pedicles",
    "pedicle destruction",
    "lamina",
    "laminae",
    "spinous process",
    "winking owl sign",
  ];

  it("is declared exactly once", () => {
    const declarations = CLINICAL_CONTENT_PACKS.filter((p) => p.concept === "posterior_elements");
    expect(declarations.length).toBe(1);
  });

  it("resolves from BOTH modalities' wording to the same canonical id", () => {
    for (const alias of [...XR_ALIASES, ...DORSAL_ALIASES]) {
      expect(resolveCanonicalConcept(alias), alias).toBe("posterior_elements");
    }
    // One pack serves both: the same registration answers for the XR wording and
    // the MR wording, which is why the flag cannot be modality-specific.
    const pack = contentPackForConcept("posterior_elements");
    expect(pack?.modalities).toEqual(expect.arrayContaining(["XR", "MR", "CT"]));
    expect(pack?.regions).toEqual(expect.arrayContaining(["cervical spine", "dorsal spine"]));
    expect(pack?.impressionworthyAbnormal).toBe(true);
  });

  it("introduces no alias collision: no other pack claims any of its aliases", () => {
    const key = (s: string) => s.trim().toLowerCase().replace(/_/g, " ");
    for (const alias of [...XR_ALIASES, ...DORSAL_ALIASES]) {
      const owners = CLINICAL_CONTENT_PACKS.filter(
        (p) => p.concept !== "posterior_elements" && p.aliases.some((a) => key(a) === key(alias)),
      );
      expect(owners.map((p) => p.concept), alias).toEqual([]);
    }
  });

  it("keeps neighbouring posterior-element concepts distinct", () => {
    // A fracture of a posterior element is its own concept; widening the
    // posterior_elements alias list must not absorb it.
    expect(resolveCanonicalConcept("spinous process fracture")).toBe("posterior_element_fracture");
    expect(resolveCanonicalConcept("lamina fracture")).toBe("posterior_element_fracture");
    // Hardware wording stays hardware.
    expect(resolveCanonicalConcept("pedicle screw")).toBe("hardware_postop");
    expect(resolveCanonicalConcept("posterior instrumented fusion")).not.toBe("posterior_elements");
  });
});

// ─── 3. one implementation, callers delegate ─────────────────────────────

describe("one impression-worthiness implementation", () => {
  it("the ledger does not keep its own copy of the baseline exclusion", () => {
    const ledger = src("/normalImpression.ts");
    expect(ledger).not.toMatch(/role\s*===\s*"baseline"/);
    expect(ledger).toMatch(/isImpressionworthyAbnormal\(\s*p\.observation\?\.concept \?\? null,\s*\{\s*role: p\.observation\?\.role,/);
  });

  it("both store guards pass the observation role to the registry", () => {
    const store = src("../zai-workspace/store.ts");
    expect(store).toContain("isImpressionworthyAbnormal(observation.concept, { role: observation.role })");
    expect(store).toContain(
      "isImpressionworthyAbnormal(patch.observation?.concept ?? null, { role: patch.observation?.role })",
    );
  });
});

// ─── 4. behaviour through the real ledger ────────────────────────────────

describe("system normal impression — baseline vs finding", () => {
  beforeEach(() => resetWorkspace());

  it("leaves the XR cervical normal baseline prose exactly as it was", () => {
    // Composed output is byte-identical to the release this PR builds on: the
    // flag flip on posterior_elements must not reach the page.
    resetWorkspace();
    const ctx = parseXrayCervicalViews("X-ray cervical spine AP and lateral. Visualized down to C7-T1.");
    const preset = XRAY_CERVICAL_PRESETS.find((p) => p.id === "normal-cervical");
    expect(preset).toBeTruthy();
    useWorkspace.getState().applyMacroBundle(preset!.build({ region: "Cervical Spine", ctx }));
    expect(useWorkspace.getState().findingsText).toBe(
      [
        "Cervical alignment and lordosis are maintained.",
        "Vertebral body heights are preserved.",
        "No acute fracture or listhesis is identified.",
        "Visualized posterior elements are intact.",
        "Prevertebral soft tissues are not widened.",
        "Disc spaces are preserved where visualized.",
        "The inferior visualization limit is not recorded, so C7-T1 cannot be certified on this study.",
        "Odontoid and C1-C2 alignment are unremarkable when adequately visualized.",
        "No anterior or posterior cervical instrumentation is seen.",
      ].join("\n"),
    );
    // Baseline atoms contribute no impression line of their own, and they must
    // not remove the system normal either.
    expect(useWorkspace.getState().impressionText).toBe("");
    useWorkspace.getState().seedSystemNormalImpression();
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("a baseline-role posterior_elements statement does not suppress the system normal", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    applyPosteriorElements("pe-baseline", "baseline", {
      findings: "Posterior elements intact.",
      impression: "Posterior elements intact.",
      concept: "posterior elements intact",
    });
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
    expect(
      useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === SYSTEM_NORMAL_PATCH_ID)
        ?.lastRendered.impression,
    ).toBe(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("the same concept as a FINDING does suppress it, and removing it brings it back", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    applyPosteriorElements("pe-finding", "finding", {
      findings: "Winking owl sign at T8.",
      impression: "Winking owl sign at T8.",
      concept: "winking owl sign",
    });
    expect(useWorkspace.getState().impressionText).toBe("Winking owl sign at T8.");
    expect(
      useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === SYSTEM_NORMAL_PATCH_ID)
        ?.lastRendered.impression,
    ).toBe("");
    expect(useWorkspace.getState().removeObservation("pe-finding")).toBe("removed");
    expect(useWorkspace.getState().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("pedicle destruction resolves to the shared concept and behaves as an abnormal", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    applyPosteriorElements("pe-pedicle", "finding", {
      findings: "Pedicle destruction at T8.",
      impression: "Pedicle destruction at T8.",
      concept: "pedicle destruction",
    });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(
      patches.find((p) => p.id === "pe-pedicle")?.observation?.concept,
    ).toBe("posterior_elements");
    expect(useWorkspace.getState().impressionText).toBe("Pedicle destruction at T8.");
  });

  it("keeps every shipped cervical normal tile from suppressing the system normal", () => {
    // Every baseline atom in the cervical catalog is re-checked against the
    // registry rule, including the tiles that share a concept with an abnormal
    // reading.
    const ctx = parseXrayCervicalViews("X-ray cervical spine AP and lateral. Visualized down to C7-T1.");
    for (const subMaster of XRAY_CERVICAL_SUB_MASTERS) {
      for (const tile of subMaster.tiles) {
        const bundle = buildCervicalTilePatch(tile, "Cervical Spine", { level: "C5-C6", laterality: "right" });
        for (const obs of bundle.observations) {
          if ((obs as never as { role?: string }).role !== "baseline") continue;
          expect(
            isImpressionworthyAbnormal((obs as never as { concept?: string }).concept ?? null, { role: "baseline" }),
            `${subMaster.id}/${tile.id}`,
          ).toBe(false);
        }
      }
    }
    expect(ctx.performed.lateral).toBe(true);
  });
});
