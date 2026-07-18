import { useCallback } from "react";

export function getBaseUrl(): string {
  // 1. Desktop app override (Electron injects this)
  if (typeof window !== "undefined" && (window as any).__CARE_API_DOMAIN__) {
    return `https://${(window as any).__CARE_API_DOMAIN__}`;
  }
  // 2. Build-time environment variable
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  // 3. Fallback
  return "https://localhost";
}

export function useApi(authToken?: string) {
  const request = useCallback(async (method: string, path: string, body?: unknown): Promise<any> => {
    const base = getBaseUrl();
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
  }, [authToken]);

  const get = useCallback((path: string) => request("GET", path), [request]);
  const post = useCallback((path: string, body: unknown) => request("POST", path, body), [request]);
  const put = useCallback((path: string, body: unknown) => request("PUT", path, body), [request]);
  const del = useCallback((path: string) => request("DELETE", path), [request]);

  return { get, post, put, delete: del };
}
