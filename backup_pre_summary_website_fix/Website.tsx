import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Globe, Palette, Type as TypeIcon, MousePointer, FileText, Layers,
  Link as LinkIcon, User, BarChart, Tag, Bell, HelpCircle, Image as ImageIcon,
  Eye, MessageCircle, ExternalLink, Save, Plus, Trash2, Check, Pencil,
} from "lucide-react";
import { SectionsEditor } from "./website/SectionsEditor";

type SiteSettings = {
  id: number;
  siteTitle: string; tagline: string; about: string;
  contactEmail: string; contactPhone: string;
  whatsappNumber: string; whatsappEnabled: boolean; whatsappGreeting: string;
  address: string; registeredAddress: string; faviconUrl: string; logoUrl: string;
  themeId: string; primaryColor: string; secondaryColor: string;
  accentColor: string; backgroundColor: string;
  fontHeading: string; fontBody: string; buttonStyle: string;
  customDomain: string; domainVerified: boolean;
  seoMetaTitle: string; seoMetaDescription: string; seoKeywords: string; seoOgImage: string;
  googleAnalyticsId: string; googleTagManagerId: string; googleAdsenseId: string;
  metaPixelId: string; facebookMetaTag: string; pinterestMetaTag: string;
  customHeadHtml: string;
  socialLinks: string;
  isPublished: boolean; lastPublishedAt: string | null; publishedRevision: number;
};

type Page = { id: number; slug: string; title: string; status: string; orderIndex: number; showInNav: boolean; sections: string };
type Popup = { id: number; title: string; body: string; ctaLabel: string; ctaUrl: string; triggerType: string; triggerValue: number; enabled: boolean };
type Faq = { id: number; question: string; answer: string; orderIndex: number; enabled: boolean };
type Photo = { id: number; url: string; alt: string; category: string; uploadedAt: string };

const TABS = [
  { id: "profile",   label: "Site Profile",         icon: User },
  { id: "themes",    label: "Theme",                icon: Layers },
  { id: "appearance", label: "Colors & Fonts",      icon: Palette },
  { id: "buttons",   label: "Buttons",              icon: MousePointer },
  { id: "pages",     label: "Pages",                icon: FileText },
  { id: "sections",  label: "Sections",             icon: Layers },
  { id: "domain",    label: "Domain",               icon: Globe },
  { id: "seo",       label: "SEO",                  icon: TypeIcon },
  { id: "analytics", label: "Analytics & Tracking", icon: BarChart },
  { id: "popups",    label: "Popups",               icon: Bell },
  { id: "faq",       label: "FAQ",                  icon: HelpCircle },
  { id: "photos",    label: "Photo Library",        icon: ImageIcon },
  { id: "whatsapp",  label: "WhatsApp",             icon: MessageCircle },
  { id: "publish",   label: "Preview & Publish",    icon: Eye },
] as const;

const THEMES = [
  { id: "modern-clinical",  name: "Modern Clinical",  desc: "Clean white + violet accent",  swatch: ["#7c3aed", "#06b6d4", "#ffffff"] },
  { id: "warm-care",        name: "Warm Care",        desc: "Soft amber + earth tones",     swatch: ["#f59e0b", "#84cc16", "#fffbeb"] },
  { id: "trust-blue",       name: "Trust Blue",       desc: "Hospital-grade navy + cyan",   swatch: ["#1e40af", "#06b6d4", "#f8fafc"] },
  { id: "fresh-mint",       name: "Fresh Mint",       desc: "Pastel mint + coral",          swatch: ["#10b981", "#fb7185", "#f0fdfa"] },
  { id: "premium-dark",     name: "Premium Dark",     desc: "Dark mode with gold accent",   swatch: ["#fbbf24", "#a855f7", "#0f172a"] },
  { id: "minimal-mono",     name: "Minimal Mono",     desc: "Black & white editorial",      swatch: ["#111827", "#6b7280", "#ffffff"] },
];

const FONTS = ["Inter", "Roboto", "Lato", "Poppins", "Open Sans", "Montserrat", "Source Sans Pro", "Nunito", "Merriweather", "Playfair Display"];
const BUTTON_STYLES = [
  { id: "rounded", label: "Rounded", radius: "0.5rem" },
  { id: "pill",    label: "Pill",    radius: "9999px" },
  { id: "square",  label: "Square",  radius: "0" },
  { id: "soft",    label: "Soft",    radius: "1rem" },
];

export default function Website() {
  const [tab, setTab] = useState<typeof TABS[number]["id"]>("profile");
  const { toast } = useToast();
  const qc = useQueryClient();

  const settingsQ = useQuery<SiteSettings>({
    queryKey: ["website", "settings"],
    queryFn: () => api.get<SiteSettings>("/api/website/settings"),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<SiteSettings>) => api.patch<SiteSettings>("/api/website/settings", patch),
    onSuccess: (data) => {
      qc.setQueryData(["website", "settings"], data);
      toast({ title: "Saved", description: "Website settings updated." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="pb-10">
      <PageHeader
        title="Website Builder"
        subtitle="Design, configure and publish your public clinic website"
        actions={
          <div className="flex items-center gap-2">
            {settingsQ.data?.isPublished ? (
              <span className="px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold inline-flex items-center gap-1">
                <Check size={12} /> Published · rev {settingsQ.data.publishedRevision}
              </span>
            ) : (
              <span className="px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                Draft
              </span>
            )}
          </div>
        }
      />

      <div className="px-6 grid grid-cols-12 gap-6">
        {/* Left tabs */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-2">
          <nav className="bg-card border border-card-border rounded-xl p-2 sticky top-4">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                    active ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent text-foreground"
                  }`}
                >
                  <Icon size={14} /> <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right content */}
        <main className="col-span-12 md:col-span-9 lg:col-span-10 min-h-[60vh]">
          {settingsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {settingsQ.data && (
            <>
              {tab === "profile" &&
                <SiteProfileTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "themes" &&
                <ThemesTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "appearance" &&
                <AppearanceTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "buttons" &&
                <ButtonsTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "pages" && <PagesTab />}
              {tab === "sections" && <SectionsTab />}
              {tab === "domain" &&
                <DomainTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "seo" &&
                <SeoTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "analytics" &&
                <AnalyticsTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "popups" && <PopupsTab />}
              {tab === "faq" && <FaqTab />}
              {tab === "photos" && <PhotosTab />}
              {tab === "whatsapp" &&
                <WhatsAppTab settings={settingsQ.data} onSave={saveSettings.mutate} saving={saveSettings.isPending} />}
              {tab === "publish" && <PublishTab settings={settingsQ.data} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tab implementations
// ────────────────────────────────────────────────────────────────────────────

type SaveFn = (patch: Partial<SiteSettings>) => void;

function Card({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <h3 className="font-bold text-lg mb-4">{title}</h3>
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-5 pt-4 border-t border-border flex justify-end">{footer}</div>}
    </div>
  );
}

function FieldRow({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 }) {
  return <div className={`grid grid-cols-1 ${cols === 2 ? "md:grid-cols-2" : ""} gap-4`}>{children}</div>;
}

function SaveBar({ onSave, saving, dirty }: { onSave: () => void; saving: boolean; dirty: boolean }) {
  return (
    <Button onClick={onSave} disabled={saving || !dirty}>
      <Save size={14} className="mr-1" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
    </Button>
  );
}

function useDirtyForm<T extends Record<string, unknown>>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  return { draft, setDraft, dirty, reset: () => setDraft(initial) };
}

function SiteProfileTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const init = {
    siteTitle: settings.siteTitle, tagline: settings.tagline, about: settings.about,
    contactEmail: settings.contactEmail, contactPhone: settings.contactPhone,
    address: settings.address, registeredAddress: settings.registeredAddress,
    faviconUrl: settings.faviconUrl, logoUrl: settings.logoUrl,
    socialLinks: settings.socialLinks,
  };
  const { draft, setDraft, dirty } = useDirtyForm(init);
  const social = useMemo(() => { try { return JSON.parse(draft.socialLinks || "{}"); } catch { return {}; } }, [draft.socialLinks]);
  const setSocial = (key: string, val: string) => {
    const next = { ...social, [key]: val };
    setDraft({ ...draft, socialLinks: JSON.stringify(next) });
  };

  return (
    <Card title="Site Profile" footer={<SaveBar onSave={() => onSave(draft)} saving={saving} dirty={dirty} />}>
      <FieldRow>
        <div><Label>Site Title</Label><Input className="mt-1" value={draft.siteTitle} onChange={(e) => setDraft({ ...draft, siteTitle: e.target.value })} placeholder="Care Diagnostics" /></div>
        <div><Label>Tagline</Label><Input className="mt-1" value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="Trusted pathology &amp; imaging" /></div>
      </FieldRow>
      <div><Label>About / Site History</Label><Textarea className="mt-1 min-h-[100px]" value={draft.about} onChange={(e) => setDraft({ ...draft, about: e.target.value })} placeholder="Tell visitors about your centre, founders, milestones…" /></div>
      <FieldRow>
        <div><Label>Contact Email</Label><Input className="mt-1" type="email" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} /></div>
        <div><Label>Contact Phone</Label><Input className="mt-1" value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} /></div>
      </FieldRow>
      <div><Label>Address (Work / Operational)</Label><Textarea className="mt-1" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Displayed on site footer, contact page, and map" /></div>
      <div><Label>Registered Address (Legal / Compliance)</Label><Textarea className="mt-1" value={draft.registeredAddress} onChange={(e) => setDraft({ ...draft, registeredAddress: e.target.value })} placeholder="Shown on policy pages and legal documents" /></div>
      <FieldRow>
        <div><Label>Logo URL</Label><Input className="mt-1" value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="/uploads/site/logo.png" /></div>
        <div><Label>Favicon URL</Label><Input className="mt-1" value={draft.faviconUrl} onChange={(e) => setDraft({ ...draft, faviconUrl: e.target.value })} placeholder="/uploads/site/favicon.ico" /></div>
      </FieldRow>
      <div className="pt-2 border-t border-border">
        <Label className="text-sm font-semibold mb-2 block">Social Media Links</Label>
        <FieldRow>
          {(["facebook", "instagram", "youtube", "twitter", "linkedin", "whatsapp"] as const).map((k) => (
            <div key={k}>
              <Label className="text-xs capitalize text-muted-foreground">{k}</Label>
              <Input className="mt-1" value={(social as Record<string, string>)[k] ?? ""} onChange={(e) => setSocial(k, e.target.value)} placeholder={`https://${k}.com/...`} />
            </div>
          ))}
        </FieldRow>
      </div>
    </Card>
  );
}

function ThemesTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const [picked, setPicked] = useState(settings.themeId);
  const dirty = picked !== settings.themeId;
  const apply = () => {
    const t = THEMES.find((x) => x.id === picked);
    if (!t) return;
    onSave({ themeId: t.id, primaryColor: t.swatch[0], secondaryColor: t.swatch[1], backgroundColor: t.swatch[2] });
  };
  return (
    <Card title="Theme" footer={<SaveBar onSave={apply} saving={saving} dirty={dirty} />}>
      <p className="text-sm text-muted-foreground">Pick a starting theme. Colors and fonts are still customizable in the next tabs.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setPicked(t.id)}
            className={`text-left p-4 rounded-xl border-2 transition ${picked === t.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50"}`}
          >
            <div className="flex items-center gap-1.5 mb-3">
              {t.swatch.map((c, i) => (
                <span key={i} className="w-8 h-8 rounded-md border border-border" style={{ background: c }} />
              ))}
            </div>
            <div className="font-semibold text-sm">{t.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t.desc}</div>
            {picked === t.id && <div className="mt-2 text-xs font-bold text-primary inline-flex items-center gap-1"><Check size={12} /> Selected</div>}
          </button>
        ))}
      </div>
    </Card>
  );
}

function AppearanceTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const init = {
    primaryColor: settings.primaryColor, secondaryColor: settings.secondaryColor,
    accentColor: settings.accentColor, backgroundColor: settings.backgroundColor,
    fontHeading: settings.fontHeading, fontBody: settings.fontBody,
  };
  const { draft, setDraft, dirty } = useDirtyForm(init);
  return (
    <Card title="Colors &amp; Fonts" footer={<SaveBar onSave={() => onSave(draft)} saving={saving} dirty={dirty} />}>
      <div>
        <Label className="text-sm font-semibold mb-2 block">Brand Colors</Label>
        <FieldRow>
          {(["primaryColor", "secondaryColor", "accentColor", "backgroundColor"] as const).map((key) => (
            <div key={key}>
              <Label className="text-xs capitalize text-muted-foreground">{key.replace("Color", "")}</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="h-9 w-12 rounded border border-border bg-transparent" />
                <Input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
              </div>
            </div>
          ))}
        </FieldRow>
      </div>
      <div className="pt-3 border-t border-border">
        <Label className="text-sm font-semibold mb-2 block">Typography</Label>
        <FieldRow>
          <div>
            <Label className="text-xs text-muted-foreground">Heading font</Label>
            <select value={draft.fontHeading} onChange={(e) => setDraft({ ...draft, fontHeading: e.target.value })} className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="mt-2 text-2xl font-bold" style={{ fontFamily: draft.fontHeading }}>The quick brown fox</div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Body font</Label>
            <select value={draft.fontBody} onChange={(e) => setDraft({ ...draft, fontBody: e.target.value })} className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="mt-2 text-sm" style={{ fontFamily: draft.fontBody }}>Compassionate care, accurate diagnostics, on-time reports.</div>
          </div>
        </FieldRow>
      </div>
    </Card>
  );
}

function ButtonsTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const [picked, setPicked] = useState(settings.buttonStyle);
  const dirty = picked !== settings.buttonStyle;
  return (
    <Card title="Button Style" footer={<SaveBar onSave={() => onSave({ buttonStyle: picked })} saving={saving} dirty={dirty} />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {BUTTON_STYLES.map((b) => (
          <button key={b.id} onClick={() => setPicked(b.id)} className={`p-5 rounded-xl border-2 text-center transition ${picked === b.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50"}`}>
            <div className="mb-3 inline-block px-5 py-2 text-sm font-semibold text-white bg-primary" style={{ borderRadius: b.radius }}>Book Now</div>
            <div className="text-xs font-semibold">{b.label}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function DomainTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const [domain, setDomain] = useState(settings.customDomain);
  const dirty = domain !== settings.customDomain;
  return (
    <Card title="Connect Custom Domain" footer={<SaveBar onSave={() => onSave({ customDomain: domain })} saving={saving} dirty={dirty} />}>
      <div><Label>Custom Domain</Label><Input className="mt-1" placeholder="www.yourclinic.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
      {settings.customDomain && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <div className="font-semibold mb-2">DNS Setup</div>
          <p className="text-muted-foreground mb-2">Add the following records at your DNS provider:</p>
          <div className="font-mono text-xs space-y-1">
            <div>CNAME &nbsp; <span className="font-bold">{settings.customDomain}</span> &nbsp; → &nbsp; sites.replit.app</div>
            <div>TXT &nbsp;&nbsp;&nbsp; _verify.{settings.customDomain} &nbsp; → &nbsp; replit-verify=site-{settings.id}</div>
          </div>
          <div className="mt-3 text-xs">
            Status:{" "}
            {settings.domainVerified
              ? <span className="text-emerald-600 font-semibold">✓ Verified</span>
              : <span className="text-amber-600 font-semibold">Pending verification (re-check after DNS propagates)</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

function SeoTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const init = { seoMetaTitle: settings.seoMetaTitle, seoMetaDescription: settings.seoMetaDescription, seoKeywords: settings.seoKeywords, seoOgImage: settings.seoOgImage };
  const { draft, setDraft, dirty } = useDirtyForm(init);
  return (
    <Card title="SEO Settings" footer={<SaveBar onSave={() => onSave(draft)} saving={saving} dirty={dirty} />}>
      <div><Label>Meta Title</Label><Input className="mt-1" value={draft.seoMetaTitle} onChange={(e) => setDraft({ ...draft, seoMetaTitle: e.target.value })} placeholder="Care Diagnostics — Pathology &amp; Imaging in Deoghar" /><p className="text-[11px] text-muted-foreground mt-1">{draft.seoMetaTitle.length}/60 chars</p></div>
      <div><Label>Meta Description</Label><Textarea className="mt-1" value={draft.seoMetaDescription} onChange={(e) => setDraft({ ...draft, seoMetaDescription: e.target.value })} placeholder="Trusted diagnostic centre offering 200+ tests, on-call ultrasound, X-ray and same-day reports." /><p className="text-[11px] text-muted-foreground mt-1">{draft.seoMetaDescription.length}/160 chars</p></div>
      <div><Label>Keywords (comma separated)</Label><Input className="mt-1" value={draft.seoKeywords} onChange={(e) => setDraft({ ...draft, seoKeywords: e.target.value })} placeholder="diagnostic centre, pathology lab, ultrasound deoghar" /></div>
      <div><Label>Open Graph / Share Image URL</Label><Input className="mt-1" value={draft.seoOgImage} onChange={(e) => setDraft({ ...draft, seoOgImage: e.target.value })} placeholder="/uploads/site/og.jpg" /></div>
    </Card>
  );
}

function AnalyticsTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const init = {
    googleAnalyticsId: settings.googleAnalyticsId, googleTagManagerId: settings.googleTagManagerId,
    googleAdsenseId: settings.googleAdsenseId, metaPixelId: settings.metaPixelId,
    facebookMetaTag: settings.facebookMetaTag, pinterestMetaTag: settings.pinterestMetaTag,
    customHeadHtml: settings.customHeadHtml,
  };
  const { draft, setDraft, dirty } = useDirtyForm(init);
  return (
    <Card title="Analytics &amp; Tracking" footer={<SaveBar onSave={() => onSave(draft)} saving={saving} dirty={dirty} />}>
      <FieldRow>
        <div><Label>Google Analytics 4 (Measurement ID)</Label><Input className="mt-1" placeholder="G-XXXXXXXXXX" value={draft.googleAnalyticsId} onChange={(e) => setDraft({ ...draft, googleAnalyticsId: e.target.value })} /></div>
        <div><Label>Google Tag Manager</Label><Input className="mt-1" placeholder="GTM-XXXXXXX" value={draft.googleTagManagerId} onChange={(e) => setDraft({ ...draft, googleTagManagerId: e.target.value })} /></div>
        <div><Label>Google AdSense Publisher ID</Label><Input className="mt-1" placeholder="ca-pub-XXXXXXXXXXXXXXXX" value={draft.googleAdsenseId} onChange={(e) => setDraft({ ...draft, googleAdsenseId: e.target.value })} /></div>
        <div><Label>Meta (Facebook) Pixel ID</Label><Input className="mt-1" placeholder="123456789012345" value={draft.metaPixelId} onChange={(e) => setDraft({ ...draft, metaPixelId: e.target.value })} /></div>
      </FieldRow>
      <div><Label>Facebook domain verification meta tag</Label><Input className="mt-1" placeholder="<meta name=&quot;facebook-domain-verification&quot; content=&quot;...&quot; />" value={draft.facebookMetaTag} onChange={(e) => setDraft({ ...draft, facebookMetaTag: e.target.value })} /></div>
      <div><Label>Pinterest verification meta tag</Label><Input className="mt-1" placeholder="<meta name=&quot;p:domain_verify&quot; content=&quot;...&quot; />" value={draft.pinterestMetaTag} onChange={(e) => setDraft({ ...draft, pinterestMetaTag: e.target.value })} /></div>
      <div><Label>Custom &lt;head&gt; HTML (advanced)</Label><Textarea className="mt-1 font-mono text-xs min-h-[120px]" value={draft.customHeadHtml} onChange={(e) => setDraft({ ...draft, customHeadHtml: e.target.value })} placeholder="<!-- Any extra <link> / <script> / <meta> tags --></p>" /></div>
    </Card>
  );
}

function WhatsAppTab({ settings, onSave, saving }: { settings: SiteSettings; onSave: SaveFn; saving: boolean }) {
  const init = { whatsappEnabled: settings.whatsappEnabled, whatsappNumber: settings.whatsappNumber, whatsappGreeting: settings.whatsappGreeting };
  const { draft, setDraft, dirty } = useDirtyForm(init);
  return (
    <Card title="WhatsApp Chat Widget" footer={<SaveBar onSave={() => onSave(draft)} saving={saving} dirty={dirty} />}>
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
        <div>
          <div className="font-semibold text-sm">Enable WhatsApp floating button</div>
          <div className="text-xs text-muted-foreground">Shows a green chat button on every page that opens WhatsApp with a pre-filled message.</div>
        </div>
        <Switch checked={draft.whatsappEnabled} onCheckedChange={(v) => setDraft({ ...draft, whatsappEnabled: v })} />
      </div>
      <FieldRow>
        <div><Label>WhatsApp Number (with country code)</Label><Input className="mt-1" placeholder="+91 9876543210" value={draft.whatsappNumber} onChange={(e) => setDraft({ ...draft, whatsappNumber: e.target.value })} /></div>
        <div><Label>Pre-filled Greeting</Label><Input className="mt-1" value={draft.whatsappGreeting} onChange={(e) => setDraft({ ...draft, whatsappGreeting: e.target.value })} /></div>
      </FieldRow>
    </Card>
  );
}

function PagesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pagesQ = useQuery<{ pages: Page[] }>({ queryKey: ["website", "pages"], queryFn: () => api.get<{ pages: Page[] }>("/api/website/pages") });
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Page>("/api/website/pages", { slug: newSlug, title: newTitle }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["website", "pages"] });
      setNewSlug(""); setNewTitle("");
      toast({ title: "Page created" });
      setEditingId(created.id);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const togglePub = useMutation({
    mutationFn: (p: Page) => api.patch(`/api/website/pages/${p.id}`, { status: p.status === "published" ? "draft" : "published" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "pages"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/website/pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "pages"] }),
  });

  if (editingId !== null) {
    return <SectionsEditor pageId={editingId} onBack={() => setEditingId(null)} />;
  }

  return (
    <Card title="Pages">
      <div className="rounded-lg border border-border p-3 bg-muted/30">
        <div className="text-sm font-semibold mb-2">Add a page</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
          <Input placeholder="Slug e.g. about" value={newSlug} onChange={(e) => setNewSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))} />
          <Input placeholder="Title e.g. About Us" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Button onClick={() => create.mutate()} disabled={!newSlug || !newTitle || create.isPending}><Plus size={14} className="mr-1" /> Add</Button>
        </div>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider"><tr><th className="text-left p-3">Title</th><th className="text-left p-3">Slug</th><th className="text-left p-3">Status</th><th className="text-left p-3">In Nav</th><th className="p-3"></th></tr></thead>
          <tbody>
            {pagesQ.data?.pages.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No pages yet — create your first one above.</td></tr>}
            {pagesQ.data?.pages.map((p) => (
              <tr key={p.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setEditingId(p.id)}>
                <td className="p-3 font-medium">{p.title}</td>
                <td className="p-3 font-mono text-xs">/{p.slug}</td>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => togglePub.mutate(p)} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.status}
                  </button>
                </td>
                <td className="p-3">{p.showInNav ? "Yes" : "No"}</td>
                <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" onClick={() => setEditingId(p.id)} title="Edit sections"><Pencil size={13} /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(p.id)} title="Delete page"><Trash2 size={13} /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionsTab() {
  const pagesQ = useQuery<{ pages: Page[] }>({ queryKey: ["website", "pages"], queryFn: () => api.get<{ pages: Page[] }>("/api/website/pages") });
  const [editingId, setEditingId] = useState<number | null>(null);
  if (editingId !== null) {
    return <SectionsEditor pageId={editingId} onBack={() => setEditingId(null)} />;
  }
  return (
    <Card title="Sections">
      <p className="text-sm text-muted-foreground">Pick a page to edit its sections (Header, Hero, Services, Appointment, Reviews, Contact, Connect, Subscribe, FAQ, Gallery, Custom HTML, Footer).</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {pagesQ.data?.pages.length === 0 && <div className="text-sm text-muted-foreground italic">No pages yet — create one in the Pages tab.</div>}
        {pagesQ.data?.pages.map((p) => {
          let count = 0;
          try { const arr = JSON.parse(p.sections || "[]"); if (Array.isArray(arr)) count = arr.length; } catch { /* noop */ }
          return (
            <button key={p.id} onClick={() => setEditingId(p.id)} className="text-left rounded-lg border border-border hover:border-primary p-3 transition">
              <div className="font-semibold text-sm">{p.title}</div>
              <div className="text-xs text-muted-foreground font-mono">/{p.slug}</div>
              <div className="text-xs mt-1 text-muted-foreground">{count} section{count === 1 ? "" : "s"}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function PopupsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const popupsQ = useQuery<{ popups: Popup[] }>({ queryKey: ["website", "popups"], queryFn: () => api.get<{ popups: Popup[] }>("/api/website/popups") });
  const [draft, setDraft] = useState({ title: "", body: "", ctaLabel: "", ctaUrl: "", triggerType: "time_delay", triggerValue: 5 });
  const create = useMutation({
    mutationFn: () => api.post("/api/website/popups", draft),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website", "popups"] }); setDraft({ title: "", body: "", ctaLabel: "", ctaUrl: "", triggerType: "time_delay", triggerValue: 5 }); toast({ title: "Popup added" }); },
  });
  const toggle = useMutation({
    mutationFn: (p: Popup) => api.patch(`/api/website/popups/${p.id}`, { enabled: !p.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "popups"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/website/popups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "popups"] }),
  });
  return (
    <Card title="Popups">
      <div className="rounded-lg border border-border p-4 bg-muted/30 space-y-3">
        <div className="text-sm font-semibold">New popup</div>
        <FieldRow>
          <div><Label className="text-xs">Title</Label><Input className="mt-1" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
          <div><Label className="text-xs">CTA label</Label><Input className="mt-1" value={draft.ctaLabel} onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })} placeholder="Book now" /></div>
        </FieldRow>
        <div><Label className="text-xs">Body</Label><Textarea className="mt-1" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
        <FieldRow>
          <div><Label className="text-xs">CTA URL</Label><Input className="mt-1" value={draft.ctaUrl} onChange={(e) => setDraft({ ...draft, ctaUrl: e.target.value })} placeholder="/appointment" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Trigger</Label>
              <select className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm" value={draft.triggerType} onChange={(e) => setDraft({ ...draft, triggerType: e.target.value })}>
                <option value="time_delay">After delay (sec)</option>
                <option value="exit_intent">Exit intent</option>
                <option value="scroll">Scroll %</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div><Label className="text-xs">Value</Label><Input className="mt-1" type="number" value={draft.triggerValue} onChange={(e) => setDraft({ ...draft, triggerValue: Number(e.target.value) })} /></div>
          </div>
        </FieldRow>
        <Button size="sm" onClick={() => create.mutate()} disabled={!draft.title || create.isPending}><Plus size={14} className="mr-1" /> Add popup</Button>
      </div>

      <div className="space-y-2 mt-3">
        {popupsQ.data?.popups.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">No popups yet.</div>}
        {popupsQ.data?.popups.map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-3 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{p.title}</div>
              <div className="text-xs text-muted-foreground truncate">{p.body}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{p.triggerType} · {p.triggerValue}{p.triggerType === "time_delay" ? "s" : p.triggerType === "scroll" ? "%" : ""}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Switch checked={p.enabled} onCheckedChange={() => toggle.mutate(p)} />
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(p.id)}><Trash2 size={13} /></Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FaqTab() {
  const qc = useQueryClient();
  const faqsQ = useQuery<{ faqs: Faq[] }>({ queryKey: ["website", "faqs"], queryFn: () => api.get<{ faqs: Faq[] }>("/api/website/faqs") });
  const [q, setQ] = useState(""); const [a, setA] = useState("");
  const create = useMutation({
    mutationFn: () => api.post("/api/website/faqs", { question: q, answer: a }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website", "faqs"] }); setQ(""); setA(""); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/website/faqs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "faqs"] }),
  });
  return (
    <Card title="FAQ">
      <div className="rounded-lg border border-border p-4 bg-muted/30 space-y-3">
        <div><Label>Question</Label><Input className="mt-1" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><Label>Answer</Label><Textarea className="mt-1" value={a} onChange={(e) => setA(e.target.value)} /></div>
        <Button size="sm" onClick={() => create.mutate()} disabled={!q || !a || create.isPending}><Plus size={14} className="mr-1" /> Add</Button>
      </div>
      <div className="space-y-2 mt-3">
        {faqsQ.data?.faqs.length === 0 && <div className="text-sm text-muted-foreground p-4 text-center">No FAQs yet.</div>}
        {faqsQ.data?.faqs.map((f) => (
          <div key={f.id} className="rounded-lg border border-border p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm">{f.question}</div>
              <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{f.answer}</div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => remove.mutate(f.id)}><Trash2 size={13} /></Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PhotosTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const photosQ = useQuery<{ photos: Photo[] }>({ queryKey: ["website", "photos"], queryFn: () => api.get<{ photos: Photo[] }>("/api/website/photos") });
  const [uploading, setUploading] = useState(false);
  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("category", "general");
      // Auth header is required because /api/website/photos is gated by requireStaffAuth.
      const token = typeof window !== "undefined"
        ? (() => { try { return JSON.parse(window.localStorage.getItem("portal_staff_session") || "{}").token ?? null; } catch { return null; } })()
        : null;
      const r = await fetch("/api/website/photos", {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!r.ok) throw new Error(await r.text());
      qc.invalidateQueries({ queryKey: ["website", "photos"] });
      toast({ title: "Uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/website/photos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website", "photos"] }),
  });
  return (
    <Card title="Photo Library">
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
        <ImageIcon className="mx-auto mb-2 text-muted-foreground" size={28} />
        <p className="text-sm text-muted-foreground mb-3">Upload photos to use across pages, hero sections, and gallery.</p>
        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer hover:opacity-90">
          <Plus size={14} /> {uploading ? "Uploading…" : "Upload photo"}
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-3">
        {photosQ.data?.photos.map((p) => {
          const thumbSrc = p.url.startsWith("/objects/") ? `/api/storage${p.url}` : p.url;
          return (
            <div key={p.id} className="relative group rounded-lg overflow-hidden border border-border">
              <img src={thumbSrc} alt={p.alt} className="w-full h-32 object-cover" />
              <button onClick={() => remove.mutate(p.id)} className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition">
                <Trash2 size={12} />
              </button>
              <div className="p-2 text-[10px] text-muted-foreground truncate">{p.url.split("/").pop()}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PublishTab({ settings }: { settings: SiteSettings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const publish = useMutation({
    mutationFn: () => api.post("/api/website/publish", {}),
    onSuccess: (s: SiteSettings) => { qc.setQueryData(["website", "settings"], s); toast({ title: "Site published", description: `Revision ${s.publishedRevision}` }); },
  });
  const unpublish = useMutation({
    mutationFn: () => api.post("/api/website/unpublish", {}),
    onSuccess: (s: SiteSettings) => { qc.setQueryData(["website", "settings"], s); toast({ title: "Site unpublished" }); },
  });
  const openPreview = useMutation({
    mutationFn: () => api.post<{ token: string }>("/api/website/preview-token", {}),
    onSuccess: ({ token }) => {
      // Clinic website is now mounted at the root domain (/) — see replit.md
      // "URL Layout (May 2026 swap)" for the historical move from /site/ → /.
      window.open(`/?preview_token=${encodeURIComponent(token)}`, "_blank", "noreferrer");
    },
    onError: () => { toast({ title: "Could not open preview", description: "Make sure you are signed in as a website admin.", variant: "destructive" }); },
  });

  return (
    <Card title="Preview & Publish">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-5">
          <div className="flex items-center gap-2 mb-2 font-semibold"><Eye size={16} /> Preview</div>
          <p className="text-sm text-muted-foreground mb-3">Open the public website in a new tab to see the latest unpublished changes.</p>
          <Button variant="outline" onClick={() => openPreview.mutate()} disabled={openPreview.isPending}>
            <ExternalLink size={14} className="mr-1" /> {openPreview.isPending ? "Opening…" : "Open preview"}
          </Button>
        </div>
        <div className="rounded-lg border border-border p-5">
          <div className="flex items-center gap-2 mb-2 font-semibold"><Globe size={16} /> Publish</div>
          <p className="text-sm text-muted-foreground mb-3">
            {settings.isPublished
              ? <>Currently <span className="text-emerald-600 font-semibold">live</span> · revision {settings.publishedRevision}{settings.lastPublishedAt ? ` · ${new Date(settings.lastPublishedAt).toLocaleString()}` : ""}.</>
              : <>Site is <span className="text-amber-600 font-semibold">unpublished</span>. Click below to push your latest changes live.</>}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => publish.mutate()} disabled={publish.isPending}><Globe size={14} className="mr-1" /> {settings.isPublished ? "Re-publish" : "Publish now"}</Button>
            {settings.isPublished && <Button variant="outline" onClick={() => unpublish.mutate()} disabled={unpublish.isPending}>Unpublish</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
}
