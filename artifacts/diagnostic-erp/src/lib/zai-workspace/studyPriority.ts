/**
 * studyPriority — the ONE client-side triage rank for workspace studies.
 *
 * The server computes radiology_studies.priority from
 * api-server/src/lib/studyPriorityEngine.ts (PRIORITY_RANK: stat 5 >
 * emergency 4 > urgent 3 > vip 2 > routine 1) and the PACS worklist SQL
 * orders rows by exactly that case expression (#1165). Every client-side
 * surface that RANKS a queue row — the workspace's auto-open, the
 * 80%-findings preload, the store's advanceToNextStudy — must mirror the
 * same doctrine, or the workspace's own idea of "what is next" diverges
 * from the list the radiologist just read. Here the rank is expressed
 * low-first (lower sorts earlier) to match the sort comparators that
 * consume it.
 */
import type { Priority } from "./types";

/** Rank mirror of the server's PRIORITY_RANK (lower = reported first). */
export const STUDY_PRIORITY_RANK: Record<Priority, number> = {
  stat: 0,
  emergency: 1,
  urgent: 2,
  vip: 3,
  routine: 4,
};

/**
 * Tolerant rank for values that did not come from a normalized Study —
 * raw API rows, localStorage payloads, stale caches. Unknown, null or
 * empty reads as the routine tier, which is what the server's SQL does
 * for a NULL priority (ELSE 1) and what every previous local map did
 * with its `?? last-tier` fallback. Case-insensitive because the stored
 * vocabulary is lowercase but hand-edited settings rows have been seen
 * in uppercase.
 */
export function studyPriorityRank(priority: string | null | undefined): number {
  const p = (priority ?? "").trim().toLowerCase();
  const rank = (STUDY_PRIORITY_RANK as Record<string, number>)[p];
  return Number.isFinite(rank) ? rank : STUDY_PRIORITY_RANK.routine;
}
