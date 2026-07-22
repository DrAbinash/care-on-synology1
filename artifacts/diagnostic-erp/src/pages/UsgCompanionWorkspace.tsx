/**
 * UsgCompanionWorkspace — the dedicated USG-first reporting shell (Phase P0/P1).
 *
 * This is a UI SHELL, not a second reporting engine. It is a *tenant* of the
 * canonical radiology platform: it loads the same worklist entry, saves through
 * the same `saveRadiologyDraft`, finalizes through the same
 * `finalizeRadiologyReport` (whose server path enforces the shared PCPNDT/Form F
 * gate), claims the same study lock, and persists structured findings INSIDE the
 * canonical `findings_sections` JSON. Nothing here forks the lifecycle, the
 * draft store, the finalized-report store, auth, or the compliance gate.
 *
 * It is reached only at `/radiology/usg/:studyId` behind
 * `ff_radiology_usg_workspace`; when the flag is off the route redirects to the
 * canonical workspace, so USG reporting is never regressed.
 *
 * Layout (live-scan oriented, not the MRI/CT sequential read):
 *   LEFT   — patient / history / preset / organ rail (status + normal-all)
 *   CENTER — organ-wise report sections + the active organ's Dynamic Finding
 *            Builder + editable Impression + Save / Finalize
 *   RIGHT  — embedded viewer + measurement review (co-visible with the report) +
 *            prior comparison + knowledge pack
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession, isFeatureEnabled } from "@/lib/staffSession";
import { isUltrasoundModality, isObstetricUsgStudy } from "@/lib/usgModality";
import { useRadiologyDraftId } from "@/hooks/useRadiologyDraftId";
import { useStudyLock } from "@/hooks/useStudyLock";
import { saveRadiologyDraft, finalizeRadiologyReport } from "@/lib/radiologyReportLifecycle";
import EmbeddedWadoViewer, { type EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import UsgMeasurementReviewPanel from "@/components/radiology/UsgMeasurementReviewPanel";
import ComparisonPanel from "@/components/radiology/ComparisonPanel";
import RadiologyKnowledgePanel from "@/components/RadiologyKnowledgePanel";
import OrganRail from "@/components/radiology/usg/OrganRail";
import DynamicFindingBuilder from "@/components/radiology/usg/DynamicFindingBuilder";
import OrganReportSection from "@/components/radiology/usg/OrganReportSection";
import UsgPriorComparison from "@/components/radiology/usg/UsgPriorComparison";
import UsgObDopplerPanel from "@/components/radiology/usg/UsgObDopplerPanel";
import { organsForStudy, organByKey, findingDefsForOrgan, type UsgPreset } from "@/lib/usgOrganLibrary";
import {
  emptySection, markNormal, addFinding, removeFinding, applyNormalToRemaining,
  composeImpression, buildUsgDraftPayload, parseFindingsSections, organStatus,
  type UsgOrganSection,
} from "@/lib/usgReportComposer";
import { effectiveFindingText, type UsgFindingObject } from "@/lib/usgFindingBuilder";
import { computeReadiness } from "@/lib/usgReadiness";
import ReadinessBar from "@/components/radiology/usg/ReadinessBar";
import ShortcutOverlay from "@/components/radiology/usg/ShortcutOverlay";

// Minimal shape of the canonical worklist entry (the full type is internal to
// RadiologyReportingWorkspace; we only read what the shell needs).
interface WorklistEntry {
  id: number;
  studyId: number | null;
  patientId: number | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  referringDoctor: string | null;
  status: string;
}

// Single-letter organ hotkeys (only fire when focus is not in a text field).
const HOTKEYS: Record<string, string> = {
  liver: "L", gallbladder: "G", cbd: "B", pancreas: "P", spleen: "S",
  right_kidney: "R", left_kidney: "K", urinary_bladder: "U", prostate: "T",
  uterus: "W", right_ovary: "O", left_ovary: "V",
};

function detectPreset(desc: string | null): UsgPreset {
  const d = (desc ?? "").toLowerCase();
  if (/\bkub\b|kidney|ureter|bladder/.test(d) && !/abdomen/.test(d)) return "kub";
  if (/pelvi|uterus|ovary|prostate|tvs/.test(d) && !/abdomen/.test(d)) return "pelvis";
  return "whole_abdomen";
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export default function UsgCompanionWorkspace({ studyId }: { studyId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const session = useMemo(() => readStaffSession(), []);
  const flagOn = isFeatureEnabled("ff_radiology_usg_workspace");
  const p2 = isFeatureEnabled("ff_radiology_usg_companion_p2");
  const [showHelp, setShowHelp] = useState(false);

  // Flag off → this dedicated surface is unavailable; fall back to canonical.
  useEffect(() => {
    if (!flagOn && studyId != null) navigate(`/radiology/report/${studyId}`);
  }, [flagOn, studyId, navigate]);

  const { data: entry, isLoading } = useQuery<WorklistEntry>({
    queryKey: ["workspace-entry", studyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${studyId}`),
    enabled: !!studyId && flagOn,
  });

  const { draftId, existingDraft, captureSavedDraftId } = useRadiologyDraftId(studyId ?? null);
  const lock = useStudyLock(studyId, { enabled: !!studyId && flagOn });
  const lockedByOther = lock.status === "locked-by-other";

  const preset = useMemo(() => detectPreset(entry?.studyDescription ?? null), [entry?.studyDescription]);
  const organs = useMemo(
    () => organsForStudy({ sex: entry?.sex ?? null, preset }),
    [entry?.sex, preset],
  );
  const organLabelToKey = useMemo(() => Object.fromEntries(organs.map((o) => [o.label, o.key])), [organs]);
  const normalByOrgan = useMemo(() => Object.fromEntries(organs.map((o) => [o.key, o.normalText])), [organs]);

  const [sections, setSections] = useState<UsgOrganSection[]>([]);
  const [activeOrgan, setActiveOrgan] = useState<string>("");
  const [impressionText, setImpressionText] = useState("");
  const [impressionEdited, setImpressionEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);

  // Scaffold sections from the organ list, then hydrate from any saved draft.
  useEffect(() => {
    if (!organs.length) return;
    setSections((prev) => {
      if (prev.length) return prev;
      return organs.map((o) => emptySection(o.key, o.label));
    });
    if (!activeOrgan) setActiveOrgan(organs[0].key);
  }, [organs, activeOrgan]);

  useEffect(() => {
    if (hydratedRef.current || !existingDraft || !organs.length) return;
    const saved = parseFindingsSections(existingDraft.findingsSections, organLabelToKey);
    if (saved.length) {
      hydratedRef.current = true;
      setSections((prev) => {
        const byKey = new Map(prev.map((s) => [s.organ, s]));
        for (const s of saved) byKey.set(s.organ, s);
        // keep organ ordering from the scaffold
        return organs.map((o) => byKey.get(o.key) ?? emptySection(o.key, o.label));
      });
      if (existingDraft.impression) {
        try {
          const arr = JSON.parse(existingDraft.impression);
          if (Array.isArray(arr) && arr.length) { setImpressionText(arr.join("\n")); setImpressionEdited(true); }
        } catch { /* ignore */ }
      }
    }
  }, [existingDraft, organs, organLabelToKey]);

  // Auto-compose the impression from findings until the radiologist edits it.
  useEffect(() => {
    if (impressionEdited) return;
    setImpressionText(composeImpression(sections).join("\n"));
  }, [sections, impressionEdited]);

  const statusByOrgan = useMemo(
    () => Object.fromEntries(sections.map((s) => [s.organ, organStatus(s)])),
    [sections],
  );

  const updateSection = useCallback((organ: string, fn: (s: UsgOrganSection) => UsgOrganSection) => {
    setSections((prev) => prev.map((s) => (s.organ === organ ? fn(s) : s)));
  }, []);

  const activeSection = sections.find((s) => s.organ === activeOrgan) ?? null;
  const activeDefs = useMemo(() => findingDefsForOrgan(activeOrgan), [activeOrgan]);

  const appendToActive = useCallback((text: string) => {
    if (!activeOrgan || !text.trim()) return;
    updateSection(activeOrgan, (s) => ({ ...s, text: s.text.trim() ? `${s.text.trim()}\n${text.trim()}` : text.trim() }));
  }, [activeOrgan, updateSection]);

  const onAddFinding = useCallback((obj: UsgFindingObject) => {
    const organ = organByKey(obj.organ)?.key ?? activeOrgan;
    updateSection(organ, (s) => addFinding(s, { ...obj, author: session?.user?.name ?? null }));
  }, [activeOrgan, updateSection, session]);

  const onNormalAllRemaining = useCallback(() => {
    setSections((prev) => applyNormalToRemaining(prev, normalByOrgan));
  }, [normalByOrgan]);

  // ── Canonical save / finalize ──────────────────────────────────────────────
  const buildPayload = useCallback((id: number | null) => {
    const payload = buildUsgDraftPayload({
      draftId: id, studyId: studyId ?? null, worklistId: entry?.id ?? null, patientId: entry?.patientId ?? null,
      modality: entry?.modality ?? null, studyName: entry?.studyDescription ?? "USG", sections,
    });
    if (impressionEdited) {
      payload.impression = impressionText.split("\n").map((l) => l.trim()).filter(Boolean);
    }
    return payload;
  }, [studyId, entry, sections, impressionEdited, impressionText]);

  const handleSave = useCallback(async (): Promise<number | null> => {
    if (!entry || saving) return null;
    setSaving(true);
    try {
      const res = await saveRadiologyDraft<{ success: boolean; draft: { id: number } }>(buildPayload(draftId ?? null));
      captureSavedDraftId(res.draft.id);
      toast({ title: "Draft saved" });
      return res.draft.id;
    } catch (e) {
      toast({ title: "Save failed", description: String((e as Error).message ?? e), variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }, [entry, saving, buildPayload, draftId, captureSavedDraftId, toast]);

  const handleFinalize = useCallback(async () => {
    if (!entry) return;
    if (lockedByOther) { toast({ title: "Locked by another radiologist", variant: "destructive" }); return; }
    const id = await handleSave();
    if (id == null) return;
    const impression = impressionEdited
      ? impressionText.split("\n").map((l) => l.trim()).filter(Boolean)
      : composeImpression(sections);
    if (typeof window !== "undefined" && !window.confirm("Finalize and sign this ultrasound report?")) return;

    const bodyHtml = [
      `<h2>${escHtml(entry.studyDescription || "Ultrasound Report")}</h2>`,
      ...sections
        .filter((s) => organStatus(s) !== "untouched")
        .map((s) => `<h3>${escHtml(s.label)}</h3><p>${escHtml(s.text).replace(/\n/g, "<br/>")}</p>`),
      impression.length ? `<h3>Impression</h3><ol>${impression.map((l) => `<li>${escHtml(l)}</li>`).join("")}</ol>` : "",
    ].join("\n");

    try {
      const r = await finalizeRadiologyReport(
        {
          patientId: entry.patientId, studyId: entry.studyId, worklistId: entry.id,
          modality: entry.modality, studyDescription: entry.studyDescription,
          accessionNumber: entry.accessionNumber, studyInstanceUID: entry.studyInstanceUID,
        },
        {
          title: entry.studyDescription || "Ultrasound Report",
          htmlBody: bodyHtml,
          impression,
          isCritical: false,
          criticalNote: null,
          createdBy: session?.user?.name ?? "Radiologist",
          actor: session?.user?.name ?? "staff",
        },
      );
      if (r.reportId) toast({ title: "Report finalized & signed" });
      else toast({ title: "Finalize incomplete", description: r.reportCreationSkipped ?? "See worklist", variant: "destructive" });
    } catch (e) {
      // PCPNDT/Form F 409 and other server gate failures surface here verbatim.
      toast({ title: "Finalize blocked", description: String((e as Error).message ?? e), variant: "destructive" });
    }
  }, [entry, lockedByOther, handleSave, impressionEdited, impressionText, sections, session, toast]);

  // ── Keyboard workflow (disabled while typing unless a modifier is held) ─────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); void handleSave(); return; }
      if (mod && e.key === "Enter") { e.preventDefault(); void handleFinalize(); return; }
      if (typing) return; // plain-key shortcuts never fire inside a field
      if (p2 && e.key === "?") { e.preventDefault(); setShowHelp((v) => !v); return; }
      if (e.shiftKey && (e.key === "N" || e.key === "n")) { e.preventDefault(); onNormalAllRemaining(); return; }
      if (e.key === "n" || e.key === "N") {
        if (activeOrgan) updateSection(activeOrgan, (s) => markNormal(s, normalByOrgan[activeOrgan] ?? ""));
        return;
      }
      const organKey = Object.entries(HOTKEYS).find(([k, letter]) => letter === e.key.toUpperCase() && organs.some((o) => o.key === k))?.[0];
      if (organKey) { e.preventDefault(); setActiveOrgan(organKey); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleFinalize, onNormalAllRemaining, activeOrgan, updateSection, normalByOrgan, organs, p2]);

  const viewerRef = useRef<EmbeddedViewerHandle>(null);
  const [knowledgePanel] = useState<string>("packs");

  if (!flagOn) return null; // redirect effect handles navigation
  if (isLoading || !entry) {
    return <div className="p-8 text-slate-500">Loading ultrasound study…</div>;
  }
  if (!isUltrasoundModality(entry.modality)) {
    return (
      <div className="p-8">
        <p className="text-slate-600 dark:text-slate-300">This is not an ultrasound study.</p>
        <button className="mt-2 text-teal-600 underline" onClick={() => navigate(`/radiology/report/${studyId}`)}>
          Open in the canonical reporting workspace →
        </button>
      </div>
    );
  }

  const isObstetric = isObstetricUsgStudy(entry.modality, entry.studyDescription);
  const railItems = organs.map((o) => ({ key: o.key, label: o.label, hotkey: HOTKEYS[o.key] }));

  // P2.1 — continuous readiness (advisory; computed deterministically each render).
  const readiness = p2
    ? computeReadiness({
        sections,
        expectedOrganKeys: organs.map((o) => o.key),
        impressionLines: impressionEdited ? impressionText.split("\n").map((l) => l.trim()).filter(Boolean) : composeImpression(sections),
        lockStatus: lock.status,
        pcpndt: isObstetric ? { applicable: true, compliant: null } : null,
      })
    : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950" data-testid="usg-companion-workspace">
      {p2 && <ShortcutOverlay open={showHelp} onClose={() => setShowHelp(false)} />}
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <span className="font-semibold text-slate-800 dark:text-slate-100">{entry.patientName}</span>
        <span className="text-xs rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 px-2 py-0.5">
          US · {entry.studyDescription || "Ultrasound"}
        </span>
        {entry.sex && <span className="text-xs text-slate-500">{entry.sex}{entry.age ? ` · ${entry.age}` : ""}</span>}
        {lock.status === "mine" && <span className="text-xs text-emerald-600">🔒 Claimed by you</span>}
        {lockedByOther && <span className="text-xs text-rose-600">🔒 {lock.ownerName ?? "Locked"}</span>}
        {isObstetric && <span className="text-xs text-amber-600" title="PCPNDT / Form F enforced on finalize (server-side)">PCPNDT applies</span>}
        <div className="flex-1" />
        {p2 && readiness && <ReadinessBar readiness={readiness} />}
        {p2 && (
          <button type="button" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)"
            className="rounded-md px-2 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-500">?</button>
        )}
        <button onClick={() => void handleSave()} disabled={saving || lockedByOther}
          className="rounded-md px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 disabled:opacity-50">
          Save <kbd className="text-[10px] font-mono">⌘S</kbd>
        </button>
        <button onClick={() => void handleFinalize()} disabled={lockedByOther}
          className="rounded-md px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
          Sign <kbd className="text-[10px] font-mono">⌘↵</kbd>
        </button>
      </div>

      {/* Three columns */}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(200px,1fr)_minmax(0,2.1fr)_minmax(280px,1.7fr)] gap-3 p-3 overflow-hidden">
        {/* LEFT */}
        <div className="min-h-0 overflow-y-auto flex flex-col gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">Patient · history</div>
            <div className="text-sm text-slate-700 dark:text-slate-200">{entry.patientName}</div>
            <div className="text-xs text-slate-500">{entry.referringDoctor ? `Ref: ${entry.referringDoctor}` : ""}</div>
            <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-slate-500">Preset</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{preset.replace("_", " ")}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <OrganRail
              organs={railItems}
              statusByOrgan={statusByOrgan}
              activeOrgan={activeOrgan}
              onSelect={setActiveOrgan}
              onNormalAllRemaining={onNormalAllRemaining}
              disabled={lockedByOther}
            />
          </div>
        </div>

        {/* CENTER */}
        <div className="min-h-0 overflow-y-auto flex flex-col gap-3">
          {activeSection && activeDefs.length > 0 && (
            <DynamicFindingBuilder
              organLabel={activeSection.label}
              defs={activeDefs}
              author={session?.user?.name ?? null}
              onAddFinding={onAddFinding}
            />
          )}
          <div className="flex flex-col gap-2">
            {sections.map((s) => (
              <OrganReportSection
                key={s.organ}
                section={s}
                active={s.organ === activeOrgan}
                onActivate={() => setActiveOrgan(s.organ)}
                onChangeText={(text) => updateSection(s.organ, (x) => ({ ...x, text }))}
                onMarkNormal={() => updateSection(s.organ, (x) => markNormal(x, normalByOrgan[s.organ] ?? ""))}
                onRemoveFinding={(i) => updateSection(s.organ, (x) => removeFinding(x, i))}
                readOnly={lockedByOther}
              />
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Impression</span>
              <button className="text-xs text-teal-600 hover:underline"
                onClick={() => { setImpressionEdited(false); setImpressionText(composeImpression(sections).join("\n")); }}>
                Regenerate
              </button>
            </div>
            <textarea
              value={impressionText}
              onChange={(e) => { setImpressionEdited(true); setImpressionText(e.target.value); }}
              rows={Math.max(2, impressionText.split("\n").length)}
              readOnly={lockedByOther}
              placeholder="Impression (auto-composed from findings; editable)…"
              className="w-full resize-y rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        {/* RIGHT — viewer + measurements co-visible with the report */}
        <div className="min-h-0 overflow-y-auto flex flex-col gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <EmbeddedWadoViewer ref={viewerRef} studyInstanceUID={entry.studyInstanceUID} accessionNumber={entry.accessionNumber} />
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
            <UsgMeasurementReviewPanel
              studyInstanceUID={entry.studyInstanceUID ?? ""}
              draftId={draftId}
              onInsertMeasurement={(label, value, unit) => appendToActive(`${label}: ${value}${unit ? " " + unit : ""}`)}
            />
          </div>
          <ComparisonPanel
            patientId={entry.patientId ?? undefined}
            currentModality={entry.modality}
            currentStudyDescription={entry.studyDescription ?? ""}
            currentFindings={sections.map((s) => s.text).filter(Boolean).join("\n")}
            onInsertFindings={appendToActive}
            onInsertImpression={(t) => { setImpressionEdited(true); setImpressionText((prev) => (prev ? `${prev}\n${t}` : t)); }}
            onSelectPrior={() => { /* prior selection surfaced by the panel; P4 wires deltas */ }}
          />
          {/* P4 structured prior comparison — flag-gated inside the component;
              accepted suggestions append to the CURRENT draft's impression only. */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
            <UsgPriorComparison
              studyId={studyId ?? null}
              onAccept={(t) => { setImpressionEdited(true); setImpressionText((prev) => (prev ? `${prev}\n${t}` : t)); }}
            />
          </div>
          {/* P5 OB/Doppler canonical sections — flag-gated inside the component;
              inserts append to the active section / impression (never auto-insert). */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
            <UsgObDopplerPanel
              studyId={studyId ?? null}
              onInsertFindings={appendToActive}
              onInsertImpression={(t) => { setImpressionEdited(true); setImpressionText((prev) => (prev ? `${prev}\n${t}` : t)); }}
            />
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
            <RadiologyKnowledgePanel activePanel={knowledgePanel} onInsert={appendToActive} />
          </div>
        </div>
      </div>
    </div>
  );
}
