// ─────────────────────────────────────────────────────────────────────────────
// Graph normalizer — turns validated packs into fully-resolved, normalized
// catalog objects: assembles shared-library registries, resolves `extends`
// inheritance (child overrides base bindings), expands combos, and resolves
// every finding ref (severity/location/recommendation) to its registry
// definition so the importer has complete rows. Assumes the packs already
// passed validatePacks() (call buildNormalizedGraph only on ok:true input).
// ─────────────────────────────────────────────────────────────────────────────

import { stripPrefix, type ContentPack, type FindingDecl, type LoadedPack } from "./types";

export interface NormParamOption { key: string; label: string; code_system: string | null; code_value: string | null; }
export interface NormParam { key: string; label: string; data_type: string; unit: string | null; allow_multiple: boolean; options: NormParamOption[]; }
export interface NormCategory { key: string; display_name: string; parent: string | null; modality: string | null; }
export interface NormParamBinding { param_key: string; required: boolean; default_option_key: string | null; sort_order: number; }
export interface NormSeverity { key: string; label: string; rank: number; sort_order: number; }
export interface NormLocation { key: string; label: string; laterality: string | null; sort_order: number; }
export interface NormMeasurement { key: string; label: string; unit: string; min: number | null; max: number | null; sort_order: number; }
export interface NormRecommendation { code: string; text: string; priority: string | null; sort_order: number; }
export interface NormFinding {
  id_key: string; display_name: string; category: string;
  narrative: string; impression: string; status: string;
  aliases: string[]; keyboard_alias: string | null;
  parameters: NormParamBinding[]; severities: NormSeverity[]; locations: NormLocation[];
  measurements: NormMeasurement[]; recommendations: NormRecommendation[];
  included: string[];
  meta: { criticals: string[]; template: string | null; source_pack: string };
}
export interface NormalizedGraph {
  parameters: NormParam[];
  categories: NormCategory[];
  findings: NormFinding[];
}

interface Registries {
  params: Map<string, NormParam>;
  severities: Map<string, { label: string; rank: number }>;
  locations: Map<string, { label: string; laterality: string | null }>;
  recommendations: Map<string, { text: string; priority: string | null }>;
  categories: Map<string, NormCategory>;
  findings: Map<string, { f: FindingDecl; source: string }>;
}

function assemble(packs: { lp: LoadedPack; p: ContentPack }[]): Registries {
  const r: Registries = { params: new Map(), severities: new Map(), locations: new Map(), recommendations: new Map(), categories: new Map(), findings: new Map() };
  for (const { lp, p } of packs) {
    for (const g of p.parameters ?? []) {
      r.params.set(g.key, {
        key: g.key, label: g.label, data_type: g.data_type ?? "option", unit: g.unit ?? null,
        allow_multiple: g.allow_multiple ?? false,
        options: (g.options ?? []).map((o) => ({ key: o.key, label: o.label, code_system: o.code_system ?? null, code_value: o.code_value ?? null })),
      });
    }
    for (const s of p.severities ?? []) r.severities.set(s.key, { label: s.label, rank: s.rank ?? 0 });
    for (const l of p.locations ?? []) r.locations.set(l.key, { label: l.label, laterality: l.laterality ?? null });
    for (const rec of p.recommendations ?? []) r.recommendations.set(rec.code, { text: rec.text, priority: rec.priority ?? null });
    for (const c of p.categories ?? []) r.categories.set(c.key, { key: c.key, display_name: c.display_name, parent: c.parent ?? null, modality: c.modality ?? null });
    for (const f of p.findings ?? []) r.findings.set(f.id_key, { f, source: lp.source });
  }
  return r;
}

/** Resolve a finding's bindings including inherited (extends) bindings. Memoized. */
function resolveBindings(idKey: string, reg: Registries, memo: Map<string, ResolvedBindings>): ResolvedBindings {
  const cached = memo.get(idKey);
  if (cached) return cached;
  const entry = reg.findings.get(idKey);
  if (!entry) return { params: new Map(), severities: new Set(), locations: new Set(), measurements: new Map(), recommendations: new Set(), aliases: new Set() };
  const f = entry.f;
  const base = f.extends ? resolveBindings(f.extends, reg, memo) : { params: new Map(), severities: new Set(), locations: new Set(), measurements: new Map(), recommendations: new Set(), aliases: new Set() } as ResolvedBindings;

  const out: ResolvedBindings = {
    params: new Map(base.params),
    severities: new Set(base.severities),
    locations: new Set(base.locations),
    measurements: new Map(base.measurements),
    recommendations: new Set(base.recommendations),
    aliases: new Set(base.aliases),
  };
  (f.parameters ?? []).forEach((pb, i) => {
    const key = stripPrefix(pb.ref, "param");
    out.params.set(key, { required: pb.required ?? false, default_option_key: pb.default ? (pb.default.includes(".") ? pb.default.split(".").slice(-1)[0] : pb.default) : null, sort_order: pb.sort_order ?? i });
  });
  (f.severities ?? []).forEach((s) => out.severities.add(stripPrefix(s, "sev")));
  (f.locations ?? []).forEach((l) => out.locations.add(stripPrefix(l, "loc")));
  (f.measurements ?? []).forEach((m, i) => out.measurements.set(m.key, { label: m.label, unit: m.unit ?? "mm", min: m.min ?? null, max: m.max ?? null, sort_order: i }));
  (f.recommendations ?? []).forEach((r) => out.recommendations.add(stripPrefix(r, "rec")));
  (f.aliases ?? []).forEach((a) => out.aliases.add(a));
  memo.set(idKey, out);
  return out;
}
interface ResolvedBindings {
  params: Map<string, { required: boolean; default_option_key: string | null; sort_order: number }>;
  severities: Set<string>;
  locations: Set<string>;
  measurements: Map<string, { label: string; unit: string; min: number | null; max: number | null; sort_order: number }>;
  recommendations: Set<string>;
  aliases: Set<string>;
}

export function buildNormalizedGraph(loaded: LoadedPack[]): NormalizedGraph {
  const packs = loaded.filter((lp) => lp.parsed).map((lp) => ({ lp, p: lp.parsed! }));
  const reg = assemble(packs);
  const memo = new Map<string, ResolvedBindings>();

  const findings: NormFinding[] = [];
  for (const [idKey, { f, source }] of reg.findings) {
    const rb = resolveBindings(idKey, reg, memo);
    findings.push({
      id_key: idKey, display_name: f.display_name, category: f.category,
      narrative: f.default_sentence, impression: f.impression_fragment, status: f.status ?? "draft",
      aliases: [...rb.aliases], keyboard_alias: f.keyboard_alias ?? null,
      parameters: [...rb.params].map(([param_key, v]) => ({ param_key, required: v.required, default_option_key: v.default_option_key, sort_order: v.sort_order })),
      severities: [...rb.severities].map((key, i) => ({ key, label: reg.severities.get(key)?.label ?? key, rank: reg.severities.get(key)?.rank ?? 0, sort_order: i })),
      locations: [...rb.locations].map((key, i) => ({ key, label: reg.locations.get(key)?.label ?? key, laterality: reg.locations.get(key)?.laterality ?? null, sort_order: i })),
      measurements: [...rb.measurements].map(([key, v]) => ({ key, label: v.label, unit: v.unit, min: v.min, max: v.max, sort_order: v.sort_order })),
      recommendations: [...rb.recommendations].map((code, i) => ({ code, text: reg.recommendations.get(code)?.text ?? code, priority: reg.recommendations.get(code)?.priority ?? null, sort_order: i })),
      included: [...(f.included_findings_ref ?? [])],
      meta: { criticals: [...(f.criticals ?? [])].map((c) => stripPrefix(c, "crit")), template: f.template ? stripPrefix(f.template, "tpl") : null, source_pack: source },
    });
  }

  return {
    parameters: [...reg.params.values()],
    categories: [...reg.categories.values()],
    findings: findings.sort((a, b) => a.id_key.localeCompare(b.id_key)),
  };
}

/** Transitively expand a combo finding into the set of finding id_keys it includes. */
export function expandCombo(graph: NormalizedGraph, idKey: string): string[] {
  const byKey = new Map(graph.findings.map((f) => [f.id_key, f]));
  const out = new Set<string>();
  const walk = (k: string) => {
    const f = byKey.get(k);
    if (!f) return;
    for (const inc of f.included) {
      if (!out.has(inc)) { out.add(inc); walk(inc); }
    }
  };
  walk(idKey);
  return [...out];
}
