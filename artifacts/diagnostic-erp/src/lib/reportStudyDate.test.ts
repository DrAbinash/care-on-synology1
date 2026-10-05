/**
 * The study date on a printed report.
 *
 * Three shapes reach these formatters, and all three are legitimate: the ERP sends
 * `2026-10-04`, DICOM sends `20261004`, and the Demography card at the top of the
 * Reporting Workspace is a free-text field that a radiologist fills in the way every
 * report he reads says it — `04/10/2026`. The short formatters strip non-digits and
 * slice, which is only correct for the first two. A typed date came out as
 * `26/20/0410`: month 20, year 0410.
 *
 * The workspace PDF and the signed document each have their own copy of this
 * formatter — deliberately, since one runs in the browser and one on the server — so
 * the parity case below is what keeps the two from drifting again.
 */
import { describe, expect, it } from "vitest";
import { formatReportDate, formatReportDateShort } from "../../../api-server/src/lib/reportPresentation";
import { formatReportDateShort as letterpadDateShort } from "./reportPdfGenerator";

/** What the ERP's letter-pad PDF and the server's signed document must both say. */
const CASES: Array<{ input: string; short: string; long: string }> = [
  { input: "2026-10-04", short: "04/10/2026", long: "Sunday, October 4, 2026" },
  { input: "20261004", short: "04/10/2026", long: "Sunday, October 4, 2026" },
  { input: "2026-10-04T00:00:00.000Z", short: "04/10/2026", long: "Sunday, October 4, 2026" },
  // Already DD/MM/YYYY — the shape the report itself displays and the Demography
  // card accepts. Re-slicing this is what produced "26/20/0410".
  { input: "04/10/2026", short: "04/10/2026", long: "Sunday, October 4, 2026" },
  { input: "4/10/2026", short: "04/10/2026", long: "Sunday, October 4, 2026" },
  // Day 13 cannot be a month, so an unambiguous read must not be reordered.
  { input: "13/04/2026", short: "13/04/2026", long: "Monday, April 13, 2026" },
  // Ambiguous as a date but never as text he typed: read as day first, print as written.
  { input: "02/03/2026", short: "02/03/2026", long: "Monday, March 2, 2026" },
  { input: "31/12/2025", short: "31/12/2025", long: "Wednesday, December 31, 2025" },
];

describe("the study date a report prints", () => {
  it("reads ISO, DICOM and typed DD/MM/YYYY as the same day", () => {
    for (const c of CASES) {
      expect(letterpadDateShort(c.input), `letter-pad PDF for ${c.input}`).toBe(c.short);
      expect(formatReportDateShort(c.input), `signed document for ${c.input}`).toBe(c.short);
    }
  });

  it("never prints an impossible month or year", () => {
    for (const c of CASES) {
      const out = letterpadDateShort(c.input);
      const m = out.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      expect(m, `${c.input} printed "${out}", which is not DD/MM/YYYY`).not.toBeNull();
      const [, dd, mm, yyyy] = m!;
      expect(Number(mm), `${c.input} → month ${mm}`).toBeGreaterThanOrEqual(1);
      expect(Number(mm), `${c.input} → month ${mm}`).toBeLessThanOrEqual(12);
      expect(Number(dd), `${c.input} → day ${dd}`).toBeGreaterThanOrEqual(1);
      expect(Number(yyyy), `${c.input} → year ${yyyy}`).toBeGreaterThanOrEqual(1900);
    }
  });

  it("spells the long date the referring clinician reads", () => {
    for (const c of CASES) {
      expect(formatReportDate(c.input), `long form for ${c.input}`).toBe(c.long);
    }
  });

  it("leaves what it cannot read alone rather than guessing", () => {
    for (const junk of ["", "   ", "not a date", "1234", "04/10/26"]) {
      expect(letterpadDateShort(junk)).toBe(junk.trim());
      expect(formatReportDateShort(junk)).toBe(junk.trim());
    }
    expect(letterpadDateShort(null)).toBe("");
    expect(letterpadDateShort(undefined)).toBe("");
    expect(formatReportDate(null)).toBe("");
  });

  it("keeps a real calendar date real", () => {
    // 31 April does not exist. Neither formatter may invent it.
    expect(letterpadDateShort("31/04/2026")).toBe("31/04/2026");
    expect(formatReportDate("31/04/2026")).not.toContain("May");
  });
});

describe("the two copies of the short formatter", () => {
  it("agree on every input the workspace can hand them", () => {
    const inputs = [
      ...CASES.map((c) => c.input),
      "", "   ", "not a date", "1234", "04/10/26", "2026/10/04", "04-10-2026",
      "2026-10-04T18:30:00.000Z", "31/04/2026", "0/10/2026", "2026-13-45",
    ];
    for (const input of inputs) {
      expect(letterpadDateShort(input), `the two formatters disagree on "${input}"`)
        .toBe(formatReportDateShort(input));
    }
  });
});
