/**
 * Clinical correctness tests for the radiology golden corpus.
 *
 * Three questions, in order:
 *
 *  1. Is the corpus itself sound? A case that contradicts its own observations is
 *     worse than no case, because everything downstream inherits the error.
 *  2. Does CARE's validation stay quiet on a CORRECT report? This is the control
 *     measurement, and it is asserted as an exact set: every signal a rule raises
 *     on clinically sound text has to be declared in CLEAN_REPORT_NOISE and
 *     classified. Undeclared noise fails; noise that stops firing fails too, so
 *     the noise floor cannot quietly rot into accepted behaviour.
 *  3. When the same case is broken on purpose, does a real gate say something NEW?
 *     Detection is a delta against the case's own correct report, because several
 *     rules already fire on correct text and would otherwise be credited with
 *     catching a defect they never saw.
 *
 * What the engines cannot see is in registers.ts and is asserted to still be
 * invisible. That is a measured defect register with a built-in expiry, not an
 * exemption: the day a gate catches one of these, this suite goes red and the
 * entry has to be deleted.
 */
import { describe, expect, it } from "vitest";
import { ALL_DEFECT_CLASSES, CORPUS_EXAMS, GOLDEN_CASES, allDefects } from "./index";
import { auditCaseShape, reportBlob } from "./contract";
import { applyDefect, defectApplied, detectionFor, signalDelta, signalsFor, unmetExpectations } from "./engine";
import { CLEAN_REPORT_NOISE, UNDETECTED_DEFECTS } from "./registers";

const DEFECTS = allDefects();

/** Everything one engine run said, as one flat comparable set. */
function signalSet(s: ReturnType<typeof signalsFor>): string[] {
  const blockers = new Set(s.blockerRuleIds);
  return [
    ...s.blockerRuleIds.map((r) => `blocker:${r}`),
    // A blocker is also reported at warning severity by the same rule; count it once.
    ...s.ruleIds.filter((r) => !blockers.has(r)).map((r) => `rule:${r}`),
    ...s.composer.errors.map((e) => `error:${e}`),
    ...s.composer.warnings.map((w) => `warn:${w}`),
    ...(s.composer.lateralitySwaps.length ? ["vector:lateralitySwaps"] : []),
    ...(s.composer.levelChanges.length ? ["vector:levelChanges"] : []),
    ...(s.composer.severityEscalations.length ? ["vector:severityEscalations"] : []),
    ...(s.composer.unsupportedMentions.length ? ["vector:unsupportedMentions"] : []),
  ].sort();
}

describe("golden corpus — internal consistency", () => {
  it("covers every requested examination with a normal and an abnormal case", () => {
    const byExam = new Map<string, string[]>();
    for (const c of GOLDEN_CASES) byExam.set(c.exam, [...(byExam.get(c.exam) ?? []), c.polarity]);
    expect([...byExam.keys()].sort()).toEqual([...CORPUS_EXAMS].sort());
    for (const exam of CORPUS_EXAMS) {
      expect(byExam.get(exam) ?? [], `${exam} cases`).toEqual(expect.arrayContaining(["normal", "abnormal"]));
    }
  });

  it("represents all ten defect classes, at least twice each", () => {
    const counts = new Map<string, number>();
    for (const { defect } of DEFECTS) counts.set(defect.class, (counts.get(defect.class) ?? 0) + 1);
    for (const cls of ALL_DEFECT_CLASSES) {
      expect(counts.get(cls) ?? 0, `${cls} defect instances`).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every case and every defect a unique key", () => {
    const caseKeys = GOLDEN_CASES.map((c) => c.key);
    expect(new Set(caseKeys).size).toBe(caseKeys.length);
    const defectKeys = DEFECTS.map(({ defect }) => defect.id);
    expect(new Set(defectKeys).size).toBe(defectKeys.length);
  });

  it("keeps every case self-consistent: negatives supported, prohibitions absent, levels supplied", () => {
    for (const c of GOLDEN_CASES) {
      expect(auditCaseShape(c), `${c.key} shape`).toEqual([]);
    }
  });

  it("carries no patient identifiers anywhere in the corpus", () => {
    const blob = GOLDEN_CASES.map((c) => reportBlob(c.report)).join("\n");
    expect(blob).not.toMatch(/\b\d{11,14}\b/);
    expect(blob).not.toMatch(/\b(UGID|UHID|MRN|Patient ID)\b/i);
    expect(blob).not.toMatch(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/);
  });

  it("states each defect's harm, so a failure reads as a clinical consequence", () => {
    for (const { defect } of DEFECTS) expect(defect.harm.trim().length, defect.id).toBeGreaterThan(15);
  });

  it("registers only defects that exist, and names every gap the corpus leaves undetected", () => {
    const ids = new Set(DEFECTS.map(({ defect }) => defect.id));
    for (const registered of Object.keys(UNDETECTED_DEFECTS)) {
      expect(ids.has(registered), `UNDETECTED_DEFECTS names "${registered}" which is not in the corpus`).toBe(true);
    }
    // The other half of the ratchet: a defect that no gate catches must be filed.
    for (const { goldenCase, defect } of DEFECTS) {
      if (Object.prototype.hasOwnProperty.call(UNDETECTED_DEFECTS, defect.id)) continue;
      const delta = signalDelta(signalsFor(goldenCase, goldenCase.report), signalsFor(goldenCase, applyDefect(goldenCase.report, defect)));
      expect(delta.length, `${defect.id} is not caught by any gate and is not registered as a gap`).toBeGreaterThan(0);
    }
  });
});

describe("golden corpus — correct reports (the noise floor)", () => {
  for (const c of GOLDEN_CASES) {
    it(`${c.key}: the correct report says what it must and nothing it must not`, () => {
      expect(unmetExpectations(c, c.report), `${c.key} unmet expectations`).toEqual([]);
    });
  }

  for (const c of GOLDEN_CASES) {
    it(`${c.key}: every signal a correct report produces is declared and classified`, () => {
      const measured = signalSet(signalsFor(c, c.report));
      const declared = (CLEAN_REPORT_NOISE[c.key] ?? []).map((e) => e.signal.split(",").map((s) => s.trim())).flat();
      expect(measured, `${c.key} undeclared noise: ${measured.filter((m) => !declared.includes(m))}`).toEqual([...declared].sort());
      for (const entry of CLEAN_REPORT_NOISE[c.key] ?? []) {
        expect(measured, `${c.key}: declared signal "${entry.signal}" no longer fires`).toEqual(expect.arrayContaining(entry.signal.split(",").map((s) => s.trim())));
      }
    });
  }

  it("keeps hard blockers to the measurements that justify them", () => {
    for (const c of GOLDEN_CASES) {
      const s = signalsFor(c, c.report);
      const justified = (CLEAN_REPORT_NOISE[c.key] ?? []).filter((e) => e.kind === "JUSTIFIED").map((e) => e.signal);
      const blockers = s.blockerRuleIds.map((r) => `blocker:${r}`);
      for (const b of blockers) {
        expect(justified, `${c.key}: blocker ${b} on a correct report is not justified by the case`).toContain(b);
      }
      expect(s.composer.errors.filter((e) => !e.startsWith("measurement_mutation")), `${c.key} composer errors`).toEqual([]);
    }
  });
});

describe("golden corpus — defect detection", () => {
  for (const { goldenCase, defect } of DEFECTS) {
    const registered = Object.prototype.hasOwnProperty.call(UNDETECTED_DEFECTS, defect.id);

    it(`${defect.id}: ${defect.harm}`, () => {
      const mutated = applyDefect(goldenCase.report, defect);
      expect(defectApplied(goldenCase, mutated, defect), `${defect.id} mutation had no effect`).toBe(true);
      const clean = signalsFor(goldenCase, goldenCase.report);
      const after = signalsFor(goldenCase, mutated);
      const delta = signalDelta(clean, after);
      const intended = detectionFor(after, defect.expect);

      if (registered) {
        expect(delta, `${defect.id} is registered as invisible but now reacts (${delta.join(", ")}) — delete the register entry`).toEqual([]);
      } else {
        expect(delta.length, `${defect.id} produced no new signal (${JSON.stringify(defect.expect)})`).toBeGreaterThan(0);
      }
      // Where a gate did react, record whether it was the gate meant to.
      if (!registered && intended.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`incidental: ${defect.id} caught by ${delta.join(", ")} rather than the intended ${JSON.stringify(defect.expect)}`);
      }
    });
  }

  it("publishes the per-class detection census", () => {
    const rows = ALL_DEFECT_CLASSES.map((cls) => {
      const list = DEFECTS.filter((d) => d.defect.class === cls);
      const registered = list.filter(({ defect }) => Object.prototype.hasOwnProperty.call(UNDETECTED_DEFECTS, defect.id)).length;
      const intendedFired = list.filter(({ goldenCase, defect }) => {
        if (Object.prototype.hasOwnProperty.call(UNDETECTED_DEFECTS, defect.id)) return false;
        const delta = signalDelta(signalsFor(goldenCase, goldenCase.report), signalsFor(goldenCase, applyDefect(goldenCase.report, defect)));
        return delta.some((d) => detectionFor(signalsFor(goldenCase, applyDefect(goldenCase.report, defect)), defect.expect).includes(d));
      }).length;
      return { class: cls, instances: list.length, caught: list.length - registered, undetected: registered, "caught-by-intended-gate": intendedFired };
    });
    // eslint-disable-next-line no-console
    console.table(rows);
    const total = DEFECTS.length;
    const gaps = Object.keys(UNDETECTED_DEFECTS).length;
    const noiseCases = Object.keys(CLEAN_REPORT_NOISE).length;
    const falsePositives = Object.values(CLEAN_REPORT_NOISE).flat().filter((e) => e.kind === "FALSE POSITIVE").length;
    // eslint-disable-next-line no-console
    console.log(
      `golden corpus: ${GOLDEN_CASES.length} cases / ${total} defects — ${total - gaps} caught (${(((total - gaps) / total) * 100).toFixed(1)}%), ${gaps} registered invisible. ` +
      `Correct reports produced ${falsePositives} false-positive signals across ${noiseCases} cases.`,
    );
    expect(rows.reduce((s, r) => s + r.instances, 0)).toBe(total);
  });
});
