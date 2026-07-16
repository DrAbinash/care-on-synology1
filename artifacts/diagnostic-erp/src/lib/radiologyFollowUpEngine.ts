// ── Phase 6: Follow-Up Recommendation Engine ──
// Condition-based follow-up recommendations. NO AI.
// Deterministic, rule-based. User must explicitly insert.
//
// Clinical Decision Support PR: the previously hardcoded FOLLOW_UP_DATABASE is
// now DERIVED from the shared Clinical Recommendation Registry
// (clinicalRecommendations.ts), so every follow-up condition has a single
// source of truth. The public API and the derived data shape are unchanged —
// existing consumers (RadiologyAICopilotPanel) keep working verbatim.

import { legacyFollowUpDatabase } from "./clinicalRecommendations";

export interface FollowUpRecommendation {
  condition: string;
  followUp: string;
  interval: string;
  priority: string;
  rationale: string;
}

export const FOLLOW_UP_DATABASE: Record<string, FollowUpRecommendation[]> =
  legacyFollowUpDatabase();

export function getFollowUp(id: string): FollowUpRecommendation[] | undefined {
  return FOLLOW_UP_DATABASE[id];
}

export function getAllFollowUpIds(): string[] {
  return Object.keys(FOLLOW_UP_DATABASE);
}

export function searchFollowUp(query: string): string[] {
  const q = query.toLowerCase();
  return Object.keys(FOLLOW_UP_DATABASE).filter((id) => {
    const items = FOLLOW_UP_DATABASE[id];
    if (!items) return false;
    return items.some((item) =>
      item.condition.toLowerCase().includes(q) ||
      item.followUp.toLowerCase().includes(q)
    );
  });
}
