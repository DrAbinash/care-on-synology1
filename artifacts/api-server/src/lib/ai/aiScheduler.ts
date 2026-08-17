/**
 * AI Scheduler — pure decision logic (Phase P3 / Gate G10).
 *
 * The scheduler is a POLICY layer above the existing radiology job engine — it
 * decides WHAT to enqueue and WHEN across the five processing modes; it never
 * contains its own queue or worker (enqueue goes through enqueueAiShadowJob →
 * the existing radiologyJobs runner). No DB — unit-tested directly.
 */
export type ModalityMode = "immediate" | "night_batch" | "manual" | "disabled";
export type Priority = "stat" | "emergency" | "vip" | "routine";
/** When DICOM arrives vs only inside the configured night window. */
export type DraftTiming = "on_arrival" | "scheduled";

export interface SchedulerConfig {
  draftTiming: DraftTiming;
  nightStart: string; // "HH:MM" local
  nightEnd: string;
  quietStart: string;
  quietEnd: string;
  maxConcurrentJobs: number;
  gpuLimitPercent: number;
  cpuLimitPercent: number;
  skipFinalizedReports: boolean;
  skipUnchangedStudies: boolean;
  /** all = no date filter (historical default). today ≠ last_24h. */
  studyAgeWindow: "all" | "today" | "last_24h" | "last_48h" | "last_3d" | "last_7d" | "custom";
  studyAgeCustomFrom: Date | string | null;
  studyAgeCustomTo: Date | string | null;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Window membership, handling windows that wrap past midnight. */
export function inWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

export function isWithinNightWindow(nowMinutes: number, cfg: SchedulerConfig): boolean {
  return inWindow(nowMinutes, cfg.nightStart, cfg.nightEnd);
}
export function isQuietHours(nowMinutes: number, cfg: SchedulerConfig): boolean {
  return inWindow(nowMinutes, cfg.quietStart, cfg.quietEnd);
}

export interface SchedulingInput {
  modalityMode: ModalityMode;
  priority: Priority;
  nowMinutes: number;
  isFinalized: boolean;
  isUnchanged: boolean;
  manualRequest?: boolean;
}

export interface SchedulingDecision {
  enqueue: boolean;
  mode: "immediate" | "night_batch" | "manual";
  reason: string;
}

/**
 * Decide whether/when a study should be AI-processed. STAT/emergency always run
 * immediately (even in quiet hours). Otherwise: immediate modality runs now but
 * defers to night batch during quiet hours; night_batch defers; manual/disabled
 * never auto-enqueue. Finalized and unchanged studies are skipped per config.
 */
export function decideScheduling(inp: SchedulingInput, cfg: SchedulerConfig): SchedulingDecision {
  // Disabled modalities never enqueue — even manual/on-demand requests.
  // Malformed API callers must not bypass modality policy.
  if (inp.modalityMode === "disabled") {
    return { enqueue: false, mode: "manual", reason: "modality AI disabled" };
  }
  if (inp.manualRequest) return { enqueue: true, mode: "immediate", reason: "manual/on-demand request" };
  if (cfg.skipFinalizedReports && inp.isFinalized) return { enqueue: false, mode: "manual", reason: "skip: report finalized" };
  if (cfg.skipUnchangedStudies && inp.isUnchanged) return { enqueue: false, mode: "manual", reason: "skip: study unchanged" };

  const stat = inp.priority === "stat" || inp.priority === "emergency";
  const quiet = isQuietHours(inp.nowMinutes, cfg);

  switch (inp.modalityMode) {
    case "manual":
      return { enqueue: false, mode: "manual", reason: "modality manual-only" };
    case "immediate":
      // On-arrival mode: never park routine work for quiet hours — draft as soon
      // as DICOM is stable. Quiet-hour deferral only applies when timing is scheduled
      // (or legacy immediate without on_arrival).
      if (cfg.draftTiming === "on_arrival") {
        return { enqueue: true, mode: "immediate", reason: stat ? "STAT/emergency immediate" : "on DICOM arrival" };
      }
      if (quiet && !stat) return { enqueue: false, mode: "night_batch", reason: "quiet hours — deferred to night batch" };
      return { enqueue: true, mode: "immediate", reason: stat ? "STAT/emergency immediate" : "immediate" };
    case "night_batch":
      if (stat) return { enqueue: true, mode: "immediate", reason: "STAT/emergency overrides night-batch" };
      // Inside the configured night window the night cron (and any run that
      // happens to land here) must actually enqueue — otherwise night_batch
      // modalities would never process.
      if (isWithinNightWindow(inp.nowMinutes, cfg)) {
        return { enqueue: true, mode: "night_batch", reason: "night batch window" };
      }
      return { enqueue: false, mode: "night_batch", reason: "queued for night batch window" };
    default:
      return { enqueue: false, mode: "manual", reason: "unknown modality mode" };
  }
}

export interface ResourceLoad {
  runningJobs: number;
  gpuPercent?: number;
  cpuPercent?: number;
}

/** Admission control: refuse to start a new job past the concurrency or resource
 *  ceilings. Resource percentages are optional (supplied by staging metrics). */
export function admitJob(load: ResourceLoad, cfg: SchedulerConfig): { admit: boolean; reason: string } {
  if (load.runningJobs >= cfg.maxConcurrentJobs) return { admit: false, reason: `at max concurrency (${load.runningJobs}/${cfg.maxConcurrentJobs})` };
  if (load.gpuPercent != null && load.gpuPercent > cfg.gpuLimitPercent) return { admit: false, reason: `GPU ${load.gpuPercent}% > limit ${cfg.gpuLimitPercent}%` };
  if (load.cpuPercent != null && load.cpuPercent > cfg.cpuLimitPercent) return { admit: false, reason: `CPU ${load.cpuPercent}% > limit ${cfg.cpuLimitPercent}%` };
  return { admit: true, reason: "admitted" };
}
