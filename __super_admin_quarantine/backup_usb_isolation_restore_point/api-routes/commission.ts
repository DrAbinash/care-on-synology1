import { Router } from "express";
import { db } from "@workspace/db";
import {
  commissionRulesTable,
  clinicSettingsTable,
  doctorsTable,
  orderTestsTable,
  ordersTable,
  testsTable,
  billsTable,
  patientsTable,
  testTokensTable,
  patientReportsTable,
  radiologyStudiesTable,
  outsourcedLabsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, inArray, ne, sql } from "drizzle-orm";
import {
  CreateCommissionRuleBody,
  UpdateCommissionRuleBody,
  UpdateCommissionRuleParams,
  DeleteCommissionRuleParams,
} from "@workspace/api-zod";
import {
  type RuleScope,
  type EligibilityConfig,
  safeParseArray,
  parseTestIdList,
  findMatchingRule,
  calcTestCommission,
  applyDiscountDeduction,
  computeCommissionHold,
  indexCommissionBillsByOrderId,
  NEEDS_REPORT_STATUS,
  buildTestNameAliasIndex,
  rulesForDoctor,
} from "../lib/commissionCalc";
import { auditFromRequest } from "../lib/audit";

const router = Router();

// List commission rules (optionally filtered by doctorId)
router.get("/rules", async (req, res) => {
  const { doctorId } = req.query as Record<string, string>;
  const conditions = doctorId ? [eq(commissionRulesTable.doctorId, Number(doctorId))] : [];
  const rows = await db
    .select()
    .from(commissionRulesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(commissionRulesTable.createdAt));
  res.json(rows.map(r => ({
    ...r,
    value: Number(r.value),
    // safeParseArray, not JSON.parse: one rule with malformed JSON must not take
    // the whole rules list down.
    categories: safeParseArray<string>(r.categories),
    // Coerce stringly ids ("12") so the UI checkbox state and report matching agree.
    testIds: parseTestIdList(r.testIds),
  })));
});

// Which kind of test line a slab may pay on. Not in the generated OpenAPI body
// schema, so it is read off req.body directly and allow-listed here — the same
// approach the isActive flag below already uses.
// Nothing previously stopped a 90% slab being typed into something that moves
// money, and a rate change left no trace. Both are closed below: every rate is
// checked against the clinic's ceiling, and every create/update/delete writes an
// audit row naming who did it and what the value went from and to.
async function commissionMaxPercent(): Promise<number> {
  const [row] = await db.select({ v: clinicSettingsTable.commissionMaxPercent }).from(clinicSettingsTable).limit(1);
  const n = Number(row?.v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Returns an error message when the rate breaches the ceiling, else null. */
function rateCeilingError(type: string, value: number, max: number): string | null {
  if (max <= 0) return null;                 // ceiling disabled
  if (type !== "percentage") return null;    // a fixed amount is not a percentage
  if (value <= max) return null;
  return `Commission rate ${value}% exceeds the clinic's maximum of ${max}%. Raise the maximum in Commission Rules settings if this is intended.`;
}

const APPLIES_TO = ["all", "inhouse", "outsourced"] as const;
function readAppliesTo(body: unknown): string | undefined {
  const v = (body as { appliesTo?: unknown } | null | undefined)?.appliesTo;
  return typeof v === "string" && (APPLIES_TO as readonly string[]).includes(v) ? v : undefined;
}

// Create rule
router.post("/rules", async (req, res) => {
  const parsed = CreateCommissionRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { doctorId, name, type, value, scope, categories, testIds, isExclusive } = parsed.data;
  // doctorId null/undefined = clinic-wide slab (applies to every referring doctor).
  const resolvedDoctorId = doctorId ?? null;
  if (scope === "test" && (!testIds || testIds.length === 0)) {
    res.status(400).json({
      error: "Test-scoped rules must bind at least one catalogue test. Pick tests in the picker — a rule name alone (e.g. \"MRI BRAIN\") does not pay commission.",
    });
    return;
  }
  if (scope === "category" && (!categories || categories.length === 0)) {
    res.status(400).json({
      error: "Category-scoped rules must list at least one category.",
    });
    return;
  }
  const ceilingErr = rateCeilingError(type, value, await commissionMaxPercent());
  if (ceilingErr) {
    res.status(400).json({ error: ceilingErr });
    return;
  }
  const [rule] = await db
    .insert(commissionRulesTable)
    .values({
      doctorId: resolvedDoctorId,
      name,
      type,
      value: value.toString(),
      scope,
      categories: categories ? JSON.stringify(categories) : null,
      testIds: testIds ? JSON.stringify(testIds) : null,
      appliesTo: readAppliesTo(req.body) ?? "all",
      isExclusive: isExclusive ?? false,
    })
    .returning();
  await auditFromRequest(req, {
    action: "create",
    module: "commission",
    entityType: "commission_rule",
    entityId: String(rule.id),
    newValue: JSON.stringify({ doctorId: resolvedDoctorId, name, type, value, scope, appliesTo: rule.appliesTo, isExclusive: rule.isExclusive }),
    reason: resolvedDoctorId == null
      ? `Global commission slab created: ${name} = ${type === "percentage" ? `${value}%` : `Rs.${value}`}`
      : `Commission slab created: ${name} = ${type === "percentage" ? `${value}%` : `Rs.${value}`}`,
  });
  res.status(201).json({ ...rule, value: Number(rule.value) });
});

// Update rule (partial)
const UpdateCommissionRuleBodyPartial = UpdateCommissionRuleBody.partial();
router.patch("/rules/:id", async (req, res) => {
  const paramsParsed = UpdateCommissionRuleParams.safeParse({ id: req.params.id });
  const bodyParsed = UpdateCommissionRuleBodyPartial.safeParse(req.body);
  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: [
        ...(paramsParsed.success ? [] : paramsParsed.error.issues),
        ...(bodyParsed.success ? [] : bodyParsed.error.issues),
      ],
    });
    return;
  }
  const id = paramsParsed.data.id;
  const data = bodyParsed.data;
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.type !== undefined) updates.type = data.type;
  if (data.value !== undefined) updates.value = data.value.toString();
  if (data.scope !== undefined) updates.scope = data.scope;
  if (data.categories !== undefined) updates.categories = data.categories ? JSON.stringify(data.categories) : null;
  if (data.testIds !== undefined) updates.testIds = data.testIds ? JSON.stringify(data.testIds) : null;
  // Explicit null clears doctorId → promote to global; number scopes to one doctor.
  if (data.doctorId !== undefined) updates.doctorId = data.doctorId ?? null;
  if (data.isExclusive !== undefined) updates.isExclusive = data.isExclusive;
  // isActive / appliesTo are not part of the OpenAPI body schema; accept them
  // directly when provided
  if (typeof req.body?.isActive === "boolean") updates.isActive = req.body.isActive;
  const appliesTo = readAppliesTo(req.body);
  if (appliesTo !== undefined) updates.appliesTo = appliesTo;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [before] = await db.select().from(commissionRulesTable).where(eq(commissionRulesTable.id, id));
  if (!before) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  const nextScope = (updates.scope as string | undefined) ?? before.scope;
  const nextTestIds = data.testIds !== undefined
    ? (data.testIds ?? [])
    : (() => {
        try {
          const parsed = before.testIds ? JSON.parse(before.testIds) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      })();
  const nextCategories = data.categories !== undefined
    ? (data.categories ?? [])
    : (() => {
        try {
          const parsed = before.categories ? JSON.parse(before.categories) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      })();
  if (nextScope === "test" && nextTestIds.length === 0) {
    res.status(400).json({
      error: "Test-scoped rules must bind at least one catalogue test. Pick tests in the picker — a rule name alone does not pay commission.",
    });
    return;
  }
  if (nextScope === "category" && nextCategories.length === 0) {
    res.status(400).json({
      error: "Category-scoped rules must list at least one category.",
    });
    return;
  }
  // Check the rate that will be in force after the patch, which may come from
  // either field — changing only the type can breach the ceiling on its own.
  const nextType = (updates.type as string | undefined) ?? before.type;
  const nextValue = updates.value !== undefined ? Number(updates.value) : Number(before.value);
  const ceilingErr = rateCeilingError(nextType, nextValue, await commissionMaxPercent());
  if (ceilingErr) {
    res.status(400).json({ error: ceilingErr });
    return;
  }
  const [rule] = await db.update(commissionRulesTable).set(updates).where(eq(commissionRulesTable.id, id)).returning();
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  await auditFromRequest(req, {
    action: "edit",
    module: "commission",
    entityType: "commission_rule",
    entityId: String(id),
    oldValue: JSON.stringify({ name: before.name, type: before.type, value: Number(before.value), scope: before.scope, appliesTo: before.appliesTo, isActive: before.isActive }),
    newValue: JSON.stringify({ name: rule.name, type: rule.type, value: Number(rule.value), scope: rule.scope, appliesTo: rule.appliesTo, isActive: rule.isActive }),
    reason: Number(before.value) !== Number(rule.value) || before.type !== rule.type
      ? `Commission rate changed: ${before.type === "percentage" ? `${Number(before.value)}%` : `Rs.${Number(before.value)}`} → ${rule.type === "percentage" ? `${Number(rule.value)}%` : `Rs.${Number(rule.value)}`}`
      : `Commission slab updated: ${rule.name}`,
  });
  res.json({ ...rule, value: Number(rule.value) });
});

// Delete rule
router.delete("/rules/:id", async (req, res) => {
  const parsed = DeleteCommissionRuleParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id", details: parsed.error.issues });
    return;
  }
  const [before] = await db.select().from(commissionRulesTable).where(eq(commissionRulesTable.id, parsed.data.id));
  await db.delete(commissionRulesTable).where(eq(commissionRulesTable.id, parsed.data.id));
  if (before) {
    await auditFromRequest(req, {
      action: "delete",
      module: "commission",
      entityType: "commission_rule",
      entityId: String(parsed.data.id),
      oldValue: JSON.stringify({ doctorId: before.doctorId, name: before.name, type: before.type, value: Number(before.value), scope: before.scope, appliesTo: before.appliesTo }),
      reason: `Commission slab deleted: ${before.name} = ${before.type === "percentage" ? `${Number(before.value)}%` : `Rs.${Number(before.value)}`}`,
    });
  }
  res.json({ ok: true });
});

// ─── CSV helpers (import/export) ──────────────────────────────────────────────
// appliesTo sits after testIds and before isExclusive. Older files that predate
// the column still import: the reader looks columns up by name and defaults a
// missing appliesTo to "all", which is the pre-existing behaviour.
// The synthesised row the export writes for a doctor whose commission lives on
// their profile rather than in a rule. The import recognises it by this exact
// name and writes it back to the profile, so a round-trip changes nothing.
const PROFILE_DEFAULT_NAME = "Profile Default";

const CSV_HEADER = ["doctorName", "name", "type", "value", "scope", "categories", "testIds", "appliesTo", "isExclusive", "isActive"] as const;

function csvEscape(v: unknown): string {
  let s = String(v ?? "");
  // CSV formula-injection guard: neutralise cells that a spreadsheet would
  // otherwise interpret as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Minimal RFC-4180-ish CSV parser → array of records (each an array of raw
// field strings). Handles quoted fields, escaped quotes ("") and
// commas / newlines inside quotes. Blank lines become empty records.
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n"); // normalise CRLF / CR → LF
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field); field = "";
    } else if (ch === "\n") {
      record.push(field); records.push(record); record = []; field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

// ─── GET /rules/export : unified commission CSV for ALL doctors ────────────────
// Commission is configured in two places, both inside the super-admin panel:
//   1) explicit commission_rules entries (Commission Rules → "Add Rule")
//   2) a per-doctor defaultCommission on the doctor profile (Doctor Manager)
// The export unifies both so every doctor with any commission info appears:
// each explicit rule is a row, and a doctor whose profile carries a default
// (and has no active catch-all rule to supersede it) gets one synthesised
// "Profile Default" row (scope="all"). Optional ?doctorId= limits to one doctor.
router.get("/rules/export", async (req, res) => {
  const { doctorId } = req.query as Record<string, string>;
  const wantDoctorId = doctorId ? Number(doctorId) : null;

  const doctors = await db.select().from(doctorsTable);
  const rules = await db.select().from(commissionRulesTable).orderBy(desc(commissionRulesTable.createdAt));

  const rulesByDoctor = new Map<number, RuleInfo[]>();
  const globalRules: RuleInfo[] = [];
  for (const r of rules) {
    if (r.doctorId == null) {
      globalRules.push(r);
      continue;
    }
    if (!rulesByDoctor.has(r.doctorId)) rulesByDoctor.set(r.doctorId, []);
    rulesByDoctor.get(r.doctorId)!.push(r);
  }

  const line = (
    doctorName: string, name: string, type: string, value: number, scope: string,
    categories: string, testIds: string, appliesTo: string, isExclusive: boolean, isActive: boolean,
  ) => [
    csvEscape(doctorName), csvEscape(name), csvEscape(type), csvEscape(value), csvEscape(scope),
    csvEscape(categories), csvEscape(testIds), csvEscape(appliesTo),
    csvEscape(isExclusive ? "true" : "false"), csvEscape(isActive ? "true" : "false"),
  ].join(",");

  const lines = [CSV_HEADER.join(",")];

  // Clinic-wide slabs first (doctorName = ALL DOCTORS).
  if (wantDoctorId == null) {
    for (const r of globalRules) {
      lines.push(line(
        "ALL DOCTORS", r.name, r.type, Number(r.value), r.scope,
        safeParseArray<string>(r.categories).join(";"),
        parseTestIdList(r.testIds).join(";"),
        r.appliesTo ?? "all", r.isExclusive, r.isActive,
      ));
    }
  }

  const doctorList = doctors
    .filter(d => wantDoctorId == null || d.id === wantDoctorId)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const d of doctorList) {
    const dRules = rulesByDoctor.get(d.id) ?? [];
    for (const r of dRules) {
      lines.push(line(
        d.name, r.name, r.type, Number(r.value), r.scope,
        safeParseArray<string>(r.categories).join(";"),
        parseTestIdList(r.testIds).join(";"),
        r.appliesTo ?? "all", r.isExclusive, r.isActive,
      ));
    }
    const defVal = Number(d.defaultCommission ?? 0);
    const hasActiveCatchAll = dRules.some(r => r.isActive && r.scope === "all");
    if (defVal > 0 && !hasActiveCatchAll) {
      lines.push(line(d.name, PROFILE_DEFAULT_NAME, d.defaultCommissionType || "percentage", defVal, "all", "", "", "all", false, true));
    }
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="commission_rules_${wantDoctorId ?? "all"}.csv"`);
  res.send(lines.join("\n"));
});

// ─── POST /rules/import : create rules row-by-row from CSV text ────────────────
// Accepts { csv } JSON (or a raw text body). Matches doctors by name
// case-insensitively, validates each row, and creates commission_rules
// entries — reporting per-row skips so a partial file still imports the good
// rows. A row named "Profile Default"/scope="all" imports as an ordinary
// catch-all rule (materialising the profile default into the super-admin
// panel), which round-trips the unified export.
router.post("/rules/import", async (req, res) => {
  const csv: string = typeof req.body === "string"
    ? req.body
    : (typeof req.body?.csv === "string" ? req.body.csv : "");
  if (!csv.trim()) {
    res.status(400).json({ error: "CSV text is required (send JSON { csv } or a text/csv body)." });
    return;
  }

  const records = parseCsv(csv);
  // Keep every record (don't pre-filter) so reported line numbers match the
  // original file; blank data rows are skipped inside the loop below.
  const hasDataRow = records.slice(1).some(rec => rec.some(c => (c ?? "").trim() !== ""));
  if (records.length < 2 || !hasDataRow) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row." });
    return;
  }

  const header = records[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    doctorName: col("doctorName"), name: col("name"), type: col("type"), value: col("value"),
    scope: col("scope"), categories: col("categories"), testIds: col("testIds"),
    appliesTo: col("appliesTo"), isExclusive: col("isExclusive"), isActive: col("isActive"),
  };
  if (idx.doctorName < 0 || idx.name < 0 || idx.value < 0) {
    res.status(400).json({ error: "CSV header must include at least doctorName, name and value." });
    return;
  }

  const doctors = await db.select({
    id: doctorsTable.id, name: doctorsTable.name,
    defaultCommission: doctorsTable.defaultCommission,
    defaultCommissionType: doctorsTable.defaultCommissionType,
  }).from(doctorsTable);
  const doctorIdByName = new Map<string, number>();
  const doctorProfileById = new Map<number, { value: number; type: string }>();
  for (const d of doctors) {
    doctorIdByName.set(d.name.trim().toLowerCase(), d.id);
    doctorProfileById.set(d.id, { value: Number(d.defaultCommission ?? 0), type: d.defaultCommissionType || "percentage" });
  }

  const maxPct = await commissionMaxPercent();
  const parseBool = (v: string, dflt: boolean) => (v.trim() === "" ? dflt : /^(true|1|yes|y)$/i.test(v.trim()));
  const splitList = (v: string) => v.split(/[;,]/).map(s => s.trim()).filter(Boolean);

  // Existing rules for the doctors named in the file, so a re-import AMENDS the
  // rule it matches instead of adding a second one. Identity is doctor + rule
  // name, case-insensitively — the name is the only stable handle the CSV
  // carries, and it is what an operator edits a row by.
  const existingRules = await db.select().from(commissionRulesTable);
  const existingByKey = new Map<string, (typeof commissionRulesTable.$inferSelect)[]>();
  const ruleKey = (doctorId: number | null, name: string) =>
    `${doctorId == null ? "global" : doctorId}\u0000${name.trim().toLowerCase()}`;
  for (const r of existingRules) {
    const k = ruleKey(r.doctorId, r.name);
    const arr = existingByKey.get(k) ?? [];
    arr.push(r);
    existingByKey.set(k, arr);
  }

  type Pending = {
    line: number;
    values: typeof commissionRulesTable.$inferInsert;
    existing: (typeof commissionRulesTable.$inferSelect) | null;
    doctorName: string;
  };
  const pending: Pending[] = [];
  // Rows that restate a doctor's PROFILE default (the synthesised "Profile
  // Default" row the export writes) go back to the doctor profile they came
  // from, rather than becoming a rule — otherwise a round-trip quietly moves
  // the setting and a second round-trip leaves two catch-all rules behind.
  const profileDefaults: { line: number; doctorId: number; doctorName: string; type: string; value: number }[] = [];
  const errors: { line: number; doctorName: string; error: string }[] = [];

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every(c => (c ?? "").trim() === "")) continue; // skip blank lines
    const lineNo = i + 1; // human-facing line number (1-based, header is line 1)
    const at = (c: number) => (c >= 0 ? (rec[c] ?? "").trim() : "");
    const doctorName = at(idx.doctorName);
    const name = at(idx.name);
    const type = (at(idx.type) || "percentage").toLowerCase();
    const valueRaw = at(idx.value);
    const scope = (at(idx.scope) || "all").toLowerCase();

    if (!doctorName) { errors.push({ line: lineNo, doctorName, error: "Missing doctorName" }); continue; }
    const isGlobal = /^(all doctors|all|global|\*)$/i.test(doctorName.trim());
    const dId = isGlobal ? null : doctorIdByName.get(doctorName.toLowerCase());
    if (!isGlobal && dId == null) { errors.push({ line: lineNo, doctorName, error: `No doctor matches "${doctorName}"` }); continue; }
    if (!name) { errors.push({ line: lineNo, doctorName, error: "Missing rule name" }); continue; }
    if (type !== "percentage" && type !== "fixed") { errors.push({ line: lineNo, doctorName, error: `Invalid type "${type}" (expected percentage or fixed)` }); continue; }
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) { errors.push({ line: lineNo, doctorName, error: `Invalid value "${valueRaw}"` }); continue; }
    if (scope !== "all" && scope !== "category" && scope !== "test") { errors.push({ line: lineNo, doctorName, error: `Invalid scope "${scope}" (expected all, category or test)` }); continue; }
    // Absent column or blank cell → "all", so files exported before this column
    // existed still import with the behaviour they had.
    const appliesTo = (at(idx.appliesTo) || "all").toLowerCase();
    if (!(APPLIES_TO as readonly string[]).includes(appliesTo)) { errors.push({ line: lineNo, doctorName, error: `Invalid appliesTo "${appliesTo}" (expected all, inhouse or outsourced)` }); continue; }

    // The ceiling stops a spreadsheet being used to SET a rate above policy. It
    // deliberately does not fire on a row that restates a rate already stored:
    // the export writes out whatever exists, so checking unchanged rows would
    // make the file the export just produced un-importable whenever some
    // historical rate sits above the current ceiling.
    const ceilingUnless = (unchanged: boolean) => (unchanged ? null : rateCeilingError(type, value, maxPct));

    // The export synthesises this exact row from doctors.defaultCommission, so
    // it is sent back where it came from and the round-trip is lossless.
    if (name.trim().toLowerCase() === PROFILE_DEFAULT_NAME.toLowerCase() && scope === "all") {
      if (dId == null) {
        errors.push({ line: lineNo, doctorName, error: "Profile Default rows must name a doctor, not ALL DOCTORS" });
        continue;
      }
      const prof = doctorProfileById.get(dId);
      const sameAsProfile = !!prof && Number(prof.value) === value && prof.type === type;
      const pdErr = ceilingUnless(sameAsProfile);
      if (pdErr) { errors.push({ line: lineNo, doctorName, error: pdErr }); continue; }
      profileDefaults.push({ line: lineNo, doctorId: dId, doctorName, type, value });
      continue;
    }

    const categories = scope === "category" ? splitList(at(idx.categories)) : [];
    const testIds = scope === "test" ? splitList(at(idx.testIds)).map(Number).filter(n => Number.isFinite(n)) : [];

    // More than one existing rule with this name is a pre-existing ambiguity
    // (older imports could only ever create), and guessing which to amend would
    // silently change what a doctor is paid. Say so instead.
    const matches = existingByKey.get(ruleKey(dId, name)) ?? [];
    const sameAsStored = matches.length === 1 && Number(matches[0].value) === value && matches[0].type === type;
    const ceilErr = ceilingUnless(sameAsStored);
    if (ceilErr) { errors.push({ line: lineNo, doctorName, error: ceilErr }); continue; }
    if (matches.length > 1) {
      errors.push({ line: lineNo, doctorName, error: `${matches.length} existing rules are named "${name}" for this doctor — delete the duplicates first, then re-import.` });
      continue;
    }

    pending.push({
      line: lineNo,
      doctorName,
      existing: matches[0] ?? null,
      values: {
        doctorId: dId,
        name,
        type,
        value: value.toString(),
        scope,
        categories: categories.length ? JSON.stringify(categories) : null,
        testIds: testIds.length ? JSON.stringify(testIds) : null,
        appliesTo,
        isExclusive: parseBool(at(idx.isExclusive), false),
        isActive: parseBool(at(idx.isActive), true),
      },
    });
  }

  let created = 0, updated = 0, unchanged = 0;
  const auditRows: { action: string; id: number; reason: string; oldValue?: string; newValue?: string }[] = [];

  for (const p of pending) {
    const snap = (r: { name: string; type: string; value: string | number; scope: string; appliesTo?: string | null; isExclusive: boolean; isActive: boolean }) =>
      JSON.stringify({ name: r.name, type: r.type, value: Number(r.value), scope: r.scope, appliesTo: r.appliesTo ?? "all", isExclusive: r.isExclusive, isActive: r.isActive });
    const rateOf = (type: string, value: number) => (type === "percentage" ? `${value}%` : `Rs.${value}`);

    if (p.existing) {
      const before = snap(p.existing);
      const [row] = await db.update(commissionRulesTable).set(p.values).where(eq(commissionRulesTable.id, p.existing.id)).returning();
      const after = snap(row);
      if (before === after) { unchanged++; continue; }
      updated++;
      const rateMoved = Number(p.existing.value) !== Number(row.value) || p.existing.type !== row.type;
      auditRows.push({
        action: "edit", id: row.id, oldValue: before, newValue: after,
        reason: rateMoved
          ? `CSV import — rate changed: ${rateOf(p.existing.type, Number(p.existing.value))} → ${rateOf(row.type, Number(row.value))} (${row.name})`
          : `CSV import — slab updated: ${row.name}`,
      });
    } else {
      const [row] = await db.insert(commissionRulesTable).values(p.values).returning();
      created++;
      auditRows.push({
        action: "create", id: row.id, newValue: snap(row),
        reason: `CSV import — slab created: ${row.name} = ${rateOf(row.type, Number(row.value))}`,
      });
    }
  }

  // Profile defaults, applied to the doctor rather than as rules.
  let profileUpdated = 0;
  for (const pd of profileDefaults) {
    const [before] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, pd.doctorId));
    if (!before) continue;
    if (Number(before.defaultCommission) === pd.value && (before.defaultCommissionType || "percentage") === pd.type) continue;
    await db.update(doctorsTable)
      .set({ defaultCommission: pd.value.toFixed(2), defaultCommissionType: pd.type })
      .where(eq(doctorsTable.id, pd.doctorId));
    profileUpdated++;
    await auditFromRequest(req, {
      action: "edit",
      module: "commission",
      entityType: "doctor_default_commission",
      entityId: String(pd.doctorId),
      oldValue: JSON.stringify({ value: Number(before.defaultCommission), type: before.defaultCommissionType }),
      newValue: JSON.stringify({ value: pd.value, type: pd.type }),
      reason: `CSV import — profile default for ${pd.doctorName}: ${Number(before.defaultCommission)} → ${pd.value}`,
    });
  }

  // A bulk rate change must leave the same trail a single-rule edit does — this
  // is the one path that can move every doctor's rate in a single request.
  for (const a of auditRows) {
    await auditFromRequest(req, {
      action: a.action,
      module: "commission",
      entityType: "commission_rule",
      entityId: String(a.id),
      oldValue: a.oldValue,
      newValue: a.newValue,
      reason: a.reason,
    });
  }

  const touched = created + updated + profileUpdated;
  // 400 only when nothing at all could be imported; otherwise 200 with a
  // per-row error list so the UI can report partial success.
  res.status(touched === 0 && unchanged === 0 && errors.length > 0 ? 400 : 200).json({
    ok: errors.length === 0,
    created,
    updated,
    unchanged,
    profileDefaultsUpdated: profileUpdated,
    skipped: errors.length,
    total: records.length - 1,
    errors,
  });
});

// ─── Commission calculation ───────────────────────────────────────────────────
// The maths itself lives in ../lib/commissionCalc so that this report, the
// Doctor Ledger and the reconcile cron cannot drift apart (they did once — the
// old month-end email disagreed with this report for 9 of 10 doctors).
type TestInfo = { id: number; name: string; category: string | null; price: number; testType?: string | null; outsourcedLabId?: number | null };
type RuleInfo = typeof import("@workspace/db/schema").commissionRulesTable.$inferSelect;
type DoctorInfo = typeof import("@workspace/db/schema").doctorsTable.$inferSelect;

// Per-order finalized/delivered flags (only for report_* policies): an order is
// finalized/delivered only when every non-cancelled order-test has a
// finalized/delivered report (pathology via patient_reports, radiology via
// radiology_studies).
async function fetchOrderReportStatus(
  orderIds: number[],
  activeOrderTestIdsByOrder: Map<number, number[]>,
): Promise<Map<number, { finalized: boolean; delivered: boolean }>> {
  const out = new Map<number, { finalized: boolean; delivered: boolean }>();
  if (!orderIds.length) return out;
  const [prs, rss] = await Promise.all([
    db.select({ orderTestId: patientReportsTable.orderTestId, status: patientReportsTable.status })
      .from(patientReportsTable).where(inArray(patientReportsTable.orderId, orderIds)),
    db.select({ orderTestId: radiologyStudiesTable.orderTestId, status: radiologyStudiesTable.status })
      .from(radiologyStudiesTable).where(inArray(radiologyStudiesTable.orderId, orderIds)),
  ]);
  const testFinal = new Set<number>();
  const testDeliv = new Set<number>();
  for (const r of prs) {
    if (r.orderTestId == null) continue;
    if (r.status === "verified" || r.status === "delivered") testFinal.add(r.orderTestId);
    if (r.status === "delivered") testDeliv.add(r.orderTestId);
  }
  for (const r of rss) {
    if (r.orderTestId == null) continue;
    if (r.status === "reported_final" || r.status === "delivered") testFinal.add(r.orderTestId);
    if (r.status === "delivered") testDeliv.add(r.orderTestId);
  }
  for (const [orderId, otIds] of activeOrderTestIdsByOrder) {
    out.set(orderId, {
      finalized: otIds.length > 0 && otIds.every(id => testFinal.has(id)),
      delivered: otIds.length > 0 && otIds.every(id => testDeliv.has(id)),
    });
  }
  return out;
}

// Commission payout report (consolidated — for backwards compat)
router.get("/report", async (req, res) => {
  const { from, to, doctorId } = req.query as Record<string, string>;

  // Fetch clinic settings to determine commission discount mode.
  const [clinicRow] = await db.select({
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    commissionOutsourcedBasis: clinicSettingsTable.commissionOutsourcedBasis,
    vipPercentage: clinicSettingsTable.vipPercentage,
  }).from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const outsourcedBasis = clinicRow?.commissionOutsourcedBasis ?? "price";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable).orderBy(commissionRulesTable.id);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category, price: Number(t.price), testType: t.testType }]));
  const testAliasIndex = buildTestNameAliasIndex(allTests);

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled"))) : [];
  const billsForOrders = orderIds.length ? await db.select().from(billsTable).where(inArray(billsTable.orderId, orderIds)) : [];
  // Billed + non-cancelled only — unbilled duplicate orders never enter this report.
  const billByOrderId = indexCommissionBillsByOrderId(billsForOrders);
  const discountedOrderIds = new Set(
    [...billByOrderId.values()].filter(b => Number(b.discount) > 0).map(b => b.orderId).filter((id): id is number => id != null),
  );
  // Map orderId → bill discount amount for the deduction logic.
  const billDiscountByOrderId = new Map<number, number>();
  for (const [oid, b] of billByOrderId) {
    billDiscountByOrderId.set(oid, Number(b.discount ?? 0));
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const report = doctors
    .filter(d => !doctorId || d.id === Number(doctorId))
    .map(doctor => {
      const doctorOrders = orders.filter(o => o.doctorId === doctor.id && billByOrderId.has(o.id));
      const rules = rulesForDoctor(allRules, doctor.id);
      let totalRevenue = 0, totalCommission = 0, totalDiscountDeducted = 0;
      let testsFullPrice = 0, testsDiscounted = 0;
      let revenueFullPrice = 0, revenueDiscounted = 0;
      let commissionFullPrice = 0, commissionDiscounted = 0;
      let ordersFullPrice = 0, ordersDiscounted = 0;
      const orderDetails: { orderId: number; orderNumber: string; date: string; revenue: number; commission: number; rawCommission: number; discountDeducted: number; commissionRule: string; isDiscounted: boolean }[] = [];

      for (const order of doctorOrders) {
        const tests = orderTests.filter(ot => ot.orderId === order.id);
        if (tests.length === 0) continue;
        const isDisc = discountedOrderIds.has(order.id);
        let orderRevenue = 0, rawOrderCommission = 0, lastRule = "Default";
        for (const ot of tests) {
          const test = testMap.get(ot.testId);
          const { commission, ruleName } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct, outsourcedBasis, testAliasIndex);
          orderRevenue += Number(ot.price);
          rawOrderCommission += commission;
          lastRule = ruleName;
          if (isDisc) testsDiscounted++; else testsFullPrice++;
        }
        const billDiscount = billDiscountByOrderId.get(order.id) ?? 0;
        const { net: orderCommission, deducted } = applyDiscountDeduction(rawOrderCommission, billDiscount, commissionDiscountMode);
        totalRevenue += orderRevenue;
        totalCommission += orderCommission;
        totalDiscountDeducted += deducted;
        if (isDisc) { ordersDiscounted++; revenueDiscounted += orderRevenue; commissionDiscounted += orderCommission; }
        else        { ordersFullPrice++;  revenueFullPrice  += orderRevenue; commissionFullPrice  += orderCommission; }
        orderDetails.push({ orderId: order.id, orderNumber: order.orderNumber, date: order.createdAt.toISOString().split("T")[0], revenue: orderRevenue, commission: orderCommission, rawCommission: rawOrderCommission, discountDeducted: deducted, commissionRule: lastRule, isDiscounted: isDisc });
      }

      return {
        doctorId: doctor.id,
        doctorName: doctor.name,
        specialization: doctor.specialization ?? "",
        totalOrders: orderDetails.length,
        totalBilled: totalRevenue,
        commissionAmount: totalCommission,
        totalDiscountDeducted,
        commissionDiscountMode,
        commissionType: doctor.defaultCommissionType ?? "percentage",
        commissionValue: Number(doctor.defaultCommission ?? 0),
        // Discount-aware breakdown
        ordersFullPrice,
        ordersDiscounted,
        testsFullPrice,
        testsDiscounted,
        revenueFullPrice,
        revenueDiscounted,
        commissionFullPrice,
        commissionDiscounted,
        doctor: { ...doctor, defaultCommission: Number(doctor.defaultCommission) },
        orders: orderDetails,
      };
    });

  res.json(report);
});

// ─── Detailed commission report (test-wise / category-wise / consolidated) ────
router.get("/report-detailed", async (req, res) => {
  const { from, to, doctorId, groupBy = "order" } = req.query as Record<string, string>;

  // Fetch clinic settings for commission discount mode.
  const [clinicRow] = await db.select({
    commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
    commissionOutsourcedBasis: clinicSettingsTable.commissionOutsourcedBasis,
    vipPercentage: clinicSettingsTable.vipPercentage,
  }).from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const outsourcedBasis = clinicRow?.commissionOutsourcedBasis ?? "price";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable).orderBy(commissionRulesTable.id);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category ?? "Other", price: Number(t.price), testType: t.testType }]));
  const testAliasIndex = buildTestNameAliasIndex(allTests);

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  const orders = await db.select().from(ordersTable).where(conditions.length ? and(...conditions) : undefined);
  const orderIds = orders.map(o => o.id);
  const orderTests = orderIds.length ? await db.select().from(orderTestsTable).where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled"))) : [];
  // Fetch bills to get discount amounts per order — billed + non-cancelled only.
  const billsForOrders = orderIds.length
    ? await db.select({ orderId: billsTable.orderId, discount: billsTable.discount, status: billsTable.status }).from(billsTable).where(inArray(billsTable.orderId, orderIds))
    : [];
  const billByOrderId = indexCommissionBillsByOrderId(billsForOrders);
  const billDiscountByOrderId = new Map<number, number>();
  for (const [oid, b] of billByOrderId) {
    billDiscountByOrderId.set(oid, Number(b.discount ?? 0));
  }

  const tokens = orderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, orderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  const filteredDoctors = doctors.filter(d => !doctorId || d.id === Number(doctorId));

  const result = filteredDoctors.map(doctor => {
    const doctorOrders = orders.filter(o => o.doctorId === doctor.id && billByOrderId.has(o.id));
    const rules = rulesForDoctor(allRules, doctor.id);

    // Build flat test-level rows
    type TestRow = {
      testId: number; testName: string; category: string;
      orderId: number; orderNumber: string; orderDate: string;
      price: number; commission: number; ruleName: string;
      ruleType: string; ruleValue: number;
    };
    const testRows: TestRow[] = [];

    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.id);
      if (ots.length === 0) continue;
      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        const { commission, ruleName, ruleType, ruleValue } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct, outsourcedBasis, testAliasIndex);
        testRows.push({
          testId: ot.testId,
          testName: test?.name ?? "Unknown",
          category: test?.category ?? "Other",
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderDate: order.createdAt.toISOString().split("T")[0],
          price: Number(ot.price),
          commission,
          ruleName,
          ruleType,
          ruleValue,
        });
      }
    }

    const totalRevenue = testRows.reduce((s, r) => s + r.price, 0);

    // Compute per-order adjusted commissions and total deduction for this doctor.
    // Discount deduction is applied at order level, not per-test, because the
    // bill discount belongs to the whole order (bill), not individual test lines.
    const orderAdjustedCommission = new Map<number, number>(); // orderId → adjusted
    let totalDiscountDeducted = 0;
    {
      const orderIdsForDoctor = [...new Set(testRows.map(r => r.orderId))];
      for (const oid of orderIdsForDoctor) {
        const rawOrderCommission = testRows.filter(r => r.orderId === oid).reduce((s, r) => s + r.commission, 0);
        const billDiscount = billDiscountByOrderId.get(oid) ?? 0;
        const { net, deducted } = applyDiscountDeduction(rawOrderCommission, billDiscount, commissionDiscountMode);
        orderAdjustedCommission.set(oid, net);
        totalDiscountDeducted += deducted;
      }
    }
    const totalCommission = [...orderAdjustedCommission.values()].reduce((s, v) => s + v, 0);

    // Build groupBy views
    let grouped: unknown = null;

    if (groupBy === "test") {
      const byTest: Record<number, { testId: number; testName: string; category: string; count: number; revenue: number; commission: number; ruleName: string; ruleValue: number; ruleType: string }> = {};
      for (const row of testRows) {
        if (!byTest[row.testId]) {
          // ruleType/ruleValue come straight from calcTestCommission's actual
          // decision (row.ruleType / row.ruleValue), so the displayed rate is
          // always the one that produced this commission. (Previously a
          // separate rules.find() re-derived it with different precedence and
          // could show a catch-all rule that was never applied.)
          byTest[row.testId] = { testId: row.testId, testName: row.testName, category: row.category, count: 0, revenue: 0, commission: 0, ruleName: row.ruleName, ruleValue: row.ruleValue, ruleType: row.ruleType };
        }
        byTest[row.testId].count++;
        byTest[row.testId].revenue += row.price;
        byTest[row.testId].commission += row.commission;
      }
      grouped = Object.values(byTest).sort((a, b) => b.commission - a.commission);
    } else if (groupBy === "category") {
      const byCat: Record<string, { category: string; testCount: number; orderCount: number; revenue: number; commission: number }> = {};
      for (const row of testRows) {
        if (!byCat[row.category]) byCat[row.category] = { category: row.category, testCount: 0, orderCount: 0, revenue: 0, commission: 0 };
        byCat[row.category].testCount++;
        byCat[row.category].revenue += row.price;
        byCat[row.category].commission += row.commission;
      }
      // Count unique orders per category
      for (const row of testRows) {
        const cat = byCat[row.category];
        cat.orderCount = new Set(testRows.filter(r => r.category === row.category).map(r => r.orderId)).size;
      }
      grouped = Object.values(byCat).sort((a, b) => b.commission - a.commission);
    } else if (groupBy === "order") {
      const byOrder: Record<number, { orderId: number; orderNumber: string; orderDate: string; testCount: number; revenue: number; commission: number; rawCommission: number; discountDeducted: number; tests: TestRow[] }> = {};
      for (const row of testRows) {
        if (!byOrder[row.orderId]) {
          const adjusted = orderAdjustedCommission.get(row.orderId) ?? 0;
          const rawOrderComm = testRows.filter(r => r.orderId === row.orderId).reduce((s, r) => s + r.commission, 0);
          byOrder[row.orderId] = { orderId: row.orderId, orderNumber: row.orderNumber, orderDate: row.orderDate, testCount: 0, revenue: 0, commission: adjusted, rawCommission: rawOrderComm, discountDeducted: rawOrderComm - adjusted, tests: [] };
        }
        byOrder[row.orderId].testCount++;
        byOrder[row.orderId].revenue += row.price;
        byOrder[row.orderId].tests.push(row);
      }
      grouped = Object.values(byOrder).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    } else {
      grouped = null; // consolidated — just totals
    }

    return {
      doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization, defaultCommission: Number(doctor.defaultCommission), defaultCommissionType: doctor.defaultCommissionType },
      orderCount: doctorOrders.length,
      testCount: testRows.length,
      totalRevenue,
      totalCommission,
      totalDiscountDeducted,
      commissionDiscountMode,
      effectiveRate: totalRevenue > 0 ? Number(((totalCommission / totalRevenue) * 100).toFixed(2)) : 0,
      grouped,
      testRows: groupBy === "test" ? testRows : undefined,
    };
  });

  const grandTotal = {
    doctors: result.filter(r => r.orderCount > 0).length,
    orders: result.reduce((s, r) => s + r.orderCount, 0),
    revenue: result.reduce((s, r) => s + r.totalRevenue, 0),
    commission: result.reduce((s, r) => s + r.totalCommission, 0),
    totalDiscountDeducted: result.reduce((s, r) => s + r.totalDiscountDeducted, 0),
  };

  res.json({ report: result.filter(r => r.orderCount > 0), grandTotal });
});

// ── Referral Report by Patient (per-visit, per-test rows) ─────────────────────
// Returns each referral doctor's rows: one row per test per patient visit,
// with patient name, date, bill number, commission, and rule details.
// Used by the "Referral Report (Doctor Name)" page in the super-admin portal.
// Computes the full per-patient referral-commission report. Extracted from the
// route so other endpoints (the WhatsApp sender, the rate analysis views) read
// the SAME figures instead of re-deriving them — re-deriving is exactly how the
// month-end email drifted away from this report.
export async function computeReferralReport(q: { from?: string; to?: string; doctorId?: string }) {
  const { from, to, doctorId } = q;

  const [clinicRow] = await db
    .select({
      commissionDiscountMode: clinicSettingsTable.commissionDiscountMode,
      commissionOutsourcedBasis: clinicSettingsTable.commissionOutsourcedBasis,
      vipPercentage: clinicSettingsTable.vipPercentage,
      commissionEligibilityPolicy: clinicSettingsTable.commissionEligibilityPolicy,
      commissionEligibilityMinAmount: clinicSettingsTable.commissionEligibilityMinAmount,
    })
    .from(clinicSettingsTable).limit(1);
  const commissionDiscountMode = clinicRow?.commissionDiscountMode ?? "none";
  const outsourcedBasis = clinicRow?.commissionOutsourcedBasis ?? "price";
  const vipPct = clinicRow?.vipPercentage ? Number(clinicRow.vipPercentage) : 50.00;
  const eligCfg: EligibilityConfig = {
    policy: clinicRow?.commissionEligibilityPolicy ?? "full_payment_collected",
    minAmount: Number(clinicRow?.commissionEligibilityMinAmount ?? 0),
  };

  const doctors = await db.select().from(doctorsTable);
  const allRules = await db.select().from(commissionRulesTable).orderBy(commissionRulesTable.id);
  const allTests = await db.select().from(testsTable);
  const testMap = new Map(allTests.map(t => [t.id, { id: t.id, name: t.name, category: t.category ?? "Other", price: Number(t.price), testType: t.testType, outsourcedLabId: t.outsourcedLabId }]));
  const testAliasIndex = buildTestNameAliasIndex(allTests);
  const labs = await db.select({ id: outsourcedLabsTable.id, name: outsourcedLabsTable.name }).from(outsourcedLabsTable);
  const labNameById = new Map(labs.map(l => [l.id, l.name]));

  const conditions = [];
  if (doctorId) conditions.push(eq(ordersTable.doctorId, Number(doctorId)));
  if (from) conditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(ordersTable.createdAt, new Date(to + "T23:59:59Z")));

  // Fetch orders joined with patient names
  const ordersWithPatients = await db
    .select({
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      orderDate: ordersTable.createdAt,
      doctorId: ordersTable.doctorId,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      patientPid: patientsTable.patientId,
    })
    .from(ordersTable)
    .innerJoin(patientsTable, eq(ordersTable.patientId, patientsTable.id))
    .where(conditions.length ? and(...conditions) : undefined);

  const orderIds = ordersWithPatients.map(o => o.orderId);
  const orderTests = orderIds.length
    ? await db.select().from(orderTestsTable)
        .where(and(inArray(orderTestsTable.orderId, orderIds), ne(orderTestsTable.status, "cancelled")))
    : [];

  const billsForOrders = orderIds.length
    ? await db
        .select({ orderId: billsTable.orderId, billNumber: billsTable.billNumber, discount: billsTable.discount, subtotal: billsTable.subtotal, status: billsTable.status, paidAmount: billsTable.paidAmount, balanceAmount: billsTable.balanceAmount })
        .from(billsTable).where(inArray(billsTable.orderId, orderIds))
    : [];

  // Billed + non-cancelled only. Unbilled duplicate orders must not generate
  // commission rows (they previously appeared as held "Not billed" lines).
  const billByOrderRaw = indexCommissionBillsByOrderId(billsForOrders);
  const billByOrderId = new Map<number, { billNumber: string; discount: number; subtotal: number; status: string | null; paid: number; balance: number }>();
  for (const [oid, b] of billByOrderRaw) {
    billByOrderId.set(oid, {
      billNumber: b.billNumber,
      discount: Number(b.discount ?? 0),
      subtotal: Number(b.subtotal ?? 0),
      status: b.status ?? null,
      paid: Number(b.paidAmount ?? 0),
      balance: Number(b.balanceAmount ?? 0),
    });
  }

  // Drop unbilled / cancelled-bill-only orders before any commission maths.
  const billedOrdersWithPatients = ordersWithPatients.filter(o => billByOrderId.has(o.orderId));
  const billedOrderIds = billedOrdersWithPatients.map(o => o.orderId);

  const tokens = billedOrderIds.length
    ? await db.select({ orderTestId: testTokensTable.orderTestId })
        .from(testTokensTable)
        .where(and(inArray(testTokensTable.orderId, billedOrderIds), sql`${testTokensTable.priority} > 0`))
    : [];
  const vipOrderTestIds = new Set(tokens.map(t => t.orderTestId).filter(Boolean) as number[]);

  // Report finalized/delivered per order — only fetched for the report_* policies.
  let reportStatusByOrder = new Map<number, { finalized: boolean; delivered: boolean }>();
  if (NEEDS_REPORT_STATUS(eligCfg.policy)) {
    const activeOrderTestIdsByOrder = new Map<number, number[]>();
    for (const ot of orderTests) {
      if (!billByOrderId.has(ot.orderId)) continue;
      const arr = activeOrderTestIdsByOrder.get(ot.orderId) ?? [];
      arr.push(ot.id);
      activeOrderTestIdsByOrder.set(ot.orderId, arr);
    }
    reportStatusByOrder = await fetchOrderReportStatus(billedOrderIds, activeOrderTestIdsByOrder);
  }

  const filteredDoctors = doctors.filter(d => !doctorId || d.id === Number(doctorId));

  type PatientRow = {
    date: string;
    patientName: string;
    patientPid: string;
    orderId: number;
    orderNumber: string;
    billNumber: string;
    testId: number;
    testName: string;
    category: string;
    price: number;
    // "actual" — commission after the clinic's bill-discount deduction
    // (commissionDiscountMode) is applied at order level and spread per row.
    commission: number;
    // "expected" — the commission before any discount deduction. The referral
    // report's discount breakdown shows: expected − (expected−actual) = actual,
    // where the deducted amount is the referral discount given up on the bill.
    grossCommission: number;
    // Bill-level discount context (repeated on each test row of the bill) for
    // the selectable Bill-Discount column shown as ₹ or % of subtotal.
    billDiscount: number;
    billSubtotal: number;
    // Payment-aware eligibility: whether this order's commission is on hold
    // (excluded from payable) and why (repeated on each test row of the order).
    held: boolean;
    holdReason: string | null;
    ruleType: string;
    ruleValue: number;
    ruleName: string;
    // Where the rate came from: an explicit test/category slab, the catch-all,
    // the doctor's profile default, or nothing at all.
    ruleScope: RuleScope;
    // "Why this amount?" drill-down: the price actually used as the commission
    // base (VIP surcharge stripped) and whether that stripping happened, so the
    // UI can show base = price ÷ (1 + vip%) → expected → −discount → actual.
    commissionBase: number;
    vipAdjusted: boolean;
    // Outsourced work: what the clinic pays the external lab for this line, and
    // what it therefore keeps. Reported regardless of the configured basis, so
    // the margin is visible even when commission is still charged on price.
    isOutsourced: boolean;
    outsourceCost: number;
    margin: number;
    // On the margin basis a fixed-amount slab can still ask for more than the
    // clinic kept; when that happens the payout is capped at the margin and the
    // original ask is reported here so the reduction is never silent.
    cappedToMargin: boolean;
    uncappedCommission: number;
    // Which external lab did this line, so margin can be totalled per lab —
    // the question "which lab is eating my margin" is only answerable here.
    labId: number | null;
    labName: string;
  };

  const result = filteredDoctors.map(doctor => {
    const doctorOrders = billedOrdersWithPatients.filter(o => o.doctorId === doctor.id);
    const rules = rulesForDoctor(allRules, doctor.id);

    // Build per-order discount-adjusted commission ratio + eligibility hold
    const orderAdjustRatio = new Map<number, number>();
    const orderHold = new Map<number, { held: boolean; reason: string | null }>();
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      const rawOrderComm = ots.reduce((s, ot) => s + calcTestCommission(ot, testMap.get(ot.testId), rules, doctor, vipOrderTestIds, vipPct, outsourcedBasis, testAliasIndex).commission, 0);
      const bill = billByOrderId.get(order.orderId);
      const { net } = applyDiscountDeduction(rawOrderComm, bill?.discount ?? 0, commissionDiscountMode);
      orderAdjustRatio.set(order.orderId, rawOrderComm > 0 ? net / rawOrderComm : 1);
      const rep = reportStatusByOrder.get(order.orderId);
      orderHold.set(order.orderId, computeCommissionHold({
        cfg: eligCfg,
        hasBill: !!bill,
        billStatus: bill?.status ?? null,
        paidAmount: bill?.paid ?? 0,
        balanceAmount: bill?.balance ?? 0,
        reportFinalized: rep?.finalized ?? false,
        reportDelivered: rep?.delivered ?? false,
        commissionAmount: net,
      }));
    }

    const rows: PatientRow[] = [];
    for (const order of doctorOrders) {
      const ots = orderTests.filter(ot => ot.orderId === order.orderId);
      if (ots.length === 0) continue;
      const bill = billByOrderId.get(order.orderId);
      // Bill is guaranteed by billedOrdersWithPatients filter; keep the guard
      // so a future refactor cannot reintroduce unbilled rows.
      if (!bill) continue;
      const ratio = orderAdjustRatio.get(order.orderId) ?? 1;

      for (const ot of ots) {
        const test = testMap.get(ot.testId);
        // ruleType/ruleValue come from the same decision that produced the
        // commission (calcTestCommission → findMatchingRule), so the displayed
        // rate always reflects the rule actually applied.
        const {
          commission: rawComm, ruleName, ruleType, ruleValue, ruleScope,
          isOutsourced, outsourceCost, commissionBase, cappedToMargin, uncappedCommission,
        } = calcTestCommission(ot, test, rules, doctor, vipOrderTestIds, vipPct, outsourcedBasis, testAliasIndex);
        // commissionBase comes straight from the engine — it is the exact figure
        // the rate was applied to, after the VIP surcharge is stripped and, on
        // the margin basis, after the lab cost is taken off. Re-deriving it here
        // is how the drill-down came to show a base the calculation never used.
        const vipAdjusted = !!ot.id && vipOrderTestIds.has(ot.id) && vipPct > 0;
        rows.push({
          date: order.orderDate.toISOString().split("T")[0],
          patientName: `${order.patientFirstName} ${order.patientLastName}`.trim().toUpperCase(),
          patientPid: order.patientPid,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          billNumber: bill?.billNumber ?? "",
          testId: ot.testId,
          testName: test?.name ?? "Unknown",
          category: test?.category ?? "Other",
          price: Number(ot.price),
          commission: rawComm * ratio,   // actual (net of discount deduction)
          grossCommission: rawComm,      // expected (before discount deduction)
          billDiscount: bill?.discount ?? 0,
          billSubtotal: bill?.subtotal ?? 0,
          held: orderHold.get(order.orderId)?.held ?? false,
          holdReason: orderHold.get(order.orderId)?.reason ?? null,
          ruleType,
          ruleValue,
          ruleName,
          ruleScope,
          commissionBase,
          vipAdjusted,
          isOutsourced,
          outsourceCost,
          margin: Number(ot.price) - outsourceCost,
          cappedToMargin,
          uncappedCommission,
          labId: isOutsourced ? (test?.outsourcedLabId ?? null) : null,
          labName: isOutsourced ? (labNameById.get(test?.outsourcedLabId ?? -1) ?? "Unassigned lab") : "",
        });
      }
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const totalCommission = rows.reduce((s, r) => s + r.commission, 0);           // actual (all)
    const payableCommission = rows.filter(r => !r.held).reduce((s, r) => s + r.commission, 0);  // eligible now
    const heldCommission = rows.filter(r => r.held).reduce((s, r) => s + r.commission, 0);       // on hold
    const totalExpectedCommission = rows.reduce((s, r) => s + r.grossCommission, 0); // expected
    const totalRevenue = rows.reduce((s, r) => s + r.price, 0);
    const outsourcedCost = rows.reduce((s, r) => s + r.outsourceCost, 0);
    const outsourcedRevenue = rows.filter(r => r.isOutsourced).reduce((s, r) => s + r.price, 0);
    const outsourcedCommission = rows.filter(r => r.isOutsourced).reduce((s, r) => s + r.commission, 0);
    const uniqueOrders = new Set(rows.map(r => r.orderId)).size;

    return {
      doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization },
      rows,
      totalCommission,
      payableCommission,
      heldCommission,
      totalExpectedCommission,
      totalDiscount: totalExpectedCommission - totalCommission,
      totalRevenue,
      // Margin on outsourced lines = what those lines billed, less the lab cost.
      // If outsourcedCommission exceeds it, the clinic is paying out more than
      // it earned on that work — the case the "margin" basis exists to prevent.
      outsourcedRevenue,
      outsourcedCost,
      outsourcedMargin: outsourcedRevenue - outsourcedCost,
      outsourcedCommission,
      orderCount: uniqueOrders,
      testCount: rows.length,
    };
  }).filter(d => d.rows.length > 0);

  return {
    report: result,
    // Clinic-level context for the "Why this amount?" drill-down.
    settings: { vipPct, commissionDiscountMode, outsourcedBasis },
    grandTotal: {
      doctors: result.length,
      orders: result.reduce((s, d) => s + d.orderCount, 0),
      revenue: result.reduce((s, d) => s + d.totalRevenue, 0),
      commission: result.reduce((s, d) => s + d.totalCommission, 0),
      payableCommission: result.reduce((s, d) => s + d.payableCommission, 0),
      heldCommission: result.reduce((s, d) => s + d.heldCommission, 0),
      expectedCommission: result.reduce((s, d) => s + d.totalExpectedCommission, 0),
      discount: result.reduce((s, d) => s + d.totalDiscount, 0),
      outsourcedRevenue: result.reduce((s, d) => s + d.outsourcedRevenue, 0),
      outsourcedCost: result.reduce((s, d) => s + d.outsourcedCost, 0),
      outsourcedMargin: result.reduce((s, d) => s + d.outsourcedMargin, 0),
      outsourcedCommission: result.reduce((s, d) => s + d.outsourcedCommission, 0),
    },
  };
}

router.get("/report-by-patient", async (req, res) => {
  const { from, to, doctorId } = req.query as Record<string, string>;
  res.json(await computeReferralReport({ from, to, doctorId }));
});

// ─── WhatsApp: send a doctor their commission for a period ────────────────────
// Reachable only with the pen drive (the whole commission router sits behind
// requireSuperAdmin). There is deliberately NO scheduled/automatic variant —
// commission leaves the building only when an operator holding the drive
// chooses to send it.
//
// Three detail levels, because what a doctor should see varies:
//   amount    — the figure only
//   summary   — the figure plus referral/test counts (and anything on hold)
//   breakdown — the above plus a per-test list
const WA_DETAILS = ["amount", "summary", "breakdown"] as const;
type WaDetail = (typeof WA_DETAILS)[number];

const fmtINR = (n: number) =>
  "Rs." + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPeriod = (from?: string, to?: string) => {
  const d = (s?: string) => {
    if (!s) return null;
    const [y, m, dd] = s.split("-");
    return `${dd}/${m}/${y}`;
  };
  const a = d(from), b = d(to);
  if (a && b) return `${a} to ${b}`;
  if (a) return `from ${a}`;
  if (b) return `up to ${b}`;
  return "all time";
};

type WaEntry = {
  doctor: { id: number; name: string };
  rows: { testName: string; commission: number; held: boolean }[];
  totalCommission: number;
  payableCommission: number;
  heldCommission: number;
  orderCount: number;
  testCount: number;
};

function buildCommissionMessage(
  entry: WaEntry,
  opts: { detail: WaDetail; basis: "payable" | "total"; period: string; clinicName: string },
): string {
  const amount = opts.basis === "payable" ? entry.payableCommission : entry.totalCommission;
  const L: string[] = [];
  L.push(`Dear Dr. ${entry.doctor.name.replace(/^Dr\.?\s*/i, "")},`);
  L.push("");
  L.push(`Your referral commission for ${opts.period} is *${fmtINR(amount)}*.`);

  if (opts.detail !== "amount") {
    L.push("");
    L.push(`Referrals: ${entry.orderCount} patient${entry.orderCount === 1 ? "" : "s"}, ${entry.testCount} test${entry.testCount === 1 ? "" : "s"}.`);
    if (opts.basis === "payable" && entry.heldCommission > 0.005) {
      L.push(`A further ${fmtINR(entry.heldCommission)} is pending and will be released once the related bills are settled.`);
    }
  }

  if (opts.detail === "breakdown") {
    // One line per test, largest first. Held lines are marked so the figures
    // visibly reconcile to the amount above.
    const byTest = new Map<string, { amount: number; count: number; held: boolean }>();
    for (const r of entry.rows) {
      if (opts.basis === "payable" && r.held) continue;
      const cur = byTest.get(r.testName) ?? { amount: 0, count: 0, held: r.held };
      cur.amount += r.commission;
      cur.count += 1;
      byTest.set(r.testName, cur);
    }
    const list = [...byTest.entries()].sort((a, b) => b[1].amount - a[1].amount);
    if (list.length) {
      L.push("");
      L.push("Breakdown:");
      for (const [name, v] of list) {
        L.push(`- ${name} x${v.count}: ${fmtINR(v.amount)}`);
      }
    }
  }

  L.push("");
  L.push(`- ${opts.clinicName}`);
  return L.join("\n");
}

router.post("/whatsapp/send", async (req, res) => {
  const body = (req.body ?? {}) as {
    doctorIds?: unknown; from?: string; to?: string;
    detail?: string; basis?: string; dryRun?: boolean;
  };
  const doctorIds = Array.isArray(body.doctorIds)
    ? body.doctorIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];
  if (doctorIds.length === 0) {
    res.status(400).json({ error: "doctorIds must be a non-empty array" });
    return;
  }
  const detail: WaDetail = (WA_DETAILS as readonly string[]).includes(body.detail ?? "")
    ? (body.detail as WaDetail) : "summary";
  const basis: "payable" | "total" = body.basis === "total" ? "total" : "payable";
  const dryRun = body.dryRun !== false;   // default to a preview — never send by accident

  const [clinic] = await db.select({ name: clinicSettingsTable.name }).from(clinicSettingsTable).limit(1);
  const clinicName = clinic?.name || "Care Diagnostics";
  const period = fmtPeriod(body.from, body.to);

  // Same computation the Referral Report shows — not a second derivation.
  const { report } = await computeReferralReport({ from: body.from, to: body.to });
  const byDoctorId = new Map(report.map(d => [d.doctor.id, d as unknown as WaEntry]));

  const contacts = await db
    .select({ id: doctorsTable.id, name: doctorsTable.name, phone: doctorsTable.phone })
    .from(doctorsTable)
    .where(inArray(doctorsTable.id, doctorIds));
  const phoneById = new Map(contacts.map(c => [c.id, c.phone]));
  const nameById = new Map(contacts.map(c => [c.id, c.name]));

  // Imported lazily so a WhatsApp misconfiguration can never break the rest of
  // the commission module at load time.
  const { sendPlainWhatsappText } = await import("./whatsapp");

  const results: {
    doctorId: number; doctorName: string; phone: string | null; amount: number;
    message: string; ok: boolean; skipped?: boolean; error?: string; messageId?: string;
  }[] = [];

  for (const id of doctorIds) {
    const doctorName = nameById.get(id) ?? `#${id}`;
    const entry = byDoctorId.get(id);
    const phone = phoneById.get(id) ?? null;

    if (!entry) {
      results.push({ doctorId: id, doctorName, phone, amount: 0, message: "",
        ok: false, skipped: true, error: "No referrals in this period" });
      continue;
    }
    const amount = basis === "payable" ? entry.payableCommission : entry.totalCommission;
    const message = buildCommissionMessage(entry, { detail, basis, period, clinicName });

    if (!phone) {
      results.push({ doctorId: id, doctorName, phone, amount, message,
        ok: false, error: "No phone number on file" });
      continue;
    }
    if (dryRun) {
      results.push({ doctorId: id, doctorName, phone, amount, message, ok: true, skipped: true });
      continue;
    }
    const sent = await sendPlainWhatsappText(phone, message);
    results.push({
      doctorId: id, doctorName, phone, amount, message,
      ok: sent.ok, skipped: sent.skipped, error: sent.error, messageId: sent.messageId,
    });
  }

  res.json({
    dryRun,
    detail,
    basis,
    period,
    sent: results.filter(r => r.ok && !r.skipped).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
});

// ─── WhatsApp / Email: send a doctor their Referral Register for a period ─────
// Flat register (DATE · PATIENT · TEST · AMOUNT), not commission figures.
// Same billed-only source as the on-screen Referral Register.
router.post("/whatsapp/send-register", async (req, res) => {
  const body = (req.body ?? {}) as {
    doctorIds?: unknown; from?: string; to?: string;
    detail?: string; channel?: string; dryRun?: boolean;
  };
  const doctorIds = Array.isArray(body.doctorIds)
    ? body.doctorIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];
  if (doctorIds.length === 0) {
    res.status(400).json({ error: "doctorIds must be a non-empty array" });
    return;
  }
  const detail: "summary" | "breakdown" = body.detail === "breakdown" ? "breakdown" : "summary";
  const channel: "whatsapp" | "email" | "both" =
    body.channel === "email" ? "email" : body.channel === "both" ? "both" : "whatsapp";
  const dryRun = body.dryRun !== false;

  const [clinic] = await db.select({ name: clinicSettingsTable.name }).from(clinicSettingsTable).limit(1);
  const clinicName = clinic?.name || "Care Diagnostics";
  const period = fmtPeriod(body.from, body.to);

  const { report } = await computeReferralReport({ from: body.from, to: body.to });
  const byDoctorId = new Map(report.map(d => [d.doctor.id, d]));

  const contacts = await db
    .select({ id: doctorsTable.id, name: doctorsTable.name, phone: doctorsTable.phone, email: doctorsTable.email })
    .from(doctorsTable)
    .where(inArray(doctorsTable.id, doctorIds));
  const contactById = new Map(contacts.map(c => [c.id, c]));

  const { sendPlainWhatsappText } = await import("./whatsapp");
  let sendMail: ((opts: { to: string; subject: string; text: string }) => Promise<{ ok: boolean; error?: string }>) | null = null;
  if (channel === "email" || channel === "both") {
    try {
      const { getTransporter, getEmailSettings } = await import("../email");
      sendMail = async ({ to, subject, text }) => {
        const s = await getEmailSettings();
        const transport = await getTransporter();
        if (!transport || !s) return { ok: false, error: "Email not configured" };
        await transport.sendMail({
          from: `"${s.fromName}" <${s.fromAddress}>`,
          to,
          subject,
          text,
        });
        return { ok: true };
      };
    } catch {
      sendMail = async () => ({ ok: false, error: "Email module unavailable" });
    }
  }

  const results: {
    doctorId: number; doctorName: string; phone: string | null; email: string | null;
    amount: number; testCount: number; message: string;
    whatsapp?: { ok: boolean; skipped?: boolean; error?: string; messageId?: string };
    emailResult?: { ok: boolean; skipped?: boolean; error?: string };
  }[] = [];

  for (const id of doctorIds) {
    const contact = contactById.get(id);
    const doctorName = contact?.name ?? `#${id}`;
    const phone = contact?.phone ?? null;
    const email = contact?.email ?? null;
    const entry = byDoctorId.get(id);

    if (!entry || entry.rows.length === 0) {
      results.push({
        doctorId: id, doctorName, phone, email, amount: 0, testCount: 0, message: "",
        whatsapp: channel !== "email" ? { ok: false, skipped: true, error: "No billed referrals in this period" } : undefined,
        emailResult: channel !== "whatsapp" ? { ok: false, skipped: true, error: "No billed referrals in this period" } : undefined,
      });
      continue;
    }

    const amount = entry.totalRevenue;
    const testCount = entry.rows.length;
    const L: string[] = [];
    L.push(`Dear Dr. ${doctorName.replace(/^Dr\.?\s*/i, "")},`);
    L.push("");
    L.push(`Your referral register for ${period}:`);
    L.push(`*${testCount} test${testCount === 1 ? "" : "s"}* · *${fmtINR(amount)}* billed.`);
    if (detail === "breakdown") {
      L.push("");
      L.push("DATE | PATIENT | TEST | AMOUNT");
      const sorted = [...entry.rows].sort((a, b) => a.date.localeCompare(b.date));
      for (const r of sorted.slice(0, 40)) {
        const [y, m, d] = r.date.split("-");
        const dd = `${d}/${m}/${y}`;
        L.push(`${dd} | ${r.patientName} | ${r.testName} | ${fmtINR(r.price)}`);
      }
      if (sorted.length > 40) L.push(`…and ${sorted.length - 40} more (see clinic statement).`);
    }
    L.push("");
    L.push(`- ${clinicName}`);
    const message = L.join("\n");

    let whatsapp: (typeof results)[number]["whatsapp"];
    let emailResult: (typeof results)[number]["emailResult"];

    if (channel === "whatsapp" || channel === "both") {
      if (!phone) {
        whatsapp = { ok: false, error: "No phone number on file" };
      } else if (dryRun) {
        whatsapp = { ok: true, skipped: true };
      } else {
        const sent = await sendPlainWhatsappText(phone, message);
        whatsapp = { ok: sent.ok, skipped: sent.skipped, error: sent.error, messageId: sent.messageId };
      }
    }

    if (channel === "email" || channel === "both") {
      if (!email) {
        emailResult = { ok: false, error: "No email on file" };
      } else if (dryRun) {
        emailResult = { ok: true, skipped: true };
      } else if (!sendMail) {
        emailResult = { ok: false, error: "Email not configured" };
      } else {
        const sent = await sendMail({
          to: email,
          subject: `Referral register — ${period}`,
          text: message.replace(/\*/g, ""),
        });
        emailResult = sent;
      }
    }

    results.push({ doctorId: id, doctorName, phone, email, amount, testCount, message, whatsapp, emailResult });
  }

  res.json({
    dryRun,
    detail,
    channel,
    period,
    results,
    sentWhatsapp: results.filter(r => r.whatsapp?.ok && !r.whatsapp.skipped).length,
    sentEmail: results.filter(r => r.emailResult?.ok && !r.emailResult.skipped).length,
    failed: results.filter(r =>
      (r.whatsapp && !r.whatsapp.ok) || (r.emailResult && !r.emailResult.ok),
    ).length,
  });
});

export default router;
