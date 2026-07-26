import { describe, expect, test, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { resolveInsideUploadDir } from "./radiology-report-attachments";

// Reports are composed in Word, not this app's structured builder (the
// workspace's own UI admits every finalize runs the "LEGACY path", and no
// ff_radiology_* flag is enabled in any seed). Until this router existed there
// was NO place in the codebase to attach an in-house radiology study's
// finished report — the only external-report-attach route
// (outsourced-labs.ts POST /orders/:orderId/reports) is scoped to reference
// -lab orders. This is that missing landing spot, modeled on outsource_reports.

describe("resolveInsideUploadDir — real filesystem, real traversal payloads", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "radiology-attach-"));
  });

  test("a plain relative path inside the base dir resolves", () => {
    mkdirSync(join(baseDir, "reports"), { recursive: true });
    writeFileSync(join(baseDir, "reports", "abc123_report.pdf"), "x");
    const resolved = resolveInsideUploadDir(baseDir, join("reports", "abc123_report.pdf"));
    expect(resolved).toBe(join(baseDir, "reports", "abc123_report.pdf"));
  });

  test("../ traversal out of the base dir is rejected", () => {
    expect(resolveInsideUploadDir(baseDir, "../../etc/passwd")).toBeNull();
    expect(resolveInsideUploadDir(baseDir, "reports/../../../etc/passwd")).toBeNull();
  });

  test("an absolute path outside the base dir is rejected", () => {
    expect(resolveInsideUploadDir(baseDir, "/etc/passwd")).toBeNull();
  });

  test("a sneaky prefix-match directory (baseDir + suffix) is rejected", () => {
    // "/tmp/foo-evil" must NOT be treated as inside "/tmp/foo" just because
    // the string starts with it — this is the classic startsWith() bug.
    const evilSibling = `${baseDir}-evil`;
    expect(resolveInsideUploadDir(baseDir, evilSibling)).toBeNull();
  });

  test("the base directory itself resolves (edge case: empty relative path)", () => {
    expect(resolveInsideUploadDir(baseDir, ".")).toBe(baseDir);
  });

  test("cleanup", () => {
    rmSync(baseDir, { recursive: true, force: true });
    expect(existsSync(baseDir)).toBe(false);
  });
});

// ── Full route handlers, driven via the router stack ──────────────────────────

const dbState = {
  study: null as { id: number; patientId: number } | null,
  attachment: null as Record<string, unknown> | null,
  insertedValues: null as Record<string, unknown> | null,
  studyRows: [] as Array<Record<string, unknown>>,
};

vi.mock("@workspace/db", () => ({
  db: {
    select: (_cols?: unknown) => ({
      from: (table: { [key: symbol]: unknown } | { _: { name: string } }) => {
        const tableName = (table as { [x: string]: unknown })?.["_"]
          ? (table as { _: { name: string } })._.name
          : String(table);
        return {
          where: () => ({
            // GET /study/:studyId path (no further chain)
            orderBy: () => Promise.resolve(dbState.studyRows),
            then: (resolve: (v: unknown[]) => void) => {
              // POST / and GET /:id/download both do a bare select().from().where()
              if (tableName.includes("radiology_studies") || String(table).includes("radiologyStudies")) {
                resolve(dbState.study ? [dbState.study] : []);
              } else {
                resolve(dbState.attachment ? [dbState.attachment] : []);
              }
            },
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        dbState.insertedValues = v;
        return { returning: () => Promise.resolve([{ id: 99, ...v }]) };
      },
    }),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  radiologyReportAttachmentsTable: { _: { name: "radiology_report_attachments" } },
  radiologyStudiesTable: { _: { name: "radiology_studies" }, id: "id", patientId: "patient_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  desc: (a: unknown) => a,
}));

vi.mock("../lib/logger", () => ({ logger: { info: () => undefined, error: () => undefined, warn: () => undefined } }));

type Handler = (req: unknown, res: unknown, next?: () => void) => void | Promise<void>;

function fakeRes() {
  const out: { code?: number; body?: unknown; downloaded?: { path: string; name: string } } = {};
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    download(p: string, n: string) { out.downloaded = { path: p, name: n }; return res; },
  };
  return { res, out };
}

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> };
};

async function callRoute(
  router: { stack: RouteLayer[] },
  method: "get" | "post",
  routePath: string,
  opts: { params?: Record<string, string>; body?: unknown } = {},
) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  expect(layer, `expected a ${method.toUpperCase()} ${routePath} route`).toBeTruthy();
  // layer.handle here is Express's internal Route.dispatch (needs a working
  // `next` and its own error machinery) — the real handler function is one
  // level deeper, at layer.route.stack[0].handle. Same router-stack technique
  // used elsewhere this session, one extra level for a path-matched route.
  const routeHandler = layer!.route!.stack[0].handle;
  const { res, out } = fakeRes();
  const req = { params: opts.params ?? {}, body: opts.body ?? {}, staffSession: { subjectName: "Dr Test" } };
  await routeHandler(req, res, () => undefined);
  return out;
}

describe("radiology-report-attachments router — real handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    dbState.study = null;
    dbState.attachment = null;
    dbState.insertedValues = null;
    dbState.studyRows = [];
  });

  test("POST / rejects a request body that fails schema validation", async () => {
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "post", "/", { body: { studyId: "not-a-number" } });
    expect(out.code).toBe(400);
    expect(dbState.insertedValues).toBeNull();
  });

  test("POST / returns 404 when the study does not exist", async () => {
    dbState.study = null;
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "post", "/", {
      body: { studyId: 12345, filePath: "reports/x.pdf", fileName: "x.pdf" },
    });
    expect(out.code).toBe(404);
    expect(dbState.insertedValues).toBeNull();
  });

  test("POST / rejects a filePath that does not resolve to a real file — insert never runs", async () => {
    dbState.study = { id: 1, patientId: 7 };
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "post", "/", {
      body: { studyId: 1, filePath: "reports/does-not-exist.pdf", fileName: "x.pdf" },
    });
    expect(out.code).toBe(400);
    expect(dbState.insertedValues, "a nonexistent file must never reach the insert").toBeNull();
  });

  test("GET /:id/download returns 404 for an unknown attachment", async () => {
    dbState.attachment = null;
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "get", "/:id/download", { params: { id: "999" } });
    expect(out.code).toBe(404);
    expect(out.downloaded).toBeUndefined();
  });

  test("GET /:id/download returns 404 when the row exists but the file is missing on disk", async () => {
    dbState.attachment = { id: 5, filePath: "reports/gone_by_now.pdf", fileName: "gone.pdf" };
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "get", "/:id/download", { params: { id: "5" } });
    expect(out.code).toBe(404);
    expect(out.downloaded, "must never call res.download on a path that isn't a real file").toBeUndefined();
  });

  test("GET /study/:studyId rejects a non-numeric id before touching the database", async () => {
    const mod = await import("./radiology-report-attachments");
    const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
    const out = await callRoute(router as never, "get", "/study/:studyId", { params: { studyId: "not-a-number" } });
    expect(out.code).toBe(400);
  });

  test("POST / succeeds end-to-end: a real file under the real UPLOAD_BASE_DIR is accepted and inserted", async () => {
    // UPLOAD_BASE_DIR is process.cwd()/data/uploads — the exact tree
    // POST /api/uploads (module "reports") writes into. Vitest runs from the
    // repo root per this project's convention, so this creates a real file
    // where the module actually looks, rather than only exercising the mock.
    const relPath = join("reports", `attach-test-${Date.now()}.pdf`);
    const fullPath = join(process.cwd(), "data", "uploads", relPath);
    mkdirSync(join(process.cwd(), "data", "uploads", "reports"), { recursive: true });
    writeFileSync(fullPath, "%PDF-1.4 fake pdf content");

    try {
      dbState.study = { id: 42, patientId: 7 };
      const mod = await import("./radiology-report-attachments");
      const router = mod.default ?? mod.radiologyReportAttachmentsRouter;
      const out = await callRoute(router as never, "post", "/", {
        body: { studyId: 42, filePath: relPath, fileName: "final-report.pdf" },
      });

      expect(out.code).toBe(201);
      expect(dbState.insertedValues).toMatchObject({
        studyId: 42,
        patientId: 7,
        filePath: relPath,
        fileName: "final-report.pdf",
        uploadedBy: "Dr Test",
      });
    } finally {
      rmSync(fullPath, { force: true });
    }
  });
});
