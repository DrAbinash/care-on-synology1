import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderStructuredReport, type RenderResult } from "./renderer";
import { toLegacyReportShape, compareLegacyVsD1 } from "./rendererLegacyAdapter";
import { validateStructuredReport } from "./validator";
import { buildStructuredReportDocument } from "./writer";
import { DrizzleStructuredReportCatalogPort } from "./catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./aiRulesRegistry";
import { seedGoldenCatalog } from "./__fixtures__/seedGoldenCatalog";
import { loadExample } from "./__fixtures__/loadExample";
import { deriveWriterInput } from "./__fixtures__/deriveWriterInput";
import type { StructuredReportDocument, Finding } from "./types";

// Ticket D4 — pure renderer. Assembles D1's pinned strings into deterministic,
// legacy-compatible prose. No catalog, no clock, no mutation, no HTML.

const here = dirname(fileURLToPath(import.meta.url));
const goldenBody = (name: string) => readFileSync(join(here, "__fixtures__", "renderer", `${name}.body.txt`), "utf8");

// ── Minimal builders for the derive-path tests ───────────────────────────────

function mkFinding(p: Partial<Finding>): Finding {
  return {
    lid: "f1", definition_ref: "finding.x.y", presence: "present", certainty: "definite",
    laterality: null, locations: [], severity: null, interval_change: null, parameters: [],
    measurement_refs: [], sentence: "A finding.", impression_fragment: "A finding.",
    sentence_source: "content_pack_default",
    status_flags: { is_significant: false, is_critical: false, is_incidental: false },
    included_from: null,
    provenance: { origin: "quick_select", actor: "dr", created_at: "2026-07-10T09:00:00Z", edited: false },
    ai: null, order: 10, ...p,
  };
}

function mkDoc(fields: Partial<StructuredReportDocument>): StructuredReportDocument {
  return { findings: [], measurements: [], recommendations: [], critical_flags: [], ...fields } as unknown as StructuredReportDocument;
}

const GOLDEN = [
  "example1MriBrain", "example2MriLsSpine", "example3MriCervicalSpine", "example4UsgAbdomen", "example5DopplerCarotid",
] as const;

describe("renderStructuredReport — byte-for-byte golden reports (D1 §17 examples)", () => {
  for (const name of GOLDEN) {
    it(`${name}: body matches the pinned golden AND impression == D1 impression.rendered`, () => {
      const doc = loadExample(`${name}.json`) as StructuredReportDocument;
      const r = renderStructuredReport(doc);
      // Full body is byte-identical to the committed golden.
      expect(r.body).toBe(goldenBody(name));
      // The IMPRESSION block equals the D1-pinned impression.rendered (an
      // independently-authored golden from the frozen spec, not self-generated).
      const impBlock = r.body.split("\n\n").find((p) => p.startsWith("IMPRESSION:"));
      expect(impBlock).toBe(doc.impression!.rendered);
    });
  }
});

describe("renderStructuredReport — empty report", () => {
  it("no findings → empty sections, empty body, no warnings-of-substance", () => {
    const r = renderStructuredReport(mkDoc({ findings: [] }));
    expect(r.findings).toEqual([]);
    expect(r.impression).toEqual([]);
    expect(r.recommendations).toEqual([]);
    expect(r.body).toBe("");
    expect(r.trace).toEqual([]);
  });
});

describe("renderStructuredReport — one finding (derive path)", () => {
  it("emits the pinned sentence and a derived impression line", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ sentence: "Small vessel ischemia.", impression_fragment: "Chronic SVD.", status_flags: { is_significant: true, is_critical: false, is_incidental: false } })],
    }));
    expect(r.findings.map((l) => l.text)).toEqual(["Small vessel ischemia."]);
    expect(r.impression.map((l) => l.text)).toEqual(["Chronic SVD."]);
    expect(r.body).toBe("FINDINGS:\nSmall vessel ischemia.\n\nIMPRESSION:\n1. Chronic SVD.");
  });
});

describe("renderStructuredReport — impression ordering critical → significant → routine (derive)", () => {
  it("orders derived impression by tier regardless of finding order", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [
        mkFinding({ lid: "f1", order: 10, impression_fragment: "Routine one.", status_flags: { is_significant: false, is_critical: false, is_incidental: false } }),
        mkFinding({ lid: "f2", order: 20, impression_fragment: "Critical one.", status_flags: { is_significant: true, is_critical: true, is_incidental: false } }),
        mkFinding({ lid: "f3", order: 30, impression_fragment: "Significant one.", status_flags: { is_significant: true, is_critical: false, is_incidental: false } }),
      ],
    }));
    expect(r.impression.map((l) => l.text)).toEqual(["Critical one.", "Significant one.", "Routine one."]);
    expect(r.impression.map((l) => l.tier)).toEqual(["critical", "significant", "routine"]);
    // findings section preserves D1 order (not tier order)
    expect(r.findings.map((l) => l.findingLid)).toEqual(["f1", "f2", "f3"]);
  });
});

describe("renderStructuredReport — dedup & null handling", () => {
  it("collapses exact-duplicate impression lines", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [
        mkFinding({ lid: "f1", order: 10, impression_fragment: "Same line." }),
        mkFinding({ lid: "f2", order: 20, impression_fragment: "Same line." }),
      ],
    }));
    expect(r.impression.map((l) => l.text)).toEqual(["Same line."]);
  });

  it("a null/empty impression_fragment contributes no impression line", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [
        mkFinding({ lid: "f1", order: 10, sentence: "Visible finding.", impression_fragment: "" }),
        mkFinding({ lid: "f2", order: 20, sentence: "Another.", impression_fragment: "   " }),
      ],
    }));
    expect(r.findings).toHaveLength(2);      // both findings still render
    expect(r.impression).toEqual([]);         // but neither contributes an impression line
    expect(r.warnings.some((w) => w.code === "missing_impression")).toBe(true);
  });
});

describe("renderStructuredReport — pinned content is used verbatim", () => {
  it("laterality baked into the pinned sentence is preserved untouched", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ laterality: "lat.left", sentence: "Disc extrusion on the left at L4–L5." })],
    }));
    expect(r.findings[0].text).toBe("Disc extrusion on the left at L4–L5.");
  });

  it("a measurement embedded in the pinned sentence is preserved (never re-embedded)", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ sentence: "Simple cyst measuring 14 mm in the right lobe.", measurement_refs: ["m1"] })],
      measurements: [{ lid: "m1", measurement_ref: "meas.cyst", finding_ref: "f1", value: 14, unit: "mm", value_kind: "scalar", value_iso: null, range: null, components: null, normal_range: null, abnormal: false, prior_value: null, prior_measurement_ref_document: null, change_pct: null, provenance: { origin: "quick_select", source: "manual", confidence: 1, edited: false }, display: "14 mm" } as any],
    }));
    expect(r.findings[0].text).toBe("Simple cyst measuring 14 mm in the right lobe.");
  });

  it("custom/manual sentence text survives untouched and is traced as manual", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ sentence: "Radiologist's own free-text wording, verbatim.", sentence_source: "manual" })],
    }));
    expect(r.findings[0].text).toBe("Radiologist's own free-text wording, verbatim.");
    const findingTrace = r.trace.find((t) => t.section === "findings");
    expect(findingTrace?.impressionSource).toBe("manual"); // sentence_source carried into the trace
  });
});

describe("renderStructuredReport — recommendations", () => {
  it("renders recommendations in document order (deterministic)", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ impression_fragment: "" })],
      recommendations: [
        { lid: "r1", recommendation_ref: null, finding_refs: ["f1"], text: "First rec.", priority: "routine", provenance: {} as any, ai: null },
        { lid: "r2", recommendation_ref: "rec.followup", finding_refs: ["f1"], text: "Second rec.", priority: "urgent", provenance: {} as any, ai: null },
      ] as any,
    }));
    expect(r.recommendations.map((l) => l.text)).toEqual(["First rec.", "Second rec."]);
    expect(r.body.endsWith("RECOMMENDATION:\nFirst rec.\nSecond rec.")).toBe(true);
  });
});

describe("renderStructuredReport — normal/positive conflict surfaces (rule 7)", () => {
  it("warns when a normal finding coexists with a significant positive finding", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [
        mkFinding({ lid: "f1", presence: "normal", sentence: "No acute abnormality.", impression_fragment: "Normal survey." }),
        mkFinding({ lid: "f2", presence: "present", sentence: "Mass lesion.", impression_fragment: "Mass.", status_flags: { is_significant: true, is_critical: false, is_incidental: false } }),
      ],
    }));
    const w = r.warnings.find((w) => w.code === "normal_positive_coexistence");
    expect(w).toBeDefined();
    expect(w!.findingLids).toEqual(["f1", "f2"]);
  });

  it("does NOT warn for a normal finding + incidental-only positive (matches 'otherwise normal with incidental')", () => {
    const r = renderStructuredReport(mkDoc({
      findings: [
        mkFinding({ lid: "f1", presence: "normal", impression_fragment: "Normal." }),
        mkFinding({ lid: "f2", presence: "present", impression_fragment: "Incidental cyst.", status_flags: { is_significant: false, is_critical: false, is_incidental: true } }),
      ],
    }));
    expect(r.warnings.some((w) => w.code === "normal_positive_coexistence")).toBe(false);
  });
});

describe("renderStructuredReport — purity & determinism", () => {
  it("is deterministic: same input → byte-identical output", () => {
    const doc = loadExample("example5DopplerCarotid.json") as StructuredReportDocument;
    expect(renderStructuredReport(doc).body).toBe(renderStructuredReport(doc).body);
  });

  it("does not mutate its input (deeply frozen document renders without throwing)", () => {
    const doc = deepFreeze(loadExample("example2MriLsSpine.json")) as StructuredReportDocument;
    expect(() => renderStructuredReport(doc)).not.toThrow();
    const r = renderStructuredReport(doc);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it("takes no catalog/DB dependency (renders a document that references keys with NO resolver available)", () => {
    // definition_ref/meas refs point at keys the renderer never resolves — it
    // only reads pinned strings, so rendering succeeds with no catalog at all.
    const r = renderStructuredReport(mkDoc({
      findings: [mkFinding({ definition_ref: "finding.nonexistent.key.never.resolved", sentence: "Pinned sentence stands alone." })],
    }));
    expect(r.findings[0].text).toBe("Pinned sentence stands alone.");
  });
});

describe("renderStructuredReport — render trace (Phase 4)", () => {
  it("every non-heading body line is traceable to a source", () => {
    const doc = loadExample("example2MriLsSpine.json") as StructuredReportDocument;
    const r = renderStructuredReport(doc);
    // Collect the content lines of the body (drop headings + blank lines).
    const contentLines = r.body
      .split("\n")
      .filter((l) => l.trim() && !/^[A-Z]+:$/.test(l.trim()));
    const tracedTexts = new Set(r.trace.flatMap((t) => t.text.split("\n")));
    for (const line of contentLines) {
      const bare = line.replace(/^\s*\d+[.)]\s+/, ""); // strip impression numbering for the match
      expect([...tracedTexts].some((t) => t.includes(bare) || bare.includes(t))).toBe(true);
    }
    // Every trace entry carries a source type and a section.
    for (const t of r.trace) {
      expect(t.sourceType).toBeTruthy();
      expect(["technique", "findings", "impression", "recommendation"]).toContain(t.section);
    }
  });
});

describe("D4 — writer → validator → renderer round trip", () => {
  it("a document built by the D2 writer, validated, renders to non-empty prose", async () => {
    const store = await seedGoldenCatalog();
    const input = deriveWriterInput(loadExample("example2MriLsSpine.json"));
    const { document } = buildStructuredReportDocument(input, "draft");
    const validation = await validateStructuredReport(document, {
      catalog: new DrizzleStructuredReportCatalogPort(store), aiRules: new UnavailableAiRulesRegistryPort(), mode: "draft",
    });
    expect(validation.ok).toBe(true);
    const r = renderStructuredReport(document);
    expect(r.body).toContain("FINDINGS:");
    expect(r.body).toContain("IMPRESSION:");
  });
});

describe("D4 — legacy compatibility adapter (Phase 3)", () => {
  it("maps renderer output into the legacy draft field shape", () => {
    const doc = loadExample("example2MriLsSpine.json") as StructuredReportDocument;
    const legacy = toLegacyReportShape(renderStructuredReport(doc));
    expect(Object.keys(legacy.findingsSections)).toEqual(["FINDINGS"]);
    expect(legacy.findingsSections.FINDINGS).toContain("disc extrusion");
    // pinned "1. …" numbering is stripped for the legacy bullet array
    expect(legacy.impression[0].startsWith("1. ")).toBe(false);
    expect(legacy.impression[0]).toContain("L4–L5 left paracentral disc extrusion");
    expect(legacy.recommendation).toContain("Clinical correlation");
    expect(legacy.formattedReportText).toBe(renderStructuredReport(doc).body);
  });

  it("compareLegacyVsD1 reports field differences (never silently coalesces)", () => {
    const doc = loadExample("example2MriLsSpine.json") as StructuredReportDocument;
    const a = toLegacyReportShape(renderStructuredReport(doc));
    const b: typeof a = { ...a, recommendation: a.recommendation + " EXTRA" };
    const cmp = compareLegacyVsD1(a, b);
    expect(cmp.identical).toBe(false);
    expect(cmp.differences.some((d) => d.field === "recommendation")).toBe(true);
    // identical inputs → identical
    expect(compareLegacyVsD1(a, a).identical).toBe(true);
  });
});

// ── util ──
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
