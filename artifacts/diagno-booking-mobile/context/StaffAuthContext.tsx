import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useApi } from "@/hooks/useApi";

type StaffUser = {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  permissions: string[];
  maxDiscount: number | null;
  photoDataUrl: string | null;
};

type StaffSession = {
  token: string;
  user: StaffUser;
};

const StaffAuthContext = createContext<{
  session: StaffSession | null;
  isLoading: boolean;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function StaffAuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const api = useApi();

  const loadSession = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("@care_staff_session");
      if (stored) setSession(JSON.parse(stored));
    } catch { /* ignore */ }
    setIsLoading(false);
  }, []);

  React.useEffect(() => { loadSession(); }, [loadSession]);

  const login = useCallback(async (username: string, pin: string) => {
    const data = await api.post("/api/portal/staff-login", { username, pin });
    if (!data.token) throw new Error("Invalid credentials");
    const sess: StaffSession = { token: data.token, user: data.user };
    await AsyncStorage.setItem("@care_staff_session", JSON.stringify(sess));
    setSession(sess);
  }, [api]);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem("@care_staff_session");
    setSession(null);
  }, []);

  return (
    <StaffAuthContext.Provider value={{ session, isLoading, login, logout }}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth() {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) throw new Error("useStaffAuth must be used inside StaffAuthProvider");
  return ctx;
}

export function useStaffApi() {
  const { session } = useStaffAuth();
  return useApi(session?.token);
}
