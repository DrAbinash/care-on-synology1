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
 *   Normals reach that page from two libraries, so the guard reads both: the
 *   Report Formats the picker offers, and the owned baseline manifests that
 *   materialise when one of them is chosen — the per-level rows exist only in the
 *   second, which is where the compression sentences actually live.
 *
 *   An abnormal Quick Select line must come out bold. The editor colours what a
 *   box contributed; if the print does not emphasise the same line, the two
 *   halves of the feature disagree. The census takes `abnormal` and `critical`
 *   tiles for MR/CT/XR, and lists every miss by label and sentence.
 */
import { describe, expect, it } from "vitest";
import { isAbnormalFindingsLine } from "./abnormalEmphasis";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { ownedBaselineCatalog } from "./zai-workspace/baselines";

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

  it("bolds no line of any shipped owned baseline normal", () => {
    // The one-click normal page is assembled from these manifests, not from the
    // format's own findings string, so the guard above cannot see the per-level
    // rows — every "No spinal canal or thecal sac compression is seen." in the
    // product lives here and nowhere else.
    const offenders: string[] = [];
    let lines = 0;
    for (const baseline of ownedBaselineCatalog()) {
      for (const line of [...documentLines(baseline.findings), ...documentLines(baseline.impression)]) {
        lines++;
        if (isAbnormalFindingsLine(line)) offenders.push(`${baseline.name} :: ${line}`);
      }
    }
    expect(lines).toBeGreaterThan(100);
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
      // `critical` joined `abnormal` here on 2026-10-11, with the cervical
      // catalogue: cord compression, an epidural collection and a fracture are
      // the lines that must not print in plain type, and the census skipped every
      // one of them. A tile the guard cannot see is a tile nobody checks.
      if (tile.category !== "abnormal" && tile.category !== "critical") continue;
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
      // The six shipped word orders that `compress`, `kyphos`, `syrinx`, `ossif`,
      // `instabilit` and `myelomalaci` now depend on. They are pinned here, and not
      // only by the catalog scan above, because the cancel is positional: the
      // denial has to sit before the cue in the same sentence. Reorder one of these
      // to put the cue first — "Thoracic kyphosis is normal." — and the classifier
      // bolds a normal while the catalog scan may never reach that sentence.
      "Normal thoracic kyphosis is maintained.",
      "C5-C6: No spinal canal or thecal sac compression is seen.",
      "C5-C6: No exiting or traversing nerve root compression is seen.",
      "Normal MRI of the cervical spine. No significant disc, canal, foraminal or cord compressive abnormality.",
      "No gross cord compression is seen.",
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
