/**
 * No Quick Select surface may answer a laterality on the radiologist's behalf.
 *
 * Three doors write a sided Quick Select sentence into the report — the Clinic
 * Quick Select panel, the voice path, and the structured-details dialog — and each
 * of them used to supply an answer the radiologist never gave:
 *
 *  - the panel's global side row opened on "left"
 *    (`useState<Side>("left")`). Measured in the browser on a fresh synthetic
 *    study: the row rendered `aria-pressed=true` on Left before anything was
 *    touched, and a click on tile #397 "Renal calculus" (`properties:"side"`, no
 *    dialog questions → the plain-toggle branch at useReportingStudySetup.ts:649)
 *    therefore wrote "Echogenic renal calculus in the LEFT kidney…"
 *  - the renal/CT-KUB dialog boxes ship
 *    `{"key":"side","default":"right","required":true}` in `questions_json`, and
 *    `initialValues` read that default into the form, so the dialog's own
 *    "Required: Side" gate could never fire: open #79, type a size, press Enter,
 *    and the report says right.
 *  - `sessionMemoryRef` was not cleared when the study changed, while every other
 *    per-study guard was, so patient A's side and size opened patient B's dialog
 *    (the workspace is not remounted between studies — the route swaps `studyId`).
 *
 * The behavioural half below runs the real `initialValues`/`missingRequired` pair
 * against the real shipped question JSON. The wiring half is a source pin in this
 * repo's documented no-DOM-harness idiom: what is being protected is which value
 * a `useState` starts at and which predicate an effect returns on, and there is no
 * DOM here to render it. The browser measurement that established each defect is
 * in the commit message; the refusal itself is enforced at the shared boundary by
 * `quickSelectParameterContract`, which has its own tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initialValues, missingRequired, parseQuestions } from "@/lib/structuredFindings";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const clinicalUi = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const studySetup = read("../hooks/useReportingStudySetup.ts");

/** The renal-calculus questions exactly as `zzz_add_usg_gold_standard_content.sql`
 *  seeds them into `radiology_quick_findings.questions_json` (box #79, KUB). */
const SHIPPED_RENAL_CALCULUS_QUESTIONS = JSON.stringify([
  { key: "side", label: "Side", type: "select", options: ["right", "left", "bilateral"], default: "right", required: true, sortOrder: 1 },
  { key: "size", label: "Size (mm)", type: "text", default: "", sortOrder: 2 },
]);

describe("the structured dialog does not pre-answer a required side", () => {
  const qs = parseQuestions(SHIPPED_RENAL_CALCULUS_QUESTIONS);

  it("opens the shipped renal calculus box with no side", () => {
    const values = initialValues(qs, {});
    expect(values.side).toBe("");
    expect(missingRequired(qs, values)).toEqual(["Side"]);
  });

  it("writes no side into the sentence the box is about to print", () => {
    // The authored default is the only thing that used to put a kidney side here.
    expect(SHIPPED_RENAL_CALCULUS_QUESTIONS).toContain('"default":"right"');
    expect(Object.values(initialValues(qs, {})).join(" ")).not.toMatch(/right/i);
  });

  it("keeps the answer the radiologist gave for THIS study", () => {
    const values = initialValues(qs, { side: "left" });
    expect(values.side).toBe("left");
    expect(missingRequired(qs, values)).toEqual([]);
  });
});

describe("the panel and voice inherit no side", () => {
  it("the global side row has no initial value", () => {
    expect(clinicalUi).toMatch(/const \[quickSide, setQuickSide\] = useState<Side \| "">\(""\)/);
    // The old default, and any re-typed variant of it, is the defect.
    expect(clinicalUi).not.toMatch(/useState<Side>\("left"\)/);
    expect(clinicalUi).not.toMatch(/useState<Side>\(/);
  });

  it("one writer still resolves the side, so no surface grows its own default", () => {
    // The refusal lives at the shared boundary; the hook's job is to stop
    // supplying the guess that boundary exists to reject.
    expect(clinicalUi).toMatch(/const chosen = params \?\? \{ side: quickSide \}/);
  });

  it("an unanswered row never re-lateralises, because it would stamp a blank side", () => {
    // relateralizePatches writes `laterality: side` onto every patch it touches,
    // so running it with "" would leave the ledger disagreeing with the page.
    expect(clinicalUi).toMatch(/if \(!quickSide\) return;/);
    expect(clinicalUi).toMatch(/relateralizePatches\(quickSide\)/);
  });

  it("the panel says so when nothing is chosen", () => {
    const panel = read("../components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toMatch(/side: Side \| ""/);
    expect(panel).toMatch(/data-side=\{side \|\| "unanswered"\}/);
    expect(panel).toMatch(/data-testid="quick-side-unanswered"/);
  });
});

describe("per-study guards clear the dialog's memory too", () => {
  it("the study-change reset lists sessionMemoryRef with the others", () => {
    expect(studySetup).toMatch(/sessionMemoryRef\.current = \{\}/);
    // Same effect, one list: a reset that clears the per-box values but not the
    // session memory is how patient A's side reached patient B's dialog. Anchored
    // on the effect's own comment and terminator, then asserted inside it — a lazy
    // `useEffect(…)[studyId]` regex pairs the first effect with a later list.
    const start = studySetup.indexOf("Reset once-per-study guards when the study changes.");
    const end = studySetup.indexOf("}, [studyId]);", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const effect = studySetup.slice(start, end);
    expect(effect).toContain("structuredValuesRef.current = new Map()");
    expect(effect).toContain("sessionMemoryRef.current = {}");
  });
});
