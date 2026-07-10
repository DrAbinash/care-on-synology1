import { InMemoryCatalogStore } from "../../radiologyCatalog/store";

/** A minimal parameter group + one or more options, option-typed unless noted. */
interface ParamSpec {
  key: string;
  dataType: "option" | "boolean";
  options?: string[];
}

/** A finding and everything the D1 §17 worked examples bind to it. */
interface FindingSpec {
  key: string;
  params?: ParamSpec[]; // params this finding binds (option/boolean groups shared across findings are declared once; see PARAM_SPECS below)
  severities?: string[];
  locations?: string[];
  measurements?: Array<{ key: string; unit: string }>;
}

/** Every param group referenced across the five golden examples, declared once (GLOBAL, §1.4). */
const PARAM_SPECS: ParamSpec[] = [
  { key: "signal", dataType: "option", options: ["t2_flair_hyper"] },
  { key: "disc_level", dataType: "option", options: ["l4_l5", "c5_c6"] },
  { key: "herniation_type", dataType: "option", options: ["paracentral_left"] },
  { key: "nerve_root_contact", dataType: "boolean" },
  { key: "myelomalacia", dataType: "boolean" },
  { key: "echogenicity", dataType: "option", options: ["anechoic"] },
  { key: "margin", dataType: "option", options: ["well_defined"] },
  { key: "posterior_enhancement", dataType: "boolean" },
  { key: "plaque_morphology", dataType: "option", options: ["heterogeneous"] },
  { key: "plaque_surface", dataType: "option", options: ["irregular"] },
];

/** The ten findings referenced across the five golden examples (D1 §17), with the
 * finding-scoped severity/location/measurement bindings and parameter bindings
 * each example actually uses. Params reference PARAM_SPECS by key. */
const FINDING_SPECS: Array<FindingSpec & { paramKeys?: string[] }> = [
  { key: "brain.normal_survey" },
  { key: "brain.small_vessel_ischemia", paramKeys: ["signal"], severities: ["fazekas_2"], locations: ["periventricular", "deep_white_matter"] },
  { key: "spine.disc_herniation", paramKeys: ["disc_level", "herniation_type", "nerve_root_contact"], severities: ["extrusion"], locations: ["l4_l5"] },
  { key: "spine.canal_stenosis", severities: ["moderate"], locations: ["l4_l5"], measurements: [{ key: "canal_ap_diameter", unit: "mm" }] },
  { key: "spine.cord_compression", paramKeys: ["disc_level", "myelomalacia"], severities: ["severe"], locations: ["c5_c6"], measurements: [{ key: "canal_ap_diameter", unit: "mm" }] },
  { key: "abdomen.normal_survey", measurements: [{ key: "liver_span", unit: "mm" }, { key: "kidney_length", unit: "mm" }] },
  { key: "liver.simple_cyst", paramKeys: ["echogenicity", "margin", "posterior_enhancement"], locations: ["right_lobe"], measurements: [{ key: "cyst_diameter", unit: "mm" }] },
  { key: "carotid.stenosis", paramKeys: ["plaque_morphology", "plaque_surface"], severities: ["stenosis_70_99"], locations: ["ica_proximal"], measurements: [{ key: "doppler_psv", unit: "cm/s" }, { key: "doppler_edv", unit: "cm/s" }, { key: "doppler_ica_cca_ratio", unit: "1" }, { key: "doppler_ri", unit: "1" }] },
  { key: "carotid.normal", locations: ["ica_proximal"], measurements: [{ key: "doppler_psv", unit: "cm/s" }] },
];

/** Seeds an InMemoryCatalogStore with exactly the B1/B2 rows the five D1 §17
 * worked examples reference, so the golden-examples test exercises the real
 * R1/R4/R5/R6/R8 catalog-resolution rules rather than mocking them away. */
export async function seedGoldenCatalog(): Promise<InMemoryCatalogStore> {
  const store = new InMemoryCatalogStore(() => new Date("2026-07-09T00:00:00Z"));

  const category = await store.insert("finding_categories", { key: "golden_fixtures", label: "Golden Fixtures" });

  const paramGroupIdByKey = new Map<string, number>();
  for (const p of PARAM_SPECS) {
    const group = await store.insert("parameter_groups", { key: p.key, label: p.key, dataType: p.dataType, allowMultiple: false });
    paramGroupIdByKey.set(p.key, group.id);
    for (const optKey of p.options ?? []) {
      await store.insert("parameter_options", { groupId: group.id, key: optKey, label: optKey, sortOrder: 0 });
    }
  }

  for (const f of FINDING_SPECS) {
    const finding = await store.insert("finding_definitions", { key: f.key, categoryId: category.id, label: f.key });

    for (const paramKey of f.paramKeys ?? []) {
      const groupId = paramGroupIdByKey.get(paramKey);
      if (groupId == null) throw new Error(`seedGoldenCatalog: unknown param spec "${paramKey}"`);
      await store.insert("finding_parameter_bindings", { findingId: finding.id, parameterGroupId: groupId, required: false, sortOrder: 0 });
    }
    for (const sevKey of f.severities ?? []) {
      await store.insert("finding_severity_bindings", { findingId: finding.id, key: sevKey, label: sevKey, rank: 0, sortOrder: 0 });
    }
    for (const locKey of f.locations ?? []) {
      await store.insert("finding_locations", { findingId: finding.id, key: locKey, label: locKey, sortOrder: 0 });
    }
    for (const m of f.measurements ?? []) {
      await store.insert("finding_measurement_bindings", { findingId: finding.id, key: m.key, label: m.key, unit: m.unit, valueType: "numeric", sortOrder: 0 });
    }
  }

  return store;
}
