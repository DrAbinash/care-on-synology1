// ─────────────────────────────────────────────────────────────────────────────
// K1 — YAML content-pack validator.
//
// Validates a whole set of packs (never a single pack in isolation, since ids
// and aliases must be unique ACROSS packs) against an optional CatalogSnapshot.
// Pure and deterministic: (loadedPacks, snapshot) → ValidationResult. NO DB, NO
// writes. NO PARTIAL SUCCESS — any error ⇒ ok:false and the importer must refuse.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DATA_TYPES, PRIORITIES, LATERALITIES, SUPPORTED_MAJOR, normalizeAlias, stripPrefix,
  type LoadedPack, type ContentPack, type FindingDecl, type PackIssue, type ValidationResult,
} from "./types";
import { emptyCatalogSnapshot, type CatalogSnapshot } from "./snapshot";

const KEY_RE = /^[a-z0-9][a-z0-9._:-]*$/; // mirrors B1/B2 catalog key format

interface Ctx {
  errors: PackIssue[];
  warnings: PackIssue[];
  snapshot: CatalogSnapshot;
  // registries assembled from all packs (declared) + snapshot (existing)
  params: Map<string, { data_type: string; options: Set<string> }>;
  severities: Set<string>;
  locations: Set<string>;
  recommendations: Set<string>;
  criticals: Set<string>;
  templates: Set<string>;
  categories: Set<string>;
  findingKeys: Set<string>;              // all id_keys (declared + snapshot)
  findingById: Map<string, FindingDecl>; // declared findings by id_key (for extends/combo resolution)
}

function err(ctx: Ctx, code: PackIssue["code"], message: string, pack?: string, path?: string, detail?: Record<string, unknown>): void {
  ctx.errors.push({ code, severity: "error", pack, path, message, detail });
}
function warn(ctx: Ctx, code: PackIssue["code"], message: string, pack?: string, path?: string): void {
  ctx.warnings.push({ code, severity: "warning", pack, path, message });
}

// ── Phase 1: syntax + schema version + required top-level fields ──────────────

function checkEnvelope(ctx: Ctx, lp: LoadedPack): ContentPack | null {
  if (!lp.parsed) {
    err(ctx, "YAML_PARSE_ERROR", `YAML parse failed: ${lp.parseError}`, lp.source);
    return null;
  }
  const p = lp.parsed;
  if (!p.schema_version) err(ctx, "MISSING_REQUIRED_FIELD", "Missing schema_version", lp.source, "schema_version");
  else {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(p.schema_version);
    if (!m) err(ctx, "INVALID_ENUM", `Malformed schema_version "${p.schema_version}"`, lp.source, "schema_version");
    else if (Number(m[1]) !== SUPPORTED_MAJOR) {
      err(ctx, "SCHEMA_VERSION_UNSUPPORTED", `schema_version ${p.schema_version} incompatible with importer major ${SUPPORTED_MAJOR}`, lp.source, "schema_version");
    }
  }
  if (!p.pack) err(ctx, "MISSING_REQUIRED_FIELD", "Missing pack metadata", lp.source, "pack");
  else {
    if (!p.pack.id) err(ctx, "MISSING_REQUIRED_FIELD", "Missing pack.id", lp.source, "pack.id");
    if (!p.pack.version) err(ctx, "MISSING_REQUIRED_FIELD", "Missing pack.version", lp.source, "pack.version");
  }
  return p;
}

// ── Phase 2: assemble shared-library registries (declared ∪ snapshot) ─────────

function assembleRegistries(ctx: Ctx, packs: { lp: LoadedPack; p: ContentPack }[]): void {
  // seed from existing catalog snapshot
  for (const k of ctx.snapshot.parameterKeys) ctx.params.set(k, { data_type: "option", options: ctx.snapshot.parameterOptions.get(k) ?? new Set() });
  ctx.snapshot.categoryKeys.forEach((k) => ctx.categories.add(k));
  ctx.snapshot.findingKeys.forEach((k) => ctx.findingKeys.add(k));
  ctx.snapshot.severityKeys.forEach((k) => ctx.severities.add(k));
  ctx.snapshot.locationKeys.forEach((k) => ctx.locations.add(k));
  ctx.snapshot.recommendationKeys.forEach((k) => ctx.recommendations.add(k));
  ctx.snapshot.criticalKeys.forEach((k) => ctx.criticals.add(k));
  ctx.snapshot.templateKeys.forEach((k) => ctx.templates.add(k));

  const seenLib = { param: new Set<string>(), sev: new Set<string>(), loc: new Set<string>(), rec: new Set<string>(), crit: new Set<string>(), tpl: new Set<string>(), cat: new Set<string>() };
  const declareUnique = (bag: Set<string>, key: string, kind: keyof typeof seenLib, src: string, path: string) => {
    if (seenLib[kind].has(key)) err(ctx, "DUPLICATE_LIBRARY_KEY", `Duplicate ${kind} library key "${key}"`, src, path);
    seenLib[kind].add(key);
    bag.add(key);
  };

  for (const { lp, p } of packs) {
    (p.parameters ?? []).forEach((g, i) => {
      if (!KEY_RE.test(g.key ?? "")) err(ctx, "INVALID_KEY", `Invalid parameter key "${g.key}"`, lp.source, `parameters[${i}].key`);
      if (g.data_type && !DATA_TYPES.includes(g.data_type)) err(ctx, "INVALID_ENUM", `Invalid data_type "${g.data_type}"`, lp.source, `parameters[${i}].data_type`);
      const options = new Set<string>();
      (g.options ?? []).forEach((o, j) => {
        if (!KEY_RE.test(o.key ?? "")) err(ctx, "INVALID_KEY", `Invalid option key "${o.key}"`, lp.source, `parameters[${i}].options[${j}].key`);
        if (options.has(o.key)) err(ctx, "DUPLICATE_LIBRARY_KEY", `Duplicate option "${o.key}" in parameter "${g.key}"`, lp.source, `parameters[${i}].options[${j}]`);
        options.add(o.key);
      });
      if (seenLib.param.has(g.key)) err(ctx, "DUPLICATE_LIBRARY_KEY", `Duplicate parameter "${g.key}"`, lp.source, `parameters[${i}]`);
      seenLib.param.add(g.key);
      ctx.params.set(g.key, { data_type: g.data_type ?? "option", options });
    });
    (p.severities ?? []).forEach((s, i) => declareUnique(ctx.severities, s.key, "sev", lp.source, `severities[${i}]`));
    (p.locations ?? []).forEach((l, i) => {
      if (l.laterality && !LATERALITIES.includes(l.laterality)) err(ctx, "INVALID_ENUM", `Invalid laterality "${l.laterality}"`, lp.source, `locations[${i}].laterality`);
      declareUnique(ctx.locations, l.key, "loc", lp.source, `locations[${i}]`);
    });
    (p.recommendations ?? []).forEach((r, i) => {
      if (r.priority && !PRIORITIES.includes(r.priority)) err(ctx, "INVALID_ENUM", `Invalid priority "${r.priority}"`, lp.source, `recommendations[${i}].priority`);
      declareUnique(ctx.recommendations, r.code, "rec", lp.source, `recommendations[${i}]`);
    });
    (p.criticals ?? []).forEach((c, i) => declareUnique(ctx.criticals, c.key, "crit", lp.source, `criticals[${i}]`));
    (p.templates ?? []).forEach((t, i) => declareUnique(ctx.templates, t.key, "tpl", lp.source, `templates[${i}]`));
    (p.categories ?? []).forEach((c, i) => {
      if (!KEY_RE.test(c.key ?? "")) err(ctx, "INVALID_KEY", `Invalid category key "${c.key}"`, lp.source, `categories[${i}].key`);
      declareUnique(ctx.categories, c.key, "cat", lp.source, `categories[${i}]`);
    });
  }
}

// ── Phase 3: findings — ids, aliases, refs, bindings, ai, enums ───────────────

function checkFindings(ctx: Ctx, packs: { lp: LoadedPack; p: ContentPack }[]): void {
  const seenId = new Set<string>();
  const seenAliasNorm = new Map<string, string>();     // normalized alias → owning id_key
  const kbAliasByPack = new Map<string, { alias: string; idKey: string }[]>();

  for (const { lp, p } of packs) {
    (p.findings ?? []).forEach((f, i) => {
      const base = `findings[${i}]`;
      // required fields
      for (const field of ["id_key", "display_name", "category", "default_sentence", "impression_fragment"] as const) {
        if (!f[field]) err(ctx, "MISSING_REQUIRED_FIELD", `Missing ${field}`, lp.source, `${base}.${field}`);
      }
      if (!f.id_key) return;

      // id_key format + immutability + duplicate
      if (!KEY_RE.test(f.id_key)) err(ctx, "INVALID_KEY", `Invalid id_key "${f.id_key}"`, lp.source, `${base}.id_key`);
      if (seenId.has(f.id_key)) err(ctx, "DUPLICATE_ID_KEY", `Duplicate id_key "${f.id_key}"`, lp.source, `${base}.id_key`);
      seenId.add(f.id_key);
      ctx.findingKeys.add(f.id_key);
      ctx.findingById.set(f.id_key, f);
      // immutable id_key: a case/whitespace-only variant of an existing catalog key is a rename of an immutable key
      for (const existing of ctx.snapshot.findingKeys) {
        if (existing !== f.id_key && existing.toLowerCase() === f.id_key.toLowerCase()) {
          err(ctx, "IMMUTABLE_ID_KEY_VIOLATION", `id_key "${f.id_key}" collides with immutable existing key "${existing}" (case/format change forbidden)`, lp.source, `${base}.id_key`);
        }
      }
      if (f.status && !["draft", "active", "deprecated"].includes(f.status)) {
        err(ctx, "INVALID_ENUM", `Invalid status "${f.status}"`, lp.source, `${base}.status`);
      }

      // aliases (display aliases + keyboard alias) — global uniqueness (normalized)
      const aliases = [...(f.aliases ?? []), ...(f.keyboard_alias ? [f.keyboard_alias] : [])];
      for (const a of aliases) {
        const n = normalizeAlias(a);
        // Duplicate against the catalog ONLY if the existing alias belongs to a
        // DIFFERENT finding — a finding re-importing its own aliases is fine.
        const catalogOwner = ctx.snapshot.aliasOwner.get(n);
        if (catalogOwner && catalogOwner !== f.id_key) err(ctx, "DUPLICATE_ALIAS", `Alias "${a}" already maps to "${catalogOwner}" in the catalog`, lp.source, `${base}.aliases`);
        const owner = seenAliasNorm.get(n);
        if (owner && owner !== f.id_key) err(ctx, "DUPLICATE_ALIAS", `Alias "${a}" already used by "${owner}"`, lp.source, `${base}.aliases`);
        seenAliasNorm.set(n, f.id_key);
      }
      if (f.keyboard_alias) {
        const arr = kbAliasByPack.get(lp.source) ?? [];
        arr.push({ alias: normalizeAlias(f.keyboard_alias), idKey: f.id_key });
        kbAliasByPack.set(lp.source, arr);
      }

      // category ref
      if (f.category && !ctx.categories.has(f.category)) err(ctx, "UNKNOWN_CATEGORY_REF", `Unknown category "${f.category}"`, lp.source, `${base}.category`);

      // parameter bindings
      (f.parameters ?? []).forEach((pb, j) => {
        const key = stripPrefix(pb.ref ?? "", "param");
        const grp = ctx.params.get(key);
        if (!grp) { err(ctx, "UNKNOWN_PARAM_REF", `Unknown parameter "${pb.ref}"`, lp.source, `${base}.parameters[${j}].ref`); return; }
        if (pb.required != null && typeof pb.required !== "boolean") err(ctx, "INVALID_PARAM_BINDING", `parameters[${j}].required must be boolean`, lp.source, `${base}.parameters[${j}].required`);
        if (pb.default != null) {
          const optKey = pb.default.includes(".") ? pb.default.split(".").slice(-1)[0] : pb.default;
          if (grp.data_type === "option" && !grp.options.has(optKey)) {
            err(ctx, "INVALID_PARAM_BINDING", `default "${pb.default}" is not an option of "${key}"`, lp.source, `${base}.parameters[${j}].default`);
          }
        }
      });

      // severity / location / recommendation / critical / template refs
      (f.severities ?? []).forEach((s, j) => { if (!ctx.severities.has(stripPrefix(s, "sev"))) err(ctx, "UNKNOWN_SEVERITY_REF", `Unknown severity "${s}"`, lp.source, `${base}.severities[${j}]`); });
      (f.locations ?? []).forEach((l, j) => { if (!ctx.locations.has(stripPrefix(l, "loc"))) err(ctx, "UNKNOWN_LOCATION_REF", `Unknown location "${l}"`, lp.source, `${base}.locations[${j}]`); });
      (f.recommendations ?? []).forEach((r, j) => { if (!ctx.recommendations.has(stripPrefix(r, "rec"))) err(ctx, "UNKNOWN_RECOMMENDATION_REF", `Unknown recommendation "${r}"`, lp.source, `${base}.recommendations[${j}]`); });
      (f.criticals ?? []).forEach((c, j) => { if (!ctx.criticals.has(stripPrefix(c, "crit"))) err(ctx, "UNKNOWN_CRITICAL_REF", `Unknown critical "${c}"`, lp.source, `${base}.criticals[${j}]`); });
      if (f.template != null && !ctx.templates.has(stripPrefix(f.template, "tpl"))) err(ctx, "UNKNOWN_TEMPLATE_REF", `Unknown template "${f.template}"`, lp.source, `${base}.template`);

      // measurement bindings
      const measKeys = new Set<string>();
      (f.measurements ?? []).forEach((mb, j) => {
        if (!KEY_RE.test(mb.key ?? "")) err(ctx, "INVALID_MEASUREMENT_BINDING", `Invalid measurement key "${mb.key}"`, lp.source, `${base}.measurements[${j}].key`);
        if (measKeys.has(mb.key)) err(ctx, "INVALID_MEASUREMENT_BINDING", `Duplicate measurement key "${mb.key}"`, lp.source, `${base}.measurements[${j}]`);
        measKeys.add(mb.key);
        if (mb.min != null && mb.max != null && mb.min > mb.max) err(ctx, "INVALID_MEASUREMENT_BINDING", `min > max for "${mb.key}"`, lp.source, `${base}.measurements[${j}]`);
      });

      // duplicate recommendation codes within finding
      const recSeen = new Set<string>();
      (f.recommendations ?? []).forEach((r, j) => { const k = stripPrefix(r, "rec"); if (recSeen.has(k)) err(ctx, "INVALID_RECOMMENDATION_BINDING", `Duplicate recommendation "${r}" on finding`, lp.source, `${base}.recommendations[${j}]`); recSeen.add(k); });

      // AI sections: when present, each rule must carry required fields
      (f.ai_contradiction_rules ?? []).forEach((r, j) => {
        if (!r.id || !r.message || !Array.isArray(r.when) || !Array.isArray(r.forbid) || r.when.length === 0 || r.forbid.length === 0) {
          err(ctx, "MISSING_AI_SECTION", `ai_contradiction_rules[${j}] requires id, message, non-empty when[] and forbid[]`, lp.source, `${base}.ai_contradiction_rules[${j}]`);
        }
      });
      (f.ai_completeness_rules ?? []).forEach((r, j) => {
        if (!r.id || !r.message || !Array.isArray(r.require) || r.require.length === 0) {
          err(ctx, "MISSING_AI_SECTION", `ai_completeness_rules[${j}] requires id, message and non-empty require[]`, lp.source, `${base}.ai_completeness_rules[${j}]`);
        }
      });
    });
  }

  // alias-prefix collisions within a pack (ambiguous keyboard typeahead)
  for (const [pack, arr] of kbAliasByPack) {
    for (let a = 0; a < arr.length; a++) {
      for (let b = 0; b < arr.length; b++) {
        if (a === b || arr[a].idKey === arr[b].idKey) continue;
        if (arr[b].alias.length > arr[a].alias.length && arr[b].alias.startsWith(arr[a].alias)) {
          err(ctx, "ALIAS_PREFIX_COLLISION", `keyboard_alias "${arr[a].alias}" (${arr[a].idKey}) is a prefix of "${arr[b].alias}" (${arr[b].idKey})`, pack);
        }
      }
    }
  }
}

// ── Phase 4: extends + combo graph (unknown refs + cycles) ────────────────────

function checkGraph(ctx: Ctx, packs: { lp: LoadedPack; p: ContentPack }[]): void {
  for (const { lp, p } of packs) {
    (p.findings ?? []).forEach((f, i) => {
      const base = `findings[${i}]`;
      if (f.extends != null) {
        if (!ctx.findingKeys.has(f.extends)) err(ctx, "UNKNOWN_EXTENDS_REF", `Unknown extends target "${f.extends}"`, lp.source, `${base}.extends`);
      }
      (f.included_findings_ref ?? []).forEach((ref, j) => {
        if (!ctx.findingKeys.has(ref)) err(ctx, "INVALID_COMBO_REF", `Unknown included finding "${ref}"`, lp.source, `${base}.included_findings_ref[${j}]`);
      });
    });
  }
  // circular extends: walk parent chain per declared finding
  for (const [idKey, f] of ctx.findingById) {
    const seen = new Set<string>();
    let cur: string | null | undefined = f.extends;
    while (cur != null) {
      if (cur === idKey || seen.has(cur)) {
        err(ctx, "CIRCULAR_EXTENDS", `Circular extends chain through "${idKey}"`);
        break;
      }
      seen.add(cur);
      cur = ctx.findingById.get(cur)?.extends;
      if (cur != null && !ctx.findingById.has(cur)) break; // parent outside declared set → not a cycle
    }
  }
}

/**
 * Validate a set of loaded packs against an optional live-catalog snapshot.
 * Returns ok:false if ANY error (no partial success). Deterministic + pure.
 */
export function validatePacks(loaded: LoadedPack[], snapshot: CatalogSnapshot = emptyCatalogSnapshot()): ValidationResult {
  const ctx: Ctx = {
    errors: [], warnings: [], snapshot,
    params: new Map(), severities: new Set(), locations: new Set(), recommendations: new Set(),
    criticals: new Set(), templates: new Set(), categories: new Set(), findingKeys: new Set(), findingById: new Map(),
  };

  const good: { lp: LoadedPack; p: ContentPack }[] = [];
  for (const lp of loaded) {
    const p = checkEnvelope(ctx, lp);
    if (p) good.push({ lp, p });
  }
  // duplicate pack ids
  const packIds = new Set<string>();
  for (const { lp, p } of good) {
    if (p.pack?.id) {
      if (packIds.has(p.pack.id)) err(ctx, "DUPLICATE_LIBRARY_KEY", `Duplicate pack id "${p.pack.id}"`, lp.source, "pack.id");
      packIds.add(p.pack.id);
    }
  }

  assembleRegistries(ctx, good);
  checkFindings(ctx, good);
  checkGraph(ctx, good);

  return { ok: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}
