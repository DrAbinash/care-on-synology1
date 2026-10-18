/**
 * The canvas Quick Select strip routes a parameterised box to the existing
 * structured dialog — it does not write the raw template.
 *
 * There is no DOM harness in this repo (`environment: "node"` repo-wide), so the
 * wiring is pinned from source, exactly as `quickSelectTileUsage.test.ts` pins the
 * strip's refusal/counter ordering. Two rules keep that honest (both learned the
 * hard way there): every slice is bounded by the component's own markers, never a
 * character budget (a fixed-width slice empties when a comment grows and then
 * every assertion on "" passes), and every read normalises CRLF first.
 *
 * What this proves, tied to the audit brief:
 *   - req 2/3/5: a box that declares parameters opens the dialog; a box that does
 *     not keeps the one-click chip write;
 *   - req 4: opening the dialog is not a write (no `onToggle`, no usage count, no
 *     after-pick feedback), so a cancel leaves the report untouched;
 *   - req 1: it reuses `studySetup.handleFindingClick` — the router the rail and
 *     the Clinic panel already use — rather than a second dialog.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8").replace(/\r\n/g, "\n");
/** Comments out, so a prose mention of a token never counts as code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const strip = () => codeOnly(read("../components/radiology/zai-workspace/quick-select-strip.tsx"));
const router = () => codeOnly(read("../hooks/useReportingStudySetup.ts"));

describe("the strip routes a parameterised box to the structured dialog", () => {
  function pickBody(): string {
    const src = strip();
    const start = src.indexOf("const pick = (box:");
    expect(start, "quick-select-strip must still own a pick handler").toBeGreaterThan(-1);
    const end = src.indexOf("\n  };", start);
    expect(end, "the pick handler must still be closed").toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("asks the structured router before it writes", () => {
    const body = pickBody();
    // The same predicate the router itself uses, so "needs a dialog" can never
    // drift from "the router will open one."
    expect(body).toMatch(/parseQuestions\(box\.questionsJson\)\.length > 0/);
    expect(body).toMatch(/onStructuredPick/);
    const route = body.indexOf("onStructuredPick(box)");
    expect(route, "the strip must call onStructuredPick").toBeGreaterThan(-1);
    // And it returns before the plain write — an opened dialog is not a report
    // change, so `onToggle` must not also fire for the same click.
    const write = body.indexOf("const outcome = onToggle(");
    expect(write, "the plain write must still exist for unparameterised boxes").toBeGreaterThan(-1);
    expect(route).toBeLessThan(write);
    expect(body.slice(route, write)).toMatch(/return;/);
  });

  it("does not reward a dialog-open as a use or a save", () => {
    const body = pickBody();
    const route = body.indexOf("onStructuredPick(box)");
    // Both side effects that follow a real write must come AFTER the write branch,
    // i.e. never fire merely because the dialog opened.
    for (const call of ["countUse.mutate(box.id)", "onAfterPick?.(field)"]) {
      const at = body.indexOf(call);
      expect(at, `${call} must still be present`).toBeGreaterThan(-1);
      expect(at, `${call} must not fire on a dialog open`).toBeGreaterThan(route);
    }
    // The route returns before reaching either of them.
    expect(body.indexOf("return;", route)).toBeLessThan(body.indexOf("countUse.mutate(box.id)"));
  });

  it("declares the optional prop and imports the real question parser (no second interface)", () => {
    expect(strip()).toMatch(/onStructuredPick\?: \(box: QuickFinding\) => void;/);
    expect(strip()).toMatch(/import \{ parseQuestions \} from "@\/lib\/structuredFindings"/);
  });

  it("the router opens the dialog for a box with questions and toggles one without", () => {
    // Guards the reuse: handleFindingClick is the ONE decision point, so the
    // strip inherits "cancel writes nothing" (the dialog's onApply is the only
    // writer) rather than reimplementing it.
    const r = router();
    const start = r.indexOf("const handleFindingClick = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = r.slice(start, r.indexOf("\n  },", start));
    expect(body).toMatch(/findingQuestions\(f\)\.length === 0/);
    expect(body).toMatch(/setStructuredDialog\(\{ finding: f/);
  });
});

describe("every Quick Select render site wires the structured router", () => {
  const COMP = join(HERE, "..", "components");
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (name.endsWith(".tsx")) acc.push(p);
    }
    return acc;
  }
  function elements(src: string, tag: string): string[] {
    const out: string[] = [];
    let at = src.indexOf(tag);
    while (at !== -1) {
      const next = src[at + tag.length];
      if (next !== undefined && !/[\s>/]/.test(next)) {
        at = src.indexOf(tag, at + tag.length);
        continue;
      }
      const close = src.indexOf("/>", at);
      expect(close, `${tag} must still be closed`).toBeGreaterThan(at);
      out.push(src.slice(at, close));
      at = src.indexOf(tag, close + 2);
    }
    return out;
  }

  const strips: { file: string; el: string }[] = [];
  for (const file of walk(COMP)) {
    const src = codeOnly(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    for (const el of elements(src, "<QuickSelectStrip")) strips.push({ file, el });
  }

  it("the census found every render site (positive control)", () => {
    // The count is the same population quickSelectTileUsage pins for the lock.
    expect(strips.length, "no <QuickSelectStrip> render site found — the scan is broken").toBe(4);
  });

  it("each site that can write a box can also route a parameterised one", () => {
    // A strip with `onToggle` but no `onStructuredPick` is the defect this PR
    // fixes: it writes the raw template and prints the brace. Every site must
    // hand structured boxes to the same router the sibling panels use.
    for (const { file, el } of strips) {
      const writes = /onToggle=\{/.test(el);
      expect(writes, `${file}: a strip that renders boxes must have onToggle`).toBe(true);
      expect(
        el,
        `${file.split(/[\\/]/).pop()}: <QuickSelectStrip> can write a box but cannot route a `
        + "parameterised one to the dialog — that box prints its unresolved {token} into the report",
      ).toMatch(/onStructuredPick=\{\(b\) =>\s*studySetup\.handleFindingClick\(b, selectedQuickIds, handleQuickToggle\)\s*\}/);
    }
  });
});
