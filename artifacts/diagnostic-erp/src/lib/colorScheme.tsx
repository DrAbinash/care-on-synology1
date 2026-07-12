// Dark/Light/System color-scheme engine.
//
// Distinct from src/lib/userTheme.ts (a per-user sidebar accent-color skin,
// e.g. "navy") — this controls the actual light/dark CSS variable set
// (src/index.css ":root" vs ".dark") via the "dark" class already wired
// into every dark: Tailwind utility across the app. Persisted per-browser
// (not per-user) since it's a device/display preference, same as OS-level
// dark mode.
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ColorScheme = "light" | "dark" | "system";
const STORAGE_KEY = "care-color-scheme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(scheme: ColorScheme): boolean {
  return scheme === "system" ? systemPrefersDark() : scheme === "dark";
}

function applyIsDark(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}

function readStoredScheme(): ColorScheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore — private browsing / storage disabled */ }
  return "system";
}

type ColorSchemeContextValue = {
  scheme: ColorScheme;
  isDark: boolean;
  setScheme: (s: ColorScheme) => void;
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>(() => readStoredScheme());
  const [isDark, setIsDark] = useState(() => resolveIsDark(scheme));

  // Apply immediately on mount and whenever `scheme` changes.
  useEffect(() => {
    const dark = resolveIsDark(scheme);
    setIsDark(dark);
    applyIsDark(dark);
  }, [scheme]);

  // While in "system" mode, track OS-level changes live (no reload needed).
  useEffect(() => {
    if (scheme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setIsDark(mq.matches);
      applyIsDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [scheme]);

  const setScheme = (s: ColorScheme) => {
    setSchemeState(s);
    try { localStorage.setItem(STORAGE_KEY, s); } catch { /* ignore */ }
  };

  const value = useMemo(() => ({ scheme, isDark, setScheme }), [scheme, isDark]);

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>;
}

export function useColorScheme(): ColorSchemeContextValue {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) throw new Error("useColorScheme() must be used inside <ColorSchemeProvider>");
  return ctx;
}
