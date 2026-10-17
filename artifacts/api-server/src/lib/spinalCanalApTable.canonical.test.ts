/**
 * The canal AP table must be built from the measurement the radiologist can SEE.
 *
 * Measured 2026-10-17 (docs/audits/spinal-canal-ap-measurement-audit-2026-10-17.md §6): the
 * Reporting Workspace grid writes the canonical record
 * (`structured_json.careCanalApProvenance`), while every printed canal table was built from
 * `spinal_measurements` — a store that grid never writes. Two authorities, nothing between them,
 * and the reachable one did not print. These cases pin the join:
 *
 *   - the canonical record decides the value; `spinal_measurements` still supplies levels that
 *     exist only there (legacy rows, the AI-tab box, drafts older than the record), so nothing
 *     that printed before stops printing;
 *   - when the canonical record DECLINES to answer for a level — an alias conflict or a
 *     renumbered vertebra — nothing prints for it, not even a stale row from the other store.
 *     The grid shows nothing in that cell either; a report that invented an answer would print a
 *     number the radiologist was told not to trust;
 *   - a transitional level (`L5-T`, `L5-L6`, `L6-S1`) is offered, saved and restored by the grid,
 *     so it must be printable. Before this, all three print paths iterated the fixed five/six/
 *     eleven lists and such a value was silently absent from every printed output;
 *   - the plain-text form exists because the structured (D1) signed body is plain text: one
 *     builder, two projections, so the two signed paths can never disagree on a number.
 */
import { describe, expect, it } from "vitest";
import {
  canalApLevelsFromCanonicalRecord,
  mergeCanalApLevels,
  renderCanalApTable,
  insertCanalTableIntoBody,
} from "./spinalCanalApTable";

/** A canonical record entry as the draft stores it: the caliper's number, the radiologist's
 *  number, and which one the report is to carry. */
const rec = (level: string, over: Record<string, unknown> = {}) => ({
  level,
  measurementId: "CANAL_AP",
  unit: "mm",
  region: level.startsWith("L") ? "lumbar" : level.startsWith("C") ? "cervical" : "dorsal",
  viewerValue: null,
  reportValue: null,
  manualOverride: false,
  annotationId: null,
  viewerMeasurementRowId: null,
  studyInstanceUID: null,
  seriesInstanceUID: null,
  sopInstanceUID: null,
  frameNumber: null,
  viewerName: null,
  capturedAt: null,
  verifiedAt: null,
  staleReason: null,
  aliasConflict: null,
  ...over,
});

describe("canal AP — the canonical record is the measurement authority", () => {
  it("reads a typed manual value out of the draft's canonical record", () => {
    const levels = canalApLevelsFromCanonicalRecord({
      "L4-L5": rec("L4-L5", { reportValue: 8.5, manualOverride: true }),
      "L5-S1": rec("L5-S1", { reportValue: 9.1, manualOverride: true }),
    });
    expect([...levels.entries()]).toEqual([
      ["L4-L5", "8.5"],
      ["L5-S1", "9.1"],
    ]);
  });

  it("carries the caliper's own number when the radiologist left it alone", () => {
    const levels = canalApLevelsFromCanonicalRecord({
      "L2-L3": rec("L2-L3", { viewerValue: 11.4 }),
    });
    expect(levels.get("L2-L3")).toBe("11.4");
  });

  it("reports the radiologist's override, never the caliper it overrode", () => {
    // One record, two numbers. The record's own rule (canalApValue) answers with reportValue;
    // a print path that chose viewerValue would sign a different measurement than the one shown.
    const levels = canalApLevelsFromCanonicalRecord({
      "L4-L5": rec("L4-L5", { viewerValue: 7.2, reportValue: 8.5, manualOverride: true }),
    });
    expect(levels.get("L4-L5")).toBe("8.5");
  });

  it("accepts an alias spelling and stores it under the canonical level", () => {
    // OHIF calipers and older drafts were authored "T8-T9"; the table row is D8-D9.
    const levels = canalApLevelsFromCanonicalRecord({
      "T8-T9": rec("D8-D9", { level: "T8-T9", region: "dorsal", reportValue: 12.6, manualOverride: true }),
    });
    expect([...levels.keys()]).toEqual(["D8-D9"]);
  });

  it("declines a level whose two aliases disagree, instead of picking one", () => {
    const levels = canalApLevelsFromCanonicalRecord({
      "T8-T9": rec("T8-T9", { region: "dorsal", reportValue: 12.6, manualOverride: true }),
      "D8-D9": rec("D8-D9", { region: "dorsal", reportValue: 14.1, manualOverride: true }),
    });
    expect(levels.has("D8-D9")).toBe(true);
    expect(levels.get("D8-D9")).toBeNull(); // present, and explicitly unanswered
  });

  it("declines a level whose vertebral numbering moved", () => {
    // The record is kept and flagged rather than renamed: relabelling it to whatever the new
    // numbering calls that position would move a number from one disc to another.
    const levels = canalApLevelsFromCanonicalRecord({
      "L5-S1": rec("L5-S1", { reportValue: 8.5, manualOverride: true, staleReason: "level_renumbered" }),
    });
    expect(levels.get("L5-S1")).toBeNull();
  });

  it("reads nothing from a column that is not a canal record", () => {
    for (const junk of [null, undefined, {}, [], "L4-L5", 7, { careObservationLedger: [] }]) {
      expect([...canalApLevelsFromCanonicalRecord(junk).entries()]).toEqual([]);
    }
  });
});

describe("canal AP — folding the two stores into the one table that prints", () => {
  it("keeps a level that exists only in spinal_measurements", () => {
    const merged = mergeCanalApLevels(
      new Map([["L3-L4", "15.2"], ["L4-L5", "7.2"]]),
      canalApLevelsFromCanonicalRecord({ "L4-L5": rec("L4-L5", { reportValue: 8.5, manualOverride: true }) }),
    );
    // L3-L4 came from the old store and must still print; L4-L5 is answered by the record.
    expect(merged.get("L3-L4")).toBe("15.2");
    expect(merged.get("L4-L5")).toBe("8.5");
  });

  it("suppresses a declined level's stale row rather than printing the other store's guess", () => {
    const merged = mergeCanalApLevels(
      new Map([["L4-L5", "7.2"]]),
      canalApLevelsFromCanonicalRecord({
        "L4-5": rec("L4-5", { reportValue: 8.5, manualOverride: true }),
        "L4-L5": rec("L4-L5", { reportValue: 9.4, manualOverride: true }),
      }),
    );
    expect(merged.has("L4-L5")).toBe(false);
  });

  it("is unchanged when the draft carries no canal record", () => {
    // The legacy page and the AI-tab box write spinal_measurements directly, with no draft
    // record beside them. Folding must be inert for them or their reports would lose numbers.
    const server = new Map([["L4-L5", "7.2"]]);
    expect([...mergeCanalApLevels(server, canalApLevelsFromCanonicalRecord(null)).entries()]).toEqual([
      ["L4-L5", "7.2"],
    ]);
  });
});

describe("canal AP — every level the study offers is printable", () => {
  it("prints a sacralised L5 (L5-T) instead of dropping it silently", () => {
    const table = renderCanalApTable(
      new Map([
        ["L4-L5", "10.2"],
        ["L5-T", "8.4"],
      ]),
    );
    expect(table).not.toBeNull();
    expect(table!.title).toContain("LUMBAR CANAL AP DIAMETER");
    expect(table!.html).toContain("L5-T");
    expect(table!.html).toContain("8.4");
    expect(table!.text).toContain("L5-T: 8.4");
    // The transitional row follows the last routine one, so the table reads head to tail.
    // Compared on the column headings, not anywhere in the markup: the title names both ends.
    expect(table!.html.indexOf(">L4-L5<")).toBeLessThan(table!.html.indexOf(">L5-T<"));
    expect(table!.title).toBe("LUMBAR CANAL AP DIAMETER AT L1-L2 TO L5-T LEVELS");
  });

  it("prints an extra lumbar segment (L5-L6, L6-S1) in anatomical order", () => {
    const table = renderCanalApTable(
      new Map([
        ["L4-L5", "10.2"],
        ["L6-S1", "9.8"],
        ["L5-L6", "11.1"],
      ]),
    );
    const text = table!.text;
    expect(text.indexOf("L5-L6: 11.1")).toBeLessThan(text.indexOf("L6-S1: 9.8"));
    expect(text.indexOf("L4-L5: 10.2")).toBeLessThan(text.indexOf("L5-L6: 11.1"));
  });

  it("prints the thoracolumbar junction level for a dorsal table", () => {
    const table = renderCanalApTable(new Map([["D12-L1", "9.3"], ["D11-D12", "10.7"]]));
    expect(table!.title).toContain("DORSAL CANAL AP DIAMETER");
    expect(table!.text).toContain("D11-D12: 10.7");
    expect(table!.text).toContain("D12-L1: 9.3");
  });

  it("escapes a stored value rather than trusting it", () => {
    const table = renderCanalApTable(new Map([["L4-L5", "8.5</td><td>99"]]));
    expect(table!.html).not.toContain("<td>99</td>");
    expect(table!.html).toContain("&lt;");
  });

  it("renders nothing when there is no level at all", () => {
    expect(renderCanalApTable(new Map())).toBeNull();
  });

  it("folds away an empty cell instead of printing it as a number", () => {
    const merged = mergeCanalApLevels(
      new Map([["L4-L5", "  "]]),
      canalApLevelsFromCanonicalRecord({ "L4-L5": rec("L4-L5", { reportValue: null, viewerValue: null }) }),
    );
    expect(merged.size).toBe(0);
    expect(renderCanalApTable(merged)).toBeNull();
  });
});

describe("canal AP — the plain-text form for the structured (D1) signed body", () => {
  const html = (v: string) =>
    `<div class="section-heading">Findings</div><p>${v}</p>` +
    `<div class="section-heading">Impression</div><p>Stenosis.</p>`;
  const text = "FINDINGS:\nLumbar canal assessed.\n\nIMPRESSION:\n1. Stenosis.";

  it("places the text block between Findings and Impression, like the table", () => {
    const block = renderCanalApTable(new Map([["L4-L5", "8.5"]]))!.text;
    const merged = insertCanalTableIntoBody(text, block);
    expect(merged.indexOf("CANAL AP DIAMETER")).toBeGreaterThan(merged.indexOf("FINDINGS"));
    expect(merged.indexOf("CANAL AP DIAMETER")).toBeLessThan(merged.indexOf("IMPRESSION"));
    expect(merged).toContain("L4-L5: 8.5");
  });

  it("never prints the table twice, in either body format", () => {
    const block = renderCanalApTable(new Map([["L4-L5", "8.5"]]))!;
    expect(insertCanalTableIntoBody(html("x"), block.html).match(/CANAL AP DIAMETER/g)).toHaveLength(1);
    expect(insertCanalTableIntoBody(text, block.text).match(/CANAL AP DIAMETER/g)).toHaveLength(1);
    // A body that already carries the table (a client that composed one) is returned untouched.
    expect(insertCanalTableIntoBody(html(block.html), block.html)).toBe(html(block.html));
  });

  it("appends to a body with no Impression heading and leaves an empty body empty", () => {
    const block = renderCanalApTable(new Map([["L4-L5", "8.5"]]))!.text;
    expect(insertCanalTableIntoBody("FINDINGS:\nOnly findings.", block)).toContain("CANAL AP DIAMETER");
    expect(insertCanalTableIntoBody("", "")).toBe("");
    expect(insertCanalTableIntoBody("FINDINGS:\nOnly findings.", "")).toBe("FINDINGS:\nOnly findings.");
  });

  it("leaves an HTML body byte-identical when there is nothing to add", () => {
    expect(insertCanalTableIntoBody(html("x"), "")).toBe(html("x"));
    expect(insertCanalTableIntoBody(text, "")).toBe(text);
  });
});
