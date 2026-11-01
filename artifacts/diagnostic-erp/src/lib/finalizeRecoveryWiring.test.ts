import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The recovery's wiring, pinned at the level the local suite can actually reach.
 *
 * This package has no DOM test environment (`vitest.config.ts` sets
 * `environment: "node"`, and jsdom is not installed), so the one-click close
 * cannot be rendered here. What CAN be pinned is the failure this repo has been
 * bitten by repeatedly: a field carried all the way through the view-model and
 * then never used by the JSX, or a recovery wired to the wrong leg. The runtime
 * behaviour of both halves is already proven elsewhere — the decision table in
 * `finalizeOutcomeMessage.test.ts`, the single-leg POST in
 * `finalizePartialFailure.recovery.test.ts` — so these assertions only close the
 * gap between them and the screen.
 *
 * Sources are read with CRLF normalised first: this repository is checked out
 * with Windows line endings on the operator's box, and a slice taken against raw
 * bytes silently matches nothing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");

const barSrc = read("../components/radiology/ReportingStickyActionBar.tsx");
const canvasSrc = read("../components/radiology/workspace/ReportCanvas.tsx");
const hookSrc = read("../hooks/radiology-workspace/useStudyFinalize.ts");
const lifecycleSrc = read("radiologyReportLifecycle.ts");

describe("the one-click close is wired to the screen that offers it", () => {
  it("the sticky bar renders the button only from the pending refusal", () => {
    expect(barSrc).toMatch(/unlinkedClose\?:/);
    // Conditional, not always-present: a button that closes a study without
    // verified images must not sit on the bar waiting for a mis-click.
    expect(barSrc).toMatch(/\{unlinkedClose \? \(/);
    expect(barSrc).toMatch(/data-testid="sticky-close-unlinked"/);
    expect(barSrc).toMatch(/onClick=\{unlinkedClose\.onConfirm\}/);
  });

  it("ReportCanvas passes the pending close through instead of dropping it", () => {
    // The exact shape of the past defect: the state reached the component's props
    // and the JSX never read it.
    expect(canvasSrc).toMatch(/unlinkedClose,/);
    expect(canvasSrc).toMatch(/unlinkedClose=\{unlinkedClose/);
    expect(canvasSrc).toMatch(/onConfirm: \(\) => \{ void closeStudyWithoutImages\(\); \}/);
  });

  it("the hook arms the recovery only when the refusal said a click can answer it", () => {
    expect(hookSrc).toMatch(/refusal\.canConfirmUnlinked && finalizeResult\.reportId != null/);
    // …and it clears the offer when another study is opened, so a pending close
    // cannot follow the radiologist across studies.
    expect(hookSrc).toMatch(/useEffect\(\(\) => \{ setUnlinkedClose\(null\); \}, \[studyId\]\)/);
  });

  it("the recovery posts the status flip and nothing else", () => {
    const start = lifecycleSrc.indexOf("export async function closeStudyWithoutLinkedImages");
    expect(start).toBeGreaterThan(-1);
    const body = lifecycleSrc.slice(start, lifecycleSrc.indexOf("\n}\n", start));
    expect(body).toContain("/api/internal/radiology/report-status");
    expect(body).toContain("confirmUnlinked: true");
    // No create leg, no sign leg — that is what makes it safe to hand a radiologist
    // a button after a finalize that already signed.
    expect(body).not.toMatch(/api\.post\("\/api\/patient-reports"/);
    expect(body).not.toMatch(/\/sign"/);
    expect(body.match(/api\.post\(/g) ?? []).toHaveLength(1);
  });
});
