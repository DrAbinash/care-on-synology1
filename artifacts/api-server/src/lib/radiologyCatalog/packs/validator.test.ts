import { describe, it, expect } from "vitest";
import { validatePacks } from "./validator";
import { emptyCatalogSnapshot } from "./snapshot";
import { load, loadAll, VALID_PACK, EXTENDS_PACK, COMBO_PACK, mutate } from "./__fixtures__/packs";

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe("K1 validator — happy path", () => {
  it("a complete valid pack passes with no errors", () => {
    const r = validatePacks([load("valid", VALID_PACK)]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("valid extends + combo packs pass", () => {
    expect(validatePacks([load("e", EXTENDS_PACK)]).ok).toBe(true);
    expect(validatePacks([load("c", COMBO_PACK)]).ok).toBe(true);
  });
});

describe("K1 validator — syntax, schema version, required fields", () => {
  it("reports YAML parse errors", () => {
    const r = validatePacks([load("bad", "findings:\n  - id_key: [oops")]);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("YAML_PARSE_ERROR");
  });
  it("rejects unsupported schema_version major", () => {
    const r = validatePacks([load("v2", mutate([['"1.0.0"', '"2.0.0"']]))]);
    expect(codes(r)).toContain("SCHEMA_VERSION_UNSUPPORTED");
  });
  it("flags a missing required finding field", () => {
    const r = validatePacks([load("m", mutate([["    impression_fragment: \"Circle noted.\"", ""]]))]);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("MISSING_REQUIRED_FIELD");
  });
});

describe("K1 validator — duplicates & aliases", () => {
  it("duplicate id_key across findings fails", () => {
    const dup = VALID_PACK + `
  - id_key: shapes.circle
    display_name: Dup
    category: round_shapes
    default_sentence: "x"
    impression_fragment: "x"
`;
    expect(codes(validatePacks([load("d", dup)]))).toContain("DUPLICATE_ID_KEY");
  });
  it("duplicate alias across findings fails (normalized)", () => {
    const p2 = mutate([["id_key: shapes.circle", "id_key: shapes.square"], ["aliases: [\"round thing\", \"disc\"]", "aliases: [\"Round  Thing\"]"], ["keyboard_alias: circ", "keyboard_alias: sq"]]);
    // two packs, each defining an alias that normalizes identically
    const r = validatePacks(loadAll(["a", VALID_PACK], ["b", p2]));
    expect(codes(r)).toContain("DUPLICATE_ALIAS");
  });
  it("alias-prefix collision within a pack fails", () => {
    const p = VALID_PACK + `
  - id_key: shapes.circle2
    display_name: Circle2
    category: round_shapes
    default_sentence: "x"
    impression_fragment: "x"
    keyboard_alias: circle
`; // "circ" is a prefix of "circle"
    expect(codes(validatePacks([load("p", p)]))).toContain("ALIAS_PREFIX_COLLISION");
  });
  it("duplicate alias against the existing catalog (different owner) fails", () => {
    const snap = emptyCatalogSnapshot();
    snap.aliasOwner.set("disc", "some.other.finding");
    expect(codes(validatePacks([load("v", VALID_PACK)], snap))).toContain("DUPLICATE_ALIAS");
  });
  it("a finding re-importing its OWN alias is not a duplicate", () => {
    const snap = emptyCatalogSnapshot();
    snap.aliasOwner.set("disc", "shapes.circle"); // same owner → allowed
    expect(validatePacks([load("v", VALID_PACK)], snap).ok).toBe(true);
  });
});

describe("K1 validator — unknown shared-library references", () => {
  const cases: [string, string, string][] = [
    ["param", "ref: param.shade", "ref: param.nope"],
    ["severity", "severities: [sev.sev_low]", "severities: [sev.nope]"],
    ["location", "locations: [loc.north]", "locations: [loc.nope]"],
    ["recommendation", "recommendations: [rec.watch]", "recommendations: [rec.nope]"],
    ["critical", "criticals: [crit.alarm]", "criticals: [crit.nope]"],
    ["template", "template: tpl.demo_tpl", "template: tpl.nope"],
    ["category", "category: round_shapes", "category: nope"],
  ];
  const expected: Record<string, string> = {
    param: "UNKNOWN_PARAM_REF", severity: "UNKNOWN_SEVERITY_REF", location: "UNKNOWN_LOCATION_REF",
    recommendation: "UNKNOWN_RECOMMENDATION_REF", critical: "UNKNOWN_CRITICAL_REF", template: "UNKNOWN_TEMPLATE_REF",
    category: "UNKNOWN_CATEGORY_REF",
  };
  for (const [name, from, to] of cases) {
    it(`unknown ${name} reference fails`, () => {
      expect(codes(validatePacks([load("u", mutate([[from, to]]))]))).toContain(expected[name]);
    });
  }
});

describe("K1 validator — bindings & enums", () => {
  it("invalid parameter default (not an option) fails", () => {
    expect(codes(validatePacks([load("b", mutate([["default: param.shade.light", "default: param.shade.purple"]]))]))).toContain("INVALID_PARAM_BINDING");
  });
  it("invalid measurement binding (min > max) fails", () => {
    expect(codes(validatePacks([load("b", mutate([["min: 0, max: 500", "min: 9, max: 1"]]))]))).toContain("INVALID_MEASUREMENT_BINDING");
  });
  it("invalid enum (data_type) fails", () => {
    expect(codes(validatePacks([load("b", mutate([["data_type: option", "data_type: nonsense"]]))]))).toContain("INVALID_ENUM");
  });
  it("immutable id_key case-rename against catalog fails", () => {
    const snap = emptyCatalogSnapshot();
    snap.findingKeys.add("shapes.CIRCLE");
    expect(codes(validatePacks([load("v", VALID_PACK)], snap))).toContain("IMMUTABLE_ID_KEY_VIOLATION");
  });
  it("malformed AI rule (empty forbid) fails", () => {
    expect(codes(validatePacks([load("b", mutate([['forbid: ["shapes.square"]', "forbid: []"]]))]))).toContain("MISSING_AI_SECTION");
  });
});

describe("K1 validator — extends & combo graph", () => {
  it("unknown extends target fails", () => {
    const p = EXTENDS_PACK.replace("extends: base.shape", "extends: does.not.exist");
    expect(codes(validatePacks([load("e", p)]))).toContain("UNKNOWN_EXTENDS_REF");
  });
  it("circular extends fails", () => {
    const p = `
schema_version: "1.0.0"
pack: { id: cyc, version: "1.0.0" }
categories: [ { key: c, display_name: C } ]
findings:
  - { id_key: a, display_name: A, category: c, default_sentence: x, impression_fragment: x, extends: b }
  - { id_key: b, display_name: B, category: c, default_sentence: x, impression_fragment: x, extends: a }
`;
    expect(codes(validatePacks([load("cyc", p)]))).toContain("CIRCULAR_EXTENDS");
  });
  it("unknown combo (included_findings_ref) fails", () => {
    const p = COMBO_PACK.replace("[leaf.a, leaf.b]", "[leaf.a, leaf.missing]");
    expect(codes(validatePacks([load("c", p)]))).toContain("INVALID_COMBO_REF");
  });
});

describe("K1 validator — NO PARTIAL SUCCESS", () => {
  it("any single error makes the whole result not-ok", () => {
    const r = validatePacks([load("v", VALID_PACK), load("bad", "not: [valid")]);
    expect(r.ok).toBe(false);
  });
});
