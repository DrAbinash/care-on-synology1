import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "sa_token";
const POLL_INTERVAL = 30_000; // 30 seconds

export type SuperAdminState = {
  isActive: boolean;
  userName: string | null;
  isLoading: boolean;
  eject: () => void;
};

async function verifyToken(token: string): Promise<{ active: boolean; userName: string | null }> {
  try {
    const res = await fetch("/api/super-admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return { active: false, userName: null };
    return res.json();
  } catch {
    return { active: false, userName: null };
  }
}

export function useSuperAdmin(): SuperAdminState {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  const [isActive, setIsActive] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!!token);

  const check = useCallback(async (currentToken: string | null) => {
    if (!currentToken) {
      setIsActive(false);
      setUserName(null);
      setIsLoading(false);
      return;
    }
    const result = await verifyToken(currentToken);
    setIsActive(result.active);
    setUserName(result.active ? result.userName : null);
    if (!result.active) {
      // Token expired — clear from storage
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
    }
    setIsLoading(false);
  }, []);

  // Initial check
  useEffect(() => {
    check(token);
  }, [token, check]);

  // Poll every 30 seconds while active
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => check(token), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [token, check]);

  // Accept token from the super-admin portal via postMessage.
  // Only messages from the same origin are trusted.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        event.data &&
        event.data.type === "sa_token" &&
        typeof event.data.token === "string" &&
        event.data.token.length > 16
      ) {
        const newToken = event.data.token as string;
        localStorage.setItem(STORAGE_KEY, newToken);
        setToken(newToken);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Listen for storage changes (if another tab logs out)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const newToken = e.newValue;
        setToken(newToken);
        if (!newToken) {
          setIsActive(false);
          setUserName(null);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const eject = useCallback(async () => {
    const currentToken = localStorage.getItem(STORAGE_KEY);
    if (currentToken) {
      try {
        await fetch("/api/super-admin/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: currentToken }),
        });
      } catch { /* ignore */ }
    }
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setIsActive(false);
    setUserName(null);
  }, []);

  return { isActive, userName, isLoading, eject };
}

export function getSuperAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}
