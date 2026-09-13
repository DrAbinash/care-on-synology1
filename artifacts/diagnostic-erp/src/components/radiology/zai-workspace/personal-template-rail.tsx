import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Save, Trash2 } from "lucide-react";
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
  insertTemplateText,
  removePersonalTemplate,
  type PersonalReportTemplate,
  type PersonalTemplateTarget,
  writePersonalReportTemplates,
} from "@/lib/personalReportTemplates";

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  templates: PersonalReportTemplate[];
  onTemplatesChange: (next: PersonalReportTemplate[]) => void;
  /** Active / last-focused clinical field for insert + save. */
  activeTarget: PersonalTemplateTarget;
  getFieldText: (target: PersonalTemplateTarget) => string;
  setFieldText: (target: PersonalTemplateTarget, text: string) => void;
  disabled?: boolean;
}

/**
 * Sticky personal-template rail beside the report editor.
 * Mouse-first: click a pill to insert; save active text via a naming dialog.
 */
export function PersonalTemplateRail({
  collapsed,
  onToggleCollapsed,
  templates,
  onTemplatesChange,
  activeTarget,
  getFieldText,
  setFieldText,
  disabled = false,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const activeText = getFieldText(activeTarget);
  const canSave = !disabled && activeText.trim().length > 0;

  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) => {
        // Keep seed items after physician-saved ones when timestamps differ.
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [templates],
  );

  const persist = (next: PersonalReportTemplate[]) => {
    onTemplatesChange(next);
    writePersonalReportTemplates(
      typeof window !== "undefined" ? window.localStorage : null,
      next,
    );
  };

  const handleInsert = (tpl: PersonalReportTemplate) => {
    if (disabled) return;
    const target = activeTarget;
    const next = insertTemplateText(getFieldText(target), tpl.text);
    setFieldText(target, next);
  };

  const handleSave = () => {
    if (!canSave || !saveName.trim()) return;
    const created = createPersonalTemplate({
      name: saveName,
      text: activeText,
      target: activeTarget,
    });
    persist(appendPersonalTemplate(templates, created));
    setSaveName("");
    setSaveOpen(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-full flex-col items-center gap-2 border-l border-emerald-200/50 bg-gradient-to-b from-card to-emerald-50/20 py-3 text-emerald-700 hover:bg-emerald-50 transition-colors"
        onClick={onToggleCollapsed}
        title="Expand templates"
        data-testid="personal-template-rail-expand"
      >
        <ChevronLeft className="h-4 w-4" />
        <span
          className="text-[9px] font-semibold tracking-wider uppercase text-emerald-800"
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
                onClick={() => handleInsert(tpl)}
                className={cn(
                  "min-w-0 flex-1 rounded-full border border-emerald-200/80 bg-white px-3 py-1.5 text-left text-[11px] font-medium text-emerald-950 shadow-sm",
                  "hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50",
                )}
                title={`Insert into ${activeTarget}`}
                data-testid={`personal-template-pill-${tpl.id}`}
              >
                <span className="block truncate">{tpl.name}</span>
              </button>
              {!tpl.id.startsWith("seed-") && (
                <button
                  type="button"
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100"
                  title="Delete template"
                  onClick={() => persist(removePersonalTemplate(templates, tpl.id))}
                  data-testid={`personal-template-delete-${tpl.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
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
          onClick={() => {
            setSaveName("");
            setSaveOpen(true);
          }}
          data-testid="personal-template-save-open"
        >
          <Save className="h-3.5 w-3.5" />
          Save Current Text as Macro Template
        </Button>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm" data-testid="personal-template-save-dialog">
          <DialogHeader>
            <DialogTitle>Save template</DialogTitle>
            <DialogDescription>
              Names this {activeTarget} snippet for one-click insert later. Stored on this workstation only.
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
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <p className="line-clamp-3 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {activeText.trim() || "(empty)"}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!saveName.trim() || !canSave}
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
