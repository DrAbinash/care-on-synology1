/**
 * PresentationTemplateManager.tsx — Ticket R1.2: admin management for the
 * versioned report presentation templates (Radiology Settings → Report Style).
 *
 * Admins: activate per copy type, publish new versions (typography from the
 * server's approved safe lists — no free-form CSS/HTML/JS), duplicate,
 * retire, import (dry-run first) and export. Radiologists see the list and
 * can PREVIEW templates (server-rendered sample data) but cannot mutate.
 * Published versions are immutable — the editor always creates version n+1.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutTemplate, Eye, Copy, PenSquare, Archive, Upload, Download,
  RotateCcw, ChevronDown, ChevronRight, X, Check,
} from "lucide-react";
import ReportLayoutQuickSelect, {
  type ReportLayoutKey,
  quickSelectLayoutKey,
} from "@/components/radiology/ReportLayoutQuickSelect";

type CopyType = "standard" | "patient" | "referrer";

/** POST that preserves the server's structured error body. fetchApi throws
 *  away everything but `error`, so field-level `issues` never reach the UI;
 *  this reads them straight from the JSON response. */
async function postWithIssues<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null; issues: ValidationIssue[]; error?: string }> {
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem("erp_session") ?? "{}").token ?? null; } catch { /* none */ }
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* non-json */ }
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (json as T) : null,
    issues: Array.isArray(json.issues) ? (json.issues as ValidationIssue[]) : [],
    error: typeof json.error === "string" ? json.error : undefined,
  };
}

interface SlotTypo {
  fontFamily?: string; fontSize?: string; color?: string; letterSpacing?: string;
  textTransform?: string; fontWeight?: string; lineHeight?: string; textAlign?: string;
}

interface TemplateDefinition {
  typography: Record<string, SlotTypo>;
  colors: Record<string, string>;
  spacing: { lineHeight?: string; sectionGap?: string };
  page: { size: string; orientation: string; margins: string };
  header: { show: boolean; showLogo: boolean; showTagline: boolean; showContact: boolean; style: string };
  patientBlock: { style: string };
  studyTitle: { style: string };
  signature: { show: boolean; showImage: boolean };
  footer: { show: boolean };
  imagePanel: { placement: string; panelWidthMm: number };
  watermark: { enabled: boolean; text: string };
  qr: { show: boolean };
  pageBreaks: { orphans: number; widows: number };
}

interface TemplateEntry {
  templateKey: string; version: number; displayName: string;
  description?: string | null; copyType: CopyType; status: string;
  isSystem: boolean; latestVersion: number; isLatest: boolean;
  definition: TemplateDefinition;
}

interface ListResponse {
  templates: TemplateEntry[];
  active: Partial<Record<CopyType, string>>;
  copyTypes: CopyType[];
  safeFonts: string[];
  slots: string[];
}

interface ValidationIssue { path: string; message: string }

const BASE = "/api/radiology/presentation-templates";

export default function PresentationTemplateManager({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<ListResponse>({
    queryKey: ["presentation-templates"],
    queryFn: () => api.get(BASE),
  });

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const [editor, setEditor] = useState<{ base: TemplateEntry; asNewKey: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["presentation-templates"] });

  const activate = useMutation({
    mutationFn: (body: { templateKey: string; copyType: CopyType }) => api.post(`${BASE}/activate`, body),
    onSuccess: () => { refresh(); toast({ title: "Active template updated" }); },
    onError: (e: Error) => toast({ title: "Activation failed", description: e.message, variant: "destructive" }),
  });
  const resetDefault = useMutation({
    mutationFn: () => api.post(`${BASE}/reset-default`, {}),
    onSuccess: () => { refresh(); toast({ title: "Reset to CARE Classic" }); },
  });
  const retire = useMutation({
    mutationFn: (body: { templateKey: string; version: number }) => api.post(`${BASE}/retire`, body),
    onSuccess: () => { refresh(); toast({ title: "Template version retired" }); },
    onError: (e: Error) => toast({ title: "Cannot retire", description: e.message, variant: "destructive" }),
  });

  async function openPreview(entry: TemplateEntry) {
    try {
      const html = await api.get<string>(`${BASE}/${entry.templateKey}/${entry.version}/preview`);
      setPreviewHtml(typeof html === "string" ? html : null);
      setPreviewLabel(`${entry.displayName} — v${entry.version}`);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function exportTemplate(entry: TemplateEntry) {
    try {
      const envelope = await api.get<object>(`${BASE}/${entry.templateKey}/${entry.version}/export`);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `report-template_${entry.templateKey}_v${entry.version}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  const byKey = useMemo(() => {
    const map = new Map<string, TemplateEntry[]>();
    for (const t of data?.templates ?? []) {
      map.set(t.templateKey, [...(map.get(t.templateKey) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const copyLabels: Record<CopyType, string> = {
    standard: "Standard (print, PDF, email, PACS)",
    patient: "Patient copy (public delivery)",
    referrer: "Referrer copy",
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" data-testid="template-manager">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <LayoutTemplate size={16} className="text-primary" /> Report presentation templates
        </h3>
        {isAdmin && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setImportOpen(true)} data-testid="btn-import">
              <Upload size={12} className="mr-1" /> Import
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resetDefault.mutate()} data-testid="btn-reset-default">
              <RotateCcw size={12} className="mr-1" /> Reset to CARE default
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Versioned templates for every rendered surface. Published versions are immutable — editing creates a new
        version; finalized reports keep rendering the version they were signed under.
      </p>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">Quick layout (standard copy)</label>
        <ReportLayoutQuickSelect
          value={quickSelectLayoutKey(data?.active?.standard)}
          activeKey={data?.active?.standard}
          disabled={!isAdmin || activate.isPending}
          onChange={(layout: ReportLayoutKey) => activate.mutate({ templateKey: layout, copyType: "standard" })}
          className="max-w-md"
        />
      </div>

      {/* Active selection per copy type */}
      <div className="grid md:grid-cols-3 gap-3" data-testid="active-selectors">
        {(data?.copyTypes ?? []).map((copyType) => (
          <div key={copyType} className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">{copyLabels[copyType]}</label>
            <select
              className="w-full h-8 text-xs border rounded-md px-2 bg-background"
              disabled={!isAdmin}
              value={data?.active[copyType] ?? (copyType === "standard" ? "care-classic" : "")}
              onChange={(e) => e.target.value && activate.mutate({ templateKey: e.target.value, copyType })}
              data-testid={`active-select-${copyType}`}
            >
              {copyType !== "standard" && <option value="">— follow standard —</option>}
              {byKey.map(([key, versions]) => (
                <option key={key} value={key}>{versions[0].displayName} ({key})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Template list */}
      <div className="space-y-1.5" data-testid="template-list">
        {byKey.map(([key, versions]) => {
          const latest = versions.find((v) => v.isLatest) ?? versions[0];
          const isActive = Object.values(data?.active ?? {}).includes(key);
          const expanded = expandedKey === key;
          return (
            <div key={key} className="rounded-md border">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <button type="button" className="flex items-center gap-2 flex-1 text-left" onClick={() => setExpandedKey(expanded ? null : key)}>
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="text-xs font-semibold">{latest.displayName}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{key}</span>
                  <Badge variant="outline" className="text-[9px]">v{latest.latestVersion}</Badge>
                  {latest.copyType !== "standard" && <Badge variant="outline" className="text-[9px]">{latest.copyType}</Badge>}
                  {latest.isSystem && <Badge variant="outline" className="text-[9px]">system</Badge>}
                  {isActive && <Badge className="text-[9px] bg-green-600 border-0"><Check size={9} className="mr-0.5" />active</Badge>}
                </button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => void openPreview(latest)} data-testid={`btn-preview-${key}`}>
                  <Eye size={11} className="mr-1" /> Preview
                </Button>
                {isAdmin && (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setEditor({ base: latest, asNewKey: false })} data-testid={`btn-edit-${key}`}>
                      <PenSquare size={11} className="mr-1" /> New version
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => setEditor({ base: latest, asNewKey: true })}>
                      <Copy size={11} className="mr-1" /> Duplicate
                    </Button>
                  </>
                )}
              </div>
              {expanded && (
                <div className="border-t px-3 py-2 space-y-1">
                  {versions.map((v) => (
                    <div key={v.version} className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono">v{v.version}</span>
                      <span className="flex-1 truncate text-muted-foreground">{v.description || v.displayName}</span>
                      <Badge variant="outline" className={`text-[9px] ${v.status === "retired" ? "opacity-60" : ""}`}>{v.status}</Badge>
                      <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => void openPreview(v)}>
                        <Eye size={10} />
                      </Button>
                      {isAdmin && (
                        <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => void exportTemplate(v)} title="Export JSON" data-testid={`btn-export-${key}-${v.version}`}>
                          <Download size={10} />
                        </Button>
                      )}
                      {isAdmin && v.status === "published" && !v.isSystem && (
                        <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" title="Retire (soft)"
                          onClick={() => retire.mutate({ templateKey: v.templateKey, version: v.version })}>
                          <Archive size={10} className="text-amber-600" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview panel */}
      {previewHtml && (
        <div className="rounded-md border overflow-hidden" data-testid="template-preview-panel">
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
            <span className="text-xs font-medium">Preview — {previewLabel} (sample data)</span>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setPreviewHtml(null)}><X size={12} /></Button>
          </div>
          <iframe title="Template preview" srcDoc={previewHtml} sandbox="allow-same-origin" className="w-full bg-white" style={{ height: "60vh" }} />
        </div>
      )}

      {editor && data && (
        <TemplateEditor
          base={editor.base}
          asNewKey={editor.asNewKey}
          safeFonts={data.safeFonts}
          slots={data.slots}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); refresh(); }}
        />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); refresh(); }} />}
    </div>
  );
}

// ── Editor (publishes a NEW version — immutability by construction) ─────────

function TemplateEditor({ base, asNewKey, safeFonts, slots, onClose, onSaved }: {
  base: TemplateEntry; asNewKey: boolean; safeFonts: string[]; slots: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(asNewKey ? `${base.displayName} Copy` : base.displayName);
  const [newKey, setNewKey] = useState(asNewKey ? `${base.templateKey}-copy` : base.templateKey);
  const [copyType, setCopyType] = useState<CopyType>(base.copyType);
  const [def, setDef] = useState<TemplateDefinition>(() => JSON.parse(JSON.stringify(base.definition)));
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const setSlot = (slot: string, field: keyof SlotTypo, value: string) =>
    setDef((d) => ({
      ...d,
      typography: {
        ...d.typography,
        [slot]: { ...(d.typography[slot] ?? {}), [field]: value || undefined },
      },
    }));

  async function save() {
    setSaving(true);
    setIssues([]);
    try {
      // Both paths are a SINGLE atomic publish (publish creates v1 for a new
      // key, or the next version for an existing one). This is retriable after
      // a validation failure and picks up copy-type + definition edits — the
      // former duplicate-then-publish two-step could strand a half-created key.
      const targetKey = asNewKey ? newKey : base.templateKey;
      const result = await postWithIssues(`${BASE}/publish`, { templateKey: targetKey, displayName, copyType, definition: def });
      if (!result.ok) {
        setIssues(result.issues.length > 0 ? result.issues : [{ path: "$", message: result.error ?? "save failed" }]);
        return;
      }
      toast({ title: asNewKey ? "Template created" : "New version published" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const colorFields = Object.keys(def.colors);

  return (
    <div className="rounded-md border p-3 space-y-3 bg-muted/20" data-testid="template-editor">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {asNewKey ? `Duplicate ${base.templateKey} v${base.version}` : `New version of ${base.templateKey} (v${base.version} → v${base.latestVersion + 1})`}
        </span>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}><X size={12} /></Button>
      </div>

      <div className="grid md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">Display name</label>
          <Input className="h-7 text-xs" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="editor-name" />
        </div>
        {asNewKey && (
          <div>
            <label className="text-[10px] text-muted-foreground">New key (slug)</label>
            <Input className="h-7 text-xs font-mono" value={newKey} onChange={(e) => setNewKey(e.target.value)} data-testid="editor-key" />
          </div>
        )}
        <div>
          <label className="text-[10px] text-muted-foreground">Copy type</label>
          <select className="w-full h-7 text-xs border rounded-md px-2 bg-background" value={copyType} onChange={(e) => setCopyType(e.target.value as CopyType)}>
            <option value="standard">standard</option>
            <option value="patient">patient</option>
            <option value="referrer">referrer</option>
          </select>
        </div>
      </div>

      {/* Typography slots — approved values only */}
      <div className="space-y-1">
        <span className="text-[11px] font-medium">Typography</span>
        {slots.map((slot) => (
          <div key={slot} className="rounded border bg-background">
            <button type="button" className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[11px]"
              onClick={() => setOpenSlot(openSlot === slot ? null : slot)}>
              {openSlot === slot ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <span className="font-medium">{slot}</span>
              <span className="text-muted-foreground text-[10px]">{def.typography[slot]?.fontSize ?? ""}</span>
            </button>
            {openSlot === slot && (
              <div className="grid md:grid-cols-4 gap-2 p-2 border-t">
                <div className="md:col-span-2">
                  <label className="text-[10px] text-muted-foreground">Font family (approved list)</label>
                  <select className="w-full h-7 text-[11px] border rounded px-1 bg-background"
                    value={def.typography[slot]?.fontFamily ?? ""}
                    onChange={(e) => setSlot(slot, "fontFamily", e.target.value)}>
                    <option value="">(inherit)</option>
                    {safeFonts.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
                  </select>
                </div>
                <LabeledInput label="Size (pt/px/em)" value={def.typography[slot]?.fontSize ?? ""} onChange={(v) => setSlot(slot, "fontSize", v)} />
                <div>
                  <label className="text-[10px] text-muted-foreground">Weight</label>
                  <select className="w-full h-7 text-[11px] border rounded px-1 bg-background"
                    value={def.typography[slot]?.fontWeight ?? ""}
                    onChange={(e) => setSlot(slot, "fontWeight", e.target.value)}>
                    <option value="">(inherit)</option>
                    {["400", "500", "600", "700", "800"].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <LabeledInput label="Color (#hex)" value={def.typography[slot]?.color ?? ""} onChange={(v) => setSlot(slot, "color", v)} />
                <LabeledInput label="Letter spacing" value={def.typography[slot]?.letterSpacing ?? ""} onChange={(v) => setSlot(slot, "letterSpacing", v)} />
                <LabeledInput label="Line height (1.0–2.5)" value={def.typography[slot]?.lineHeight ?? ""} onChange={(v) => setSlot(slot, "lineHeight", v)} />
                <div>
                  <label className="text-[10px] text-muted-foreground">Align</label>
                  <select className="w-full h-7 text-[11px] border rounded px-1 bg-background"
                    value={def.typography[slot]?.textAlign ?? ""}
                    onChange={(e) => setSlot(slot, "textAlign", e.target.value)}>
                    <option value="">(inherit)</option>
                    {["left", "center", "right"].map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Colors */}
      <div>
        <span className="text-[11px] font-medium">Colors</span>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
          {colorFields.map((key) => (
            <div key={key} className="flex items-center gap-1.5">
              <input type="color" className="h-6 w-8 border rounded"
                value={/^#[0-9a-fA-F]{6}$/.test(def.colors[key]) ? def.colors[key] : "#000000"}
                onChange={(e) => setDef((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value } }))} />
              <span className="text-[10px] text-muted-foreground">{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Page + layout + toggles */}
      <div className="grid md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">Page size</label>
          <select className="w-full h-7 text-[11px] border rounded px-1 bg-background" value={def.page.size}
            onChange={(e) => setDef((d) => ({ ...d, page: { ...d.page, size: e.target.value } }))}>
            {["A4", "A5", "Letter"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Orientation</label>
          <select className="w-full h-7 text-[11px] border rounded px-1 bg-background" value={def.page.orientation}
            onChange={(e) => setDef((d) => ({ ...d, page: { ...d.page, orientation: e.target.value } }))}>
            <option value="portrait">portrait</option>
            <option value="landscape">landscape</option>
          </select>
        </div>
        <LabeledInput label='Margins ("10mm" / "10mm 12mm")' value={def.page.margins}
          onChange={(v) => setDef((d) => ({ ...d, page: { ...d.page, margins: v } }))} />
        <LabeledInput label="Section gap (px/pt/mm)" value={def.spacing.sectionGap ?? ""}
          onChange={(v) => setDef((d) => ({ ...d, spacing: { ...d.spacing, sectionGap: v || undefined } }))} />
        <div>
          <label className="text-[10px] text-muted-foreground">Image panel</label>
          <select className="w-full h-7 text-[11px] border rounded px-1 bg-background" value={def.imagePanel.placement}
            onChange={(e) => setDef((d) => ({ ...d, imagePanel: { ...d.imagePanel, placement: e.target.value } }))}>
            <option value="inline">inline (below findings)</option>
            <option value="side-panel">side panel (right)</option>
          </select>
        </div>
        <LabeledInput label="Panel width mm (40–90)" value={String(def.imagePanel.panelWidthMm)}
          onChange={(v) => setDef((d) => ({ ...d, imagePanel: { ...d.imagePanel, panelWidthMm: Number(v) || 0 } }))} />
        <LabeledInput label="Watermark text" value={def.watermark.text}
          onChange={(v) => setDef((d) => ({ ...d, watermark: { ...d.watermark, text: v } }))} />
        <div className="flex flex-wrap items-end gap-2 pb-0.5">
          {([
            ["watermark", def.watermark.enabled, (v: boolean) => setDef((d) => ({ ...d, watermark: { ...d.watermark, enabled: v } }))],
            ["header", def.header.show, (v: boolean) => setDef((d) => ({ ...d, header: { ...d.header, show: v } }))],
            ["footer", def.footer.show, (v: boolean) => setDef((d) => ({ ...d, footer: { ...d.footer, show: v } }))],
            ["QR", def.qr.show, (v: boolean) => setDef((d) => ({ ...d, qr: { ...d.qr, show: v } }))],
          ] as Array<[string, boolean, (v: boolean) => void]>).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-1 text-[10px]">
              <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
            </label>
          ))}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-[11px] space-y-0.5" data-testid="editor-issues">
          {issues.map((i, n) => <div key={n}><span className="font-mono">{i.path}</span>: {i.message}</div>)}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving} data-testid="editor-save">
          {saving ? "Publishing…" : asNewKey ? "Create duplicate" : `Publish v${base.latestVersion + 1}`}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <Input className="h-7 text-[11px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Import (dry-run first; whole-or-nothing) ─────────────────────────────────

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [dryRunResult, setDryRunResult] = useState<{ issues: ValidationIssue[]; wouldCreate?: { templateKey: string; version: number } } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      let envelope: object;
      try { envelope = JSON.parse(raw) as object; }
      catch { setDryRunResult({ issues: [{ path: "$", message: "not valid JSON" }] }); return; }
      const result = await postWithIssues<{ ok: boolean; issues: ValidationIssue[]; wouldCreate?: { templateKey: string; version: number } }>(
        `${BASE}/import`, { envelope, dryRun },
      );
      if (dryRun) {
        // dry run always returns 200 with { issues, wouldCreate }
        setDryRunResult(result.data ?? { issues: result.issues });
      } else if (result.ok) {
        toast({ title: `Imported as ${result.data?.wouldCreate?.templateKey} v${result.data?.wouldCreate?.version}` });
        onImported();
      } else {
        setDryRunResult({ issues: result.issues.length > 0 ? result.issues : [{ path: "$", message: result.error ?? "import failed" }] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/20" data-testid="import-dialog">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Import template (JSON envelope)</span>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}><X size={12} /></Button>
      </div>
      <textarea
        className="w-full h-32 text-[11px] font-mono border rounded p-2 bg-background"
        placeholder='Paste an exported template JSON here…'
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setDryRunResult(null); }}
        data-testid="import-textarea"
      />
      {dryRunResult && (
        <div className={`rounded border p-2 text-[11px] space-y-0.5 ${dryRunResult.wouldCreate ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-red-300 bg-red-50 dark:bg-red-950/30"}`} data-testid="import-result">
          {dryRunResult.wouldCreate && (
            <div className="font-medium">Dry run OK — would create {dryRunResult.wouldCreate.templateKey} v{dryRunResult.wouldCreate.version} (immutable versions are never overwritten).</div>
          )}
          {dryRunResult.issues.map((i, n) => <div key={n}><span className="font-mono">{i.path}</span>: {i.message}</div>)}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void run(true)} disabled={busy || !raw.trim()} data-testid="btn-dry-run">
          Validate (dry run)
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => void run(false)} disabled={busy || !raw.trim() || !dryRunResult?.wouldCreate} data-testid="btn-import-commit">
          Import
        </Button>
      </div>
    </div>
  );
}
