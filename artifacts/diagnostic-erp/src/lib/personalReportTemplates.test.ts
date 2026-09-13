import { describe, expect, it } from "vitest";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  PERSONAL_TEMPLATES_STORAGE_KEY,
  appendPersonalTemplate,
  createPersonalTemplate,
  filterPersonalTemplatesForStudy,
  insertTemplateText,
  isGlobalPersonalTemplate,
  personalTemplateScopeLabel,
  readPersonalReportTemplates,
  removePersonalTemplate,
  writePersonalReportTemplates,
  type PersonalReportTemplate,
} from "./personalReportTemplates";

function memStorage() {
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    mem,
  };
}

describe("personalReportTemplates storage", () => {
  it("seeds defaults when storage is empty", () => {
    const storage = memStorage();
    const seeded = readPersonalReportTemplates(storage);
    expect(seeded.some((t) => t.name === "Normal Chest XR")).toBe(true);
    expect(seeded.some((t) => t.name === "CT Brain Normal")).toBe(true);
    expect(seeded.find((t) => t.name === "Normal Chest XR")?.modality).toBe("XR");
    expect(seeded.find((t) => t.name === "CT Brain Normal")?.region).toBe("Brain");
  });

  it("persists physician-saved templates with study tags", () => {
    const storage = memStorage();
    const created = createPersonalTemplate({
      name: "My Normal",
      text: "Unremarkable study.",
      target: "impression",
      modality: "CT",
      region: "Brain",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    writePersonalReportTemplates(storage, [created]);
    expect(storage.mem.get(PERSONAL_TEMPLATES_STORAGE_KEY)).toContain("My Normal");
    const roundTrip = readPersonalReportTemplates(storage);
    expect(roundTrip).toHaveLength(1);
    expect(roundTrip[0]?.name).toBe("My Normal");
    expect(roundTrip[0]?.modality).toBe("CT");
    expect(roundTrip[0]?.region).toBe("Brain");
  });

  it("appends, removes, and inserts text", () => {
    const a = createPersonalTemplate({ name: "A", text: "aaa", target: "findings" });
    const b = createPersonalTemplate({ name: "B", text: "bbb", target: "findings" });
    const list = appendPersonalTemplate([a], b);
    expect(list[0]?.id).toBe(b.id);
    expect(removePersonalTemplate(list, b.id)).toEqual([a]);
    expect(insertTemplateText("", "Hello")).toBe("Hello");
    expect(insertTemplateText("Prior.", "Hello")).toBe("Prior.\n\nHello");
  });
});

describe("filterPersonalTemplatesForStudy", () => {
  const chestXr: PersonalReportTemplate = {
    id: "chest",
    name: "Normal Chest XR",
    text: "clear lungs",
    target: "findings",
    createdAt: "2020-01-01T00:00:00.000Z",
    modality: "XR",
    region: "Chest",
  };
  const ctBrain: PersonalReportTemplate = {
    id: "brain",
    name: "CT Brain Normal",
    text: "no bleed",
    target: "findings",
    createdAt: "2020-01-02T00:00:00.000Z",
    modality: "CT",
    region: "Brain",
  };
  const globalTpl: PersonalReportTemplate = {
    id: "global",
    name: "Generic disclaimer",
    text: "Clinical correlation advised.",
    target: "impression",
    createdAt: "2020-01-03T00:00:00.000Z",
  };
  const all = [chestXr, ctBrain, globalTpl];

  it("shows everything when no study context", () => {
    expect(filterPersonalTemplatesForStudy(all, null)).toEqual(all);
  });

  it("keeps matching modality/region plus globals", () => {
    const ctx = buildReportingStudyContext({
      modality: "XR",
      regions: ["Chest"],
      source: "auto",
    });
    const filtered = filterPersonalTemplatesForStudy(all, ctx);
    expect(filtered.map((t) => t.id).sort()).toEqual(["chest", "global"]);
  });

  it("matches MR ≡ MRI via catalog normalization", () => {
    const mrBrain: PersonalReportTemplate = {
      ...ctBrain,
      id: "mr-brain",
      name: "MRI Brain Normal",
      modality: "MRI",
      region: "Brain",
    };
    const ctx = buildReportingStudyContext({
      modality: "MR",
      regions: ["Brain"],
      source: "auto",
    });
    const filtered = filterPersonalTemplatesForStudy([mrBrain, chestXr, globalTpl], ctx);
    expect(filtered.map((t) => t.id).sort()).toEqual(["global", "mr-brain"]);
  });

  it("falls soft to full library when nothing matches", () => {
    const foreignOnly = [ctBrain, chestXr];
    const ctx = buildReportingStudyContext({
      modality: "NM",
      regions: ["Thyroid"],
      source: "auto",
    });
    expect(filterPersonalTemplatesForStudy(foreignOnly, ctx)).toEqual(foreignOnly);
  });

  it("labels scope chips", () => {
    expect(personalTemplateScopeLabel(globalTpl)).toBe("All studies");
    expect(personalTemplateScopeLabel(ctBrain)).toBe("CT · Brain");
    expect(isGlobalPersonalTemplate(globalTpl)).toBe(true);
    expect(isGlobalPersonalTemplate(chestXr)).toBe(false);
  });
});
