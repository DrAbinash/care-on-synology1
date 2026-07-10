import { describe, it, expect, beforeAll } from "vitest";
import {
  writeStructuredReport,
  buildStructuredReportDocument,
  type WriteStructuredReportInput,
  type WriterValidationContext,
} from "./writer";
import { computeContentSha256 } from "./hash";
import { jcsCanonicalize } from "./canonicalizer";
import { validateStructuredReport } from "./validator";
import { DrizzleStructuredReportCatalogPort } from "./catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./aiRulesRegistry";
import { seedGoldenCatalog } from "./__fixtures__/seedGoldenCatalog";
import { loadExample } from "./__fixtures__/loadExample";
import { deriveWriterInput } from "./__fixtures__/deriveWriterInput";
import type { InMemoryCatalogStore } from "../radiologyCatalog/store";

// D1 §19 item 3: the writer emits canonical structured_json + computes
// content_sha256, deterministically, and its output round-trips through the
// frozen validator. These tests exercise assembly, determinism, revision
// reconciliation, finalize signature stamping, and the finalize-rule
// enforcement, all against the real seeded B1/B2 catalog.

let store: InMemoryCatalogStore;
let validation: WriterValidationContext;
let finalizeValidation: WriterValidationContext;

beforeAll(async () => {
  store = await seedGoldenCatalog();
  validation = {
    catalog: new DrizzleStructuredReportCatalogPort(store),
    aiRules: new UnavailableAiRulesRegistryPort(),
  };
  finalizeValidation = {
    ...validation,
    auditLogLookup: async () => true, // honest-gap port (no live audit_logs row in a unit test)
    amendsLookup: async () => null,
  };
});

const DRAFT_EXAMPLES = [
  "example1MriBrain.json",
  "example2MriLsSpine.json",
  "example4UsgAbdomen.json",
  "example5DopplerCarotid.json",
] as const;

describe("writeStructuredReport — round-trip Input → Writer → Validator (draft)", () => {
  for (const file of DRAFT_EXAMPLES) {
    it(`${file}: writer output validates clean in draft mode`, async () => {
      const input = deriveWriterInput(loadExample(file));
      const result = await writeStructuredReport(input, { mode: "draft", validation });
      expect(result.validation, JSON.stringify(result.validation?.errors, null, 2)).not.toBeNull();
      expect(result.validation!.errors).toEqual([]);
      expect(result.validation!.ok).toBe(true);
      const unexpected = result.validation!.warnings.filter((w) => w.rule !== "R15" && w.rule !== "R16");
      expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
    });
  }
});

describe("writeStructuredReport — round-trip Input → Writer → Validator (finalize)", () => {
  it("example3MriCervicalSpine.json: writer output validates clean in finalize mode", async () => {
    const input = deriveWriterInput(loadExample("example3MriCervicalSpine.json"));
    const result = await writeStructuredReport(input, { mode: "finalize", validation: finalizeValidation });
    expect(result.validation!.errors, JSON.stringify(result.validation!.errors, null, 2)).toEqual([]);
    expect(result.validation!.ok).toBe(true);
    // finalize stamps signed_content_sha256 = content_sha256 (D1 §10 / R14)
    expect(result.document.audit.signature.signed_content_sha256).toBe(result.contentSha256);
    expect(result.document.audit.content_sha256).toBe(result.contentSha256);
  });

  it("the writer's freshly-computed hash replaces the fixture's placeholder and still satisfies R14", async () => {
    const fixture = loadExample("example3MriCervicalSpine.json") as any;
    const input = deriveWriterInput(fixture);
    const { document, contentSha256 } = buildStructuredReportDocument(input, "finalize");
    // fixture used a placeholder ("sha256:1a2b3c"); the writer computed a real digest
    expect(contentSha256).not.toBe(fixture.audit.content_sha256);
    expect(contentSha256.slice("sha256:".length)).toMatch(/^[0-9a-f]{64}$/);
    // and content_sha256 === signed_content_sha256 (what R14 checks)
    expect(document.audit.signature.signed_content_sha256).toBe(document.audit.content_sha256);
  });
});

describe("buildStructuredReportDocument — faithful assembly (reproduces the §17 structure)", () => {
  for (const [file, mode] of [
    ["example1MriBrain.json", "draft"],
    ["example3MriCervicalSpine.json", "finalize"],
  ] as const) {
    it(`${file}: output deep-equals the fixture except the writer-computed content digest`, () => {
      const fixture = loadExample(file) as any;
      const { document } = buildStructuredReportDocument(deriveWriterInput(fixture), mode);
      const expected = structuredClone(fixture);
      // content_sha256 is always (re)computed, so normalize it in both modes.
      expected.audit.content_sha256 = document.audit.content_sha256;
      // signed_content_sha256 is ONLY normalized at finalize. In draft mode it
      // must stay exactly the fixture's null — normalizing it unconditionally
      // would mask a draft that wrongly carried a signed digest, so leave the
      // draft case to compare against null.
      if (mode === "finalize") {
        expected.audit.signature.signed_content_sha256 = document.audit.signature.signed_content_sha256;
      }
      expect(document).toEqual(expected);
    });
  }

  it("a draft NEVER stamps signed_content_sha256 (it stays null)", () => {
    const { document } = buildStructuredReportDocument(deriveWriterInput(loadExample("example1MriBrain.json")), "draft");
    expect(document.audit.signature.signed_content_sha256).toBeNull();
  });
});

describe("writeStructuredReport — determinism (pure function of its input)", () => {
  it("produces byte-identical canonicalJson and identical digest on repeated writes", async () => {
    const input = deriveWriterInput(loadExample("example5DopplerCarotid.json"));
    const a = buildStructuredReportDocument(input, "draft");
    const b = buildStructuredReportDocument(input, "draft");
    expect(a.canonicalJson).toBe(b.canonicalJson);
    expect(a.contentSha256).toBe(b.contentSha256);
  });

  it("canonicalJson is independent of the caller's key order in the input parts", () => {
    const doc = loadExample("example1MriBrain.json") as any;
    const input = deriveWriterInput(doc);
    // shuffle top-level input key order
    const shuffled: WriteStructuredReportInput = {
      audit: input.audit,
      ai: input.ai,
      provenance: input.provenance,
      findings: input.findings,
      study_context: input.study_context,
      catalog_snapshot: input.catalog_snapshot,
      document_id: input.document_id,
      schema_version: input.schema_version,
      measurements: input.measurements,
      recommendations: input.recommendations,
      critical_flags: input.critical_flags,
      impression: input.impression,
      sections: input.sections,
      extensions: input.extensions,
    };
    expect(buildStructuredReportDocument(shuffled, "draft").canonicalJson).toBe(
      buildStructuredReportDocument(input, "draft").canonicalJson,
    );
  });

  it("the stamped content_sha256 is a fixed point (re-hashing the finished document reproduces it)", () => {
    const input = deriveWriterInput(loadExample("example2MriLsSpine.json"));
    const { document, contentSha256 } = buildStructuredReportDocument(input, "draft");
    expect(computeContentSha256(document)).toBe(contentSha256);
  });
});

describe("writeStructuredReport — revision reconciliation (R10b)", () => {
  it("forces provenance.revision to equal audit.revision even when the caller passes a mismatch", () => {
    const input = deriveWriterInput(loadExample("example1MriBrain.json"));
    input.audit.revision = 9;
    input.provenance = { ...input.provenance, revision: 2 }; // deliberately wrong
    const { document } = buildStructuredReportDocument(input, "draft");
    expect(document.audit.revision).toBe(9);
    expect(document.provenance.revision).toBe(9); // reconciled to audit.revision
  });
});

describe("writeStructuredReport — canonical output shape", () => {
  it("omits optional members that were not supplied, keeps required arrays", () => {
    const input = deriveWriterInput(loadExample("example1MriBrain.json"));
    delete (input as any).sections;
    delete (input as any).impression;
    delete (input as any).extensions;
    input.recommendations = undefined;
    input.critical_flags = undefined;
    const { document } = buildStructuredReportDocument(input, "draft");
    expect("sections" in document).toBe(false);
    expect("impression" in document).toBe(false);
    expect("extensions" in document).toBe(false);
    expect(document.recommendations).toEqual([]); // required array defaults to []
    expect(document.critical_flags).toEqual([]);
    expect(document.measurements).toEqual([]);
  });

  it("canonicalJson parses back to a structure equal to document", () => {
    const input = deriveWriterInput(loadExample("example4UsgAbdomen.json"));
    const { document, canonicalJson } = buildStructuredReportDocument(input, "draft");
    expect(JSON.parse(canonicalJson)).toEqual(document);
  });
});

describe("writeStructuredReport — finalize-rule enforcement (R13/R14) surfaces via validation", () => {
  it("R13: an auto_sign=true document is rejected", async () => {
    const input = deriveWriterInput(loadExample("example3MriCervicalSpine.json"));
    input.ai = { ...input.ai, guarding: { auto_sign: true as unknown as false } };
    const result = await writeStructuredReport(input, { mode: "finalize", validation: finalizeValidation });
    expect(result.validation!.ok).toBe(false);
    expect(result.validation!.errors.some((e) => e.rule === "R13")).toBe(true);
  });

  it("R14: finalizing a document whose signature.state is still draft is rejected", async () => {
    const input = deriveWriterInput(loadExample("example1MriBrain.json")); // state: "draft"
    const result = await writeStructuredReport(input, { mode: "finalize", validation: finalizeValidation });
    expect(result.validation!.ok).toBe(false);
    expect(result.validation!.errors.some((e) => e.rule === "R14")).toBe(true);
  });

  it("R14b: finalizing without an audit_log_ref is rejected", async () => {
    const input = deriveWriterInput(loadExample("example3MriCervicalSpine.json"));
    input.audit.audit_log_ref = null;
    const result = await writeStructuredReport(input, { mode: "finalize", validation: finalizeValidation });
    expect(result.validation!.ok).toBe(false);
    expect(result.validation!.errors.some((e) => e.rule === "R14b")).toBe(true);
  });
});

describe("writeStructuredReport — no validation context supplied", () => {
  it("still assembles + hashes, returns validation: null", async () => {
    const input = deriveWriterInput(loadExample("example1MriBrain.json"));
    const result = await writeStructuredReport(input, { mode: "draft" });
    expect(result.validation).toBeNull();
    expect(result.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // and the built document is independently validatable
    const v = await validateStructuredReport(result.document, { ...validation, mode: "draft" });
    expect(v.ok).toBe(true);
  });
});

describe("writeStructuredReport — canonicalizer determinism sanity via jcs", () => {
  it("canonicalJson equals jcsCanonicalize(document)", () => {
    const input = deriveWriterInput(loadExample("example2MriLsSpine.json"));
    const { document, canonicalJson } = buildStructuredReportDocument(input, "draft");
    expect(canonicalJson).toBe(jcsCanonicalize(document));
  });
});
