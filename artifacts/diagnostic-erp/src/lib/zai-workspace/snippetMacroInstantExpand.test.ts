import { beforeEach, describe, expect, it } from "vitest";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_SNIPPET_MACROS } from "@/lib/zai-workspace/snippet-macros-library";

/**
 * The popover a snippet macro opens tells the radiologist to press Enter, but its
 * focus `ref` only ever attaches to a text input — so for a macro with nothing to
 * fill, Enter stayed in the textarea as a newline and the trigger was left on the
 * page unexpanded (`:acorr`, `:normalbrain`, `:normallssp` and the other no-variable
 * closers). These tests pin the replacement: a macro with no variables expands on
 * the keystroke that finishes it, and a macro with variables still stops at the
 * popover, because there the values have to come from him.
 */

const ACORR = "Clinico-pathological correlation is advised.";
const BMICRO =
  "Symmetrical susceptibility-weighted blooming is seen in the bilateral basal ganglia, suggestive of mineral deposition.";

function openStudy(region: string, over: Record<string, unknown> = {}) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "override",
    }),
    studies: [{ id: "study-A", patient: { name: "HARNESS" }, modality: "MR" }],
    activeStudyId: "study-A",
    snippetMacros: DEFAULT_SNIPPET_MACROS,
    ...over,
  } as never);
}

const rec = () => useWorkspace.getState().recommendationText;
const fin = () => useWorkspace.getState().findingsText;
const prompt = () => useWorkspace.getState().activeMacroPrompt;

describe("snippet macros that need no input expand as they are typed", () => {
  beforeEach(() => openStudy("Brain"));

  it("types :acorr and gets the sentence, with no popover left open", () => {
    useWorkspace.getState().setField("recommendation", ":acorr");
    expect(rec()).toBe(`${ACORR} `);
    expect(prompt()).toBe(null);
  });

  it("keeps whatever was already in the field", () => {
    useWorkspace.getState().setField("recommendation", "Please correlate with the clinic.");
    useWorkspace.getState().setField("recommendation", "Please correlate with the clinic. :acorr");
    expect(rec()).toBe(`Please correlate with the clinic. ${ACORR} `);
    expect(rec()).not.toContain(":acorr");
  });

  it("expands a Brain finding macro into Findings as well", () => {
    useWorkspace.getState().setField("findings", "No acute infarct. :bmicro");
    expect(fin()).toBe(`No acute infarct. ${BMICRO} `);
    expect(prompt()).toBe(null);
  });

  it("covers the macros that shipped before this change", () => {
    const noVar = DEFAULT_SNIPPET_MACROS.filter((m) => m.variables.length === 0);
    expect(noVar.length).toBeGreaterThan(0);
    for (const m of noVar) {
      if (m.scopeBodyPart && m.scopeBodyPart !== "Brain") continue;
      openStudy("Brain");
      useWorkspace.getState().setField("recommendation", `:${m.trigger}`);
      expect(`${m.trigger}: ${rec()}`).toContain(m.template);
      expect(rec()).not.toContain(`:${m.trigger}`);
      expect(prompt()).toBe(null);
    }
  });

  it("leaves an unregistered :code exactly as typed", () => {
    useWorkspace.getState().setField("recommendation", ":zznotamacro");
    expect(rec()).toBe(":zznotamacro");
    expect(prompt()).toBe(null);
  });

  it("only reacts to a trigger finished at the end of the text", () => {
    useWorkspace.getState().setField("recommendation", ":acorr and then some more");
    expect(rec()).toBe(":acorr and then some more");
  });

  it("does not expand a macro the study's region does not offer", () => {
    // :bmass is Brain-scoped. On an LS Spine study the trigger is not in the
    // scoped list, so the text must stay literal rather than borrow a brain
    // sentence into a spine report.
    openStudy("LS Spine");
    useWorkspace.getState().setField("findings", "Conus medullaris is normal. :bmass");
    expect(fin()).toBe("Conus medullaris is normal. :bmass");
    expect(prompt()).toBe(null);
  });

  it("still stops at the popover when a value has to come from the radiologist", () => {
    useWorkspace.getState().setField("recommendation", ":afollow");
    expect(rec()).toBe(":afollow");
    expect(prompt()?.macro.trigger).toBe("afollow");
    expect(prompt()?.field).toBe("recommendation");
    expect(prompt()?.startPos).toBe(0);
  });

  it("writes nothing on a signed report", () => {
    openStudy("Brain", { isFinalized: true });
    const before = rec();
    useWorkspace.getState().setField("recommendation", ":acorr");
    expect(rec()).toBe(before);
    expect(useWorkspace.getState().isFinalized).toBe(true);
  });

  it("tags the expanded sentence as macro-authored, not as typing", () => {
    useWorkspace.getState().setField("recommendation", ":acorr");
    const prov = useWorkspace.getState().fieldProvenance.recommendation;
    expect(JSON.stringify(prov)).toContain("macro");
  });
});
