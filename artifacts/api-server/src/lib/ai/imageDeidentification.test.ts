/**
 * imageDeidentification.test.ts — can a pixel leave the clinic?
 *
 * Synthetic data only. No cloud call, no real patient, no model: the local OCR
 * runner is injected, which is also how a deployment without a vision model
 * behaves — it gets `not_verified`, and `not_verified` blocks.
 *
 * The interesting assertions are the fail-closed ones. A gate that returns
 * "clean" when its own checker was asleep is the failure mode that would make
 * the whole control decorative, so several tests below are specifically about
 * the checker not attesting.
 */
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// This module borrows one pure regex function from @workspace/ai-providers, whose
// package entry opens a Postgres pool at import time. The gate itself touches no
// database, so the established repo pattern applies: mock the db module rather
// than provision one. The catch-all Proxy means any table a re-exported sibling
// imports at module scope resolves without listing them.
vi.mock("@workspace/db", () => {
  const dummy: Record<string, unknown> = {};
  const proxy = new Proxy(dummy, {
    get: (t, k: string) => (k in t ? t[k] : (t[k] = { __table: k, __isMock: true })),
  });
  return { db: { select: () => proxy }, ...proxy };
});

import {
  deidentifyImageForCloudEgress,
  deidentifyImagesForCloudEgress,
  matchBurnedInIdentifiers,
  type LocalOcrAttestation,
  type PatientIdentifiers,
} from "./imageDeidentification";

const PATIENT: PatientIdentifiers = {
  patientName: "Abhinash Singh",
  firstName: "Abhinash",
  lastName: "Singh",
  dateOfBirth: "1980-04-12",
  mrn: "MRN-44771",
  accessionNumber: "ACC-2026-0091",
  patientId: "PID-8812",
};

async function jpegWith(text: string | null): Promise<string> {
  const img = sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 250, g: 250, b: 250 } },
  }).jpeg({ quality: 85 });
  if (text !== null) {
    return (
      await img
        .clone()
        .withExif({ IFD0: { Artist: text, Copyright: text } })
        .toBuffer()
    ).toString("base64");
  }
  return (await img.toBuffer()).toString("base64");
}

const read = (transcript: string): LocalOcrAttestation => ({ read: true, transcript });
const blind = (reason = "no local vision model configured"): LocalOcrAttestation => ({
  read: false,
  reason,
});

describe("clean rasters may egress, and egress as re-encoded bytes", () => {
  it("passes a verified-clean image and returns metadata-free output", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("LIVER GREATER THAN SPLENIC ECHO. NO FOCAL LESION."),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.posture).toBe("clean");
      expect(r.mimeType).toBe("image/jpeg");
      expect(r.matched).toEqual([]);
    }
  });

  it("does not hand back the bytes it was given", async () => {
    const input = await jpegWith(null);
    const r = await deidentifyImageForCloudEgress({
      base64: input,
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("normal study"),
    });
    expect(r.ok).toBe(true);
    // Re-encoding is a real transformation, not a pass-through.
    if (r.ok) expect(r.base64).not.toBe(input);
  });

  it("drops EXIF that carried a patient name, so it cannot egress in metadata", async () => {
    const input = await jpegWith("Abhinash Singh");
    const before = await sharp(Buffer.from(input, "base64")).metadata();
    expect(before.exif).toBeTruthy();

    const r = await deidentifyImageForCloudEgress({
      base64: input,
      mimeType: "image/jpeg",
      // The pixels are clean here; only the container carried the name. This is
      // the case a pixel-only check would miss.
      identifiers: PATIENT,
      runLocalOcr: async () => read("no overlay text"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const after = await sharp(Buffer.from(r.base64, "base64")).metadata();
      expect(after.exif).toBeFalsy();
      const md = (after as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
      expect(md.exif).toBeFalsy();
    }
  });

  it("normalises a PNG to JPEG without losing the clinical picture", async () => {
    const png = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const r = await deidentifyImageForCloudEgress({
      base64: png.toString("base64"),
      mimeType: "image/png",
      identifiers: PATIENT,
      runLocalOcr: async () => read("kidneys normal"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mimeType).toBe("image/jpeg");
  });
});

describe("burned-in identifiers block cloud transmission", () => {
  it("blocks when the overlay shows the patient's full name", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("ABIHNASH SINGH  DOB 12/04/1980  US ABDOMEN"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.posture).toBe("identifiers_found");
      expect(r.safeError).toBe("cloud_image_burned_in_identifiers");
      expect(r.matched).toContain("patient_name");
    }
  });

  it("blocks on surname alone, the way a corner overlay usually renders it", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("SINGH, A.  45Y"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched).toContain("patient_name");
  });

  it("blocks on the MRN and the accession, whichever the modality burned in", async () => {
    for (const [transcript, expectCat] of [
      ["MRN 44771", "mrn"],
      ["ACC 2026 0091", "accession_number"],
      ["PID 8812", "patient_id"],
    ] as const) {
      const r = await deidentifyImageForCloudEgress({
        base64: await jpegWith(null),
        mimeType: "image/jpeg",
        identifiers: PATIENT,
        runLocalOcr: async () => read(transcript),
      });
      expect(r.ok, transcript).toBe(false);
      if (!r.ok) expect(r.matched, transcript).toContain(expectCat);
    }
  });

  it("blocks on every date rendering a scanner might print for one DOB", async () => {
    for (const stamped of [
      "DOB 1980-04-12",
      "DOB 1980/04/12",
      "DOB 12/04/1980",
      "DOB 12-04-1980",
      "DOB 04/12/1980",
      "DOB 12041980",
      "DOB 19800412",
    ]) {
      const r = await deidentifyImageForCloudEgress({
        base64: await jpegWith(null),
        mimeType: "image/jpeg",
        identifiers: PATIENT,
        runLocalOcr: async () => read(stamped),
      });
      expect(r.ok, stamped).toBe(false);
      if (!r.ok) expect(r.matched, stamped).toContain("date_of_birth");
    }
  });

  it("names the category in the refusal, never the matched value", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("ABIHNASH SINGH"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The refusal itself is shown to a user and may be logged; it must not
      // reproduce the identifier it just found.
      expect(r.detail).not.toMatch(/Abhinash/i);
      expect(r.detail).not.toMatch(/Singh/i);
      expect(r.detail).toContain("patient_name");
    }
  });
});

describe("not_verified blocks — the rule that makes the gate mean something", () => {
  it("blocks when no local vision model is available", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => blind(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.posture).toBe("not_verified");
      expect(r.safeError).toBe("cloud_image_not_verifiable");
    }
  });

  it("does not read an empty transcript from a sleeping checker as 'clean'", async () => {
    // An OCR that never ran is indistinguishable by TEXT from a blank image,
    // which is exactly why the attestation is a flag and not an inference.
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => blind("model returned nothing"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.posture).toBe("not_verified");
  });

  it("a checker that attests but sees no text is genuinely clean", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: await jpegWith(null),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read(""),
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a payload that is not a decodable image", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: Buffer.from("not an image at all").toString("base64"),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => read("should never be reached"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.posture).toBe("not_verified");
  });

  it("refuses a raw DICOM rather than treating it as a picture", async () => {
    const r = await deidentifyImageForCloudEgress({
      base64: Buffer.from("DICM magic bytes").toString("base64"),
      mimeType: "application/dicom",
      identifiers: PATIENT,
      runLocalOcr: async () => read("x"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("cloud_image_mime_not_allowed");
      expect(r.posture).toBe("not_verified");
    }
  });

  it("never calls the checker when the container step already failed", async () => {
    let called = 0;
    await deidentifyImageForCloudEgress({
      base64: Buffer.from("junk").toString("base64"),
      mimeType: "image/jpeg",
      identifiers: PATIENT,
      runLocalOcr: async () => {
        called += 1;
        return read("");
      },
    });
    expect(called).toBe(0);
  });
});

describe("a set fails closed as a set", () => {
  it("one identifiable image blocks the whole request", async () => {
    const good = await jpegWith(null);
    let seen = 0;
    const r = await deidentifyImagesForCloudEgress({
      images: [
        { base64: good, mimeType: "image/jpeg" },
        { base64: good, mimeType: "image/jpeg" },
      ],
      identifiers: PATIENT,
      runLocalOcr: async () => {
        // The second image carries the overlay. A set must not silently drop the
        // offending image and send the one that passed — the missing image would
        // change what the report claims to have looked at.
        seen += 1;
        return read(seen === 2 ? "second image: ABIHNASH SINGH" : "liver normal");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detail).toContain("Image 2 of 2");
      // Stops at the first refusal rather than checking the rest.
      expect(seen).toBe(2);
    }
  });

  it("passes every image through when all are clean", async () => {
    const good = await jpegWith(null);
    const r = await deidentifyImagesForCloudEgress({
      images: [
        { base64: good, mimeType: "image/jpeg" },
        { base64: good, mimeType: "image/png" },
      ],
      identifiers: PATIENT,
      runLocalOcr: async () => read("liver normal"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.images).toHaveLength(2);
  });
});

describe("matching is precise enough not to shout at normal reports", () => {
  it("matches across case, punctuation and spacing", () => {
    expect(matchBurnedInIdentifiers("DR. ABHINASH  SINGH", PATIENT)).toContain("patient_name");
    expect(matchBurnedInIdentifiers("singh_abinash", PATIENT)).toContain("patient_name");
  });

  it("does not flag clinical text that happens to contain common words", () => {
    const transcript =
      "The liver is normal in size and echogenicity. No intrahepatic biliary dilution. " +
      "Gall bladder wall is normal. Both kidneys are normal in size and position. " +
      "Spleen measures 11 cm. Pancreas is unremarkable. No ascites.";
    expect(matchBurnedInIdentifiers(transcript, PATIENT)).toEqual([]);
  });

  it("ignores identifier fields the clinic never configured", () => {
    const sparse: PatientIdentifiers = { patientName: null, dateOfBirth: null };
    expect(matchBurnedInIdentifiers("anything at all", sparse)).toEqual([]);
  });

  it("does not match a 2-character fragment of a name", () => {
    const twoLetter: PatientIdentifiers = { patientName: "Li" };
    expect(matchBurnedInIdentifiers("liver is normal", twoLetter)).toEqual([]);
  });

  it("still catches a generic PHI pattern the clinic did not configure", () => {
    // The backstop: a phone number is not this patient's configured identifier,
    // but it is still an identifier leaving the clinic.
    const found = matchBurnedInIdentifiers("call mobile: 9876543210", {});
    expect(found.length).toBeGreaterThan(0);
  });

  it("honours extra forbidden terms such as a referring doctor's name", () => {
    const r = matchBurnedInIdentifiers("referral Dr Mehta", { extraForbiddenTerms: ["Dr Mehta"] });
    expect(r.length).toBeGreaterThan(0);
  });
});
