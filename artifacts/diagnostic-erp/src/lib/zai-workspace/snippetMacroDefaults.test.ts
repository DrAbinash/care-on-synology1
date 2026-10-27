import { describe, expect, it } from "vitest";
import { matchStudyRegion } from "@/lib/studyRegion";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { DEFAULT_SNIPPET_MACROS, expandMacro, lookupMacrosForContext } from "./snippet-macros-library";

const REGIONS = ["Brain", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine", "Spine"];

function resolve(modality: string, description: string): ReportingStudyContext {
  const auto = matchStudyRegion(`${modality} ${description}`, REGIONS);
  return buildReportingStudyContext({
    modality,
    studyDescription: description,
    regions: auto ? [auto] : [],
    source: auto ? "auto" : "unresolved",
  });
}

const triggersFor = (ctx: ReportingStudyContext) =>
  lookupMacrosForContext(DEFAULT_SNIPPET_MACROS, "MR", ctx).map((m) => m.trigger);

const byTrigger = (trigger: string) => {
  const found = DEFAULT_SNIPPET_MACROS.find((m) => m.trigger === trigger);
  if (!found) throw new Error(`no built-in macro with trigger "${trigger}"`);
  return found;
};

describe("built-in snippet macros", () => {
  it("every trigger is one lowercase word and no two collide", () => {
    const problems: string[] = [];
    const seen = new Map<string, string>();
    for (const macro of DEFAULT_SNIPPET_MACROS) {
      if (!/^[a-z][a-z0-9_]*$/.test(macro.trigger)) problems.push(`${macro.trigger}: not a single lowercase word`);
      const key = macro.trigger.toLowerCase();
      if (seen.has(key)) problems.push(`${macro.trigger}: collides with ${seen.get(key)}`);
      seen.set(key, macro.trigger);
    }
    expect(problems).toEqual([]);
  });

  it("template placeholders and declared variables agree in both directions", () => {
    const problems: string[] = [];
    for (const macro of DEFAULT_SNIPPET_MACROS) {
      const declared = new Set(macro.variables.map((v) => v.name));
      const used = [...macro.template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
      for (const u of used) if (!declared.has(u)) problems.push(`${macro.trigger}: "{${u}}" has no declared variable`);
      for (const d of declared) if (!used.includes(d)) problems.push(`${macro.trigger}: variable "${d}" is never used in the template`);
    }
    expect(problems).toEqual([]);
  });

  it("expanding with the declared defaults leaves no unresolved placeholder", () => {
    const problems: string[] = [];
    for (const macro of DEFAULT_SNIPPET_MACROS) {
      const out = expandMacro(macro, {});
      if (/\{[a-zA-Z0-9_]+\}/.test(out)) problems.push(`${macro.trigger}: left ${out.match(/\{[a-zA-Z0-9_]+\}/)?.[0]}`);
      if (out.trim().length === 0) problems.push(`${macro.trigger}: expanded to nothing`);
    }
    expect(problems).toEqual([]);
  });

  it("every choice list contains its own default", () => {
    const problems: string[] = [];
    for (const macro of DEFAULT_SNIPPET_MACROS) {
      for (const v of macro.variables) {
        if (v.options?.length && !v.options.includes(v.default ?? "")) {
          problems.push(`${macro.trigger}.${v.name}: default "${v.default}" is not one of the offered choices`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("reaches an MRI Brain study, findings and closers both", () => {
    const t = triggersFor(resolve("MR", "MRI Brain Plain"));
    expect(["bmass", "bdiff", "bhydro", "bdemyel", "bmicro", "acorr", "alab", "aneuro"].filter((c) => !t.includes(c))).toEqual([]);
  });

  it("keeps brain findings out of a spine study but lets the closers through", () => {
    const t = triggersFor(resolve("MR", "MRI LS Spine"));
    expect(["bmass", "bdiff", "bhydro", "bdemyel", "bmicro"].filter((c) => t.includes(c))).toEqual([]);
    expect(["acorr", "afollow", "ascreen", "amrs", "actcor", "alab", "aneuro"].filter((c) => !t.includes(c))).toEqual([]);
  });

  it("a spine macro cannot leak into a brain study", () => {
    expect(triggersFor(resolve("MR", "MRI Brain Plain"))).not.toContain("discbulge");
  });

  it("inserts the clinic's own wording when the defaults are taken", () => {
    expect(expandMacro(byTrigger("acorr"), {})).toBe("Clinico-pathological correlation is advised.");
    expect(expandMacro(byTrigger("amrs"), {})).toBe("MR spectroscopy may be considered for further imaging characterisation.");
    expect(expandMacro(byTrigger("actcor"), {})).toBe("CT may be considered to evaluate for calcification or bony detail.");
    expect(expandMacro(byTrigger("ascreen"), {})).toBe("Contrast-enhanced MRI screening of the whole spine is suggested.");
    expect(expandMacro(byTrigger("aneuro"), {})).toBe("The findings should be correlated with the neurological examination.");
    expect(expandMacro(byTrigger("alab"), {})).toBe("Clinical and laboratory correlation is advised.");
    expect(expandMacro(byTrigger("afollow"), {})).toBe("Short-interval follow-up MRI is advised to assess for stability.");
    expect(expandMacro(byTrigger("bmicro"), {})).toBe(
      "Symmetrical susceptibility-weighted blooming is seen in the bilateral basal ganglia, suggestive of mineral deposition.",
    );
    expect(expandMacro(byTrigger("bhydro"), {})).toBe(
      "Dilatation of the ventricular system out of proportion to the sulcal spaces, suggestive of communicating hydrocephalus.",
    );
  });
});
