import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  parseEditableQuestions, serializeQuestions, type EditableQuestion,
} from "@/lib/structuredFindings";

/**
 * StructuredQuestionsEditor — the Settings sub-editor for a finding's
 * Structured Finding Assistant questions.
 *
 * Everything is configurable here: add / edit / delete a question, its label,
 * type (dropdown vs free text), dropdown values, default value, whether it is
 * mandatory, and the display order (up / down). The result serializes to the
 * finding's `questionsJson` — the SAME array the workspace dialog parses. An
 * empty list means the finding inserts immediately (no dialog).
 *
 * Seeded once from `initial` and self-managed so typing a comma in the options
 * field never fights a controlled re-parse; every edit pushes the serialized
 * JSON up via `onChange`. Parent remounts it (via a React key) when switching
 * findings, which reseeds cleanly.
 *
 * The pure parse/serialize helpers live in @/lib/structuredFindings (alias-free,
 * root-testable); this file owns only the React UI.
 */

/** The `{key}` placeholders referenced by a finding's text — so the admin can
 *  see at a glance which questions the text actually uses. */
function placeholdersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) out.add(m[1]);
  return [...out];
}

interface Props {
  initial: string;
  onChange: (questionsJson: string) => void;
  /** Finding/impression text, to surface referenced {placeholders}. */
  referenceText?: string;
}

export default function StructuredQuestionsEditor({ initial, onChange, referenceText = "" }: Props) {
  const [qs, setQs] = useState<EditableQuestion[]>(() => parseEditableQuestions(initial));

  const commit = (next: EditableQuestion[]) => {
    setQs(next);
    onChange(serializeQuestions(next));
  };
  const patch = (i: number, p: Partial<EditableQuestion>) =>
    commit(qs.map((q, idx) => (idx === i ? { ...q, ...p } : q)));
  const add = () =>
    commit([...qs, { key: "", label: "", type: "select", options: "", default: "", required: false }]);
  const remove = (i: number) => commit(qs.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return;
    const next = qs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const referenced = useMemo(() => placeholdersIn(referenceText), [referenceText]);
  const definedKeys = new Set(qs.map((q) => q.key.trim()).filter(Boolean));

  return (
    <div className="rounded-md border border-dashed p-2 bg-muted/10 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-semibold">
          Structured questions — asked in a compact dialog when this finding is clicked
        </Label>
        <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={add} type="button">
          <Plus size={11} /> Add question
        </Button>
      </div>

      {qs.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          No questions — clicking this finding inserts it immediately (fewest clicks). Add a question to
          collect a value (e.g. Level) before generating the text.
        </p>
      )}

      {qs.map((q, i) => {
        const unused = q.key.trim() !== "" && referenced.length > 0 && !referenced.includes(q.key.trim());
        return (
          <div key={i} className="rounded border bg-background p-2 space-y-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 flex-1">
                <div>
                  <Label className="text-[9px] text-muted-foreground">Key (matches {"{key}"})</Label>
                  <Input value={q.key} onChange={(e) => patch(i, { key: e.target.value })}
                    className="h-7 text-xs" placeholder="level" />
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground">Question label</Label>
                  <Input value={q.label} onChange={(e) => patch(i, { label: e.target.value })}
                    className="h-7 text-xs" placeholder="Level" />
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground">Type</Label>
                  <select value={q.type} onChange={(e) => patch(i, { type: e.target.value as "select" | "text" })}
                    className="h-7 w-full text-xs border rounded-md px-1.5 bg-background">
                    <option value="select">Dropdown</option>
                    <option value="text">Free text</option>
                  </select>
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground">Default value</Label>
                  <Input value={q.default} onChange={(e) => patch(i, { default: e.target.value })}
                    className="h-7 text-xs" placeholder="L4-L5" />
                </div>
              </div>
              <div className="flex flex-col shrink-0">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="text-muted-foreground hover:text-primary disabled:opacity-30" title="Move up">
                  <ArrowUp size={12} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === qs.length - 1}
                  className="text-muted-foreground hover:text-primary disabled:opacity-30" title="Move down">
                  <ArrowDown size={12} />
                </button>
              </div>
              <button type="button" onClick={() => remove(i)}
                className="text-muted-foreground hover:text-destructive shrink-0" title="Delete question">
                <Trash2 size={13} />
              </button>
            </div>

            {q.type === "select" && (
              <div>
                <Label className="text-[9px] text-muted-foreground">
                  Dropdown values (comma-separated; &ldquo;Normal&rdquo;/&ldquo;None&rdquo; drop their optional clause)
                </Label>
                <Input value={q.options} onChange={(e) => patch(i, { options: e.target.value })}
                  className="h-7 text-xs" placeholder="Normal, mild, moderate, severe" />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch checked={q.required} onCheckedChange={(v) => patch(i, { required: v })} className="scale-75" />
              <span className="text-[10px] text-muted-foreground">Mandatory (Apply is disabled until answered)</span>
              {unused && (
                <span className="ml-auto text-[9px] text-amber-600" title="This key is not used by the finding/impression text">
                  ⚠ {"{"}{q.key.trim()}{"}"} not in text
                </span>
              )}
            </div>
          </div>
        );
      })}

      {referenced.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Placeholders in text:{" "}
          {referenced.map((p) => (
            <span key={p} className={`font-mono ${definedKeys.has(p) ? "text-primary" : "text-amber-600"}`}>
              {"{"}{p}{"}"}{" "}
            </span>
          ))}
          <span className="opacity-70">— amber = no matching question yet.</span>
        </p>
      )}
    </div>
  );
}
