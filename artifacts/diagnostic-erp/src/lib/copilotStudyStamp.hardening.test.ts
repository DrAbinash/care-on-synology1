/**
 * PR-4 — a Copilot suggestion that outlived its study.
 *
 * Defence in depth, and only that. `copilotItems`, `acknowledgedCopilotIds` and
 * `activeCopilotItem` are all in CLINICAL_RESET_FIELDS, so every ordinary study
 * switch — `selectStudy`'s FULL reset, `useDraftPersistence`'s PARTIAL reset,
 * and `advanceToNextStudy`'s end-of-queue reset — empties the rail before
 * anything in it can be clicked. This does not replace that and does not touch
 * it. It covers the routes that go round it: a React click handler still
 * holding the previous render's item after a navigation, a deep link, browser
 * Back/Forward, or `selectStudy` no-oping on an id absent from the worklist.
 * `undoLastPatch` already refuses on exactly this reasoning; the copilot rail
 * had no equivalent, and it is the one suggestion surface whose Insert button
 * writes prose.
 *
 * What a stale click actually did. `insertCopilotText`'s `missing-comparison`
 * branch prepends the ITEM's own `insertText` to the open study's Findings
 * through a direct `set`, bypassing `mergeField`. So a nudge raised because
 * study A had priors would write "Comparison made with prior study dated ____."
 * into study B's report — including a B with no priors at all, which turns an
 * advisory prompt into a fabricated clinical statement — and autosave would
 * then persist it inside B's generation, where no guard intercepts.
 *
 * Item ids are deterministic (`missing-comparison`, `pending-measurements`), so
 * they also collide across studies. The stamp is what tells two items sharing an
 * id apart, which is why the check is on `studyId` and not on membership of the
 * current `copilotItems` array.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { CopilotItem, MeasurementRow, PriorStudy } from "@/lib/zai-workspace/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const STORE_SRC = "lib/zai-workspace/store.ts";
const TYPES_SRC = "lib/zai-workspace/types.ts";

/**
 * A worklist row with a patient attached. `recomputeCopilot` returns early
 * without one (`if (!st?.patient)`), so a test that needs the copilot to
 * actually produce items has to build this rather than just set activeStudyId.
 */
function studyRow(id: string, name: string) {
  return {
    id,
    accession: `ACC-${id}`,
    studyInstanceUID: `1.2.840.${id}`,
    patient: {
      id: `pt-${id}`,
      name,
      age: 52,
      sex: "M",
      uhid: `UHID-${id}`,
      referringDoctor: "Dr Ref",
    },
    modality: "CT",
    bodyPart: "CHEST",
    studyDescription: "CT chest",
    clinicalHistory: "Sudden breathlessness",
    status: "draft",
    priority: "urgent",
    receivedAt: new Date().toISOString(),
    priorCount: 0,
    criticalFlag: false,
    aiDraftReady: false,
    tatMinutes: 12,
    slaMinutes: 30,
    series: 1,
    images: 240,
  };
}

/** Study A has a prior, so the real analysis raises the comparison nudge. */
const PRIOR_A: PriorStudy = {
  id: "prior-A",
  date: "2024-11-02",
  modality: "CT",
  description: "CT chest 2024",
  impression: "Right pleural effusion, since resolved.",
  compatibilityScore: 92,
};

const MEASURE_A: MeasurementRow = {
  id: "m-a",
  name: "Aortic diameter",
  value: 41,
  unit: "mm",
  source: "viewer",
  inserted: false,
};

const MEASURE_B: MeasurementRow = {
  id: "m-b",
  name: "Common bile duct",
  value: 7,
  unit: "mm",
  source: "viewer",
  inserted: false,
};

const A_FINDINGS = "Lungs are well expanded. No focal consolidation.";
const B_FINDINGS = "Right lower lobe collapse with volume loss.";

/** Open a study through the real FULL reset, then give it content. */
function openStudy(
  id: string,
  content: { findings: string; priors?: PriorStudy[]; measurements?: MeasurementRow[] },
) {
  useWorkspace.getState().selectStudy(id);
  useWorkspace.setState({
    findingsText: content.findings,
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    priors: content.priors ?? [],
    measurements: content.measurements ?? [],
  } as never);
  useWorkspace.getState().recomputeCopilot();
  return useWorkspace.getState().copilotItems;
}

function itemWith(items: CopilotItem[], id: string): CopilotItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`the real analysis did not raise "${id}"; got ${items.map((i) => i.id).join(", ")}`);
  return found;
}

beforeEach(() => {
  // Fake timers keep selectStudy's deferred recomputeCopilot (and the one
  // insertCopilotText schedules) from firing after the assertions, or during
  // the next test.
  vi.useFakeTimers();
  useWorkspace.setState({ ...emptyClinicalState() } as never);
  useWorkspace.setState({
    activeStudyId: null,
    activeStudyInstanceUID: null,
    clinicalHistoryText: "",
    notification: null,
    criticalSlaStartedAt: null,
    criticalSlaEscalated: false,
    isFinalized: false,
    isDirty: false,
    studies: [studyRow("study-A", "Patient A"), studyRow("study-B", "Patient B")],
  } as never);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recomputeCopilot stamps the items it produces", () => {
  it("stamps every item with the study it was computed from", () => {
    const items = openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A], measurements: [MEASURE_A] });

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.studyId === "study-A")).toBe(true);
  });

  it("re-stamps for the study now open after a real switch", () => {
    openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A] });

    // Study B has no priors and no measurements, so its rail is a different set.
    const bItems = openStudy("study-B", { findings: B_FINDINGS });

    expect(bItems.length).toBeGreaterThan(0);
    expect(bItems.every((i) => i.studyId === "study-B")).toBe(true);
    expect(bItems.some((i) => i.studyId === "study-A")).toBe(false);
  });

  it("leaves the identical-recompute early return intact", () => {
    openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A] });
    const firstPass = useWorkspace.getState().copilotItems;

    useWorkspace.getState().recomputeCopilot();

    // Same reference, not merely equal contents: the JSON.stringify comparison
    // short-circuited before `set`. Stamping after that comparison would make
    // stored (stamped) and fresh (unstamped) items never match and would turn
    // the early return into dead code on every keystroke.
    expect(useWorkspace.getState().copilotItems).toBe(firstPass);
  });

  it("produces no unstamped item at all, so a refusal cannot be dodged", () => {
    const items = openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A], measurements: [MEASURE_A] });

    expect(items.filter((i) => i.studyId === undefined)).toEqual([]);
  });
});

describe("insertCopilotText refuses a suggestion that outlived its study", () => {
  it("still inserts when the stamp matches the open study", () => {
    // Positive control: the guard must not break the feature it protects.
    const items = openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A] });
    const nudge = itemWith(items, "missing-comparison");

    useWorkspace.getState().insertCopilotText(nudge);

    const s = useWorkspace.getState();
    expect(s.findingsText.startsWith("Comparison made with prior study dated ____.")).toBe(true);
    expect(s.findingsText).toContain(A_FINDINGS);
    expect(s.acknowledgedCopilotIds.has(nudge.id)).toBe(true);
  });

  it("refuses study A's comparison nudge once study B is open", () => {
    const aItems = openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A] });
    const stale = itemWith(aItems, "missing-comparison");

    // The real switch, which does empty the rail — the stale item only survives
    // because the click handler is holding it from the previous render.
    openStudy("study-B", { findings: B_FINDINGS });
    expect(useWorkspace.getState().copilotItems.some((i) => i.id === stale.id && i.studyId === "study-A")).toBe(false);
    const provenanceBefore = useWorkspace.getState().fieldProvenance;

    useWorkspace.getState().insertCopilotText(stale);

    const s = useWorkspace.getState();
    // B has no priors. Without the refusal this writes "Comparison made with
    // prior study dated ____." over B's Findings and claims it came from the
    // companion panel — a fabricated statement in a medico-legal document.
    expect(s.findingsText).toBe(B_FINDINGS);
    expect(s.fieldProvenance).toEqual(provenanceBefore);
    expect(s.acknowledgedCopilotIds.has(stale.id)).toBe(false);
    expect(s.activeCopilotItem).toBeNull();
    expect(s.isDirty).toBe(false);
  });

  it("refuses the measurement kind too, so no branch of the insert is exempt", () => {
    const aItems = openStudy("study-A", { findings: A_FINDINGS, measurements: [MEASURE_A] });
    const stale = itemWith(aItems, "pending-measurements");

    // B has its own pending measurement, so an unguarded stale click would call
    // insertAllMeasurements and silently commit B's numbers early.
    openStudy("study-B", { findings: B_FINDINGS, measurements: [MEASURE_B] });

    useWorkspace.getState().insertCopilotText(stale);

    const s = useWorkspace.getState();
    expect(s.findingsText).toBe(B_FINDINGS);
    expect(s.measurements.map((m) => m.inserted)).toEqual([false]);
    expect(s.acknowledgedCopilotIds.has(stale.id)).toBe(false);
  });

  it("refuses an item carrying no stamp at all", () => {
    openStudy("study-B", { findings: B_FINDINGS });
    // Strict on purpose: an unstamped item is not "unknown, allow it" but
    // "produced by something that never stamped it", which is the failure a
    // future producer would introduce. See CopilotItem.studyId.
    const unstamped: CopilotItem = {
      id: "missing-comparison",
      kind: "suggestion",
      title: "Prior available — comparison not mentioned",
      detail: "Add a comparison statement.",
      insertText: "Comparison made with prior study dated ____. ",
      confidence: "medium",
      source: "Priors",
    };

    useWorkspace.getState().insertCopilotText(unstamped);

    expect(useWorkspace.getState().findingsText).toBe(B_FINDINGS);
  });

  it("refuses before testing insertText, so the ordering cannot be quietly reversed", () => {
    openStudy("study-B", { findings: B_FINDINGS });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const staleWithoutText: CopilotItem = {
      id: "missing-rec",
      kind: "recommendation",
      title: "Recommendation missing",
      detail: "Add a follow-up recommendation.",
      confidence: "medium",
      source: "Recommendation",
      studyId: "study-A",
    };

    useWorkspace.getState().insertCopilotText(staleWithoutText);

    // A no-op click is still reported: the guard is about whose item this is,
    // not about whether it happens to carry text.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("says why it refused instead of failing silently", () => {
    const aItems = openStudy("study-A", { findings: A_FINDINGS, priors: [PRIOR_A] });
    const stale = itemWith(aItems, "missing-comparison");
    openStudy("study-B", { findings: B_FINDINGS });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    useWorkspace.getState().insertCopilotText(stale);

    const call = warn.mock.calls.find((c) => String(c[0]).includes("copilot insert refused"));
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      itemId: "missing-comparison",
      itemStudyId: "study-A",
      activeStudyId: "study-B",
    });
  });
});

/**
 * Brace-matched slice of one store method. Skips line and block comments,
 * single- and double-quoted strings, and template literals including their
 * `${}` interpolations, so a brace inside any of those cannot end the slice
 * early and make the contract below pass against the wrong span of code.
 */
function sliceMethod(name: string): string {
  const src = read(STORE_SRC);
  const start = src.indexOf(`\n  ${name}: `);
  if (start < 0) throw new Error(`${name} not found in ${STORE_SRC}`);
  const from = start + 1;
  let i = src.indexOf("{", from);
  if (i < 0) throw new Error(`${name} has no body in ${STORE_SRC}`);
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const nl = src.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 2;
    } else if (c === '"' || c === "'") {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (c === "`") {
      i += 1;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          let td = 1;
          i += 2;
          while (i < src.length && td > 0) {
            if (src[i] === "{") td += 1;
            else if (src[i] === "}") td -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      i += 1;
    } else {
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(from, i + 1);
      }
      i += 1;
    }
  }
  throw new Error(`unbalanced body for ${name} in ${STORE_SRC}`);
}

describe("the stamp cannot be dropped silently", () => {
  it("recomputeCopilot stamps with the study it just resolved", () => {
    const body = sliceMethod("recomputeCopilot");
    expect(body.startsWith("  recomputeCopilot: () => {")).toBe(true);
    expect(body).toContain("studyId: st.id");
  });

  it("stamps before the no-op comparison, so the early return still works", () => {
    const body = sliceMethod("recomputeCopilot");
    const stamp = body.indexOf("studyId: st.id");
    const compare = body.indexOf("JSON.stringify(copilotItems)");
    expect(stamp).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(compare);
  });

  it("insertCopilotText refuses on the stamp", () => {
    const body = sliceMethod("insertCopilotText");
    // The two-space prefix is the point: it proves the slice began at a
    // top-level store method and not at some nested property of the same name.
    expect(body.startsWith("  insertCopilotText: (item) => {")).toBe(true);
    expect(body).toContain("item.studyId !== get().activeStudyId");
  });

  it("checks the stamp before it checks insertText, so no branch is exempt", () => {
    const body = sliceMethod("insertCopilotText");
    const guard = body.indexOf("item.studyId !== get().activeStudyId");
    const textTest = body.indexOf("if (!item.insertText) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(textTest).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(textTest);
  });

  it("logs the refusal with both study ids, not a bare return", () => {
    const body = sliceMethod("insertCopilotText");
    expect(body).toContain("copilot insert refused");
    expect(body).toContain("itemStudyId");
  });

  it("CopilotItem declares the stamp, following CriticalFinding", () => {
    const src = read(TYPES_SRC);
    const line = src.split(/\r?\n/).find((l) => l.startsWith("export interface CopilotItem {"));
    expect(line, "CopilotItem not found in types.ts").toBeTruthy();
    expect(line).toContain("studyId?: string;");

    const critical = src.split(/\r?\n/).find((l) => l.startsWith("export interface CriticalFinding {"));
    expect(critical, "CriticalFinding not found in types.ts").toBeTruthy();
    expect(critical).toContain("studyId: string;");
  });
});
