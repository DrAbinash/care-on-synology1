/**
 * The printed half of the editor's abnormal colour.
 *
 * Two invariants, both measured against the shipped libraries rather than
 * invented here, because the failure each guards is clinical and visible:
 *
 *   A normal report must not come out bold. The one-click normal baseline is the
 *   page the radiologist scans and prints without reading; the first version of
 *   this classifier bolded 124 lines across the library, including every
 *   "No gross disc herniation, canal stenosis or cord compression" screening
 *   impression and a normal obstetric findings block over the words "grade II".
 *
 *   An abnormal Quick Select line must come out bold. The editor colours what a
 *   box contributed; if the print does not emphasise the same line, the two
 *   halves of the feature disagree and 18 of the 31 abnormal tiles were silent.
 */
import { describe, expect, it } from "vitest";
import { isAbnormalFindingsLine } from "./abnormalEmphasis";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";

function documentLines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

describe("abnormal print emphasis — library guards", () => {
  it("bolds no line of any shipped normal report", () => {
    const offenders: string[] = [];
    for (const format of DEFAULT_REPORT_FORMATS.filter((f) => /normal/i.test(f.name))) {
      for (const line of [...documentLines(format.findings), ...documentLines(format.impression)]) {
        if (isAbnormalFindingsLine(line)) offenders.push(`${format.name} :: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bolds every abnormal Quick Select line the workspace can show", () => {
    const missed: string[] = [];
    let checked = 0;
    const tiles = DEFAULT_QUICK_SELECT_TILES as unknown as Array<{
      label: string;
      sentence: string;
      category?: string;
      scopeModality?: string;
    }>;
    for (const tile of tiles) {
      if (tile.category !== "abnormal") continue;
      if (!["MR", "CT", "XR"].includes((tile.scopeModality ?? "").toUpperCase())) continue;
      checked++;
      if (!isAbnormalFindingsLine(tile.sentence)) missed.push(`${tile.label} :: ${tile.sentence}`);
    }
    // Guard against the guard going vacuous: this workspace really does carry
    // abnormal tiles, so a library change that empties it must fail here.
    expect(checked).toBeGreaterThan(20);
    expect(missed).toEqual([]);
  });
});

describe("abnormal print emphasis — the reading itself", () => {
  it("bolds a level's abnormal sentence, label included", () => {
    expect(isAbnormalFindingsLine(
      "L4-L5: Broad-based disc bulge with posterocentral protrusion.",
    )).toBe(true);
    expect(isAbnormalFindingsLine("Mild canal stenosis L4-L5.")).toBe(true);
    expect(isAbnormalFindingsLine("Acute infarct in the left MCA territory.")).toBe(true);
  });

  it("never bolds a denial, however many cues it carries", () => {
    for (const line of [
      "No significant central canal stenosis.",
      "Thecal sac of adequate calibre with no significant central canal stenosis.",
      "L1-L2: Normal disc height and signal. No disc herniation. Neural foramen patent.",
      // The case a fixed 40-character window got wrong: the denial is 30+
      // characters back from "stenosis" and 50+ from "compression".
      "Normal MRI cervical spine screening. No gross disc herniation, canal stenosis or cord compression.",
      "No abnormal enhancement or space-occupying lesion.",
    ]) {
      expect(isAbnormalFindingsLine(line), line).toBe(false);
    }
  });

  it("judges each sentence on its own", () => {
    expect(isAbnormalFindingsLine(
      "No significant disc bulge. Early disc desiccation is seen at L4-L5.",
    )).toBe(true);
  });

  it("leaves headings, table rows and short tokens alone", () => {
    for (const line of [
      "Disc Level Analysis:",
      "ALIGNMENT",
      "| L4-L5 | Disc bulge | 9 |",
      "## Canal",
      "Normal.",
      "—",
      "",
    ]) {
      expect(isAbnormalFindingsLine(line), line).toBe(false);
    }
  });

  it("treats an examination description as normal and a derived word as itself", () => {
    // "Cortical echogenicity is normal." once bolded a normal abdominal report
    // because the stem "echogenic" matched inside "echogenicity".
    expect(isAbnormalFindingsLine("Cortical echogenicity is normal.")).toBe(false);
    expect(isAbnormalFindingsLine("Both kidneys are normal in size and cortical thickness.")).toBe(false);
    expect(isAbnormalFindingsLine("Placenta is posterior, fundal, grade II.")).toBe(false);
  });
});
