/**
 * Quiet, human-readable save status for the Reporting Workspace sticky bar.
 * Pure formatter — does not start timers or trigger saves.
 */

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export type HumanSaveTone = "neutral" | "green" | "amber" | "red";

export type HumanSaveStatus = {
  label: string;
  tone: HumanSaveTone;
};

export type HumanSaveStatusInput = {
  autoSaveStatus: AutoSaveStatus;
  lastSavedAt: Date | number | null;
  /** Wall clock for relative labels (injectable for tests). */
  nowMs: number;
  isDirty: boolean;
  isOnline: boolean;
  /** True when a local draft backup / rescue copy is present. */
  hasOfflineCopy: boolean;
};

function relativeSavedLabel(savedAtMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - savedAtMs) / 1000));
  if (sec < 5) return "Saved";
  if (sec < 60) return `Saved ${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Saved ${min} min ago`;
  const hrs = Math.floor(min / 60);
  return `Saved ${hrs} hr ago`;
}

/**
 * Priority:
 * 1. Saving…
 * 2. Save failed (sticky until a later successful save clears autoSaveStatus)
 * 3. Offline copy saved
 * 4. Saved / Saved N sec ago
 * 5. empty (no status to show)
 */
export function formatHumanSaveStatus(input: HumanSaveStatusInput): HumanSaveStatus | null {
  if (input.autoSaveStatus === "saving") {
    return { label: "Saving…", tone: "amber" };
  }
  if (input.autoSaveStatus === "error") {
    return { label: "Save failed", tone: "red" };
  }
  if (!input.isOnline && input.hasOfflineCopy) {
    return { label: "Offline copy saved", tone: "amber" };
  }
  if (input.autoSaveStatus === "saved" || (input.lastSavedAt && !input.isDirty)) {
    const at =
      input.lastSavedAt == null
        ? null
        : typeof input.lastSavedAt === "number"
          ? input.lastSavedAt
          : input.lastSavedAt.getTime();
    if (at == null) return { label: "Saved", tone: "green" };
    return { label: relativeSavedLabel(at, input.nowMs), tone: "green" };
  }
  if (!input.isOnline && input.isDirty) {
    return input.hasOfflineCopy
      ? { label: "Offline copy saved", tone: "amber" }
      : null;
  }
  return null;
}

export function saveStatusDotClass(tone: HumanSaveTone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-500";
    case "amber":
      return "bg-amber-500";
    case "red":
      return "bg-red-500";
    default:
      return "bg-slate-400";
  }
}
