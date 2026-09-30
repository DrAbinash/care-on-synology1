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
import {
  XRAY_CHEST_SUB_MASTERS,
} from "@/lib/xrayChestSubMasters";
import { parseXrayChestViews } from "@/lib/xrayChestViews";
import { buildChestNormalAtoms } from "@/lib/xrayChestNormalAtoms";
import { buildCervicalNormalAtoms } from "@/lib/xrayCervicalNormalAtoms";
import {
  MRI_LUMBAR_SUB_MASTERS,
  buildLumbarTileBundle,
} from "@/lib/mriLumbarSubMasters";
import { MRI_BRAIN_SUB_MASTERS } from "@/lib/mriBrainSubMasters";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
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
    // Ratchet, not a tautology. #778 shipped 435 concepts / 321 impression-worthy;
    // MRI Dorsal V4 (#780) registered 16 more, 8 of them impression-worthy (321 -> 329);
    // Dorso-Lumbar adds one descriptive pack (intercostal nerve) that is not
    // impression-worthy, so 451 -> 452.
    // X-ray Lumbosacral V3 registers 102 radiography concepts (452 -> 554), 72 of
    // them impression-worthy (329 -> 401); its posterior-element baseline reuses
    // #778's canonical concept instead of adding a 103rd.
    // Bumping either number has to mean somebody deliberately registered a concept.
    const impressionWorthy = CLINICAL_CONTENT_PACKS.filter((p) => p.impressionworthyAbnormal === true);
    expect(CLINICAL_CONTENT_PACKS.length).toBe(554);
    expect(impressionWorthy.length).toBe(401);
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

  it("the auto-yield guard asks the role-aware question", () => {
    const store = src("../zai-workspace/store.ts");
    expect(store).toContain("isImpressionworthyAbnormal(observation.concept, { role: observation.role })");
  });

  it("the auto-return trigger keeps its concept-only reading, exactly as main", () => {
    // Deliberate, measured: MRI Lumbar's routine normal tiles emit baseline atoms
    // whose concepts (`canal_stenosis`, `conus_medullaris`, `bone_lesion`,
    // `disc_contour`, `compression_fracture`, `foraminal_stenosis`,
    // `cauda_equina`) are impression-worthy, and deselecting such a tile has
    // always brought the system normal back. The trigger below stays on the
    // concept-only reading so that shipped behaviour is untouched; what may
    // actually suppress the normal is still decided by the one rule.
    const store = src("../zai-workspace/store.ts");
    expect(store).toMatch(
      /isImpressionworthyAbnormal\(patch\.observation\?\.concept \?\? null\)\s*&& !get\(\)\.isFinalized/,
    );
    expect(store).not.toMatch(
      /isImpressionworthyAbnormal\(patch\.observation\?\.concept \?\? null, \{ role:/,
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

  it("a lamina defect stated with bare posterior-element wording behaves the same", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    applyPosteriorElements("pe-defect", "finding", {
      findings: "Lamina defect at T8.",
      impression: "Posterior element defect at T8.",
      concept: "lamina",
    });
    expect(
      useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "pe-defect")
        ?.observation?.concept,
    ).toBe("posterior_elements");
    expect(useWorkspace.getState().impressionText).toBe("Posterior element defect at T8.");
  });

  it("a spinous-process fracture keeps its own concept and stays impression-worthy", () => {
    useWorkspace.getState().seedSystemNormalImpression();
    applyPosteriorElements("pe-fracture", "finding", {
      findings: "Spinous process fracture at T8.",
      impression: "Spinous process fracture at T8.",
      concept: "spinous process fracture",
    });
    // The neighbouring dedicated concept must NOT be swallowed by the unioned
    // alias list; it suppresses the normal on its own account, as it did before.
    expect(
      useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "pe-fracture")
        ?.observation?.concept,
    ).toBe("posterior_element_fracture");
    expect(useWorkspace.getState().impressionText).toBe("Spinous process fracture at T8.");
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

// ─── 5. the role rule cannot reach any other shipped concept ─────────────

type AtomLike = { concept?: string; role?: string; impression?: string };

const lumbarCtx = {
  level: "L4-L5",
  numbering: defaultLumbarNumbering(),
  sequences: defaultSpineSequences(),
  region: "LS Spine",
  conusLevel: "L1",
};

function baselineAtoms(): Array<{ where: string; concept: string; hasImpression: boolean }> {
  const out: Array<{ where: string; concept: string; hasImpression: boolean }> = [];
  const catalogs = [
    ["cervical", XRAY_CERVICAL_SUB_MASTERS],
    ["chest", XRAY_CHEST_SUB_MASTERS],
    ["lumbar", MRI_LUMBAR_SUB_MASTERS],
    ["brain", MRI_BRAIN_SUB_MASTERS],
  ] as const;
  for (const [name, subs] of catalogs) {
    for (const sm of subs as readonly Array<{ id: string; tiles: Array<{ id: string; atoms: unknown }> }>) {
      for (const tile of sm.tiles) {
        const atoms = (
          typeof tile.atoms === "function"
            ? (tile.atoms as (c: unknown) => AtomLike[])(lumbarCtx)
            : (tile.atoms as AtomLike[])
        ) ?? [];
        for (const atom of atoms) {
          if (atom?.role === "baseline") {
            out.push({
              where: `${name}/${sm.id}/${tile.id}`,
              concept: atom.concept ?? "",
              hasImpression: Boolean(atom.impression && atom.impression.trim()),
            });
          }
        }
      }
    }
  }
  for (const o of buildCervicalNormalAtoms({ ctx: parseXrayCervicalViews("X-ray cervical AP and lateral.") }).observations) {
    if (o.role === "baseline") {
      out.push({
        where: "cervicalNormalAtoms",
        concept: o.concept ?? "",
        hasImpression: Boolean(o.incoming.impression && o.incoming.impression.trim()),
      });
    }
  }
  for (const o of buildChestNormalAtoms({ ctx: parseXrayChestViews("X-ray chest PA erect.") }).observations) {
    if (o.role === "baseline") {
      out.push({
        where: "chestNormalAtoms",
        concept: o.concept ?? "",
        hasImpression: Boolean(o.incoming.impression && o.incoming.impression.trim()),
      });
    }
  }
  return out;
}

describe("the role rule is inert for every concept shipped today", () => {
  it("no baseline atom that contributes an impression uses an impression-worthy concept", () => {
    // The auto-yield guard only fires for an incoming observation WITH impression
    // text, so a baseline atom can only be affected by the new role parameter if
    // it both contributes an impression and sits on an impression-worthy concept.
    // None does — measured over all four catalogs plus the materialised cervical
    // and chest normal atom sets. That is the enumeration behind the "0 composed
    // diffs for shipped concepts" claim.
    const withImpression = baselineAtoms().filter((a) => a.hasImpression);
    // Exactly one baseline atom dictates an impression line today, and its own
    // concept is registered as non-impression-worthy.
    expect(withImpression).toEqual([
      { where: "chest/routine/rt-clinic-normal-line", concept: "chest_normal_impression", hasImpression: true },
    ]);
    const offenders = withImpression.filter((a) => isImpressionworthyAbnormal(a.concept));
    expect(offenders).toEqual([]);
    expect(baselineAtoms().length).toBeGreaterThan(60);
  });

  it("keeps every shipped baseline atom on an impression-worthy concept working as before", () => {
    // Exactly the concepts that make the auto-return trigger above load-bearing:
    // they are registered impression-worthy, they are emitted as baseline, and
    // they behave as they did before this PR because the suppression decision is
    // taken by the ledger, which already excluded baseline role. MRI Lumbar's
    // routine normal palettes were here first; #777 added the MRA/MRV ones, and
    // this list is the proof that the pattern is established rather than new.
    const shared = [...new Set(
      baselineAtoms()
        .filter((a) => isImpressionworthyAbnormal(a.concept))
        .map((a) => a.concept),
    )].sort();
    expect(shared).toEqual([
      "bone_lesion",
      "canal_stenosis",
      "cauda_equina",
      "cervical_lordosis",
      "compression_fracture",
      "conus_medullaris",
      "disc_contour",
      "foraminal_stenosis",
      "mra_arterial",
      "mra_neck_arterial",
      "mrv_venous",
      "posterior_elements",
    ]);
    for (const concept of shared) {
      expect(isImpressionworthyAbnormal(concept, { role: "baseline" }), concept).toBe(false);
    }
  });

  it("deselecting an MRI Lumbar normal tile still restores the system normal", () => {
    // Pinned against current main: `rt-canal-normal` emits baseline atoms on the
    // impression-worthy concepts canal_stenosis + conus_medullaris, and removing
    // the last one has always re-seeded "Normal study.". Behaviour preserved,
    // with the reason recorded in the store comment.
    resetWorkspace("LS Spine", "MR", "MRI lumbar spine");
    const bundle = buildLumbarTileBundle("rt-canal-normal", lumbarCtx as never);
    expect(bundle.observations.length).toBeGreaterThan(0);
    useWorkspace.getState().applyMacroBundle(bundle);
    expect(useWorkspace.getState().impressionText).toBe("");
    for (const id of useWorkspace.getState().appliedPathologyPatches.map((p) => p.id)) {
      useWorkspace.getState().removeObservation(id);
    }
    expect(useWorkspace.getState().impressionText).toBe(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });
});
