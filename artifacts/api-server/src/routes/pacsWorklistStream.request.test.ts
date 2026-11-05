/**
 * The worklist live-refresh stream over real HTTP.
 *
 * WHY THIS EXISTS: the ERP's SSE client used to be an EventSource whose URL was
 * built from the SPA's BASE_URL, so the request went to /erp/api/… and was
 * answered by the SPA shell as text/html, and it carried the staff session token
 * in the query string because EventSource cannot send headers. The replacement
 * client sends `Authorization: Bearer` to the root-relative /api path — the same
 * credential every other ERP request already uses, so no new authentication
 * subsystem. This suite pins the two server-side facts that replacement depends
 * on, neither of which is visible from a source-text assertion:
 *
 *   1. the route answers a Bearer-authenticated request with text/event-stream
 *      (not HTML, and not 401-for-lacking-a-query-token);
 *   2. the auth and permission gates on the mount are unchanged — an
 *      unauthenticated request is refused and a staff session without the
 *      /radiology grant is refused.
 *
 * The token values are synthetic rows created for this run and deleted after it.
 * Skips when DATABASE_URL is unset. A skip is not a pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSessionsTable, usersTable } from "@workspace/db/schema";
import { radiologyBroadcaster } from "../lib/radiologyBroadcast";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";

const STREAM_PATH = "/api/radiology/pacs-worklist-stream";

describe.skipIf(!hasDatabaseUrl())("pacs-worklist-stream (real HTTP + DB)", () => {
  const marker = `vitest-wls-${randomUUID().slice(0, 8)}`;
  let app: Express;
  let server: http.Server;
  let origin = "";
  let radiologistId = 0;
  let cashierId = 0;
  let radiologistToken = "";
  let cashierToken = "";

  async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream closed before a complete frame arrived");
      text += decoder.decode(value, { stream: true });
      const end = text.indexOf("\n\n");
      if (end >= 0) return text.slice(0, end);
    }
  }

  async function openStream(token: string | null): Promise<{
    res: Response;
    frame: () => Promise<string>;
    stop: () => Promise<void>;
  }> {
    const controller = new AbortController();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${origin}${STREAM_PATH}`, { headers, signal: controller.signal });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("the route answered without a readable body");
    return {
      res,
      frame: () => readFrame(reader),
      stop: async () => {
        try { await reader.cancel(); } catch { /* already closed */ }
        controller.abort();
      },
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const [rad] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Radiologist ${marker}`,
        email: `rad-${marker}@vitest.invalid`,
        username: `rad-${marker}`,
        role: "radiologist",
        permissions: JSON.stringify(["/radiology"]),
        pin: "1111",
        isActive: true,
      })
      .returning();
    radiologistId = rad.id;
    radiologistToken = `vitest-rad-${marker}`;
    await db.insert(portalSessionsTable).values({
      token: radiologistToken,
      scope: "staff",
      subjectId: rad.id,
      subjectName: rad.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const [bil] = await db
      .insert(usersTable)
      .values({
        name: `Vitest Bill Desk ${marker}`,
        email: `bil-${marker}@vitest.invalid`,
        username: `bil-${marker}`,
        role: "cashier",
        permissions: JSON.stringify(["/billing"]),
        pin: "2222",
        isActive: true,
      })
      .returning();
    cashierId = bil.id;
    cashierToken = `vitest-bil-${marker}`;
    await db.insert(portalSessionsTable).values({
      token: cashierToken,
      scope: "staff",
      subjectId: bil.id,
      subjectName: bil.name,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    await db.delete(portalSessionsTable).where(inArray(portalSessionsTable.token, [radiologistToken, cashierToken]));
    await db.delete(usersTable).where(inArray(usersTable.id, [radiologistId, cashierId]));
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it("W1 — a Bearer-authenticated radiology session gets an event stream, not HTML", async () => {
    const s = await openStream(radiologistToken);
    try {
      expect(s.res.status).toBe(200);
      expect(s.res.headers.get("content-type") ?? "").toContain("text/event-stream");
      const first = JSON.parse((await s.frame()).replace(/^data:\s?/, "")) as { type?: string };
      expect(first.type).toBe("connected");
    } finally {
      await s.stop();
    }
  });

  it("W2 — a PACS intake broadcast is pushed down the open stream", async () => {
    const s = await openStream(radiologistToken);
    try {
      await s.frame(); // the connected frame also proves the handler registered its listener
      const worklistId = 987654321;
      radiologyBroadcaster.broadcast(worklistId);
      const payload = JSON.parse((await s.frame()).replace(/^data:\s?/, "")) as {
        type?: string;
        worklistId?: number;
      };
      expect(payload).toMatchObject({ type: "refresh", worklistId });
    } finally {
      await s.stop();
    }
  });

  it("W3 — no credential is refused with 401 (the gate is unchanged)", async () => {
    const s = await openStream(null);
    try {
      expect(s.res.status).toBe(401);
      expect(s.res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
    } finally {
      await s.stop();
    }
  });

  it("W4 — a staff session without the /radiology grant is refused with 403", async () => {
    const s = await openStream(cashierToken);
    try {
      expect(s.res.status).toBe(403);
    } finally {
      await s.stop();
    }
  });

  it("W5 — the legacy ?staffToken= leg still works, so no other consumer breaks", async () => {
    const controller = new AbortController();
    const res = await fetch(
      `${origin}${STREAM_PATH}?staffToken=${encodeURIComponent(cashierToken)}`,
      { signal: controller.signal },
    );
    controller.abort();
    // The point is only that the query leg is still honoured by the middleware:
    // a cashier reaches the gate, so 403 rather than 401.
    expect(res.status).toBe(403);
  });

  it("W6 — the frame the ERP parses is the frame this route writes", async () => {
    const s = await openStream(radiologistToken);
    try {
      const raw = await s.frame();
      // authedEventStream dispatches on a "data:" line followed by an empty line.
      expect(raw.startsWith("data: ")).toBe(true);
      expect(() => JSON.parse(raw.slice("data: ".length))).not.toThrow();
    } finally {
      await s.stop();
    }
  });
});
