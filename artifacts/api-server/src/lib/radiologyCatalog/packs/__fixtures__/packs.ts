// Developer fixtures for the content-pack pipeline (Tickets K1/K2/K3).
// SYNTHETIC test data only — NOT canonical clinical content. The real packs live
// in another branch; this pipeline is designed to run unchanged once they merge.

import { loadPackFromString } from "../loader";
import type { LoadedPack } from "../types";

export function load(source: string, yaml: string): LoadedPack {
  return loadPackFromString(source, yaml);
}
export function loadAll(...packs: [string, string][]): LoadedPack[] {
  return packs.map(([s, y]) => load(s, y));
}

// A complete, valid pack exercising every reference kind.
export const VALID_PACK = `
schema_version: "1.0.0"
pack:
  id: test.demo
  version: "1.0.0"
  modality: DEMO
parameters:
  - key: shade
    label: Shade
    data_type: option
    options:
      - { key: light, label: Light }
      - { key: dark, label: Dark }
severities:
  - { key: sev_low, label: Low, rank: 1 }
  - { key: sev_high, label: High, rank: 2 }
locations:
  - { key: north, label: North region, laterality: left }
  - { key: south, label: South region }
recommendations:
  - { code: watch, text: "Observe over time.", priority: routine }
criticals:
  - { key: alarm, label: Alarm state }
templates:
  - { key: demo_tpl, label: Demo template }
categories:
  - { key: shapes, display_name: Shapes }
  - { key: round_shapes, display_name: Round shapes, parent: shapes }
findings:
  - id_key: shapes.circle
    display_name: Circle
    category: round_shapes
    default_sentence: "A {shade} circle in the {location}."
    impression_fragment: "Circle noted."
    keyboard_alias: circ
    aliases: ["round thing", "disc"]
    parameters:
      - { ref: param.shade, required: true, default: param.shade.light }
    severities: [sev.sev_low]
    locations: [loc.north]
    measurements:
      - { key: radius, label: Radius, unit: mm, min: 0, max: 500 }
    recommendations: [rec.watch]
    criticals: [crit.alarm]
    template: tpl.demo_tpl
    ai_contradiction_rules:
      - { id: c1, message: "circle cannot be square", when: ["shapes.circle"], forbid: ["shapes.square"] }
    ai_completeness_rules:
      - { id: r1, message: "shade required", require: ["param.shade"] }
`;

// Base + child using `extends` (child inherits base bindings).
export const EXTENDS_PACK = `
schema_version: "1.0.0"
pack: { id: test.extends, version: "1.0.0" }
parameters:
  - { key: shade, label: Shade, data_type: option, options: [ { key: light, label: Light } ] }
severities:
  - { key: base_sev, label: Base severity, rank: 1 }
locations:
  - { key: base_loc, label: Base location }
categories:
  - { key: base_cat, display_name: Base category }
findings:
  - id_key: base.shape
    display_name: Base shape
    category: base_cat
    default_sentence: "Base."
    impression_fragment: "Base."
    parameters: [ { ref: param.shade } ]
    severities: [sev.base_sev]
    locations: [loc.base_loc]
  - id_key: child.shape
    display_name: Child shape
    category: base_cat
    default_sentence: "Child."
    impression_fragment: "Child."
    extends: base.shape
    measurements: [ { key: size, label: Size, unit: mm } ]
`;

// Combo: a finding that includes others.
export const COMBO_PACK = `
schema_version: "1.0.0"
pack: { id: test.combo, version: "1.0.0" }
categories:
  - { key: c, display_name: C }
findings:
  - { id_key: leaf.a, display_name: A, category: c, default_sentence: "A", impression_fragment: "A" }
  - { id_key: leaf.b, display_name: B, category: c, default_sentence: "B", impression_fragment: "B" }
  - id_key: combo.all
    display_name: All
    category: c
    default_sentence: "All"
    impression_fragment: "All"
    included_findings_ref: [leaf.a, leaf.b]
`;

/** Mutate the VALID_PACK YAML by string replacement to produce targeted invalids. */
export function mutate(replacements: [string | RegExp, string][]): string {
  let y = VALID_PACK;
  for (const [from, to] of replacements) y = y.replace(from, to);
  return y;
}
