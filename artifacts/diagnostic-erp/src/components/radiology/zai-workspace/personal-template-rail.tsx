import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Save, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  appendPersonalTemplate,
  createPersonalTemplate,
  filterPersonalTemplatesForStudy,
  insertTemplateTextAtSelection,
  isGlobalPersonalTemplate,
  mergePersonalTemplatesFromServer,
  personalTemplateScopeLabel,
  personalTemplateToServerBody,
  removePersonalTemplate,
  updatePersonalTemplate,
  writePersonalReportTemplates,
  type PersonalReportTemplate,
  type PersonalTemplateServerRow,
  type PersonalTemplateTarget,
} from "@/lib/personalReportTemplates";
import { focusClinicalFieldEditor } from "@/lib/clinicalFieldDom";
import { api } from "@/lib/fetchApi";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  templates: PersonalReportTemplate[];
  onTemplatesChange: (next: PersonalReportTemplate[]) => void;
  /** Active / last-focused clinical field for insert + save. */
  activeTarget: PersonalTemplateTarget;
  getFieldText: (target: PersonalTemplateTarget) => string;
  setFieldText: (target: PersonalTemplateTarget, text: string) => void;
  /** Current study identity — drives modality / region filtering. */
  studyContext?: ReportingStudyContext | null;
  disabled?: boolean;
}

/**
 * Sticky personal-template rail beside the report editor.
 * Mouse-first: click a pill to insert; save active text via a naming dialog.
 * Templates tagged with modality/region are filtered to the open study
 * (untagged macros always remain available).
 */
export function PersonalTemplateRail({
  collapsed,
  onToggleCollapsed,
  templates,
  onTemplatesChange,
  activeTarget,
  getFieldText,
  setFieldText,
  studyContext = null,
  disabled = false,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveForAllStudies, setSaveForAllStudies] = useState(false);
  // U5 — the dialog is dual-mode: "create" saves the current field text (or
  // just the active SELECTION) under a new name; "edit" renames/rewrites an
  // existing template. `saveSourceText` carries what create will save, so a
  // selection can be saved without first isolating it in the field.
  const [editingTpl, setEditingTpl] = useState<PersonalReportTemplate | null>(null);
  const [saveSourceText, setSaveSourceText] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const activeText = getFieldText(activeTarget);
  const canSave = !disabled && activeText.trim().length > 0;

  const readActiveEditor = (): HTMLTextAreaElement | null => {
    if (typeof document === "undefined") return null;
    return document.querySelector(`[data-report-field="${activeTarget}"] textarea`) as HTMLTextAreaElement | null;
  };
  const currentSelectionText = (el: HTMLTextAreaElement): string | null =>
    el.selectionStart != null && el.selectionEnd != null && el.selectionEnd > el.selectionStart
      ? el.value.slice(el.selectionStart, el.selectionEnd)
      : null;

  const visible = useMemo(
    () => filterPersonalTemplatesForStudy(templates, studyContext),
    [templates, studyContext],
  );

  const sorted = useMemo(
    () =>
      [...visible].sort((a, b) => {
        // Prefer study-scoped macros above globals, then newest first.
        const aGlobal = isGlobalPersonalTemplate(a) ? 1 : 0;
        const bGlobal = isGlobalPersonalTemplate(b) ? 1 : 0;
        if (aGlobal !== bGlobal) return aGlobal - bGlobal;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [visible],
  );

  const scopeHint = useMemo(() => {
    if (!studyContext?.modality && !studyContext?.region) return null;
    const parts: string[] = [];
    if (studyContext.modality) parts.push(studyContext.modality.toUpperCase());
    if (studyContext.region) parts.push(studyContext.region);
    return parts.join(" · ");
  }, [studyContext]);

  const persist = (next: PersonalReportTemplate[]) => {
    onTemplatesChange(next);
    writePersonalReportTemplates(
      typeof window !== "undefined" ? window.localStorage : null,
      next,
    );
  };

  // ── U6 — server roaming (radiology_snippets, type = personal_template) ──
  // Templates used to be workstation-local only (localStorage), so a
  // radiologist who curated snippets on reporting PC 1 had an empty rail on
  // PC 2. The rail now hydrates from the radiologist's own snippet rows and
  // pushes creates/edits/deletes through the existing per-user snippets API.
  // Offline policy mirrors the chocolate-macro save path: localStorage stays
  // the working copy; server writes are fire-and-forget and a failure costs
  // roaming, never the local library.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || collapsed) return;
    hydratedRef.current = true;
    let alive = true;
    void (async () => {
      try {
        const res = await api.get<{ items: PersonalTemplateServerRow[] }>(
          "/api/radiology/snippets?type=personal_template&active=true&limit=500",
        );
        if (!alive || !Array.isArray(res?.items)) return;
        const merged = mergePersonalTemplatesFromServer(res.items, templates);
        if (merged.length !== templates.length || merged.some((t, i) => t.id !== templates[i]?.id)) {
          persist(merged);
        }
        // Migrate an existing local library: push any unsynced, non-seed row
        // once so it starts roaming immediately.
        for (const t of merged) {
          if (t.serverId || t.id.startsWith("seed-")) continue;
          try {
            const row = await api.post<{ id: number }>("/api/radiology/snippets", personalTemplateToServerBody(t));
            if (row?.id) {
              persist(merged.map((x) => (x.id === t.id ? { ...x, serverId: row.id } : x)));
            }
          } catch { /* offline — stays local, pushed on next save */ }
        }
      } catch { /* offline — localStorage remains the working copy */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per mount
  }, []);

  const syncCreate = (created: PersonalReportTemplate, all: PersonalReportTemplate[]) => {
    void (async () => {
      try {
        const row = await api.post<{ id: number }>("/api/radiology/snippets", personalTemplateToServerBody(created));
        if (row?.id) {
          persist(all.map((t) => (t.id === created.id ? { ...t, serverId: row.id } : t)));
        }
      } catch { /* offline */ }
    })();
  };
  const syncUpdate = (tpl: PersonalReportTemplate) => {
    if (!tpl.serverId) { syncCreate(tpl, templates); return; }
    void api.put(`/api/radiology/snippets/${tpl.serverId}`, personalTemplateToServerBody(tpl)).catch(() => {});
  };
  const syncDelete = (tpl: PersonalReportTemplate) => {
    if (!tpl.serverId) return;
    void api.delete(`/api/radiology/snippets/${tpl.serverId}`).catch(() => {});
  };

  const handleInsert = (tpl: PersonalReportTemplate) => {
    if (disabled) return;
    // U5 — insert at the CARET (or over the selection), not always at the
    // field's end. The editor's selection is read at click time; onMouseDown
    // on the pill prevents the focus shift that would lose it.
    const el = readActiveEditor();
    const current = getFieldText(activeTarget);
    const { text, caretAt } = insertTemplateTextAtSelection(
      current,
      tpl.text,
      el?.selectionStart,
      el?.selectionEnd,
    );
    setFieldText(activeTarget, text);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caretAt, caretAt); } catch { /* detached */ }
      });
    } else {
      focusClinicalFieldEditor(activeTarget);
    }
  };

  const openCreateDialog = () => {
    // U5 — selection-aware save: if the radiologist selected exactly the
    // sentences they want as a snippet, save THAT, not the whole field.
    const el = readActiveEditor();
    setEditingTpl(null);
    setSaveSourceText(el ? currentSelectionText(el) : null);
    setSaveName("");
    setSaveForAllStudies(false);
    setSaveOpen(true);
  };

  const openEditDialog = (tpl: PersonalReportTemplate) => {
    setEditingTpl(tpl);
    setSaveName(tpl.name);
    setEditText(tpl.text);
    setSaveSourceText(null);
    setSaveOpen(true);
  };

  const handleSave = () => {
    if (editingTpl) {
      if (!saveName.trim() || !editText.trim()) return;
      const updated = { ...editingTpl, name: saveName.trim(), text: editText };
      const next = updatePersonalTemplate(templates, updated);
      persist(next);
      syncUpdate(updated);
      setSaveOpen(false);
      return;
    }
    if (!canSave || !saveName.trim()) return;
    const source = saveSourceText ?? activeText;
    const created = createPersonalTemplate({
      name: saveName,
      text: source,
      target: activeTarget,
      modality: saveForAllStudies ? null : (studyContext?.modality ?? null),
      region: saveForAllStudies ? null : (studyContext?.region ?? null),
    });
    const next = appendPersonalTemplate(templates, created);
    persist(next);
    syncCreate(created, next);
    setSaveName("");
    setSaveForAllStudies(false);
    setSaveSourceText(null);
    setSaveOpen(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-full flex-col items-center gap-2 border-l border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/20 py-3 text-emerald-700 transition-colors hover:bg-emerald-50"
        onClick={onToggleCollapsed}
        title="Expand templates"
        data-testid="personal-template-rail-expand"
      >
        <ChevronLeft className="h-4 w-4" />
        <span
          className="text-[9px] font-semibold uppercase tracking-wider text-emerald-800"
          style={{ writingMode: "vertical-rl" }}
        >
          Templates
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/15"
      data-testid="personal-template-rail"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-tight text-emerald-950">
          Templates
        </h3>
        <span
          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800"
          data-testid="personal-template-target-badge"
          title="Inserts into this field"
        >
          → {activeTarget === "findings" ? "Findings" : "Impression"}
        </span>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800"
          onClick={onToggleCollapsed}
          title="Minimize templates"
          data-testid="personal-template-rail-collapse"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {scopeHint ? (
        <div
          className="shrink-0 border-b border-border/40 bg-emerald-50/40 px-2 py-1 text-[9px] font-medium text-emerald-900"
          data-testid="personal-template-study-scope"
          title="Showing macros for this study plus untagged globals"
        >
          Filtered for {scopeHint}
          {visible.length !== templates.length ? (
            <span className="text-muted-foreground">
              {" "}
              · {visible.length}/{templates.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-2 py-3 text-center text-[11px] text-muted-foreground">
            No saved templates yet. Write Findings or Impression, then save below.
          </p>
        ) : (
          sorted.map((tpl) => (
            <div key={tpl.id} className="group flex items-stretch gap-1">
              <button
                type="button"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleInsert(tpl)}
                className={cn(
                  "min-w-0 flex-1 rounded-lg border border-emerald-200/80 bg-white px-3 py-1.5 text-left text-[11px] font-medium text-emerald-950 shadow-sm",
                  "hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50",
                )}
                title={`Insert at the caret in ${activeTarget}`}
                data-testid={`personal-template-pill-${tpl.id}`}
              >
                <span className="block truncate">{tpl.name}</span>
                <span className="mt-0.5 block truncate text-[9px] font-normal text-muted-foreground">
                  {personalTemplateScopeLabel(tpl)}
                </span>
              </button>
              {!tpl.id.startsWith("seed-") && (
                <>
                  <button
                    type="button"
                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-emerald-50 hover:text-emerald-800 group-hover:opacity-100"
                    title="Edit template (rename / rewrite)"
                    onClick={() => openEditDialog(tpl)}
                    data-testid={`personal-template-edit-${tpl.id}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100"
                    title="Delete template"
                    onClick={() => {
                      syncDelete(tpl);
                      persist(removePersonalTemplate(templates, tpl.id));
                    }}
                    data-testid={`personal-template-delete-${tpl.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full justify-center gap-1.5 border-emerald-300 bg-emerald-50 text-[11px] text-emerald-900 hover:bg-emerald-100"
          disabled={!canSave}
          onClick={openCreateDialog}
          data-testid="personal-template-save-open"
        >
          <Save className="h-3.5 w-3.5" />
          Save Current Text as Macro Template
        </Button>
        <p className="mt-1 text-center text-[9px] leading-tight text-muted-foreground">
          Select text in the editor first to save just that selection.
        </p>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm" data-testid="personal-template-save-dialog">
          <DialogHeader>
            <DialogTitle>{editingTpl ? "Edit template" : "Save template"}</DialogTitle>
            <DialogDescription>
              {editingTpl
                ? "Rename or rewrite this snippet."
                : saveSourceText
                  ? `Saves your SELECTION (${saveSourceText.trim().length} chars) — not the whole ${activeTarget} field.`
                  : `Names this ${activeTarget} snippet for one-click insert. Saved to YOUR account — it follows you to any workstation (offline changes stay on this one until the next save).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="personal-template-name" className="text-[11px] uppercase tracking-wider">
              Template name
            </Label>
            <Input
              id="personal-template-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Normal Chest XR"
              className="h-8 text-sm"
              autoFocus
              data-testid="personal-template-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !editingTpl) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            {editingTpl ? (
              <>
                <Label htmlFor="personal-template-text" className="text-[11px] uppercase tracking-wider">
                  Template text
                </Label>
                <textarea
                  id="personal-template-text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="min-h-[90px] w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
                  data-testid="personal-template-text-input"
                />
              </>
            ) : (
              <>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[11px] text-foreground/80">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={saveForAllStudies}
                    onChange={(e) => setSaveForAllStudies(e.target.checked)}
                    data-testid="personal-template-save-all-studies"
                  />
                  <span>
                    Available on all studies
                    {!saveForAllStudies && scopeHint ? (
                      <span className="block text-[10px] text-muted-foreground">
                        Otherwise tagged for {scopeHint}
                      </span>
                    ) : null}
                  </span>
                </label>
                <p className="line-clamp-3 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap">
                  {(saveSourceText ?? activeText).trim() || "(empty)"}
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={editingTpl ? !saveName.trim() || !editText.trim() : !saveName.trim() || !canSave}
              onClick={handleSave}
              data-testid="personal-template-save-confirm"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
