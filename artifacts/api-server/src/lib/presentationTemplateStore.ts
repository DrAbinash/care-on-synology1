/**
 * presentationTemplateStore.ts — Ticket R1.2: database access + resolution
 * for versioned presentation templates.
 *
 * Immutability contract (Phase 3):
 *   - published versions are never UPDATEd — "editing" inserts version n+1;
 *   - deletion is soft retirement (status='retired'), never DELETE;
 *   - a report's SIGNED template identity lives in
 *     radiology_report_presentation_freeze and is never rewritten;
 *   - the 8 system seeds are code (version 1) — the store resolves DB rows
 *     first and falls back to the seed, so system templates can be
 *     re-themed by publishing v2+ without ever mutating v1.
 */

import { db } from "@workspace/db";
import {
  pacsSettingsTable,
  radiologyConfigChangesTable,
  radiologyPresentationTemplatesTable,
  radiologyReportPresentationFreezeTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  COPY_TYPES, DEFAULT_TEMPLATE_KEY, RENDERER_COMPAT_VERSION,
  activeTemplateSettingKey, compileTemplate, resolveTemplatePrecedence,
  validateDescription, validateDisplayName, validateImportEnvelope,
  validateTemplateDefinition, validateTemplateKey,
  type CopyType, type ResolvedTemplate, type TemplateDefinition,
  type TemplateExportEnvelope, type TemplateValidationIssue, type TemplateVersionRecord,
} from "./presentationTemplateModel";
import { PRESENTATION_TEMPLATE_SEEDS, seedByKey } from "./presentationTemplateSeeds";
import { TEMPLATE_EXPORT_SCHEMA_VERSION } from "./presentationTemplateModel";

// ── Row mapping ──────────────────────────────────────────────────────────────

type DbRow = typeof radiologyPresentationTemplatesTable.$inferSelect;

function rowToRecord(row: DbRow): TemplateVersionRecord {
  return {
    templateKey: row.templateKey,
    version: row.version,
    displayName: row.displayName,
    description: row.description,
    orgScope: row.orgScope,
    copyType: (COPY_TYPES.includes(row.copyType as never) ? row.copyType : "standard") as CopyType,
    status: row.status === "retired" ? "retired" : "published",
    rendererVersion: row.rendererVersion,
    isSystem: row.isSystem,
    definition: row.definition as TemplateDefinition,
  };
}

// ── Listing / lookup ─────────────────────────────────────────────────────────

export interface TemplateListEntry extends TemplateVersionRecord {
  latestVersion: number;
  isLatest: boolean;
}

/** Every template version visible to the admin UI: DB rows plus any system
 *  seed whose key has no DB row yet (seeds are implicit version 1). */
export async function listTemplateVersions(): Promise<TemplateListEntry[]> {
  const rows = await db.select().from(radiologyPresentationTemplatesTable)
    .orderBy(radiologyPresentationTemplatesTable.templateKey, desc(radiologyPresentationTemplatesTable.version));
  const records = rows.map(rowToRecord);
  const dbKeys = new Set(records.map((r) => r.templateKey));
  for (const seedRecord of PRESENTATION_TEMPLATE_SEEDS) {
    if (!dbKeys.has(seedRecord.templateKey)) records.push(seedRecord);
  }
  // seeds are version 1 — when DB rows exist for a seed key, v1 remains
  // implicitly available as the immutable base version
  const withSeeds: TemplateVersionRecord[] = [];
  const seen = new Set(records.map((r) => `${r.templateKey}@${r.version}`));
  withSeeds.push(...records);
  for (const seedRecord of PRESENTATION_TEMPLATE_SEEDS) {
    if (!seen.has(`${seedRecord.templateKey}@1`)) withSeeds.push(seedRecord);
  }
  const latestByKey = new Map<string, number>();
  for (const r of withSeeds) {
    latestByKey.set(r.templateKey, Math.max(latestByKey.get(r.templateKey) ?? 0, r.version));
  }
  return withSeeds
    .map((r) => ({ ...r, latestVersion: latestByKey.get(r.templateKey)!, isLatest: r.version === latestByKey.get(r.templateKey) }))
    .sort((a, b) => a.templateKey.localeCompare(b.templateKey) || b.version - a.version);
}

/** Exact version: DB row first, then the code seed (version 1). If the DB is
 *  unreadable (e.g. the R1.2 migration has not run yet on a fresh API deploy),
 *  degrade to the seed of the REQUESTED key — so an R1.1 deployment configured
 *  for care-premium keeps rendering premium instead of silently downgrading. */
export async function getTemplateVersion(templateKey: string, version: number): Promise<TemplateVersionRecord | null> {
  try {
    const [row] = await db.select().from(radiologyPresentationTemplatesTable)
      .where(and(
        eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
        eq(radiologyPresentationTemplatesTable.version, version),
      ))
      .limit(1);
    if (row) return rowToRecord(row);
  } catch { /* table missing/unreadable → seed fallback below */ }
  const seedRecord = seedByKey(templateKey);
  return seedRecord && seedRecord.version === version ? seedRecord : null;
}

/** Latest PUBLISHED version of a key (retired versions are skipped for new
 *  renders; frozen reports may still fetch them by exact version). Same
 *  missing-table degradation to the requested key's seed. */
export async function latestPublishedVersion(templateKey: string): Promise<TemplateVersionRecord | null> {
  try {
    const rows = await db.select().from(radiologyPresentationTemplatesTable)
      .where(and(
        eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
        eq(radiologyPresentationTemplatesTable.status, "published"),
      ))
      .orderBy(desc(radiologyPresentationTemplatesTable.version))
      .limit(1);
    if (rows.length > 0) return rowToRecord(rows[0]);
  } catch { /* table missing/unreadable → seed fallback below */ }
  return seedByKey(templateKey) ?? null;
}

async function maxVersion(templateKey: string): Promise<number> {
  const rows = await db.select({ version: radiologyPresentationTemplatesTable.version })
    .from(radiologyPresentationTemplatesTable)
    .where(eq(radiologyPresentationTemplatesTable.templateKey, templateKey))
    .orderBy(desc(radiologyPresentationTemplatesTable.version))
    .limit(1);
  const dbMax = rows[0]?.version ?? 0;
  const seedMax = seedByKey(templateKey)?.version ?? 0;
  return Math.max(dbMax, seedMax);
}

// ── Mutations (all additive: INSERT or status flip — never definition UPDATE) ─

export interface StoreMutationResult {
  ok: boolean;
  issues?: TemplateValidationIssue[];
  record?: TemplateVersionRecord;
}

/** Insert the next version of a key, race-free. A transaction-scoped advisory
 *  lock keyed on the template key SERIALIZES concurrent publishes of the SAME
 *  key (different keys never block each other), so the max read is always
 *  fresh and no two writers collide on the version number — turning what was a
 *  read-then-write race (opaque 500 for the loser) into deterministic
 *  sequential versions. The unique index remains the ultimate backstop. */
async function insertNextVersion(
  templateKey: string,
  build: (version: number) => typeof radiologyPresentationTemplatesTable.$inferInsert,
): Promise<DbRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"rpt:" + templateKey}))`);
    const [maxRow] = await tx.select({ v: radiologyPresentationTemplatesTable.version })
      .from(radiologyPresentationTemplatesTable)
      .where(eq(radiologyPresentationTemplatesTable.templateKey, templateKey))
      .orderBy(desc(radiologyPresentationTemplatesTable.version))
      .limit(1);
    const seedMax = seedByKey(templateKey)?.version ?? 0;
    const nextVersion = Math.max(maxRow?.v ?? 0, seedMax) + 1;
    const [row] = await tx.insert(radiologyPresentationTemplatesTable).values(build(nextVersion)).returning();
    return row;
  });
}

/** Publish the NEXT version of a key (Phase 3 rule 1: editing creates a new
 *  version). Also the "create template" path when the key is new. */
export async function publishTemplateVersion(input: {
  templateKey: string;
  displayName: string;
  description?: string | null;
  copyType: CopyType;
  definition: unknown;
  createdBy: string;
}): Promise<StoreMutationResult> {
  const issues = [
    ...validateTemplateKey(input.templateKey),
    ...validateDisplayName(input.displayName),
    ...(COPY_TYPES.includes(input.copyType) ? [] : [{ path: "copyType", message: "invalid copy type" }]),
    ...validateDescription(input.description),
    ...validateTemplateDefinition(input.definition),
  ];
  if (issues.length > 0) return { ok: false, issues };
  const row = await insertNextVersion(input.templateKey, (version) => ({
    templateKey: input.templateKey,
    version,
    displayName: input.displayName,
    description: input.description ?? null,
    copyType: input.copyType,
    status: "published",
    rendererVersion: RENDERER_COMPAT_VERSION,
    isSystem: false,
    definition: input.definition as TemplateDefinition,
    createdBy: input.createdBy,
  }));
  return { ok: true, record: rowToRecord(row) };
}

/** Duplicate an existing version into a NEW key (starting at version 1). */
export async function duplicateTemplate(input: {
  sourceKey: string;
  sourceVersion: number;
  newKey: string;
  displayName: string;
  createdBy: string;
}): Promise<StoreMutationResult> {
  const keyIssues = validateTemplateKey(input.newKey);
  if (keyIssues.length > 0) return { ok: false, issues: keyIssues };
  if ((await maxVersion(input.newKey)) > 0 || seedByKey(input.newKey)) {
    return { ok: false, issues: [{ path: "newKey", message: `template key "${input.newKey}" already exists` }] };
  }
  const source = await getTemplateVersion(input.sourceKey, input.sourceVersion);
  if (!source) return { ok: false, issues: [{ path: "sourceKey", message: "source template version not found" }] };
  const nameIssues = validateDisplayName(input.displayName);
  if (nameIssues.length > 0) return { ok: false, issues: nameIssues };
  const [row] = await db.insert(radiologyPresentationTemplatesTable).values({
    templateKey: input.newKey,
    version: 1,
    displayName: input.displayName,
    description: `Duplicated from ${input.sourceKey} v${input.sourceVersion}`,
    copyType: source.copyType,
    status: "published",
    rendererVersion: RENDERER_COMPAT_VERSION,
    isSystem: false,
    definition: source.definition,
    createdBy: input.createdBy,
  }).returning();
  return { ok: true, record: rowToRecord(row) };
}

/** Would retiring (key, version) leave a currently-ACTIVE copy type with no
 *  published version to render? Guards against silently flipping the clinic's
 *  presentation to the care-classic fallback. Returns the copy types that
 *  would be orphaned (empty = safe). */
export async function retirementWouldOrphanActive(templateKey: string, version: number): Promise<CopyType[]> {
  const active = await readActiveSelections();
  const affected: CopyType[] = [];
  for (const copyType of COPY_TYPES) {
    if (active[copyType] !== templateKey) continue;
    // published versions of this key that survive the retirement
    const rows = await db.select({ version: radiologyPresentationTemplatesTable.version })
      .from(radiologyPresentationTemplatesTable)
      .where(and(
        eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
        eq(radiologyPresentationTemplatesTable.status, "published"),
      ));
    const survivingDbVersions = rows.map((r) => r.version).filter((v) => v !== version);
    const seedSurvives = Boolean(seedByKey(templateKey)) && version !== 1;
    if (survivingDbVersions.length === 0 && !seedSurvives) affected.push(copyType);
  }
  return affected;
}

/** Soft retirement (Phase 3 rule 7). Seed versions cannot be retired (they
 *  are the fallback of last resort). Retiring the last published version of a
 *  currently-active key is refused unless force=true (the route surfaces the
 *  orphaned copy types first). Frozen reports keep rendering retired versions
 *  by exact id. */
export async function retireTemplateVersion(templateKey: string, version: number, retiredBy: string, force = false): Promise<StoreMutationResult & { orphans?: CopyType[] }> {
  const orphans = await retirementWouldOrphanActive(templateKey, version);
  if (orphans.length > 0 && !force) {
    return {
      ok: false,
      orphans,
      issues: [{ path: "version", message: `retiring this version orphans the active selection for: ${orphans.join(", ")} — activate a replacement first, or confirm with force=true` }],
    };
  }
  const seedRecord = seedByKey(templateKey);
  if (seedRecord && seedRecord.version === version) {
    const [existing] = await db.select().from(radiologyPresentationTemplatesTable)
      .where(and(
        eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
        eq(radiologyPresentationTemplatesTable.version, version),
      )).limit(1);
    if (!existing) {
      return { ok: false, issues: [{ path: "version", message: "system seed versions cannot be retired" }] };
    }
  }
  // Only flip PUBLISHED rows — retiring an already-retired version must not
  // overwrite the original retiredAt/retiredBy bookkeeping.
  const [row] = await db.update(radiologyPresentationTemplatesTable)
    .set({ status: "retired", retiredAt: new Date(), retiredBy })
    .where(and(
      eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
      eq(radiologyPresentationTemplatesTable.version, version),
      eq(radiologyPresentationTemplatesTable.status, "published"),
    ))
    .returning();
  if (!row) {
    const [any] = await db.select().from(radiologyPresentationTemplatesTable)
      .where(and(
        eq(radiologyPresentationTemplatesTable.templateKey, templateKey),
        eq(radiologyPresentationTemplatesTable.version, version),
      )).limit(1);
    return { ok: false, issues: [{ path: "version", message: any ? "template version is already retired" : "template version not found" }] };
  }
  return { ok: true, record: rowToRecord(row) };
}

// ── Active selection (per copy type; standard keeps the R1.1 settings key) ──

export async function readActiveSelections(): Promise<Partial<Record<CopyType, string>>> {
  const keys = COPY_TYPES.map((c) => activeTemplateSettingKey(c));
  // Filter by category='report' to MATCH writeActiveSelection. pacs_settings
  // is unique on (key, category), and the generic settings endpoint defaults
  // omitted categories to 'general' — without this filter a stray 'general'
  // row could nondeterministically shadow the real 'report' selection.
  const rows = await db.select({ key: pacsSettingsTable.key, value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(inArray(pacsSettingsTable.key, keys), eq(pacsSettingsTable.category, "report")));
  const out: Partial<Record<CopyType, string>> = {};
  for (const copyType of COPY_TYPES) {
    const value = rows.find((r) => r.key === activeTemplateSettingKey(copyType))?.value?.trim();
    if (value) out[copyType] = value;
  }
  return out;
}

export async function writeActiveSelection(copyType: CopyType, templateKey: string, actor?: { id?: number | null; name?: string | null }): Promise<void> {
  const settingKey = activeTemplateSettingKey(copyType);
  const [existing] = await db.select().from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, settingKey), eq(pacsSettingsTable.category, "report")))
    .limit(1);
  const oldValue = existing?.value ?? null;
  if (existing) {
    await db.update(pacsSettingsTable).set({ value: templateKey, updatedAt: new Date() })
      .where(eq(pacsSettingsTable.id, existing.id));
  } else {
    await db.insert(pacsSettingsTable).values({
      key: settingKey, value: templateKey, category: "report", isSecret: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }
  // Config-change ledger parity: R1.1 changed the template through
  // POST /pacs-settings, which logged a radiology_config_changes row surfaced
  // in the enterprise config-history. Mirror that on value change so the
  // Flight Deck ledger doesn't regress (in addition to the hash-chained audit).
  if (oldValue !== templateKey) {
    await db.insert(radiologyConfigChangesTable).values({
      key: settingKey, category: "report", oldValue, newValue: templateKey,
      reason: "Report presentation template activated (R1.2)",
      changedBy: actor?.id ?? null, changedByName: actor?.name ?? "SYSTEM",
    }).catch(() => undefined);
  }
}

// ── Freeze (Phase 3 — template identity of finalized reports) ───────────────

interface FreezeSnapshot {
  displayName: string;
  description: string | null;
  copyType: CopyType;
  /** The FULL validated definition — so a finalized report re-renders exactly
   *  even if its version row is later lost (partial restore, seed constants
   *  changing in a future deploy). This is the reproducibility backstop the
   *  schema promises. */
  definition: TemplateDefinition;
}

/** Record the template a report was signed under, WITH a full-definition
 *  snapshot. Best-effort and idempotent (unique on report_id; a second sign
 *  event never rewrites the first). */
export async function freezeReportPresentation(reportId: number, record: TemplateVersionRecord): Promise<void> {
  const snapshot: FreezeSnapshot = {
    displayName: record.displayName,
    description: record.description ?? null,
    copyType: record.copyType,
    definition: record.definition,
  };
  await db.insert(radiologyReportPresentationFreezeTable).values({
    reportId,
    templateKey: record.templateKey,
    templateVersion: record.version,
    snapshot,
  }).onConflictDoNothing();
}

export interface FrozenIdentity {
  templateKey: string;
  templateVersion: number;
  snapshot: FreezeSnapshot | null;
}

export async function getReportPresentationFreeze(reportId: number): Promise<FrozenIdentity | null> {
  const [row] = await db.select().from(radiologyReportPresentationFreezeTable)
    .where(eq(radiologyReportPresentationFreezeTable.reportId, reportId))
    .limit(1);
  if (!row) return null;
  const snap = row.snapshot as Partial<FreezeSnapshot> | null;
  return {
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    snapshot: snap && snap.definition
      ? { displayName: snap.displayName ?? row.templateKey, description: snap.description ?? null, copyType: snap.copyType ?? "standard", definition: snap.definition }
      : null,
  };
}

/** Reconstruct a template record from a frozen snapshot (the reproducibility
 *  fallback when the version row is gone). */
function recordFromSnapshot(frozen: FrozenIdentity): TemplateVersionRecord | null {
  if (!frozen.snapshot) return null;
  return {
    templateKey: frozen.templateKey,
    version: frozen.templateVersion,
    displayName: frozen.snapshot.displayName,
    description: frozen.snapshot.description,
    orgScope: "global",
    copyType: frozen.snapshot.copyType,
    status: "published",
    rendererVersion: RENDERER_COMPAT_VERSION,
    isSystem: false,
    definition: frozen.snapshot.definition,
  };
}

// ── Render-time resolution (Phase 4/6) ───────────────────────────────────────

export interface RenderResolutionOptions {
  /** ?template=key or key@version — staff surfaces only. */
  explicit?: string | null;
  /** The signed report row actually being served (freeze lookup). */
  reportId?: number | null;
  copyType?: CopyType;
}

export function parseExplicitTemplateParam(raw: unknown): { key: string; version: number | null } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parts = raw.trim().split("@");
  if (parts.length > 2) return null; // "key@2@3" is malformed, not "key@2"
  const [key, versionRaw] = parts;
  if (validateTemplateKey(key).length > 0) return null;
  if (versionRaw === undefined) return { key, version: null };
  // strict decimal only — reject hex ("0x2") and exponent ("2e1") encodings
  if (!/^\d{1,5}$/.test(versionRaw)) return null;
  const version = Number(versionRaw);
  return version >= 1 ? { key, version } : null;
}

/** Resolve the template RECORD for a render (uncompiled). NEVER throws —
 *  presentation resolution failures must not stop a report from printing; the
 *  final fallback is the care-classic seed. The freeze snapshot is the second
 *  link so a finalized report re-renders exactly even if its version row is
 *  gone. Exported so the sign-time freeze hook captures the SAME record it
 *  will later resolve to. */
export async function resolveTemplateRecordForRender(opts: RenderResolutionOptions): Promise<TemplateVersionRecord> {
  try {
    const explicit = parseExplicitTemplateParam(opts.explicit);
    const frozen = !explicit && opts.reportId ? await getReportPresentationFreeze(opts.reportId).catch(() => null) : null;
    const activeByCopyType = await readActiveSelections().catch(() => ({} as Partial<Record<CopyType, string>>));
    const decision = resolveTemplatePrecedence({
      explicitKey: explicit?.key ?? null,
      explicitVersion: explicit?.version ?? null,
      frozen: frozen ? { templateKey: frozen.templateKey, templateVersion: frozen.templateVersion } : null,
      copyType: opts.copyType ?? "standard",
      activeByCopyType,
    });
    const record = decision.version != null
      ? await getTemplateVersion(decision.templateKey, decision.version)
      : await latestPublishedVersion(decision.templateKey);
    if (record) return record;
    // frozen version row is gone → reconstruct from the snapshot (reproducibility)
    if (decision.source === "frozen" && frozen) {
      const fromSnap = recordFromSnapshot(frozen);
      if (fromSnap) return fromSnap;
    }
    // otherwise the documented fallback chain
    const standard = activeByCopyType.standard
      ? await latestPublishedVersion(activeByCopyType.standard)
      : null;
    if (standard) return standard;
  } catch { /* fall through to the seed default */ }
  return seedByKey(DEFAULT_TEMPLATE_KEY)!;
}

export async function resolveTemplateForRender(opts: RenderResolutionOptions): Promise<ResolvedTemplate> {
  return compileTemplate(await resolveTemplateRecordForRender(opts));
}

// ── Import / export (Phase 7) ────────────────────────────────────────────────

export async function exportTemplateVersion(templateKey: string, version: number): Promise<TemplateExportEnvelope | null> {
  const record = await getTemplateVersion(templateKey, version);
  if (!record) return null;
  return {
    schemaVersion: TEMPLATE_EXPORT_SCHEMA_VERSION,
    rendererVersion: record.rendererVersion,
    templateKey: record.templateKey,
    version: record.version,
    displayName: record.displayName,
    description: record.description ?? null,
    copyType: record.copyType,
    definition: record.definition,
    exportedAt: new Date().toISOString(),
  };
}

export interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  issues: TemplateValidationIssue[];
  /** What an import would create: always the NEXT version of the key —
   *  immutable published versions are never overwritten. */
  wouldCreate?: { templateKey: string; version: number };
  record?: TemplateVersionRecord;
}

/** Validate (always) and, unless dryRun, import as the NEXT version of the
 *  envelope's key. No partial import: any issue aborts the whole operation.
 *  An envelope claiming an existing (key, version) is NOT an overwrite — it
 *  is reported and imported as a fresh version. */
export async function importTemplate(raw: unknown, opts: { dryRun: boolean; createdBy: string }): Promise<ImportResult> {
  const { issues, envelope } = validateImportEnvelope(raw);
  if (!envelope) return { ok: false, dryRun: opts.dryRun, issues };

  const existing = await getTemplateVersion(envelope.templateKey, envelope.version);
  const nextVersion = (await maxVersion(envelope.templateKey)) + 1;
  const importIssues: TemplateValidationIssue[] = [...issues];
  if (existing) {
    importIssues.push({
      path: "version",
      message: `version ${envelope.version} of "${envelope.templateKey}" already exists and is immutable — importing would create version ${nextVersion} instead`,
    });
  }
  const wouldCreate = { templateKey: envelope.templateKey, version: nextVersion };

  // A duplicate-version notice alone does not block import (nothing is
  // overwritten); genuine validation issues were caught by the envelope pass.
  if (opts.dryRun) {
    return { ok: true, dryRun: true, issues: importIssues, wouldCreate };
  }
  const row = await insertNextVersion(envelope.templateKey, (version) => ({
    templateKey: envelope.templateKey,
    version,
    displayName: envelope.displayName,
    description: envelope.description ?? null,
    copyType: envelope.copyType,
    status: "published",
    rendererVersion: RENDERER_COMPAT_VERSION,
    isSystem: false,
    definition: envelope.definition,
    createdBy: opts.createdBy,
  }));
  return { ok: true, dryRun: false, issues: importIssues, wouldCreate: { templateKey: row.templateKey, version: row.version }, record: rowToRecord(row) };
}

/** Reset-to-default (Phase 3 rule 5): select the canonical CARE template.
 *  It never rewrites finalized reports — only the active selection moves. */
export async function resetToCareDefault(actor?: { id?: number | null; name?: string | null }): Promise<void> {
  await writeActiveSelection("standard", DEFAULT_TEMPLATE_KEY, actor);
}
