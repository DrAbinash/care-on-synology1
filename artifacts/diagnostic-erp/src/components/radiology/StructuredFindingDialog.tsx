import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuickFinding } from "./QuickFindingsPanel";
import { parseQuestions, fillStructuredTemplate, missingRequired } from "@/lib/structuredFindings";

/**
 * StructuredFindingDialog — the compact "ask only what's needed" editor.
 *
 * Opened when a finding with configured questions is clicked. Pre-fills from
 * session memory / defaults so the radiologist can often just press Apply
 * (fewest clicks). Shows a live preview of the generated finding text. On Apply,
 * the values are handed back to the workspace, which generates and inserts the
 * report text through the existing Smart Findings Engine — no reporting logic
 * lives here.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && missing.length === 0) onApply(values);
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg">
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
                  autoFocus={q.required && !values[q.key]}
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

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
          {editing && <Button size="sm" variant="outline" className="h-8" onClick={onRemove}>Remove</Button>}
          <Button size="sm" className="h-8" disabled={missing.length > 0} onClick={() => onApply(values)}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
