/**
 * RadiologyKnowledgePackManager.tsx — CARE Knowledge Pack Engine (admin).
 *
 * Registry + Manager for Knowledge Packs. A pack is a named/versioned MANIFEST
 * over the existing per-study-type content — this page lists installed packs
 * with version/author/status/health/coverage, and lets an admin validate,
 * preview (the live-assembled content), export, import, and enable/disable a
 * pack. It never edits the underlying clinical content (that stays in the Quick
 * Select / Protocol / Knowledge admin pages) — it manages the pack registry.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import {
  Package, CheckCircle2, AlertTriangle, XCircle, Download, Upload,
  Eye, ShieldCheck, Power, Circle, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";

interface KnowledgePack {
  id: number; packId: string; modality: string; name: string; description: string;
  category: string; studyType: string | null; builderType: string | null;
  bodyPart: string | null; knowledgeCategory: string | null; version: string;
  author: string; status: string; isSystem: boolean; dependsOnJson: string;
  manifestJson: string; createdAt: string; updatedAt: string;
}
interface PackStats {
  total: number; enabled: number; placeholder: number; planned: number; disabled: number;
  healthy: number; warnings: number; broken: number; byModality: Record<string, number>;
}
interface PackValidation {
  health: string; ok: boolean; coveredSections: number; totalSections: number;
  issues: { section: string; severity: string; message: string }[];
}
interface PackAssembled {
  pack: KnowledgePack;
  coverage: Record<string, number | boolean>;
  validation: PackValidation;
  samples: Record<string, string[]>;
}

const STATUS_STYLE: Record<string, string> = {
  enabled: "bg-emerald-100 text-emerald-700",
  disabled: "bg-gray-200 text-gray-600",
  placeholder: "bg-amber-100 text-amber-700",
  planned: "bg-slate-200 text-slate-600",
};
function HealthBadge({ health }: { health?: string }) {
  if (health === "ok") return <span className="inline-flex items-center gap-1 text-emerald-600 text-[11px] font-semibold"><CheckCircle2 size={12} /> Healthy</span>;
  if (health === "warn") return <span className="inline-flex items-center gap-1 text-amber-600 text-[11px] font-semibold"><AlertTriangle size={12} /> Warnings</span>;
  if (health === "error") return <span className="inline-flex items-center gap-1 text-red-600 text-[11px] font-semibold"><XCircle size={12} /> Broken</span>;
  if (health === "placeholder") return <span className="inline-flex items-center gap-1 text-amber-500 text-[11px] font-semibold"><Circle size={12} /> Placeholder</span>;
  return <span className="text-gray-400 text-[11px]">—</span>;
}

export default function RadiologyKnowledgePackManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, PackAssembled>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const { data: listData, isLoading } = useQuery<{ packs: KnowledgePack[] }>({
    queryKey: ["/api/radiology/knowledge-packs"],
    queryFn: () => api.get("/api/radiology/knowledge-packs"),
  });
  const { data: stats } = useQuery<PackStats>({
    queryKey: ["/api/radiology/knowledge-packs/stats"],
    queryFn: () => api.get("/api/radiology/knowledge-packs/stats"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/api/radiology/knowledge-packs"] });
    void qc.invalidateQueries({ queryKey: ["/api/radiology/knowledge-packs/stats"] });
  };
  const onErr = (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" });

  const setStatusMutation = useMutation({
    mutationFn: (v: { id: number; status: string }) => api.patch(`/api/radiology/knowledge-packs/${v.id}`, { status: v.status }),
    onSuccess: () => { toast({ title: "Pack updated" }); invalidate(); },
    onError: onErr,
  });
  const importMutation = useMutation({
    mutationFn: (body: unknown) => api.post("/api/radiology/knowledge-packs/import", body),
    onSuccess: () => { toast({ title: "Pack imported" }); setImportOpen(false); setImportText(""); invalidate(); },
    onError: onErr,
  });

  async function loadPreview(packId: string) {
    if (expanded === packId) { setExpanded(null); return; }
    setExpanded(packId);
    if (!preview[packId]) {
      try {
        const data = await api.get<PackAssembled>(`/api/radiology/knowledge-packs/${encodeURIComponent(packId)}`);
        setPreview((p) => ({ ...p, [packId]: data }));
      } catch (e) { onErr(e as Error); }
    }
  }

  async function exportPack(packId: string) {
    try {
      const data = await api.get(`/api/radiology/knowledge-packs/${encodeURIComponent(packId)}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${packId}.pack.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { onErr(e as Error); }
  }

  function doImport() {
    let parsed: unknown;
    try { parsed = JSON.parse(importText); } catch { toast({ title: "Invalid JSON", variant: "destructive" }); return; }
    importMutation.mutate(parsed);
  }

  const packs = listData?.packs ?? [];
  const byModality = useMemo(() => {
    const m: Record<string, KnowledgePack[]> = {};
    for (const p of packs) (m[p.modality] ??= []).push(p);
    return m;
  }, [packs]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Knowledge Packs" subtitle="Study types as installable clinical-content packs over the existing Reporting Platform" />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {([
          ["Installed", stats?.total, "text-gray-800"],
          ["Enabled", stats?.enabled, "text-emerald-600"],
          ["Healthy", stats?.healthy, "text-emerald-600"],
          ["Warnings", stats?.warnings, "text-amber-600"],
          ["Broken", stats?.broken, "text-red-600"],
          ["Placeholders", stats?.placeholder, "text-amber-500"],
          ["Planned", stats?.planned, "text-slate-500"],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border bg-card shadow-sm p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`text-2xl font-bold ${tone}`}>{value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setImportOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border bg-card hover:bg-muted">
          <Upload size={14} /> Import Pack
        </button>
        <button onClick={invalidate} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border bg-card hover:bg-muted">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {importOpen && (
        <div className="rounded-xl border bg-card shadow-sm p-4 space-y-2">
          <div className="text-sm font-semibold">Import a pack manifest (JSON)</div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
            placeholder='{"packId":"ct.brain","modality":"CT","name":"CT Brain Pack","studyType":"CT Brain","status":"placeholder"}'
            className="w-full border rounded-lg p-2 font-mono text-xs" />
          <div className="text-[11px] text-muted-foreground">System packs are never overwritten without <code>force: true</code>.</div>
          <button onClick={doImport} disabled={importMutation.isPending}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
            <Upload size={14} /> Import
          </button>
        </div>
      )}

      {isLoading && <div className="text-sm text-muted-foreground">Loading packs…</div>}

      {/* Registry grouped by modality */}
      {Object.entries(byModality).sort().map(([modality, mPacks]) => (
        <div key={modality} className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b">
            <Package size={16} className="text-indigo-600" />
            <span className="text-sm font-bold">{modality}</span>
            <span className="text-[11px] text-muted-foreground">{mPacks.length} pack(s)</span>
          </div>
          <div className="divide-y">
            {mPacks.map((p) => {
              const isOpen = expanded === p.packId;
              const pv = preview[p.packId];
              return (
                <div key={p.packId}>
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <button onClick={() => loadPreview(p.packId)} className="text-gray-400 hover:text-gray-600">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{p.name}</span>
                        <code className="text-[10px] text-muted-foreground">{p.packId}</code>
                        {p.isSystem && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">system</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        v{p.version} · {p.author} · {new Date(p.updatedAt).toLocaleDateString()}
                        {p.studyType ? ` · ${p.studyType}` : ""}
                      </div>
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[p.status] ?? "bg-gray-100 text-gray-500"}`}>{p.status}</span>
                    <div className="hidden sm:block w-24 text-right"><HealthBadge health={pv?.validation.health} /></div>
                    <div className="flex items-center gap-1">
                      <button title="Preview" onClick={() => loadPreview(p.packId)} className="p-1.5 rounded hover:bg-muted text-gray-500"><Eye size={14} /></button>
                      <button title="Export" onClick={() => exportPack(p.packId)} className="p-1.5 rounded hover:bg-muted text-gray-500"><Download size={14} /></button>
                      {p.status !== "planned" && (
                        <button title={p.status === "disabled" ? "Enable" : "Disable"}
                          onClick={() => setStatusMutation.mutate({ id: p.id, status: p.status === "disabled" ? "enabled" : "disabled" })}
                          className={`p-1.5 rounded hover:bg-muted ${p.status === "disabled" ? "text-emerald-600" : "text-gray-500"}`}>
                          <Power size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-10 pb-3 pt-1 bg-muted/30 text-xs space-y-2">
                      {!pv ? <div className="text-muted-foreground py-2">Assembling live content…</div> : (
                        <>
                          {/* Coverage */}
                          <div>
                            <div className="flex items-center gap-1.5 mb-1"><ShieldCheck size={13} className="text-indigo-500" /><span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">Coverage — {pv.validation.coveredSections}/{pv.validation.totalSections} sections</span><HealthBadge health={pv.validation.health} /></div>
                            <div className="flex flex-wrap gap-1">
                              {([
                                ["Template", pv.coverage.hasTemplate ? 1 : 0],
                                ["Findings", pv.coverage.quickFindings],
                                ["Protocols", pv.coverage.protocols],
                                ["History", pv.coverage.clinicalHistory],
                                ["Measurements", Number(pv.coverage.quickMeasurements) + Number(pv.coverage.requiredMeasurements)],
                                ["Impression rules", pv.coverage.impressionRules],
                                ["Teaching", pv.coverage.teachingCases],
                                ["Knowledge", pv.coverage.knowledgeArticles],
                              ] as const).map(([label, n]) => (
                                <span key={label} className={`px-1.5 py-0.5 rounded border text-[10px] ${Number(n) > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
                                  {label}: {typeof n === "number" ? n : (n ? "yes" : "no")}
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* Validation issues */}
                          {pv.validation.issues.length > 0 && (
                            <ul className="space-y-0.5">
                              {pv.validation.issues.map((iss, i) => (
                                <li key={i} className={`flex items-start gap-1 text-[10.5px] ${iss.severity === "error" ? "text-red-600" : iss.severity === "warn" ? "text-amber-700" : "text-muted-foreground"}`}>
                                  {iss.severity === "error" ? <XCircle size={11} className="mt-0.5 shrink-0" /> : iss.severity === "warn" ? <AlertTriangle size={11} className="mt-0.5 shrink-0" /> : <Circle size={10} className="mt-0.5 shrink-0" />}
                                  <span><b>{iss.section}:</b> {iss.message}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {/* Samples */}
                          {(pv.samples.quickFindings?.length > 0 || pv.samples.protocols?.length > 0) && (
                            <div className="flex flex-wrap gap-1">
                              {(pv.samples.quickFindings ?? []).slice(0, 10).map((s) => (
                                <span key={"f" + s} className="px-1.5 py-0.5 rounded bg-white border text-[10px] text-gray-600">{s}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-muted-foreground">
        Packs describe content that already lives in the platform — editing clinical content is done in Quick Select / Protocol / Knowledge admin. See <code>CARE_KNOWLEDGE_PACK_SPEC.md</code>.
      </p>
    </div>
  );
}
