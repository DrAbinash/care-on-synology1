import { describe, expect, it } from "vitest";

import {
  nameSetsAgree,
  pickUhidMatchedPatient,
  uhidLookupCandidates,
} from "./dicomPatientCreatorPure";

const row = (firstName: string, lastName: string) => ({ firstName, lastName });

describe("uhidLookupCandidates", () => {
  it("offers the prefixed form a console cannot type", () => {
    expect(uhidLookupCandidates("12332")).toContain("P-12332");
  });

  it("offers the bare digits the requisition slip is printed with", () => {
    expect(uhidLookupCandidates("P-12332")).toContain("12332");
  });

  it("bridges zero-padding in both directions", () => {
    expect(uhidLookupCandidates("123")).toContain("P-00123");
    expect(uhidLookupCandidates("P-00123")).toContain("123");
  });

  it("keeps a non-numeric scanner id to its own spellings", () => {
    expect(uhidLookupCandidates("E42561-26-10-31-114")).toEqual([
      "E42561-26-10-31-114",
      "P-E42561-26-10-31-114",
    ]);
  });

  it("never yields a candidate for an absent id", () => {
    expect(uhidLookupCandidates("")).toEqual([]);
    expect(uhidLookupCandidates(null)).toEqual([]);
    expect(uhidLookupCandidates(undefined)).toEqual([]);
  });
});

describe("nameSetsAgree", () => {
  it("is not confused by the Last^First flattening", () => {
    expect(nameSetsAgree("DAS MAHBOOB", "Mahboob Das")).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(nameSetsAgree("Ansari Rabina", "RABINA, ANSARI")).toBe(true);
  });

  it("refuses an abbreviation claiming a longer name", () => {
    expect(nameSetsAgree("Reena", "Reena Kumari")).toBe(false);
  });

  it("refuses a name that shares only one word", () => {
    expect(nameSetsAgree("Pappu Singh", "Pappu Kumar")).toBe(false);
  });

  it("refuses the placeholder patients left by the old intake", () => {
    expect(nameSetsAgree("Unknown", "Unknown")).toBe(false);
    expect(nameSetsAgree("UNKNOWN Khatoon", "Unknown Khatoon")).toBe(false);
  });

  it("refuses when either side is empty", () => {
    expect(nameSetsAgree("", "Reena Kumari")).toBe(false);
    expect(nameSetsAgree("Reena Kumari", null)).toBe(false);
  });
});

describe("pickUhidMatchedPatient", () => {
  it("accepts the one patient whose number and name both agree", () => {
    const rows = [row("Mahboob", "Das")];
    expect(pickUhidMatchedPatient(rows, "DAS MAHBOOB")).toBe(rows[0]);
  });

  it("refuses a number that belongs to a different name", () => {
    // 1,010 of the 1,725 number-hits disagreed on the name, and only 202 of
    // those were billed that day: these are other consoles' numbers landing on
    // a real UHID by coincidence.
    expect(pickUhidMatchedPatient([row("Neha", "Kumari")], "Subhash Turi")).toBeNull();
  });

  it("refuses when two patients carry one of the candidate spellings", () => {
    const rows = [row("Puja", "Kumari"), row("Pooja", "Kumari")];
    expect(pickUhidMatchedPatient(rows, "Puja Kumari")).toBeNull();
  });

  it("refuses when nothing matched", () => {
    expect(pickUhidMatchedPatient([], "Puja Kumari")).toBeNull();
  });
});
