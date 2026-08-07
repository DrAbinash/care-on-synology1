import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Zap, Settings2, Star, Ruler, Lightbulb, Search, SlidersHorizontal, Check, Plus, Pencil } from "lucide-react";
import { Link } from "wouter";
import type { Side } from "@/lib/sideSwap";
import { parseProperties, type AbnormalityInstance } from "@/lib/abnormalityEngine";
import { parseQuestions } from "@/lib/structuredFindings";
import { computeChecklistStatus, summarizeChecklist, parseChecklist } from "@/lib/checklistEngine";
import { matchStudyRegion } from "@/lib/studyRegion";
import WorkspaceQuickFindingEditor from "./WorkspaceQuickFindingEditor";

/**
 * QuickFindingsPanel — Smart Reporting side panel (Phase 2).
 *
 * Layers, top to bottom:
 *   Search box ("/" to focus)        — filters buttons + measurements live
 *   Side selector (Left/Right/Bilat) — laterality applied at insert time
 *   Study tabs (multi-select, merge) — Ctrl+1..9
 *   ★ Favorites strip                — per-radiologist, always first
 *   Suggested strip                  — related findings for current selection
 *   Finding buttons                  — Alt+1..9 owned by parent workspace strip
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
  // Phase 6 Smart Findings: structured section this finding maps to, mutual-
  // exclusion group, and optional baseline sentence it supersedes.
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  // Phase 6.2 Structured Finding Assistant: JSON question definitions. Non-empty
  // → clicking opens a dialog to collect values before generating the text.
  questionsJson: string;
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

export type QuickProtocol = {
  id: number;
  name: string;
  studyType: string;
  modality: string;
  checklistJson: string;
  techniqueText: string;
  normalText: string;
  recommendationText: string;
  requiredMeasurements: string;
  isGoldStandard: boolean;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
};

// Clinical History quick-select chip — short label shown on the chip, longer
// insertedText dropped into the Clinical History field. Study-specific.
export type QuickClinicalHistoryChip = {
  id: number;
  studyType: string;
  displayLabel: string;
  insertedText: string;
  sortOrder: number;
  isActive: boolean;
};

export type QuickSelectData = {
  tabs: QuickStudyTab[];
  findings: QuickFinding[];
  measurements: QuickMeasurement[];
  protocols: QuickProtocol[];
  clinicalHistory: QuickClinicalHistoryChip[];
};
type FavoriteRow = { id: number; findingId: number; sortOrder: number };

export { mergeBlock, removeBlock, mergeImpression, removeImpression } from "@/lib/quickFindingsMerge";
import { rankSuggestions, type LearnedPattern } from "@/lib/learningEngine";

interface Props {
  selectedIds: Set<number>;
  onToggle: (finding: QuickFinding, nowSelected: boolean) => void;
  /** Structured Finding Assistant: a finding with configured questions routes
   *  its click here (to open the compact dialog) instead of toggling directly.
   *  Findings without questions still toggle immediately (fewest clicks). */
  onFindingClick?: (finding: QuickFinding) => void;
  /** Double-click: edit finding/impression text for THIS STUDY only before insert. */
  onEditBeforeInsert?: (finding: QuickFinding) => void;
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
  /** Phase 5: active protocol (drives checklist + its own technique/normal/
   *  recommendation, which take precedence over the generic tab-level ones
   *  while a protocol is selected). */
  activeProtocolId?: number | null;
  onProtocolChange?: (protocol: QuickProtocol | null) => void;
  onChecklistChange?: (percent: number, remaining: string[]) => void;
  /** Phase 5: called when the radiologist accepts a learned suggestion —
   *  parent decides where the text goes (Recommendation, by convention). */
  onAcceptLearnedSuggestion?: (text: string) => void;
  /** M1.4 — fired once when the quick-select dataset loads, so the parent
   *  can rehydrate persisted selections (needs the finding templates to seed
   *  exact-match removal state). Read-only exposure; no behavior change. */
  onFindingsLoaded?: (findings: QuickFinding[]) => void;
  /** M1.6B2 — voice "search finding <term>": the parent bumps seq with a new
   *  term and the panel adopts it as the search text. Display-only control of
   *  the SAME search state the keyboard uses — no second search path. */
  externalSearch?: { seq: number; term: string } | null;
}

const SIDES: Array<{ value: Side; label: string }> = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bilateral", label: "Bilateral" },
];

export default function QuickFindingsPanel({
  selectedIds, onToggle, onFindingClick, onEditBeforeInsert, onMeasurement, side, onSideChange, disabled, initialStudyHint, isAdmin,
  instances, onUpdateInstance, onAutoTechnique, onInsertNormals,
  activeProtocolId, onProtocolChange, onChecklistChange, onAcceptLearnedSuggestion,
  onFindingsLoaded, externalSearch,
}: Props) {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogEditor, setCatalogEditor] = useState<QuickFinding | null | "new">(null);

  /** A finding declaring questions needs details before it renders. */
  const isStructured = (f: QuickFinding) => parseQuestions(f.questionsJson).length > 0;
  /** Click intent: open the details dialog for structured findings (fewest
   *  clicks — only when needed), otherwise toggle immediately. */
  const activateFinding = (f: QuickFinding) => {
    if (isStructured(f) && onFindingClick) onFindingClick(f);
    else onToggle(f, !selectedIds.has(f.id));
  };

  /** Debounce single-click so double-click can open study-local edit instead. */
  function handleFindingPointer(f: QuickFinding) {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      activateFinding(f);
    }, 280);
  }

  function handleFindingDoubleClick(f: QuickFinding) {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (onEditBeforeInsert) onEditBeforeInsert(f);
    else activateFinding(f);
  }

  // M1.6B2 — adopt a voice-driven search term (one adoption per seq bump).
  const externalSearchSeqRef = useRef(0);
  useEffect(() => {
    if (!externalSearch || externalSearch.seq === externalSearchSeqRef.current) return;
    externalSearchSeqRef.current = externalSearch.seq;
    setSearch(externalSearch.term);
  }, [externalSearch]);

  const { data, isLoading } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  // M1.4 — expose the loaded finding templates once per dataset so the
  // workspace can rehydrate persisted Quick Select selections.
  const findingsLoadedRef = useRef(false);
  useEffect(() => {
    if (findingsLoadedRef.current || !data?.findings?.length || !onFindingsLoaded) return;
    findingsLoadedRef.current = true;
    onFindingsLoaded(data.findings);
  }, [data, onFindingsLoaded]);

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
    // Shared region resolver (also used by the workspace) so the panel's
    // protocol dropdown and the workspace's chips/near-Technique dropdown all
    // pick the same region for a study.
    const match = matchStudyRegion(initialStudyHint, activeTabs.map((t) => t.name));
    return match ? new Set([match]) : new Set<string>();
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

  // ── Protocol Engine (Phase 5) ──────────────────────────────────────────────
  // Protocols available for the currently selected region(s). Selecting one
  // loads its own technique/normal/recommendation (parent applies these,
  // taking precedence over the tab-level generic ones) and activates its
  // checklist against the currently selected findings.
  const availableProtocols = useMemo(
    () => (data?.protocols ?? []).filter((p) => p.isActive && effectiveTabs.has(p.studyType)),
    [data, effectiveTabs],
  );
  const activeProtocol = useMemo(
    () => availableProtocols.find((p) => p.id === activeProtocolId) ?? null,
    [availableProtocols, activeProtocolId],
  );
  const checklist = useMemo(() => parseChecklist(activeProtocol?.checklistJson), [activeProtocol]);
  const selectedRefs = useMemo(
    () => [...selectedIds].map((id) => findingsById.get(id)).filter((f): f is QuickFinding => !!f).map((f) => ({ label: f.label, tags: f.tags })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, findingsById],
  );
  const checklistStatus = useMemo(() => computeChecklistStatus(checklist, selectedRefs), [checklist, selectedRefs]);
  const checklistSummary = useMemo(() => summarizeChecklist(checklistStatus), [checklistStatus]);

  useEffect(() => {
    if (activeProtocol) onChecklistChange?.(checklistSummary.percent, checklistSummary.remaining);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProtocol?.id, checklistSummary.percent, checklistSummary.remaining.join("|")]);

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
  //   Alt+1-9  owned by RadiologyReportingWorkspace (main Quick Findings strip,
  //            ★ favorites first) so hotkeys work even when this panel is closed.
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Learning Engine (Phase 5): fetch this radiologist's learned patterns for
  // each currently selected finding's label; only patterns that have
  // crossed the usage threshold are shown, and only as a click-to-add chip
  // — nothing is ever inserted automatically.
  //
  // M1.4 — these two hooks MUST stay above the early returns below. They
  // previously sat after them, so the panel's very first data render (cold
  // cache: loading render returns early with fewer hooks, then data arrives
  // and renders MORE hooks) violated the Rules of Hooks — React error #310 —
  // and unmounted the entire workspace the first time the Quick tab was
  // opened. Reproduced in the M1.4 real-browser verification.
  const selectedLabels = useMemo(
    () => [...selectedIds].map((id) => findingsById.get(id)?.label).filter((l): l is string => !!l),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, findingsById],
  );
  const { data: learnedPatterns = [] } = useQuery<LearnedPattern[]>({
    queryKey: ["radiology-learned-patterns", selectedLabels.join("|")],
    queryFn: async () => {
      const results = await Promise.all(
        selectedLabels.map((label) =>
          api.get<LearnedPattern[]>(`/api/radiology/quick-select/learned-patterns?trigger=${encodeURIComponent(label)}`),
        ),
      );
      return results.flat();
    },
    enabled: selectedLabels.length > 0 && !!onAcceptLearnedSuggestion,
    staleTime: 30_000,
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
    // Structured findings collect their values in the dialog, not via these
    // free-standing chips — so the chip row is suppressed for them.
    if (isStructured(f)) return null;
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
    const structured = isStructured(f);
    return (
      <div className="flex flex-col min-w-0">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleFindingPointer(f)}
          onDoubleClick={(e) => {
            e.preventDefault();
            handleFindingDoubleClick(f);
          }}
          className={[
            "flex-1 min-w-0 rounded-lg border px-2.5 py-2 text-left transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
            selected
              ? "border-amber-500 bg-amber-600 text-white shadow-sm shadow-amber-500/20"
              : "border-amber-200/70 bg-card hover:border-amber-400 hover:bg-amber-50/70",
          ].join(" ")}
          title={
            onEditBeforeInsert
              ? `${f.label} — click to insert · double-click to edit for this study`
              : structured
                ? `${f.label} — set details${selected ? " (click to edit)" : ""}`
                : (f.findingText || f.impressionText || f.label)
          }
          data-testid={`quick-finding-${f.id}`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={[
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                selected
                  ? "border-primary-foreground/70 bg-primary-foreground/15"
                  : "border-muted-foreground/35 bg-background",
              ].join(" ")}
            >
              {selected ? <Check size={10} strokeWidth={3} /> : <Zap size={10} className="text-muted-foreground" />}
            </span>
            <span className="truncate text-[12px] font-semibold leading-tight">{f.label}</span>
            {structured && (
              <SlidersHorizontal size={11} className={`shrink-0 ${selected ? "opacity-90" : "text-muted-foreground"}`} />
            )}
          </div>
          {(effectiveTabs.size > 1 || searchLower) && (
            <div className={`mt-1 truncate text-[9px] ${selected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
              {f.studyType}
            </div>
          )}
        </button>
        {isAdmin && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCatalogEditor(f)}
            className="shrink-0 self-center rounded-md p-1.5 text-muted-foreground/50 hover:text-primary hover:bg-muted/40"
            title="Edit catalog button (all studies)"
            data-testid={`quick-finding-edit-catalog-${f.id}`}
          >
            <Pencil size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleFavorite.mutate({ findingId: f.id, add: !isFav })}
          className={`shrink-0 self-center rounded-md p-1.5 ${isFav ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500 hover:bg-muted/40"}`}
          title={isFav ? "Remove from favorites" : "Pin to favorites"}
        >
          <Star size={14} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
      {selected && <PropertyChips f={f} />}
      {selected && onAcceptLearnedSuggestion && rankSuggestions(learnedPatterns, f.label).slice(0, 1).map((p) => (
        <button
          key={p.suggestedText}
          onClick={() => onAcceptLearnedSuggestion(p.suggestedText)}
          className="ml-1 mb-1 text-[9px] text-left px-1.5 py-0.5 rounded border bg-sky-50 dark:bg-sky-950/20 border-sky-200 text-sky-700 dark:text-sky-300 hover:bg-sky-100"
          title={`You've added this ${p.occurrenceCount}× after ${f.label} — click to add it again`}
        >
          💡 You usually add: "{p.suggestedText}" — click to add
        </button>
      ))}
      </div>
    );
  }

  const orderedForHotkeys = [...favoriteFindings, ...mainFindings];

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1.5 rounded-lg border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50/60 px-2 py-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-white shadow-sm">
          <Zap size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-950">Quick Add</span>
          <span className="text-[9px] text-amber-800/70 ml-1.5">Alt+1–9 · / search</span>
          {onEditBeforeInsert && (
            <p className="text-[9px] text-amber-900/60 leading-tight mt-0.5" data-testid="quick-dblclick-hint">
              Double-click a finding to edit text for this study only
            </p>
          )}
        </div>
      </div>
      {/* Universal search */}
      <div className="relative shrink-0">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search buttons & measurements…  ( / )'
          className="h-7 pl-7 text-[11px] border-amber-200/60 focus-visible:ring-amber-400/40"
          data-qs-search
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

      {/* Protocol Engine: pick an indication-specific preset within the
          selected region(s) — loads its own technique/normal/recommendation
          and activates its checklist below. */}
      {availableProtocols.length > 0 && (
        <select
          value={activeProtocolId ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const id = Number(e.target.value) || null;
            onProtocolChange?.(availableProtocols.find((p) => p.id === id) ?? null);
          }}
          className="h-7 text-[11px] border rounded-md px-2 bg-background shrink-0"
        >
          <option value="">No protocol (generic)</option>
          {availableProtocols.map((p) => (
            <option key={p.id} value={p.id}>{p.isGoldStandard ? "★ " : ""}{p.name}{p.isDefault ? " — default" : ""}</option>
          ))}
        </select>
      )}

      {/* Live protocol checklist — the radiologist confirms coverage by
          selecting findings; nothing here is manually ticked. */}
      {activeProtocol && checklist.length > 0 && (
        <div className="rounded-md border bg-muted/20 p-1.5 shrink-0">
          <p className="text-[9px] font-semibold text-muted-foreground mb-1">
            Checklist — {checklistSummary.addressed}/{checklistSummary.total} ({checklistSummary.percent}%)
          </p>
          <div className="flex flex-wrap gap-1">
            {checklistStatus.map((item) => (
              <span
                key={item.label}
                title={item.addressed ? `Addressed by: ${item.matchedBy.join(", ")}` : "Not yet addressed"}
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  item.addressed
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-700 dark:text-emerald-300"
                    : "bg-background border-muted-foreground/20 text-muted-foreground"
                }`}
              >
                {item.addressed ? "✓ " : ""}{item.label}
              </span>
            ))}
          </div>
        </div>
      )}

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
        <div className="shrink-0 flex items-center gap-2 px-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCatalogEditor("new")}
            className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
            data-testid="quick-finding-add"
          >
            <Plus size={10} /> Add button
          </button>
          <Link href="/settings/radiology-quick-select" className="text-[10px] text-muted-foreground hover:text-primary underline inline-flex items-center gap-1">
            <Settings2 size={10} /> Full settings
          </Link>
        </div>
      )}

      {catalogEditor !== null && (
        <WorkspaceQuickFindingEditor
          finding={catalogEditor === "new" ? null : catalogEditor}
          tabs={activeTabs}
          defaultStudyType={[...effectiveTabs][0] ?? activeTabs[0]?.name ?? ""}
          onClose={() => setCatalogEditor(null)}
        />
      )}
    </div>
  );
}
