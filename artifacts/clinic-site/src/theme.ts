import type { SiteSettings } from "./types";

// Convert "#RRGGBB" to "H S% L%" tuple for CSS hsl()
function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const FONT_MAP: Record<string, string> = {
  inter: "'Inter', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  lato: "'Lato', system-ui, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  opensans: "'Open Sans', system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

const FONT_GOOGLE: Record<string, string> = {
  inter: "Inter:wght@400;500;600;700;800",
  poppins: "Poppins:wght@400;500;600;700;800",
  roboto: "Roboto:wght@400;500;700",
  lato: "Lato:wght@400;700;900",
  montserrat: "Montserrat:wght@400;500;600;700;800",
  opensans: "Open+Sans:wght@400;600;700",
  playfair: "Playfair+Display:wght@400;600;700;800",
  merriweather: "Merriweather:wght@400;700;900",
};

function loadGoogleFont(key: string) {
  const spec = FONT_GOOGLE[key];
  if (!spec) return;
  const id = `gf-${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

export function applyTheme(s: SiteSettings) {
  const root = document.documentElement.style;
  const primary = hexToHsl(s.primaryColor ?? "") ?? "200 95% 42%";
  const bg = hexToHsl(s.backgroundColor ?? "") ?? "0 0% 100%";
  // Pick readable text color based on background lightness
  const bgLight = parseInt((bg.match(/(\d+)%\s*$/)?.[1] ?? "100"), 10);
  const fg = bgLight > 55 ? "222 47% 11%" : "0 0% 100%";
  root.setProperty("--site-primary", primary);
  root.setProperty("--site-primary-fg", "0 0% 100%");
  root.setProperty("--site-bg", bg);
  root.setProperty("--site-fg", fg);

  const fontKey = ((s.fontHeading as string) || "inter").toLowerCase().replace(/[^a-z]/g, "");
  const fontStack = FONT_MAP[fontKey] ?? FONT_MAP.inter;
  loadGoogleFont(fontKey);
  root.setProperty("--site-font", fontStack);
}

export function buttonClass(s: SiteSettings, variant: "primary" | "outline" = "primary"): string {
  const base = variant === "primary" ? "btn-primary" : "btn-outline";
  const style = (s.buttonStyle || "rounded").toLowerCase();
  if (style === "pill" || style === "rounded-full") return `${base} btn-rounded`;
  if (style === "square") return `${base} btn-square`;
  return base;
}
