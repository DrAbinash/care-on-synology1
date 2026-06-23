import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useApi } from "@/hooks/useApi";

type AuthUser = {
  phone: string;
  name: string;
};

const AuthContext = createContext<{
  user: AuthUser | null;
  isLoading: boolean;
  login: (phone: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const api = useApi();

  const loadUser = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("@care_auth");
      if (stored) setUser(JSON.parse(stored));
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  React.useEffect(() => { loadUser(); }, [loadUser]);

  const login = useCallback(async (phone: string, name: string) => {
    await api.post("/api/public/booking/verify-otp", { phone, name });
    const u = { phone, name };
    await AsyncStorage.setItem("@care_auth", JSON.stringify(u));
    setUser(u);
  }, [api]);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem("@care_auth");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
