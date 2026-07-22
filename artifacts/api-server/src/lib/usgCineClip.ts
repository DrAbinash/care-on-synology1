/**
 * usgCineClip — deterministic cine-loop (multi-frame US) modelling (P7.1).
 *
 * Parses a DICOM multi-frame ultrasound instance into a cine-clip descriptor,
 * picks a representative/key frame, and produces a canonical frame reference
 * that REUSES the P3 provenance model (`SrImageRef` sopInstanceUID + frame) so a
 * cine-derived key frame navigates and audits exactly like any other measured
 * frame — no parallel image-reference model. Pure + testable.
 *
 * Honesty: a clip is recognised as cine only when it genuinely carries more than
 * one frame; the frame count and rate are read from the dataset and NEVER
 * fabricated (absent → null). A single-frame image is not a cine loop.
 */

import type { SrImageRef } from "./usgSrContentTree";

/** Minimal DICOM-JSON accessor shape ({ tag: { Value: [...] } }). */
type Json = Record<string, { Value?: unknown[] } | undefined>;

/** US Multi-frame Image Storage. */
export const US_MULTIFRAME_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.3.1";

export interface CineClip {
  studyInstanceUID: string | null;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  sopClassUID: string | null;
  numberOfFrames: number;         // > 1 for a real cine clip
  frameRate: number | null;       // fps, from CineRate or 1000/FrameTime
  durationSeconds: number | null; // numberOfFrames / frameRate
  isCine: boolean;
}

function str(ds: Json, tag: string): string | null {
  const v = ds[tag]?.Value?.[0];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}
function num(ds: Json, tag: string): number | null {
  const v = ds[tag]?.Value?.[0];
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a DICOM-JSON multi-frame US instance into a CineClip. Returns a
 * descriptor even for single-frame instances (isCine=false) so callers can tell
 * "not a cine" from "unparseable".
 */
export function parseCineClip(ds: Json): CineClip {
  const numberOfFrames = num(ds, "00280008") ?? 1;         // NumberOfFrames
  const cineRate = num(ds, "00180040");                    // CineRate (fps)
  const recFps = num(ds, "00082144");                      // RecommendedDisplayFrameRate
  const frameTimeMs = num(ds, "00181063");                 // FrameTime (ms/frame)
  let frameRate: number | null = cineRate ?? recFps ?? (frameTimeMs && frameTimeMs > 0 ? 1000 / frameTimeMs : null);
  if (frameRate != null) frameRate = Math.round(frameRate * 100) / 100;

  const frames = Number.isFinite(numberOfFrames) && numberOfFrames > 0 ? Math.floor(numberOfFrames) : 1;
  const isCine = frames > 1;
  const durationSeconds = isCine && frameRate && frameRate > 0
    ? Math.round((frames / frameRate) * 100) / 100
    : null;

  return {
    studyInstanceUID: str(ds, "0020000D"),
    seriesInstanceUID: str(ds, "0020000E"),
    sopInstanceUID: str(ds, "00080018"),
    sopClassUID: str(ds, "00080016"),
    numberOfFrames: frames,
    frameRate,
    durationSeconds,
    isCine,
  };
}

export interface KeyFrameOptions {
  /** An explicitly chosen frame (1-based). Clamped to [1, numberOfFrames]. */
  selectedFrame?: number | null;
}

/**
 * Pick a representative key frame (1-based). An explicit selection wins (clamped
 * into range); otherwise the middle frame — deterministic, never random.
 */
export function selectKeyFrame(clip: CineClip, opts: KeyFrameOptions = {}): number {
  const n = Math.max(1, clip.numberOfFrames);
  if (opts.selectedFrame != null && Number.isFinite(opts.selectedFrame)) {
    return Math.min(n, Math.max(1, Math.floor(opts.selectedFrame)));
  }
  return Math.max(1, Math.ceil(n / 2));
}

/**
 * Canonical frame reference for a cine key frame — the SAME `SrImageRef` shape
 * P3 uses, so cine key frames reuse the measurement-provenance + viewer path.
 */
export function cineFrameRef(clip: CineClip, frameNumber: number): SrImageRef {
  return {
    sopClassUID: clip.sopClassUID ?? undefined,
    sopInstanceUID: clip.sopInstanceUID ?? undefined,
    frameNumber: clip.isCine ? frameNumber : null,
  };
}

export interface CinePlaybackCapability {
  canPlay: boolean;
  canStepFrame: boolean;
  frameCount: number;
  fps: number | null;
  durationSeconds: number | null;
}

/** Honest playback capability — only what the clip genuinely supports. */
export function cinePlaybackCapability(clip: CineClip): CinePlaybackCapability {
  return {
    canPlay: clip.isCine,
    canStepFrame: clip.isCine,
    frameCount: clip.numberOfFrames,
    fps: clip.isCine ? clip.frameRate : null,
    durationSeconds: clip.durationSeconds,
  };
}
