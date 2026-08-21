/**
 * Canonical overnight queue classification — ONE semantics for UI, verify, cron, heartbeat.
 * Consumers must not invent alternate held/eligible counts.
 */
import { jobBacklogCounts } from "../radiologyJobs";
import {
  deriveRadiologyJobConsumerHealth,
  getRadiologyJobConsumerHeartbeat,
} from "../radiologyJobConsumerHeartbeat";
import { getOvernightOpsControls } from "./clinicalConfigService";
import { countLegacyBacklogHold, type LegacyBacklogCounts } from "./legacyBacklogHold";
import {
  resolveLegacyHoldClaimFilter,
  type OvernightOpsControls,
} from "./overnightOpsControls";
import { AI_SHADOW_PIPELINE_JOB } from "./shadowPipeline";

export interface OvernightQueueClassification {
  ops: OvernightOpsControls;
  held: boolean;
  holdBefore: string | null;
  explicitlyReleased: boolean;
  heldLegacyPending: number;
  heldLegacyRetrying: number;
  eligiblePending: number;
  eligibleRetrying: number;
  /** Convenience: held pending+retrying */
  heldLegacyDue: number;
  /** Convenience: eligible pending+retrying due */
  eligibleDue: number;
  running: number;
  queueDepth: number;
  releasedAllowlistSize: number;
  legacy: LegacyBacklogCounts;
  claimFilter: { holdBefore: string; releasedJobIds: number[] } | null;
}

/**
 * Authoritative held/eligible/running snapshot used by Draft Automation,
 * Verify-before-redeploy, overnight-diagnostics, and cron due counts.
 */
export async function getOvernightQueueClassification(): Promise<OvernightQueueClassification> {
  const ops = await getOvernightOpsControls();
  const legacy = await countLegacyBacklogHold(ops);
  const backlog = await jobBacklogCounts([AI_SHADOW_PIPELINE_JOB]);
  const claimFilter = resolveLegacyHoldClaimFilter(ops);
  return {
    ops,
    held: legacy.held,
    holdBefore: legacy.holdBefore,
    explicitlyReleased: ops.legacyHoldExplicitlyReleased === true,
    heldLegacyPending: legacy.heldPending,
    heldLegacyRetrying: legacy.heldRetrying,
    eligiblePending: legacy.eligiblePending,
    eligibleRetrying: legacy.eligibleRetrying,
    heldLegacyDue: legacy.heldPending + legacy.heldRetrying,
    eligibleDue: legacy.eligiblePending + legacy.eligibleRetrying,
    running: backlog.running,
    queueDepth: backlog.pending,
    releasedAllowlistSize: legacy.releasedAllowlistSize,
    legacy,
    claimFilter,
  };
}

/** Shared consumer health derivation from the canonical classification. */
export function consumerHealthFromClassification(
  c: OvernightQueueClassification,
  nightWindow = true,
) {
  const hb = getRadiologyJobConsumerHeartbeat();
  return deriveRadiologyJobConsumerHealth(hb, {
    queueDepth: c.queueDepth,
    running: c.running,
    nightWindow,
    eligibleDueAi: c.eligibleDue,
    heldLegacyDue: c.heldLegacyDue,
  });
}
