/**
 * The cervical spine's level and laterality contract, measured at the door a
 * radiologist actually clicks.
 *
 * Objective: no generic cervical box may silently insert a spinal level or a side.
 * Since the cervical conversion, 21 of the 39 shipped cervical findings boxes ask
 * for their level with `{level}` and 3 ask for their side with `{side}`, so the
 * level and the side are the radiologist's choice — carried by the Quick Select
 * bar's existing level chip and side control, not by a new control. What this file
 * pins is the three things that choice depends on:
 *
 *   1. the value he chose is what lands, at any level C2-C3 … C7-T1 and at any of
 *      right / left / bilateral;
 *   2. a click that answers nothing writes NOTHING — not the token, not the
 *      sentence with the token silently deleted by `fillTemplate`, not one section
 *      of a three-section tile — and says so;
 *   3. the report the refusal left behind is what the AI reasoner is shown, so an
 *      unanswered box cannot reach a prompt either.
 *
 * Two boxes are deliberately excluded from the rule and named in test 5 rather
 * than absorbed: `Cord compression C5-C6` owns a `baselineReplaces` pinned to that
 * level (the substitution path fills only the four report sections, never the
 * baseline contract, so parameterizing the prose would retire a C5-C6 normal for a
 * C4-C5 finding), and `Nerve root compression C6` says C6 because that is the
 * nerve root it describes, not a disc level it could be moved off.
 *
 * Every assertion reads the live store: the same `applyPathologyOverlay` the strip
 * calls, the same shipped baseline manifest it consults, and the same
 * `buildCopilotAiPrompt` that assembles the AI context. The second suite covers the
 * two doors that have NO chip to answer — Quick Add presets and Report Formats —
 * where the check is that the level is said out loud in the label or not asserted
 * at all. No AI model is called here — the claim is about what would be sent, and
 * nothing in this file should be read as a live-model test.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { useWorkspace } from "./store";
import { MRI_CERVICAL_STANDARD_NORMAL_MANIFEST } from "./fullReportBaseline";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { buildCopilotAiPrompt } from "@/lib/copilotAiModule";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { buildLivePrintBodyHtml } from "@/lib/radiologyReportPrintLiveMerge";
import { firstUnfilledPlaceholder, reportPlaceholderWarning } from "@workspace/report-quality";
import { STUDY_CONTEXTS } from "@/lib/radiologyQuickAddData";
import { BUILTIN_ABNORMAL_PATTERNS } from "@/lib/reporting/abnormalPatterns";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";

/** The six cervical disc levels the shipped baseline owns, in anatomical order. */
const CERVICAL_LEVELS = ["C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1"];
const SIDES = ["right", "left", "bilateral"] as const;

const CERVICAL_TILES = DEFAULT_QUICK_SELECT_TILES.filter(
  (t) => t.scopeBodyPart === "Cervical Spine" && t.field === "findings",
);

const toastMock = vi.mocked(toast);

const CERVICAL_BASELINE = (MRI_CERVICAL_STANDARD_NORMAL_MANIFEST.observations ?? []).filter(
  (o) => o.field === "findings",
);

function cervicalCtx() {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Cervical Spine",
    regions: ["Cervical Spine"],
    source: "auto",
  });
}

/** Open the study the way the workspace does: the shipped cervical scaffold on the page. */
function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: cervicalCtx(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    isFinalized: false, isDirty: false,
  });
  useWorkspace.getState().generateProfessionalReport(cervicalCtx());
  toastMock.mockClear();
}

const fields = () => {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
  };
};

/** One click, exactly as the strip dispatches it. */
function click(label: string, params: QuickSelectParameterValues) {
  const tile = CERVICAL_TILES.find((t) => t.label === label);
  expect(tile, `the catalogue no longer ships a cervical box labelled ${label}`).toBeDefined();
  const before = fields();
  const outcome = useWorkspace
    .getState()
    .applyPathologyOverlay(quickSelectTilePatch(tile!, "findings", params));
  return { tile: tile!, before, after: fields(), outcome };
}

/** The prompt the AI reasoner would be shown for the report as it now stands. */
function aiPrompt() {
  const s = useWorkspace.getState();
  return buildCopilotAiPrompt({
    modality: "MR",
    studyDescription: "MRI Cervical Spine",
    region: "Cervical Spine",
    clinicalHistory: s.clinicalHistoryText,
    findings: s.findingsText,
    impression: splitToSentences(s.impressionText),
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    selectedFindingLabels: [],
  });
}

/** Sentences this click added — the tile's own prose, with the scaffold's normals removed. */
function addedSentences(before: string, after: string): string[] {
  const had = new Set(splitToSentences(before).map((s) => s.trim()));
  return splitToSentences(after).map((s) => s.trim()).filter((s) => s && !had.has(s));
}

const cervicalTileAsking = (token: "level" | "side") =>
  CERVICAL_TILES.filter((t) =>
    new RegExp(`\\{${token}\\}`, "i").test(`${t.sentence} ${t.impressionSentence ?? ""}`),
  );

describe("the cervical level and laterality contract", () => {
  it("has the catalogue this contract is written about", () => {
    // A vacuous pass on an empty list is exactly how a deleted section reads as
    // green, so the census is stated as a number before anything is measured.
    expect(CERVICAL_TILES.length).toBe(39);
    expect(CERVICAL_BASELINE.length).toBeGreaterThanOrEqual(44);
    // 21 boxes ask for a level and 3 ask for a side — measured, not asserted from
    // the conversion notes. A box that quietly loses its {level} back to a literal
    // drops these numbers and fails here.
    expect(cervicalTileAsking("level").length).toBe(21);
    expect(cervicalTileAsking("side").length).toBe(3);
    // Every token a cervical box asks for has to have the chip that answers it —
    // the same rule `radiologyQuickSelectTokenOwnership.test.ts` enforces against
    // the database rows, checked here against the catalogue so a missing
    // `properties` declaration is a red test with no PostgreSQL required.
    for (const tile of CERVICAL_TILES) {
      const declared = (tile.properties ?? "").toLowerCase();
      for (const token of ["level", "side", "severity"]) {
        if (new RegExp(`\\{${token}\\}`, "i").test(`${tile.sentence} ${tile.impressionSentence ?? ""}`)) {
          expect(declared, `${tile.label} asks {${token}} but declares properties="${tile.properties}"`)
            .toContain(token);
        }
      }
    }
  });

  it("writes the level that was chosen, at every level the baseline owns", () => {
    for (const level of CERVICAL_LEVELS) {
      reset();
      const { before, after, outcome } = click("Disc herniation C5-C6", { level });
      expect(outcome, `${level} click was not applied`).toBe("applied");
      const written = addedSentences(before.findings, after.findings);
      expect(written, `${level}: the box wrote no finding`).toContain(
        `Central disc herniation at ${level}.`,
      );
      expect(after.impression).toContain(`Disc herniation at ${level}.`);
      // The level the radiologist picked is the ONLY level this box asserts.
      for (const sentence of written) {
        for (const other of CERVICAL_LEVELS) {
          if (other === level) continue;
          expect(sentence, `${level}: ${sentence} also names ${other}`).not.toContain(other);
        }
      }
    }
  });

  it("replaces exactly the chosen level's normal and leaves the other five standing", () => {
    for (const level of CERVICAL_LEVELS) {
      reset();
      const { outcome } = click("Disc herniation C5-C6", { level });
      expect(outcome).toBe("applied");
      const text = useWorkspace.getState().findingsText;
      expect(text, `${level}: its own disc normal must be withdrawn`).not.toContain(
        `${level}: No significant disc bulge or protrusion is seen.`,
      );
      for (const other of CERVICAL_LEVELS.filter((l) => l !== level)) {
        expect(text, `${level} must not silence ${other}`).toContain(
          `${other}: No significant disc bulge or protrusion is seen.`,
        );
      }
    }
  });

  it("right, left and bilateral each print the side that was chosen", () => {
    for (const side of SIDES) {
      reset();
      const { before, after, outcome } = click("Foraminal stenosis C5-C6", { side, level: "C5-C6" });
      expect(outcome, `${side} click was not applied`).toBe("applied");
      const written = addedSentences(before.findings, after.findings);
      const word = side[0].toUpperCase() + side.slice(1);
      expect(written, `${side}: expected a ${word} foraminal statement`).toContain(
        `${word} neural foraminal stenosis at C5-C6.`,
      );
      expect(after.impression).toContain(`${word} foraminal stenosis at C5-C6.`);
      // The claim is about one side, so the scaffold's patent-bilaterally line for
      // that level goes and the neighbouring levels keep theirs.
      expect(after.findings).not.toContain("C5-C6: Neural foramina are patent bilaterally.");
      expect(after.findings).toContain("C4-C5: Neural foramina are patent bilaterally.");
    }
  });

  it("only the two documented boxes still carry a level of their own", () => {
    // The census behind the whole change: a cervical box either asks for its level
    // or is named here. A new hard-coded "at C5-C6" in any other box — or one of
    // these two losing its reason — fails this test, not a report.
    const literalDiscLevel = CERVICAL_TILES.filter((t) =>
      /\bC\d-[CT]\d\b/.test(`${t.sentence} ${t.impressionSentence ?? ""}`),
    ).map((t) => t.label);
    expect(literalDiscLevel).toEqual(["Cord compression C5-C6"]);
    // The other exception is not a disc level at all, so it is invisible to the
    // census above and needs its own: exactly one box names a cervical nerve root,
    // and it is the one whose C6 is an anatomical designation.
    const literalRoot = CERVICAL_TILES
      .filter((t) => /\bC\d nerve root\b/i.test(`${t.sentence} ${t.impressionSentence ?? ""}`))
      .map((t) => t.label);
    expect(literalRoot).toEqual(["Nerve root compression C6"]);

    reset();
    const cord = click("Cord compression C5-C6", {});
    expect(cord.outcome).toBe("applied");
    expect(cord.after.findings).toContain(
      "Cervical cord compression at C5-C6 with effacement of the posterior subarachnoid space.",
    );
    // The exception earns its place by the baseline it retires: level-specific, and
    // only at the level its prose and its `baselineReplaces` agree on.
    expect(cord.after.findings).not.toContain("C5-C6: No spinal canal or thecal sac compression is seen.");
    for (const other of CERVICAL_LEVELS.filter((l) => l !== "C5-C6")) {
      expect(cord.after.findings, `C5-C6 cord compression silenced ${other}`).toContain(
        `${other}: No spinal canal or thecal sac compression is seen.`,
      );
    }

    // C6 here is the nerve root, not a disc level: the box asks for a side and keeps
    // its root designation at every side. The side word is mid-sentence, so it is
    // the lowercase substitution `fillTemplate` writes — only the sentence's own
    // first letter is capitalized.
    for (const side of SIDES) {
      reset();
      const { before, after, outcome } = click("Nerve root compression C6", { side });
      expect(outcome, `${side} root click was not applied`).toBe("applied");
      expect(addedSentences(before.findings, after.findings)).toContain(
        `The ${side} C6 nerve root shows compression by the disc-osteophyte complex.`,
      );
      expect(addedSentences(before.findings, after.findings).some((s) => /\bC\d-C\d\b/.test(s)),
        "a nerve root is not a disc level").toBe(false);
    }
  });

  it("keeps two levels of the same severity, because a slot is a level not a conflict group", () => {
    // The risk the conversion could have created: the shipped per-level boxes and the
    // parameterized trio share `conflictGroup: "canal_stenosis"`, so if the conflict
    // group owned replacement, picking C3-C4 after C5-C6 would have silently deleted
    // the first level's stenosis — one finding lost to a click. Measured the other
    // way: the ledger's slot key carries the level, so both statements stand.
    reset();
    expect(click("Mild canal stenosis C5-C6", { level: "C5-C6" }).outcome).toBe("applied");
    expect(click("Mild central canal stenosis (pick level)", { level: "C3-C4" }).outcome).toBe("applied");
    const text = useWorkspace.getState().findingsText;
    expect(text).toContain("Mild central canal stenosis at C5-C6.");
    expect(text).toContain("Mild central canal stenosis at C3-C4.");
    // …and the two levels' own canal normals are both withdrawn, no other level's is.
    expect(text).not.toContain("C5-C6: No spinal canal or thecal sac compression is seen.");
    expect(text).not.toContain("C3-C4: No spinal canal or thecal sac compression is seen.");
    expect(text).toContain("C4-C5: No spinal canal or thecal sac compression is seen.");
  });

  it("refuses a box whose level nobody chose, and changes nothing", () => {
    const offenders: string[] = [];
    const asked = cervicalTileAsking("level");
    for (const tile of asked) {
      reset();
      const before = fields();
      const beforePrompt = aiPrompt();
      const outcome = useWorkspace
        .getState()
        .applyPathologyOverlay(
          quickSelectTilePatch(tile, "findings", {
            // A box that asks for BOTH answers only its side: the level is still
            // unanswered, so the whole click must still refuse.
            side: /\{side\}/i.test(tile.sentence) ? "right" : "",
            level: "",
          }),
        );
      const after = fields();
      if (outcome !== "refused") offenders.push(`${tile.label}: outcome was "${outcome}"`);
      for (const section of ["findings", "impression", "recommendation", "technique"] as const) {
        if (after[section] !== before[section]) {
          offenders.push(`${tile.label}: ${section} changed on a refused click`);
        }
        if (/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(after[section])) {
          offenders.push(`${tile.label}: ${section} carries an unfilled token`);
        }
      }
      if (aiPrompt() !== beforePrompt) offenders.push(`${tile.label}: the AI prompt changed`);
      // "Prevents insertion with a clear message": the refusal has to name the
      // missing value, or the radiologist sees a box that did nothing.
      const shown = toastMock.mock.calls.at(-1)?.[0] as { title: string; description: string } | undefined;
      const words = shown ? `${shown.title} ${shown.description}` : "";
      if (!/nothing was applied/i.test(words)) offenders.push(`${tile.label}: no refusal shown`);
      if (!/level/i.test(words)) offenders.push(`${tile.label}: refusal did not name the level`);
      toastMock.mockClear();
    }
    expect(asked.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("refuses a box whose side nobody chose, level supplied or not", () => {
    const offenders: string[] = [];
    const asked = cervicalTileAsking("side");
    for (const tile of asked) {
      reset();
      const before = fields();
      const outcome = useWorkspace
        .getState()
        .applyPathologyOverlay(
          quickSelectTilePatch(tile, "findings", {
            side: "",
            level: /\{level\}/i.test(tile.sentence) ? "C5-C6" : "",
          }),
        );
      const after = fields();
      if (outcome !== "refused") offenders.push(`${tile.label}: outcome was "${outcome}"`);
      if (after.findings !== before.findings) offenders.push(`${tile.label}: Findings changed`);
      if (after.impression !== before.impression) offenders.push(`${tile.label}: Impression changed`);
      // The failure this replaces was subtler than a brace: `fillTemplate` deletes
      // an unfilled token with its chunk, so a side-less foraminal box printed a
      // fluent "Neural foraminal stenosis at C5-C6." that claimed no side at all.
      if (after.findings.includes("foraminal stenosis at C5-C6")) {
        offenders.push(`${tile.label}: wrote a side-less foraminal sentence`);
      }
      const shown = toastMock.mock.calls.at(-1)?.[0] as { title: string; description: string } | undefined;
      const words = shown ? `${shown.title} ${shown.description}` : "";
      if (!/nothing was applied/i.test(words) || !/side/i.test(words)) {
        offenders.push(`${tile.label}: refusal did not name the side`);
      }
    }
    expect(asked.length).toBe(3);
    expect(offenders).toEqual([]);
  });

  it("leaves no unresolved token anywhere the report or the AI can read", () => {
    // Both directions, over the whole parameterized family: an answered click must
    // put the chosen value in the prompt, and must not leave its token behind.
    const offenders: string[] = [];
    for (const tile of [...cervicalTileAsking("level"), ...cervicalTileAsking("side")]) {
      reset();
      const params: QuickSelectParameterValues = {
        side: /\{side\}/i.test(tile.sentence) ? "left" : "",
        level: /\{level\}/i.test(tile.sentence) ? "C6-C7" : "",
      };
      const outcome = useWorkspace
        .getState()
        .applyPathologyOverlay(quickSelectTilePatch(tile, "findings", params));
      expect(outcome, `${tile.label} was not applied`).toBe("applied");
      const prompt = aiPrompt();
      if (/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(prompt)) offenders.push(`${tile.label}: ${prompt.slice(0, 80)}`);
      if (params.level && !prompt.includes(params.level)) {
        offenders.push(`${tile.label}: the chosen level never reached the prompt`);
      }
      if (params.side && !/[Ll]eft/.test(prompt)) {
        offenders.push(`${tile.label}: the chosen side never reached the prompt`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The two doors that do NOT read the level chip.
 *
 * A Smart Format or an abnormality pattern writes whole sections chosen by the
 * label the radiologist reads, so its parameter is not the chip — it is the
 * label. The rule for them is therefore the other half of the objective: nothing
 * about the level may be silent. A cervical Report Format asserts abnormality
 * without naming a level it did not inherit from the operator (`C___-___`, the
 * same convention this library uses for `___ (side)` in its brain and lumbar
 * case formats), and a Quick Add preset that does state levels states every one
 * of them in the label before the shortcut can write it.
 */
const DISC_LEVEL = /\bC\d-[CT]\d\b/;

describe("the cervical doors that have no level chip", () => {
  it("gives no Report Format an abnormality at a level nobody chose", () => {
    const offenders: string[] = [];
    const cervical = DEFAULT_REPORT_FORMATS.filter((f) => /cervical/i.test(f.bodyPart ?? ""));
    for (const format of cervical) {
      const asserted = splitToSentences(`${format.findings ?? ""}\n${format.impression ?? ""}`)
        .filter((s) => DISC_LEVEL.test(s) && assertsAbnormality(s));
      for (const sentence of asserted) offenders.push(`${format.name}: ${sentence}`);
    }
    // The scan needs a non-empty population, or a deleted section reads as clean.
    expect(cervical.length).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
  });

  it("gives the cervical abnormality pattern no level of its own", () => {
    const patterns = BUILTIN_ABNORMAL_PATTERNS.filter((p) => p.region === "Cervical Spine");
    expect(patterns.map((p) => p.id)).toEqual(["cervical-spondylotic-myelopathy"]);
    const asserted = patterns
      .flatMap((p) => p.bundle)
      .flatMap((b) => splitToSentences(`${b.findingsText}\n${b.impressionText}`))
      .filter((s) => DISC_LEVEL.test(s));
    expect(asserted).toEqual([]);
  });

  it("states in the label every level a cervical Quick Add preset writes", () => {
    const offenders: string[] = [];
    let presets = 0;
    for (const context of STUDY_CONTEXTS.filter((c) => /cervical/i.test(c.id))) {
      for (const preset of context.smartFormats ?? []) {
        presets += 1;
        const stated = (text: string) =>
          [...new Set([...text.matchAll(new RegExp(DISC_LEVEL.source, "g"))].map((m) => m[0]))];
        const inProse = stated(`${preset.findings} ${preset.impression ?? ""}`);
        const inLabel = stated(preset.label);
        for (const level of inProse) {
          if (!inLabel.includes(level)) {
            offenders.push(`${context.id}/${preset.id}: writes ${level} but the label says "${preset.label}"`);
          }
        }
      }
    }
    expect(presets).toBeGreaterThanOrEqual(13);
    expect(offenders).toEqual([]);
  });

  it("warns about a level the operator has still not stated", () => {
    // `[level]` is not a private invention of this file: `unfilledPlaceholders`
    // (lib/report-quality/src/text/placeholders.ts) recognises the bracketed slot as
    // one of CARE's four shipped blank dialects — the same vocabulary the quality
    // badge (Q106) and `validateReport` read before a report can be signed. So a
    // cervical case format applied and left unfilled is DETECTED rather than silent,
    // which is the property that makes it safe to take a level out of a template.
    const formats = DEFAULT_REPORT_FORMATS.filter(
      (f) => /cervical/i.test(f.bodyPart ?? "") && (f.findings ?? "").includes("[level]"),
    );
    expect(formats.map((f) => f.name).sort()).toEqual([
      "MRI Cervical Spine — Cord Signal Change (Myelopathy)",
      "MRI Cervical Spine — Degenerative (Disc Bulge)",
    ]);
    for (const format of formats) {
      const warning = reportPlaceholderWarning({
        findings: format.findings,
        impression: format.impression,
        technique: format.technique,
        recommendation: format.recommendation,
      });
      expect(warning, `${format.name}: an unfilled level passed unremarked`).toMatch(
        /\[level\].*Findings/,
      );
    }
    // And the one pattern that carries a level slot is read the same way.
    const pattern = BUILTIN_ABNORMAL_PATTERNS.find((p) => p.id === "cervical-spondylotic-myelopathy")!;
    const hit = firstUnfilledPlaceholder(pattern.bundle[0].findingsText);
    expect(hit?.kind).toBe("bracket-slot");
    expect(hit?.raw).toBe("[level]");
  });

  it("prints the unfilled level as the words, not as emphasis markup", () => {
    // Measured, then fixed by this file: the print body honours `**bold** / __bold__`
    // in Findings (radiologyReportPrintLiveMerge.ts:84), so a `C___-___` blank printed
    // as `C_-_` with the clause between two blanks wrapped in <strong>, and `C__-__`
    // printed as plain `C-` — the blank vanished. `[level]` survives. This reads the
    // SHIPPED cervical prose, not a sample sentence, and compares each paragraph
    // against the same text with a real level substituted, so the control is the
    // differential rather than a hand-counted tag total.
    const renderFindings = (text: string) => buildLivePrintBodyHtml({
      clinicalHistory: "", technique: "MRI cervical spine on 3T.", rawFindings: text,
      findingsMap: {}, useStructured: false, impression: [], recommendation: "",
      headingCase: "all_caps", impressionStyle: "numbered",
    });
    const paragraphs = [
      ...DEFAULT_REPORT_FORMATS
        .filter((f) => /cervical/i.test(f.bodyPart ?? ""))
        .flatMap((f) => [f.findings ?? "", f.impression ?? ""]),
      ...BUILTIN_ABNORMAL_PATTERNS
        .filter((p) => p.region === "Cervical Spine")
        .flatMap((p) => p.bundle)
        .flatMap((b) => [b.findingsText, b.impressionText]),
    ].filter((text) => text.includes("[level]"));
    // A placeholder that is not markup is the whole point, so an underscore run in
    // any of this prose is a defect whether or not the census above happens to read it.
    expect(paragraphs.some((p) => /_{2,}/.test(p)), "a `__` run is bold markdown here").toBe(false);
    expect(paragraphs.length).toBeGreaterThanOrEqual(4);
    for (const paragraph of paragraphs) {
      const html = renderFindings(paragraph);
      const printed = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
      expect(printed, `the blank did not survive to the page: ${printed}`).toContain(paragraph);
      const filled = renderFindings(paragraph.split("[level]").join("C5-C6"));
      const tags = (s: string) => (s.match(/<(strong|em|b|i)\b/g) ?? []).length;
      expect(tags(html), `${paragraph.slice(0, 60)}… injected markup the filled form does not`)
        .toBe(tags(filled));
    }
  });
});
