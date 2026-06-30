// Knowledge Base — AI Receptionist Knowledge Engine (Epic 1).
// See lib/db/src/schema/knowledgeBase.ts for the schema/lifecycle design
// rationale, and AI_PLATFORM_IMPLEMENTATION_MASTER_ROADMAP.md Epic 1 /
// Feature 1.1-1.3 for the user stories this implements.
//
// Three audiences for this router:
//   - Staff (Admin/clinically-authorized roles): full CRUD, via
//     /api/knowledge-base/* under requireStaffAuth.
//   - AI callers (future — Epic 2's ai_caller credential, not yet built):
//     read-only search, via the same /search endpoint. Today this
//     endpoint has no separate ai_caller auth gate since that credential
//     class doesn't exist yet (see SECURITY_FINDINGS_REAUDIT.md and the
//     decision to defer Epic 2/3 to a dedicated WhatsApp-system audit
//     pass). Search is intentionally read-only and returns no PII, so
//     leaving it open behind staff auth for now (rather than an
//     unauthenticated public endpoint) is the conservative choice until
//     ai_caller exists to scope it properly.
//   - Future Conversation Manager: same /search endpoint, will be the
//     actual caller once Epic 3 is built.

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  knowledgeBaseEntriesTable,
  knowledgeBaseHistoryTable,
  knowledgeBaseSearchLogTable,
  KB_CATEGORIES,
  KB_SENSITIVE_CATEGORIES,
  KB_STATUSES,
  type KbCategory,
} from "@workspace/db/schema";
import { eq, and, desc, or, ilike, sql } from "drizzle-orm";
import { requireStaffAuth, type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const knowledgeBaseRouter = Router();

// Roles permitted to edit content in KB_SENSITIVE_CATEGORIES (prep
// instructions, PCPNDT FAQs, clinical escalation triggers). Per 03_ §5.1:
// these require clinical authorization, not general Admin. This codebase
// has no dedicated "clinical_liaison" role yet (ERP_ROLES doesn't include
// one) — until that's added, super_admin and radiologist are the closest
// existing roles with plausible clinical authority. Flagged here rather
// than silently widening this to all admins, which would defeat the
// purpose of this gate entirely.
const SENSITIVE_EDITOR_ROLES = new Set(["super_admin", "radiologist"]);

function isSensitiveCategory(category: string): boolean {
  return KB_SENSITIVE_CATEGORIES.has(category as KbCategory);
}

knowledgeBaseRouter.use(requireStaffAuth);

// ── Validation ──────────────────────────────────────────────────────────────

const IdParams = z.object({ id: z.coerce.number().int().positive() });

const ListQuery = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
});

const CreateBody = z.object({
  category: z.enum(KB_CATEGORIES),
  title: z.string().trim().min(1, "title is required"),
  content: z.string().trim().min(1, "content is required"),
  keywords: z.string().optional(),
  status: z.enum(KB_STATUSES).optional(),
});

const UpdateBody = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  keywords: z.string().optional(),
  status: z.enum(KB_STATUSES).optional(),
});

const SearchQuery = z.object({
  q: z.string().trim().min(1, "q is required"),
  category: z.string().optional(),
  channel: z.string().optional(), // 'whatsapp' | 'staff_assistant' | etc, for the search log
});

// ── Permission helper ────────────────────────────────────────────────────────
// Returns null if allowed, or an error message if the requesting staff
// member lacks the clinical-authorization tier this category requires.
function checkSensitiveEditAllowed(req: StaffAuthRequest, category: string): string | null {
  if (!isSensitiveCategory(category)) return null;
  const role = req.staffSession?.role ?? "";
  if (SENSITIVE_EDITOR_ROLES.has(role)) return null;
  return `The "${category}" category requires clinical authorization to edit. Your role (${role || "unknown"}) does not have this permission.`;
}

// ── GET /api/knowledge-base — list entries (staff browsing/admin UI) ────────
knowledgeBaseRouter.get("/", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const conds = [];
  if (parsed.data.category) conds.push(eq(knowledgeBaseEntriesTable.category, parsed.data.category));
  if (parsed.data.status) conds.push(eq(knowledgeBaseEntriesTable.status, parsed.data.status));

  const rows = conds.length > 0
    ? await db.select().from(knowledgeBaseEntriesTable).where(and(...conds)).orderBy(desc(knowledgeBaseEntriesTable.updatedAt))
    : await db.select().from(knowledgeBaseEntriesTable).orderBy(desc(knowledgeBaseEntriesTable.updatedAt));

  res.json(rows);
});

// ── GET /api/knowledge-base/categories — the canonical category list,
//    with sensitivity flag, for the admin UI to render correctly without
//    duplicating this list client-side ──────────────────────────────────────
knowledgeBaseRouter.get("/categories", (_req, res): void => {
  res.json(KB_CATEGORIES.map((c) => ({ category: c, sensitive: KB_SENSITIVE_CATEGORIES.has(c) })));
});

// ── GET /api/knowledge-base/search — the endpoint every AI face queries ──────
// Per 03_ §3.2.7 / §5.2: must return an explicit no-match signal, never a
// silent empty array indistinguishable from "searched and found nothing
// relevant" vs "search itself failed" — and the Conversation Manager
// consuming this must escalate on no-match, never improvise. This route's
// job stops at "matched: true/false, honestly" — escalation behavior
// belongs to the (not-yet-built) Conversation Manager, not here.
//
// Only status='published' entries are searchable — draft/suggested content
// must never reach a patient or staff query, since it hasn't been approved.
knowledgeBaseRouter.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { q, category, channel } = parsed.data;

  const conds = [eq(knowledgeBaseEntriesTable.status, "published")];
  if (category) conds.push(eq(knowledgeBaseEntriesTable.category, category));

  // Keyword/category retrieval per 03_ §5.3's recommended starting point
  // (not vector search) — simple ILIKE across title/content/keywords.
  // Graduating to the existing rag_document_embeddings infrastructure is
  // an explicit future option if real usage shows this missing genuine
  // queries, not assumed necessary up front.
  const likeQ = `%${q}%`;
  const matchCond = or(
    ilike(knowledgeBaseEntriesTable.title, likeQ),
    ilike(knowledgeBaseEntriesTable.content, likeQ),
    ilike(knowledgeBaseEntriesTable.keywords, likeQ),
  );

  const rows = await db
    .select()
    .from(knowledgeBaseEntriesTable)
    .where(and(...conds, matchCond))
    .limit(5);

  const matched = rows.length > 0;

  // Log every search — feeds both "Top FAQs" analytics and knowledge-gap
  // detection (04_ §6.4 signal 1: no-match events are gap signals).
  await db.insert(knowledgeBaseSearchLogTable).values({
    query: q,
    matchedEntryId: matched ? rows[0].id : null,
    matched,
    channel: channel ?? "",
  });

  if (matched) {
    res.json({ matched: true, entries: rows });
    return;
  }

  // Explicit, honest no-match — this shape is the contract every AI face
  // must treat as "escalate, do not improvise" per 03_ §5.2.
  res.json({ matched: false, entries: [] });
});

// ── GET /api/knowledge-base/admin/gaps — knowledge-gap detection,
//    04_ §6.4's "no-match events are knowledge-gap signals" ─────────────────
// Returns recent search queries that matched nothing, grouped by query
// text, most-frequent first — this is the literal feed for the "Knowledge
// Gaps Detected Today" widget the operational design (04_ §7.3) specifies
// for the Reception Command Center's Daily View. Not yet wired into a
// dashboard (no frontend work done in this pass) — this is the API a
// future dashboard component would call.
//
// Declared here, before the /:id route below, because Express matches
// routes in declaration order — "/admin/gaps" would otherwise be
// swallowed by "/:id" (with id="admin"), which fails Zod coercion and
// returns a confusing 400 instead of ever reaching this handler.
knowledgeBaseRouter.get("/admin/gaps", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      query: knowledgeBaseSearchLogTable.query,
      count: sql<number>`count(*)::int`,
      lastSeenAt: sql<string>`max(${knowledgeBaseSearchLogTable.createdAt})`,
    })
    .from(knowledgeBaseSearchLogTable)
    .where(eq(knowledgeBaseSearchLogTable.matched, false))
    .groupBy(knowledgeBaseSearchLogTable.query)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  res.json(rows);
});

// ── GET /api/knowledge-base/:id — single entry detail (with history) ────────
knowledgeBaseRouter.get("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [entry] = await db.select().from(knowledgeBaseEntriesTable).where(eq(knowledgeBaseEntriesTable.id, p.data.id)).limit(1);
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }

  const history = await db
    .select()
    .from(knowledgeBaseHistoryTable)
    .where(eq(knowledgeBaseHistoryTable.entryId, p.data.id))
    .orderBy(desc(knowledgeBaseHistoryTable.version));

  res.json({ ...entry, history });
});

// ── POST /api/knowledge-base — create an entry ───────────────────────────────
knowledgeBaseRouter.post("/", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { category, title, content, keywords, status } = parsed.data;

  const permErr = checkSensitiveEditAllowed(req as StaffAuthRequest, category);
  if (permErr) { res.status(403).json({ error: permErr }); return; }

  const staffName = (req as StaffAuthRequest).staffSession?.subjectName ?? "";

  const [created] = await db.insert(knowledgeBaseEntriesTable).values({
    category,
    title,
    content,
    keywords: keywords ?? "",
    status: status ?? "draft",
    isSensitive: isSensitiveCategory(category),
    createdBy: staffName,
    publishedAt: status === "published" ? new Date() : null,
  }).returning();

  res.status(201).json(created);
});

// ── PUT /api/knowledge-base/:id — edit an entry ──────────────────────────────
// Always snapshots the pre-edit version into history before applying the
// change, per 04_ §2.7's rollback design — rollback is only real if a
// prior version is actually recoverable, not just conceptually possible.
knowledgeBaseRouter.put("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const [existing] = await db.select().from(knowledgeBaseEntriesTable).where(eq(knowledgeBaseEntriesTable.id, p.data.id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const permErr = checkSensitiveEditAllowed(req as StaffAuthRequest, existing.category);
  if (permErr) { res.status(403).json({ error: permErr }); return; }

  const staffName = (req as StaffAuthRequest).staffSession?.subjectName ?? "";

  // Snapshot current state before overwriting.
  await db.insert(knowledgeBaseHistoryTable).values({
    entryId: existing.id,
    version: existing.version,
    title: existing.title,
    content: existing.content,
    keywords: existing.keywords,
    changedBy: staffName,
    changeType: "edit",
  });

  const willPublish = parsed.data.status === "published" && existing.status !== "published";

  const [updated] = await db.update(knowledgeBaseEntriesTable).set({
    title: parsed.data.title ?? existing.title,
    content: parsed.data.content ?? existing.content,
    keywords: parsed.data.keywords ?? existing.keywords,
    status: parsed.data.status ?? existing.status,
    version: existing.version + 1,
    updatedBy: staffName,
    publishedAt: willPublish ? new Date() : existing.publishedAt,
  }).where(eq(knowledgeBaseEntriesTable.id, existing.id)).returning();

  res.json(updated);
});

// ── POST /api/knowledge-base/:id/rollback/:version — restore a prior version ─
// Per 04_ §2.7: rollback affects only the single entry, never a whole-
// system snapshot. The rollback action itself is logged with who/when,
// same as any other edit — a rollback is not exempt from the audit trail
// it's restoring.
knowledgeBaseRouter.post("/:id/rollback/:version", async (req, res): Promise<void> => {
  const idParsed = z.coerce.number().int().positive().safeParse(req.params.id);
  const versionParsed = z.coerce.number().int().positive().safeParse(req.params.version);
  if (!idParsed.success || !versionParsed.success) { res.status(400).json({ error: "Invalid id or version" }); return; }

  const [existing] = await db.select().from(knowledgeBaseEntriesTable).where(eq(knowledgeBaseEntriesTable.id, idParsed.data)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const permErr = checkSensitiveEditAllowed(req as StaffAuthRequest, existing.category);
  if (permErr) { res.status(403).json({ error: permErr }); return; }

  const [target] = await db
    .select()
    .from(knowledgeBaseHistoryTable)
    .where(and(eq(knowledgeBaseHistoryTable.entryId, idParsed.data), eq(knowledgeBaseHistoryTable.version, versionParsed.data)))
    .limit(1);
  if (!target) { res.status(404).json({ error: "That version was not found in history" }); return; }

  const staffName = (req as StaffAuthRequest).staffSession?.subjectName ?? "";

  // Snapshot current (pre-rollback) state too, so rolling back is itself
  // reversible — never a one-way door.
  await db.insert(knowledgeBaseHistoryTable).values({
    entryId: existing.id,
    version: existing.version,
    title: existing.title,
    content: existing.content,
    keywords: existing.keywords,
    changedBy: staffName,
    changeType: "rollback",
  });

  const [restored] = await db.update(knowledgeBaseEntriesTable).set({
    title: target.title,
    content: target.content,
    keywords: target.keywords,
    version: existing.version + 1,
    updatedBy: staffName,
  }).where(eq(knowledgeBaseEntriesTable.id, existing.id)).returning();

  res.json(restored);
});

// ── DELETE /api/knowledge-base/:id — archive (never hard-delete) ────────────
// Per the lifecycle design, "delete" sets status='archived' rather than
// removing the row — content history and search-log foreign keys should
// never dangle, and an archived entry can always be republished later
// without losing its version history.
knowledgeBaseRouter.delete("/:id", async (req, res): Promise<void> => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(knowledgeBaseEntriesTable).where(eq(knowledgeBaseEntriesTable.id, p.data.id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const permErr = checkSensitiveEditAllowed(req as StaffAuthRequest, existing.category);
  if (permErr) { res.status(403).json({ error: permErr }); return; }

  await db.update(knowledgeBaseEntriesTable).set({ status: "archived" }).where(eq(knowledgeBaseEntriesTable.id, existing.id));
  res.status(204).send();
});
