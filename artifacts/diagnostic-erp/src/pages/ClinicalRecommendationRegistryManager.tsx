/**
 * ClinicalRecommendationRegistryManager.tsx — admin view over the shared
 * Clinical Recommendation Registry (clinicalRecommendations.ts).
 *
 * Pure read-only client over the registry data: search, severity/modality
 * filters, per-entry impact analysis (Knowledge Pack / Quality Rule /
 * Measurement / Companion / Copilot usage) and the dashboard block (top
 * triggers by severity, trigger kinds, Knowledge-Pack coverage). No new
 * engine, no route, no schema — the registry is versioned data in the repo,
 * edited through code review like the executor rule catalog.
 */
import { useMemo, useState } from "react";
import {
  CLINICAL_RECOMMENDATION_REGISTRY,
  CLINICAL_RECOMMENDATION_REGISTRY_VERSION,
  type ClinicalRecommendation,
} from "@/lib/clinicalRecommendations";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
};

function triggerSummary(r: ClinicalRecommendation): string {
  const t = r.trigger;
  if (t.kind === "measurement") return `${t.labels[0]} ${t.comparator} ${t.threshold}${t.unit}`;
  if (t.kind === "comparison") return `${t.labels.join("/")} ${t.direction} vs prior`;
  if (t.kind === "finding-text") return `report mentions: ${t.phrases[0]}…`;
  return `condition: ${t.condition}`;
}

export default function ClinicalRecommendationRegistryManager() {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [modality, setModality] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const entries = CLINICAL_RECOMMENDATION_REGISTRY;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((r) => {
      if (severity !== "all" && r.severity !== severity) return false;
      if (modality !== "all" && !r.modalities.includes(modality) && !r.modalities.includes("*")) return false;
      if (!q) return true;
      const hay = `${r.id} ${r.title} ${r.description} ${r.followUp.action} ${r.knowledgePackRefs.join(" ")} ${r.qualityRuleRefs.join(" ")} ${r.measurementRefs.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, severity, modality]);

  // Dashboard block — deterministic registry statistics.
  const stats = useMemo(() => {
    const bySeverity: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const packCoverage = new Map<string, number>();
    for (const r of entries) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      byKind[r.trigger.kind] = (byKind[r.trigger.kind] ?? 0) + 1;
      for (const p of r.knowledgePackRefs) packCoverage.set(p, (packCoverage.get(p) ?? 0) + 1);
    }
    const topPacks = [...packCoverage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { bySeverity, byKind, topPacks, total: entries.length };
  }, [entries]);

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">Clinical Recommendation Registry</h1>
        <p className="text-xs text-gray-500">
          The ONE shared source of deterministic recommendations (v{CLINICAL_RECOMMENDATION_REGISTRY_VERSION}).
          Consumed by Copilot (explains why), Companion (asks questions), the Follow-Up panel, and Knowledge
          Packs (activation). Versioned data — changes go through code review; nothing is hardcoded per modality.
        </p>
      </div>

      {/* Dashboard — top triggers, kinds, pack coverage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg border p-3">
          <div className="font-semibold mb-1">Entries by severity</div>
          {Object.entries(stats.bySeverity).map(([s, n]) => (
            <div key={s} className="flex justify-between"><span className={`px-1 rounded ${SEV_COLOR[s]}`}>{s}</span><span>{n}</span></div>
          ))}
          <div className="flex justify-between mt-1 border-t pt-1"><span>Total</span><span>{stats.total}</span></div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="font-semibold mb-1">Trigger kinds</div>
          {Object.entries(stats.byKind).map(([k, n]) => (
            <div key={k} className="flex justify-between"><span>{k}</span><span>{n}</span></div>
          ))}
        </div>
        <div className="rounded-lg border p-3">
          <div className="font-semibold mb-1">Knowledge-Pack coverage (top)</div>
          {stats.topPacks.map(([p, n]) => (
            <div key={p} className="flex justify-between"><span className="truncate">{p}</span><span>{n}</span></div>
          ))}
          <div className="text-[10px] text-gray-400 mt-1">
            Override / ignored-recommendation rates require runtime telemetry (future; documented in the PR).
          </div>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 items-center">
        <Input placeholder="Search id / title / pack / rule / measurement…" value={query}
          onChange={(e) => setQuery(e.target.value)} className="h-8 text-xs max-w-sm" />
        <select className="h-8 text-xs border rounded px-1" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">All severities</option>
          <option value="critical">critical</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
        </select>
        <select className="h-8 text-xs border rounded px-1" value={modality} onChange={(e) => setModality(e.target.value)}>
          <option value="all">All modalities</option>
          {["MRI", "USG", "CT", "X-RAY"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-xs text-gray-500">{filtered.length} / {entries.length}</span>
      </div>

      {/* Entries with impact analysis */}
      <div className="space-y-1">
        {filtered.map((r) => (
          <div key={r.id} className="rounded border px-3 py-2 text-xs">
            <button className="w-full text-left flex items-center gap-2" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              <Badge className={`${SEV_COLOR[r.severity]} border-0`}>{r.severity}</Badge>
              <span className="font-semibold">{r.title}</span>
              <span className="text-gray-400 ml-auto font-mono">{r.id}</span>
            </button>
            {openId === r.id && (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 border-t pt-2">
                <div>
                  <div><span className="text-gray-500">Trigger:</span> {triggerSummary(r)}</div>
                  <div><span className="text-gray-500">Follow-up:</span> {r.followUp.action} ({r.followUp.interval})</div>
                  <div><span className="text-gray-500">Priority:</span> {r.priority} · <span className="text-gray-500">Evidence:</span> {r.evidenceLevel} · v{r.version}</div>
                  <div className="mt-1 text-gray-600">{r.rationale}</div>
                  {r.contraindications.length > 0 && <div className="text-amber-700 mt-1">Caveats: {r.contraindications.join("; ")}</div>}
                  {r.references.length > 0 && <div className="text-gray-500 mt-1">Refs: {r.references.join("; ")}</div>}
                </div>
                <div>
                  <div className="font-semibold text-gray-600">Impact analysis</div>
                  <div><span className="text-gray-500">Modalities:</span> {r.modalities.join(", ")}</div>
                  <div><span className="text-gray-500">Knowledge Packs:</span> {r.knowledgePackRefs.join(", ") || "—"}</div>
                  <div><span className="text-gray-500">Quality Rules:</span> {r.qualityRuleRefs.join(", ") || "—"}</div>
                  <div><span className="text-gray-500">Measurements:</span> {r.measurementRefs.join(", ") || "—"}</div>
                  <div><span className="text-gray-500">Copilot:</span> surfaced via clinical-recommendations module (auto)</div>
                  <div><span className="text-gray-500">Companion:</span> {r.followUpQuestions.length ? `${r.followUpQuestions.length} follow-up question(s)` : "—"}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
