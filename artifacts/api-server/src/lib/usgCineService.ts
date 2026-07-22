/**
 * usgCineService — LIVE bridge for P7 cine key-frame capture (final-integration
 * wiring; not a pure core). Uses the merged P7 core (parseCineClip /
 * selectKeyFrame / cineFrameRef / cinePlaybackCapability) server-side and
 * persists a marked key frame as a DICOM REFERENCE (SOP + frame) in the
 * canonical usg_key_images table — never a pixel blob.
 *
 * Guarantees:
 *   - a key frame is only accepted for a genuine multi-frame cine clip;
 *   - the persisted frame is the real selected frame (never fabricated);
 *   - idempotent per (study, sop, frame).
 */

import { db } from "@workspace/db";
import { usgKeyImagesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { parseCineClip, selectKeyFrame, cineFrameRef, cinePlaybackCapability, cinePlaybackPlan, type CinePlaybackCapability, type CinePlaybackPlan } from "./usgCineClip";

export interface CineKeyFrameContext {
  studyInstanceUID: string;
  patientId?: number | null;
  worklistId?: number | null;
  accessionNumber?: string | null;
  addedBy?: string | null;
  addedByUserId?: number | null;
}

export interface CineDescription {
  isCine: boolean;
  numberOfFrames: number;
  playback: CinePlaybackCapability;
  /** Ordered-frame + timing plan the in-panel player consumes. */
  plan: CinePlaybackPlan;
  suggestedKeyFrame: number | null;
}

/** Describe a multi-frame clip for the UI (playable? how many frames? plan?). */
export function describeCineClip(
  clipDataset: string | Record<string, unknown>,
  opts: { fps?: number | null; maxFrames?: number | null } = {},
): CineDescription {
  const clip = parseCineClip(clipDataset as never);
  return {
    isCine: clip.isCine,
    numberOfFrames: clip.numberOfFrames,
    playback: cinePlaybackCapability(clip),
    plan: cinePlaybackPlan(clip, opts),
    suggestedKeyFrame: clip.isCine ? selectKeyFrame(clip) : null,
  };
}

export interface KeyFrameResult {
  keyImageId: number | null;
  frameNumber: number;
  sopInstanceUID: string | null;
  created: boolean;
}

/**
 * Capture a key frame from a cine clip. Only valid for a real cine clip; the
 * selected frame (explicit or the representative middle frame) is persisted as a
 * DICOM reference. Idempotent per (study, sop, frame).
 */
export async function captureKeyFrame(
  clipDataset: string | Record<string, unknown>,
  ctx: CineKeyFrameContext,
  opts: { selectedFrame?: number | null; label?: string | null } = {},
): Promise<KeyFrameResult | { error: string }> {
  const clip = parseCineClip(clipDataset as never);
  if (!clip.isCine) return { error: "not_cine" };

  const frame = selectKeyFrame(clip, { selectedFrame: opts.selectedFrame });
  const ref = cineFrameRef(clip, frame);
  const sop = ref.sopInstanceUID ?? clip.sopInstanceUID ?? null;

  // Idempotent: skip if this exact (study, sop, frame) key image already exists.
  const existing = await db.select({ id: usgKeyImagesTable.id }).from(usgKeyImagesTable)
    .where(and(
      eq(usgKeyImagesTable.studyInstanceUID, ctx.studyInstanceUID),
      eq(usgKeyImagesTable.sopInstanceUID, sop ?? ""),
      eq(usgKeyImagesTable.frameNumber, frame),
    )).limit(1);
  if (existing[0]) return { keyImageId: existing[0].id, frameNumber: frame, sopInstanceUID: sop, created: false };

  const [row] = await db.insert(usgKeyImagesTable).values({
    studyInstanceUID: ctx.studyInstanceUID,
    patientId: ctx.patientId ?? null,
    worklistId: ctx.worklistId ?? null,
    accessionNumber: ctx.accessionNumber ?? null,
    seriesInstanceUID: clip.seriesInstanceUID ?? null,
    sopInstanceUID: sop,
    frameNumber: frame,                 // the real selected frame
    label: (opts.label ?? `Cine key frame ${frame}/${clip.numberOfFrames}`).slice(0, 200),
    source: "cine",
    addedBy: ctx.addedBy ?? null,
    addedByUserId: ctx.addedByUserId ?? null,
  }).returning({ id: usgKeyImagesTable.id });

  return { keyImageId: row?.id ?? null, frameNumber: frame, sopInstanceUID: sop, created: true };
}

/** List key images for a study (most-recent first). */
export async function listKeyFrames(studyInstanceUID: string) {
  return db.select().from(usgKeyImagesTable)
    .where(eq(usgKeyImagesTable.studyInstanceUID, studyInstanceUID))
    .orderBy(usgKeyImagesTable.sortOrder, usgKeyImagesTable.id);
}
