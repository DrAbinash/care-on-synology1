/**
 * Request-level: voice-transcription /transcribe must fail closed (HTTP 501)
 * and must never invent findings/impression (normal or abnormal modality).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createTestApp, hasDatabaseUrl } from "../testSupport/apiTestApp";
import { db } from "@workspace/db";
import {
  portalSessionsTable,
  usersTable,
  aiVoiceTranscriptionsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe.skipIf(!hasDatabaseUrl())(
  "POST /api/ai-reporting/voice-transcriptions/:id/transcribe — fail closed",
  () => {
    let app: Express;
    let token = "";
    let userId = 0;
    const marker = `vitest-vt-${randomUUID().slice(0, 8)}`;
    const createdIds: number[] = [];

    beforeAll(async () => {
      app = await createTestApp();
      token = `vitest-token-${randomUUID()}`;
      const [user] = await db
        .insert(usersTable)
        .values({
          name: `Vitest VoiceTx ${marker}`,
          email: `${marker}@vitest.invalid`,
          username: marker,
          role: "admin",
          permissions: JSON.stringify(["ai_reporting.use", "ai_reporting.configure"]),
          pin: "0000",
          isActive: true,
        })
        .returning();
      userId = user.id;
      await db.insert(portalSessionsTable).values({
        token,
        scope: "staff",
        subjectId: user.id,
        subjectName: user.name,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const rows = await db
        .insert(aiVoiceTranscriptionsTable)
        .values([
          {
            modality: "MRI",
            bodyPart: "Brain",
            status: "pending",
            rawTranscript: null,
            confidenceScore: null,
            correctedText: null,
          },
          {
            modality: "CT",
            bodyPart: "Chest",
            status: "pending",
            rawTranscript: null,
            confidenceScore: null,
            correctedText: null,
          },
        ])
        .returning({ id: aiVoiceTranscriptionsTable.id });
      for (const r of rows) createdIds.push(r.id);
    });

    afterAll(async () => {
      if (createdIds.length) {
        await db
          .delete(aiVoiceTranscriptionsTable)
          .where(inArray(aiVoiceTranscriptionsTable.id, createdIds));
      }
      if (token) await db.delete(portalSessionsTable).where(eq(portalSessionsTable.token, token));
      if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    });

    async function assertTranscribeDisabled(id: number) {
      const before = await db
        .select()
        .from(aiVoiceTranscriptionsTable)
        .where(eq(aiVoiceTranscriptionsTable.id, id))
        .limit(1);
      expect(before[0]?.status).toBe("pending");
      expect(before[0]?.rawTranscript ?? null).toBeNull();
      expect(before[0]?.confidenceScore ?? null).toBeNull();

      const res = await request(app)
        .post(`/api/ai-reporting/voice-transcriptions/${id}/transcribe`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(501);
      expect(res.body.code).toBe("voice_transcription_engine_not_configured");
      expect(String(res.body.error)).toContain("Voice transcription is not configured");
      expect(String(res.body.error)).toContain("No findings or impression were generated");

      const body = JSON.stringify(res.body).toLowerCase();
      expect(body).not.toContain("findings:");
      expect(body).not.toContain("impression:");
      expect(body).not.toContain("normal mri of the brain");
      expect(body).not.toContain("no significant abnormality");
      expect(body).not.toMatch(/"confidence"/);

      const after = await db
        .select()
        .from(aiVoiceTranscriptionsTable)
        .where(eq(aiVoiceTranscriptionsTable.id, id))
        .limit(1);
      expect(after[0]?.status).toBe("pending");
      expect(after[0]?.rawTranscript ?? null).toBeNull();
      expect(after[0]?.confidenceScore ?? null).toBeNull();
      expect(after[0]?.correctedText ?? null).toBeNull();
    }

    it("returns 501 for a near-normal MRI pending record without writing canned text", async () => {
      await assertTranscribeDisabled(createdIds[0]!);
    });

    it("returns 501 for an abnormal/urgent CT pending record without writing canned text", async () => {
      await assertTranscribeDisabled(createdIds[1]!);
    });

    it("keeps list/detail/edit available after disable", async () => {
      const id = createdIds[0]!;

      const list = await request(app)
        .get("/api/ai-reporting/voice-transcriptions")
        .set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body.some((r: { id: number }) => r.id === id)).toBe(true);

      const detail = await request(app)
        .get(`/api/ai-reporting/voice-transcriptions/${id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(id);
      expect(detail.body.status).toBe("pending");

      const patch = await request(app)
        .patch(`/api/ai-reporting/voice-transcriptions/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ correctedText: `manual review ${marker}`, status: "reviewed" });
      expect(patch.status).toBe(200);
      expect(String(patch.body.correctedText ?? "")).toContain(marker);

      await db
        .update(aiVoiceTranscriptionsTable)
        .set({ correctedText: null, status: "pending", updatedAt: new Date() })
        .where(eq(aiVoiceTranscriptionsTable.id, id));
    });
  },
);
