/**
 * Item 5, the two rules that decide whether a corrected bill may move a booked
 * examination. Pure — no DB, no clock — because both are safety rules and a
 * safety rule that only fires inside a transaction is a rule nothing proves.
 */
import { describe, expect, it } from "vitest";
import { studyDescriptionIsDerived, studySwapSyncBlock } from "./studyTestSwapRules";

const SCHEDULED = {
  status: "scheduled",
  startedAt: null,
  acquiredAt: null,
  deliveredAt: null,
  studyInstanceUid: null,
  numImages: 0,
};

describe("studySwapSyncBlock — a swap may follow a booking, never an acquisition", () => {
  it("lets a booked, untouched study follow the bill", () => {
    expect(studySwapSyncBlock(SCHEDULED)).toBeNull();
  });

  it("refuses once the examination has been started", () => {
    expect(studySwapSyncBlock({ ...SCHEDULED, startedAt: new Date() })).toBe("acquired");
  });

  it("refuses once images exist, even with no timestamps", () => {
    // The PACS echo sets study_instance_uid and num_images from the C-STORE
    // side; a technician can acquire without the ERP status ever advancing.
    expect(studySwapSyncBlock({ ...SCHEDULED, numImages: 12 })).toBe("acquired");
    expect(studySwapSyncBlock({ ...SCHEDULED, studyInstanceUid: "1.2.826.0.1.3680043.2.1" })).toBe(
      "acquired",
    );
    expect(studySwapSyncBlock({ ...SCHEDULED, studyInstanceUid: "   " })).toBeNull();
  });

  it("refuses a delivered study as closed, not as acquired", () => {
    // `delivered` is terminal for the worklist rules too, and the desk needs the
    // two reasons told apart: one says the report is gone, the other says the
    // patient was scanned.
    expect(studySwapSyncBlock({ ...SCHEDULED, status: "delivered" })).toBe("terminal");
    expect(studySwapSyncBlock({ ...SCHEDULED, status: "cancelled" })).toBe("terminal");
    expect(studySwapSyncBlock({ ...SCHEDULED, status: "CANCELLED" })).toBe("terminal");
  });

  it("treats a missing study row as nothing to block", () => {
    // A lab test swapped in has no study at all; the caller decides whether one
    // should be created, and must not be told it is protected.
    expect(studySwapSyncBlock(null)).toBeNull();
    expect(studySwapSyncBlock(undefined)).toBeNull();
  });
});

describe("studyDescriptionIsDerived — only the fan-out's own copy is replaced", () => {
  it("recognises the billed test's name as derived", () => {
    expect(studyDescriptionIsDerived("USG Abdomen", "USG Abdomen")).toBe(true);
    // The study row and the catalog row are compared case- and space-folded:
    // the fan-out writes the name it read, which is not always how it is stored.
    expect(studyDescriptionIsDerived("usg  abdomen ", "USG Abdomen")).toBe(true);
  });

  it("treats an empty description as derived", () => {
    expect(studyDescriptionIsDerived(null, "USG Abdomen")).toBe(true);
    expect(studyDescriptionIsDerived("", "USG Abdomen")).toBe(true);
    expect(studyDescriptionIsDerived("   ", "USG Abdomen")).toBe(true);
  });

  it("leaves a description somebody typed on its own", () => {
    // The clerk's bill-level string is the one thing the study row carries that
    // the catalog did not produce. Replacing it silently is the item-24 failure
    // mode — synchronization overwriting manual authorship.
    expect(studyDescriptionIsDerived("RUQ pain, rule out cholelithiasis", "USG Abdomen")).toBe(false);
    // A description naming the NEW test is not derived from the old one either:
    // re-running the swap must not decide the row was hand-typed... unless it
    // was, which is why the comparison is against the old name only.
    expect(studyDescriptionIsDerived("X-Ray Chest PA", "USG Abdomen")).toBe(false);
  });

  it("does not call an unknown old name derived", () => {
    // A study whose test row is gone (a catalog delete) has no baseline to
    // compare against, so its description is manual by default.
    expect(studyDescriptionIsDerived("USG Abdomen", null)).toBe(false);
    expect(studyDescriptionIsDerived(null, null)).toBe(true);
  });
});
