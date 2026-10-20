/**
 * The preview signer must come from configuration, not from a name.
 *
 * Every case here is a shape the clinic can actually reach from Report Hub →
 * Signatures. The one that motivated it is the last: a second radiologist adds their
 * own correctly configured block and, under the rule this replaces, still never
 * printed — the old selection was `/sugandha/i.test(name)`, which matches exactly one
 * human being and no configuration.
 */
import { describe, expect, it } from "vitest";
import { pickSignerRecord, printSigner, type SignerRecord } from "./reportSignerSelection";

function sig(over: Partial<SignerRecord> & { name: string }): SignerRecord {
  return {
    role: "Radiologist",
    qualification: "MD (Radiodiagnosis)",
    registrationNo: "1234/MMC",
    imageDataUrl: "data:image/png;base64,SIG",
    ...over,
  };
}

describe("pickSignerRecord", () => {
  it("returns null rather than inventing a person when nothing is configured", () => {
    expect(pickSignerRecord([])).toBeNull();
  });

  it("uses the single active block, whoever it belongs to", () => {
    const only = sig({ name: "Dr. Sugandha Priyadarshini" });
    expect(pickSignerRecord([only])).toBe(only);
  });

  it("prefers the block whose Role is Radiologist over one configured as Doctor", () => {
    const physician = sig({ name: "A. Doctor", role: "Doctor" });
    const radiologist = sig({ name: "Z. Radiologist", role: "Radiologist" });
    expect(pickSignerRecord([physician, radiologist])).toBe(radiologist);
  });

  it("breaks a tie in the order the Signatures list shows, not by name matching", () => {
    // Two Radiologist blocks: deterministic and explainable — alphabetical, which is
    // the order GET /api/signatures returns (isActive desc, name).
    const a = sig({ name: "Dr. Ananya Rao" });
    const b = sig({ name: "Dr. Bijoy Menon" });
    expect(pickSignerRecord([b, a])).toBe(a);
    expect(pickSignerRecord([a, b])).toBe(a);
  });

  it("falls back to the first block when no role is set to Radiologist", () => {
    const path = sig({ name: "Dr. Pathologist", role: "Pathologist" });
    const director = sig({ name: "E. Director", role: "Lab Director" });
    expect(pickSignerRecord([director, path])).toBe(path);
  });
});

describe("printSigner", () => {
  it("carries the four separate facts through unchanged", () => {
    const block = printSigner([sig({ name: "Dr. Sugandha Priyadarshini" })]);
    expect(block).toMatchObject({
      name: "Dr. Sugandha Priyadarshini",
      qualification: "MD (Radiodiagnosis)",
      role: "Radiologist",
      registrationNo: "1234/MMC",
      imageDataUrl: "data:image/png;base64,SIG",
    });
  });

  it("keeps the configured qualification ahead of the doctors catalogue", () => {
    // The catalogue used to win, so re-typing a qualification in Signatures settings
    // changed nothing on the page — the printed designation came from a name lookup.
    const block = printSigner(
      [sig({ name: "Dr. Sugandha Priyadarshini", qualification: "MD (Radiodiagnosis & Imaging)" })],
      () => "DNB (Radio)",
    );
    expect(block?.qualification).toBe("MD (Radiodiagnosis & Imaging)");
  });

  it("uses the catalogue only when the block has no qualification of its own", () => {
    const block = printSigner(
      [sig({ name: "Dr. Newcomer", qualification: "  " })],
      () => "MD (Radiodiagnosis)",
    );
    expect(block?.qualification).toBe("MD (Radiodiagnosis)");
  });

  it("prints no image when none was uploaded, and keeps the name and designation", () => {
    // A block saved before the image was required, or cleared: the person is still
    // the configured signer, and the absence of a hand-signed picture is left as
    // absence — nothing is drawn in its place.
    const block = printSigner([sig({ name: "Dr. Sugandha Priyadarshini", imageDataUrl: "" })]);
    expect(block?.imageDataUrl).toBeNull();
    expect(block?.name).toBe("Dr. Sugandha Priyadarshini");
    expect(block?.qualification).toBe("MD (Radiodiagnosis)");
  });

  it("gives a second radiologist their own configured block", () => {
    // The regression this module exists for. Under the previous rule the first
    // assertion held only because the name matched a literal, and the second could
    // never be true.
    const sugandha = sig({ name: "Dr. Sugandha Priyadarshini" });
    expect(printSigner([sugandha])?.name).toBe("Dr. Sugandha Priyadarshini");
    const newcomer = sig({ name: "Dr. Meera Iyer", qualification: "MD (Radiodiagnosis)", registrationNo: "9999/MMC" });
    expect(printSigner([newcomer])?.name).toBe("Dr. Meera Iyer");
    expect(printSigner([newcomer])?.registrationNo).toBe("9999/MMC");
  });

  it("returns null with no block, so the caller prints no signer at all", () => {
    expect(printSigner([], () => "MD (Radiodiagnosis)")).toBeNull();
  });
});
