import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuickFinding } from "./QuickFindingsPanel";
import {
  parseQuestions, fillStructuredTemplate, missingRequired,
  initialValues as defaultsFor,
} from "@/lib/structuredFindings";

/**
 * StructuredFindingDialog — the compact, keyboard-first "ask only what's needed"
 * editor.
 *
 * Opened when a finding with configured questions is clicked. Pre-fills from
 * session memory / smart defaults so the radiologist can often just press Enter
 * (fewest clicks). Shows a live preview of the generated finding text. On apply,
 * the values are handed back to the workspace, which generates and inserts the
 * report text through the existing Smart Findings Engine — no reporting logic
 * lives here.
 *
 * Keyboard (PR #77): the first field is auto-focused on open; Tab / Shift+Tab
 * move between fields; arrow keys + type-ahead drive the native dropdowns;
 * Enter applies once every required field is set; Ctrl+Enter always applies;
 * Ctrl+Backspace clears; Alt+R restores the configured defaults; Esc cancels.
 */
interface Props {
  finding: QuickFinding;
  initialValues: Record<string, string>;
  editing: boolean;
  onApply: (values: Record<string, string>) => void;
  onRemove: () => void;
  onCancel: () => void;
}

export default function StructuredFindingDialog({ finding, initialValues, editing, onApply, onRemove, onCancel }: Props) {
  const questions = parseQuestions(finding.questionsJson);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const preview = fillStructuredTemplate(finding.findingText, values);
  const missing = missingRequired(questions, values);
  const canApply = missing.length === 0;

  // Smart focus: the first editable field receives focus on open — no click.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
  }, []);

  const clearValues = () => setValues(Object.fromEntries(questions.map((q) => [q.key, ""])));
  const restoreDefaults = () => setValues(defaultsFor(questions, {}));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    // Alt+R → restore the configured defaults (smart defaults from Settings).
    if (e.altKey && (e.key === "r" || e.key === "R")) { e.preventDefault(); restoreDefaults(); return; }
    // Ctrl/Cmd+Backspace → clear values. In a text input, leave native
    // word-delete alone so the Size field still edits normally.
    if ((e.ctrlKey || e.metaKey) && e.key === "Backspace") {
      if ((e.target as HTMLElement)?.tagName !== "INPUT") { e.preventDefault(); clearValues(); }
      return;
    }
    // Enter (plain, once valid) or Ctrl/Cmd+Enter (always) → apply.
    if (e.key === "Enter" && !e.shiftKey && canApply) { e.preventDefault(); onApply(values); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={onKeyDown}
    >
      <div ref={cardRef} className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg">
        <h3 className="text-sm font-semibold">{finding.label}</h3>
        <p className="text-[10px] text-muted-foreground">Confirm the details — remembered for the next one.</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {questions.map((q) => (
            <div key={q.key} className={q.type === "text" || q.options.length === 0 ? "col-span-2" : ""}>
              <Label className="text-[11px]">{q.label}{q.required ? " *" : ""}</Label>
              {q.type === "text" || q.options.length === 0 ? (
                <Input
                  value={values[q.key] ?? ""}
                  onChange={(e) => set(q.key, e.target.value)}
                  className="h-8 text-sm"
                  placeholder={q.label}
                />
              ) : (
                <select
                  value={values[q.key] ?? ""}
                  onChange={(e) => set(q.key, e.target.value)}
                  className="h-8 w-full text-sm border rounded-md px-2 bg-background"
                >
                  {!q.options.includes(values[q.key] ?? "") && (
                    <option value={values[q.key] ?? ""}>{values[q.key] || "—"}</option>
                  )}
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-md border bg-muted/20 p-2">
          <p className="text-[9px] font-semibold uppercase text-muted-foreground mb-0.5">Generated finding</p>
          <p className="text-xs">{preview || <span className="text-muted-foreground">…</span>}</p>
        </div>
        {missing.length > 0 && <p className="mt-1 text-[10px] text-destructive">Required: {missing.join(", ")}</p>}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[9px] text-muted-foreground">
            <kbd>↵</kbd> apply · <kbd>Esc</kbd> cancel · <kbd>Ctrl</kbd>+<kbd>⌫</kbd> clear · <kbd>Alt</kbd>+<kbd>R</kbd> defaults
          </span>
          <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
          {editing && <Button size="sm" variant="outline" className="h-8" onClick={onRemove}>Remove</Button>}
          <Button size="sm" className="h-8" disabled={!canApply} onClick={() => onApply(values)}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
