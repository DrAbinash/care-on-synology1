import { describe, it, expect } from "vitest";
import { generateUsgFinding } from "./usgFindingBuilder";
import { findingDefById, organByKey } from "./usgOrganLibrary";
import { emptySection, markNormal, addFinding, setOrganStatus, composeImpression, type UsgOrganSection } from "./usgReportComposer";
import { computeReadiness } from "./usgReadiness";

const renalDef = findingDefById("renal_calculus")!;
const EXPECTED = ["liver", "gallbladder", "right_kidney", "left_kidney"];

function sec(key: string): UsgOrganSection {
  return emptySection(key, organByKey(key)?.label ?? key);
}

describe("P2.1 readiness", () => {
  it("0% when nothing reviewed; lists each expected organ", () => {
    const r = computeReadiness({ sections: EXPECTED.map(sec), expectedOrganKeys: EXPECTED, impressionLines: [] });
    expect(r.percent).toBe(0);
    expect(r.items.filter((i) => i.code === "organ_not_reviewed").length).toBe(4);
  });

  it("percent reflects reviewed organs", () => {
    const sections = EXPECTED.map((k) => (k === "liver" ? markNormal(sec("liver"), "Liver normal.") : sec(k)));
    const r = computeReadiness({ sections, expectedOrganKeys: EXPECTED, impressionLines: [] });
    expect(r.percent).toBe(25); // 1 of 4
    expect(r.reviewedOrgans).toBe(1);
  });

  it("100% when all organs reviewed and consistent", () => {
    const rk = addFinding(sec("right_kidney"), generateUsgFinding(renalDef, { side: "Right", location: "Lower calyx", number: "Single", size: "5", hydronephrosis: "None" }).object);
    const sections = [
      markNormal(sec("liver"), "Liver normal."),
      markNormal(sec("gallbladder"), "GB normal."),
      rk,
      setOrganStatus(sec("left_kidney"), "normal", "Left kidney normal."),
    ];
    const r = computeReadiness({ sections, expectedOrganKeys: EXPECTED, impressionLines: composeImpression(sections) });
    expect(r.percent).toBe(100);
    expect(r.items.filter((i) => i.code === "organ_not_reviewed")).toEqual([]);
  });

  it("surfaces pending/unreconciled measurements and PCPNDT block", () => {
    const r = computeReadiness({
      sections: EXPECTED.map(sec), expectedOrganKeys: EXPECTED, impressionLines: [],
      measurementsPending: 3, measurementsUnreconciled: 1,
      pcpndt: { applicable: true, compliant: false },
    });
    expect(r.items.some((i) => i.code === "measurements_pending")).toBe(true);
    expect(r.items.some((i) => i.code === "measurements_unreconciled")).toBe(true);
    expect(r.pcpndtBlocking).toBe(true);
  });

  it("PCPNDT compliant is informational, not blocking", () => {
    const r = computeReadiness({ sections: EXPECTED.map(sec), expectedOrganKeys: EXPECTED, impressionLines: [], pcpndt: { applicable: true, compliant: true } });
    expect(r.pcpndtBlocking).toBe(false);
    expect(r.items.some((i) => i.code === "pcpndt_ok")).toBe(true);
  });
});
