// ============================================================================
// Enqueue diagnostic_electronic_film.available to HOPE via integration_outbox.
// ============================================================================
import { and, eq, isNotNull } from "drizzle-orm";
import { db, diagnosticReferralsTable, electronicFilmArtifactsTable } from "@workspace/db";
import { enqueueOutboxEvent } from "../integration/outbox";
import { buildFilmPublicUrl } from "./storage";
import { integrationEnabled } from "../integration/scheduler";

export async function enqueueElectronicFilmToHope(
  artifactId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; skipped?: string; outboxId?: number }> {
  if (!opts.force && !(await integrationEnabled())) {
    return { ok: false, skipped: "integration_disabled" };
  }

  const [art] = await db
    .select()
    .from(electronicFilmArtifactsTable)
    .where(eq(electronicFilmArtifactsTable.id, artifactId))
    .limit(1);
  if (!art) return { ok: false, skipped: "artifact_not_found" };
  if (!art.studyId) return { ok: false, skipped: "not_matched" };
  if (!art.orderId) return { ok: false, skipped: "no_order_link" };
  if (art.ingestStatus !== "STORED" && art.ingestStatus !== "HOPE_PENDING") {
    return { ok: false, skipped: "not_stored" };
  }
  if (art.hopeDeliveryStatus === "SENT" && !opts.force) {
    return { ok: true, skipped: "already_sent" };
  }

  const [ref] = await db
    .select()
    .from(diagnosticReferralsTable)
    .where(and(isNotNull(diagnosticReferralsTable.careOrderId), eq(diagnosticReferralsTable.careOrderId, art.orderId!)))
    .limit(1);
  if (!ref) return { ok: false, skipped: "no_referral_link" };

  const filmUrl = buildFilmPublicUrl(art.accessToken ?? "");
  const idempotencyKey = `diagnostic_electronic_film.available:${ref.referralUuid}:${art.id}:v${art.version}`;

  const result = await db.transaction(async (tx) => {
    const ev = await enqueueOutboxEvent(tx, {
      eventType: "diagnostic_electronic_film.available",
      idempotencyKey,
      correlationId: art.correlationId ?? ref.referralUuid,
      aggregateId: ref.referralUuid,
      partnerId: ref.createdByPartnerId ?? null,
      payload: {
        referralUuid: ref.referralUuid,
        careOrderId: ref.careOrderId,
        careStudyId: art.studyId,
        careFilmArtifactId: art.id,
        filmVersion: art.version,
        accessionNumber: art.accessionNumber,
        studyInstanceUID: art.studyInstanceUid,
        modality: art.modality,
        studyDescription: art.studyDescription,
        studyDate: art.studyDate,
        mimeType: art.mimeType,
        artifactHash: art.artifactHash,
        filmToken: art.accessToken,
        filmUrl,
        sourceJobKey: art.sourceJobKey,
        matchMethod: art.matchMethod,
      },
    });

    await tx
      .update(electronicFilmArtifactsTable)
      .set({
        ingestStatus: "HOPE_PENDING",
        hopeDeliveryStatus: "PENDING",
        emittedOutboxId: ev.id,
        updatedAt: new Date(),
      })
      .where(eq(electronicFilmArtifactsTable.id, art.id));

    return ev;
  });

  return { ok: true, outboxId: result.id };
}

export async function markFilmHopeSent(artifactId: number): Promise<void> {
  await db
    .update(electronicFilmArtifactsTable)
    .set({
      ingestStatus: "HOPE_SENT",
      hopeDeliveryStatus: "SENT",
      hopeSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(electronicFilmArtifactsTable.id, artifactId));
}

export async function markFilmHopeFailed(artifactId: number, error: string): Promise<void> {
  await db
    .update(electronicFilmArtifactsTable)
    .set({
      hopeDeliveryStatus: "FAILED",
      errorMessage: error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(electronicFilmArtifactsTable.id, artifactId));
}
