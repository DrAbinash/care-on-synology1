import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getStaffToken } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save,
  LayoutGrid, ImageIcon, Briefcase, CalendarCheck, Star, Phone,
  Share2, Mail, HelpCircle, Images, Code, Minus, GripVertical,
  BarChart3, ShieldCheck, Cpu, Package,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Section model
// ─────────────────────────────────────────────────────────────────────────────
export type SectionType =
  | "header" | "hero" | "stats" | "services" | "why_choose_us" | "technology"
  | "health_packages" | "appointment" | "reviews"
  | "contact" | "connect" | "subscribe" | "faq" | "gallery"
  | "custom_html" | "footer";

export type Section = {
  id: string;
  type: SectionType;
  enabled: boolean;
  config: Record<string, unknown>;
};

type SectionTypeMeta = {
  type: SectionType;
  label: string;
  desc: string;
  Icon: typeof LayoutGrid;
  defaults: Record<string, unknown>;
};

const SECTION_TYPES: SectionTypeMeta[] = [
  { type: "header",      label: "Header",            desc: "Top nav with logo + menu",   Icon: LayoutGrid,    defaults: { showLogo: true, ctaLabel: "Book Appointment", ctaUrl: "/appointment" } },
  { type: "hero",        label: "Hero",              desc: "Big banner + CTA",           Icon: ImageIcon,     defaults: { heading: "Trusted Diagnostics, Caring Hands", subheading: "200+ tests, on-call ultrasound, same-day reports.", imageUrl: "", ctaLabel: "Book Now", ctaUrl: "/appointment" } },
  { type: "stats",       label: "Stats Strip",       desc: "Counters (patients, years, tests)", Icon: BarChart3, defaults: { items: [{ num: "10,000+", label: "Patients Served" }, { num: "15+", label: "Years of Service" }, { num: "50+", label: "Diagnostic Tests" }, { num: "24h", label: "Report Turnaround" }] } },
  { type: "services",    label: "Our Services",      desc: "Grid of service cards",      Icon: Briefcase,     defaults: { heading: "Our Services", items: [{ title: "Pathology", desc: "Blood, urine, biopsy panels" }, { title: "Radiology", desc: "X-Ray, USG, ECG" }, { title: "Health Packages", desc: "Wellness checkups" }] } },
  { type: "why_choose_us", label: "Why Choose Us",   desc: "Trust/differentiator cards", Icon: ShieldCheck,   defaults: { heading: "Why Patients Trust Care Diagnostics", subheading: "Built for accuracy, speed and compassionate patient care." } },
  { type: "technology",  label: "Our Technology",    desc: "Equipment showcase cards",   Icon: Cpu,           defaults: { heading: "Technology built for confident diagnosis", subheading: "High-quality imaging and laboratory workflow, designed to support clear clinical decisions." } },
  { type: "health_packages", label: "Health Packages", desc: "Preventive checkup packages", Icon: Package,     defaults: { heading: "Popular health packages", subheading: "Preventive packages designed for families, senior citizens and chronic-disease monitoring." } },
  { type: "appointment", label: "Online Appointment", desc: "Booking form",              Icon: CalendarCheck, defaults: { heading: "Book an Appointment", subheading: "We'll confirm by WhatsApp.", submitLabel: "Request Appointment" } },
  { type: "reviews",     label: "Reviews",           desc: "Patient testimonials",       Icon: Star,          defaults: { heading: "What Patients Say", items: [{ name: "Asha P.", rating: 5, text: "Reports came on time, staff was kind." }] } },
  { type: "contact",     label: "Contact Us",        desc: "Address, phone, map",        Icon: Phone,         defaults: { heading: "Reach Us", mapEmbed: "", showForm: true } },
  { type: "connect",     label: "Connect With Us",   desc: "Social link buttons",        Icon: Share2,        defaults: { heading: "Connect With Us" } },
  { type: "subscribe",   label: "Subscribe",         desc: "Newsletter / WhatsApp opt-in", Icon: Mail,        defaults: { heading: "Stay in touch", subheading: "Health tips and offers, no spam.", placeholder: "your@email.com", submitLabel: "Subscribe" } },
  { type: "faq",         label: "FAQ",               desc: "Pulls from FAQ tab",         Icon: HelpCircle,    defaults: { heading: "Frequently Asked Questions" } },
  { type: "gallery",     label: "Gallery",           desc: "Pulls from Photo Library",   Icon: Images,        defaults: { heading: "Inside Our Centre", category: "general" } },
  { type: "custom_html", label: "Custom HTML",       desc: "Embed any HTML / iframe",    Icon: Code,          defaults: { html: "<!-- paste your HTML here -->" } },
  { type: "footer",      label: "Footer",            desc: "Copyright + links",          Icon: Minus,         defaults: { text: "© 2025 Care Diagnostics", links: [{ label: "Privacy", url: "/privacy" }, { label: "Terms", url: "/terms" }] } },
];

const TYPE_META = new Map(SECTION_TYPES.map((m) => [m.type, m]));

function nanoId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseSections(raw: string): Section[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => ({
      id: typeof s.id === "string" ? s.id : nanoId(),
      type: (s.type ?? "hero") as SectionType,
      enabled: s.enabled !== false,
      config: typeof s.config === "object" && s.config != null ? s.config : {},
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page-level editor (header)
// ─────────────────────────────────────────────────────────────────────────────
type PageRow = {
  id: number; slug: string; title: string; status: string;
  showInNav: boolean; orderIndex: number;
  sections: string;
  seoMetaTitle: string; seoMetaDescription: string;
};

type Props = { pageId: number; onBack: () => void };

export function SectionsEditor({ pageId, onBack }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pageQ = useQuery<PageRow>({
    queryKey: ["website", "page", pageId],
    queryFn: () => api.get<PageRow>(`/api/website/pages/${pageId}`),
  });

  const [sections, setSections] = useState<Section[]>([]);
  const [meta, setMeta] = useState<{ title: string; slug: string; status: string; showInNav: boolean; seoMetaTitle: string; seoMetaDescription: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (pageQ.data) {
      setSections(parseSections(pageQ.data.sections));
      setMeta({
        title: pageQ.data.title, slug: pageQ.data.slug, status: pageQ.data.status,
        showInNav: pageQ.data.showInNav,
        seoMetaTitle: pageQ.data.seoMetaTitle, seoMetaDescription: pageQ.data.seoMetaDescription,
      });
    }
  }, [pageQ.data]);

  const dirty = useMemo(() => {
    if (!pageQ.data || !meta) return false;
    const original = parseSections(pageQ.data.sections);
    const metaChanged =
      meta.title !== pageQ.data.title ||
      meta.slug !== pageQ.data.slug ||
      meta.status !== pageQ.data.status ||
      meta.showInNav !== pageQ.data.showInNav ||
      meta.seoMetaTitle !== pageQ.data.seoMetaTitle ||
      meta.seoMetaDescription !== pageQ.data.seoMetaDescription;
    return metaChanged || JSON.stringify(original) !== JSON.stringify(sections);
  }, [pageQ.data, meta, sections]);

  const save = useMutation({
    mutationFn: () => api.patch(`/api/website/pages/${pageId}`, {
      ...meta,
      sections: JSON.stringify(sections),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website", "page", pageId] });
      qc.invalidateQueries({ queryKey: ["website", "pages"] });
      toast({ title: "Page saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function addSection(t: SectionType) {
    const m = TYPE_META.get(t)!;
    setSections([...sections, { id: nanoId(), type: t, enabled: true, config: structuredClone(m.defaults) }]);
    setAdding(false);
  }

  // Root-cause fix for "the published Home page looks empty/worse than
  // before": creating a page via the Pages tab always started with ZERO
  // sections (just header + footer render automatically on the public
  // site even with none configured). This one-click action loads the
  // same rich, pre-designed section set — hero, stats, services, why
  // choose us, technology, health packages, appointment, gallery,
  // reviews, FAQ, contact, subscribe, connect — that the premium
  // redesign was built around, using each type's own sensible defaults
  // (same content "Add Section" would give you, one at a time). Only
  // shown for the "home" page; does not touch any other page's content.
  const DEFAULT_HOME_SECTION_TYPES: SectionType[] = [
    "hero", "stats", "services", "why_choose_us", "technology",
    "health_packages", "appointment", "gallery", "reviews", "faq",
    "contact", "subscribe", "connect",
  ];
  function loadDefaultHomeSections() {
    const next = DEFAULT_HOME_SECTION_TYPES.map((t) => {
      const m = TYPE_META.get(t)!;
      return { id: nanoId(), type: t, enabled: true, config: structuredClone(m.defaults) };
    });
    setSections(next);
  }

  function removeAt(i: number) {
    setSections(sections.filter((_, idx) => idx !== i));
  }
  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...sections];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setSections(next);
  }
  function moveDown(i: number) {
    if (i === sections.length - 1) return;
    const next = [...sections];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setSections(next);
  }
  function patchSection(i: number, patch: Partial<Section>) {
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function patchConfig(i: number, key: string, value: unknown) {
    const s = sections[i];
    patchSection(i, { config: { ...s.config, [key]: value } });
  }

  if (pageQ.isLoading || !meta) return <div className="text-sm text-muted-foreground">Loading page…</div>;
  if (pageQ.isError) return <div className="text-sm text-red-600">Failed to load page.</div>;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 bg-card border border-card-border rounded-xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} className="mr-1" /> Pages</Button>
          <div className="min-w-0">
            <div className="font-bold truncate">{meta.title || "Untitled page"}</div>
            <div className="text-xs text-muted-foreground font-mono">/{meta.slug}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {meta.slug === "home" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (sections.length === 0 || window.confirm("Replace all current sections with the default homepage layout? This can't be undone until you save, but you can still cancel before saving.")) {
                  loadDefaultHomeSections();
                }
              }}
            >
              <LayoutGrid size={14} className="mr-1" /> Load default sections
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            <Save size={14} className="mr-1" /> {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>

      {/* Page meta */}
      <details className="bg-card border border-card-border rounded-xl p-4" open>
        <summary className="font-semibold cursor-pointer select-none">Page settings</summary>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Title</Label><Input className="mt-1" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
          <div><Label>Slug</Label><Input className="mt-1" value={meta.slug} onChange={(e) => setMeta({ ...meta, slug: e.target.value.replace(/[^a-z0-9-]/g, "") })} /></div>
          <div>
            <Label>Status</Label>
            <select className="w-full mt-1 h-9 px-3 rounded-md border border-input bg-background text-sm" value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Switch checked={meta.showInNav} onCheckedChange={(v) => setMeta({ ...meta, showInNav: v })} />
            <Label>Show in site navigation</Label>
          </div>
          <div className="md:col-span-2"><Label>SEO Title (overrides site default)</Label><Input className="mt-1" value={meta.seoMetaTitle} onChange={(e) => setMeta({ ...meta, seoMetaTitle: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>SEO Description</Label><Textarea className="mt-1" value={meta.seoMetaDescription} onChange={(e) => setMeta({ ...meta, seoMetaDescription: e.target.value })} /></div>
        </div>
      </details>

      {/* Sections list */}
      <div className="space-y-3">
        {sections.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            This page has no sections yet. Add one below.
            {meta.slug === "home" && (
              <div className="mt-3">
                <Button size="sm" onClick={loadDefaultHomeSections}>
                  <LayoutGrid size={14} className="mr-1" /> Load default homepage sections
                </Button>
              </div>
            )}
          </div>
        )}
        {sections.map((s, i) => (
          <SectionCard
            key={s.id}
            index={i}
            total={sections.length}
            section={s}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
            onRemove={() => removeAt(i)}
            onToggle={(v) => patchSection(i, { enabled: v })}
            onConfigChange={(k, v) => patchConfig(i, k, v)}
          />
        ))}
      </div>

      {/* Add section */}
      <div className="bg-card border border-card-border rounded-xl p-4">
        {!adding ? (
          <Button variant="outline" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" /> Add section</Button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">Choose a section to add</div>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {SECTION_TYPES.map((m) => {
                const Icon = m.Icon;
                return (
                  <button
                    key={m.type}
                    onClick={() => addSection(m.type)}
                    className="text-left rounded-lg border border-border hover:border-primary hover:bg-accent p-3 transition"
                  >
                    <div className="flex items-center gap-2 mb-1"><Icon size={14} className="text-primary" /> <span className="font-semibold text-sm">{m.label}</span></div>
                    <div className="text-xs text-muted-foreground">{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard — renders one section with a type-aware editor
// ─────────────────────────────────────────────────────────────────────────────
function SectionCard({
  section, index, total,
  onMoveUp, onMoveDown, onRemove, onToggle, onConfigChange,
}: {
  section: Section; index: number; total: number;
  onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
  onToggle: (v: boolean) => void;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  const meta = TYPE_META.get(section.type);
  const Icon = meta?.Icon ?? LayoutGrid;
  return (
    <div className={`bg-card border border-card-border rounded-xl ${section.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical size={14} className="text-muted-foreground flex-shrink-0" />
          <Icon size={16} className="text-primary flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{meta?.label ?? section.type}</div>
            <div className="text-[11px] text-muted-foreground">Section #{index + 1}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Switch checked={section.enabled} onCheckedChange={onToggle} />
          <Button size="icon" variant="ghost" onClick={onMoveUp} disabled={index === 0}><ChevronUp size={14} /></Button>
          <Button size="icon" variant="ghost" onClick={onMoveDown} disabled={index === total - 1}><ChevronDown size={14} /></Button>
          <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 size={14} /></Button>
        </div>
      </div>
      <div className="p-4">
        <SectionConfigEditor section={section} onConfigChange={onConfigChange} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-aware config editors
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>;
}

// Hero background photo — upload (same /api/website/photos flow used by the
// Photo Library and the /book page hero) with a manual URL field as a
// fallback for admins who already have an external image URL.
function HeroImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("category", "hero");
      const token = getStaffToken();
      const r = await fetch("/api/website/photos", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!r.ok) throw new Error(await r.text());
      const photo = await r.json();
      onChange(photo.url);
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label="Background Photo">
      <div className="flex items-center gap-2">
        {value && <img src={value} alt="" className="h-9 w-14 rounded object-cover border border-card-border shrink-0" />}
        <label className="inline-flex items-center gap-1.5 text-xs font-medium border border-card-border rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 shrink-0">
          {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
        {value && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
      <Input
        className="mt-1.5 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or paste an image URL"
      />
    </Field>
  );
}

function SectionConfigEditor({ section, onConfigChange }: { section: Section; onConfigChange: (k: string, v: unknown) => void }) {
  const c = section.config as Record<string, unknown>;
  const get = (k: string, fb = ""): string => (typeof c[k] === "string" ? (c[k] as string) : fb);
  const getBool = (k: string, fb = false): boolean => (typeof c[k] === "boolean" ? (c[k] as boolean) : fb);
  const getNum = (k: string, fb = 0): number => (typeof c[k] === "number" ? (c[k] as number) : fb);

  switch (section.type) {
    case "header":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2"><Switch checked={getBool("showLogo", true)} onCheckedChange={(v) => onConfigChange("showLogo", v)} /><Label>Show logo</Label></div>
          <div />
          <Field label="CTA Button Label"><Input value={get("ctaLabel")} onChange={(e) => onConfigChange("ctaLabel", e.target.value)} /></Field>
          <Field label="CTA URL"><Input value={get("ctaUrl")} onChange={(e) => onConfigChange("ctaUrl", e.target.value)} /></Field>
        </div>
      );
    case "hero":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <HeroImageField
            value={get("imageUrl")}
            onChange={(url) => onConfigChange("imageUrl", url)}
          />
          <div className="md:col-span-2"><Field label="Subheading"><Textarea value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field></div>
          {get("imageUrl") && (
            <div className="md:col-span-2">
              <Label className="text-xs">Overlay intensity</Label>
              <p className="text-[11px] text-muted-foreground mb-1">
                A dark overlay is always composited behind the photo so the heading (white text) stays readable. Raise this to darken the photo more, lower it to show more of the photo through. {getNum("overlayOpacity", 55)}%
              </p>
              <input
                type="range" min={20} max={100} step={5}
                value={getNum("overlayOpacity", 55)}
                onChange={(e) => onConfigChange("overlayOpacity", Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}
          <Field label="CTA Label"><Input value={get("ctaLabel")} onChange={(e) => onConfigChange("ctaLabel", e.target.value)} /></Field>
          <Field label="CTA URL"><Input value={get("ctaUrl")} onChange={(e) => onConfigChange("ctaUrl", e.target.value)} /></Field>
        </div>
      );
    case "appointment":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Submit button label"><Input value={get("submitLabel")} onChange={(e) => onConfigChange("submitLabel", e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Subheading"><Textarea value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field></div>
        </div>
      );
    case "subscribe":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Submit label"><Input value={get("submitLabel")} onChange={(e) => onConfigChange("submitLabel", e.target.value)} /></Field>
          <Field label="Placeholder"><Input value={get("placeholder")} onChange={(e) => onConfigChange("placeholder", e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Subheading"><Textarea value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field></div>
        </div>
      );
    case "contact":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Google Maps embed URL (optional)"><Input value={get("mapEmbed")} onChange={(e) => onConfigChange("mapEmbed", e.target.value)} placeholder="https://www.google.com/maps/embed?..." /></Field>
          <div className="flex items-center gap-2"><Switch checked={getBool("showForm", true)} onCheckedChange={(v) => onConfigChange("showForm", v)} /><Label>Show contact form</Label></div>
          <p className="text-xs text-muted-foreground">Address, phone &amp; email come from <span className="font-semibold">Site Profile</span>.</p>
        </div>
      );
    case "connect":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Social links pulled from <span className="font-semibold">Site Profile → Social Media Links</span>.</p>
        </div>
      );
    case "faq":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">FAQ items come from the dedicated <span className="font-semibold">FAQ</span> tab.</p>
        </div>
      );
    case "gallery":
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Photo category filter">
            <select className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm" value={get("category", "general")} onChange={(e) => onConfigChange("category", e.target.value)}>
              <option value="general">All</option>
              <option value="hero">Hero</option>
              <option value="services">Services</option>
              <option value="gallery">Gallery</option>
              <option value="team">Team</option>
            </select>
          </Field>
          <p className="md:col-span-2 text-xs text-muted-foreground">Photos are pulled from the <span className="font-semibold">Photo Library</span> tab.</p>
        </div>
      );
    case "custom_html":
      return (
        <Field label="HTML / iframe">
          <Textarea className="font-mono text-xs min-h-[140px]" value={get("html")} onChange={(e) => onConfigChange("html", e.target.value)} />
        </Field>
      );
    case "footer":
      return (
        <div className="space-y-3">
          <Field label="Footer text"><Input value={get("text")} onChange={(e) => onConfigChange("text", e.target.value)} /></Field>
          <ItemsRepeater
            label="Footer Links"
            items={Array.isArray(c.links) ? (c.links as Array<{ label: string; url: string }>) : []}
            onChange={(next) => onConfigChange("links", next)}
            fields={[
              { key: "label", placeholder: "Privacy" },
              { key: "url",   placeholder: "/privacy" },
            ]}
          />
        </div>
      );
    case "stats":
      return (
        <div className="space-y-3">
          <ItemsRepeater
            label="Stat counters"
            items={Array.isArray(c.items) ? (c.items as Array<{ num: string; label: string }>) : []}
            onChange={(next) => onConfigChange("items", next)}
            fields={[
              { key: "num",   placeholder: "10,000+" },
              { key: "label", placeholder: "Patients Served" },
            ]}
          />
        </div>
      );
    case "why_choose_us":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Subheading"><Input value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field>
          <ItemsRepeater
            label="Points"
            items={Array.isArray(c.items) ? (c.items as Array<{ title: string; desc: string }>) : []}
            onChange={(next) => onConfigChange("items", next)}
            fields={[
              { key: "title", placeholder: "Accredited Labs" },
              { key: "desc",  placeholder: "NABL-certified processes for reliable results", multiline: true },
            ]}
          />
          <p className="text-xs text-muted-foreground">Leave points empty to use the built-in default set.</p>
        </div>
      );
    case "technology":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Subheading"><Input value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Equipment cards (3 Tesla MRI, CT, etc.) use a fixed built-in showcase.</p>
        </div>
      );
    case "health_packages":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <Field label="Subheading"><Input value={get("subheading")} onChange={(e) => onConfigChange("subheading", e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Package cards use a fixed built-in set (Basic, Comprehensive, Senior Citizen, etc.).</p>
        </div>
      );
    case "services":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <ItemsRepeater
            label="Services"
            items={Array.isArray(c.items) ? (c.items as Array<{ title: string; desc: string }>) : []}
            onChange={(next) => onConfigChange("items", next)}
            fields={[
              { key: "title", placeholder: "Pathology" },
              { key: "desc",  placeholder: "Blood, urine, biopsy", multiline: true },
            ]}
          />
        </div>
      );
    case "reviews":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input value={get("heading")} onChange={(e) => onConfigChange("heading", e.target.value)} /></Field>
          <ItemsRepeater
            label="Reviews"
            items={Array.isArray(c.items) ? (c.items as Array<{ name: string; rating: number | string; text: string }>) : []}
            onChange={(next) => onConfigChange("items", next)}
            fields={[
              { key: "name",   placeholder: "Asha P." },
              { key: "rating", placeholder: "5", type: "number" },
              { key: "text",   placeholder: "Reports came on time…", multiline: true },
            ]}
          />
        </div>
      );
    default:
      return <div className="text-sm text-muted-foreground">No editor for this section type.</div>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic items repeater (used for services/reviews/footer-links)
// ─────────────────────────────────────────────────────────────────────────────
type RepeaterField = { key: string; placeholder?: string; multiline?: boolean; type?: string };

function ItemsRepeater<T extends Record<string, unknown>>({
  label, items, onChange, fields,
}: {
  label: string;
  items: T[];
  onChange: (next: T[]) => void;
  fields: RepeaterField[];
}) {
  function addRow() {
    const empty: Record<string, unknown> = {};
    fields.forEach((f) => { empty[f.key] = f.type === "number" ? 0 : ""; });
    onChange([...items, empty as T]);
  }
  function removeRow(i: number) { onChange(items.filter((_, idx) => idx !== i)); }
  function patchRow(i: number, key: string, value: unknown) {
    onChange(items.map((row, idx) => (idx === i ? ({ ...row, [key]: value } as T) : row)));
  }
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 space-y-2">
        {items.length === 0 && <div className="text-xs text-muted-foreground italic">No rows yet.</div>}
        {items.map((row, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-border p-2.5 bg-muted/30" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr)) auto` }}>
            {fields.map((f) => {
              const value = row[f.key] as string | number | undefined;
              if (f.multiline) {
                return <Textarea key={f.key} className="min-h-[60px] text-sm" placeholder={f.placeholder} value={String(value ?? "")} onChange={(e) => patchRow(i, f.key, e.target.value)} />;
              }
              return <Input key={f.key} type={f.type ?? "text"} placeholder={f.placeholder} value={value === undefined ? "" : String(value)} onChange={(e) => patchRow(i, f.key, f.type === "number" ? Number(e.target.value) : e.target.value)} />;
            })}
            <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 size={13} /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addRow}><Plus size={13} className="mr-1" /> Add row</Button>
      </div>
    </div>
  );
}
