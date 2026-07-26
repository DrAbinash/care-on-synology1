import { describe, expect, test, vi } from "vitest";

// GET /reports/daily-summary/pdf used to send Content-Type: text/html (a
// window.print()-and-close HTML page) despite the route being named /pdf and
// the frontend's "Download PDF" button (Reports.tsx) opening it directly in
// a new tab expecting a document. It now renders the same report HTML to a
// real PDF via headless Chromium (htmlToPdf.ts), the same pattern already
// used for GET /api/patient-reports/:id/pdf.

vi.mock("../lib/htmlToPdf", () => ({
  renderHtmlToPdf: async (html: string) => Buffer.from(`PDF:${html.length}`),
}));

const chain = {
  from: () => chain,
  where: () => Promise.resolve([]),
};
vi.mock("@workspace/db", () => ({
  db: { select: () => chain },
  ordersTable: {}, patientsTable: {}, billsTable: {}, paymentsTable: {},
  orderTestsTable: {}, testsTable: {}, samplesTable: {}, sampleTestAssignmentsTable: {},
}));
vi.mock("@workspace/db/schema", () => ({ accountsTable: {}, vouchersTable: {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, method: string, path: string) {
  const layer = router.stack.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} handler not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    statusCode: 200, body: undefined, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
  return res;
}

describe("GET /reports/daily-summary/pdf", () => {
  test("sends a real PDF, not HTML with a misleading Content-Type", async () => {
    const { reportsRouter } = await import("./reports");
    const handler = getRouteHandler(reportsRouter, "get", "/daily-summary/pdf");
    const req = { query: { date: "2026-07-20" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toBe('inline; filename="daily-report-2026-07-20.pdf"');
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  test("400s on a malformed date before touching the DB or renderer", async () => {
    const { reportsRouter } = await import("./reports");
    const handler = getRouteHandler(reportsRouter, "get", "/daily-summary/pdf");
    const req = { query: { date: "not-a-date" } };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.headers["Content-Type"]).toBeUndefined();
  });
});
