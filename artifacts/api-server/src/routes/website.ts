import { Router, type Request } from "express";
import {
  db,
  siteSettingsTable,
  sitePagesTable,
  sitePopupsTable,
  siteFaqsTable,
  sitePhotosTable,
} from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { and, eq, asc, desc, gt } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import multer from "multer";
import sanitizeHtml from "sanitize-html";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  requireStaffAuth,
  requireStaffPermission,
  FULL_ACCESS_ROLES,
  type StaffAuthRequest,
} from "../middleware/requireStaffAuth";

export const websiteRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Short-lived preview tokens — issued to authenticated staff so the public
// clinic-site can verify that a preview request came from a real staff session
// without the bearer token appearing in the URL or being accessible to
// unauthenticated visitors.
// ─────────────────────────────────────────────────────────────────────────────
const previewTokens = new Map<string, number>();
const PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000;

function isValidPreviewToken(req: Request): boolean {
  const token = typeof req.query.preview_token === "string" ? req.query.preview_token : "";
  if (!token) return false;
  const exp = previewTokens.get(token);
  return !!exp && exp > Date.now();
}

async function hasStaffSession(req: Request): Promise<boolean> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const [session] = await db
    .select({ id: portalSessionsTable.id, subjectId: portalSessionsTable.subjectId })
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.token, token),
        eq(portalSessionsTable.scope, "staff"),
        gt(portalSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return false;

  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, session.subjectId))
    .limit(1);

  return !!user?.isActive;
}

async function canViewDrafts(req: Request): Promise<boolean> {
  if (isValidPreviewToken(req)) return true;
  return hasStaffSession(req);
}

function isAdminRole(req: Request): boolean {
  const session = (req as StaffAuthRequest).staffSession;
  return !!session && FULL_ACCESS_ROLES.has(session.role);
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img", "figure", "figcaption", "video", "audio", "source",
    "details", "summary", "mark", "abbr", "time", "hr",
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "alt", "title", "width", "height", "loading"],
    a: ["href", "title", "target", "rel"],
    video: ["src", "controls", "width", "height", "poster"],
    audio: ["src", "controls"],
    source: ["src", "type"],
    time: ["datetime"],
    "*": ["class", "id"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  disallowedTagsMode: "discard",
};

function parseJsonArray(value: string | null | undefined): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serverSanitizeHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, SANITIZE_OPTS);
}

function sanitizePageSectionsForPublic<T extends { sections?: string | null }>(page: T): T {
  if (!page.sections) return page;
  try {
    const sections: unknown[] = JSON.parse(page.sections);
    if (!Array.isArray(sections)) return page;
    const cleaned = sections.map((section) => {
      if (!isCustomHtmlSection(section)) return section;
      return {
        ...section,
        config: {
          ...section.config,
          html: serverSanitizeHtml(section.config.html),
        },
      };
    });
    return { ...page, sections: JSON.stringify(cleaned) };
  } catch {
    return page;
  }
}

function isCustomHtmlSection(
  section: unknown,
): section is { type: "custom_html"; config: { html: string; [key: string]: unknown }; [key: string]: unknown } {
  if (!section || typeof section !== "object") return false;
  const typed = section as { type?: unknown; config?: unknown };
  if (typed.type !== "custom_html" || !typed.config || typeof typed.config !== "object") return false;
  const cfg = typed.config as { html?: unknown };
  return typeof cfg.html === "string";
}

const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|\/(?!\/))/i;

function sanitizeUrl(url: unknown): string {
  if (typeof url !== "string" || url.trim() === "") return "";
  const trimmed = url.trim();
  return SAFE_URL_SCHEMES.test(trimmed) ? trimmed : "";
}

function sanitizeSocialLinks(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      cleaned[k] = sanitizeUrl(v);
    }
    return JSON.stringify(cleaned);
  } catch {
    return value;
  }
}

function sanitizeSectionUrls(sectionsJson: string): string {
  try {
    const sections: unknown[] = JSON.parse(sectionsJson);
    if (!Array.isArray(sections)) return sectionsJson;
    const cleaned = sections.map((section) => {
      if (!section || typeof section !== "object") return section;
      const s = section as Record<string, unknown>;
      const cfg = s.config && typeof s.config === "object" ? { ...(s.config as Record<string, unknown>) } : null;
      if (!cfg) return section;

      if ("ctaUrl" in cfg) cfg.ctaUrl = sanitizeUrl(cfg.ctaUrl);
      if ("links" in cfg && Array.isArray(cfg.links)) {
        cfg.links = (cfg.links as unknown[]).map((link) => {
          if (!link || typeof link !== "object") return link;
          const l = { ...(link as Record<string, unknown>) };
          if ("url" in l) l.url = sanitizeUrl(l.url);
          return l;
        });
      }
      return { ...s, config: cfg };
    });
    return JSON.stringify(cleaned);
  } catch {
    return sectionsJson;
  }
}

function stripCustomHtmlSections(sectionsJson: string, existingSectionsJson?: string): string {
  const incoming = parseJsonArray(sectionsJson);
  const withoutCustomHtml = incoming.filter((s: unknown) => (s as { type?: string }).type !== "custom_html");
  if (!existingSectionsJson) return JSON.stringify(withoutCustomHtml);

  const existing = parseJsonArray(existingSectionsJson);
  const existingCustomHtml = existing.filter((s: unknown) => (s as { type?: string }).type === "custom_html");
  if (existingCustomHtml.length === 0) return JSON.stringify(withoutCustomHtml);
  return JSON.stringify([...withoutCustomHtml, ...existingCustomHtml]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Site Settings — singleton row (id = 1). Auto-creates on first read.
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrCreateSettings() {
  const [existing] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.id, 1));
  if (existing) return existing;

  // Row not found yet — try to create it. Under concurrent requests (e.g. two
  // browser tabs both loading the site on a cold cache) two callers can both
  // reach this point believing id=1 doesn't exist yet. onConflictDoNothing()
  // makes the insert itself race-safe: whichever request wins the race
  // creates the row, and the other's insert becomes a harmless no-op instead
  // of crashing with "duplicate key value violates unique constraint
  // site_settings_pkey". Either way we re-SELECT afterwards so both callers
  // return the same, single, existing row — a GET never overwrites settings
  // that already exist, and never throws because id=1 was already there.
  await db.insert(siteSettingsTable).values({ id: 1 }).onConflictDoNothing();

  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.id, 1));
  if (!row) {
    // Should be unreachable (we just inserted or someone else did), but
    // fail loudly rather than returning undefined to a caller that expects
    // a settings object.
    throw new Error("site_settings row could not be created or found for id=1");
  }
  return row;
}

websiteRouter.get("/settings", async (req, res) => {
  const s = await getOrCreateSettings();
  const draftsAllowed = await canViewDrafts(req);

  if (!s.isPublished && !draftsAllowed) {
    res.json({
      id: s.id,
      isPublished: false,
    });
    return;
  }
  res.json(s);
});

websiteRouter.patch("/settings", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  await getOrCreateSettings();
  const allowed: (keyof typeof siteSettingsTable.$inferInsert)[] = [
    "siteTitle", "tagline", "about", "contactEmail", "contactPhone",
    "whatsappNumber", "whatsappEnabled", "whatsappGreeting", "address", "registeredAddress",
    "faviconUrl", "logoUrl",
    "themeId", "primaryColor", "secondaryColor", "accentColor",
    "backgroundColor", "fontHeading", "fontBody", "buttonStyle",
    "customDomain",
    "seoMetaTitle", "seoMetaDescription", "seoKeywords", "seoOgImage",
    "googleAnalyticsId", "googleTagManagerId", "googleAdsenseId",
    "metaPixelId", "facebookMetaTag", "pinterestMetaTag",
    "socialLinks",
    "serviceImagesEnabled", "serviceImages", "bookHeroImageUrl",
  ];

  if (isAdminRole(req)) {
    allowed.push("customHeadHtml");
  }

  const URL_FIELDS = new Set<string>(["faviconUrl", "logoUrl", "seoOgImage", "bookHeroImageUrl"]);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (req.body[k] === undefined) continue;
    if (URL_FIELDS.has(k)) {
      updates[k] = sanitizeUrl(req.body[k]);
    } else if (k === "socialLinks") {
      updates[k] = sanitizeSocialLinks(req.body[k]);
    } else {
      updates[k] = req.body[k];
    }
  }
  const [updated] = await db
    .update(siteSettingsTable)
    .set(updates)
    .where(eq(siteSettingsTable.id, 1))
    .returning();
  res.json(updated);
});

websiteRouter.post("/publish", requireStaffAuth, requireStaffPermission("/website"), async (_req, res) => {
  const s = await getOrCreateSettings();
  const [updated] = await db
    .update(siteSettingsTable)
    .set({
      isPublished: true,
      lastPublishedAt: new Date(),
      publishedRevision: (s.publishedRevision ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(siteSettingsTable.id, 1))
    .returning();
  res.json(updated);
});

websiteRouter.post("/unpublish", requireStaffAuth, requireStaffPermission("/website"), async (_req, res) => {
  const [updated] = await db
    .update(siteSettingsTable)
    .set({ isPublished: false, updatedAt: new Date() })
    .where(eq(siteSettingsTable.id, 1))
    .returning();
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────
websiteRouter.get("/pages", async (req, res) => {
  const draftsAllowed = await canViewDrafts(req);

  if (draftsAllowed) {
    const pages = await db.select().from(sitePagesTable).orderBy(asc(sitePagesTable.orderIndex), asc(sitePagesTable.id));
    res.json({ pages });
    return;
  }

  const settings = await getOrCreateSettings();
  if (!settings.isPublished) {
    res.json({ pages: [] });
    return;
  }

  const pages = await db
    .select()
    .from(sitePagesTable)
    .where(eq(sitePagesTable.status, "published"))
    .orderBy(asc(sitePagesTable.orderIndex), asc(sitePagesTable.id));
  res.json({ pages: pages.map(sanitizePageSectionsForPublic) });
});

websiteRouter.get("/pages/:id", async (req, res) => {
  const [p] = await db.select().from(sitePagesTable).where(eq(sitePagesTable.id, Number(req.params.id)));
  if (!p) { res.status(404).json({ error: "Page not found" }); return; }

  const draftsAllowed = await canViewDrafts(req);
  const settings = await getOrCreateSettings();

  if (!draftsAllowed && !settings.isPublished) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  if (!draftsAllowed && p.status !== "published") {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json(draftsAllowed ? p : sanitizePageSectionsForPublic(p));
});

// Default homepage section layout — used ONLY when a brand-new page is
// created with slug "home" and the caller did not supply its own
// `sections` payload. Root-cause fix for: creating a page via the website
// builder (POST /pages) always defaulted to an EMPTY sections array
// ("[]"), so a freshly-created/published "Home" page renders as just a
// header + footer with nothing in between — no hero, no services, no
// stats, etc. — even though the section COMPONENTS themselves (see
// artifacts/clinic-site/src/sections.tsx) are fully designed. Every
// section below uses an empty config ({}) so each component's own
// built-in fallback content (site name, default copy, etc.) renders —
// the same pattern already used by the header/footer defaults in
// clinic-site/src/App.tsx (defaultHeader/defaultFooter). An admin can
// still edit, reorder, disable, or remove any of these via the builder
// afterward; this only affects what a brand-new "home" page starts with.
export const DEFAULT_HOME_SECTION_TYPES = [
  "hero",
  "stats",
  "services",
  "why_choose_us",
  "technology",
  "health_packages",
  "appointment",
  "gallery",
  "reviews",
  "faq",
  "contact",
  "subscribe",
  "connect",
] as const;

export function defaultHomeSectionsJson(): string {
  const sections = DEFAULT_HOME_SECTION_TYPES.map((type, i) => ({
    id: `default-${type}-${i}`,
    type,
    enabled: true,
    config: {},
  }));
  return JSON.stringify(sections);
}

websiteRouter.post("/pages", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  if (typeof req.body.slug !== "string" || !req.body.slug.trim()) {
    res.status(400).json({ error: "slug required" });
    return;
  }
  if (typeof req.body.title !== "string" || !req.body.title.trim()) {
    res.status(400).json({ error: "title required" });
    return;
  }
  const [duplicate] = await db.select({ id: sitePagesTable.id }).from(sitePagesTable).where(eq(sitePagesTable.slug, req.body.slug)).limit(1);
  if (duplicate) {
    res.status(409).json({ error: "slug already exists" });
    return;
  }
  const sections = req.body.sections !== undefined
    ? isAdminRole(req)
      ? sanitizeSectionUrls(String(req.body.sections))
      : sanitizeSectionUrls(stripCustomHtmlSections(String(req.body.sections)))
    : req.body.slug.trim().toLowerCase() === "home"
      ? defaultHomeSectionsJson()
      : "[]";
  const [page] = await db.insert(sitePagesTable).values({
    slug: req.body.slug,
    title: req.body.title,
    status: req.body.status ?? "draft",
    orderIndex: Number(req.body.orderIndex ?? 0),
    showInNav: req.body.showInNav ?? true,
    sections,
  }).returning();
  res.status(201).json(page);
});

websiteRouter.patch("/pages/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(sitePagesTable).where(eq(sitePagesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Page not found" }); return; }

  const updates: Record<string, unknown> = {};
  const allowed = ["slug", "title", "status", "orderIndex", "showInNav"];
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  if (req.body.sections !== undefined) {
    updates.sections = isAdminRole(req)
      ? sanitizeSectionUrls(String(req.body.sections))
      : sanitizeSectionUrls(stripCustomHtmlSections(String(req.body.sections), existing.sections));
  }
  const nextSlug = typeof req.body.slug === "string" ? req.body.slug.trim() : "";
  if (nextSlug && nextSlug !== existing.slug) {
    const [duplicate] = await db.select({ id: sitePagesTable.id }).from(sitePagesTable).where(eq(sitePagesTable.slug, nextSlug)).limit(1);
    if (duplicate) {
      res.status(409).json({ error: "slug already exists" });
      return;
    }
  }
  const [page] = await db.update(sitePagesTable).set(updates).where(eq(sitePagesTable.id, id)).returning();
  res.json(page);
});

websiteRouter.delete("/pages/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  await db.delete(sitePagesTable).where(eq(sitePagesTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

websiteRouter.post("/pages/:id/duplicate", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const [p] = await db.select().from(sitePagesTable).where(eq(sitePagesTable.id, Number(req.params.id)));
  if (!p) { res.status(404).json({ error: "Page not found" }); return; }
  const [copy] = await db.insert(sitePagesTable).values({
    slug: `${p.slug}-copy-${Date.now()}`,
    title: `${p.title} Copy`,
    status: "draft",
    orderIndex: p.orderIndex + 1,
    showInNav: p.showInNav,
    sections: p.sections,
  }).returning();
  res.status(201).json(copy);
});

// ─────────────────────────────────────────────────────────────────────────────
// Popups
// ─────────────────────────────────────────────────────────────────────────────
websiteRouter.get("/popups", async (req, res) => {
  const draftsAllowed = await canViewDrafts(req);
  const settings = await getOrCreateSettings();

  if (!settings.isPublished && !draftsAllowed) {
    res.json({ popups: [] });
    return;
  }

  const popups = draftsAllowed
    ? await db.select().from(sitePopupsTable).orderBy(asc(sitePopupsTable.id))
    : await db.select().from(sitePopupsTable).where(eq(sitePopupsTable.enabled, true)).orderBy(asc(sitePopupsTable.id));
  res.json({ popups });
});

websiteRouter.post("/popups", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const [popup] = await db.insert(sitePopupsTable).values({
    title: req.body.title,
    body: req.body.body,
    ctaLabel: req.body.ctaLabel,
    ctaUrl: sanitizeUrl(req.body.ctaUrl),
    imageUrl: sanitizeUrl(req.body.imageUrl),
    triggerType: req.body.triggerType,
    triggerValue: req.body.triggerValue,
    enabled: req.body.enabled ?? true,
  }).returning();
  res.status(201).json(popup);
});

websiteRouter.patch("/popups/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const id = Number(req.params.id);
  const URL_POPUP_FIELDS = new Set(["ctaUrl", "imageUrl"]);
  const allowed = ["title", "body", "ctaLabel", "ctaUrl", "imageUrl", "triggerType", "triggerValue", "enabled"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) {
    if (req.body[k] === undefined) continue;
    updates[k] = URL_POPUP_FIELDS.has(k) ? sanitizeUrl(req.body[k]) : req.body[k];
  }
  const [u] = await db.update(sitePopupsTable).set(updates).where(eq(sitePopupsTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "Popup not found" }); return; }
  res.json(u);
});

websiteRouter.delete("/popups/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  await db.delete(sitePopupsTable).where(eq(sitePopupsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// FAQs
// ─────────────────────────────────────────────────────────────────────────────
websiteRouter.get("/faqs", async (req, res) => {
  const draftsAllowed = await canViewDrafts(req);
  const settings = await getOrCreateSettings();

  if (!settings.isPublished && !draftsAllowed) {
    res.json({ faqs: [] });
    return;
  }

  const faqs = draftsAllowed
    ? await db.select().from(siteFaqsTable).orderBy(asc(siteFaqsTable.orderIndex), asc(siteFaqsTable.id))
    : await db.select().from(siteFaqsTable).where(eq(siteFaqsTable.enabled, true)).orderBy(asc(siteFaqsTable.orderIndex), asc(siteFaqsTable.id));
  res.json({ faqs });
});

websiteRouter.post("/faqs", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const { question, answer } = req.body ?? {};
  if (!question || !answer) { res.status(400).json({ error: "question and answer required" }); return; }
  const [f] = await db.insert(siteFaqsTable).values({
    question,
    answer,
    orderIndex: Number(req.body.orderIndex ?? 0),
    enabled: req.body.enabled ?? true,
  }).returning();
  res.status(201).json(f);
});

websiteRouter.patch("/faqs/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["question", "answer", "orderIndex", "enabled"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const [u] = await db.update(siteFaqsTable).set(updates).where(eq(siteFaqsTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "FAQ not found" }); return; }
  res.json(u);
});

websiteRouter.delete("/faqs/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  await db.delete(siteFaqsTable).where(eq(siteFaqsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Photos — local filesystem upload (data/uploads/site)
// ─────────────────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads", "site");

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

const objectStorage = new ObjectStorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

websiteRouter.get("/photos", async (req, res) => {
  const draftsAllowed = await canViewDrafts(req);
  const settings = await getOrCreateSettings();

  if (!settings.isPublished && !draftsAllowed) {
    res.json({ photos: [] });
    return;
  }

  const photos = await db.select().from(sitePhotosTable).orderBy(desc(sitePhotosTable.uploadedAt));
  res.json({ photos });
});

websiteRouter.post("/photos", requireStaffAuth, requireStaffPermission("/website"), upload.single("photo"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file" }); return; }
  try {
    // Ensure local upload directory exists (fallback when object storage unavailable)
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const ext = MIME_TO_EXT[req.file.mimetype] || ".jpg";
    const fileName = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    await fs.writeFile(filePath, req.file.buffer);
    // URL served by the existing static /uploads mount in app.ts
    const url = `/uploads/site/${fileName}`;
    const [p] = await db.insert(sitePhotosTable).values({
      url,
      alt: (req.body?.alt as string) ?? "",
      category: (req.body?.category as string) ?? "general",
    }).returning();
    res.status(201).json(p);
  } catch (err) {
    req.log.error({ err }, "Website photo upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

websiteRouter.delete("/photos/:id", requireStaffAuth, requireStaffPermission("/website"), async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await db.select().from(sitePhotosTable).where(eq(sitePhotosTable.id, id));
  if (p?.url?.startsWith("/objects/")) {
    await objectStorage.deleteObjectEntity(p.url).catch(() => {});
  }
  // Also delete local file if stored in uploads directory
  if (p?.url?.startsWith("/uploads/site/")) {
    const localPath = path.join(UPLOAD_DIR, path.basename(p.url));
    await fs.unlink(localPath).catch(() => {});
  }
  await db.delete(sitePhotosTable).where(eq(sitePhotosTable.id, id));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview tokens — lets authenticated staff open a time-limited preview URL
// without embedding their bearer token in the URL or exposing draft content
// to unauthenticated public visitors.
// ─────────────────────────────────────────────────────────────────────────────

websiteRouter.post("/preview-token", requireStaffAuth, requireStaffPermission("/website"), (_req, res) => {
  const token = crypto.randomUUID();
  const now = Date.now();
  previewTokens.set(token, now + PREVIEW_TOKEN_TTL_MS);
  for (const [t, exp] of previewTokens) {
    if (exp < now) previewTokens.delete(t);
  }
  res.json({ token });
});

websiteRouter.get("/verify-preview", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const exp = token ? previewTokens.get(token) : undefined;
  if (exp && exp > Date.now()) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false, error: "Invalid or expired preview token" });
  }
});
