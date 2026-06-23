export type SiteSettings = {
  id: number;
  siteTitle: string;
  tagline: string;
  about: string;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  whatsappEnabled: boolean;
  whatsappGreeting: string;
  address: string;
  registeredAddress: string;
  faviconUrl: string;
  logoUrl: string;
  themeId: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  fontHeading: string;
  fontBody: string;
  buttonStyle: string;
  customDomain: string;
  domainVerified: boolean;
  seoMetaTitle: string;
  seoMetaDescription: string;
  seoKeywords: string;
  seoOgImage: string;
  googleAnalyticsId: string;
  googleTagManagerId: string;
  googleAdsenseId: string;
  metaPixelId: string;
  facebookMetaTag: string;
  pinterestMetaTag: string;
  customHeadHtml: string;
  socialLinks: string;
  isPublished: boolean;
  publishedRevision: number;
  lastPublishedAt: string | null;
};

export type SectionType =
  | "header" | "hero" | "services" | "appointment" | "reviews"
  | "contact" | "connect" | "subscribe" | "faq" | "gallery"
  | "custom_html" | "footer"
  | "why_choose_us" | "technology" | "health_packages" | "stats";

export type Section = {
  id: string;
  type: SectionType;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type Page = {
  id: number;
  slug: string;
  title: string;
  status: string;
  showInNav: boolean;
  orderIndex: number;
  sections: string;
  seoMetaTitle: string;
  seoMetaDescription: string;
};

export type Faq = { id: number; question: string; answer: string; orderIndex: number; enabled: boolean };
export type Photo = { id: number; url: string; alt: string; category: string; orderIndex: number };
export type Popup = {
  id: number; name: string; title: string; body: string;
  ctaLabel: string; ctaUrl: string;
  triggerType: string; triggerValue: number;
  showOnPages: string; enabled: boolean;
};

export function parseSections(raw: string): Section[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => s && typeof s === "object").map((s) => ({
      id: typeof s.id === "string" ? s.id : Math.random().toString(36).slice(2, 10),
      type: (s.type ?? "hero") as SectionType,
      enabled: s.enabled !== false,
      config: typeof s.config === "object" && s.config != null ? s.config : {},
    }));
  } catch { return []; }
}

export function parseSocial(raw: string): Record<string, string> {
  try { const o = JSON.parse(raw || "{}"); return typeof o === "object" && o != null ? o : {}; } catch { return {}; }
}
