import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { quickFindingPatch, quickFindingRowBelongsTo, quickFindingRowId, quickSelectBoxAsksForSide, type QuickToggleOutcome } from "@/lib/zai-workspace/quickSelectTilePayload";
import {
  QUICK_SELECT_SEVERITIES,
  quickSelectParametersIn,
  type QuickSelectParameterName,
  type QuickSelectParameterValues,
  type QuickSelectSeverity,
} from "@/lib/zai-workspace/quickSelectParameterContract";
import {
  lookupBoxesForContext,
  quickSelectBoxSentence,
  quickSelectBoxWrittenText,
} from "@/lib/zai-workspace/quickSelectBoxCatalogue";
import { studyContrastStatus, withholdContrastOnlyBoxes } from "@/lib/zai-workspace/quickSelectContrastGate";
import { parseQuestions } from "@/lib/structuredFindings";
import type { QuickSelectField } from "@/lib/zai-workspace/types";
import type { Side } from "@/lib/sideSwap";
import { useMemo, useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Star, Search, X, ChevronRight, AlertTriangle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { patchFindingsContributionBlocked } from "@/lib/observationLedger";
import { contributionProtected } from "@/lib/observationSlot";
import { describeRetirementPreviewLine } from "@/lib/quickSelectRetirementPreview";
import { quickSelectKeyNav, quickSelectRovingTabIndex } from "@/lib/quickSelectKeyboardNavigation";
import { tileMatchesAnatomy } from "@/components/radiology/FindingsAnatomyChips";
import { dorsalLevelKeyStrings } from "@/lib/mriDorsalNumbering";
import WorkspaceQuickFindingEditor from "@/components/radiology/WorkspaceQuickFindingEditor";
import type { QuickFinding, QuickSelectData, QuickStudyTab } from "@/components/radiology/QuickFindingsPanel";

const CAT_DOT: Record<string, string> = {
  normal: "bg-emerald-500 shadow-emerald-400/50",
  abnormal: "bg-amber-500 shadow-amber-400/50",
  critical: "bg-rose-500 shadow-rose-400/50",
  variant: "bg-sky-500 shadow-sky-400/50",
  // A box whose catalogue row declares no severity is not a normal finding.
  unrated: "bg-slate-400 shadow-slate-300/50",
};

/** Bright category chrome for the chocolate-box tiles. */
const CAT_TILE: Record<string, string> = {
  normal:
    "border-emerald-300/90 bg-gradient-to-br from-emerald-50 via-teal-50/90 to-white text-emerald-950 hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-300/40 hover:-translate-y-px",
  abnormal:
    "border-amber-300/90 bg-gradient-to-br from-amber-50 via-orange-50/80 to-white text-amber-950 hover:border-amber-500 hover:shadow-md hover:shadow-amber-300/40 hover:-translate-y-px",
  critical:
    "border-rose-300/90 bg-gradient-to-br from-rose-50 via-pink-50/80 to-white text-rose-950 hover:border-rose-500 hover:shadow-md hover:shadow-rose-300/40 hover:-translate-y-px",
  variant:
    "border-sky-300/90 bg-gradient-to-br from-sky-50 via-cyan-50/80 to-white text-sky-950 hover:border-sky-500 hover:shadow-md hover:shadow-sky-300/40 hover:-translate-y-px",
  unrated:
    "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white text-slate-900 hover:border-slate-400 hover:shadow-md hover:shadow-slate-200/40 hover:-translate-y-px",
};

const CAT_BADGE: Record<string, string> = {
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
  abnormal: "bg-amber-100 text-amber-800 border-amber-200",
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  variant: "bg-sky-100 text-sky-700 border-sky-200",
  unrated: "bg-slate-100 text-slate-600 border-slate-200",
};

const FIELD_ACCENT: Record<QuickSelectField, string> = {
  clinicalHistory: "text-teal-700",
  technique: "text-indigo-700",
  findings: "text-emerald-700",
  impression: "text-violet-700",
  recommendation: "text-fuchsia-700",
};

const FIELD_PILL: Record<QuickSelectField, string> = {
  clinicalHistory: "bg-teal-100 border-teal-200 text-teal-800",
  technique: "bg-indigo-100 border-indigo-200 text-indigo-800",
  findings: "bg-emerald-100 border-emerald-200 text-emerald-800",
  impression: "bg-violet-100 border-violet-200 text-violet-800",
  recommendation: "bg-fuchsia-100 border-fuchsia-200 text-fuchsia-800",
};

const LABELS: Record<QuickSelectField, string> = {
  clinicalHistory: "History",
  technique: "Technique",
  findings: "Findings",
  impression: "Impression",
  recommendation: "Recommendation",
};

/**
 * The spine levels the level chip offers as a datalist. Free text still works —
 * `resolvedQuickSelectLevel`'s grammar is the authority — but the list is what
 * a radiologist reaches for: every cervical pair, every lumbar pair, the
 * dorsolumbar junction, and the single levels a compression fracture or a
 * Tarlov cyst actually names (L1…S2).
 *
 * The dorsal rows come from the coverage resolver, not from a typed-out list, so
 * the strip offers the same `D` lettering the ledger stores and the report prints
 * and cannot drift from it. A `T4-T5` typed by hand is still accepted — the
 * grammar allows both letters — it is simply no longer suggested.
 */
const STANDARD_SPINE_LEVELS: readonly string[] = [
  "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
  "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1",
  ...dorsalLevelKeyStrings({ mode: "localizer-confirmed", coverage: "thoracolumbar", wholeSpineLocalizer: true }),
  "L1", "L2", "L3", "L4", "L5", "S1", "S2",
];

/** The sections a box can write, in report order, for the re-click review. */
const REVIEW_SECTIONS: Array<{ key: "findings" | "impression" | "technique" | "recommendation"; label: string }> = [
  { key: "technique", label: "Technique" },
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
  { key: "recommendation", label: "Recommendation" },
];

type FavoriteRow = { id: number; findingId: number; sortOrder: number };
type UsageRow = { id: number; userId: number; findingId: number; useCount: number };

/**
 * One wire box plus the two per-radiologist facts the chrome reads.
 *
 * The full `QuickFinding` row, not the narrower `QuickSelectCatalogueBox`: the
 * strip hands the same object to three consumers that each want the whole row —
 * `onToggle` (the workspace's one box writer), the re-click review, and the
 * authoring editor a pencil opens. Narrowing it here would mean widening it back
 * at each of those, and a cast is how a box loses a column on the way.
 */
export type QuickSelectStripBox = QuickFinding & {
  favorite: boolean;
  usageCount: number;
};

export function QuickSelectStrip({
  field,
  bodyPart,
  compact,
  anatomyFilter,
  onToggle,
  onAfterPick,
  onStructuredPick,
  disabled = false,
}: {
  field: QuickSelectField;
  /**
   * Region to scope boxes by, overriding the study's own bodyPart. PACS
   * worklist rows carry no BodyPartExamined, so `study.bodyPart` is empty and
   * every region-scoped box (MR + "Brain", MR + "LS Spine", …) scores out of
   * the region matcher. Passing the region selected in the workspace's Region
   * section makes the boxes follow that choice.
   */
  bodyPart?: string | null;
  /** Compact chrome for Impression / Recommendation sections (Sections 5–6). */
  compact?: boolean;
  /** When set, only boxes whose anatomicalSection matches this anatomy chip. */
  anatomyFilter?: string | null;
  /**
   * The workspace's one box writer — `handleQuickToggle`. Required, not
   * optional: a strip that renders boxes with nothing behind the click is a
   * control that looks live and does nothing, and the write has to go through
   * the hook or it loses the ledger row's concept, the chip state, the undo
   * frame and the last-rendered copy the deselect branch needs.
   */
  onToggle: (
    box: QuickFinding,
    nowSelected: boolean,
    params?: QuickSelectParameterValues,
  ) => QuickToggleOutcome;
  /** Fired after a box is written into the report (e.g. silent draft save). */
  onAfterPick?: (field: QuickSelectField) => void;
  /**
   * Opens the workspace's existing structured-details dialog for a box whose
   * `questions_json` declares parameters the side/severity chips cannot supply
   * — `{size}`, `{location}`, `{volume}`, `{swelling}`, `{grade}`, `{vessel}`
   * and every other name outside the five `fillTemplate` tokens.
   *
   * A declared parameter is not a *resolved* one. The strip's own write path
   * (`onToggle` → `quickFindingPatch` → `applySideToIncoming`) substitutes only
   * side and severity, so a box clicked here with a `{size}` still in its prose
   * prints the literal brace into Findings. Routing the click to the same router
   * the rail and the Clinic panel already use (`studySetup.handleFindingClick`)
   * hands the box to `fillStructuredTemplate`, which fills every declared key
   * and drops any `[optional clause]` whose key is unanswered — so the text that
   * reaches the report is brace-free before it is ever written.
   *
   * Optional: a strip whose host has no dialog leaves every box on the chip
   * path, exactly as before. Favouriting, adding and editing never route here.
   */
  onStructuredPick?: (box: QuickFinding) => void;
  /**
   * Dim the boxes and stop a pick, for a report that cannot be written.
   *
   * Affordance, not safety: the store already refuses, and the strip stops
   * rewarding a refusal. This is the part the radiologist can see — every other
   * clinical control in the workspace dims on a signed report, and the strip was
   * the one that stayed clickable, sitting directly below a sibling that does
   * receive `disabled={contentLocked}`.
   *
   * Favouriting, adding and editing a box stay live. Those write the clinic
   * catalogue and the radiologist's own favorites, not the report, and a signed
   * report is no reason to stop someone reorganising their own boxes.
   */
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const study = useWorkspaceSelector((s) => s.studies.find((x) => x.id === s.activeStudyId));
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  // Technique is what says whether contrast was given (`mriBrainSequences.ts` treats it as the
  // workspace's single source of truth), so the strip has to read it to scope its own boxes.
  const techniqueText = useWorkspaceSelector((s) => s.techniqueText);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ box: QuickFinding | null } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const scopeBodyPart = bodyPart?.trim() || study?.bodyPart;

  // Priority 3 — Escape closes the open review panel, and nothing else. A
  // mouse click on a chip never focuses it, so the container's onKeyDown
  // cannot be the door: without this document listener a bare Escape fell
  // through to the workspace shortcut and COLLAPSED the Reporting Tools rail
  // the review was floating over (browser-demo defect). The workspace hook
  // yields the key first (escapeKeyOwner sees the open review panel), so the
  // only thing this listener ever dismisses is the review itself. A Radix
  // popup layer above it (ask-first dialog, popover, menu) still owns the key
  // and this listener steps aside — the dialog's own layer must answer.
  useEffect(() => {
    if (reviewId == null) return;
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      setReviewId(null);
    };
    document.addEventListener("keydown", onDocKey, true);
    return () => document.removeEventListener("keydown", onDocKey, true);
  }, [reviewId]);

  // The same query the Clinic Quick Select panel and `useReportingStudySetup`
  // already hold, at the same key and the same staleTime — so this is a cache
  // read, not a second request per section. Five strips on one workspace share
  // one catalogue.
  const { data } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });
  const { data: favoriteRows = [] } = useQuery<FavoriteRow[]>({
    queryKey: ["radiology-quick-favorites"],
    queryFn: () => api.get("/api/radiology/quick-select/favorites"),
    staleTime: 60_000,
  });
  const { data: usageRows = [] } = useQuery<UsageRow[]>({
    queryKey: ["radiology-quick-select-usage"],
    queryFn: () => api.get("/api/radiology/quick-select/usage"),
    staleTime: 60_000,
  });

  const boxes = useMemo<QuickSelectStripBox[]>(() => {
    const favorites = new Set(favoriteRows.map((r) => r.findingId));
    const uses = new Map(usageRows.map((r) => [r.findingId, r.useCount]));
    return (data?.findings ?? [])
      .filter((b) => b.isActive)
      .map((b) => ({ ...b, favorite: favorites.has(b.id), usageCount: uses.get(b.id) ?? 0 }));
  }, [data, favoriteRows, usageRows]);

  const scoped = useMemo(
    () => lookupBoxesForContext(boxes, field, study?.modality, reportingContext),
    [boxes, field, study?.modality, reportingContext],
  );
  // Plain / contrast compatibility. Region and modality are not the whole of what a box may say:
  // an "MRI Brain Plain" study used to be handed the same wall as a contrast one, including the
  // box that reads "Heterogeneously enhancing area in the right frontal operculum". A box whose own
  // prose asserts enhancement is not offered on a study that declares no contrast, and the strip
  // prints how many it withheld — this wall's Phase 1 complaint was boxes vanishing unexplained.
  const contrastStatus = studyContrastStatus({
    examName: study?.studyDescription,
    protocolName: reportingContext?.protocolName,
    techniqueText,
  });
  const { offered, withheld: contrastWithheld } = useMemo(
    () => withholdContrastOnlyBoxes(scoped, { modality: study?.modality, status: contrastStatus }),
    [scoped, study?.modality, contrastStatus],
  );
  const filtered = useMemo(() => {
    let pool = offered;
    if (anatomyFilter && field === "findings") {
      pool = pool.filter((b) => tileMatchesAnatomy(b.anatomicalSection ?? "", anatomyFilter));
    }
    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    return pool.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        quickSelectBoxSentence(b, field).toLowerCase().includes(q) ||
        (b.mnemonic ?? "").toLowerCase().includes(q),
    );
  }, [offered, search, anatomyFilter, field]);
  useEffect(() => {
    if (showSearch) setTimeout(() => ref.current?.focus(), 50);
  }, [showSearch]);

  // B-09 — the clinical parameters these boxes ask for, and the values chosen
  // for them. Neither has a default: an unset side does not mean "left", it
  // means the parameterized boxes refuse until someone chooses. The store
  // enforces that at the shared boundary; these chips are what make a refusal
  // answerable from the drawer the box was clicked in, rather than from the
  // Clinic Quick Select panel that lives in a different drawer and owns a
  // separate side control.
  //
  // Scanned over every sentence the box can write, which is the same set
  // `quickFindingPatch` declares laterality from and the same set the store's
  // refusal guard reads. Deriving the chips from one section and the guard from
  // four is how a box ends up asking for a side no chip offers.
  const requiredParameters = useMemo(() => {
    const names = new Set<QuickSelectParameterName>();
    for (const box of filtered) {
      for (const name of quickSelectParametersIn(quickSelectBoxWrittenText(box))) names.add(name);
    }
    return names;
  }, [filtered]);
  const [qsSide, setQsSide] = useState<Side | "">("");
  const [qsSeverity, setQsSeverity] = useState<QuickSelectSeverity | "">("");
  // Phase 3, item B — the level a parameterized spine box asks for. The input
  // offers the standard spine levels as a datalist but accepts free text,
  // because the boundary's grammar check (resolvedQuickSelectLevel) is what
  // actually decides; an invalid level refuses the click with a toast that
  // names the expected shape, never a guessed anatomy.
  const [qsLevel, setQsLevel] = useState("");
  const activeStudyId = study?.id;
  useEffect(() => {
    // A chip value is this examination's answer to a box that asked for it. The
    // strip is not remounted when the next study opens — the route reuses the
    // workspace instance and only swaps the `studyId` prop — so without this the
    // side, severity or level chosen for patient A is the value patient B's
    // parameterized tile silently accepts, and it substitutes straight into B's
    // Findings. Reset on switch, never defaulted.
    setQsSide("");
    setQsSeverity("");
    setQsLevel("");
  }, [activeStudyId]);
  const paramChip = (active: boolean) =>
    `text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background text-muted-foreground hover:bg-muted/50"
    }`;

  const toggleFavorite = useMutation({
    mutationFn: ({ findingId, add }: { findingId: number; add: boolean }) =>
      add
        ? api.post(`/api/radiology/quick-select/favorites/${findingId}`, {})
        : api.delete(`/api/radiology/quick-select/favorites/${findingId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-quick-favorites"] }),
  });

  // The counter used to live in localStorage, so it counted the browser and not
  // the radiologist, and it rewarded a refused click. Now it is the server's own
  // per-user row, written only for a click that landed.
  const countUse = useMutation({
    mutationFn: (findingId: number) =>
      api.post<UsageRow>(`/api/radiology/quick-select/usage/${findingId}`, {}),
    onSuccess: (row) => {
      if (!row?.findingId) return;
      qc.setQueryData<UsageRow[]>(["radiology-quick-select-usage"], (prev) => {
        const rest = (prev ?? []).filter((r) => r.findingId !== row.findingId);
        return [...rest, row];
      });
    },
    // A usage count must never be able to fail the click that triggered it.
    onError: () => {},
  });

  // Phase 3, item E — the tile rail is keyboard-navigable. The tiles used to be
  // plain <div onClick>: Tab skipped every one of them. Roving focus now puts
  // exactly ONE tab stop in the rail; Arrow/Home/End move it, Enter/Space
  // activate the same door the click uses, Escape gives the focus back. The
  // model is pure (quickSelectKeyboardNavigation) so the semantics are pinned
  // by unit tests, and every key it does not own is returned to the browser.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const tilesRef = useRef<HTMLDivElement | null>(null);
  const focusTileAt = (index: number) => {
    setFocusIndex(index);
    tilesRef.current
      ?.querySelector<HTMLDivElement>(`[data-qs-focus-index="${index}"]`)
      ?.focus();
  };
  const onTilesKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Inner controls (favorite/review/edit buttons) own their own keys — an
    // Enter pressed on the favorite star must favorite, not activate the tile.
    if ((e.target as HTMLElement).closest("button")) return;
    const nav = quickSelectKeyNav(e.key, { index: focusIndex, count: filtered.length });
    if (nav.action === "none") return;
    e.preventDefault();
    if (nav.action === "move") {
      focusTileAt(nav.index);
      return;
    }
    if (nav.action === "exit") {
      setFocusIndex(null);
      tilesRef.current?.parentElement?.querySelector<HTMLInputElement>("input[aria-label='Quick select search']")?.focus();
      return;
    }
    // activate — the SAME door the click uses: review when the box is already on
    // the page, pick when it is not. Never a second write path.
    const box = filtered[nav.index];
    if (!box) return;
    const isOnPage = useWorkspace
      .getState()
      .appliedPathologyPatches.some((p) => quickFindingRowBelongsTo(p.id, box.id));
    if (isOnPage) {
      setReviewId(reviewId === box.id ? null : box.id);
    } else {
      pick(box);
    }
  };

  const pick = (box: QuickSelectStripBox) => {
    // A box that declares parameters beyond side/severity is written by the
    // dialog, not here. Opening the dialog has written nothing yet, so it is
    // deliberately NOT a use and does NOT fire `onAfterPick` (the findings
    // feedback and the silent draft save) — a click that only raised a form is
    // not a report change, and cancelling it must leave the report untouched.
    // `handleFindingClick` falls through to the plain toggle for a box with no
    // declared questions, so this guard is the same predicate the router uses.
    if (onStructuredPick && parseQuestions(box.questionsJson).length > 0) {
      onStructuredPick(box);
      return;
    }
    const outcome = onToggle(box, true, { side: qsSide, severity: qsSeverity, level: qsLevel });
    if (outcome === "refused") return;
    // Skipped on a refusal, and it matters twice over: `onAfterPick` is
    // `feedbackAfterAbnormalApply()` at the findings strip — positive feedback
    // for a write that did not happen — and `void saveDraft({ silent: true })`
    // at the impression and recommendation strips, so a refused click also
    // fired a save the server is certain to refuse. "pending" is a real pick
    // queued for same-slot confirmation, so it still counts.
    countUse.mutate(box.id);
    onAfterPick?.(field);
  };

  // The editor's Study Type select only lists real tabs and the create route
  // refuses a box whose region resolves to none, so a region that is not a tab
  // (a widened "Whole Spine", an unresolved PACS row) falls back to the first
  // tab rather than opening a form that cannot save.
  const tabs: QuickStudyTab[] = data?.tabs ?? [];
  const activeTabs = useMemo(() => tabs.filter((t) => t.isActive), [tabs]);
  const region = reportingContext.region || scopeBodyPart || "";
  const editorStudyType = activeTabs.some((t) => t.name === region)
    ? region
    : activeTabs[0]?.name ?? "";

  if (!study) {
    return (
      <div
        className={cn("text-[10px] text-muted-foreground", compact ? "mb-1" : "mb-2")}
        data-testid={`quick-select-strip-${field}${compact ? "-compact" : ""}`}
      >
        <span className={cn("font-bold uppercase tracking-wider", FIELD_ACCENT[field])}>
          {LABELS[field]} Quick Select · select a study
        </span>
      </div>
    );
  }

  const reviewed = reviewId == null ? null : filtered.find((b) => b.id === reviewId) ?? null;

  return (
    <div
      className={cn(
        "relative",
        compact
          ? "mb-1.5 rounded-lg border border-slate-200/80 bg-slate-50/50 p-1.5"
          : "mb-2.5 rounded-xl border border-white/60 bg-gradient-to-r from-white/80 via-slate-50/40 to-white/80 p-2 shadow-sm shadow-slate-200/40",
      )}
      data-testid={`quick-select-strip-${field}${compact ? "-compact" : ""}`}
    >
      <div className={cn("flex items-center justify-between gap-2", compact ? "mb-1" : "mb-1.5")}>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className={cn("font-bold uppercase tracking-wider", FIELD_ACCENT[field])}>
            {compact ? LABELS[field] : `${LABELS[field]} Quick Select`}
          </span>
          {!compact && (
            <>
              <span className={cn("rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold", FIELD_PILL[field])}>
                {study.modality} · {region || "unresolved"}
              </span>
              <span
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600"
                data-testid={`qs-count-${field}`}
              >
                {/* Offered, not held by the catalogue — this once read the unscoped
                    list and printed "56 tiles" above an empty row. */}
                {filtered.length} boxes
              </span>
              {contrastWithheld.length > 0 && (
                <span
                  className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-900"
                  data-testid={`qs-contrast-withheld-${field}`}
                  title={contrastWithheld.map((b) => b.label).join(", ")}
                >
                  {contrastWithheld.length} contrast-only box
                  {contrastWithheld.length > 1 ? "es" : ""} not offered — this study is reported
                  without contrast
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {showSearch ? (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-violet-500" />
              <input
                ref={ref}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setShowSearch(false)}
                placeholder="Search..."
                className="h-7 w-44 rounded-full border border-violet-300 bg-white pl-6 pr-6 text-[11px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearch("");
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              {!compact && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[10px] hover:bg-violet-50 hover:text-violet-700"
                  onClick={() => setShowSearch(true)}
                >
                  <Search className="h-3 w-3" />
                </Button>
              )}
              <button
                type="button"
                onClick={() => setEditing({ box: null })}
                className="inline-flex h-6 items-center gap-0.5 rounded-md border border-dashed border-violet-300/80 px-1.5 text-[9px] font-semibold text-violet-700 hover:bg-violet-50"
                title={`Add / edit ${LABELS[field]} boxes`}
                data-testid={`qs-edit-${field}`}
              >
                <Plus className="h-2.5 w-2.5" />
                <Pencil className="h-2.5 w-2.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {requiredParameters.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-1 pb-1.5"
          data-testid={`qs-parameters-${field}`}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {field === "findings" ? "These boxes need" : "This box needs"}
          </span>
          {requiredParameters.has("side") && (["left", "right", "bilateral"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={paramChip(qsSide === s)}
              disabled={disabled}
              data-testid={`qs-side-${s}`}
              onClick={() => setQsSide(qsSide === s ? "" : s)}
            >
              {s === "bilateral" ? "B/L" : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          {requiredParameters.has("severity") && QUICK_SELECT_SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              className={paramChip(qsSeverity === s)}
              disabled={disabled}
              data-testid={`qs-severity-${s}`}
              onClick={() => setQsSeverity(qsSeverity === s ? "" : s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          {requiredParameters.has("level") && (
            <>
              <input
                list="qs-level-options"
                value={qsLevel}
                disabled={disabled}
                placeholder="Level (e.g. L2-L3)"
                data-testid="qs-level-input"
                aria-label="Spine level for the level-parameterised boxes"
                onChange={(e) => setQsLevel(e.target.value)}
                className="h-5 w-24 text-[9px] border rounded px-1 bg-background"
              />
              <datalist id="qs-level-options">
                {STANDARD_SPINE_LEVELS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </>
          )}
        </div>
      )}
      <div
        ref={tilesRef}
        onKeyDown={onTilesKeyDown}
        className={cn("flex flex-wrap gap-1 overflow-y-auto pr-1", compact ? "max-h-[72px]" : "max-h-[104px] gap-1.5")}
        data-testid={`qs-tiles-${field}`}
        role="group"
        aria-label={`${LABELS[field]} Quick Select tiles — arrow keys move, Enter selects, Escape leaves`}
      >
        {filtered.map((box, i) => (
          <QuickSelectBoxChip
            key={box.id}
            chipPosition={i}
            focusTabIndex={quickSelectRovingTabIndex(focusIndex, i)}
            box={box}
            field={field}
            side={qsSide}
            disabled={disabled}
            reviewing={reviewId === box.id}
            onPick={() => pick(box)}
            onReview={() => setReviewId(reviewId === box.id ? null : box.id)}
            onFav={() => toggleFavorite.mutate({ findingId: box.id, add: !box.favorite })}
            onEdit={() => setEditing({ box })}
          />
        ))}
        {!compact && (
          <button
            onClick={() => setEditing({ box: null })}
            className="inline-flex items-center gap-1 rounded-xl border-2 border-dashed border-violet-300/70 bg-gradient-to-br from-violet-50 to-fuchsia-50/50 px-2.5 py-1.5 text-[10.5px] font-semibold text-violet-700 transition hover:border-violet-500 hover:bg-violet-100/80 hover:text-violet-900"
          >
            <Plus className="h-3 w-3" />
            <span>Add box</span>
            <ChevronRight className="h-2.5 w-2.5 opacity-50" />
          </button>
        )}
      </div>
      {reviewed && (
        <QuickSelectReview
          box={reviewed}
          field={field}
          side={qsSide}
          disabled={disabled}
          onClose={() => setReviewId(null)}
          onRemove={() => {
            onToggle(reviewed, false, { side: qsSide, severity: qsSeverity });
            setReviewId(null);
          }}
        />
      )}
      {editing && (
        <WorkspaceQuickFindingEditor
          finding={editing.box}
          tabs={activeTabs}
          defaultStudyType={editorStudyType}
          defaultField={field}
          onClose={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
          }}
        />
      )}
    </div>
  );
}

function QuickSelectBoxChip({
  box,
  field,
  side,
  chipPosition,
  focusTabIndex,
  reviewing,
  onPick,
  onReview,
  onFav,
  onEdit,
  disabled = false,
}: {
  box: QuickSelectStripBox;
  field: QuickSelectField;
  side: string;
  /** This tile's render position — the key the container focuses through. */
  chipPosition?: number;
  /** Roving tabIndex (Phase 3, item E): 0 for the one focused tile, -1 for the rest. */
  focusTabIndex?: number;
  reviewing: boolean;
  onPick: () => void;
  onReview: () => void;
  onFav: () => void;
  onEdit: () => void;
  disabled?: boolean;
}) {
  const rawCategory = (box.category ?? "").trim();
  const cat = rawCategory in CAT_TILE ? rawCategory : "unrated";
  // Two lookups, on purpose. "selected" means this box is on the page, and since
  // a sided box writes one row per side, an exact-id lookup alone would show an
  // applied box as idle the moment the radiologist moved the side chip. But the
  // CLICK has to read the exact row: Left and Right of one box are two claims at
  // two slots, so a box applied at Left with Right now chosen must still apply —
  // opening the review instead would leave no way to record the other side.
  const exact = useWorkspaceSelector((s) => {
    // A box that never asked which side has one row, not two — see
    // `quickSelectBoxAsksForSide`. Appending the chip's side here is what left an
    // applied box reading as "selected at the other side" with nothing to click.
    const wanted = quickFindingRowId(box.id, quickSelectBoxAsksForSide(box) ? side : "");
    return s.appliedPathologyPatches.find((p) => p.id === wanted);
  });
  const anySide = useWorkspaceSelector((s) =>
    s.appliedPathologyPatches.find((p) => quickFindingRowBelongsTo(p.id, box.id)),
  );
  const patch = exact ?? anySide;
  const findings = useWorkspaceSelector((s) => s.findingsText);
  const findingsProv = useWorkspaceSelector((s) => s.fieldProvenance.findings);
  const blockedChip = Boolean(patch && field === "findings" && patchFindingsContributionBlocked(patch, findings));
  // Priority 3 — an amber tile must tell the truth about WHY its wording is
  // off the page. "blocked-manual-kept" used to be the label for EVERY
  // byte-absence, including absences the ENGINE caused (another tile's overlay
  // reworded or re-anchored the sentence), which read as "the radiologist edited
  // this" when nobody had. The provenance map is the honest judge: a sentence
  // still owned by manual/voice really was hand-edited; anything else was
  // changed by an engine action and owes the radiologist a review, not an
  // accusation.
  const blockedChipManual = Boolean(
    blockedChip && patch && contributionProtected(patch.lastRendered.findings, findingsProv),
  );
  // A box nobody has assigned a concept to is a permanent, legitimate state, not
  // a gap to paper over: it writes its prose exactly as authored and simply
  // cannot conclude or supersede a scaffold normal. That is worth saying out
  // loud, and worth never blocking on.
  const conceptless = !(box.concept ?? "").trim();
  const sentence = quickSelectBoxSentence(box, field);
  // ── Phase 3, item C — the pre-click retirement hint (store read-only) ──────
  // The same hover that shows what a box writes now also shows what it will
  // REPLACE: which live normal statement the click retires, and which in-slot
  // sibling wording it upgrades. `previewPathologyOverlay` is the read-only half
  // of the apply path (same observation builder, same refusal guards, same
  // falsifies oracle), so the promise on hover is the promise the click keeps.
  // Computed only for an idle findings box over a report that has content —
  // the only state where a hover can reveal something the page is about to lose.
  const retirementHint = useMemo(() => {
    if (disabled || exact || anySide || field !== "findings" || conceptless) return "";
    if (!findings.trim()) return "";
    const preview = useWorkspace.getState().previewPathologyOverlay(
      quickFindingPatch(box, { region: box.studyType }, { side: (side || "") as Side }),
    );
    if (preview.refusal || preview.nothingRetires) return "";
    return describeRetirementPreviewLine(preview);
  }, [disabled, exact, anySide, field, conceptless, findings, box, side]);
  const state = blockedChip
    ? "blocked-manual-kept"
    : exact
      ? "selected"
      : anySide
        ? "selected-other-side"
        : "idle";
  // Phase 3, item E — a real tab stop: role + the container's roving tabIndex +
  // the position key the container's keydown handler focuses through. The
  // click door is unchanged; Enter/Space activate through the container handler.
  return (
    <div
      role="button"
      tabIndex={focusTabIndex ?? -1}
      data-qs-focus-index={chipPosition}
      className={cn(
        "group relative inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10.5px] transition duration-150",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        CAT_TILE[cat],
        blockedChip && "ring-1 ring-amber-400",
        !blockedChip && !exact && anySide && "ring-1 ring-sky-400",
        reviewing && "ring-2 ring-violet-500",
      )}
      // A box already on the page at THIS side reviews instead of re-applying:
      // re-applying is a no-op the ledger folds, and a radiologist who clicks a
      // lit chip is asking what it wrote, not asking for it twice. A box lit at
      // another side still applies, because Left and Right of one box are two
      // claims at two slots and the review would be the only way left to record
      // the second one.
      onClick={disabled ? undefined : exact ? onReview : onPick}
      title={
        disabled
          ? `${sentence} — this report is signed`
          : blockedChip
            ? blockedChipManual
              ? `${sentence} — your edited wording was kept; this tile's original sentence is no longer on the page. Click to review.`
              : `${sentence} — this tile's wording is not on the page as written (changed by another report action). Click to review.`
            : exact
              ? `${sentence} — on the page; click to review`
              : anySide
                ? `${sentence} — on the page at another side; click to add ${side || "this"} side`
                : retirementHint
                  ? `${sentence}\n${retirementHint}`
                  : conceptless
                    ? `${sentence} — no clinical concept: writes its wording only`
                    : sentence
      }
      data-testid={`qs-tile-${field}-${box.id}`}
      data-chip-state={state}
      data-box-concept={conceptless ? "none" : "owned"}
    >
      <span className={cn("h-2 w-2 flex-none rounded-full shadow-sm", blockedChip ? "bg-amber-400 shadow-amber-300/60" : CAT_DOT[cat])} />
      <span className="max-w-[150px] truncate font-bold tracking-tight">{box.label}</span>
      {box.mnemonic ? (
        <span className={cn("rounded-md border px-1 font-mono text-[8px] uppercase", CAT_BADGE[cat])}>
          {box.mnemonic}
        </span>
      ) : null}
      {conceptless && (
        <AlertTriangle
          className="h-2.5 w-2.5 flex-none text-slate-400"
          aria-label="No clinical concept — writes its wording only"
        />
      )}
      {box.usageCount > 3 && (
        <span className="rounded-md bg-white/80 px-0.5 font-mono text-[8px] text-slate-600">{box.usageCount}</span>
      )}
      <div className="ml-0.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {patch && !disabled && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            aria-label={`Review ${box.label}`}
            className="rounded-md p-0.5 text-slate-400 hover:bg-white/70 hover:text-violet-700"
          >
            <Search className="h-2.5 w-2.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
          aria-label={box.favorite ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "rounded-md p-0.5 hover:bg-white/70",
            box.favorite ? "text-amber-500" : "text-slate-400 hover:text-amber-500",
          )}
        >
          <Star className={cn("h-2.5 w-2.5", box.favorite && "fill-current")} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Edit ${box.label}`}
          className="rounded-md p-0.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>
      {box.favorite && <Star className="ml-0.5 h-2.5 w-2.5 fill-amber-400 text-amber-400 group-hover:hidden" />}
    </div>
  );
}

/**
 * What a lit box actually wrote, and the one control that takes it back.
 *
 * Read from the ledger row's own `lastRendered`, not from the box's columns: the
 * row records the wording that reached the page after side and severity were
 * resolved, so a review that read the template would show "{side}" over a
 * sentence that says "left".
 */
function QuickSelectReview({
  box,
  field,
  side,
  disabled,
  onClose,
  onRemove,
}: {
  box: QuickSelectStripBox;
  field: QuickSelectField;
  side: string;
  disabled: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const rowId = quickFindingRowId(box.id, quickSelectBoxAsksForSide(box) ? side : "");
  const patch = useWorkspaceSelector((s) => s.appliedPathologyPatches.find((p) => p.id === rowId));
  const findings = useWorkspaceSelector((s) => s.findingsText);
  const findingsProv = useWorkspaceSelector((s) => s.fieldProvenance.findings);
  const blocked = Boolean(patch && patchFindingsContributionBlocked(patch, findings));
  const blockedManual = Boolean(
    blocked && patch && contributionProtected(patch.lastRendered.findings, findingsProv),
  );
  const written = REVIEW_SECTIONS.map((sec) => ({
    ...sec,
    text: (patch?.lastRendered?.[sec.key] ?? "").trim(),
  })).filter((sec) => sec.text.length > 0);
  const conceptless = !(box.concept ?? "").trim();
  return (
    <div
      className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-violet-200 bg-white p-2 shadow-lg shadow-slate-300/40"
      data-testid={`qs-review-${field}-${box.id}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold text-slate-800">{box.label}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {/* The chip's side is this box's side only when the chip is what keyed its row. A box
                that asked for the side in its own details form writes the answer into the sentence
                below, so naming the chip here would contradict the finding it shows — measured as
                "RIGHT SIDE" printed above "Midline shift … to the left". */}
            {LABELS[field]} box
            {quickSelectBoxAsksForSide(box) ? ` · ${side ? `${side} side` : "no side"}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close review"
          className="rounded p-0.5 text-muted-foreground hover:bg-slate-100 hover:text-rose-600"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {written.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          This box has no row in the report ledger for {side ? `the ${side} side` : "this side"}.
        </p>
      ) : (
        <ul className="space-y-1">
          {written.map((sec) => (
            <li key={sec.key} className="text-[10px] leading-snug">
              <span className="mr-1 font-semibold uppercase tracking-wider text-slate-500">{sec.label}:</span>
              <span className="text-slate-700">{sec.text}</span>
            </li>
          ))}
        </ul>
      )}
      {blocked && (
        <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">
          {blockedManual
            ? "You edited this wording. Removing the box keeps your edit and drops only what it still owns."
            : "This tile's wording is not on the page as written — another report action changed it. Removing the box drops only what it still owns; the changed wording stays until you edit it."}
        </p>
      )}
      {conceptless && (
        <p className="mt-1.5 flex items-start gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600">
          <AlertTriangle className="mt-px h-3 w-3 flex-none text-slate-400" />
          <span>
            No clinical concept, so this box writes its own wording only — it cannot draw a conclusion
            in the Impression or retire a normal report. That is not a fault and nothing is blocked.
          </span>
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onClose}>
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 border-rose-200 px-2 text-[10px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          disabled={disabled}
          onClick={onRemove}
          data-testid={`qs-remove-${field}-${box.id}`}
        >
          <Trash2 className="mr-1 h-2.5 w-2.5" />
          Remove from report
        </Button>
      </div>
    </div>
  );
}
