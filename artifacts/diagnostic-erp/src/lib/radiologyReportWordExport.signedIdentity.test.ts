/**
 * The Word header of a SIGNED report must carry the identity the artifact prints.
 *
 * Measured on the acceptance rig: the same signed study produced a PDF headed
 * `NAME: SYNACCEPT ACASE16` and a Word file headed `NAME: SYNACCEPT ACASE32`, with
 * the same UHID on both. The exporter strips the demography lines from the print
 * HTML it was given (they would duplicate its own header) and then built that
 * header from the live patients master — a different authority from the one the
 * signed PDF renders, and one that changes whenever the master is edited after
 * signing. `demographyFromPrintHtml` reads the record's own lines back so the
 * caller can prefer them when a signing record exists.
 */
import { describe, expect, it } from "vitest";
import { demographyFromPrintHtml } from "./radiologyReportWordExport";

const LETTERPAD_ARTIFACT = `<html><body>
  <div class="ps-name">SYNACCEPT ACASE16</div>
  <div class="ps-line">NAME: SYNACCEPT ACASE16</div>
  <div class="ps-line">AGE/SEX: 46 / M</div>
  <div class="ps-line">UHID: SYNPCASE16</div>
  <div class="ps-line">REF. BY: Dr. Who Ordered It</div>
  <div class="ps-line">DATE: 30/10/2026</div>
  <div class="ps-line">ACCESSION: SYNACC16</div>
  <div class="section-heading">FINDINGS</div><p>Signed text.</p>
</body></html>`;

describe("demographyFromPrintHtml — the identity the artifact itself prints", () => {
  it("reads the letter-pad identity lines out of a signed print page", () => {
    expect(demographyFromPrintHtml(LETTERPAD_ARTIFACT)).toEqual({
      patientName: "SYNACCEPT ACASE16",
      age: "46",
      sex: "M",
      referringDoctor: "Dr. Who Ordered It",
      studyDate: "30/10/2026",
      uhid: "SYNPCASE16",
      accessionNumber: "SYNACC16",
    });
  });

  it("yields nothing for a page that prints no identity block, so the caller keeps its own values", () => {
    // A stacked template renders keyed rows rather than the letter-pad form. This
    // function deliberately recognises one shape only: inventing a fallback from
    // unrelated text would put words in the header the record never printed.
    const bare = `<html><body><div class="section-heading">FINDINGS</div><p>Nothing above.</p></body></html>`;
    expect(demographyFromPrintHtml(bare)).toEqual({
      patientName: undefined,
      age: undefined,
      sex: undefined,
      referringDoctor: undefined,
      studyDate: undefined,
      uhid: undefined,
      accessionNumber: undefined,
    });
  });

  it("is empty-safe on a null-ish input rather than throwing across the export door", () => {
    expect(demographyFromPrintHtml("").patientName).toBeUndefined();
    expect(demographyFromPrintHtml(undefined as unknown as string).accessionNumber).toBeUndefined();
  });

  it("does not confuse the report date for the examination date it was not", () => {
    // The print builder emits REPORT DATE and STUDY DATE as separate labelled rows;
    // only the letter-pad "DATE:" line is the examination date, and REPORT DATE is
    // never matched here.
    const withReportDate = `<p>REPORT DATE: 02/11/2026</p><p>NAME: X Y</p>`;
    const read = demographyFromPrintHtml(withReportDate);
    expect(read.patientName).toBe("X Y");
    expect(read.studyDate).toBeUndefined();
  });
});
