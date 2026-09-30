/**
 * X-ray Chest VIEW / ADEQUACY model (spec §2, and the technique half of §17).
 *
 * Covers: projection recognition, AP-vs-PA cardiac gating, low-volume and
 * rotation limitations, lateral-only statements, unrecorded views, and the
 * round-trip between the canonical Technique sentences the canvas writes and
 * the context the gateways read.
 */
import { describe, expect, it } from "vitest";
import {
  assessCardiacSize,
  chestViewAllows,
  hasFrontalView,
  missingViewLabels,
  parseXrayChestViews,
  setAdequacyInTechnique,
  toggleViewInTechnique,
  unsupportedTechniqueStatements,
} from "./xrayChestViews";

const PA = "PA erect chest radiograph. Adequate inspiration. Apices and costophrenic angles are fully included.";
const AP_PORTABLE =
  "AP chest radiograph. Portable examination performed at the bedside. Low-volume film with crowding of bronchovascular markings. Patient rotation limits assessment of mediastinal width and hilar symmetry.";

describe("projection parsing", () => {
  it("recognises a PA erect film", () => {
    const ctx = parseXrayChestViews(PA);
    expect(ctx.performed.pa).toBe(true);
    expect(ctx.performed.ap).toBe(false);
    expect(ctx.performed.portableAp).toBe(false);
    expect(ctx.hasTechniqueSignal).toBe(true);
    expect(ctx.adequacy.inspiration).toBe("adequate");
    expect(ctx.adequacy.fieldInclusion).toBe("adequate");
  });

  it("recognises a portable AP film and its limitations", () => {
    const ctx = parseXrayChestViews(AP_PORTABLE);
    expect(ctx.performed.ap).toBe(true);
    expect(ctx.performed.pa).toBe(false);
    expect(ctx.performed.portableAp).toBe(true);
    expect(ctx.adequacy.inspiration).toBe("limited");
    expect(ctx.adequacy.rotation).toBe("limited");
  });

  it("separates AP supine from AP erect", () => {
    expect(parseXrayChestViews("AP supine chest radiograph.").performed.apSupine).toBe(true);
    expect(parseXrayChestViews("AP supine chest radiograph.").performed.apErect).toBe(false);
    expect(parseXrayChestViews("AP erect chest radiograph.").performed.apErect).toBe(true);
  });

  it("does not invent an AP projection from an erect lateral", () => {
    // "lateral view, erect" names a lateral only — no frontal AP is performed.
    const ctx = parseXrayChestViews("Erect lateral chest radiograph.");
    expect(ctx.performed.lateral).toBe(true);
    expect(ctx.performed.ap).toBe(false);
    expect(ctx.performed.apErect).toBe(false);
  });

  it("treats a lordotic projection as performed", () => {
    expect(parseXrayChestViews("Lordotic projection of the apices.").performed.lordotic).toBe(true);
  });

  it("records nothing when the technique is empty", () => {
    const ctx = parseXrayChestViews("");
    expect(ctx.hasTechniqueSignal).toBe(false);
    expect(hasFrontalView(ctx)).toBe(false);
    expect(ctx.adequacy.inspiration).toBe("unknown");
  });

  it("names the views a tile is missing", () => {
    const ctx = parseXrayChestViews("AP chest radiograph.");
    expect(chestViewAllows(ctx, "pa")).toBe(false);
    expect(missingViewLabels(ctx, ["pa", "lateral"])).toEqual(["PA", "lateral"]);
    expect(chestViewAllows(ctx, ["ap"])).toBe(true);
  });
});

describe("AP magnification is not PA (spec §2, §7, §11)", () => {
  it("allows cardiac size on a PA frontal film", () => {
    const r = assessCardiacSize(parseXrayChestViews(PA));
    expect(r.allowed).toBe(true);
    expect(r.caveat).toBeUndefined();
  });

  it("blocks an unassessable cardiac verdict on AP and states why", () => {
    const r = assessCardiacSize(parseXrayChestViews("AP chest radiograph."));
    expect(r.allowed).toBe(false);
    expect(r.caveat).toMatch(/AP projection/i);
    expect(r.caveat).toMatch(/magnif/i);
  });

  it("blocks cardiac size entirely when no frontal view was recorded", () => {
    const r = assessCardiacSize(parseXrayChestViews("Left lateral chest radiograph."));
    expect(r.allowed).toBe(false);
    expect(r.blocked).toMatch(/No frontal/i);
  });

  it("still allows cardiac size when PA and lateral are both performed", () => {
    const ctx = parseXrayChestViews("PA erect chest radiograph. Additional lateral projection obtained.");
    expect(assessCardiacSize(ctx).allowed).toBe(true);
    expect(ctx.performed.lateral).toBe(true);
  });
});

describe("technique-dependent statements (spec §17)", () => {
  it("flags a normal-heart-size claim on an AP film", () => {
    const ctx = parseXrayChestViews("AP chest radiograph.");
    const hits = unsupportedTechniqueStatements(
      ctx,
      "Cardiac size is normal. No cardiomegaly.",
    );
    expect(hits.some((h) => /cardiac-size|cardiomegaly/i.test(h))).toBe(true);
  });

  it("flags a lateral-only statement when no lateral was performed", () => {
    const ctx = parseXrayChestViews(PA);
    const hits = unsupportedTechniqueStatements(ctx, "Increased retrosternal clear space on the lateral view.");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatch(/lateral/i);
  });

  it("accepts the same lateral statement once the lateral is recorded", () => {
    const ctx = parseXrayChestViews(`${PA} Additional lateral projection obtained.`);
    expect(
      unsupportedTechniqueStatements(ctx, "Increased retrosternal clear space on the lateral view."),
    ).toEqual([]);
  });

  it("flags a clear-costophrenic-angle statement when the angles are not included", () => {
    const ctx = parseXrayChestViews(
      "PA erect chest radiograph. The apices and/or costophrenic angles are not fully included.",
    );
    const hits = unsupportedTechniqueStatements(ctx, "Costophrenic angles are clear.");
    expect(hits.some((h) => /costophrenic/i.test(h))).toBe(true);
  });

  it("flags a hyperinflation claim on a low-volume film", () => {
    const ctx = parseXrayChestViews(AP_PORTABLE);
    const hits = unsupportedTechniqueStatements(ctx, "Lungs are hyperinflated with flattened diaphragms.");
    expect(hits.some((h) => /lung-volume/i.test(h))).toBe(true);
  });

  it("flags a mediastinal-width claim on a rotated film", () => {
    const ctx = parseXrayChestViews(AP_PORTABLE);
    const hits = unsupportedTechniqueStatements(ctx, "Mediastinal width is normal.");
    expect(hits.some((h) => /rotation/i.test(h))).toBe(true);
  });

  it("does not police statements when the technique names nothing", () => {
    const ctx = parseXrayChestViews("Chest radiograph.");
    expect(ctx.hasTechniqueSignal).toBe(false);
    expect(unsupportedTechniqueStatements(ctx, "Costophrenic angles are clear.")).toEqual([]);
  });
});

describe("the canvas writes and reads back the same state", () => {
  it("records and un-records a projection without touching other prose", () => {
    const start = "PA erect chest radiograph.";
    const withLateral = toggleViewInTechnique(start, "lateral", true);
    expect(withLateral).toContain("Additional lateral projection obtained.");
    expect(parseXrayChestViews(withLateral).performed.lateral).toBe(true);

    const back = toggleViewInTechnique(withLateral, "lateral", false);
    expect(back).toBe(start);
    expect(parseXrayChestViews(back).performed.lateral).toBe(false);
  });

  it("preserves the radiologist's own technique sentence", () => {
    const manual = "Film obtained on a mobile unit after transfer from theatre.";
    const next = toggleViewInTechnique(manual, "ap", true);
    expect(next).toContain(manual);
    expect(next).toContain("AP chest radiograph.");
    expect(parseXrayChestViews(next).performed.ap).toBe(true);
  });

  it("cycles adequacy through adequate and limited", () => {
    const adequate = setAdequacyInTechnique("", "rotation", "adequate");
    expect(parseXrayChestViews(adequate).adequacy.rotation).toBe("adequate");
    const limited = setAdequacyInTechnique(adequate, "rotation", "limited");
    expect(parseXrayChestViews(limited).adequacy.rotation).toBe("limited");
    expect(limited).not.toContain("No significant rotation.");
    const cleared = setAdequacyInTechnique(limited, "rotation", "unknown");
    expect(parseXrayChestViews(cleared).adequacy.rotation).toBe("unknown");
  });

  it("never claims a view through the 'other' toggle", () => {
    // "other" has no canonical sentence: the radiologist must type the
    // projection, so the model cannot assert one it did not record.
    expect(toggleViewInTechnique("Chest radiograph.", "other", true)).toBe("Chest radiograph.");
    expect(parseXrayChestViews("Chest radiograph.").performed.other).toBe(false);
  });
});

/**
 * The centre already ships live X-Ray protocols (migrations/
 * zzzz_xr_gold_standard_content.sql → radiology_protocols.technique_text). The
 * view model must read the text those protocols already write, or every seeded
 * chest study would open with a gated canvas that believes it has no view.
 */
describe("live seeded protocol technique text", () => {
  const PA_TECH = "Erect PA view of the chest at full inspiration.";
  const AP_TECH = "AP view of the chest (supine / paediatric / limited-mobility technique).";
  const PORTABLE_TECH = "Supine AP portable chest radiograph performed at the bedside.";

  it("reads the seeded PA protocol as a PA frontal film at full inspiration", () => {
    const ctx = parseXrayChestViews(PA_TECH);
    expect(ctx.performed.pa).toBe(true);
    expect(ctx.performed.ap).toBe(false);
    expect(ctx.adequacy.inspiration).toBe("adequate");
    expect(assessCardiacSize(ctx).allowed).toBe(true);
    expect(hasFrontalView(ctx)).toBe(true);
  });

  it("reads the seeded AP and portable protocols as AP — never as PA", () => {
    for (const tech of [AP_TECH, PORTABLE_TECH]) {
      const ctx = parseXrayChestViews(tech);
      expect(ctx.performed.ap).toBe(true);
      expect(ctx.performed.pa).toBe(false);
      expect(assessCardiacSize(ctx).allowed).toBe(false);
      expect(assessCardiacSize(ctx).caveat).toContain("AP projection");
    }
    expect(parseXrayChestViews(PORTABLE_TECH).performed.portableAp).toBe(true);
    expect(parseXrayChestViews(AP_TECH).performed.portableAp).toBe(false);
  });

  it("does not treat the seeded AP wording as a technical limitation", () => {
    // "limited-mobility technique" is a patient note, not low inspiration.
    expect(parseXrayChestViews(AP_TECH).adequacy.inspiration).toBe("unknown");
  });
});

/**
 * Projection abbreviations are two letters, so they sit inside ordinary words.
 * A false "AP" would silently downgrade a PA film's cardiac assessment, so the
 * word-boundary contract is pinned here.
 */
describe("projection tokens are whole words only", () => {
  it("reads the spelled-out projections", () => {
    expect(parseXrayChestViews("Posteroanterior projection.").performed.pa).toBe(true);
    expect(parseXrayChestViews("Postero-anterior projection.").performed.ap).toBe(false);
    expect(parseXrayChestViews("Anteroposterior projection.").performed.ap).toBe(true);
    expect(parseXrayChestViews("Anteroposterior projection.").performed.pa).toBe(false);
  });

  it("ignores the letters inside other radiology words", () => {
    const ctx = parseXrayChestViews("Apices and costophrenic angles are fully included. Scapulae projected laterally.");
    expect(ctx.performed.ap).toBe(false);
    expect(ctx.performed.pa).toBe(false);
    expect(ctx.adequacy.fieldInclusion).toBe("adequate");
  });
});
