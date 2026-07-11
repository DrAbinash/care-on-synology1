import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";

/**
 * useStudyLock — Ticket M1.6A: owns the canonical workspace's study lock.
 *
 * Lifecycle: claims the study when it becomes current (visible in the status
 * bar — never silent), heartbeats on a bounded interval while the lock is
 * held (default TTL 300s → refresh every TTL/3, floor 30s), stops on
 * unmount / study change / finalize, releases explicitly when the page
 * navigates away safely, and treats SERVER EXPIRY as authoritative — a
 * closed browser or dead network simply stops heartbeating and the lock
 * lapses for others to reclaim.
 *
 * Every response is guarded against study switches: a reply for a study
 * that is no longer current is ignored (stale-async, Phase 7).
 */

export type StudyLockStatus =
  | "idle"            // no study / lock feature not engaged yet
  | "claiming"
  | "mine"
  | "locked-by-other"
  | "expired-lost"    // we held it, heartbeat lapsed/expired — reclaim needed
  | "completed"       // study already REPORT_FINAL/DELIVERED — no claim needed
  | "connection-lost" // heartbeat/claim unreachable — lock may expire
  | "not-found";

export interface StudyLockView {
  worklistId: number;
  status: string;
  patientId: number | null;
  assignedRadiologist: string | null;
  lockUserId: number | null;
  lockUserName: string | null;
  lockTime: string | null;
  lockLastActivityAt: string | null;
  lockExpiresAt: string | null;
  lockTtlSeconds: number;
}

interface LockApiResult {
  success: boolean;
  outcome: string;
  lock: StudyLockView | null;
}

const MIN_HEARTBEAT_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 100_000; // TTL default 300s / 3

export function useStudyLock(studyId: number | undefined, opts: { enabled: boolean }) {
  const { enabled } = opts;
  const [status, setStatus] = useState<StudyLockStatus>("idle");
  const [lockView, setLockView] = useState<StudyLockView | null>(null);
  /** The study every in-flight request belongs to — replies for any other
   *  study are dropped (stale-async guard). */
  const activeStudyRef = useRef<number | undefined>(undefined);
  const heartbeatTimerRef = useRef<number | null>(null);
  const statusRef = useRef<StudyLockStatus>("idle");
  statusRef.current = status;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current != null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const applyOutcome = useCallback((forStudy: number, result: LockApiResult | null, transport: "claim" | "heartbeat") => {
    if (activeStudyRef.current !== forStudy) return; // stale — a different study is current now
    if (!result) {
      // Network failure: nothing is known to have changed server-side; the
      // draft text is untouched and expiry remains authoritative.
      setStatus("connection-lost");
      return;
    }
    setLockView(result.lock);
    switch (result.outcome) {
      case "CLAIMED":
      case "ALREADY_OWNED":
      case "EXPIRED_AND_RECLAIMED":
      case "REFRESHED":
        setStatus("mine");
        break;
      case "LOCKED_BY_OTHER":
        setStatus("locked-by-other");
        break;
      case "COMPLETED":
        setStatus("completed");
        break;
      case "NOT_FOUND":
        setStatus("not-found");
        break;
      case "EXPIRED":
      case "NOT_OWNED":
        // Our lock lapsed (heartbeat came back too late). Do NOT auto-steal:
        // the radiologist explicitly reclaims — someone else may be mid-claim.
        setStatus(transport === "heartbeat" ? "expired-lost" : "idle");
        break;
      default:
        setStatus("connection-lost");
    }
  }, []);

  const claim = useCallback(async (forStudy?: number) => {
    const target = forStudy ?? activeStudyRef.current;
    if (target == null) return;
    setStatus((prev) => (prev === "mine" ? prev : "claiming"));
    let result: LockApiResult | null = null;
    try {
      // Typed outcomes always arrive on 200 (transport errors only throw).
      result = await api.post<LockApiResult>(`/api/radiology/worklist-lock/${target}/claim`, {});
    } catch {
      result = null;
    }
    applyOutcome(target, result, "claim");
  }, [applyOutcome]);

  const heartbeat = useCallback(async () => {
    const target = activeStudyRef.current;
    if (target == null || statusRef.current !== "mine") return;
    let result: LockApiResult | null = null;
    try {
      result = await api.post<LockApiResult>(`/api/radiology/worklist-lock/${target}/heartbeat`, {});
    } catch {
      result = null;
    }
    applyOutcome(target, result, "heartbeat");
  }, [applyOutcome]);

  /** Explicit safe release (navigation away). Fire-and-forget: on failure the
   *  TTL expiry cleans up; nothing else depends on the response. */
  const release = useCallback((forStudy?: number) => {
    const target = forStudy ?? activeStudyRef.current;
    if (target == null || statusRef.current !== "mine") return;
    void api.post(`/api/radiology/worklist-lock/${target}/release`, {}).catch(() => { /* expiry is authoritative */ });
  }, []);

  const forceRelease = useCallback(async (reason: string | null): Promise<boolean> => {
    const target = activeStudyRef.current;
    if (target == null) return false;
    try {
      await api.post(`/api/radiology/worklist-lock/${target}/force-release`, { reason });
      await claim(target);
      return true;
    } catch {
      return false;
    }
  }, [claim]);

  // Claim on study entry; stop + reset on study change/unmount.
  useEffect(() => {
    activeStudyRef.current = studyId;
    stopHeartbeat();
    setLockView(null);
    if (studyId == null || !enabled) {
      setStatus("idle");
      return;
    }
    void claim(studyId);
    return () => {
      stopHeartbeat();
    };
  }, [studyId, enabled, claim, stopHeartbeat]);

  // Bounded heartbeat while (and only while) we hold the lock.
  useEffect(() => {
    stopHeartbeat();
    if (status !== "mine" || !enabled) return;
    const ttlSeconds = lockView?.lockTtlSeconds;
    const intervalMs = ttlSeconds && Number.isFinite(ttlSeconds)
      ? Math.max(MIN_HEARTBEAT_MS, Math.floor((ttlSeconds * 1000) / 3))
      : DEFAULT_HEARTBEAT_MS;
    heartbeatTimerRef.current = window.setInterval(() => { void heartbeat(); }, intervalMs);
    return stopHeartbeat;
  }, [status, enabled, lockView?.lockTtlSeconds, heartbeat, stopHeartbeat]);

  return {
    status,
    lockView,
    ownerName: lockView?.lockUserName ?? null,
    expiresAt: lockView?.lockExpiresAt ?? null,
    claim: () => claim(),
    release,
    forceRelease,
  };
}
