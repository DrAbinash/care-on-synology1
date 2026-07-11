import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeContentSha256,
  contentHashPreimage,
  stripHashExclusions,
  verifyContentSha256,
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_PREFIX,
} from "./hash";
import { loadExample } from "./__fixtures__/loadExample";

// content_sha256 = SHA-256( JCS(document minus /audit/content_sha256 and
// /audit/signature/signed_content_sha256) ), D1 §10. The load-bearing property
// is the EXCLUSION SET: the two stamped digest fields must be outside the
// preimage (so the writer can stamp them without changing the hash) while every
// other field — crucially the signing/authorship metadata — must be inside it
// (so it cannot be forged). Both directions are tested below.

/** Minimal well-formed-enough document for hashing (hashing does not validate). */
function sampleDoc() {
  return {
    schema_version: "1.0.0",
    document_id: "01J9Z6BRA1N0STDY000000A100",
    findings: [{ lid: "f1", sentence: "No acute abnormality.", presence: "normal", order: 10 }],
    measurements: [{ lid: "m1", value: 102.0, unit: "mm" }],
    provenance: { created_by: "dr_x", revision: 3 },
    audit: {
      hash_algorithm: "jcs-sha256/1",
      revision: 3,
      content_sha256: "sha256:PLACEHOLDER",
      signature: {
        state: "draft",
        signed_by: "dr_x",
        signed_role: "radiologist",
        signed_content_sha256: "sha256:PLACEHOLDER2",
      },
    },
  };
}

describe("computeContentSha256 — format & algorithm", () => {
  it('returns "sha256:" + 64 lowercase hex characters', () => {
    const h = computeContentSha256(sampleDoc());
    expect(h.startsWith(CONTENT_HASH_PREFIX)).toBe(true);
    expect(h.slice(CONTENT_HASH_PREFIX.length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches an INDEPENDENT digest: preimage hand-authored (keys sorted by hand), hashed with the system sha256sum", () => {
    // These two literals are NOT produced by the module under test. The preimage
    // was written out by hand with object keys pre-sorted and the two D1 §10
    // members excluded; its SHA-256 was taken with the OS `sha256sum` over those
    // exact 395 UTF-8 bytes. So this asserts computeContentSha256 agrees with an
    // independent SHA-256 implementation over an independently-canonicalized
    // preimage — not with itself. (A self-recomputed `expected` would be
    // f(x)===f(x) and prove nothing.)
    const EXPECTED_PREIMAGE =
      '{"audit":{"hash_algorithm":"jcs-sha256/1","revision":3,"signature":' +
      '{"signed_by":"dr_x","signed_role":"radiologist","state":"draft"}},' +
      '"document_id":"01J9Z6BRA1N0STDY000000A100",' +
      '"findings":[{"lid":"f1","order":10,"presence":"normal","sentence":"No acute abnormality."}],' +
      '"measurements":[{"lid":"m1","unit":"mm","value":102}],' +
      '"provenance":{"created_by":"dr_x","revision":3},"schema_version":"1.0.0"}';
    const EXPECTED_DIGEST = "sha256:28f0bbbb9046b5540d933919312cd651edb7a3a6c537488ea13351a887deffda";

    // the module canonicalizes to exactly the hand-authored preimage bytes...
    expect(contentHashPreimage(sampleDoc())).toBe(EXPECTED_PREIMAGE);
    expect(Buffer.byteLength(EXPECTED_PREIMAGE, "utf8")).toBe(395);
    // ...and hashes to the independently-computed digest
    expect(computeContentSha256(sampleDoc())).toBe(EXPECTED_DIGEST);
    // cross-check: a SHA-256 taken here over that same literal preimage agrees
    expect(CONTENT_HASH_PREFIX + createHash("sha256").update(EXPECTED_PREIMAGE, "utf8").digest("hex")).toBe(EXPECTED_DIGEST);
    // sanity: the algorithm id this module implements is the one the spec names
    expect(CONTENT_HASH_ALGORITHM).toBe("jcs-sha256/1");
  });
});

describe("stripHashExclusions / contentHashPreimage — the exclusion set (D1 §10)", () => {
  it("removes exactly the two stamped digest members and nothing else", () => {
    const doc = sampleDoc();
    const stripped = stripHashExclusions(doc) as any;
    expect(stripped.audit.content_sha256).toBeUndefined();
    expect(stripped.audit.signature.signed_content_sha256).toBeUndefined();
    // every other field survives
    expect(stripped.audit.signature.signed_by).toBe("dr_x");
    expect(stripped.audit.signature.state).toBe("draft");
    expect(stripped.audit.revision).toBe(3);
    expect(stripped.findings[0].sentence).toBe("No acute abnormality.");
  });

  it("does not mutate the input document", () => {
    const doc = sampleDoc();
    stripHashExclusions(doc);
    expect(doc.audit.content_sha256).toBe("sha256:PLACEHOLDER");
    expect(doc.audit.signature.signed_content_sha256).toBe("sha256:PLACEHOLDER2");
  });

  it("preimage string contains neither excluded key name", () => {
    const preimage = contentHashPreimage(sampleDoc());
    expect(preimage.includes("signed_content_sha256")).toBe(false);
    // "content_sha256" is a substring of "signed_content_sha256"; both are gone
    expect(preimage.includes("content_sha256")).toBe(false);
  });
});

describe("computeContentSha256 — stability under the excluded fields", () => {
  it("is UNCHANGED when the two stamped digests change (they are outside the preimage)", () => {
    const doc = sampleDoc();
    const before = computeContentSha256(doc);
    doc.audit.content_sha256 = "sha256:something-else-entirely";
    doc.audit.signature.signed_content_sha256 = "sha256:also-different";
    expect(computeContentSha256(doc)).toBe(before);
  });

  it("is UNCHANGED whether content_sha256 is absent, null, placeholder, or correct", () => {
    const base = sampleDoc();
    const target = computeContentSha256(base);

    const absent = sampleDoc() as any;
    delete absent.audit.content_sha256;
    delete absent.audit.signature.signed_content_sha256;
    expect(computeContentSha256(absent)).toBe(target);

    const nulled = sampleDoc() as any;
    nulled.audit.content_sha256 = null;
    nulled.audit.signature.signed_content_sha256 = null;
    expect(computeContentSha256(nulled)).toBe(target);

    const correct = sampleDoc() as any;
    correct.audit.content_sha256 = target;
    correct.audit.signature.signed_content_sha256 = target;
    expect(computeContentSha256(correct)).toBe(target);
  });
});

describe("computeContentSha256 — tamper sensitivity (everything else IS hashed)", () => {
  it("CHANGES when signing/authorship metadata is forged", () => {
    const before = computeContentSha256(sampleDoc());

    const forgedSigner = sampleDoc();
    forgedSigner.audit.signature.signed_by = "dr_attacker";
    expect(computeContentSha256(forgedSigner)).not.toBe(before);

    const forgedState = sampleDoc();
    forgedState.audit.signature.state = "final";
    expect(computeContentSha256(forgedState)).not.toBe(before);

    const forgedRole = sampleDoc();
    forgedRole.audit.signature.signed_role = "consultant";
    expect(computeContentSha256(forgedRole)).not.toBe(before);
  });

  it("CHANGES when clinical content is altered", () => {
    const before = computeContentSha256(sampleDoc());

    const editedSentence = sampleDoc();
    editedSentence.findings[0].sentence = "Acute infarct.";
    expect(computeContentSha256(editedSentence)).not.toBe(before);

    const editedMeasurement = sampleDoc();
    editedMeasurement.measurements[0].value = 99;
    expect(computeContentSha256(editedMeasurement)).not.toBe(before);

    const editedRevision = sampleDoc();
    editedRevision.audit.revision = 4;
    expect(computeContentSha256(editedRevision)).not.toBe(before);
  });

  it("is independent of source key order (canonical) but sensitive to values", () => {
    const a = computeContentSha256({ audit: { revision: 1 }, findings: [], b: 2, a: 1 });
    const b = computeContentSha256({ a: 1, findings: [], b: 2, audit: { revision: 1 } });
    expect(a).toBe(b);
  });
});

describe("verifyContentSha256", () => {
  it("ok when the stamped digest equals the recomputed one", () => {
    const doc = sampleDoc() as any;
    doc.audit.content_sha256 = computeContentSha256(doc);
    const v = verifyContentSha256(doc);
    expect(v.ok).toBe(true);
    expect(v.computed).toBe(v.stored);
  });

  it("not ok when the document was tampered after stamping", () => {
    const doc = sampleDoc() as any;
    doc.audit.content_sha256 = computeContentSha256(doc);
    doc.findings[0].sentence = "tampered"; // change hashed content, leave stamp stale
    const v = verifyContentSha256(doc);
    expect(v.ok).toBe(false);
    expect(v.computed).not.toBe(v.stored);
  });

  it("not ok when no digest is stamped at all", () => {
    const doc = sampleDoc() as any;
    delete doc.audit.content_sha256;
    expect(verifyContentSha256(doc).ok).toBe(false);
  });
});

describe("computeContentSha256 — determinism across the real D1 §17 documents", () => {
  const files = [
    "example1MriBrain.json",
    "example2MriLsSpine.json",
    "example3MriCervicalSpine.json",
    "example4UsgAbdomen.json",
    "example5DopplerCarotid.json",
  ];
  for (const file of files) {
    it(`${file} hashes identically on repeated calls`, () => {
      const doc = loadExample(file);
      expect(computeContentSha256(doc)).toBe(computeContentSha256(doc));
    });
  }
});
