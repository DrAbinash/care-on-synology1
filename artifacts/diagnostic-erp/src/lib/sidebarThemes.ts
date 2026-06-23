export type SidebarThemeId = "navy" | "violet" | "teal" | "charcoal" | "forest";

export type SidebarTheme = {
  id: string;
  label: string;
  gradient: string;
  glow: string;
  bottomHint: string;
  accent: string;
};

export const SIDEBAR_THEMES: SidebarTheme[] = [
  {
    id: "navy",
    label: "Navy Blue",
    gradient: "linear-gradient(160deg, #1e3a8a 0%, #1e2462 100%)",
    glow: "radial-gradient(ellipse at 50% 0%, rgba(99,179,237,0.18) 0%, transparent 70%)",
    bottomHint: "radial-gradient(ellipse at 30% 100%, rgba(124,58,237,0.10) 0%, transparent 70%)",
    accent: "#93c5fd",
  },
  {
    id: "violet",
    label: "Deep Violet",
    gradient: "linear-gradient(160deg, #4c1d95 0%, #2d1b69 100%)",
    glow: "radial-gradient(ellipse at 50% 0%, rgba(196,181,253,0.18) 0%, transparent 70%)",
    bottomHint: "radial-gradient(ellipse at 30% 100%, rgba(99,102,241,0.12) 0%, transparent 70%)",
    accent: "#c4b5fd",
  },
  {
    id: "teal",
    label: "Dark Teal",
    gradient: "linear-gradient(160deg, #134e4a 0%, #0c3a38 100%)",
    glow: "radial-gradient(ellipse at 50% 0%, rgba(94,234,212,0.18) 0%, transparent 70%)",
    bottomHint: "radial-gradient(ellipse at 30% 100%, rgba(20,184,166,0.12) 0%, transparent 70%)",
    accent: "#5eead4",
  },
  {
    id: "charcoal",
    label: "Charcoal",
    gradient: "linear-gradient(160deg, #1f2937 0%, #111827 100%)",
    glow: "radial-gradient(ellipse at 50% 0%, rgba(156,163,175,0.14) 0%, transparent 70%)",
    bottomHint: "radial-gradient(ellipse at 30% 100%, rgba(75,85,99,0.15) 0%, transparent 70%)",
    accent: "#9ca3af",
  },
  {
    id: "forest",
    label: "Forest Green",
    gradient: "linear-gradient(160deg, #14532d 0%, #052e16 100%)",
    glow: "radial-gradient(ellipse at 50% 0%, rgba(134,239,172,0.18) 0%, transparent 70%)",
    bottomHint: "radial-gradient(ellipse at 30% 100%, rgba(34,197,94,0.12) 0%, transparent 70%)",
    accent: "#86efac",
  },
];

export const SIDEBAR_THEME_MAP: Record<string, SidebarTheme> = Object.fromEntries(
  SIDEBAR_THEMES.map((t) => [t.id, t]),
);

export const DEFAULT_THEME = SIDEBAR_THEMES[0];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function darkenHex(hex: string, amount = 0.38): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(Math.round(r * (1 - amount)), Math.round(g * (1 - amount)), Math.round(b * (1 - amount)));
}

function lightenHex(hex: string, amount = 0.55): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  );
}

export function buildCustomTheme(hex: string): SidebarTheme {
  const dark = darkenHex(hex);
  const light = lightenHex(hex);
  return {
    id: `custom:${hex}`,
    label: "Custom",
    gradient: `linear-gradient(160deg, ${hex} 0%, ${dark} 100%)`,
    glow: `radial-gradient(ellipse at 50% 0%, ${light}30 0%, transparent 70%)`,
    bottomHint: `radial-gradient(ellipse at 30% 100%, ${hex}20 0%, transparent 70%)`,
    accent: light,
  };
}

export function resolveTheme(id: string): SidebarTheme {
  if (id.startsWith("custom:")) {
    const hex = id.slice(7);
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return buildCustomTheme(hex);
  }
  return SIDEBAR_THEME_MAP[id] ?? DEFAULT_THEME;
}

export function parseCustomHex(id: string): string | null {
  if (id.startsWith("custom:")) {
    const hex = id.slice(7);
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  }
  return null;
}
