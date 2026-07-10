import { describe, it, expect, beforeEach } from "vitest";
import { validateStructuredReport, type ValidationContext } from "./validator";
import { DrizzleStructuredReportCatalogPort } from "./catalogAccess";
import { UnavailableAiRulesRegistryPort, InMemoryAiRulesRegistryPort } from "./aiRulesRegistry";
import { InMemoryCatalogStore } from "../radiologyCatalog/store";
import type { StructuredReportDocument } from "./types";

// Rule-by-rule coverage against D1 §12's table (R0-R18). Each test clones a small,
// hand-built valid base document and mutates exactly one thing, matching this
// codebase's existing "pure guard" validator-testing convention (see
// radiologyCatalog/validation.test.ts, packs/validator.test.ts).

const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // 26 chars, Crockford Base32 (no I/L/O/U)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseValidDocument(): StructuredReportDocument {
  return {
    schema_version: "1.0.0",
    kind: "radiology.structured_report",
    document_id: VALID_ULID,
    catalog_snapshot: { content_pack_versions: { "test.pack": "1.0.0" }, catalog_schema_version: "1.0.0", ai_rules_version: { "test.pack": "1.0.0" } },
    study_context: {
      modality: "USG", body_region: "test", study_type: "test", template_ref: "tpl.test", laterality_default: "lat.na",
      comparison: { has_prior: false, prior_study_ref: null, interval_note: null },
      identifiers: {
        study_instance_uid: "1.2.3", accession_number: "ACC-1",
        patient_ref: { system: "care.patient_id", value: "PAT-1" }, study_datetime: "2026-01-01T00:00:00Z",
        referring_physician_ref: { system: "care.staff", value: "dr_x" }, performing_physician_ref: { system: "care.staff", value: "tech_x" },
      },
    },
    findings: [
      {
        lid: "f1", definition_ref: "finding.test.simple", presence: "present", certainty: "definite",
        laterality: "lat.na", locations: ["loc.somewhere"], severity: "sev.mild", interval_change: null,
        parameters: [{ param: "param.test_flag", kind: "boolean", value: true, label: "Test Flag" }],
        measurement_refs: ["m1"],
        sentence: "Test sentence.", impression_fragment: "Test fragment.", sentence_source: "manual",
        status_flags: { is_significant: true, is_critical: false, is_incidental: false },
        included_from: null,
        provenance: { origin: "manual", actor: "tester", created_at: "2026-01-01T00:00:00Z", edited: false },
        ai: null, order: 10,
      },
    ],
    measurements: [
      {
        lid: "m1", measurement_ref: "meas.length", finding_ref: "f1", site: "loc.somewhere", laterality: "lat.na",
        value: 10, unit: "mm", value_kind: "scalar", value_iso: null, range: null, components: null,
        normal_range: null, abnormal: false, prior_value: null, prior_measurement_ref_document: null, change_pct: null,
        provenance: { origin: "manual", source: "manual", confidence: 0.9, edited: false },
        display: "10 mm",
      },
    ],
    recommendations: [
      {
        lid: "rec1", recommendation_ref: "rec.followup", finding_refs: ["f1"], text: "Follow up.", priority: "routine",
        provenance: { origin: "manual", actor: "tester", created_at: "2026-01-01T00:00:00Z", edited: false }, ai: null,
      },
    ],
    critical_flags: [
      {
        lid: "crit1", critical_ref: "crit.something", finding_ref: "f1", status: "raised",
        raised_at: "2026-01-01T00:00:00Z", raised_by: "tester",
        provenance: { origin: "manual", actor: "tester", created_at: "2026-01-01T00:00:00Z", edited: false },
      },
    ],
    impression: {
      fragments: [
        { lid: "imp1", finding_ref: "f1", text: "Test fragment.", source: "finding_fragment", rank: 1,
          provenance: { origin: "manual", actor: "tester", created_at: "2026-01-01T00:00:00Z", edited: false }, ai: null },
        { lid: "imp2", finding_ref: "f1", text: "AI fragment.", source: "ai_suggestion", rank: 2,
          provenance: { origin: "ai_suggestion", actor: "system", created_at: "2026-01-01T00:00:00Z", edited: false },
          ai: { suggested: true, run_id: "run1", accepted_verbatim: true, confidence: 0.8, model_ref: "model-x:1", prompt_ref: "aiprompt.test", prompt_version: 1 } },
      ],
      items: [{ lid: "impi1", fragment_refs: ["imp1", "imp2"], text: "1. combined." }],
      rendered: "IMPRESSION:\n1. combined.",
    },
    provenance: {
      created_by: "tester", created_at: "2026-01-01T00:00:00Z", authoring_app: "test", authoring_app_version: "0.0.1",
      input_methods: ["manual"], content_pack_versions: { "test.pack": "1.0.0" }, template_ref: "tpl.test", revision: 1,
    },
    ai: {
      runs: [{
        run_id: "run1", purpose: "impression_suggestion", provider: "ollama", model_ref: "model-x:1",
        prompt_ref: "aiprompt.test", prompt_version: 1, prompt_digest: "sha256:aaa", input_digest: "sha256:bbb",
        output_lids: ["imp2"], started_at: "2026-01-01T00:00:00Z", human_review: "accepted_verbatim",
      }],
      guarding: { auto_sign: false },
    },
    audit: {
      schema_version: "1.0.0", hash_algorithm: "jcs-sha256/1", created_at: "2026-01-01T00:00:00Z", last_modified_at: "2026-01-01T00:00:00Z",
      revision: 1, revisions: [{ revision: 1, at: "2026-01-01T00:00:00Z", by: "tester", action: "created" }],
      content_sha256: "sha256:doc", audit_log_ref: null,
      signature: { state: "draft", signed_by: null, signed_role: null, signed_at: null, signed_content_sha256: null, amends_document_id: null },
    },
    extensions: {},
  };
}

function finalizedDocument(): StructuredReportDocument {
  const doc = baseValidDocument();
  doc.audit.signature = {
    state: "final", signed_by: "dr_human", signed_role: "radiologist", signed_at: "2026-01-01T00:10:00Z",
    signed_content_sha256: "sha256:doc", amends_document_id: null,
  };
  doc.audit.audit_log_ref = 1;
  return doc;
}

async function seedMinimalCatalog(): Promise<InMemoryCatalogStore> {
  const store = new InMemoryCatalogStore(() => new Date("2026-01-01T00:00:00Z"));
  const category = await store.insert("finding_categories", { key: "test", label: "Test" });
  const finding = await store.insert("finding_definitions", { key: "test.simple", categoryId: category.id, label: "Test Simple" });
  const group = await store.insert("parameter_groups", { key: "test_flag", label: "Test Flag", dataType: "boolean", allowMultiple: false });
  await store.insert("finding_parameter_bindings", { findingId: finding.id, parameterGroupId: group.id, required: true, sortOrder: 0 });
  await store.insert("finding_severity_bindings", { findingId: finding.id, key: "mild", label: "Mild", rank: 0, sortOrder: 0 });
  await store.insert("finding_locations", { findingId: finding.id, key: "somewhere", label: "Somewhere", sortOrder: 0 });
  await store.insert("finding_measurement_bindings", { findingId: finding.id, key: "length", label: "Length", unit: "mm", valueType: "numeric", sortOrder: 0 });
  return store;
}

let store: InMemoryCatalogStore;
let draftCtx: ValidationContext;
let finalizeCtx: ValidationContext;

beforeEach(async () => {
  store = await seedMinimalCatalog();
  draftCtx = { catalog: new DrizzleStructuredReportCatalogPort(store), aiRules: new UnavailableAiRulesRegistryPort(), mode: "draft" };
  finalizeCtx = {
    catalog: new DrizzleStructuredReportCatalogPort(store), aiRules: new UnavailableAiRulesRegistryPort(), mode: "finalize",
    auditLogLookup: async () => true, amendsLookup: async () => null,
  };
});

describe("positive control", () => {
  it("the base document validates clean in draft mode", async () => {
    const result = await validateStructuredReport(baseValidDocument(), draftCtx);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("the finalized document validates clean in finalize mode", async () => {
    const result = await validateStructuredReport(finalizedDocument(), finalizeCtx);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("R0 — structural envelope", () => {
  it("rejects a missing required top-level field", async () => {
    const doc = clone(baseValidDocument()) as any;
    delete doc.provenance;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === "R0" && e.path === "$.provenance")).toBe(true);
  });

  it("rejects an unknown non-x_ top-level field", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.mystery_field = "nope";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === "R0" && e.path === "$.mystery_field")).toBe(true);
  });

  it("accepts an x_-prefixed top-level field (open extension channel, §11.1)", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.x_custom = { anything: true };
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.filter((e) => e.path === "$.x_custom")).toEqual([]);
  });

  it("rejects value_kind=derived with no components", async () => {
    const doc = clone(baseValidDocument());
    doc.measurements[0].value_kind = "derived";
    doc.measurements[0].components = null;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R0" && e.path.endsWith(".components"))).toBe(true);
  });
});

describe("R1 — finding./param. global resolution; rec./crit./tpl./combo. well-formed", () => {
  it("rejects an unresolvable definition_ref", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].definition_ref = "finding.does.not.exist";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R1" && e.path.endsWith(".definition_ref"))).toBe(true);
  });

  it("rejects an unresolvable param ref", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].parameters[0].param = "param.does_not_exist";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R1" && e.path.includes("parameters[0].param"))).toBe(true);
  });

  it("rejects a malformed rec.* reference", async () => {
    const doc = clone(baseValidDocument());
    doc.recommendations[0].recommendation_ref = "not_a_namespaced_ref";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R1" && e.path.endsWith(".recommendation_ref"))).toBe(true);
  });
});

describe("R2 — intra-document reference integrity", () => {
  it("rejects a dangling measurement_refs entry", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].measurement_refs = ["m_missing"];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R2" && e.path.includes("measurement_refs"))).toBe(true);
  });

  it("rejects a dangling recommendation finding_refs entry", async () => {
    const doc = clone(baseValidDocument());
    doc.recommendations[0].finding_refs = ["f_missing"];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R2" && e.path.includes("finding_refs"))).toBe(true);
  });

  it("rejects a dangling impression item fragment_refs entry", async () => {
    const doc = clone(baseValidDocument());
    doc.impression!.items[0].fragment_refs = ["imp_missing"];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R2" && e.path.includes("fragment_refs"))).toBe(true);
  });
});

describe("R2b — measurement ownership is exact (not \"F or null\")", () => {
  it("rejects a measurement listed under a finding that doesn't own it", async () => {
    const doc = clone(baseValidDocument());
    doc.measurements[0].finding_ref = "some_other_lid_not_f1";
    // keep m1 referenced by f1 so R2 doesn't also fire on a dangling ref for a different reason
    doc.findings[0].measurement_refs = ["m1"];
    doc.findings.push({ ...clone(doc.findings[0]), lid: "f_other" });
    doc.measurements[0].finding_ref = "f_other";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R2b")).toBe(true);
  });
});

describe("R3 — lid uniqueness document-wide", () => {
  it("rejects a duplicate lid across different arrays", async () => {
    const doc = clone(baseValidDocument());
    doc.measurements[0].lid = "f1"; // collides with findings[0].lid
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R3")).toBe(true);
  });
});

describe("R4 — severity/locations are finding-scoped; laterality is a valid enum", () => {
  it("rejects a severity not bound to this finding", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].severity = "sev.not_bound";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R4" && e.path.endsWith(".severity"))).toBe(true);
  });

  it("rejects a location not bound to this finding", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].locations = ["loc.not_bound"];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R4" && e.path.includes("locations"))).toBe(true);
  });

  it("rejects an invalid laterality value", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.findings[0].laterality = "lat.sideways";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.path.endsWith(".laterality"))).toBe(true);
  });
});

describe("R5 — measurement units", () => {
  it("rejects a unit mismatch against the catalog binding", async () => {
    const doc = clone(baseValidDocument());
    doc.measurements[0].unit = "cm"; // catalog binding is "mm"
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R5" && e.path.endsWith(".unit"))).toBe(true);
  });

  it("rejects a meas.*-backed measurement with a null finding_ref", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.measurements[0].finding_ref = null;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R5" && e.path.endsWith(".finding_ref"))).toBe(true);
  });

  it("accepts a unit mismatch when x_unit_conversion is present", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.measurements[0].unit = "cm";
    doc.measurements[0].x_unit_conversion = { from: "cm", to: "mm", factor: 10 };
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R5" && e.path.endsWith(".unit"))).toBe(false);
  });
});

describe("R6 — parameters", () => {
  it("rejects a parameter kind that doesn't match the catalog data_type", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.findings[0].parameters[0].kind = "text";
    doc.findings[0].parameters[0].value = "not actually text-typed in the catalog";
    delete doc.findings[0].parameters[0].option;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R6" && e.path.endsWith(".kind"))).toBe(true);
  });
});

describe("R7 — clinical consistency", () => {
  it("rejects presence=normal with a positive severity", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].presence = "normal";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R7" && e.path.endsWith(".severity"))).toBe(true);
  });

  it("rejects presence=absent owning an abnormal:true measurement", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].presence = "absent";
    doc.findings[0].severity = null;
    doc.measurements[0].abnormal = true;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R7" && e.path.includes("measurement_refs"))).toBe(true);
  });
});

describe("R8 — required parameters (draft: warn, finalize: reject)", () => {
  it("warns (not rejects) in draft mode when a required parameter is missing", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].parameters = [];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R8")).toBe(false);
    expect(result.warnings.some((w) => w.rule === "R8")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("rejects in finalize mode when a required parameter is missing", async () => {
    const doc = finalizedDocument();
    doc.findings[0].parameters = [];
    const result = await validateStructuredReport(doc, finalizeCtx);
    expect(result.errors.some((e) => e.rule === "R8")).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("R9 — no duplicate recommendation_ref sharing a finding_ref", () => {
  it("rejects two recommendations with the same ref sharing a finding_ref", async () => {
    const doc = clone(baseValidDocument());
    doc.recommendations.push({ ...clone(doc.recommendations[0]), lid: "rec2" });
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R9")).toBe(true);
  });
});

describe("R10 / R10w / R10b — provenance", () => {
  it("R10 rejects an empty provenance.origin", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].provenance.origin = "";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R10" && e.path.endsWith(".origin"))).toBe(true);
  });

  it("R10 rejects an invalid created_at timestamp", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.findings[0].provenance.created_at = "not-a-date";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R10" && e.path.endsWith(".created_at"))).toBe(true);
  });

  it("R10w warns (never rejects) on an undocumented-but-present origin value", async () => {
    const doc = clone(baseValidDocument());
    doc.findings[0].provenance.origin = "some_future_origin_value";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R10w")).toBe(false);
    expect(result.warnings.some((w) => w.rule === "R10w")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("R10b rejects provenance.revision !== audit.revision", async () => {
    const doc = clone(baseValidDocument());
    doc.provenance.revision = 99;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R10b")).toBe(true);
  });
});

describe("R11 / R11b / R11c — AI linkage", () => {
  it("R11 rejects origin=ai_suggestion with ai=null", async () => {
    const doc = clone(baseValidDocument());
    doc.impression!.fragments[1].ai = null;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R11")).toBe(true);
  });

  it("R11 rejects an ai.run_id not present in ai.runs[]", async () => {
    const doc = clone(baseValidDocument());
    doc.impression!.fragments[1].ai!.run_id = "run_missing";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R11" && e.path.endsWith(".run_id"))).toBe(true);
  });

  it("R11b rejects a run claiming an output_lid that isn't AI-tagged", async () => {
    const doc = clone(baseValidDocument());
    doc.ai.runs[0].output_lids = ["imp1"]; // imp1 is a finding_fragment, not ai_suggestion
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R11b")).toBe(true);
  });

  it("R11b rejects an ai_suggestion atom that appears in no run's output_lids", async () => {
    const doc = clone(baseValidDocument());
    doc.ai.runs[0].output_lids = [];
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R11b")).toBe(true);
  });

  it("R11c rejects an instance ai.model_ref that doesn't equal the run's model_ref", async () => {
    const doc = clone(baseValidDocument());
    doc.impression!.fragments[1].ai!.model_ref = "a-different-model";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R11c" && e.path.endsWith(".model_ref"))).toBe(true);
  });
});

describe("R12 — no unpinned AI aliases; prompt_digest required", () => {
  it("rejects model_ref='latest'", async () => {
    const doc = clone(baseValidDocument());
    doc.ai.runs[0].model_ref = "latest";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R12" && e.path.endsWith(".model_ref"))).toBe(true);
  });

  it("rejects a missing prompt_digest", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.ai.runs[0].prompt_digest = "";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R12" && e.path.endsWith(".prompt_digest"))).toBe(true);
  });
});

describe("R13 — AI never auto-signs; signed_by distinctness at finalize", () => {
  it("rejects ai.guarding.auto_sign=true", async () => {
    const doc = clone(baseValidDocument()) as any;
    doc.ai.guarding.auto_sign = true;
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R13" && e.path.endsWith("auto_sign"))).toBe(true);
  });

  it("rejects at finalize when signed_by equals an AI run's provider", async () => {
    const doc = finalizedDocument();
    doc.audit.signature.signed_by = "ollama"; // matches ai.runs[0].provider
    const result = await validateStructuredReport(doc, finalizeCtx);
    expect(result.errors.some((e) => e.rule === "R13" && e.path.endsWith("signed_by"))).toBe(true);
  });

  it("does not check signed_by distinctness in draft mode", async () => {
    const doc = clone(baseValidDocument());
    doc.audit.signature.signed_by = "ollama"; // would fail at finalize, irrelevant in draft
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R13" && e.path.endsWith("signed_by"))).toBe(false);
  });
});

describe("R14 / R14b / R14c — finalize-only signature rules", () => {
  it("R14 rejects finalize with signature.state !== final", async () => {
    const result = await validateStructuredReport(baseValidDocument(), finalizeCtx); // still state:"draft"
    expect(result.errors.some((e) => e.rule === "R14" && e.path.endsWith(".state"))).toBe(true);
  });

  it("R14 rejects a signed_content_sha256 that doesn't equal content_sha256", async () => {
    const doc = finalizedDocument();
    doc.audit.signature.signed_content_sha256 = "sha256:different";
    const result = await validateStructuredReport(doc, finalizeCtx);
    expect(result.errors.some((e) => e.rule === "R14" && e.path.endsWith("signed_content_sha256"))).toBe(true);
  });

  it("R14b rejects finalize with a null audit_log_ref", async () => {
    const doc = finalizedDocument();
    doc.audit.audit_log_ref = null;
    const result = await validateStructuredReport(doc, finalizeCtx);
    expect(result.errors.some((e) => e.rule === "R14b")).toBe(true);
  });

  it("R14b rejects when auditLogLookup reports no matching row", async () => {
    const doc = finalizedDocument();
    const ctx: ValidationContext = { ...finalizeCtx, auditLogLookup: async () => false };
    const result = await validateStructuredReport(doc, ctx);
    expect(result.errors.some((e) => e.rule === "R14b")).toBe(true);
  });

  it("R14b warns (not rejects) when auditLogLookup is not provided (honest gap)", async () => {
    const doc = finalizedDocument();
    const ctx: ValidationContext = { ...finalizeCtx, auditLogLookup: undefined };
    const result = await validateStructuredReport(doc, ctx);
    expect(result.errors.some((e) => e.rule === "R14b")).toBe(false);
    expect(result.warnings.some((w) => w.rule === "R14b")).toBe(true);
  });

  it("R14c rejects an amends_document_id that doesn't resolve", async () => {
    const doc = finalizedDocument();
    doc.audit.signature.amends_document_id = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const ctx: ValidationContext = { ...finalizeCtx, amendsLookup: async () => null };
    const result = await validateStructuredReport(doc, ctx);
    expect(result.errors.some((e) => e.rule === "R14c")).toBe(true);
  });

  it("R14c rejects amending a document that has already been amended", async () => {
    const doc = finalizedDocument();
    doc.audit.signature.amends_document_id = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const ctx: ValidationContext = { ...finalizeCtx, amendsLookup: async () => ({ state: "final", alreadyAmendedBy: "another_doc_id" }) };
    const result = await validateStructuredReport(doc, ctx);
    expect(result.errors.some((e) => e.rule === "R14c")).toBe(true);
  });
});

describe("R15 / R16 — content-pack AI rules (draft: warn, finalize: reject)", () => {
  it("warns in draft when a contradiction rule fires, using an injected registry", async () => {
    const aiRules = new InMemoryAiRulesRegistryPort(
      new Map([["finding.test.simple", { contradiction: [{ id: "c1", message: "cannot be both", when: ["findings.0.presence"], forbid: ["findings.0.status_flags.is_significant"] }], completeness: [] }]]),
    );
    const ctx: ValidationContext = { ...draftCtx, aiRules };
    const result = await validateStructuredReport(baseValidDocument(), ctx);
    expect(result.warnings.some((w) => w.rule === "R15")).toBe(true);
    expect(result.errors.some((e) => e.rule === "R15")).toBe(false);
  });

  it("rejects at finalize when the same contradiction rule fires", async () => {
    const aiRules = new InMemoryAiRulesRegistryPort(
      new Map([["finding.test.simple", { contradiction: [{ id: "c1", message: "cannot be both", when: ["findings.0.presence"], forbid: ["findings.0.status_flags.is_significant"] }], completeness: [] }]]),
    );
    const ctx: ValidationContext = { ...finalizeCtx, aiRules };
    const result = await validateStructuredReport(finalizedDocument(), ctx);
    expect(result.errors.some((e) => e.rule === "R15")).toBe(true);
  });

  it("R16 warns when a completeness rule's required fact is missing", async () => {
    const aiRules = new InMemoryAiRulesRegistryPort(
      new Map([["finding.test.simple", { contradiction: [], completeness: [{ id: "comp1", message: "needs a fact that doesn't exist", require: ["findings.0.nonexistent_fact"] }] }]]),
    );
    const ctx: ValidationContext = { ...draftCtx, aiRules };
    const result = await validateStructuredReport(baseValidDocument(), ctx);
    expect(result.warnings.some((w) => w.rule === "R16")).toBe(true);
  });

  it("warns (does not reject) when no AI rules registry is available (honest gap)", async () => {
    const result = await validateStructuredReport(baseValidDocument(), draftCtx); // UnavailableAiRulesRegistryPort
    expect(result.warnings.some((w) => w.rule === "R15")).toBe(true);
    expect(result.warnings.some((w) => w.rule === "R16")).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe("R17 — critical flags", () => {
  it("rejects a malformed critical_ref (via R1, which owns well-formedness for rec./crit./tpl./combo. uniformly)", async () => {
    const doc = clone(baseValidDocument());
    doc.critical_flags[0].critical_ref = "not_namespaced";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R1" && e.path.endsWith(".critical_ref"))).toBe(true);
  });

  it("rejects a duplicate critical registry key for the same finding", async () => {
    const doc = clone(baseValidDocument());
    doc.critical_flags.push({ ...clone(doc.critical_flags[0]), lid: "crit2" });
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R17" && e.message.includes("duplicate"))).toBe(true);
  });
});

describe("R18 — identifiers", () => {
  it("rejects a malformed document_id", async () => {
    const doc = clone(baseValidDocument());
    doc.document_id = "too-short";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R18" && e.path.endsWith(".document_id"))).toBe(true);
  });

  it("rejects a malformed schema_version", async () => {
    const doc = clone(baseValidDocument());
    doc.schema_version = "v1";
    const result = await validateStructuredReport(doc, draftCtx);
    expect(result.errors.some((e) => e.rule === "R18" && e.path.endsWith(".schema_version"))).toBe(true);
  });
});
