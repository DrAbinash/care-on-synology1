/**
 * upstreamStudyDrift.test.ts — item 23: a report typed while the row under it
 * was rewritten.
 *
 * THE GAP UNDER GUARD
 *   The reception desk re-bills an examination and the machine re-imports a
 *   study while a radiologist is drafting. Until now the workspace found that
 *   out only at WRITE time — `useDraftPersistence.ts` latches a 409 into
 *   "conflict" / "locked-by-other" when the save or the sign arrives — so the
 *   first notice came after the whole report had been written against a test
 *   and a patient identity that no longer existed. The read side had no
 *   comparison at all, and the one record that could make it (`["pacs-worklist-detail",
 *   studyId]`, the by-id read that survives the reading-queue filter) had no
 *   reason to re-read while the radiologist stayed on the tab.
 *
 *   So these tests guard four things that can each fail independently:
 *     1. the comparison covers the columns the report prints, and NOTHING else —
 *        a signature applied elsewhere is the study lock's and
 *        `reportSignatureWithdrawal.ts`'s job, and restating it here would be
 *        a second alert for one event;
 *     2. the baseline belongs to the study it was captured on, so switching
 *        studies cannot carry a warning over, and a failed re-read cannot erase
 *        one that is already standing;
 *     3. a change this console made itself is folded into the baseline only
 *        once the server has agreed, so the referring-doctor control is not
 *        reported as the desk changing it back — and a pending fold can never
 *        swallow a real third-party change;
 *     4. the result reaches the composer chrome (not an accordion body) and the
 *        canvas actually renders it. An inert module is the defect this file
 *        exists for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  acknowledgedUpstreamBaseline,
  diffUpstreamStudyState,
  normalizeUpstreamValue,
  readUpstreamStudyState,
  sameUpstreamDrift,
  stepUpstreamDrift,
  upstreamDriftHeading,
  upstreamDriftLine,
  withUpstreamSelfWrite,
  type UpstreamBaseline,
  type UpstreamDriftField,
  type UpstreamDetailSource,
} from "./upstreamStudyDrift";
import { UpstreamDriftStrip } from "@/components/radiology/workspace/UpstreamDriftStrip";

// The root vitest config runs the node environment and compiles JSX with the
// classic runtime, so the transformed component bodies look for a global React.
(globalThis as { React?: unknown }).React = React;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const HOOK = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const CANVAS = read("components/radiology/workspace/ReportCanvas.tsx");
const DOCTOR = read("components/ReferringDoctorQuickSelect.tsx");
const STRIP = read("components/radiology/workspace/UpstreamDriftStrip.tsx");
const LIB = read("lib/upstreamStudyDrift.ts");

/** A worklist row as the by-id route returns it. Names are synthetic. */
function detail(overrides: Partial<UpstreamDetailSource> = {}): UpstreamDetailSource {
  return {
    id: 4211,
    studyId: 909,
    patientId: 77,
    uhid: "UH-00077",
    patientName: "SYNTHETIC PATIENT ALPHA",
    age: "45Y",
    sex: "M",
    modality: "MR",
    studyDescription: "MRI BRAIN",
    studyDate: "2026-11-13",
    accessionNumber: "ACC26004211",
    studyInstanceUID: "1.2.826.0.1.3680043.9.1357.20261113.1",
    referringDoctor: "DR SYNTHETIC ONE",
    testName: "MRI Brain Plain",
    billedTestName: "MRI Brain Plain",
    status: "REPORT_IN_PROGRESS",
    ...overrides,
  };
}

function state(overrides: Partial<UpstreamDetailSource> = {}) {
  return readUpstreamStudyState(detail(overrides))!;
}

function baseline(overrides: Partial<UpstreamDetailSource> = {}): UpstreamBaseline {
  return { studyId: 4211, state: state(overrides) };
}

describe("upstreamStudyDrift — what the comparison covers", () => {
  it("1. refuses to build a record out of nothing", () => {
    expect(readUpstreamStudyState(null)).toBeNull();
    expect(readUpstreamStudyState(undefined)).toBeNull();
  });

  it("2. reads the billed test from testName, falling back to the alias", () => {
    expect(state({ testName: "MRI Brain With Contrast", billedTestName: "Alias" }).billedTest)
      .toBe("MRI Brain With Contrast");
    expect(state({ testName: null, billedTestName: "MRI Brain With Contrast" }).billedTest)
      .toBe("MRI Brain With Contrast");
  });

  it("3. normalizes each cell: trimmed, inner whitespace collapsed, blank for null", () => {
    const s = state({ patientName: "  SYNTHETIC   PATIENT ALPHA ", age: null, sex: undefined });
    expect(s.patientName).toBe("SYNTHETIC PATIENT ALPHA");
    expect(s.age).toBe("");
    expect(s.sex).toBe("");
    expect(normalizeUpstreamValue(" a  b ")).toBe("a b");
    expect(normalizeUpstreamValue(undefined)).toBe("");
  });

  it("4. compares the columns the report prints — 11 of them", () => {
    const s = state();
    expect(Object.keys(s).sort()).toEqual([
      "accessionNumber", "age", "billedTest", "examination", "modality", "patientName",
      "referringDoctor", "sex", "studyDate", "studyInstanceUID", "uhid",
    ]);
  });

  it("5. does NOT compare signing state: a status change is the lock's business", () => {
    const body = LIB.slice(LIB.indexOf("export function readUpstreamStudyState"), LIB.indexOf("/** Every field that moved"));
    expect(body).not.toContain("detail.status");
    expect(body).not.toContain("reportId");
    expect(body).not.toContain("deliveryStatus");
    // Behavioural half of the same rule: a row that came back signed.
    const signed = readUpstreamStudyState({
      ...detail(),
      status: "REPORT_FINAL",
      reportId: 5,
      deliveryStatus: "PRINTED",
    } as UpstreamDetailSource)!;
    expect(diffUpstreamStudyState(state(), signed)).toEqual([]);
  });

  it("6. reformatted-but-same and blank-vs-null are not drift", () => {
    expect(diffUpstreamStudyState(state(), state({ patientName: "SYNTHETIC  PATIENT ALPHA" }))).toEqual([]);
    expect(diffUpstreamStudyState(state({ referringDoctor: "" }), state({ referringDoctor: null }))).toEqual([]);
  });

  it("7. reports a re-bill that changes plain to contrast", () => {
    const fields = diffUpstreamStudyState(state(), state({ testName: "MRI Brain With Contrast", billedTestName: "MRI Brain With Contrast" }));
    expect(fields).toEqual([
      { key: "billedTest", label: "Billed test", from: "MRI Brain Plain", to: "MRI Brain With Contrast" },
    ]);
  });

  it("8. reports a DICOM re-import that restamps identity, accession and UID together", () => {
    const fields = diffUpstreamStudyState(
      state(),
      state({ patientName: "SYNTHETIC PATIENT ALPHAA", age: "{'Name':'PatientAge'}", accessionNumber: "ACC26009999" }),
    );
    expect(fields.map((f) => f.key)).toEqual(["patientName", "age", "accessionNumber"]);
  });

  it("9. returns fields in display order whatever the payload order was", () => {
    const fields = diffUpstreamStudyState(
      state({ patientName: "X", referringDoctor: "Y", testName: null }),
      state({ patientName: "Z", referringDoctor: "W", testName: "Q" }),
    );
    expect(fields.map((f) => f.key)).toEqual(["patientName", "billedTest", "referringDoctor"]);
  });

  it("10. diffs nothing without both sides", () => {
    const s = state();
    expect(diffUpstreamStudyState(null, s)).toEqual([]);
    expect(diffUpstreamStudyState(s, null)).toEqual([]);
  });

  it("11. folds this console's own write, and only allocates when it moved", () => {
    const s = state();
    expect(withUpstreamSelfWrite(s, "referringDoctor", "  DR SYNTHETIC   ONE ")).toBe(s);
    const next = withUpstreamSelfWrite(s, "referringDoctor", "DR SYNTHETIC TWO");
    expect(next).not.toBe(s);
    expect(next.referringDoctor).toBe("DR SYNTHETIC TWO");
    expect(next.patientName).toBe(s.patientName);
  });

  it("12. phrases the heading by the count and reads a blank side for what it is", () => {
    expect(upstreamDriftHeading([])).toBe("");
    expect(upstreamDriftHeading([{ key: "age", label: "Age", from: "45Y", to: "46Y" }]))
      .toBe("1 detail on this study changed while the report was open");
    expect(upstreamDriftHeading([
      { key: "age", label: "Age", from: "45Y", to: "46Y" },
      { key: "sex", label: "Sex", from: "M", to: "F" },
    ])).toBe("2 details on this study changed while the report was open");
    expect(upstreamDriftLine({ key: "age", label: "Age", from: "45Y", to: "46Y" })).toBe("Age: 45Y → 46Y");
    expect(upstreamDriftLine({ key: "uhid", label: "UHID", from: "", to: "UH-00077" })).toContain("not set");
    expect(upstreamDriftLine({ key: "referringDoctor", label: "Referring doctor", from: "DR X", to: "" })).toContain("cleared");
  });

  it("13. compares drift lists by content, not by reference", () => {
    const a: UpstreamDriftField[] = [{ key: "age", label: "Age", from: "45Y", to: "46Y" }];
    expect(sameUpstreamDrift(a, [{ key: "age", label: "Age", from: "45Y", to: "46Y" }])).toBe(true);
    expect(sameUpstreamDrift(a, [{ key: "age", label: "Age", from: "45Y", to: "47Y" }])).toBe(false);
    expect(sameUpstreamDrift(a, [])).toBe(false);
    expect(sameUpstreamDrift([], [])).toBe(true);
  });
});

describe("upstreamStudyDrift — the step the workspace runs on every re-read", () => {
  const step = (input: Parameters<typeof stepUpstreamDrift>[0]) => stepUpstreamDrift(input);

  it("14. no study open: nothing is remembered", () => {
    const out = step({
      studyId: undefined,
      baseline: baseline(),
      read: state(),
      drift: [{ key: "age", label: "Age", from: "45Y", to: "46Y" }],
      selfWrites: [["age", "46Y"]],
    });
    expect(out).toEqual({ baseline: null, drift: [], selfWrites: [] });
    expect(step({ studyId: 0, baseline: baseline(), read: state(), drift: [], selfWrites: [] }).baseline).toBeNull();
  });

  it("15. the first read of a study captures the baseline and warns about nothing", () => {
    const out = step({ studyId: 4211, baseline: null, read: state(), drift: [], selfWrites: [] });
    expect(out.drift).toEqual([]);
    expect(out.baseline?.studyId).toBe(4211);
    expect(out.baseline?.state).toEqual(state());
  });

  it("16. with no read yet there is no baseline to capture", () => {
    const out = step({ studyId: 4211, baseline: null, read: null, drift: [], selfWrites: [] });
    expect(out.baseline).toBeNull();
    expect(out.drift).toEqual([]);
  });

  it("17. switching studies drops the previous study's warning before its data lands", () => {
    const standing: UpstreamDriftField[] = [{ key: "billedTest", label: "Billed test", from: "A", to: "B" }];
    const out = step({ studyId: 4212, baseline: baseline(), read: null, drift: standing, selfWrites: [["age", "9Y"]] });
    expect(out.drift).toEqual([]);
    expect(out.baseline).toBeNull();
    expect(out.selfWrites).toEqual([]);
  });

  it("18. a failed re-read leaves a standing warning alone rather than erasing it", () => {
    const captured = baseline();
    const standing: UpstreamDriftField[] = [{ key: "billedTest", label: "Billed test", from: "A", to: "B" }];
    const out = step({ studyId: 4211, baseline: captured, read: null, drift: standing, selfWrites: [] });
    expect(out.drift).toBe(standing);
    expect(out.baseline).toBe(captured);
  });

  it("19. an unchanged re-read hands back the SAME drift reference", () => {
    const captured = baseline();
    const empty: UpstreamDriftField[] = [];
    const out = step({ studyId: 4211, baseline: captured, read: state(), drift: empty, selfWrites: [] });
    expect(out.drift).toBe(empty);
    // The common case while a warning stands: the poll re-reads the same row,
    // recomputes the same list, and the composer is not re-rendered.
    const standing: UpstreamDriftField[] = [{ key: "age", label: "Age", from: "45Y", to: "46Y" }];
    const again = step({
      studyId: 4211,
      baseline: captured,
      read: state({ age: "46Y" }),
      drift: standing,
      selfWrites: [],
    });
    expect(again.drift).toBe(standing);
    // The desk moves the same column again: a new list, and it names the
    // change from the baseline the report opened with, not from the last one.
    const moved = step({
      studyId: 4211,
      baseline: captured,
      read: state({ age: "47Y" }),
      drift: standing,
      selfWrites: [],
    });
    expect(moved.drift).not.toBe(standing);
    expect(moved.drift.map((f) => upstreamDriftLine(f))).toEqual(["Age: 45Y → 47Y"]);
  });

  it("20. a re-bill that lands while the report is open raises the warning", () => {
    const captured = baseline();
    const out = step({
      studyId: 4211,
      baseline: captured,
      read: state({ testName: "MRI Brain With Contrast", billedTestName: "MRI Brain With Contrast" }),
      drift: [],
      selfWrites: [],
    });
    expect(out.drift.map((f) => upstreamDriftLine(f))).toEqual(["Billed test: MRI Brain Plain → MRI Brain With Contrast"]);
    expect(out.baseline?.state.billedTest).toBe("MRI Brain Plain");
  });

  it("21. this console's own write is not reported once the server confirms it", () => {
    const captured = baseline();
    const out = step({
      studyId: 4211,
      baseline: captured,
      read: state({ referringDoctor: "DR SYNTHETIC TWO" }),
      drift: [],
      selfWrites: [["referringDoctor", "DR SYNTHETIC TWO"]],
    });
    expect(out.drift).toEqual([]);
    expect(out.selfWrites).toEqual([]);
    expect(out.baseline?.state.referringDoctor).toBe("DR SYNTHETIC TWO");
  });

  it("22. the fold WAITS for the server: an in-flight older read is not rebaselined early", () => {
    const captured = baseline();
    const out = step({
      studyId: 4211,
      baseline: captured,
      read: state(),
      drift: [],
      selfWrites: [["referringDoctor", "DR SYNTHETIC TWO"]],
    });
    expect(out.drift).toEqual([]);
    expect(out.selfWrites).toEqual([["referringDoctor", "DR SYNTHETIC TWO"]]);
    expect(out.baseline?.state).toBe(captured.state);
  });

  it("23. a pending fold cannot swallow a real change to a third value", () => {
    const out = step({
      studyId: 4211,
      baseline: baseline(),
      read: state({ referringDoctor: "DR SYNTHETIC THREE" }),
      drift: [],
      selfWrites: [["referringDoctor", "DR SYNTHETIC TWO"]],
    });
    expect(out.drift.map((f) => f.key)).toEqual(["referringDoctor"]);
    expect(out.drift[0].to).toBe("DR SYNTHETIC THREE");
  });

  it("24. only the confirmed self-writes fold when two are pending", () => {
    const out = step({
      studyId: 4211,
      baseline: baseline(),
      read: state({ referringDoctor: "DR SYNTHETIC TWO" }),
      drift: [],
      selfWrites: [["referringDoctor", "DR SYNTHETIC TWO"], ["age", "9Y"]],
    });
    expect(out.selfWrites).toEqual([["age", "9Y"]]);
    expect(out.baseline?.state.referringDoctor).toBe("DR SYNTHETIC TWO");
    expect(out.baseline?.state.age).toBe("45Y");
  });

  it("25. acknowledging moves the baseline to now, so the same change does not warn twice", () => {
    const captured = baseline();
    const now = state({ testName: "MRI Brain With Contrast", billedTestName: "MRI Brain With Contrast" });
    const raised = step({ studyId: 4211, baseline: captured, read: now, drift: [], selfWrites: [] });
    expect(raised.drift).toHaveLength(1);
    const acked = acknowledgedUpstreamBaseline(raised.baseline!, now);
    expect(acked.state).toEqual(now);
    expect(diffUpstreamStudyState(acked.state, now)).toEqual([]);
    // A second change after the acknowledgement still warns.
    expect(diffUpstreamStudyState(acked.state, state({ testName: "CT Chest", billedTestName: "CT Chest" })))
      .toHaveLength(1);
  });
});

describe("item 23 — the drift check is wired into the workspace, not just written", () => {
  it("26. the canonical by-id read re-reads on the workspace's own visible-tab interval", () => {
    const at = HOOK.indexOf('queryKey: ["pacs-worklist-detail", studyId]');
    expect(at).toBeGreaterThan(-1);
    const options = HOOK.slice(at, HOOK.indexOf("});", at));
    expect(options).toContain("refetchInterval: visibleTabRefetchInterval(isTabVisible, 30_000)");
    // Bounded: this is the detail query's own option object, not a neighbour's.
    expect(options).toContain("staleTime: 60_000");
    expect(options).toContain("retry: false");
  });

  it("27. the comparison reads the same canonical record the lock and the header read", () => {
    expect(HOOK).toContain("readUpstreamStudyState(worklistDetailQ.data)");
    const call = HOOK.slice(HOOK.indexOf("stepUpstreamDrift({"), HOOK.indexOf("});", HOOK.indexOf("stepUpstreamDrift({")) + 3);
    expect(call).toContain("read: upstreamReadState");
    expect(call).toContain("baseline: upstreamBaselineRef.current");
    expect(call).toContain("selfWrites: [...upstreamSelfWritesRef.current]");
  });

  it("28. the effect does not depend on the drift it writes", () => {
    const at = HOOK.indexOf("stepUpstreamDrift({");
    const deps = HOOK.slice(HOOK.indexOf("}, [", at), HOOK.indexOf("]);", at) + 3);
    expect(deps).toContain("upstreamReadState");
    expect(deps).not.toContain("upstreamDrift");
  });

  it("29. the hook hands the warning, the acknowledgement and the fold to the canvas", () => {
    expect(HOOK).toContain("    upstreamDrift,\n");
    expect(HOOK).toContain("    acknowledgeUpstreamDrift,\n");
    expect(HOOK).toContain("    noteUpstreamSelfWrite,\n");
  });

  it("30. the strip is mounted in canvas chrome that is never behind an accordion", () => {
    const chrome = CANVAS.indexOf("Viewer chrome — never hidden behind an accordion header");
    const mount = CANVAS.indexOf("<UpstreamDriftStrip");
    expect(chrome).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(chrome);
    const identity = CANVAS.indexOf("<ComposerIdentityStrip");
    expect(mount).toBeLessThan(identity);
    // Not folded into an accordion body: the first section header comes later.
    expect(mount).toBeLessThan(CANVAS.indexOf("<ReportAccordionSection"));
  });

  it("31. the canvas feeds it the live drift list and the acknowledgement", () => {
    const at = CANVAS.indexOf("<UpstreamDriftStrip");
    const props = CANVAS.slice(at, CANVAS.indexOf("/>", at) + 2);
    expect(props).toContain("fields={upstreamDrift}");
    expect(props).toContain("onAcknowledge={acknowledgeUpstreamDrift}");
    expect(CANVAS).toContain("    upstreamDrift,\n");
  });

  it("32. the one in-workspace writer tells the drift check it was ours", () => {
    const setMut = DOCTOR.slice(DOCTOR.indexOf("const setMut = useMutation({"), DOCTOR.indexOf("onError:", DOCTOR.indexOf("const setMut = useMutation({")));
    expect(setMut).toContain('onUpstreamSelfWrite?.("referringDoctor", data.referringDoctor ?? null)');
    expect(setMut).toContain("onSuccess: (data) =>");
    expect(CANVAS).toContain("onUpstreamSelfWrite={noteUpstreamSelfWrite}");
  });

  it("33. a study linked to a bill while the report is open is drift, not a fold", () => {
    // The link-study and match-decision writers live on pages/MyCollection.tsx,
    // a different page, so nothing folds them: the billed test appearing is
    // exactly the upstream event the radiologist must see.
    const out = stepUpstreamDrift({
      studyId: 4211,
      baseline: baseline({ testName: null, billedTestName: null }),
      read: state(),
      drift: [],
      selfWrites: [],
    });
    expect(out.drift.map((f) => upstreamDriftLine(f))).toEqual(["Billed test: not set → MRI Brain Plain"]);
  });
});

describe("item 23 — what the radiologist is actually shown", () => {
  const markup = (fields: UpstreamDriftField[]) =>
    renderToStaticMarkup(React.createElement(UpstreamDriftStrip, { fields, onAcknowledge: () => undefined }));

  it("34. nothing at all while the row matches what the report opened with", () => {
    expect(markup([])).toBe("");
  });

  it("35. names the field, both values, and how many changed", () => {
    const html = markup(diffUpstreamStudyState(state(), state({ testName: "MRI Brain With Contrast", billedTestName: "MRI Brain With Contrast" })));
    expect(html).toContain('role="alert"');
    expect(html).toContain("data-testid=\"upstream-drift-strip\"");
    expect(html).toContain("1 detail on this study changed while the report was open");
    expect(html).toContain("Billed test:");
    expect(html).toContain("MRI Brain Plain");
    expect(html).toContain("MRI Brain With Contrast");
    expect(html).toContain('data-testid="upstream-drift-line-billedTest"');
    expect(html).toContain('data-testid="upstream-drift-acknowledge"');
    expect(html).toContain("I have reviewed these changes");
    // The acknowledgement is the control that clears the warning, not a label.
    expect(STRIP).toContain("onClick={onAcknowledge}");
  });

  it("36. lists every changed column in display order", () => {
    const html = markup(diffUpstreamStudyState(
      state(),
      state({ patientName: "SYNTHETIC PATIENT BETA", referringDoctor: "DR SYNTHETIC TWO", accessionNumber: "ACC26009999" }),
    ));
    expect((html.match(/<li/g) ?? []).length).toBe(3);
    expect(html.indexOf("upstream-drift-line-patientName") < html.indexOf("upstream-drift-line-accessionNumber")).toBe(true);
    expect(html.indexOf("upstream-drift-line-accessionNumber") < html.indexOf("upstream-drift-line-referringDoctor")).toBe(true);
    expect(html).toContain("3 details on this study changed while the report was open");
  });

  it("37. says plainly that the draft itself was not rewritten", () => {
    const html = markup([{ key: "billedTest", label: "Billed test", from: "MRI Brain Plain", to: "MRI Brain With Contrast" }]);
    expect(html).toContain("has not been changed");
    expect(html).toContain("data-testid=\"upstream-drift-note\"");
  });

  it("38. renders a never-set or cleared column as that state, not as blank", () => {
    const html = markup([
      { key: "uhid", label: "UHID", from: "", to: "UH-00077" },
      { key: "referringDoctor", label: "Referring doctor", from: "DR SYNTHETIC ONE", to: "" },
    ]);
    expect(html).toContain("not set");
    expect(html).toContain("cleared");
  });
});
