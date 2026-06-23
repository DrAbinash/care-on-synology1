import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import { loadDicomQrPaperSize, persistDicomQrPaperSize, type PaperOrientation } from "@/lib/paperSize";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Search, RefreshCw, CalendarDays, MonitorPlay, Tv2, Copy,
  CheckCircle2, AlertCircle, Download, Shield, Server,
  WifiOff, Filter, XCircle, Activity, BookmarkPlus, Bookmark, Trash2, ChevronDown,
  Database, Radio, Info, FileDown, Pencil, Check, X, Printer,
  GripVertical, ChevronUp,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type DicomPresetFilters = {
  dateFrom: string;
  dateTo: string;
  modalities: string[];
  patientName: string;
  accessionNumber: string;
  referringDoctor: string;
  studyDescription: string;
  aeTitle: string;
};

type DicomPreset = {
  id: string;
  name: string;
  filters: DicomPresetFilters;
  createdAt: string;
  updatedAt?: string;
};

/**
 * Tombstone: marks a preset as deleted on this device so the delete can win
 * over stale copies on other devices during cross-device sync.
 */
type DicomTombstone = {
  id: string;
  deleted: true;
  updatedAt: string;
};

/** Union of an active preset and a deletion tombstone. */
type DicomEntry = DicomPreset | DicomTombstone;

function isActive(e: DicomEntry): e is DicomPreset {
  return !("deleted" in e);
}

function entryTs(e: DicomEntry): string {
  return "deleted" in e ? e.updatedAt : (e.updatedAt ?? e.createdAt);
}

function getPresetKey(userId?: number): string {
  return `dicom_qr_presets_${userId ?? "anon"}`;
}

/** Load all entries (active presets + tombstones) from localStorage. */
function loadEntries(userId?: number): DicomEntry[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(getPresetKey(userId)) : null;
    if (!raw) return [];
    return JSON.parse(raw) as DicomEntry[];
  } catch {
    return [];
  }
}

/** Load only active presets from localStorage (filters out tombstones). */
function loadPresets(userId?: number): DicomPreset[] {
  return loadEntries(userId).filter(isActive);
}

/** Persist all entries (active presets + tombstones) to localStorage. */
function persistEntries(entries: DicomEntry[], userId?: number): void {
  try {
    window.localStorage.setItem(getPresetKey(userId), JSON.stringify(entries));
  } catch { /* ignore quota errors */ }
}


/**
 * Merge server and local entry lists using per-entry last-write-wins on updatedAt,
 * with correct ordering semantics.
 *
 * Content merge (which version of each entry to keep):
 *   For each preset ID seen on either side, the entry with the newer `updatedAt`
 *   (falling back to `createdAt` for pre-existing presets) wins. If the winner is
 *   a tombstone, the preset is treated as deleted.
 *
 * Order merge (which sequence to use):
 *   The side whose most-recent entry timestamp is larger wins the right to dictate
 *   list order. This means offline reorders (which bump `updatedAt` on the moved
 *   presets) propagate correctly — the reordered side has a newer max timestamp and
 *   its sequence is used as the base. Content winners from the other side are then
 *   substituted at those positions.
 *
 * Entries that only exist on one side (created/deleted offline) are appended after
 * the ordered block in their original sequence.
 */
function mergeEntries(serverEntries: DicomEntry[], localEntries: DicomEntry[]): DicomEntry[] {
  const serverById = new Map(serverEntries.map((e) => [e.id, e]));
  const localById  = new Map(localEntries.map((e) => [e.id, e]));

  // Step 1 — content merge: for each ID, pick the version with the newer timestamp.
  const contentWinners = new Map<string, DicomEntry>();
  for (const [id, se] of serverById) {
    const le = localById.get(id);
    contentWinners.set(id, le && entryTs(le) > entryTs(se) ? le : se);
  }
  for (const [id, le] of localById) {
    if (!serverById.has(id)) contentWinners.set(id, le);
  }

  // Step 2 — order merge: whichever side has the newer max timestamp provides the
  // base sequence. ISO-8601 strings compare correctly as plain strings.
  const maxTs = (entries: DicomEntry[]) =>
    entries.reduce((best, e) => (entryTs(e) > best ? entryTs(e) : best), "");

  const baseOrder = maxTs(localEntries) > maxTs(serverEntries) ? localEntries : serverEntries;

  // Step 3 — reconstruct: place content winners in base-order positions.
  const result: DicomEntry[] = [];
  const placed = new Set<string>();
  for (const base of baseOrder) {
    const winner = contentWinners.get(base.id);
    if (winner && !placed.has(base.id)) {
      result.push(winner);
      placed.add(base.id);
    }
  }

  // Step 4 — append entries present only on the other side (not in baseOrder).
  for (const [id, entry] of contentWinners) {
    if (!placed.has(id)) result.push(entry);
  }

  return result;
}

/**
 * Build the full sync payload: active presets + all stored tombstones.
 * Pass `newTombstone` when a preset was just deleted on this device so the
 * tombstone is created (or refreshed) before writing to storage / pushing to server.
 */
function buildSyncEntries(
  activePresets: DicomPreset[],
  userId: number | undefined,
  newTombstone?: DicomTombstone,
): DicomEntry[] {
  const existingTombstones = loadEntries(userId).filter(
    (e): e is DicomTombstone => !isActive(e),
  );
  const tombstoneMap = new Map(existingTombstones.map((t) => [t.id, t]));
  if (newTombstone) tombstoneMap.set(newTombstone.id, newTombstone);
  // Remove any tombstone whose preset was just re-created as active.
  for (const p of activePresets) tombstoneMap.delete(p.id);
  return [...activePresets, ...tombstoneMap.values()];
}

type StudyRow = {
  id: number;
  accessionNumber: string;
  studyInstanceUID: string | null;
  modality: string;
  studyDate: string;
  studyDescription: string | null;
  referringDoctor: string | null;
  status: string;
  scheduledStationAETitle: string | null;
  patientId: number;
  patientName: string;
  pullStatus: string | null;
  pulledAt: string | null;
  source?: string;
};

type QueryResult = {
  studies: StudyRow[];
  total: number;
  limit: number;
  offset: number;
  source?: string;
  dcmtkHint?: string | null;
};

type SearchMode = "local-db" | "live-pacs";

type Doctor = { id: number; name: string };

type ClinicSettings = {
  name?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoDataUrl?: string | null;
};

type PacsHealth = {
  pendingRetries: number;
  totalActiveModalities: number;
  healthyModalities: number;
  pulledToday: Record<string, number>;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  const parts = s.split("-");
  if (parts.length !== 3) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parts[2]} ${months[Number(parts[1]) - 1]} ${parts[0]}`;
}

const MODALITIES = ["MR", "CT", "CR", "DX", "US", "MG", "XA", "NM", "PT", "OT"];

const PULL_STATUS: Record<string, { label: string; cls: string }> = {
  RETRIEVE_REQUESTED: { label: "QUEUED",     cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  NEW:                { label: "QUEUED",     cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  PULLED:             { label: "PULLED",     cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  PUSHED_TO_PACS:     { label: "IN PACS",    cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  FAILED:             { label: "FAILED",     cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  DUPLICATE_SKIPPED:  { label: "DUPLICATE",  cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
};

const MOD_COLORS: Record<string, string> = {
  MR: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  CT: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  CR: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  DX: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  US: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  MG: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  XA: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  NM: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
  PT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const LIMIT = 50;

// ── Main Component ─────────────────────────────────────────────────────────────

export default function DicomQueryRetrieve() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const session = readStaffSession();
  const userId  = session?.user.id;

  const [dateFrom, setDateFrom]     = useState(localDate());
  const [dateTo, setDateTo]         = useState(localDate());
  const [selMods, setSelMods]       = useState<Set<string>>(new Set());
  const [patientName, setPatientName]         = useState("");
  const [accessionNumber, setAccessionNumber] = useState("");
  const [referringDoctor, setReferringDoctor] = useState("");
  const [studyDescription, setStudyDescription] = useState("");
  const [aeTitle, setAeTitle]       = useState("");

  const [applied, setApplied] = useState<{
    dateFrom: string; dateTo: string; modalities: string[];
    patientName: string; accessionNumber: string; referringDoctor: string;
    studyDescription: string; aeTitle: string;
  }>({
    dateFrom: localDate(), dateTo: localDate(), modalities: [],
    patientName: "", accessionNumber: "", referringDoctor: "",
    studyDescription: "", aeTitle: "",
  });

  const [searchMode, setSearchMode] = useState<SearchMode>("local-db");

  const [page, setPage]           = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [paperOrientation, setPaperOrientation] = useState<PaperOrientation>(() => loadDicomQrPaperSize(userId));

  // ── Preset state ──────────────────────────────────────────────────────────────
  // Initialize from localStorage for instant load; the API query below will
  // replace with server data (source of truth) once it resolves.
  const [presets, setPresets]         = useState<DicomPreset[]>(() => loadPresets(userId));
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [showSaveInput, setShowSaveInput]   = useState(false);
  const [renamingId, setRenamingId]         = useState<string | null>(null);
  const [renameValue, setRenameValue]       = useState("");
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const saveInputRef  = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dragSrcIdx    = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // Close preset dropdown when clicking outside
  useEffect(() => {
    if (!showPresetMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setShowPresetMenu(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showPresetMenu]);

  // Reset to the new user's localStorage cache when the signed-in user changes.
  // The server query below will then refresh from the API.
  useEffect(() => {
    setPresets(loadPresets(userId));
    void queryClient.invalidateQueries({ queryKey: ["dicom-presets"] });
  }, [userId, queryClient]);

  // Reload paper orientation preference when the signed-in user changes.
  useEffect(() => {
    setPaperOrientation(loadDicomQrPaperSize(userId));
  }, [userId]);

  // Focus save input when it appears
  useEffect(() => {
    if (showSaveInput) saveInputRef.current?.focus();
  }, [showSaveInput]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  // Load presets from server — source of truth across devices.
  // Runs only when a user is logged in. On success (via useEffect below),
  // replace local state and update the localStorage cache for offline access.
  // The payload includes both active presets and tombstones (deleted markers).
  const { data: serverPresetsData } = useQuery<{ presets: DicomEntry[] }>({
    queryKey: ["dicom-presets", userId],
    queryFn: () => api.get<{ presets: DicomEntry[] }>("/api/users/me/dicom-presets"),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const syncPresetsMut = useMutation({
    mutationFn: (entries: DicomEntry[]) =>
      api.put<{ ok: boolean; count: number }>("/api/users/me/dicom-presets", { presets: entries }),
    onError: () => toast({ title: "Could not sync presets to server", variant: "destructive" }),
  });

  // React Query v5: use useEffect to react to query result changes.
  // Per-entry last-write-wins merge: compare each preset/tombstone's updatedAt so
  // changes made on different devices are combined rather than one device's list
  // overwriting the other. Tombstones allow deletes to propagate across devices.
  useEffect(() => {
    if (!serverPresetsData) return;
    const localEntries = loadEntries(userId);
    const merged = mergeEntries(serverPresetsData.presets, localEntries);
    setPresets(merged.filter(isActive));
    persistEntries(merged, userId);
    // If the merge differs from the server, push the result back so the server
    // reflects any locally-created presets or tombstones.
    const needsSync =
      merged.length !== serverPresetsData.presets.length ||
      merged.some((m, i) => {
        const s = serverPresetsData.presets[i];
        return !s || m.id !== s.id || entryTs(m) !== entryTs(s);
      });
    if (needsSync) {
      syncPresetsMut.mutate(merged);
    }
  // syncPresetsMut.mutate is stable across renders (useMutation guarantee)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPresetsData, userId]);

  const { data, isLoading, isFetching, refetch } = useQuery<QueryResult>({
    queryKey: ["dicom-query", applied, page, searchMode],
    queryFn: () => {
      const p = new URLSearchParams({
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        limit: String(LIMIT),
        offset: String((page - 1) * LIMIT),
      });
      if (applied.modalities.length)    p.set("modality",          applied.modalities.join(","));
      if (applied.patientName)          p.set("patientName",        applied.patientName);
      if (applied.accessionNumber)      p.set("accessionNumber",    applied.accessionNumber);
      if (applied.referringDoctor)      p.set("referringDoctor",    applied.referringDoctor);
      if (applied.studyDescription)     p.set("studyDescription",   applied.studyDescription);
      if (applied.aeTitle && searchMode === "local-db")
                                        p.set("aeTitle",            applied.aeTitle);
      const endpoint = searchMode === "live-pacs"
        ? `/api/radiology/qr-cfind?${p}`
        : `/api/radiology/dicom-query?${p}`;
      return api.get<QueryResult>(endpoint);
    },
  });

  const { data: doctors } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn:  () => api.get<Doctor[]>("/api/doctors"),
  });

  const { data: health } = useQuery<PacsHealth>({
    queryKey: ["pacs-health-qr"],
    queryFn:  () => api.get("/api/radiology/pacs-dashboard-ext"),
    refetchInterval: 30_000,
  });

  const { data: clinicSettings } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn:  () => api.get<ClinicSettings>("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const retrieveMut = useMutation({
    mutationFn: (studies: StudyRow[]) =>
      api.post<{ count: number }>("/api/radiology/dicom-retrieve/bulk", {
        studies: studies.map((s) => ({
          studyInstanceUID: s.studyInstanceUID ?? undefined,
          accessionNumber:  s.accessionNumber,
          modality:         s.modality,
          patientName:      s.patientName,
          patientId:        String(s.patientId),
          studyDate:        s.studyDate,
        })),
      }),
    onSuccess: (res) => {
      toast({ title: `Queued ${res.count} studies for retrieval`, description: "The pull agent picks them up on its next cycle." });
      void refetch();
      setSelectedIds(new Set());
    },
    onError: () => toast({ title: "Retrieve request failed", variant: "destructive" }),
  });

  // ── Derived ───────────────────────────────────────────────────────────────────

  const studies    = data?.studies ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const selectedStudies = studies.filter((s) => selectedIds.has(s.id));

  const healthyMods = health?.healthyModalities ?? 0;
  const totalMods   = health?.totalActiveModalities ?? 0;
  const failedQueue = health?.pendingRetries ?? 0;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const applyFilters = useCallback(() => {
    setApplied({
      dateFrom, dateTo, modalities: Array.from(selMods),
      patientName, accessionNumber, referringDoctor, studyDescription, aeTitle,
    });
    setPage(1);
    setSelectedIds(new Set());
  }, [dateFrom, dateTo, selMods, patientName, accessionNumber, referringDoctor, studyDescription, aeTitle]);

  const applyQuickDate = useCallback((offset: number) => {
    const d = localDate(offset);
    setDateFrom(d);
    setDateTo(d);
    setApplied((prev) => ({ ...prev, dateFrom: d, dateTo: d }));
    setPage(1);
    setSelectedIds(new Set());
  }, []);

  const clearAll = useCallback(() => {
    const d = localDate();
    setDateFrom(d); setDateTo(d);
    setSelMods(new Set());
    setPatientName(""); setAccessionNumber("");
    setReferringDoctor(""); setStudyDescription(""); setAeTitle("");
    setApplied({
      dateFrom: d, dateTo: d, modalities: [],
      patientName: "", accessionNumber: "", referringDoctor: "",
      studyDescription: "", aeTitle: "",
    });
    setPage(1);
    setSelectedIds(new Set());
  }, []);

  const toggleMod = (m: string) =>
    setSelMods((prev) => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });

  const toggleAll = () =>
    setSelectedIds(selectedIds.size === studies.length ? new Set() : new Set(studies.map((s) => s.id)));

  const toggleRow = (id: number) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function copyText(text: string, key: string) {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
    toast({ title: "Copied to clipboard" });
  }

  // ── Preset handlers ───────────────────────────────────────────────────────────

  const handleSavePreset = useCallback(() => {
    const name = savePresetName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const preset: DicomPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      filters: {
        dateFrom, dateTo,
        modalities: Array.from(selMods),
        patientName, accessionNumber, referringDoctor, studyDescription, aeTitle,
      },
      createdAt: now,
      updatedAt: now,
    };
    const updated = [preset, ...presets.filter((p) => p.name !== name)];
    setPresets(updated);
    const syncEntries = buildSyncEntries(updated, userId);
    persistEntries(syncEntries, userId);
    syncPresetsMut.mutate(syncEntries);
    setSavePresetName("");
    setShowSaveInput(false);
    toast({ title: `Preset "${name}" saved` });
  }, [savePresetName, dateFrom, dateTo, selMods, patientName, accessionNumber, referringDoctor, studyDescription, aeTitle, presets, userId, syncPresetsMut, toast]);

  const handleLoadPreset = useCallback((preset: DicomPreset) => {
    const f = preset.filters;
    setDateFrom(f.dateFrom);
    setDateTo(f.dateTo);
    setSelMods(new Set(f.modalities));
    setPatientName(f.patientName);
    setAccessionNumber(f.accessionNumber);
    setReferringDoctor(f.referringDoctor);
    setStudyDescription(f.studyDescription);
    setAeTitle(f.aeTitle);
    setApplied({
      dateFrom: f.dateFrom, dateTo: f.dateTo, modalities: f.modalities,
      patientName: f.patientName, accessionNumber: f.accessionNumber,
      referringDoctor: f.referringDoctor, studyDescription: f.studyDescription,
      aeTitle: f.aeTitle,
    });
    setPage(1);
    setSelectedIds(new Set());
    setShowPresetMenu(false);
    toast({ title: `Preset "${preset.name}" loaded` });
  }, [toast]);

  const handleDeletePreset = useCallback((id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedActive = presets.filter((p) => p.id !== id);
    setPresets(updatedActive);
    const tombstone: DicomTombstone = { id, deleted: true, updatedAt: new Date().toISOString() };
    const syncEntries = buildSyncEntries(updatedActive, userId, tombstone);
    persistEntries(syncEntries, userId);
    syncPresetsMut.mutate(syncEntries);
    toast({ title: `Preset "${name}" deleted` });
  }, [presets, userId, syncPresetsMut, toast]);

  const startRenaming = useCallback((preset: DicomPreset, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(preset.id);
    setRenameValue(preset.name);
  }, []);

  const commitRename = useCallback((id: string) => {
    const newName = renameValue.trim();
    if (!newName) { setRenamingId(null); return; }
    const oldPreset = presets.find((p) => p.id === id);
    if (!oldPreset || oldPreset.name === newName) { setRenamingId(null); return; }
    const updated = presets.map((p) => p.id === id ? { ...p, name: newName, updatedAt: new Date().toISOString() } : p);
    setPresets(updated);
    const syncEntries = buildSyncEntries(updated, userId);
    persistEntries(syncEntries, userId);
    syncPresetsMut.mutate(syncEntries);
    setRenamingId(null);
    toast({ title: `Preset renamed to "${newName}"` });
  }, [renameValue, presets, userId, syncPresetsMut, toast]);

  const cancelRename = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRenamingId(null);
  }, []);

  // ── Preset reorder helpers ────────────────────────────────────────────────────

  const handleMovePreset = useCallback((idx: number, dir: -1 | 1, e: React.MouseEvent) => {
    e.stopPropagation();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= presets.length) return;
    const now = new Date().toISOString();
    const updated = [...presets];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    // Bump updatedAt on both swapped presets so the new position wins in cross-device merge.
    updated[idx]    = { ...updated[idx],    updatedAt: now };
    updated[newIdx] = { ...updated[newIdx], updatedAt: now };
    setPresets(updated);
    const syncEntries = buildSyncEntries(updated, userId);
    persistEntries(syncEntries, userId);
    syncPresetsMut.mutate(syncEntries);
  }, [presets, userId, syncPresetsMut]);

  const handleDragStart = useCallback((idx: number) => {
    dragSrcIdx.current = idx;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === targetIdx) {
      setDragOverIdx(null);
      dragSrcIdx.current = null;
      return;
    }
    const updated = [...presets];
    const [item] = updated.splice(src, 1);
    // Bump updatedAt on the dragged item so its new position wins in cross-device merge.
    updated.splice(targetIdx, 0, { ...item, updatedAt: new Date().toISOString() });
    setPresets(updated);
    const syncEntries = buildSyncEntries(updated, userId);
    persistEntries(syncEntries, userId);
    syncPresetsMut.mutate(syncEntries);
    setDragOverIdx(null);
    dragSrcIdx.current = null;
  }, [presets, userId, syncPresetsMut]);

  const handleDragEnd = useCallback(() => {
    setDragOverIdx(null);
    dragSrcIdx.current = null;
  }, []);

  // ── CSV Export ────────────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const PAGE = 200;
      const baseParams = () => {
        const p = new URLSearchParams({
          dateFrom: applied.dateFrom,
          dateTo:   applied.dateTo,
          limit:    String(PAGE),
        });
        if (applied.modalities.length)   p.set("modality",        applied.modalities.join(","));
        if (applied.patientName)         p.set("patientName",     applied.patientName);
        if (applied.accessionNumber)     p.set("accessionNumber", applied.accessionNumber);
        if (applied.referringDoctor)     p.set("referringDoctor", applied.referringDoctor);
        if (applied.studyDescription)    p.set("studyDescription",applied.studyDescription);
        if (applied.aeTitle && searchMode === "local-db")
                                         p.set("aeTitle",         applied.aeTitle);
        return p;
      };

      const endpointBase = searchMode === "live-pacs"
        ? "/api/radiology/qr-cfind"
        : "/api/radiology/dicom-query";

      const allRows: StudyRow[] = [];
      let offset = 0;
      let totalCount = 0;

      do {
        const p = baseParams();
        p.set("offset", String(offset));
        const result = await api.get<QueryResult>(`${endpointBase}?${p}`);
        totalCount = result.total;
        allRows.push(...result.studies);
        offset += result.studies.length;
        if (result.studies.length < PAGE) break;
      } while (offset < totalCount);

      const rows = allRows;

      if (rows.length === 0) {
        toast({ title: "No studies to export" });
        return;
      }

      const csvEscape = (v: string | null | undefined) => {
        let s = v ?? "";
        // Neutralize formula injection: prefix leading = + - @ with a single quote
        if (s.length > 0 && "=+-@\t\r".includes(s[0])) {
          s = `'${s}`;
        }
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const pullLabel = (s: StudyRow) => {
        if (!s.pullStatus) return "NOT PULLED";
        return PULL_STATUS[s.pullStatus]?.label ?? s.pullStatus;
      };

      const source = (s: StudyRow) =>
        s.source ?? s.scheduledStationAETitle ?? (searchMode === "live-pacs" ? "LIVE PACS" : "Local DB");

      const header = ["Accession #", "Patient Name", "Modality", "Study Date", "Referring Doctor", "Status", "Source"];
      const csvLines = [
        header.join(","),
        ...rows.map((s) =>
          [
            csvEscape(s.accessionNumber),
            csvEscape(s.patientName),
            csvEscape(s.modality),
            csvEscape(s.studyDate),
            csvEscape(s.referringDoctor),
            csvEscape(pullLabel(s)),
            csvEscape(source(s)),
          ].join(",")
        ),
      ];

      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const fileName =
        applied.dateFrom === applied.dateTo
          ? `studies-${applied.dateFrom}.csv`
          : `studies-${applied.dateFrom}-to-${applied.dateTo}.csv`;
      a.href     = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: `Exported ${rows.length} studies`, description: fileName });
    } catch {
      toast({ title: "CSV export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [applied, searchMode, toast]);

  // ── PDF Export ────────────────────────────────────────────────────────────────

  const handleSetPaperOrientation = useCallback((orientation: PaperOrientation) => {
    setPaperOrientation(prev => {
      if (prev === orientation) return prev;
      persistDicomQrPaperSize(orientation, userId);
      return orientation;
    });
  }, [userId]);

  const handleExportPdf = useCallback(async () => {
    setIsExportingPdf(true);
    try {
      const PAGE = 200;
      const baseParams = () => {
        const p = new URLSearchParams({
          dateFrom: applied.dateFrom,
          dateTo:   applied.dateTo,
          limit:    String(PAGE),
        });
        if (applied.modalities.length)   p.set("modality",        applied.modalities.join(","));
        if (applied.patientName)         p.set("patientName",     applied.patientName);
        if (applied.accessionNumber)     p.set("accessionNumber", applied.accessionNumber);
        if (applied.referringDoctor)     p.set("referringDoctor", applied.referringDoctor);
        if (applied.studyDescription)    p.set("studyDescription",applied.studyDescription);
        if (applied.aeTitle && searchMode === "local-db")
                                         p.set("aeTitle",         applied.aeTitle);
        return p;
      };

      const endpointBase = searchMode === "live-pacs"
        ? "/api/radiology/qr-cfind"
        : "/api/radiology/dicom-query";

      const allRows: StudyRow[] = [];
      let offset = 0;
      let totalCount = 0;

      do {
        const p = baseParams();
        p.set("offset", String(offset));
        const result = await api.get<QueryResult>(`${endpointBase}?${p}`);
        totalCount = result.total;
        allRows.push(...result.studies);
        offset += result.studies.length;
        if (result.studies.length < PAGE) break;
      } while (offset < totalCount);

      if (allRows.length === 0) {
        toast({ title: "No studies to export" });
        return;
      }

      const pullLabel = (s: StudyRow) => {
        if (!s.pullStatus) return "NOT PULLED";
        return PULL_STATUS[s.pullStatus]?.label ?? s.pullStatus;
      };

      const sourceLabel = (s: StudyRow) =>
        s.source ?? s.scheduledStationAETitle ?? (searchMode === "live-pacs" ? "LIVE PACS" : "Local DB");

      const esc = (v: string | null | undefined) =>
        (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const exportSession = readStaffSession();

      const clinic = clinicSettings ?? {};
      const clinicName  = clinic.name    ?? "Care Diagnostics";
      const clinicTag   = clinic.tagline ?? "";
      const clinicAddr  = clinic.address ?? "";
      const clinicPhone = clinic.phone   ?? "";
      const clinicEmail = clinic.email   ?? "";
      const rawLogoDataUrl = clinic.logoDataUrl ?? "";
      const logoDataUrl = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/.test(rawLogoDataUrl)
        ? rawLogoDataUrl
        : "";

      const dateLabel =
        applied.dateFrom === applied.dateTo
          ? fmtDate(applied.dateFrom)
          : `${fmtDate(applied.dateFrom)} – ${fmtDate(applied.dateTo)}`;

      const activeFilters: string[] = [];
      if (applied.modalities.length)  activeFilters.push(`Modality: ${applied.modalities.join(", ")}`);
      if (applied.patientName)        activeFilters.push(`Patient: ${applied.patientName}`);
      if (applied.accessionNumber)    activeFilters.push(`Accession: ${applied.accessionNumber}`);
      if (applied.referringDoctor)    activeFilters.push(`Referring Doctor: ${applied.referringDoctor}`);
      if (applied.studyDescription)   activeFilters.push(`Description: ${applied.studyDescription}`);
      if (applied.aeTitle && searchMode === "local-db")
                                      activeFilters.push(`AE Title: ${applied.aeTitle}`);

      const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" });

      const rows = allRows;

      const tableRows = rows.map((s, i) => `
        <tr class="${i % 2 === 0 ? "even" : "odd"}">
          <td>${esc(s.accessionNumber)}</td>
          <td>${esc(s.patientName)}</td>
          <td class="mod">${esc(s.modality)}</td>
          <td class="nowrap">${esc(fmtDate(s.studyDate))}</td>
          <td>${s.referringDoctor ? `Dr. ${esc(s.referringDoctor)}` : "—"}</td>
          <td class="status">${esc(pullLabel(s))}</td>
          <td>${esc(sourceLabel(s))}</td>
        </tr>`).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>DICOM Study Export – ${esc(dateLabel)}</title>
<style>
  @page { size: A4 ${paperOrientation}; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }

  /* ── Header ── */
  .header { display: flex; align-items: flex-start; gap: 12px; border-bottom: 2px solid #1e40af; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
  .logo-placeholder { width: 52px; height: 52px; background: #1e40af; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18pt; font-weight: bold; flex-shrink: 0; }
  .clinic-info { flex: 1; }
  .clinic-name { font-size: 15pt; font-weight: bold; color: #1e40af; line-height: 1.2; }
  .clinic-tag { font-size: 9pt; color: #555; margin-top: 1px; }
  .clinic-contact { font-size: 8pt; color: #444; margin-top: 4px; }
  .report-meta { text-align: right; flex-shrink: 0; }
  .report-title { font-size: 11pt; font-weight: bold; color: #1e40af; }
  .report-subtitle { font-size: 8pt; color: #555; margin-top: 2px; }

  /* ── Filter summary ── */
  .filters { background: #f0f4ff; border: 1px solid #c7d7f7; border-radius: 5px; padding: 6px 10px; margin-bottom: 10px; font-size: 8pt; }
  .filters strong { color: #1e40af; }
  .filter-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .filter-tag { background: #dbeafe; border: 1px solid #93c5fd; border-radius: 3px; padding: 1px 6px; color: #1e3a8a; }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  thead tr { background: #1e40af; color: #fff; }
  thead th { padding: 5px 6px; text-align: left; white-space: nowrap; font-weight: 600; font-size: 7.5pt; }
  tbody tr.even { background: #f9fafb; }
  tbody tr.odd  { background: #ffffff; }
  tbody td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .mod { font-weight: bold; text-align: center; }
  .nowrap { white-space: nowrap; }
  .status { font-weight: bold; font-size: 7pt; }

  /* ── Footer ── */
  .footer { margin-top: 12px; border-top: 1px solid #d1d5db; padding-top: 6px; font-size: 7.5pt; color: #6b7280; display: flex; justify-content: space-between; }

  /* ── Signature block ── */
  .sig-block { margin-top: 20px; display: flex; justify-content: flex-end; }
  .sig-card { width: 220px; font-size: 8pt; color: #374151; }
  .sig-label { font-size: 7pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
  .sig-name { font-weight: bold; font-size: 9pt; color: #111; }
  .sig-role { font-size: 7.5pt; color: #555; margin-bottom: 14px; }
  .sig-line { border-top: 1px solid #374151; margin-bottom: 3px; }
  .sig-caption { font-size: 7pt; color: #6b7280; display: flex; justify-content: space-between; }

  /* ── Count summary ── */
  .summary { margin-bottom: 8px; font-size: 8.5pt; color: #374151; }
  .summary strong { color: #1e40af; }
</style>
</head>
<body>

<div class="header">
  ${logoDataUrl
    ? `<img class="logo" src="${logoDataUrl}" alt="Logo" />`
    : `<div class="logo-placeholder">${esc(clinicName.charAt(0).toUpperCase())}</div>`}
  <div class="clinic-info">
    <div class="clinic-name">${esc(clinicName)}</div>
    ${clinicTag  ? `<div class="clinic-tag">${esc(clinicTag)}</div>` : ""}
    <div class="clinic-contact">
      ${clinicAddr  ? esc(clinicAddr)  + " &nbsp;|&nbsp; " : ""}
      ${clinicPhone ? "Ph: " + esc(clinicPhone) + (clinicEmail ? " &nbsp;|&nbsp; " : "") : ""}
      ${clinicEmail ? esc(clinicEmail) : ""}
    </div>
  </div>
  <div class="report-meta">
    <div class="report-title">DICOM Study Export</div>
    <div class="report-subtitle">Date range: ${esc(dateLabel)}</div>
    <div class="report-subtitle">Source: ${searchMode === "live-pacs" ? "Live PACS" : "Local DB"}</div>
    <div class="report-subtitle">Generated: ${esc(generatedAt)}</div>
  </div>
</div>

<div class="filters">
  <strong>Applied Filters</strong>
  ${activeFilters.length > 0
    ? `<div class="filter-tags">${activeFilters.map((f) => `<span class="filter-tag">${esc(f)}</span>`).join("")}</div>`
    : `<span style="color:#6b7280;margin-left:8px;">No additional filters applied</span>`}
</div>

<div class="summary">Showing <strong>${rows.length}</strong>${totalCount > rows.length ? ` of ${totalCount}` : ""} studies</div>

<table>
  <thead>
    <tr>
      <th>Accession #</th>
      <th>Patient Name</th>
      <th>Mod</th>
      <th>Study Date</th>
      <th>Referring Doctor</th>
      <th>Pull Status</th>
      <th>Source</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>

${exportSession ? `
<div class="sig-block">
  <div class="sig-card">
    <div class="sig-label">Prepared by</div>
    <div class="sig-name">${esc(exportSession.user.name)}</div>
    <div class="sig-role">${esc(exportSession.user.role.replace(/_/g, " "))}</div>
    <div class="sig-line"></div>
    <div class="sig-caption">
      <span>Signature</span>
      <span>Date: __________</span>
    </div>
  </div>
</div>
` : ""}

<div class="footer">
  <span>${esc(clinicName)} &mdash; DICOM Radiology Audit Report</span>
  <span>Total studies: ${rows.length} &nbsp;|&nbsp; ${esc(generatedAt)}</span>
</div>

<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

      const win = window.open("", "_blank");
      if (!win) {
        toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site and try again.", variant: "destructive" });
        return;
      }
      win.document.write(html);
      win.document.close();

      toast({ title: `PDF ready (${rows.length} studies)`, description: "Use Print → Save as PDF in the dialog." });
    } catch {
      toast({ title: "PDF export failed", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  }, [applied, searchMode, clinicSettings, paperOrientation, toast]);

  function openAllSelectedOhif() {
    for (const s of selectedStudies) {
      if (s.studyInstanceUID) window.open(`/erp/radiology/viewer/${s.studyInstanceUID}`, "_blank");
    }
  }

  function openAllSelectedWeasis() {
    for (const s of selectedStudies) {
      if (s.studyInstanceUID) window.open(`/api/radiology/studies/${s.studyInstanceUID}/weasis-launch-redirect`, "_blank");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="DICOM Query / Retrieve"
        subtitle="Search radiology studies by date, modality, patient, or referring doctor — then open or retrieve"
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />

      {/* ── System Health Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 text-xs">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border ${
          totalMods === 0 ? "bg-gray-50 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700"
          : healthyMods === totalMods ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
          : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
        }`}>
          {totalMods === 0 ? <WifiOff size={11} /> : healthyMods === totalMods ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {totalMods === 0 ? "No modalities configured" : `${healthyMods}/${totalMods} modalities OK`}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border ${
          failedQueue === 0 ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
          : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
        }`}>
          {failedQueue === 0 ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          {failedQueue === 0 ? "No failed retrievals" : `${failedQueue} failed in queue`}
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300">
          <Server size={11} /> {total > 0 ? `${total} studies found` : "Ready to query"}
        </span>
        <a
          href="/erp/radiology/pacs-settings"
          className="flex items-center gap-1 px-2.5 py-1 rounded-full font-medium border bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700"
        >
          <Shield size={11} /> Viewer URLs
        </a>
      </div>

      {/* ── DCMTK / PACS hint banner ──────────────────────────────────────────── */}
      {searchMode === "live-pacs" && data?.dcmtkHint && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex gap-3 text-sm">
          <Info size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300 mb-0.5">Live PACS Search unavailable</p>
            <p className="text-amber-700 dark:text-amber-400 text-xs leading-relaxed">{data.dcmtkHint}</p>
          </div>
        </div>
      )}

      {/* ── Filter Panel ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold">Search Criteria</h2>

          {/* Search mode toggle */}
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5 ml-3">
            <button
              onClick={() => { setSearchMode("local-db"); setPage(1); setSelectedIds(new Set()); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                searchMode === "local-db"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Query local RIS database"
            >
              <Database size={11} />
              Local DB
            </button>
            <button
              onClick={() => { setSearchMode("live-pacs"); setPage(1); setSelectedIds(new Set()); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                searchMode === "live-pacs"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Send live C-FIND request to PACS (Orthanc REST or findscu)"
            >
              <Radio size={11} />
              Live PACS
            </button>
          </div>

          <div className="ml-auto relative" ref={presetMenuRef}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowPresetMenu((v) => !v)}
            >
              <Bookmark size={12} />
              Presets
              {presets.length > 0 && (
                <span className="bg-primary text-primary-foreground rounded-full text-[10px] px-1.5 py-0 font-bold leading-4">
                  {presets.length}
                </span>
              )}
              <ChevronDown size={11} className={`transition-transform ${showPresetMenu ? "rotate-180" : ""}`} />
            </Button>
            {showPresetMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border bg-popover shadow-lg overflow-hidden">
                {presets.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    <Bookmark size={20} className="mx-auto mb-2 opacity-30" />
                    No saved presets yet.
                    <br />Use "Save as preset" below to save your current filters.
                  </div>
                ) : (
                  <ul className="divide-y max-h-64 overflow-y-auto">
                    {presets.map((preset, idx) => {
                      const isRenaming = renamingId === preset.id;
                      const isDragTarget = dragOverIdx === idx;
                      return (
                        <li
                          key={preset.id}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={(e) => handleDrop(e, idx)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center gap-1.5 px-3 py-2.5 transition-colors group ${
                            isDragTarget
                              ? "bg-primary/10 border-t-2 border-primary"
                              : "hover:bg-muted/50"
                          }`}
                          role={isRenaming ? undefined : "button"}
                          tabIndex={isRenaming ? undefined : 0}
                          onClick={isRenaming ? undefined : () => handleLoadPreset(preset)}
                          onKeyDown={isRenaming ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleLoadPreset(preset); } }}
                          style={{ cursor: isRenaming ? "default" : "pointer" }}
                        >
                          {/* Drag handle — draggable only from here to avoid accidental drags on click-to-load */}
                          <span
                            draggable={!isRenaming}
                            onDragStart={(e) => { e.stopPropagation(); handleDragStart(idx); }}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing transition-colors"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                          >
                            <GripVertical size={13} />
                          </span>
                          <Bookmark size={13} className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                          <div className="flex-1 min-w-0">
                            {isRenaming ? (
                              <input
                                ref={renameInputRef}
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitRename(preset.id); }
                                  if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                                }}
                                onBlur={() => commitRename(preset.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full text-xs font-semibold bg-background border border-primary rounded px-1.5 py-0.5 outline-none ring-0 focus:ring-1 focus:ring-primary"
                                aria-label="Rename preset"
                              />
                            ) : (
                              <>
                                <p className="text-xs font-semibold truncate">{preset.name}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {preset.filters.modalities.length > 0
                                    ? preset.filters.modalities.join(", ")
                                    : "All modalities"}{" · "}
                                  {preset.filters.dateFrom === preset.filters.dateTo
                                    ? preset.filters.dateFrom
                                    : `${preset.filters.dateFrom} → ${preset.filters.dateTo}`}
                                </p>
                              </>
                            )}
                          </div>
                          {isRenaming ? (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => { e.stopPropagation(); commitRename(preset.id); }}
                                className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 transition-colors"
                                title="Save rename"
                                aria-label="Save rename"
                              >
                                <Check size={11} />
                              </button>
                              <button
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => cancelRename(e)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                title="Cancel rename"
                                aria-label="Cancel rename"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Up / Down arrows */}
                              <button
                                onClick={(e) => handleMovePreset(idx, -1, e)}
                                disabled={idx === 0}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move up"
                                aria-label={`Move ${preset.name} up`}
                              >
                                <ChevronUp size={11} />
                              </button>
                              <button
                                onClick={(e) => handleMovePreset(idx, 1, e)}
                                disabled={idx === presets.length - 1}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move down"
                                aria-label={`Move ${preset.name} down`}
                              >
                                <ChevronDown size={11} />
                              </button>
                              <button
                                onClick={(e) => startRenaming(preset, e)}
                                className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-muted-foreground hover:text-blue-600 transition-colors"
                                title="Rename preset"
                                aria-label={`Rename preset ${preset.name}`}
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                onClick={(e) => handleDeletePreset(preset.id, preset.name, e)}
                                className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                                title="Delete preset"
                                aria-label={`Delete preset ${preset.name}`}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="p-4 space-y-4">

          {/* Quick Dates */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">Quick Date:</span>
            {([
              { label: "Today",      offset: 0 },
              { label: "Yesterday",  offset: 1 },
              { label: "Day Before", offset: 2 },
            ] as const).map(({ label, offset }) => {
              const d = localDate(offset);
              const active = applied.dateFrom === d && applied.dateTo === d;
              return (
                <Button
                  key={label}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 text-xs gap-1"
                  onClick={() => applyQuickDate(offset)}
                >
                  <CalendarDays size={11} />
                  {label}
                  <span className="text-[10px] opacity-70 font-mono hidden sm:inline">{d}</span>
                </Button>
              );
            })}
          </div>

          {/* Date range + patient name + accession */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From Date</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To Date</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Patient Name</label>
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Search…"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Accession #</label>
              <Input
                value={accessionNumber}
                onChange={(e) => setAccessionNumber(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="ACC-…"
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* Modality chips */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Modality</label>
            <div className="flex flex-wrap gap-1.5">
              {MODALITIES.map((m) => (
                <button
                  key={m}
                  onClick={() => toggleMod(m)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all ${
                    selMods.has(m)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:border-primary/50 text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
              {selMods.size > 0 && (
                <button
                  onClick={() => setSelMods(new Set())}
                  className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  × clear
                </button>
              )}
            </div>
          </div>

          {/* Referring Doctor + Study Description + AE Title */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Referring Doctor</label>
              <select
                value={referringDoctor}
                onChange={(e) => setReferringDoctor(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">All doctors</option>
                {(doctors ?? []).map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Study Description</label>
              <Input
                value={studyDescription}
                onChange={(e) => setStudyDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Brain MRI, Chest X-Ray…"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className={`text-xs font-medium ${searchMode === "live-pacs" ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                Station AE Title
                {searchMode === "live-pacs" && <span className="ml-1 text-[10px]">(Local DB only)</span>}
              </label>
              <Input
                value={aeTitle}
                onChange={(e) => setAeTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="MRI_ROOM1…"
                className="h-8 text-xs font-mono"
                disabled={searchMode === "live-pacs"}
              />
            </div>
          </div>

          {/* Buttons + Save Preset */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={applyFilters} disabled={isFetching} className="gap-1.5">
              {searchMode === "live-pacs" ? <Radio size={13} /> : <Search size={13} />}
              {searchMode === "live-pacs" ? "C-FIND" : "Query"}
            </Button>
            <Button size="sm" variant="outline" onClick={clearAll} className="gap-1.5">
              <XCircle size={13} /> Clear
            </Button>
            <div className="flex items-center gap-1.5 ml-auto">
              {showSaveInput ? (
                <>
                  <Input
                    ref={saveInputRef}
                    value={savePresetName}
                    onChange={(e) => setSavePresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSavePreset();
                      if (e.key === "Escape") { setShowSaveInput(false); setSavePresetName(""); }
                    }}
                    placeholder="Preset name…"
                    className="h-7 text-xs w-44"
                    maxLength={48}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={handleSavePreset}
                    disabled={!savePresetName.trim()}
                  >
                    <BookmarkPlus size={12} /> Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => { setShowSaveInput(false); setSavePresetName(""); }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setShowSaveInput(true)}
                >
                  <BookmarkPlus size={12} /> Save as preset
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bulk Action Toolbar ────────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="sticky top-14 z-10 rounded-xl border border-primary/30 bg-primary/5 shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-primary">{selectedIds.size} selected</span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Button
              size="sm"
              onClick={() => retrieveMut.mutate(selectedStudies)}
              disabled={retrieveMut.isPending}
              className="h-7 text-xs gap-1"
            >
              <Download size={12} />
              {retrieveMut.isPending ? "Queueing…" : `Retrieve (${selectedIds.size})`}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openAllSelectedOhif}>
              <MonitorPlay size={12} /> OHIF ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openAllSelectedWeasis}>
              <Tv2 size={12} /> Weasis ({selectedIds.size})
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
              × Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Results Table ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold flex items-center gap-2 min-w-0">
            <Activity size={14} className="shrink-0" />
            Results
            {total > 0 && <span className="text-xs font-normal text-muted-foreground">({total.toLocaleString()} studies found)</span>}
            {searchMode === "live-pacs" && data?.source && data.source !== "NONE" && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                <Radio size={9} />
                {data.source === "ORTHANC_REST" ? "Orthanc REST" : "findscu"}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {isFetching && <RefreshCw size={13} className="animate-spin text-muted-foreground" />}
            <div className="flex items-center rounded-md border border-input overflow-hidden h-7">
              <button
                className={`px-2 h-full text-[10px] font-medium transition-colors ${paperOrientation === "landscape" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                onClick={() => handleSetPaperOrientation("landscape")}
                title="A4 Landscape (wide)"
              >
                A4 ↔
              </button>
              <button
                className={`px-2 h-full text-[10px] font-medium transition-colors border-l border-input ${paperOrientation === "portrait" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                onClick={() => handleSetPaperOrientation("portrait")}
                title="A4 Portrait (tall)"
              >
                A4 ↕
              </button>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={total === 0 || isExportingPdf}
              onClick={() => void handleExportPdf()}
              title={`Export all results as a formatted PDF report (${paperOrientation === "landscape" ? "A4 Landscape" : "A4 Portrait"})`}
            >
              <Printer size={13} className={isExportingPdf ? "animate-pulse" : ""} />
              {isExportingPdf ? "Preparing…" : "Export PDF"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={total === 0 || isExporting}
              onClick={() => void handleExportCsv()}
              title="Export all results to CSV"
            >
              <FileDown size={13} className={isExporting ? "animate-pulse" : ""} />
              {isExporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {searchMode === "live-pacs" ? "Sending C-FIND to PACS…" : "Querying studies…"}
          </div>
        ) : studies.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Search size={36} className="mx-auto opacity-20" />
            <p className="text-sm font-medium text-muted-foreground">No studies found.</p>
            {searchMode === "live-pacs"
              ? <p className="text-xs text-muted-foreground">The PACS returned no matches. Try a wider date range or fewer filters.</p>
              : <p className="text-xs text-muted-foreground">Try Today / Yesterday or adjust filters, then click Query.</p>
            }
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={studies.length > 0 && selectedIds.size === studies.length}
                      onChange={toggleAll}
                      className="accent-primary"
                    />
                  </th>
                  {["Accession #", "Patient", "Mod", "Date", "Description", "Ref. Doctor", "Study UID", "Pull Status", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {studies.map((s) => {
                  const pullMeta = s.pullStatus ? (PULL_STATUS[s.pullStatus] ?? null) : null;
                  const sel = selectedIds.has(s.id);
                  return (
                    <tr key={s.id} className={`hover:bg-muted/20 transition-colors ${sel ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={sel} onChange={() => toggleRow(s.id)} className="accent-primary" />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{s.accessionNumber}</td>
                      <td className="px-3 py-2 max-w-[140px]">
                        <p className="font-semibold truncate">{s.patientName || "—"}</p>
                        <p className="text-muted-foreground text-[10px]">ID: {s.patientId}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${MOD_COLORS[s.modality] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
                          {s.modality}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(s.studyDate)}</td>
                      <td className="px-3 py-2 max-w-[160px] truncate" title={s.studyDescription ?? ""}>{s.studyDescription ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[120px] truncate" title={s.referringDoctor ?? ""}>
                        {s.referringDoctor ? `Dr. ${s.referringDoctor}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {s.studyInstanceUID ? (
                          <div className="flex items-center gap-1">
                            <span
                              className="font-mono text-[10px] text-muted-foreground truncate max-w-[88px]"
                              title={s.studyInstanceUID}
                            >
                              {s.studyInstanceUID}
                            </span>
                            <button
                              onClick={() => copyText(s.studyInstanceUID!, `uid-${s.id}`)}
                              className="shrink-0 p-0.5 rounded hover:bg-muted"
                              title="Copy Study UID"
                            >
                              <Copy size={9} className={copiedKey === `uid-${s.id}` ? "text-green-600" : "text-muted-foreground"} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">No UID yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {pullMeta ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pullMeta.cls}`}>{pullMeta.label}</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">NOT PULLED</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          <button
                            onClick={() => copyText(s.accessionNumber, `acc-${s.id}`)}
                            className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 font-medium"
                            title="Copy Accession #"
                          >
                            <Copy size={9} className={copiedKey === `acc-${s.id}` ? "text-green-600" : ""} />
                            ACC
                          </button>
                          {s.studyInstanceUID && (
                            <>
                              <button
                                onClick={() => { void navigate(`/radiology/viewer/${s.studyInstanceUID}`); }}
                                className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 font-medium"
                                title="Open in OHIF"
                              >
                                <MonitorPlay size={9} /> OHIF
                              </button>
                              <button
                                onClick={() => window.open(`/api/radiology/studies/${s.studyInstanceUID}/weasis-launch-redirect`, "_blank")}
                                className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 font-medium"
                                title="Open in Weasis"
                              >
                                <Tv2 size={9} />
                              </button>
                            </>
                          )}
                          {!s.pullStatus && (
                            <button
                              onClick={() => retrieveMut.mutate([s])}
                              disabled={retrieveMut.isPending}
                              className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 font-medium disabled:opacity-50"
                              title="Queue for retrieval"
                            >
                              <Download size={9} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} total studies</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── QA / Test Sequence ────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-5 bg-muted/30 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Shield size={15} /> System Health &amp; Test Sequence
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className={`text-xl font-bold ${totalMods > 0 && healthyMods === totalMods ? "text-green-600" : "text-amber-600"}`}>{healthyMods}/{totalMods}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Modalities OK</p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className={`text-xl font-bold ${failedQueue === 0 ? "text-green-600" : "text-red-600"}`}>{failedQueue}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Failed Queue</p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className="text-xl font-bold text-blue-600">{total}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Studies Found</p>
          </div>
          <div className="rounded-lg border bg-background p-3 text-center">
            <p className={`text-xl font-bold ${(health?.pulledToday?.PULLED ?? 0) > 0 ? "text-purple-600" : "text-gray-400"}`}>
              {health?.pulledToday?.PULLED ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mt-0.5">Pulled Today</p>
          </div>
        </div>

        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Confirm <strong>WADO Base URL</strong>, <strong>Orthanc Base URL</strong>, and <strong>OHIF Base URL</strong> are filled in at <a href="/erp/radiology/pacs-settings" className="underline text-primary">PACS Settings → Viewer Settings</a>.</li>
          <li>Go to <a href="/erp/radiology/modality-management" className="underline text-primary">Modality Management</a> and run <strong>C-ECHO</strong> on each device — green = reachable on the network.</li>
          <li>Click <strong>Today</strong> above and then <strong>Query</strong> — radiology orders for today appear here.</li>
          <li>Tick a study that has a Study UID and click <strong>OHIF</strong> — viewer opens if Orthanc already has that study.</li>
          <li>Click <strong>Weasis</strong> (TV icon) — browser should prompt to launch Weasis (requires Weasis installed on this workstation).</li>
          <li>For <span className="font-mono">NOT PULLED</span> studies, click the amber ↓ button or select multiple and click <strong>Retrieve</strong> — the pull agent will C-MOVE them on its next cycle.</li>
          <li>After ~1–2 minutes check <a href="/erp/radiology/dicom-agent-dashboard" className="underline text-primary">Agent Monitor</a> — successful pulls show <span className="font-mono">PULLED / IN PACS</span> here.</li>
        </ol>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { title: "MRI Test Values",   mod: "MR",    ae: "MRI_SCANNER",  desc: "BRAIN MRI W/WO CONTRAST" },
            { title: "CT Test Values",    mod: "CT",    ae: "CT_SCANNER",   desc: "CHEST CT WITH CONTRAST" },
            { title: "X-Ray Test Values", mod: "CR/DX", ae: "XRAY_ROOM1",   desc: "CHEST PA VIEW" },
          ].map(({ title, mod, ae, desc }) => (
            <div key={title} className="rounded-lg border bg-background p-3 space-y-1">
              <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{title}</p>
              <p>Modality: <span className="font-mono font-bold">{mod}</span></p>
              <p>AE Title: <span className="font-mono">{ae}</span></p>
              <p>Description: <span className="font-mono">{desc}</span></p>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p className="font-semibold text-foreground text-sm">Manual hospital-side configuration required:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>AE Title, IP, and Port of each modality (MRI / CT / X-Ray) must be entered in <strong>Modality Management</strong>.</li>
            <li>Each modality must have this ERP's AE Title added as a known C-STORE destination.</li>
            <li>Orthanc or Conquest PACS must be installed and configured (AE Title + port).</li>
            <li>OHIF Viewer must be running at the configured OHIF Base URL.</li>
            <li>Weasis must be installed on each radiologist workstation.</li>
            <li>Windows Pull Agent must be running with DCMTK on a Windows PC on the same LAN as the modalities.</li>
            <li>Firewall rules must allow DICOM ports (104, 4242, 11112 as applicable).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
