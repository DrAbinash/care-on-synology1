/**
 * Quick Select structured substitution — the RENDERED text, not the declaration.
 *
 * The audit brief's Task A demanded that NO unresolved `{parameter}` reach
 * Findings / Impression / Recommendation, for any parameter name. The original
 * whole-catalogue "zero leaks" test (radiologyQuickSelectTokenOwnership.test.ts)
 * checked that every `{token}` in a box's prose was *declared* in that box's
 * `questions_json`. That is the necessary precondition, but it is not the
 * guarantee: a declared parameter is only a RESOLVED parameter once the surface
 * that writes the report actually substitutes it. The canvas Quick Select strip
 * does not run the structured renderer — `pick()` used to hand the raw template
 * straight to `onToggle`, and the store's substitution resolves only
 * `{side}`/`{severity}` — so a `{size}` that the dialog would have answered was
 * written verbatim. That is the difference between the browser finding
 * (literal `{size}` in a report) and the declaration test (which passed).
 *
 * This file closes that gap where it can be honestly proven: it runs the REAL
 * structured-dialog renderer (`fillStructuredTemplate`, the exact function
 * `generateStructuredFinding` → `applyStructuredDialog` uses on confirm) over the
 * REAL shipped catalogue (the 136 `radiology_quick_findings` rows that carry a
 * template placeholder, materialised as `TOKEN_CARRYING_QUICK_SELECT_BOXES` from
 * the migration-built database — the frontend package cannot reach
 * `@workspace/db`, and no api-server test may statically import a source module
 * from this package, so the catalogue is the fixture). The assertion is about
 * rendered text: after answering every declared question, no `{token}` survives
 * AND each answer appears in the sentence.
 *
 * Requirement 14, met: "rendered text contains substituted values, not merely
 * that questions_json declares the parameter."
 */
import { describe, expect, it } from "vitest";
import { fillStructuredTemplate, parseQuestions } from "@/lib/structuredFindings";
import { TOKEN_CARRYING_QUICK_SELECT_BOXES } from "./quickSelectTokenBoxes.fixture";

/** A `{token}` is unresolved if an identifier is still inside one pair of
 *  braces. This is the same grammar the store backstop and the sign-time guard
 *  use, restated locally so the test does not import the `@/hooks/use-toast`-
 *  coupled contract module for a pure string check. */
const ANY_TOKEN = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const tokensIn = (s: string): string[] => Array.from(s.matchAll(ANY_TOKEN)).map((m) => m[0]);

/** A distinctive, non-nullish answer per declared key. Chosen so grammar
 *  cleanup (capitalisation, whitespace/`punctuation` tidy) cannot corrupt it and
 *  so `fillStructuredTemplate`'s nullish set ("normal"/"none"/"") never applies. */
const sentinel = (key: string) => `AVAL${key.replace(/[^A-Za-z0-9]/g, "")}Z`;

function answered(questionsJson: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of parseQuestions(questionsJson)) out[q.key] = sentinel(q.key);
  return out;
}

const SECTIONS = ["findingText", "impressionText", "techniqueText", "recommendationText"] as const;

describe("Quick Select structured substitution over the whole shipped catalogue", () => {
  // Positive control first: an empty fixture would make every assertion below
  // vacuously true (the exact failure mode the audit ratchet warns about).
  it("the fixture carries the audited population", () => {
    expect(TOKEN_CARRYING_QUICK_SELECT_BOXES.length).toBeGreaterThan(100);
    const distinctTypes = new Set(TOKEN_CARRYING_QUICK_SELECT_BOXES.map((b) => b.studyType));
    expect(distinctTypes.size).toBeGreaterThan(20);
    // And these are boxes the dialog must resolve: at least one declared question.
    const structured = TOKEN_CARRYING_QUICK_SELECT_BOXES.filter(
      (b) => parseQuestions(b.questionsJson).length > 0,
    );
    expect(structured.length).toBeGreaterThan(0);
  });

  it("every structured box renders brace-free once its questions are answered", () => {
    const failures: string[] = [];
    for (const box of TOKEN_CARRYING_QUICK_SELECT_BOXES) {
      const questions = parseQuestions(box.questionsJson);
      if (questions.length === 0) continue; // not the dialog's to resolve
      const values = answered(box.questionsJson);
      for (const field of SECTIONS) {
        const raw = (box[field] ?? "").trim();
        if (!raw) continue;
        const rendered = fillStructuredTemplate(raw, values);
        for (const leftover of tokensIn(rendered)) {
          failures.push(`${box.studyType}/${box.label} [${field}] still shows ${leftover}`);
        }
      }
    }
    expect(failures, failures.slice(0, 15).join("\n")).toEqual([]);
  });

  it("each answered value actually lands in the rendered sentence (not just a deleted brace)", () => {
    // The stronger half of requirement 14: `fillStructuredTemplate` deletes an
    // unfilled token silently, so "no brace" alone could hide a dropped fact.
    // Filling every key and asserting the value is PRESENT proves substitution,
    // not deletion.
    const missing: string[] = [];
    let checkedKeys = 0;
    for (const box of TOKEN_CARRYING_QUICK_SELECT_BOXES) {
      const questions = parseQuestions(box.questionsJson);
      if (questions.length === 0) continue;
      const values = answered(box.questionsJson);
      for (const q of questions) {
        // Only assert for keys that appear as a `{key}` in at least one section.
        const appearsSomewhere = SECTIONS.some((f) => (box[f] ?? "").includes(`{${q.key}}`));
        if (!appearsSomewhere) continue;
        checkedKeys += 1;
        const renderedAll = SECTIONS.map((f) => fillStructuredTemplate(box[f] ?? "", values)).join(" ");
        if (!renderedAll.includes(values[q.key])) {
          missing.push(`${box.studyType}/${box.label}: {${q.key}} did not substitute to ${values[q.key]}`);
        }
      }
    }
    expect(checkedKeys, "expected catalogue boxes carrying declared tokens to substitute").toBeGreaterThan(50);
    expect(missing, missing.slice(0, 15).join("\n")).toEqual([]);
  });

  it("the named out-of-band tokens ({size}/{location}/{volume}/{swelling}/{grade}/{vessel}) are answered, never printed", () => {
    const oob = ["size", "location", "volume", "swelling", "grade", "vessel"];
    const offenders: string[] = [];
    for (const box of TOKEN_CARRYING_QUICK_SELECT_BOXES) {
      const raw = SECTIONS.map((f) => box[f] ?? "").join(" ");
      if (!oob.some((t) => raw.includes(`{${t}}`))) continue;
      const questions = parseQuestions(box.questionsJson);
      // Such a box MUST be structured (the strip only routes structured boxes to
      // the dialog), and every out-of-band token it carries MUST be a question.
      expect(questions.length, `${box.studyType}/${box.label} carries an out-of-band token but has no questions`).toBeGreaterThan(0);
      const declared = new Set(questions.map((q) => q.key));
      const values = answered(box.questionsJson);
      for (const f of SECTIONS) {
        const rendered = fillStructuredTemplate(box[f] ?? "", values);
        for (const t of oob) {
          if (rendered.includes(`{${t}}`)) offenders.push(`${box.studyType}/${box.label}: {${t}} printed in ${f}`);
          // If it was declared it must have substituted (present, brace gone).
          if ((box[f] ?? "").includes(`{${t}}`) && declared.has(t) && !rendered.includes(values[t])) {
            offenders.push(`${box.studyType}/${box.label}: {${t}} declared but value absent from ${f}`);
          }
        }
      }
    }
    expect(offenders, offenders.slice(0, 15).join("\n")).toEqual([]);
  });

  it("the raw (un-routed) template DOES carry the brace — proof the strip leak was real", () => {
    // Guards against a fixture whose prose was pre-substituted: if no raw box
    // still has a brace, this test proves nothing. At least one shipped box must
    // carry a literal `{token}` until the dialog answers it.
    const rawLeaks = TOKEN_CARRYING_QUICK_SELECT_BOXES.filter(
      (b) => SECTIONS.some((f) => tokensIn(b[f] ?? "").length > 0),
    );
    expect(rawLeaks.length).toBeGreaterThan(100);
  });
});
