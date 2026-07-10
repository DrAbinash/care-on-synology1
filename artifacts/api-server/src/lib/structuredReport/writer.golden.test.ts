import { describe, it, expect } from "vitest";
import { buildStructuredReportDocument } from "./writer";
import { jcsCanonicalize } from "./canonicalizer";
import { computeContentSha256, contentHashPreimage } from "./hash";
import { loadExample } from "./__fixtures__/loadExample";
import { deriveWriterInput } from "./__fixtures__/deriveWriterInput";

// Byte-for-byte golden fixtures for JCS + the D1 §10 exclusion set — the
// artifact D1 §19 item 3 explicitly requires ("computes content_sha256 via
// RFC 8785 JCS + SHA-256 (§10) with byte-for-byte golden fixtures"). The pinned
// values below were produced by this exact pipeline AND the hand-vector's
// digest was independently cross-checked with the system `sha256sum` over the
// pinned preimage bytes (148 bytes → the digest below), so these goldens attest
// the implementation matches an INDEPENDENT SHA-256, not merely itself.
//
// If a future edit changes the canonicalizer, the exclusion set, or the writer's
// assembly, these literals will no longer match and the test fails loudly — the
// whole point of a byte-for-byte golden.

describe("byte-for-byte golden — hand vector (independently cross-checked with sha256sum)", () => {
  // A small document whose exact JCS preimage and SHA-256 are pinned as literals.
  const doc = {
    a: true,
    b: [3, 1, 2],
    findings: [{ lid: "f1", s: "café/中", value: 4.5 }],
    audit: {
      revision: 2,
      content_sha256: "sha256:PLACEHOLDER", // excluded
      signature: { signed_by: "dr_a", state: "draft", signed_content_sha256: "sha256:PLACEHOLDER" }, // excluded
    },
  };

  const EXPECTED_PREIMAGE =
    '{"a":true,"audit":{"revision":2,"signature":{"signed_by":"dr_a","state":"draft"}},"b":[3,1,2],"findings":[{"lid":"f1","s":"café/中","value":4.5}]}';
  const EXPECTED_HASH = "sha256:e8d78d021caafc7628552e1b293785724e56eed7fd6692884ad116af9eaaf6a5";

  it("canonical preimage matches the pinned byte string (keys sorted, digests excluded, 4.5 verbatim, café/中 literal)", () => {
    expect(contentHashPreimage(doc)).toBe(EXPECTED_PREIMAGE);
  });

  it("preimage is exactly 148 UTF-8 bytes (matches the independently-hashed fixture)", () => {
    expect(Buffer.byteLength(EXPECTED_PREIMAGE, "utf8")).toBe(148);
  });

  it("content_sha256 matches the pinned, independently-verified digest", () => {
    expect(computeContentSha256(doc)).toBe(EXPECTED_HASH);
  });
});

describe("byte-for-byte golden — the five D1 §17 worked examples through the writer", () => {
  // mode + pinned content_sha256 for each real §17 document, produced by this
  // pipeline. Any regression in canonicalizer/hash/writer breaks these.
  const GOLDEN: Record<string, { mode: "draft" | "finalize"; contentSha256: string }> = {
    "example1MriBrain.json": {
      mode: "draft",
      contentSha256: "sha256:90916803e7f153829f840521c88b5926112471ea06f23c77b402193ab5cd1659",
    },
    "example2MriLsSpine.json": {
      mode: "draft",
      contentSha256: "sha256:74e8c1ca8ea8d773272d5e01e42560f6486499a7770b9fb637e42ee11597a631",
    },
    "example3MriCervicalSpine.json": {
      mode: "finalize",
      contentSha256: "sha256:634434a6bf4b4f9a97e88b8e16c7841d348e17ba229a562b6e7e774963d7ba89",
    },
    "example4UsgAbdomen.json": {
      mode: "draft",
      contentSha256: "sha256:5358cf4150884a141a031e17e3cc96f39ec9ab2e66b3fcb9b680747a9701ba8f",
    },
    "example5DopplerCarotid.json": {
      mode: "draft",
      contentSha256: "sha256:7676b156c11a0d3ad82087566fad4263e8a8d9a0c50c38160a89171d0152ccd2",
    },
  };

  for (const [file, golden] of Object.entries(GOLDEN)) {
    it(`${file}: writer computes the pinned content_sha256 (${golden.mode})`, () => {
      const input = deriveWriterInput(loadExample(file));
      const { document, contentSha256, canonicalJson } = buildStructuredReportDocument(input, golden.mode);
      expect(contentSha256).toBe(golden.contentSha256);
      // internal consistency: the stamped digest equals a fresh recomputation,
      // and canonicalJson is exactly JCS(document)
      expect(document.audit.content_sha256).toBe(golden.contentSha256);
      expect(canonicalJson).toBe(jcsCanonicalize(document));
      if (golden.mode === "finalize") {
        expect(document.audit.signature.signed_content_sha256).toBe(golden.contentSha256);
      }
    });
  }

  it("every example produces a distinct digest (no accidental collision/constant)", () => {
    const digests = new Set(Object.values(GOLDEN).map((g) => g.contentSha256));
    expect(digests.size).toBe(Object.keys(GOLDEN).length);
  });
});
