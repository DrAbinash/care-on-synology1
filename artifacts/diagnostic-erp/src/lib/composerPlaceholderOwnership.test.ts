/**
 * Ruling 3, item 5 — no unresolved placeholder and no silently-deleted token may
 * reach a signed report, across the four surfaces the owner named: Quick Select,
 * the Composer, voice dictation and templates.
 *
 * WHAT ALREADY COVERED THIS, measured before anything was written here:
 *  - `radiologyQuickSelectTokenOwnership.test.ts` (api-server) censuses every
 *    ACTIVE `radiology_quick_findings` row and fails if a `{token}` in its prose
 *    has no `questions_json` key or `properties` chip behind it. That is the
 *    declaration audit for the data-held catalogue.
 *  - `quickSelectParameterSafety.hardening.test.ts` (T1–T9) proves the shared
 *    boundary refuses an unresolved parameter instead of writing it, and refuses
 *    an out-of-band `{size}`-style token too — for the three sources it owns
 *    (`quick-select`, `macro`, `quick-findings`).
 *  - `quickSelectStructuredSubstitution.test.ts` /
 *    `quickSelectStripStructuredRouting.test.ts` prove the rendered text through
 *    the structured dialog and the strip's routing to it.
 *  - `signedReportContentGuard.ts` is the last door: any `{identifier}` still
 *    standing in the body classifies as `placeholder` and refuses the signature.
 *
 * THE HOLE THOSE DO NOT REACH is the catalogue that lives in code rather than in
 * the database. `buildComposerCatalog` appends `BUILTIN_SPINE_ENTRIES` and
 * `BUILTIN_FAZEKAS` when the DB rows do not already supply the concept, and
 * `renderComposerPhrase` feeds `fillStructuredTemplate`, which renders a key it
 * has no value for as NOTHING (structuredFindings.ts:84-87) — the deletion the
 * brief calls silent. No DB census can see those entries, so this file is the
 * declaration audit for them, plus the property that has to hold either way:
 * nothing the Composer renders carries a literal token into the report.
 *
 * No database, no browser: the composer model and the signing guard are both
 * pure, so every assertion below runs against the real shipped entries and the
 * real classifier.
 */
import { describe, expect, it } from "vitest";
import {
  buildComposerCatalog,
  emptyComposerDraft,
  renderComposerPhrase,
  type ComposerCatalogEntry,
  type FindingComposerDraft,
} from "./findingComposerModel";
import { isQuickSelectSource } from "./zai-workspace/quickSelectParameterContract";
import {
  classifySignedReportBody,
  findUnresolvedTemplateTokens,
  signedContentRefusal,
} from "../../../api-server/src/lib/signedReportContentGuard";

/** The identifier-in-braces grammar the door itself uses. */
const tokensIn = (text: string) => findUnresolvedTemplateTokens(text);

/**
 * The entries this catalogue ships in code, taken through the same builder the
 * workspace calls, with no DB rows behind them — the sparse-catalogue case the
 * builtins exist for.
 */
const builtinEntries = (): ComposerCatalogEntry[] => [
  ...buildComposerCatalog([], "MRI Cervical Spine"),
  ...buildComposerCatalog([], "MRI LS Spine"),
  ...buildComposerCatalog([], "MRI Brain"),
];

/** A draft that answers every parameter the entry can ask for. */
function answeredDraft(entry: ComposerCatalogEntry): FindingComposerDraft {
  const draft: FindingComposerDraft = { ...emptyComposerDraft("MRI Brain"), catalogKey: entry.key };
  for (const q of entry.questions) {
    const answer = q.default || q.options[0] || "L4-L5";
    if (q.key === "level") draft.level = answer;
    else if (q.key === "severity" || q.key === "grade") draft.severity = answer;
    else if (q.key === "laterality" || q.key === "side") draft.laterality = answer;
  }
  return draft;
}

const proseFields = (e: ComposerCatalogEntry) => [
  e.findingText, e.impressionText, e.techniqueText, e.recommendationText, e.anatomicalSection,
];

describe("the code-held composer catalogue declares a supplier for every token it prints", () => {
  const entries = builtinEntries();

  it("ships the entries the sparse-catalogue path falls back to", () => {
    // Guards the rest of this file: an empty list would make every assertion
    // below pass without looking at anything.
    expect(entries.length).toBeGreaterThan(3);
    expect(entries.map((e) => e.key)).toContain("builtin-disc-bulge");
    expect(entries.map((e) => e.key)).toContain("builtin-fazekas");
  });

  it("the census is not vacuous — these entries do carry template tokens", () => {
    const withTokens = entries.filter((e) => proseFields(e).some((t) => tokensIn(t).length > 0));
    expect(withTokens.length).toBeGreaterThan(1);
  });

  it.each(entries.map((e) => [e.key, e] as const))("%s: every token has a value the renderer supplies", (_key, entry) => {
    const rendered = renderComposerPhrase(answeredDraft(entry), entry);
    const asked = new Set(proseFields(entry).flatMap(tokensIn));
    for (const token of asked) {
      // Not in `values` ⇒ `fillStructuredTemplate` deletes it and the sentence
      // loses the question, so the report says something it never asked.
      expect(Object.prototype.hasOwnProperty.call(rendered.values, token)).toBe(true);
    }
  });

  it.each(entries.map((e) => [e.key, e] as const))("%s: an answered render carries no literal token", (_key, entry) => {
    const rendered = renderComposerPhrase(answeredDraft(entry), entry);
    for (const text of [rendered.findings, rendered.impression, rendered.technique, rendered.recommendation]) {
      expect(tokensIn(text)).toEqual([]);
    }
  });
});

describe("an unanswered parameter cannot smuggle a brace into the report", () => {
  const entries = builtinEntries();
  /** An entry whose prose goes through the structured substitution. */
  const structured = entries.find((e) => e.questions.length > 0 && e.findingText.includes("{"))!;

  it.each(entries.map((e) => [e.key, e] as const))("%s: an empty draft still renders no token", (_key, entry) => {
    // This pins the behaviour rather than praising it: a key the renderer knows
    // but the radiologist never answered comes out as nothing, which is
    // under-claiming, and it is why the Quick Select boundary refuses instead.
    // What must never happen either way is a literal brace reaching the page.
    const rendered = renderComposerPhrase({ ...emptyComposerDraft("MRI Brain"), catalogKey: entry.key }, entry);
    for (const text of [rendered.findings, rendered.impression, rendered.technique, rendered.recommendation]) {
      expect(tokensIn(text)).toEqual([]);
    }
  });

  it("the composer deletes an undeclared token whether or not questions exist", () => {
    // Measured, not assumed: `renderComposerPhrase` sends any finding text
    // containing a brace through `fillStructuredTemplate` — with questions (the
    // structured route) or without (the `entry.findingText.includes("{")`
    // branch) — so on THIS surface a token nothing supplies never survives to
    // become a literal brace. It becomes a smaller sentence instead, and the
    // signing door cannot object to a hole it cannot see:
    // "A disc bulge is present at L4-L5." is a complete, authored, fluent
    // paragraph that simply no longer says how big the bulge is, or that it was
    // ever asked. That is why the ownership loop above is the gate for this
    // producer, and why the door is only the backstop for the surfaces that do
    // no substitution at all (the editor and dictation, where a brace is the
    // radiologist's own character and is refused rather than removed).
    const draft = { ...emptyComposerDraft("MRI Brain"), catalogKey: "x" };
    const withQuestions = renderComposerPhrase(draft, { ...structured, findingText: "A {size} bulge at {level}.", impressionText: "{size} bulge." });
    const withoutQuestions = renderComposerPhrase(draft, { ...structured, questions: [], findingText: "A {size} bulge at {level}.", impressionText: "{size} bulge." });

    for (const rendered of [withQuestions, withoutQuestions]) {
      expect(Object.prototype.hasOwnProperty.call(rendered.values, "size")).toBe(false);
      expect(tokensIn(rendered.findings)).toEqual([]);
      expect(rendered.findings).not.toMatch(/size/);
    }
    // The hole is invisible downstream: with the size gone the body still reads
    // as authored content.
    expect(classifySignedReportBody(`<p>${withQuestions.findings}</p><p>${withQuestions.impression}</p>`).level).toBe("ok");
  });

  it("and where nothing substitutes, the door is what refuses the brace", () => {
    const classification = classifySignedReportBody("<p>There is a {size} disc bulge at L4-L5.</p>");
    expect(classification.level).toBe("placeholder");
    expect(String(signedContentRefusal(classification).error)).toContain("{size}");
  });
});

describe("voice and templates keep their own, already-pinned semantics", () => {
  it("dictated prose is never token-substituted, so it reaches the door as written", () => {
    // store.ts applies voice observations with source "radiologist-voice" and
    // passes the same text as both the incoming and the template value: nothing
    // rewrites it. A brace there is the radiologist's own text, which this
    // codebase deliberately does not block at write time (T7) — the refusal is
    // at signature, and it is real.
    expect(isQuickSelectSource("radiologist-voice")).toBe(false);
    expect(classifySignedReportBody("<p>Acute {side} MCA infarct, as dictated.</p>").level).toBe("placeholder");
  });

  it("the three Quick Select surfaces that do substitute are the guarded ones", () => {
    for (const source of ["quick-select", "macro", "quick-findings"]) expect(isQuickSelectSource(source)).toBe(true);
  });

  it("a template body whose authored text is complete signs with no token anywhere", () => {
    const entry = builtinEntries().find((e) => e.key === "builtin-disc-bulge")!;
    const rendered = renderComposerPhrase(answeredDraft(entry), entry);
    expect(classifySignedReportBody(`<p>${rendered.findings}</p><p>${rendered.impression}</p>`).level).toBe("ok");
  });
});
