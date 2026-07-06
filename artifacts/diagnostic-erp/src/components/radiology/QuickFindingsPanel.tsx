import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Zap, Settings2, Star, Ruler, Lightbulb, Search } from "lucide-react";
import { Link } from "wouter";
import type { Side } from "@/lib/sideSwap";
import { parseProperties, type AbnormalityInstance } from "@/lib/abnormalityEngine";

/**
 * QuickFindingsPanel — Smart Reporting side panel (Phase 2).
 *
 * Layers, top to bottom:
 *   Search box ("/" to focus)        — filters buttons + measurements live
 *   Side selector (Left/Right/Bilat) — laterality applied at insert time
 *   Study tabs (multi-select, merge) — Ctrl+1..9
 *   ★ Favorites strip                — per-radiologist, always first
 *   Suggested strip                  — related findings for current selection
 *   Finding buttons                  — Alt+1..9 toggles the Nth visible
 *   Measurements                     — click → type value → inserted
 *
 * Insert/remove safety is owned by the parent (the workspace keeps a map of
 * exactly-inserted text per button, so deselect removes precisely what was
 * inserted even if the side selector changed since). The panel only reports
 * intents upward: onToggle(finding, nowSelected) and onMeasurement(text).
 */

export type QuickFinding = {
  id: number;
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  icdCode: string | null;
  tags: string;
  suggests: string;
  properties: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type QuickStudyTab = {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  techniqueText: string;
  normalText: string;
};

export type QuickMeasurement = {
  id: number;
  studyType: string;
  label: string;
  templateText: string;
  unit: string;
  sortOrder: number;
  isActive: boolean;
};

type QuickSelectData = { tabs: QuickStudyTab[]; findings: QuickFinding[]; measurements: QuickMeasurement[] };
type FavoriteRow = { id: number; findingId: number; sortOrder: number };

export { mergeBlock, removeBlock, mergeImpression, removeImpression } from "@/lib/quickFindingsMerge";

interface Props {
  selectedIds: Set<number>;
  onToggle: (finding: QuickFinding, nowSelected: boolean) => void;
  onMeasurement?: (templateText: string, value: string) => void;
  side: Side;
  onSideChange: (side: Side) => void;
  disabled?: boolean;
  initialStudyHint?: string | null;
  isAdmin?: boolean;
  /** Phase 4 engine: per-selected-button structured properties. */
  instances?: Map<number, AbnormalityInstance>;
  onUpdateInstance?: (finding: QuickFinding, patch: Partial<AbnormalityInstance>) => void;
  /** Fired when a selected tab has an auto-technique text configured. */
  onAutoTechnique?: (text: string) => void;
  /** One-click baseline normals for a tab. */
  onInsertNormals?: (text: string) => void;
}

const SIDES: Array<{ value: Side; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bilateral", label: "Bilateral" },
];

export default function QuickFindingsPanel({
  selectedIds, onToggle, onMeasurement, side, onSideChange, disabled, initialStudyHint, isAdmin,
  instances, onUpdateInstance, onAutoTechnique, onInsertNormals,
}: Props) {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  // Per-radiologist favorites — separate, uncached, user-specific endpoint.
  const { data: favoriteRows = [] } = useQuery<FavoriteRow[]>({
    queryKey: ["radiology-quick-favorites"],
    queryFn: () => api.get("/api/radiology/quick-select/favorites"),
    staleTime: 60_000,
  });
  const favoriteIds = useMemo(() => new Set(favoriteRows.map((f) => f.findingId)), [favoriteRows]);

  const toggleFavorite = useMutation({
    mutationFn: ({ findingId, add }: { findingId: number; add: boolean }) =>
      add
        ? api.post(`/api/radiology/quick-select/favorites/${findingId}`, {})
        : api.delete(`/api/radiology/quick-select/favorites/${findingId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-quick-favorites"] }),
  });

  const activeTabs = useMemo(() => (data?.tabs ?? []).filter((t) => t.isActive), [data]);
  const findingsById = useMemo(
    () => new Map((data?.findings ?? []).map((f) => [f.id, f])),
    [data],
  );
  const findingsByLabel = useMemo(() => {
    const m = new Map<string, QuickFinding[]>();
    for (const f of data?.findings ?? []) {
      const key = f.label.trim().toLowerCase();
      m.set(key, [...(m.get(key) ?? []), f]);
    }
    return m;
  }, [data]);

  // Multi-select tabs (initialized from study description hint once).
  const [selectedTabs, setSelectedTabs] = useState<Set<string> | null>(null);
  const effectiveTabs = useMemo(() => {
    if (selectedTabs) return selectedTabs;
    if (!initialStudyHint || activeTabs.length === 0) return new Set<string>();
    const hint = initialStudyHint.toLowerCase();
    const match = activeTabs.find((t) => hint.includes(t.name.toLowerCase()));
    return match ? new Set([match.name]) : new Set<string>();
  }, [selectedTabs, initialStudyHint, activeTabs]);

  function toggleTab(name: string) {
    const next = new Set(effectiveTabs);
    if (next.has(name)) next.delete(name);
    else {
      next.add(name);
      const tab = activeTabs.find((t) => t.name === name);
      if (tab?.techniqueText) onAutoTechnique?.(tab.techniqueText);
    }
    setSelectedTabs(next);
  }

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (f: QuickFinding) =>
    !searchLower ||
    f.label.toLowerCase().includes(searchLower) ||
    f.tags.toLowerCase().includes(searchLower) ||
    f.findingText.toLowerCase().includes(searchLower) ||
    f.impressionText.toLowerCase().includes(searchLower);

  // When searching, look across ALL findings (universal search); otherwise
  // show the selected tabs' buttons (merged, tab order then sort order).
  const visibleFindings = useMemo(() => {
    if (!data) return [];
    const tabOrder = activeTabs.map((t) => t.name);
    const pool = searchLower
      ? data.findings.filter((f) => f.isActive && matchesSearch(f))
      : data.findings.filter((f) => f.isActive && effectiveTabs.has(f.studyType));
    return pool.sort((a, b) => {
      const ta = tabOrder.indexOf(a.studyType);
      const tb = tabOrder.indexOf(b.studyType);
      if (ta !== tb) return ta - tb;
      return a.sortOrder - b.sortOrder;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, effectiveTabs, activeTabs, searchLower]);

  // Favorites strip: this radiologist's pinned buttons, always shown first.
  const favoriteFindings = useMemo(
    () =>
      favoriteRows
        .map((r) => findingsById.get(r.findingId))
        .filter((f): f is QuickFinding => !!f && f.isActive && matchesSearch(f)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [favoriteRows, findingsById, searchLower],
  );
  const favoriteIdSet = useMemo(() => new Set(favoriteFindings.map((f) => f.id)), [favoriteFindings]);
  const mainFindings = visibleFindings.filter((f) => !favoriteIdSet.has(f.id));

  // Suggested strip: union of `suggests` labels across selected findings,
  // resolved same-study first, excluding already-selected buttons.
  const suggestedFindings = useMemo(() => {
    const out: QuickFinding[] = [];
    const seen = new Set<number>();
    for (const id of selectedIds) {
      const f = findingsById.get(id);
      if (!f?.suggests) continue;
      for (const rawLabel of f.suggests.split(",")) {
        const key = rawLabel.trim().toLowerCase();
        if (!key) continue;
        const candidates = findingsByLabel.get(key) ?? [];
        const pick =
          candidates.find((c) => c.studyType === f.studyType && c.isActive) ??
          candidates.find((c) => c.isActive);
        if (pick && !selectedIds.has(pick.id) && !seen.has(pick.id)) {
          seen.add(pick.id);
          out.push(pick);
        }
      }
    }
    return out;
  }, [selectedIds, findingsById, findingsByLabel]);

  // Measurements for selected tabs (or all matching when searching).
  const visibleMeasurements = useMemo(() => {
    if (!data) return [];
    return data.measurements
      .filter((m) => m.isActive)
      .filter((m) =>
        searchLower
          ? m.label.toLowerCase().includes(searchLower)
          : effectiveTabs.has(m.studyType),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data, effectiveTabs, searchLower]);

  function insertMeasurement(m: QuickMeasurement) {
    const value = window.prompt(`${m.label} (${m.unit}):`);
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onMeasurement?.(m.templateText, trimmed);
  }

  // ── Keyboard workflow ──────────────────────────────────────────────────────
  //   /        focus search (when not typing in a field)
  //   Ctrl+1-9 toggle Nth study tab
  //   Alt+1-9  toggle Nth visible finding button (favorites strip counts first)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;

      if (e.ctrlKey && !e.altKey) {
        const tab = activeTabs[n - 1];
        if (tab) {
          e.preventDefault();
          toggleTab(tab.name);
        }
      } else if (e.altKey && !e.ctrlKey) {
        const ordered = [...favoriteFindings, ...mainFindings];
        const f = ordered[n - 1];
        if (f && !disabled) {
          e.preventDefault();
          onToggle(f, !selectedIds.has(f.id));
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-3">Loading quick select…</p>;
  }
  if (!data || activeTabs.length === 0) {
    return (
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground">No quick-select study tabs configured.</p>
        {isAdmin && (
          <Link href="/settings/radiology-quick-select" className="text-xs text-primary underline inline-flex items-center gap-1">
            <Settings2 size={11} /> Configure quick select
          </Link>
        )}
      </div>
    );
  }

  function PropertyChips({ f }: { f: QuickFinding }) {
    const props = parseProperties(f.properties);
    if (props.length === 0 || !onUpdateInstance) return null;
    const inst = instances?.get(f.id) ?? { side: "", severity: "", chronicity: "", level: "", value: "" };
    const chip = (active: boolean) =>
      `text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:bg-muted/50"
      }`;
    return (
      <div className="flex flex-wrap items-center gap-1 pl-4 pb-1">
        {props.includes("side") && (["left", "right", "bilateral"] as const).map((s) => (
          <button key={s} className={chip(inst.side === s)} disabled={disabled}
            onClick={() => onUpdateInstance(f, { side: inst.side === s ? "" : s })}>
            {s === "bilateral" ? "B/L" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        {props.includes("severity") && (["mild", "moderate", "severe"] as const).map((s) => (
          <button key={s} className={chip(inst.severity === s)} disabled={disabled}
            onClick={() => onUpdateInstance(f, { severity: inst.severity === s ? "" : s })}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        {props.includes("chronicity") && (["acute", "chronic"] as const).map((s) => (
          <button key={s} className={chip(inst.chronicity === s)} disabled={disabled}
            onClick={() => onUpdateInstance(f, { chronicity: inst.chronicity === s ? "" : s })}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        {props.includes("level") && (
          <input
            value={inst.level}
            disabled={disabled}
            placeholder="Level (L4-L5)"
            onChange={(e) => onUpdateInstance(f, { level: e.target.value })}
            className="h-5 w-20 text-[9px] border rounded px-1 bg-background"
          />
        )}
        {props.includes("measurement") && (
          <input
            value={inst.value}
            disabled={disabled}
            placeholder="mm"
            onChange={(e) => onUpdateInstance(f, { value: e.target.value })}
            className="h-5 w-12 text-[9px] border rounded px-1 bg-background"
          />
        )}
      </div>
    );
  }

  function FindingButton({ f, index }: { f: QuickFinding; index?: number }) {
    const selected = selectedIds.has(f.id);
    const isFav = favoriteIds.has(f.id);
    return (
      <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant={selected ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onToggle(f, !selected)}
          className="h-7 justify-start text-[11px] font-normal flex-1 min-w-0"
          title={`${f.findingText || f.impressionText}${index !== undefined && index < 9 ? `  (Alt+${index + 1})` : ""}`}
        >
          <Zap size={10} className={selected ? "" : "text-muted-foreground"} />
          <span className="truncate">{f.label}</span>
          {(effectiveTabs.size > 1 || searchLower) && (
            <span className="ml-auto text-[9px] text-muted-foreground shrink-0">{f.studyType}</span>
          )}
        </Button>
        <button
          onClick={() => toggleFavorite.mutate({ findingId: f.id, add: !isFav })}
          className={`shrink-0 p-0.5 ${isFav ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500"}`}
          title={isFav ? "Remove from favorites" : "Pin to favorites"}
        >
          <Star size={11} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
      {selected && <PropertyChips f={f} />}
      </div>
    );
  }

  const orderedForHotkeys = [...favoriteFindings, ...mainFindings];

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-hidden">
      {/* Universal search */}
      <div className="relative shrink-0">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search buttons & measurements…  ( / )'
          className="h-7 pl-7 text-[11px]"
        />
      </div>

      {/* Side selector */}
      <div className="flex gap-1 shrink-0">
        {SIDES.map((s) => (
          <button
            key={s.value}
            onClick={() => onSideChange(s.value)}
            className={`flex-1 text-[10px] font-semibold py-1 rounded-md border transition-colors ${
              side === s.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted/50"
            }`}
            title="Laterality applied to inserted text (whole-word left/right/bilateral)"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Study tabs */}
      <div className="flex flex-wrap gap-1 shrink-0">
        {activeTabs.map((tab, i) => {
          const active = effectiveTabs.has(tab.name);
          return (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.name)}
              title={i < 9 ? `Ctrl+${i + 1}` : undefined}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* One-click baseline normals for the selected tab(s) */}
      {onInsertNormals && [...effectiveTabs].some((n) => activeTabs.find((t) => t.name === n)?.normalText) && (
        <div className="flex flex-wrap gap-1 shrink-0">
          {[...effectiveTabs].map((name) => {
            const tab = activeTabs.find((t) => t.name === name);
            if (!tab?.normalText) return null;
            return (
              <button
                key={name}
                disabled={disabled}
                onClick={() => onInsertNormals(tab.normalText)}
                className="text-[9px] px-2 py-0.5 rounded-md border bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 hover:bg-emerald-100"
                title={tab.normalText}
              >
                + {name} baseline normals
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0">
        {/* Favorites strip */}
        {favoriteFindings.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold uppercase text-amber-600 flex items-center gap-1">
              <Star size={9} fill="currentColor" /> My Favorites
            </p>
            {favoriteFindings.map((f, i) => <FindingButton key={f.id} f={f} index={i} />)}
          </div>
        )}

        {/* Suggested strip */}
        {suggestedFindings.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold uppercase text-sky-600 flex items-center gap-1">
              <Lightbulb size={9} /> Suggested
            </p>
            {suggestedFindings.map((f) => <FindingButton key={f.id} f={f} />)}
          </div>
        )}

        {/* Main buttons */}
        {effectiveTabs.size === 0 && !searchLower ? (
          <p className="text-[11px] text-muted-foreground px-1">Select one or more study tabs above (Ctrl+1…), or search ( / ).</p>
        ) : (
          <div className="flex flex-col gap-1">
            {favoriteFindings.length > 0 && mainFindings.length > 0 && (
              <p className="text-[9px] font-semibold uppercase text-muted-foreground">All buttons</p>
            )}
            {mainFindings.map((f) => (
              <FindingButton key={f.id} f={f} index={orderedForHotkeys.indexOf(f)} />
            ))}
            {mainFindings.length === 0 && favoriteFindings.length === 0 && (
              <p className="text-[11px] text-muted-foreground px-1">
                {searchLower ? "No buttons match your search." : "No active findings for the selected tab(s)."}
              </p>
            )}
          </div>
        )}

        {/* Measurements */}
        {visibleMeasurements.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold uppercase text-emerald-600 flex items-center gap-1">
              <Ruler size={9} /> Measurements
            </p>
            {visibleMeasurements.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => insertMeasurement(m)}
                className="h-7 justify-start text-[11px] font-normal"
                title={m.templateText}
              >
                <Ruler size={10} className="text-muted-foreground" />
                <span className="truncate">{m.label}</span>
                <span className="ml-auto text-[9px] text-muted-foreground">{m.unit}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <Link href="/settings/radiology-quick-select" className="shrink-0 text-[10px] text-muted-foreground hover:text-primary underline inline-flex items-center gap-1 px-1">
          <Settings2 size={10} /> Manage buttons
        </Link>
      )}
    </div>
  );
}
