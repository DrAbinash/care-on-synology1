import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// Singleton row (id = 1) holding the public website's global configuration.
// Owned/edited by ERP staff via the Website Builder module.
export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),

  // Site Profile
  siteTitle: text("site_title").notNull().default(""),
  tagline: text("tagline").notNull().default(""),
  about: text("about").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  whatsappNumber: text("whatsapp_number").notNull().default(""),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  whatsappGreeting: text("whatsapp_greeting").notNull().default("Hi! I'd like to book an appointment."),
  address: text("address").notNull().default(""),
  registeredAddress: text("registered_address").notNull().default(""),
  faviconUrl: text("favicon_url").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),

  // Theme + look & feel
  themeId: text("theme_id").notNull().default("modern-clinical"),
  primaryColor: text("primary_color").notNull().default("#7c3aed"),
  secondaryColor: text("secondary_color").notNull().default("#06b6d4"),
  accentColor: text("accent_color").notNull().default("#f59e0b"),
  backgroundColor: text("background_color").notNull().default("#ffffff"),
  fontHeading: text("font_heading").notNull().default("Inter"),
  fontBody: text("font_body").notNull().default("Inter"),
  buttonStyle: text("button_style").notNull().default("rounded"), // rounded | pill | square | soft

  // Domain
  customDomain: text("custom_domain").notNull().default(""),
  domainVerified: boolean("domain_verified").notNull().default(false),
  domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),

  // SEO (JSON)
  seoMetaTitle: text("seo_meta_title").notNull().default(""),
  seoMetaDescription: text("seo_meta_description").notNull().default(""),
  seoKeywords: text("seo_keywords").notNull().default(""),
  seoOgImage: text("seo_og_image").notNull().default(""),

  // Analytics & tracking tags (raw strings — injected verbatim into <head>)
  googleAnalyticsId: text("google_analytics_id").notNull().default(""),
  googleTagManagerId: text("google_tag_manager_id").notNull().default(""),
  googleAdsenseId: text("google_adsense_id").notNull().default(""),
  metaPixelId: text("meta_pixel_id").notNull().default(""),
  facebookMetaTag: text("facebook_meta_tag").notNull().default(""),
  pinterestMetaTag: text("pinterest_meta_tag").notNull().default(""),
  customHeadHtml: text("custom_head_html").notNull().default(""),

  // Social links (JSON object)
  socialLinks: text("social_links").notNull().default("{}"),

  // Service photo tiles (JSON object with service category keys and image URLs)
  serviceImagesEnabled: boolean("service_images_enabled").notNull().default(false),
  serviceImages: text("service_images").notNull().default("{}"), // { "opd": "url", "usg": "url", etc. }

  // Site history / audit JSON array
  siteHistory: text("site_history").notNull().default("[]"),

  // Publishing
  isPublished: boolean("is_published").notNull().default(false),
  lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
  publishedRevision: integer("published_revision").notNull().default(0),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
