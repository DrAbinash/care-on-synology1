import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "../lib/fetchApi";

const BRIDGE_URL = (() => {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("bridgeUrl") : null;
  return stored ?? "http://127.0.0.1:8765";
})();

export type BridgeStatus = {
  connected: boolean;
  vendor?: string;
  deviceConnected?: boolean;
  deviceModel?: string;
  error?: string;
};

async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BRIDGE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Bridge error ${r.status}`);
  return j as T;
}

export function useBridgeStatus(pollMs = 5000) {
  const [status, setStatus] = useState<BridgeStatus>({ connected: false });
  const ping = useCallback(async () => {
    try {
      const j = await bridgeFetch<{ vendor: string; deviceConnected?: boolean; deviceModel?: string; error?: string }>("/health");
      setStatus({ connected: true, ...j });
    } catch (e) {
      setStatus({ connected: false, error: e instanceof Error ? e.message : "offline" });
    }
  }, []);
  useEffect(() => {
    ping();
    const t = setInterval(ping, pollMs);
    return () => clearInterval(t);
  }, [ping, pollMs]);
  return { status, refresh: ping };
}

export const bridge = {
  url: BRIDGE_URL,
  health: () => bridgeFetch("/health"),

  /**
   * Enroll a fingerprint for the given scope/scopeId.
   *
   * The caller must hold a valid staff session — the function first obtains a
   * short-lived one-time enrollment token from the ERP server (which validates
   * the staff session), then passes it to the local bridge so the ERP can
   * verify that the enrollment was authorised by a logged-in staff member.
   */
  enroll: async (scope: "staff" | "user", scopeId: number, fingerName?: string): Promise<{ ok: boolean; template: { id: number } }> => {
    const { enrollToken } = await fetchApi<{ enrollToken: string }>("/api/bridge/enroll-challenge", {
      method: "POST",
      body: JSON.stringify({ scope, scopeId }),
    });
    return bridgeFetch<{ ok: boolean; template: { id: number } }>("/enroll", {
      method: "POST",
      body: JSON.stringify({ scope, scopeId, fingerName, enrollToken }),
    });
  },

  /**
   * Record a fingerprint attendance punch.
   *
   * The caller must hold a valid staff session — the function first obtains a
   * short-lived one-time punch token from the ERP server (which validates the
   * staff session), then passes it to the local bridge so the ERP can verify
   * that the punch was authorised by a logged-in staff member.
   */
  staffPunch: async (action: "in" | "out"): Promise<{ staff: { id: number; name: string; staffId: string; role: string }; attendance: unknown; action: string; score: number }> => {
    const { punchToken } = await fetchApi<{ punchToken: string }>("/api/bridge/punch-challenge", { method: "POST" });
    return bridgeFetch("/staff-punch", {
      method: "POST",
      body: JSON.stringify({ action, punchToken }),
    });
  },

  /**
   * Authenticate via fingerprint to obtain a user session token.
   *
   * Obtains a short-lived single-use login challenge token from the ERP server
   * (no session required — fingerprint IS the auth), then passes it to the
   * bridge. The two-step flow prevents raw single-fetch scripted login attempts.
   */
  userLogin: async (): Promise<{ token: string; expiresAt: string; user: { id: number; name: string; role: string }; score: number }> => {
    const { loginToken } = await fetchApi<{ loginToken: string }>("/api/bridge/login-challenge", { method: "POST" });
    return bridgeFetch("/user-login", {
      method: "POST",
      body: JSON.stringify({ loginToken }),
    });
  },
};
