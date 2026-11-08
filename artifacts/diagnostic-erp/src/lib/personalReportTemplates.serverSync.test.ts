import { describe, expect, it } from "vitest";
import {
  mergePersonalTemplatesFromServer,
  personalTemplateFromServerRow,
  personalTemplateToServerBody,
  type PersonalReportTemplate,
  type PersonalTemplateServerRow,
} from "./personalReportTemplates";

const ROW = (over: Partial<PersonalTemplateServerRow> = {}): PersonalTemplateServerRow => ({
  id: 7,
  label: "Normal Chest XR",
  findingsText: "The lungs are clear.",
  insertTarget: "findings",
  modality: "XR",
  bodyPart: "Chest",
  createdAt: "2026-01-02T03:04:05.000Z",
  isActive: true,
  ...over,
});

/**
 * U6 pins — personal templates roam with the radiologist (radiology_snippets,
 * type = personal_template). They used to be workstation-local only, so a
 * library curated on reporting PC 1 was an empty rail on PC 2.
 */
describe("personal template server mapping (U6)", () => {
  it("maps a server row into the rail shape, namespacing the id", () => {
    const t = personalTemplateFromServerRow(ROW());
    expect(t.id).toBe("srv-7");
    expect(t.serverId).toBe(7);
    expect(t.name).toBe("Normal Chest XR");
    expect(t.text).toBe("The lungs are clear.");
    expect(t.target).toBe("findings");
    expect(t.modality).toBe("XR");
    expect(t.region).toBe("Chest");
  });

  it("maps impression-target rows and null findings honestly", () => {
    const t = personalTemplateFromServerRow(ROW({ insertTarget: "impression", findingsText: null, modality: null, bodyPart: null }));
    expect(t.target).toBe("impression");
    expect(t.text).toBe("");
    expect(t.modality).toBeUndefined();
    expect(t.region).toBeUndefined();
  });

  it("maps a rail template into a create/update body", () => {
    const body = personalTemplateToServerBody({
      id: "pt-1",
      name: "Kidneys normal",
      text: "Both kidneys are normal in size.",
      target: "findings",
      createdAt: "2026-01-01T00:00:00.000Z",
      modality: "US",
      region: "Abdomen",
    });
    expect(body).toEqual({
      type: "personal_template",
      label: "Kidneys normal",
      findingsText: "Both kidneys are normal in size.",
      insertTarget: "findings",
      modality: "US",
      bodyPart: "Abdomen",
    });
  });

  it("blank scope maps to null (all studies), not empty strings", () => {
    const body = personalTemplateToServerBody({
      id: "pt-2", name: "Global", text: "x", target: "impression", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(body.modality).toBeNull();
    expect(body.bodyPart).toBeNull();
    expect(body.insertTarget).toBe("impression");
  });
});

describe("mergePersonalTemplatesFromServer (U6 hydrate)", () => {
  const SEED: PersonalReportTemplate = {
    id: "seed-normal-chest-xr", name: "Normal Chest XR", text: "clear", target: "findings",
    createdAt: "1970-01-01T00:00:00.000Z", modality: "XR", region: "Chest",
  };
  const LOCAL_UNSYNCED: PersonalReportTemplate = {
    id: "pt-offline", name: "Made offline", text: "y", target: "findings", createdAt: "2026-02-02T00:00:00.000Z",
  };

  it("server rows are the roaming library; seeds and unsynced local rows survive", () => {
    const merged = mergePersonalTemplatesFromServer([ROW()], [SEED, LOCAL_UNSYNCED]);
    expect(merged.map((t) => t.id)).toEqual(["srv-7", "seed-normal-chest-xr", "pt-offline"]);
    expect(merged[0]!.serverId).toBe(7);
  });

  it("a local row whose serverId is gone from the server (deleted at another workstation) drops off", () => {
    const staleSynced: PersonalReportTemplate = { ...SEED, id: "srv-99", serverId: 99 };
    const merged = mergePersonalTemplatesFromServer([ROW()], [staleSynced]);
    expect(merged.some((t) => t.id === "srv-99")).toBe(false);
  });

  it("an empty server account still keeps the local working set (first login on a new PC shows seeds + offline rows)", () => {
    const merged = mergePersonalTemplatesFromServer([], [SEED, LOCAL_UNSYNCED]);
    expect(merged.map((t) => t.id)).toEqual(["seed-normal-chest-xr", "pt-offline"]);
  });
});
