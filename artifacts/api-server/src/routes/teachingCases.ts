/**
 * Phase 8: Teaching Files & Interesting Cases Registry
 *
 * Routes:
 *  GET /api/teaching-cases — list with search/filter
 *  GET /api/teaching-cases/:id — detail
 *  POST /api/teaching-cases — create
 *  PUT /api/teaching-cases/:id — update
 *  DELETE /api/teaching-cases/:id — delete
 *  POST /api/teaching-cases/:id/favorite — toggle favorite
 *  POST /api/teaching-cases/:id/view — record view
 *  POST /api/teaching-cases/:id/note — add note
 *  GET /api/teaching-cases/collections — list collections
 *  POST /api/teaching-cases/collections — create collection
 *  PUT /api/teaching-cases/collections/:id — update collection
 *  GET /api/teaching-cases/analytics — dashboard stats
 *  POST /api/teaching-cases/anonymize — anonymize patient data
 *  POST /api/teaching-cases/search — full-text search
 *
 * Security: requireStaffAuth, owner-only for mutations
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  teachingCasesTable,
  teachingCaseImagesTable,
  teachingCaseCollectionsTable,
  teachingCaseFavoritesTable,
  teachingCaseViewsTable,
  teachingCaseNotesTable,
  measurementHistoryTable,
} from "@workspace/db";
import { eq, and, like, desc, sql, count, inArray } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

export const teachingCasesRouter = Router();

function isOwner(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

function getUserId(req: StaffAuthRequest): number | null {
  return req.staffSession?.subjectId ?? null;
}

function getUserName(req: StaffAuthRequest): string | null {
  return req.staffSession?.subjectName ?? null;
}

// ─── LIST / SEARCH ───────────────────────────────────────────────────────────
teachingCasesRouter.get("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);

  const {
    q, category, difficulty, modality, bodyPart, diagnosis, tag,
    status, createdBy, research, limit = "50", offset = "0",
  } = req.query;

  const conditions = [];
  if (q) {
    const likeQ = `%${String(q)}%`;
    conditions.push(sql`(
      ${like(teachingCasesTable.title, likeQ)} OR
      ${like(teachingCasesTable.diagnosis, likeQ)} OR
      ${like(teachingCasesTable.findings, likeQ)} OR
      ${like(teachingCasesTable.impression, likeQ)}
    )`);
  }
  if (category) conditions.push(eq(teachingCasesTable.category, String(category)));
  if (difficulty) conditions.push(eq(teachingCasesTable.difficulty, String(difficulty)));
  if (modality) conditions.push(eq(teachingCasesTable.modality, String(modality)));
  if (bodyPart) conditions.push(eq(teachingCasesTable.bodyPart, String(bodyPart)));
  if (diagnosis) conditions.push(eq(teachingCasesTable.diagnosis, String(diagnosis)));
  if (status) conditions.push(eq(teachingCasesTable.status, String(status)));
  if (createdBy) conditions.push(eq(teachingCasesTable.createdById, Number(createdBy)));
  if (research) conditions.push(eq(teachingCasesTable.isResearchCandidate, String(research) === "true"));
  if (tag) {
    conditions.push(sql`${teachingCasesTable.tagsJson}::text LIKE ${`%${String(tag)}%`}`);
  }

  const baseQuery = conditions.length > 0
    ? db.select().from(teachingCasesTable).where(and(...conditions))
    : db.select().from(teachingCasesTable);

  const rows = await baseQuery
    .orderBy(desc(teachingCasesTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  // Count total
  const countQuery = conditions.length > 0
    ? db.select({ count: count() }).from(teachingCasesTable).where(and(...conditions))
    : db.select({ count: count() }).from(teachingCasesTable);
  const [{ count: total }] = await countQuery;

  // Check favorites for the user
  let favorites: number[] = [];
  if (userId) {
    const favs = await db
      .select({ teachingCaseId: teachingCaseFavoritesTable.teachingCaseId })
      .from(teachingCaseFavoritesTable)
      .where(eq(teachingCaseFavoritesTable.userId, userId));
    favorites = favs.map((f) => f.teachingCaseId);
  }

  res.json({ cases: rows, total, favorites });
});

// NOTE: GET /:id is declared AFTER all static GET routes to avoid shadowing
// /collections, /research, /favorites, /analytics, etc.

// ─── CREATE ──────────────────────────────────────────────────────────────────
teachingCasesRouter.post("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const userId = getUserId(sReq)!;
  const userName = getUserName(sReq);
  const body = req.body as Record<string, unknown>;

  const [newCase] = await db.insert(teachingCasesTable).values({
    title: String(body.title ?? ""),
    diagnosis: body.diagnosis ? String(body.diagnosis) : null,
    category: String(body.category ?? "Uncategorized"),
    difficulty: String(body.difficulty ?? "intermediate"),
    source: String(body.source ?? "manual"),
    modality: body.modality ? String(body.modality) : null,
    bodyPart: body.bodyPart ? String(body.bodyPart) : null,
    studyDescription: body.studyDescription ? String(body.studyDescription) : null,
    findings: body.findings ? String(body.findings) : null,
    impression: body.impression ? String(body.impression) : null,
    measurements: body.measurements ? String(body.measurements) : null,
    learningPoints: body.learningPoints ? String(body.learningPoints) : null,
    pearls: body.pearls ? String(body.pearls) : null,
    pitfalls: body.pitfalls ? String(body.pitfalls) : null,
    tagsJson: body.tags ? JSON.stringify(Array.isArray(body.tags) ? body.tags : []) : "[]",
    classification: body.classification ? String(body.classification) : null,
    classificationValue: body.classificationValue ? String(body.classificationValue) : null,
    isResearchCandidate: Boolean(body.isResearchCandidate ?? false),
    researchStatus: body.researchStatus ? String(body.researchStatus) : null,
    createdById: userId,
    createdByName: userName,
    status: "draft",
    isAnonymized: false,
  }).returning();

  res.json({ case: newCase });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────
teachingCasesRouter.put("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  const stringFields = ["title", "diagnosis", "category", "difficulty", "source", "modality", "bodyPart", "studyDescription", "findings", "impression", "measurements", "learningPoints", "pearls", "pitfalls", "classification", "classificationValue", "researchStatus", "status", "aiNotes", "aiSummary"];
  for (const f of stringFields) {
    if (body[f] !== undefined) updates[f] = String(body[f] ?? "");
  }
  if (body.isResearchCandidate !== undefined) updates.isResearchCandidate = Boolean(body.isResearchCandidate);
  if (body.isAnonymized !== undefined) updates.isAnonymized = Boolean(body.isAnonymized);
  if (body.tags) updates.tagsJson = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);

  await db.update(teachingCasesTable).set(updates).where(eq(teachingCasesTable.id, id));
  res.json({ success: true });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────
teachingCasesRouter.delete("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  await db.delete(teachingCasesTable).where(eq(teachingCasesTable.id, id));
  await db.delete(teachingCaseImagesTable).where(eq(teachingCaseImagesTable.teachingCaseId, id));
  await db.delete(teachingCaseFavoritesTable).where(eq(teachingCaseFavoritesTable.teachingCaseId, id));
  await db.delete(teachingCaseNotesTable).where(eq(teachingCaseNotesTable.teachingCaseId, id));
  await db.delete(teachingCaseViewsTable).where(eq(teachingCaseViewsTable.teachingCaseId, id));

  res.json({ success: true });
});

// ─── TOGGLE FAVORITE ─────────────────────────────────────────────────────────
teachingCasesRouter.post("/:id/favorite", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

  const id = Number(req.params.id);
  const existing = await db.select()
    .from(teachingCaseFavoritesTable)
    .where(and(eq(teachingCaseFavoritesTable.teachingCaseId, id), eq(teachingCaseFavoritesTable.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(teachingCaseFavoritesTable)
      .where(and(eq(teachingCaseFavoritesTable.teachingCaseId, id), eq(teachingCaseFavoritesTable.userId, userId)));
    res.json({ isFavorite: false });
  } else {
    await db.insert(teachingCaseFavoritesTable).values({
      teachingCaseId: id,
      userId,
      userName: getUserName(sReq),
    });
    res.json({ isFavorite: true });
  }
});

// ─── ADD NOTE ────────────────────────────────────────────────────────────────
teachingCasesRouter.post("/:id/note", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

  const id = Number(req.params.id);
  const { note } = req.body as { note?: string };
  if (!note?.trim()) { res.status(400).json({ error: "Note is required." }); return; }

  const [newNote] = await db.insert(teachingCaseNotesTable).values({
    teachingCaseId: id,
    userId,
    userName: getUserName(sReq),
    note: note.trim(),
  }).returning();

  res.json({ note: newNote });
});

// ─── COLLECTIONS ─────────────────────────────────────────────────────────────
teachingCasesRouter.get("/collections", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);

  const rows = await db
    .select().from(teachingCaseCollectionsTable)
    .where(userId ? eq(teachingCaseCollectionsTable.ownerId, userId) : undefined)
    .orderBy(desc(teachingCaseCollectionsTable.createdAt));

  res.json({ collections: rows });
});

teachingCasesRouter.post("/collections", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const userId = getUserId(sReq)!;
  const { name, description, isShared, caseIds } = req.body as { name?: string; description?: string; isShared?: boolean; caseIds?: number[] };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }

  const [newCol] = await db.insert(teachingCaseCollectionsTable).values({
    name: name.trim(),
    description: description ?? null,
    ownerId: userId,
    ownerName: getUserName(sReq),
    isShared: isShared ?? false,
    caseIdsJson: JSON.stringify(Array.isArray(caseIds) ? caseIds : []),
  }).returning();

  res.json({ collection: newCol });
});

teachingCasesRouter.put("/collections/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  const { name, description, isShared, caseIds } = req.body as { name?: string; description?: string; isShared?: boolean; caseIds?: number[] };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description;
  if (isShared !== undefined) updates.isShared = isShared;
  if (caseIds) updates.caseIdsJson = JSON.stringify(caseIds);

  await db.update(teachingCaseCollectionsTable).set(updates).where(eq(teachingCaseCollectionsTable.id, id));
  res.json({ success: true });
});

// ─── CASE OF MONTH: GENERATE QUIZ ────────────────────────────────────────────
// POST /api/teaching-cases/collections/:id/generate-quiz
// Uses Gemini to generate MCQ-style resident quiz from the collection's cases.
teachingCasesRouter.post("/collections/:id/generate-quiz", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const collectionId = Number(req.params.id);
  const [collection] = await db
    .select().from(teachingCaseCollectionsTable)
    .where(eq(teachingCaseCollectionsTable.id, collectionId));
  if (!collection) { res.status(404).json({ error: "Collection not found." }); return; }

  let caseIds: number[] = [];
  try { caseIds = JSON.parse(collection.caseIdsJson ?? "[]"); } catch { caseIds = []; }
  if (!Array.isArray(caseIds)) caseIds = [];
  if (caseIds.length === 0) { res.status(400).json({ error: "Collection has no cases. Add cases before generating a quiz." }); return; }

  const cases = await db
    .select({ id: teachingCasesTable.id, title: teachingCasesTable.title, diagnosis: teachingCasesTable.diagnosis, findings: teachingCasesTable.findings, modality: teachingCasesTable.modality })
    .from(teachingCasesTable)
    .where(sql`${teachingCasesTable.id} IN (${sql.join(caseIds.map((id) => sql`${id}`), sql`, `)})`);

  const geminiConfigured = !!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!geminiConfigured) {
    // Return a structural stub when AI is not configured
    res.json({
      quiz: {
        title: `${collection.name} — Resident Quiz`,
        generatedAt: new Date().toISOString(),
        questions: cases.map((c, i) => ({
          number: i + 1,
          caseTitle: c.title,
          caseId: c.id,
          question: `What is the most likely diagnosis for Case ${i + 1}: ${c.title}?`,
          options: ["A. [Configure Gemini to auto-generate options]", "B. —", "C. —", "D. —"],
          answer: c.diagnosis ? `A. ${c.diagnosis}` : "A. [To be filled by faculty]",
          explanation: "AI not configured — add explanation manually.",
        })),
      },
      aiGenerated: false,
      note: "AI Draft — Requires Faculty Review before distributing to residents.",
    });
    return;
  }

  try {
    const { geminiGenerate } = await import("@workspace/integrations-gemini-ai");
    const caseSummaries = cases.map((c, i) =>
      `Case ${i + 1}: ${c.title} (${c.modality ?? "Unknown modality"})\nDiagnosis: ${c.diagnosis ?? "Unknown"}\nFindings snippet: ${(c.findings ?? "").slice(0, 200)}`
    ).join("\n\n");

    const prompt = `You are a radiology education expert creating a resident quiz for a Case of the Month session.

Collection: ${collection.name}
${collection.description ? `Description: ${collection.description}` : ""}

Cases:
${caseSummaries}

Generate a JSON array of quiz questions — one per case — with this structure:
[{
  "number": 1,
  "caseTitle": "...",
  "question": "A clinically relevant MCQ question testing key radiology concepts",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": "A. ... — brief explanation",
  "learningPoint": "one key teaching point"
}]

Return ONLY the JSON array. AI Draft — Requires Faculty Review.`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    const raw = await geminiGenerate(prompt, { maxTokens: 2048 });
    clearTimeout(timer);

    const match = raw.match(/\[[\s\S]*\]/);
    const questions = match ? JSON.parse(match[0]) as object[] : [];

    res.json({
      quiz: {
        title: `${collection.name} — Resident Quiz`,
        generatedAt: new Date().toISOString(),
        questions,
      },
      caseCount: cases.length,
      aiGenerated: true,
      note: "AI Draft — Requires Faculty Review before distributing to residents.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    res.status(502).json({ error: `Quiz generation failed: ${msg}` });
  }
});

// ─── CASE OF MONTH: GENERATE JOURNAL CLUB ────────────────────────────────────
// POST /api/teaching-cases/collections/:id/generate-journal-club
// Generates structured journal club discussion guide from the collection.
teachingCasesRouter.post("/collections/:id/generate-journal-club", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const collectionId = Number(req.params.id);
  const [collection] = await db
    .select().from(teachingCaseCollectionsTable)
    .where(eq(teachingCaseCollectionsTable.id, collectionId));
  if (!collection) { res.status(404).json({ error: "Collection not found." }); return; }

  let caseIds: number[] = [];
  try { caseIds = JSON.parse(collection.caseIdsJson ?? "[]"); } catch { caseIds = []; }
  if (!Array.isArray(caseIds)) caseIds = [];
  if (caseIds.length === 0) { res.status(400).json({ error: "Collection has no cases. Add cases before generating a journal club guide." }); return; }

  const cases = await db
    .select({ id: teachingCasesTable.id, title: teachingCasesTable.title, diagnosis: teachingCasesTable.diagnosis, findings: teachingCasesTable.findings, impression: teachingCasesTable.impression, modality: teachingCasesTable.modality, category: teachingCasesTable.category })
    .from(teachingCasesTable)
    .where(sql`${teachingCasesTable.id} IN (${sql.join(caseIds.map((id) => sql`${id}`), sql`, `)})`);

  const geminiConfigured = !!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!geminiConfigured) {
    res.json({
      journalClub: {
        title: `${collection.name} — Journal Club Guide`,
        generatedAt: new Date().toISOString(),
        overview: "Configure Gemini AI to auto-generate the discussion guide.",
        discussionPoints: cases.map((c) => ({ caseTitle: c.title, points: ["Add discussion points manually."] })),
        slides: [{ slide: 1, title: "Introduction", content: "Collection: " + collection.name }],
      },
      aiGenerated: false,
      note: "AI Draft — Requires Faculty Review.",
    });
    return;
  }

  try {
    const { geminiGenerate } = await import("@workspace/integrations-gemini-ai");
    const caseSummaries = cases.map((c, i) =>
      `Case ${i + 1}: ${c.title} (${c.modality ?? "?"}, Category: ${c.category ?? "general"})\nDiagnosis: ${c.diagnosis ?? "?"}\nImpression: ${(c.impression ?? "").slice(0, 150)}`
    ).join("\n\n");

    const prompt = `You are a radiology faculty member preparing a journal club session.

Collection: ${collection.name}
${collection.description ? `Description: ${collection.description}` : ""}

Cases:
${caseSummaries}

Generate a JSON object for a journal club discussion guide:
{
  "overview": "2-3 sentence session overview",
  "theme": "common theme or learning objective",
  "discussionPoints": [
    { "caseTitle": "...", "points": ["discussion point 1", "point 2", "point 3"] }
  ],
  "slides": [
    { "slide": 1, "title": "Introduction", "content": "brief slide content" },
    { "slide": 2, ... }
  ],
  "references": ["relevant radiology guideline or textbook reference 1", "reference 2"]
}

Return ONLY the JSON object. AI Draft — Requires Faculty Review.`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    const raw = await geminiGenerate(prompt, { maxTokens: 2048 });
    clearTimeout(timer);

    const match = raw.match(/\{[\s\S]*\}/);
    const guide = match ? JSON.parse(match[0]) as object : { overview: raw };

    res.json({
      journalClub: {
        title: `${collection.name} — Journal Club Guide`,
        generatedAt: new Date().toISOString(),
        ...guide,
      },
      caseCount: cases.length,
      aiGenerated: true,
      note: "AI Draft — Requires Faculty Review before the session.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    res.status(502).json({ error: `Journal club generation failed: ${msg}` });
  }
});

// ─── FAVORITES ───────────────────────────────────────────────────────────────
teachingCasesRouter.get("/favorites", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  if (!userId) { res.status(401).json({ error: "Not authenticated." }); return; }

  const favRows = await db
    .select({ teachingCaseId: teachingCaseFavoritesTable.teachingCaseId })
    .from(teachingCaseFavoritesTable)
    .where(eq(teachingCaseFavoritesTable.userId, userId));

  const favIds = favRows.map((f) => f.teachingCaseId);
  if (favIds.length === 0) { res.json({ cases: [] }); return; }

  const rows = await db
    .select().from(teachingCasesTable)
    .where(sql`${teachingCasesTable.id} IN (${sql.join(favIds, sql`, `)})`)
    .orderBy(desc(teachingCasesTable.createdAt));

  res.json({ cases: rows });
});

// ─── RESEARCH CASES ────────────────────────────────────────────────────────────
// ─── RESEARCH DATABASE — filtered, paginated, with CSV export ──────────────
teachingCasesRouter.get("/research", async (req, res): Promise<void> => {
  const {
    modality, bodyPart, category, difficulty, researchStatus,
    isAnonymized, q,
    sex, patientGender,
    ageMin, ageMax,
    tag, interesting, rare, publicationCandidate,
    page = "1", pageSize = "20",
    exportFormat,
  } = req.query as Record<string, string | undefined>;

  const conditions = [eq(teachingCasesTable.isResearchCandidate, true)];
  if (modality) conditions.push(eq(teachingCasesTable.modality, modality));
  if (bodyPart) conditions.push(eq(teachingCasesTable.bodyPart, bodyPart));
  if (category) conditions.push(eq(teachingCasesTable.category, category));
  if (difficulty) conditions.push(eq(teachingCasesTable.difficulty, difficulty));
  if (researchStatus) conditions.push(eq(teachingCasesTable.researchStatus, researchStatus));
  if (isAnonymized !== undefined) conditions.push(eq(teachingCasesTable.isAnonymized, isAnonymized === "true"));
  // Gender / sex filter (accepts either param name)
  const genderFilter = sex ?? patientGender;
  if (genderFilter) conditions.push(eq(teachingCasesTable.patientGender, genderFilter));
  // Age range filter (patientAge is stored as text, compare numerically when possible)
  if (ageMin) conditions.push(sql`${teachingCasesTable.patientAge} IS NOT NULL AND CAST(NULLIF(regexp_replace(${teachingCasesTable.patientAge}, '[^0-9]', '', 'g'), '') AS integer) >= ${Number(ageMin)}`);
  if (ageMax) conditions.push(sql`${teachingCasesTable.patientAge} IS NOT NULL AND CAST(NULLIF(regexp_replace(${teachingCasesTable.patientAge}, '[^0-9]', '', 'g'), '') AS integer) <= ${Number(ageMax)}`);
  // Tag filter — checks tagsJson array text
  if (tag?.trim()) conditions.push(sql`${teachingCasesTable.tagsJson}::text ILIKE ${'%' + tag.trim() + '%'}`);
  // Semantic shorthand filters mapped to tagsJson / researchStatus
  if (interesting === "true") conditions.push(sql`${teachingCasesTable.tagsJson}::text ILIKE '%interesting%'`);
  if (rare === "true") conditions.push(sql`${teachingCasesTable.tagsJson}::text ILIKE '%rare%'`);
  if (publicationCandidate === "true") conditions.push(sql`(${teachingCasesTable.researchStatus} = 'publication' OR ${teachingCasesTable.tagsJson}::text ILIKE '%publication%')`);
  if (q?.trim()) {
    const term = `%${q.trim().toLowerCase()}%`;
    conditions.push(sql`(
      lower(${teachingCasesTable.title}) LIKE ${term} OR
      lower(coalesce(${teachingCasesTable.diagnosis}, '')) LIKE ${term} OR
      lower(coalesce(${teachingCasesTable.findings}, '')) LIKE ${term}
    )`);
  }

  const whereClause = and(...conditions);
  const pageSizeN = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const pageN = Math.max(Number(page) || 1, 1);
  const offset = (pageN - 1) * pageSizeN;

  const [totalRow] = await db.select({ count: count() }).from(teachingCasesTable).where(whereClause);
  const total = totalRow?.count ?? 0;

  const rows = await db
    .select().from(teachingCasesTable)
    .where(whereClause)
    .orderBy(desc(teachingCasesTable.createdAt))
    .limit(pageSizeN)
    .offset(offset);

  // CSV export
  if (exportFormat === "csv") {
    const cols = ["id", "title", "diagnosis", "modality", "bodyPart", "category", "difficulty", "researchStatus", "isAnonymized", "createdAt"] as const;
    const header = cols.join(",");
    const csvRows = rows.map((r) =>
      cols.map((c) => {
        const v = r[c];
        if (v == null) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="research-cases-${Date.now()}.csv"`);
    res.send([header, ...csvRows].join("\n"));
    return;
  }

  res.json({
    cases: rows,
    pagination: { page: pageN, pageSize: pageSizeN, total, totalPages: Math.ceil(total / pageSizeN) },
  });
});

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
teachingCasesRouter.get("/analytics", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);

  const totalCases = await db.select({ count: count() }).from(teachingCasesTable);
  const totalViews = await db.select({ count: count() }).from(teachingCaseViewsTable);
  const myCases = userId
    ? await db.select({ count: count() }).from(teachingCasesTable).where(eq(teachingCasesTable.createdById, userId))
    : [{ count: 0 }];
  const myFavorites = userId
    ? await db.select({ count: count() }).from(teachingCaseFavoritesTable).where(eq(teachingCaseFavoritesTable.userId, userId))
    : [{ count: 0 }];
  const researchCases = await db.select({ count: count() }).from(teachingCasesTable).where(eq(teachingCasesTable.isResearchCandidate, true));

  const byCategory = await db
    .select({ category: teachingCasesTable.category, count: count() })
    .from(teachingCasesTable)
    .groupBy(teachingCasesTable.category);

  const byModality = await db
    .select({ modality: teachingCasesTable.modality, count: count() })
    .from(teachingCasesTable)
    .where(sql`${teachingCasesTable.modality} IS NOT NULL`)
    .groupBy(teachingCasesTable.modality);

  const mostViewed = await db
    .select().from(teachingCasesTable)
    .orderBy(desc(teachingCasesTable.viewCount))
    .limit(10);

  res.json({
    totalCases: totalCases[0]?.count ?? 0,
    totalViews: totalViews[0]?.count ?? 0,
    myCases: myCases[0]?.count ?? 0,
    myFavorites: myFavorites[0]?.count ?? 0,
    researchCases: researchCases[0]?.count ?? 0,
    byCategory,
    byModality,
    mostViewed,
  });
});

// ─── LEGACY ANALYTICS (dashboard) ───────────────────────────────────────────
teachingCasesRouter.get("/analytics/dashboard", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const userId = getUserId(sReq);
  const totalCases = await db.select({ count: count() }).from(teachingCasesTable);
  const totalViews = await db.select({ count: count() }).from(teachingCaseViewsTable);
  const myCases = userId
    ? await db.select({ count: count() }).from(teachingCasesTable).where(eq(teachingCasesTable.createdById, userId))
    : [{ count: 0 }];
  const myFavorites = userId
    ? await db.select({ count: count() }).from(teachingCaseFavoritesTable).where(eq(teachingCaseFavoritesTable.userId, userId))
    : [{ count: 0 }];
  const researchCases = await db.select({ count: count() }).from(teachingCasesTable).where(eq(teachingCasesTable.isResearchCandidate, true));

  // By category
  const byCategory = await db
    .select({ category: teachingCasesTable.category, count: count() })
    .from(teachingCasesTable)
    .groupBy(teachingCasesTable.category);

  // By modality
  const byModality = await db
    .select({ modality: teachingCasesTable.modality, count: count() })
    .from(teachingCasesTable)
    .where(sql`${teachingCasesTable.modality} IS NOT NULL`)
    .groupBy(teachingCasesTable.modality);

  // Most viewed
  const mostViewed = await db
    .select().from(teachingCasesTable)
    .orderBy(desc(teachingCasesTable.viewCount))
    .limit(10);

  res.json({
    totalCases: totalCases[0]?.count ?? 0,
    totalViews: totalViews[0]?.count ?? 0,
    myCases: myCases[0]?.count ?? 0,
    myFavorites: myFavorites[0]?.count ?? 0,
    researchCases: researchCases[0]?.count ?? 0,
    byCategory,
    byModality,
    mostViewed,
  });
});

// ─── ANONYMIZE ───────────────────────────────────────────────────────────────
teachingCasesRouter.post("/:id/anonymize", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!isOwner(sReq)) { res.status(403).json({ error: "Insufficient permissions." }); return; }

  const id = Number(req.params.id);
  await db.update(teachingCasesTable).set({
    isAnonymized: true,
    anonymizedAt: new Date(),
  }).where(eq(teachingCasesTable.id, id));

  res.json({ success: true });
});

// ─── MEASUREMENT HISTORY ─────────────────────────────────────────────────────
teachingCasesRouter.get("/measurements/:patientId", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const patientId = Number(req.params.patientId);
  const { type } = req.query;

  const conditions = [eq(measurementHistoryTable.patientId, patientId)];
  if (type) conditions.push(eq(measurementHistoryTable.measurementType, String(type)));

  const rows = await db
    .select().from(measurementHistoryTable)
    .where(and(...conditions))
    .orderBy(desc(measurementHistoryTable.measuredAt));

  // Group by measurement type
  const grouped: Record<string, typeof rows> = {};
  for (const row of rows) {
    const key = row.measurementType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  res.json({ measurements: rows, grouped });
});

// ─── GENERATE TEACHING CASE FROM REPORT ──────────────────────────────────────
// Phase 10C: Teaching Generator — create a draft teaching case from a finalised radiology report
// ─── PHI DE-IDENTIFICATION ──────────────────────────────────────────────────
// Regex-based best-effort PHI redaction for teaching-case text.
// Removes MRN/ID patterns, phone numbers, emails, dates, and address fragments.
// NOTE: Free-text clinical notes may still contain patient names embedded in
// prose (e.g. "referred by Dr. Singh regarding Mrs. Sharma"). These require
// manual review before publishing. The `isAnonymized` flag is set to `true` to
// indicate that automated redaction was applied, not that PHI is 100% absent.
function redactPhi(text: string): string {
  if (!text) return text;
  let out = text;
  // MRN / Patient ID patterns
  out = out.replace(/\b(?:MR[N]?|Patient\s*ID|Pt\.?\s*ID|UHID|IP\s*No|OP\s*No)\s*[:#]?\s*\d[\w-]*/gi, "[ID_REDACTED]");
  // Phone numbers (Indian + international formats)
  out = out.replace(/\b(?:\+?91[-.]?)?(?:\(?\d{2,5}\)?[-.]?)?\d{6,10}\b/g, "[PHONE_REDACTED]");
  // Email addresses
  out = out.replace(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, "[EMAIL_REDACTED]");
  // Specific calendar dates (preserve relative dates like "3 months ago")
  out = out.replace(
    /\b(?:\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s*\d{4})\b/gi,
    "[DATE_REDACTED]",
  );
  // Street address fragments
  out = out.replace(/\b\d+[A-Z]?\s+[\w\s]{3,30}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Nagar|Colony|Block|Sector)\b/gi, "[ADDR_REDACTED]");
  // Aadhaar / PAN / passport patterns
  out = out.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[AADHAAR_REDACTED]");
  out = out.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN_REDACTED]");
  return out;
}

// ─── GET DETAIL (must be after all static GET routes to avoid shadowing) ─────
teachingCasesRouter.get("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  const id = Number(req.params.id);

  const [caseRow] = await db.select().from(teachingCasesTable).where(eq(teachingCasesTable.id, id)).limit(1);
  if (!caseRow) { res.status(404).json({ error: "Not found" }); return; }

  const images = await db
    .select().from(teachingCaseImagesTable)
    .where(eq(teachingCaseImagesTable.teachingCaseId, id))
    .orderBy(teachingCaseImagesTable.sortOrder);

  const notes = await db
    .select().from(teachingCaseNotesTable)
    .where(eq(teachingCaseNotesTable.teachingCaseId, id))
    .orderBy(desc(teachingCaseNotesTable.createdAt));

  const isFav = userId
    ? (await db.select().from(teachingCaseFavoritesTable)
        .where(and(eq(teachingCaseFavoritesTable.teachingCaseId, id), eq(teachingCaseFavoritesTable.userId, userId)))
        .limit(1)).length > 0
    : false;

  // Increment view count
  await db.update(teachingCasesTable)
    .set({ viewCount: sql`${teachingCasesTable.viewCount} + 1` })
    .where(eq(teachingCasesTable.id, id));

  // Record view
  if (userId) {
    await db.insert(teachingCaseViewsTable).values({
      teachingCaseId: id,
      userId,
      userName: getUserName(sReq),
    }).catch(() => { /* ignore */ });
  }

  res.json({ case: caseRow, images, notes, isFavorite: isFav });
});

teachingCasesRouter.post("/generate-from-report", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  const userName = getUserName(sReq);
  const body = req.body as Record<string, unknown>;

  const {
    modality, testName, bodyPart,
    clinicalHistory, findings, impression, diagnosis,
    category = "general",
  } = body as {
    modality?: string; testName?: string;
    bodyPart?: string; clinicalHistory?: string; findings?: string;
    impression?: string; diagnosis?: string; category?: string;
  };

  if (!findings && !impression) {
    res.status(400).json({ error: "findings or impression required to generate a teaching case" });
    return;
  }

  // ── PHI redaction before any persistence ────────────────────────────────────
  // Apply regex-based de-identification to all free-text clinical fields.
  // Patient names embedded in prose require manual review before publishing.
  const safeHistory = redactPhi(clinicalHistory ?? "");
  const safeFindings = redactPhi(findings ?? "");
  const safeImpression = redactPhi(impression ?? "");

  const studyLabel = [modality, testName ?? bodyPart].filter(Boolean).join(" ") || "Radiology Study";
  const combinedFindings = [
    safeHistory ? `Clinical History: ${safeHistory}` : null,
    safeFindings ? `Findings:\n${safeFindings}` : null,
  ].filter(Boolean).join("\n\n");

  // ── Gemini: generate structured teaching content ───────────────────────────
  let aiTitle = [modality, testName ?? bodyPart, diagnosis ?? "Interesting Case"].filter(Boolean).join(" — ");
  let aiPearls = "";
  let aiPitfalls = "";
  let aiSummary = "";
  let aiKeyFindings: string[] = [];
  let aiDifferential: string[] = [];
  let aiTeachingPoints: string[] = [];
  let aiMcqs: Array<{ question: string; options: string[]; answer: string; explanation?: string }> = [];
  let aiDiagnosis = diagnosis ?? "";

  const geminiConfigured =
    !!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL &&
    !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  if (geminiConfigured) {
    try {
      const { geminiGenerate } = await import("@workspace/integrations-gemini-ai");
      const prompt = `You are an expert radiology educator creating a structured teaching case for residents and fellows.

Study: ${studyLabel}
${combinedFindings ? `\n${combinedFindings}` : ""}
${safeImpression ? `\nImpression: ${safeImpression}` : ""}

Generate a JSON object with EXACTLY these fields:
{
  "title": "concise descriptive title (no patient names or IDs)",
  "diagnosis": "primary diagnosis in 3-5 words",
  "summary": "2-3 sentence clinical summary for teaching",
  "keyFindings": ["finding 1", "finding 2", "finding 3", "finding 4"],
  "differential": ["diagnosis 1 with brief reason", "diagnosis 2 with brief reason", "diagnosis 3 with brief reason"],
  "teachingPoints": ["teaching point 1", "teaching point 2", "teaching point 3", "teaching point 4", "teaching point 5"],
  "clinicalPearls": "3-5 concise clinical pearls as a numbered list",
  "pitfalls": "2-3 common mistakes or pitfalls as a numbered list",
  "mcqs": [
    {"question": "MCQ 1 question stem", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "brief explanation"},
    {"question": "MCQ 2 question stem", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "B", "explanation": "brief explanation"},
    {"question": "MCQ 3 question stem", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "C", "explanation": "brief explanation"},
    {"question": "MCQ 4 question stem", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "brief explanation"},
    {"question": "MCQ 5 question stem", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "D", "explanation": "brief explanation"}
  ]
}

Return ONLY the JSON object. No preamble. AI Draft – Requires Radiologist Review before publishing.`;

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 40000);
      const rawAi = await geminiGenerate(prompt, { maxTokens: 2048 });
      clearTimeout(timer);

      // Extract JSON from the response
      const match = rawAi.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as {
          title?: string;
          diagnosis?: string;
          summary?: string;
          keyFindings?: string[];
          differential?: string[];
          teachingPoints?: string[];
          clinicalPearls?: string;
          pitfalls?: string;
          mcqs?: Array<{ question: string; options: string[]; answer: string; explanation?: string }>;
        };
        if (parsed.title) aiTitle = parsed.title;
        if (parsed.diagnosis) aiDiagnosis = parsed.diagnosis;
        if (parsed.summary) aiSummary = parsed.summary;
        if (Array.isArray(parsed.keyFindings)) aiKeyFindings = parsed.keyFindings;
        if (Array.isArray(parsed.differential)) aiDifferential = parsed.differential;
        if (Array.isArray(parsed.teachingPoints)) aiTeachingPoints = parsed.teachingPoints;
        if (parsed.clinicalPearls) aiPearls = parsed.clinicalPearls;
        if (parsed.pitfalls) aiPitfalls = parsed.pitfalls;
        if (Array.isArray(parsed.mcqs)) aiMcqs = parsed.mcqs.slice(0, 5);
      }
    } catch (_aiErr) {
      // AI generation is best-effort; fall through to save draft without AI content
    }
  }

  // ── Build enhanced findings with AI teaching content ───────────────────────
  const mcqBlock = aiMcqs.length > 0
    ? `\n--- AI MCQs (Draft — Requires Review) ---\n` +
      aiMcqs.map((q, i) =>
        `Q${i + 1}. ${q.question}\n${q.options.join("\n")}\nAnswer: ${q.answer}${q.explanation ? ` — ${q.explanation}` : ""}`
      ).join("\n\n")
    : "";

  const enhancedFindings = [
    combinedFindings || null,
    aiSummary ? `\n--- AI Summary (Draft — Requires Review) ---\n${aiSummary}` : null,
    aiKeyFindings.length > 0 ? `\n--- Key Findings ---\n${aiKeyFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}` : null,
    aiDifferential.length > 0 ? `\n--- Differential Diagnosis ---\n${aiDifferential.map((d, i) => `${i + 1}. ${d}`).join("\n")}` : null,
    aiTeachingPoints.length > 0 ? `\n--- Teaching Points ---\n${aiTeachingPoints.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : null,
    aiPearls ? `\n--- Clinical Pearls (Draft — Requires Review) ---\n${aiPearls}` : null,
    aiPitfalls ? `\n--- Pitfalls (Draft — Requires Review) ---\n${aiPitfalls}` : null,
    mcqBlock || null,
  ].filter(Boolean).join("\n");

  const [newCase] = await db.insert(teachingCasesTable).values({
    title: aiTitle,
    category: String(category),
    modality: modality ? String(modality) : null,
    bodyPart: bodyPart ? String(bodyPart) : null,
    diagnosis: aiDiagnosis || null,
    findings: enhancedFindings || null,
    impression: safeImpression || null,
    difficulty: "intermediate",
    status: "draft",
    isResearchCandidate: false,
    isAnonymized: true,  // patient identifiers are not stored in this endpoint
    createdById: userId ?? 0,
    createdByName: userName ?? null,
  }).returning();

  const aiGenerated = geminiConfigured && (aiPearls || aiPitfalls || aiMcqs.length > 0);
  res.json({
    case: newCase,
    aiGenerated,
    message: aiGenerated
      ? "Teaching case created with AI-generated pearls, pitfalls, and MCQ. AI Draft — Requires Radiologist Review before publishing."
      : "Teaching case draft created from report. AI is not configured — add pearls and MCQs manually before publishing.",
  });
});

teachingCasesRouter.post("/measurements", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const userId = getUserId(sReq);
  const userName = getUserName(sReq);

  const body = req.body as Record<string, unknown>;
  const [newMeasurement] = await db.insert(measurementHistoryTable).values({
    patientId: Number(body.patientId ?? 0),
    measurementType: String(body.measurementType ?? "other"),
    measurementLabel: String(body.measurementLabel ?? ""),
    value: String(body.value ?? ""),
    unit: String(body.unit ?? "mm"),
    bodyPart: body.bodyPart ? String(body.bodyPart) : null,
    side: body.side ? String(body.side) : null,
    level: body.level ? String(body.level) : null,
    studyId: body.studyId ? Number(body.studyId) : null,
    studyInstanceUid: body.studyInstanceUid ? String(body.studyInstanceUid) : null,
    accessionNumber: body.accessionNumber ? String(body.accessionNumber) : null,
    seriesNumber: body.seriesNumber ? String(body.seriesNumber) : null,
    imageNumber: body.imageNumber ? String(body.imageNumber) : null,
    modality: body.modality ? String(body.modality) : null,
    measuredById: userId ?? null,
    measuredByName: userName ?? null,
  }).returning();

  res.json({ measurement: newMeasurement });
});
