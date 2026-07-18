import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useApi } from "@/hooks/useApi";

/**
 * Patient auth backed by real server-side sessions.
 *
 * Login is a two-step OTP flow against /api/patient/*: the server delivers a
 * 6-digit code via WhatsApp (never echoed in the API response) and a correct
 * code mints a bearer session token, which is stored here and attached to
 * patient data requests (my-bookings / my-reports) via usePatientApi().
 */

type AuthUser = {
  phone: string;
  name: string;
  token: string;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  isLoading: boolean;
  /** Step 1: request an OTP for this phone (delivered on WhatsApp). */
  requestOtp: (phone: string) => Promise<void>;
  /** Step 2: verify the code; on success the session is stored. */
  verifyOtp: (phone: string, code: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Drop the stored session without a server call (e.g. after a 401). */
  clearSession: () => Promise<void>;
} | null>(null);

const STORAGE_KEY = "@care_auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const api = useApi();
  const authedApi = useApi(user?.token);

  const loadUser = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AuthUser>;
        // Sessions from the pre-token era ({phone, name} only) can't call the
        // authenticated endpoints — treat them as logged out.
        if (parsed.token && parsed.phone) {
          setUser(parsed as AuthUser);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  React.useEffect(() => { loadUser(); }, [loadUser]);

  const requestOtp = useCallback(async (phone: string) => {
    await api.post("/api/patient/send-otp", { phone });
  }, [api]);

  const verifyOtp = useCallback(async (phone: string, code: string, name: string) => {
    const res = await api.post("/api/patient/verify-otp", { phone, code, name }) as {
      verified: boolean; token: string; phone: string; name: string;
    };
    if (!res.token) throw new Error("Login failed. Please try again.");
    const u: AuthUser = { phone: res.phone, name: res.name || name, token: res.token };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
  }, [api]);

  const clearSession = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    // Best-effort server-side revocation; local clear always succeeds.
    if (user?.token) {
      try { await authedApi.post("/api/patient/logout", {}); } catch { /* ignore */ }
    }
    await clearSession();
  }, [user, authedApi, clearSession]);

  return (
    <AuthContext.Provider value={{ user, isLoading, requestOtp, verifyOtp, logout, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** API client with the patient session token attached as a Bearer header. */
export function usePatientApi() {
  const { user } = useAuth();
  return useApi(user?.token);
}
