import { useEffect } from "react";
import type { SiteSettings, Page } from "./types";
import { resolveAssetUrl } from "./config";

function setOrCreate(selector: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}
function setMeta(name: string, content: string, attrName: "name" | "property" = "name") {
  if (!content) return;
  const el = setOrCreate(`meta[${attrName}="${name}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute(attrName, name);
    return m;
  });
  el.setAttribute("content", content);
}

const MANAGED_HEAD_ID = "site-managed-head";

// Tracking ID validators — prevent arbitrary JavaScript strings from breaking
// out of the inline script templates that embed these IDs.
// Only IDs matching the expected vendor format are accepted; any other value
// is silently dropped so the tracker is simply omitted rather than executing
// attacker-controlled code.
const ID_PATTERNS: Record<string, RegExp> = {
  googleTagManagerId: /^GTM-[A-Z0-9]{1,20}$/,
  googleAnalyticsId:  /^(G|UA|AW|DC)-[A-Z0-9][A-Z0-9-]{0,30}$/,
  metaPixelId:        /^[0-9]{8,20}$/,
  googleAdsenseId:    /^ca-pub-[0-9]{10,20}$/,
};

function safeId(value: string | undefined | null, key: keyof typeof ID_PATTERNS): string {
  if (!value) return "";
  return ID_PATTERNS[key].test(value.trim()) ? value.trim() : "";
}

// Verification-only meta tags (no JS injection risk — they are only placed in
// an attribute value, not interpolated into a script string).
const META_PATTERN = /^[A-Za-z0-9+/=_-]{1,200}$/;
function safeMeta(value: string | undefined | null): string {
  if (!value) return "";
  return META_PATTERN.test(value.trim()) ? value.trim() : "";
}

export function HeadManager({ settings, page }: { settings: SiteSettings; page: Page | null }) {
  useEffect(() => {
    // Title
    const pageTitle = page?.seoMetaTitle || page?.title;
    document.title = pageTitle && settings.siteTitle
      ? `${pageTitle} | ${settings.siteTitle}`
      : pageTitle || settings.siteTitle || settings.seoMetaTitle || "Clinic";

    // Description
    const desc = page?.seoMetaDescription || settings.seoMetaDescription || settings.tagline;
    setMeta("description", desc);

    // Open Graph
    setMeta("og:title", pageTitle || settings.seoMetaTitle || settings.siteTitle, "property");
    setMeta("og:description", desc, "property");
    if (settings.seoOgImage) setMeta("og:image", resolveAssetUrl(settings.seoOgImage), "property");
    setMeta("og:type", "website", "property");
    setMeta("og:locale", "en_IN", "property");

    // Twitter Card — reuses the same OG title/description/image so editors
    // only need to manage one set of fields in the Website Builder.
    setMeta("twitter:card", settings.seoOgImage ? "summary_large_image" : "summary");
    setMeta("twitter:title", pageTitle || settings.seoMetaTitle || settings.siteTitle);
    setMeta("twitter:description", desc);
    if (settings.seoOgImage) setMeta("twitter:image", resolveAssetUrl(settings.seoOgImage));

    // Canonical URL — helps search engines treat the published page (not a
    // preview-token or query-string variant) as the authoritative version.
    {
      const canonicalHref = window.location.origin + window.location.pathname;
      let link = document.head.querySelector<HTMLLinkElement>("link[rel='canonical']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
      }
      link.href = canonicalHref;
    }

    // Verification meta tags — use safeMeta to reject values with characters
    // that could inject extra attributes or break out of the attribute context.
    setMeta("facebook-domain-verification", safeMeta(settings.facebookMetaTag));
    setMeta("p:domain_verify", safeMeta(settings.pinterestMetaTag));
    setMeta("google-adsense-account", safeId(settings.googleAdsenseId, "googleAdsenseId"));

    // Favicon
    if (settings.faviconUrl) {
      let link = document.head.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = resolveAssetUrl(settings.faviconUrl);
    }

    // Custom + analytics scripts (managed wrapper, replaced on each change).
    // Each tracking ID is validated against its expected vendor format before
    // being interpolated into a script string, so a malicious value cannot
    // break out of the JS string context.
    const old = document.getElementById(MANAGED_HEAD_ID);
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = MANAGED_HEAD_ID;
    wrap.style.display = "none";
    let html = "";

    const gtmId = safeId(settings.googleTagManagerId, "googleTagManagerId");
    if (gtmId) {
      html += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');</script>`;
    }

    const gaId = safeId(settings.googleAnalyticsId, "googleAnalyticsId");
    if (gaId) {
      html += `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>`;
      html += `<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gaId}');</script>`;
    }

    const pixelId = safeId(settings.metaPixelId, "metaPixelId");
    if (pixelId) {
      html += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${pixelId}');fbq('track', 'PageView');</script>`;
    }

    const adsenseId = safeId(settings.googleAdsenseId, "googleAdsenseId");
    if (adsenseId) {
      html += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}" crossorigin="anonymous"></script>`;
    }

    // customHeadHtml is an admin-only field (protected at the API layer by
    // the isAdminRole() guard inside PATCH /settings, which restricts writes
    // to admin/super_admin roles only). It is intentionally rendered as-is to
    // support legitimate use cases such as embedding third-party widgets or
    // verification scripts that cannot be expressed as structured tracking IDs.
    if (settings.customHeadHtml) {
      html += settings.customHeadHtml;
    }

    if (html) {
      wrap.innerHTML = html;
      // Move scripts so they execute (innerHTML scripts won't run by default)
      const scripts = Array.from(wrap.querySelectorAll("script"));
      for (const s of scripts) {
        const newScript = document.createElement("script");
        for (const a of Array.from(s.attributes)) newScript.setAttribute(a.name, a.value);
        if (s.textContent) newScript.textContent = s.textContent;
        s.replaceWith(newScript);
      }
      document.head.appendChild(wrap);
    }
  }, [settings, page]);

  return null;
}
