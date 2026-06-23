import { Router } from "express";
import { db } from "@workspace/db";
import {
  packagesTable,
  packageTestsTable,
  packageCounterTable,
  testsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

function toNum(row: Record<string, unknown>) {
  return {
    ...row,
    price: Number(row.price ?? 0),
    discountPct: Number(row.discountPct ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
  };
}

async function generatePackageCode(): Promise<string> {
  const [counter] = await db.select().from(packageCounterTable).limit(1);
  let seq = 1;
  if (counter) {
    seq = counter.counter + 1;
    await db.update(packageCounterTable).set({ counter: seq }).where(eq(packageCounterTable.id, counter.id));
  } else {
    await db.insert(packageCounterTable).values({ counter: 1 });
  }
  return `PKG-${String(seq).padStart(4, "0")}`;
}

type PkgTestInput = { testId: number; discountPct: number; discountAmount: number };

// Normalise an inbound `tests` array. Accepts either `[1, 2, 3]` (legacy
// `testIds` flat numeric form) or `[{ testId, discountPct?, discountAmount? }]`.
// Invalid rows are dropped silently; duplicates by testId are deduped (last
// occurrence wins, since the form may overwrite an existing override).
function normalizeTests(input: unknown): PkgTestInput[] {
  if (!Array.isArray(input)) return [];
  const out = new Map<number, PkgTestInput>();
  for (const row of input) {
    let testId: number | null = null;
    let pct = 0;
    let amt = 0;
    if (typeof row === "number") {
      testId = row;
    } else if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      testId = Number(r.testId ?? r.id);
      pct = Number(r.discountPct ?? 0);
      amt = Number(r.discountAmount ?? 0);
    }
    if (testId === null || !Number.isInteger(testId) || testId <= 0) continue;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) pct = 0;
    if (!Number.isFinite(amt) || amt < 0) amt = 0;
    out.set(testId, { testId, discountPct: pct, discountAmount: amt });
  }
  return [...out.values()];
}

// Validate a top-level package discount input. Returns null when ok, or an
// error message when the value is out of range. Treats undefined/null as 0.
function validatePackageDiscount(pct: unknown, amt: unknown): string | null {
  if (pct !== undefined && pct !== null) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return "discountPct must be between 0 and 100";
  }
  if (amt !== undefined && amt !== null) {
    const n = Number(amt);
    if (!Number.isFinite(n) || n < 0) return "discountAmount must be ≥ 0";
  }
  return null;
}

// Build the response shape for a package: merge each link's discount fields
// into the test object so the UI sees `tests: [{ ...test, discountPct, discountAmount }]`.
function mergeTests(
  links: { testId: number; discountPct: string | number; discountAmount: string | number }[],
  testMap: Map<number, Record<string, unknown>>,
) {
  return links
    .map((l) => {
      const t = testMap.get(l.testId);
      if (!t) return null;
      return {
        ...t,
        discountPct: Number(l.discountPct ?? 0),
        discountAmount: Number(l.discountAmount ?? 0),
      };
    })
    .filter(Boolean);
}

// List all packages with their test list (each test carries its per-package discount).
router.get("/", async (_req, res) => {
  const pkgs = await db.select().from(packagesTable).orderBy(desc(packagesTable.createdAt));

  const allLinks = await db.select().from(packageTestsTable);
  const allTests = await db.select().from(testsTable);

  const testMap = new Map<number, Record<string, unknown>>(
    allTests.map((t) => [t.id, t as unknown as Record<string, unknown>]),
  );

  const result = pkgs.map((pkg) => {
    const links = allLinks.filter((l) => l.packageId === pkg.id);
    const tests = mergeTests(links, testMap);
    return { ...toNum(pkg as unknown as Record<string, unknown>), tests };
  });

  return res.json(result);
});

// Get single package
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [pkg] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  const links = await db.select().from(packageTestsTable).where(eq(packageTestsTable.packageId, id));
  const allTests = links.length
    ? await db.select().from(testsTable)
    : [];
  const testMap = new Map<number, Record<string, unknown>>(
    allTests.map((t) => [t.id, t as unknown as Record<string, unknown>]),
  );
  const tests = mergeTests(links, testMap);

  return res.json({ ...toNum(pkg as unknown as Record<string, unknown>), tests });
});

// Create package
router.post("/", async (req, res) => {
  const { name, description, price, discountPct, discountAmount, isActive } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  if (price !== undefined && price !== null) {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "price must be ≥ 0" });
  }
  const discountErr = validatePackageDiscount(discountPct, discountAmount);
  if (discountErr) return res.status(400).json({ error: discountErr });

  // Accept either `tests` (preferred, with per-test discounts) or `testIds` (legacy).
  const testRows = normalizeTests(req.body.tests ?? req.body.testIds);

  const code = await generatePackageCode();
  const [pkg] = await db
    .insert(packagesTable)
    .values({
      packageCode: code,
      name,
      description: description || null,
      price: String(price ?? 0),
      discountPct: String(discountPct ?? 0),
      discountAmount: String(discountAmount ?? 0),
      isActive: isActive !== false,
    })
    .returning();

  if (testRows.length > 0) {
    await db.insert(packageTestsTable).values(
      testRows.map((t) => ({
        packageId: pkg.id,
        testId: t.testId,
        discountPct: String(t.discountPct ?? 0),
        discountAmount: String(t.discountAmount ?? 0),
      })),
    );
  }

  return res.status(201).json(toNum(pkg as unknown as Record<string, unknown>));
});

// Update package
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, price, discountPct, discountAmount, isActive } = req.body;

  if (price !== undefined && price !== null) {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "price must be ≥ 0" });
  }
  const discountErr = validatePackageDiscount(discountPct, discountAmount);
  if (discountErr) return res.status(400).json({ error: discountErr });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = String(price);
  if (discountPct !== undefined) updates.discountPct = String(discountPct);
  if (discountAmount !== undefined) updates.discountAmount = String(discountAmount);
  if (isActive !== undefined) updates.isActive = isActive;

  if (Object.keys(updates).length > 0) {
    const [pkg] = await db.update(packagesTable).set(updates).where(eq(packagesTable.id, id)).returning();
    if (!pkg) return res.status(404).json({ error: "Package not found" });
  }

  // Replace test set if `tests` or legacy `testIds` provided.
  const hasTests = req.body.tests !== undefined || req.body.testIds !== undefined;
  if (hasTests) {
    const testRows = normalizeTests(req.body.tests ?? req.body.testIds);
    await db.delete(packageTestsTable).where(eq(packageTestsTable.packageId, id));
    if (testRows.length > 0) {
      await db.insert(packageTestsTable).values(
        testRows.map((t) => ({
          packageId: id,
          testId: t.testId,
          discountPct: String(t.discountPct ?? 0),
          discountAmount: String(t.discountAmount ?? 0),
        })),
      );
    }
  }

  const [updated] = await db.select().from(packagesTable).where(eq(packagesTable.id, id));
  return res.json(toNum(updated as unknown as Record<string, unknown>));
});

// ── Bulk CSV import ───────────────────────────────────────────────────────
// Upsert packages by `packageCode` if present, otherwise by name.
//
// `testCodes` (semicolon-separated) is the legacy column. To attach per-test
// discounts in CSV, append `:pct:amount` after each code, e.g.
// `CBC:10:0;LFT:0:50;TSH`. Both pct and amount are optional (default 0).
router.post("/import", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]) : null;
  if (!rows) return res.status(400).json({ error: "Request body must include `rows: []`." });
  if (rows.length > 5000) return res.status(413).json({ error: "Too many rows in one import (max 5000)." });

  // Pre-load test code → id once for fast lookups.
  const allTests = await db.select({ id: testsTable.id, code: testsTable.code }).from(testsTable);
  const testByCode = new Map(allTests.map(t => [t.code.toLowerCase(), t.id]));

  let inserted = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r.name ?? "").trim();
    const codeInput = typeof r.packageCode === "string" ? r.packageCode.trim() : "";
    if (!name) {
      skipped++;
      errors.push({ row: i + 2, reason: "Missing required field (name)." });
      continue;
    }
    const price = Number(r.price ?? 0);
    const discountPct = Number(r.discountPct ?? 0);
    const discountAmount = Number(r.discountAmount ?? 0);
    if (!Number.isFinite(price) || price < 0
        || !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100
        || !Number.isFinite(discountAmount) || discountAmount < 0) {
      skipped++;
      errors.push({ row: i + 2, reason: "price/discountAmount must be ≥ 0; discountPct must be 0–100." });
      continue;
    }

    const isActiveStr = typeof r.isActive === "string" ? r.isActive.trim() : "";
    const isActive = isActiveStr ? !/^(false|0|no|inactive)$/i.test(isActiveStr) : true;

    // Resolve test codes → ids. Format: `CODE` or `CODE:pct:amount` (both optional).
    const codesRaw = typeof r.testCodes === "string" ? r.testCodes : "";
    const testRows: PkgTestInput[] = [];
    const missing: string[] = [];
    for (const raw of codesRaw.split(";").map((c) => c.trim()).filter(Boolean)) {
      const [code, pctStr, amtStr] = raw.split(":").map((s) => s.trim());
      const id = testByCode.get(code.toLowerCase());
      if (id === undefined) { missing.push(code); continue; }
      const pct = Number(pctStr ?? 0); const amt = Number(amtStr ?? 0);
      testRows.push({
        testId: id,
        discountPct: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 0,
        discountAmount: Number.isFinite(amt) && amt >= 0 ? amt : 0,
      });
    }

    const values = {
      name,
      description: typeof r.description === "string" && r.description.trim() ? r.description.trim() : null,
      price: price.toFixed(2),
      discountPct: discountPct.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      isActive,
    };

    try {
      let existingId: number | undefined;
      if (codeInput) {
        const [hit] = await db.select({ id: packagesTable.id }).from(packagesTable).where(eq(packagesTable.packageCode, codeInput));
        existingId = hit?.id;
      }
      if (!existingId) {
        const [hit] = await db.select({ id: packagesTable.id }).from(packagesTable).where(eq(packagesTable.name, name));
        existingId = hit?.id;
      }

      const insertLinks = (pid: number) =>
        db.insert(packageTestsTable).values(
          testRows.map((t) => ({
            packageId: pid,
            testId: t.testId,
            discountPct: String(t.discountPct ?? 0),
            discountAmount: String(t.discountAmount ?? 0),
          })),
        );

      if (existingId) {
        await db.update(packagesTable).set(values).where(eq(packagesTable.id, existingId));
        await db.delete(packageTestsTable).where(eq(packageTestsTable.packageId, existingId));
        if (testRows.length > 0) await insertLinks(existingId);
        updated++;
      } else {
        const packageCode = codeInput || await generatePackageCode();
        const [pkg] = await db.insert(packagesTable).values({ ...values, packageCode }).returning();
        if (testRows.length > 0) await insertLinks(pkg.id);
        inserted++;
      }
      if (missing.length > 0) {
        errors.push({ row: i + 2, reason: `Unknown test codes (skipped): ${missing.join(", ")}` });
      }
    } catch (e) {
      skipped++;
      errors.push({ row: i + 2, reason: (e as Error).message || "Database error" });
    }
  }

  return res.json({ inserted, updated, skipped, errors: errors.slice(0, 50) });
});

// Delete package
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(packageTestsTable).where(eq(packageTestsTable.packageId, id));
  const [pkg] = await db.delete(packagesTable).where(eq(packagesTable.id, id)).returning();
  if (!pkg) return res.status(404).json({ error: "Package not found" });
  return res.json({ success: true });
});

export { router as packagesRouter };
