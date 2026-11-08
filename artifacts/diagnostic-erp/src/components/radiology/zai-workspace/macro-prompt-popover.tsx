import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { useState, useEffect, useRef } from "react";
import { Zap, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function MacroPromptPopover() {
  const prompt = useWorkspaceSelector(s => s.activeMacroPrompt); const apply = useWorkspaceSelector(s => s.applyMacroWithValues); const cancel = useWorkspaceSelector(s => s.setActiveMacroPrompt);
  const [values, setValues] = useState<Record<string, string>>({});
  const controlsRef = useRef<Array<HTMLInputElement | HTMLSelectElement | null>>([]);
  // Focus the first control WHATEVER its type. A variable declared with options
  // renders a <select>, not an <Input>, and the old single-ref version left
  // :afollow — whose only variable is the interval dropdown — unfocused, so its
  // own "fill and press Enter" label went to the textarea instead of to here.
  useEffect(() => {
    if (prompt) {
      const init: Record<string, string> = {};
      for (const v of prompt.macro.variables) init[v.name] = v.default ?? "";
      setValues(init);
      controlsRef.current = [];
      setTimeout(() => controlsRef.current[0]?.focus(), 50);
    }
  }, [prompt]);
  if (!prompt) return null;
  const vars = prompt.macro.variables;
  // A variable is "filled" when its value is non-empty. Variables declared with
  // options render a <select> that must still be chosen; variables with a
  // default arrive pre-filled. Everything else needs typing. This is the gate
  // that keeps the literal `___` out of clinical text: expandMacro's last-resort
  // fallback is reachable only through an empty required variable, and the
  // Expand button + Enter are both blocked while one exists.
  const filledCount = vars.filter(v => (values[v.name] ?? "").trim() !== "").length;
  const allFilled = vars.length === 0 || filledCount === vars.length;
  const handleApply = () => { if (allFilled) apply(values); };
  const hk = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(null); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter applies ONLY from the last control (or when there is nothing to
      // fill). From any earlier control it moves to the next one — the header
      // says "fill and press Enter", and half-filled variables pressing Enter
      // is how `Mild ___ disc protrusion` reached findings. Tab is left alone
      // entirely: it moves focus, it never applies (B11).
      if (index === vars.length - 1) handleApply();
      else controlsRef.current[index + 1]?.focus();
    }
  };
  return <div className="fixed bottom-20 left-1/2 z-40 w-[420px] max-w-[95vw] -translate-x-1/2 animate-in slide-in-from-bottom-2"><div className="rounded-xl border-2 border-emerald-400 bg-white shadow-2xl"><div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2"><Zap className="h-4 w-4 text-emerald-600" /><div className="flex-1"><div className="text-sm font-bold text-emerald-700">{prompt.macro.label}</div><div className="text-[10px] text-emerald-600/80">{" :"}{prompt.macro.trigger} — fill and press Enter</div></div><button onClick={() => cancel(null)} className="rounded-full p-1 text-emerald-500 hover:bg-emerald-100"><X className="h-3.5 w-3.5" /></button></div><div className="space-y-2 p-3">{vars.length === 0 ? <div className="text-[11px] text-muted-foreground">No variables. Press Enter.</div> : vars.map((v, i) => <div key={v.name}><Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{v.label || v.name}</Label>{v.options && v.options.length > 0 ? <select ref={el => { controlsRef.current[i] = el; }} value={values[v.name] ?? ""} onChange={e => setValues({ ...values, [v.name]: e.target.value })} onKeyDown={e => hk(e, i)} className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm h-8">{v.options.map(o => <option key={o} value={o}>{o}</option>)}</select> : <Input ref={el => { controlsRef.current[i] = el; }} value={values[v.name] ?? ""} onChange={e => setValues({ ...values, [v.name]: e.target.value })} onKeyDown={e => hk(e, i)} placeholder={v.default || v.name} className="h-8 text-sm" />}</div>)}<div className="flex gap-1.5 pt-1"><Button size="sm" className="flex-1 h-7 bg-emerald-600 text-[11px] hover:bg-emerald-700" disabled={!allFilled} onClick={handleApply}><ChevronRight className="h-3 w-3 mr-1" /> Expand</Button><Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => cancel(null)}>Cancel</Button></div>{vars.length > 0 && (allFilled
    ? <div className="text-center pt-1 text-[9px] text-muted-foreground"><kbd className="rounded bg-muted px-1 py-0.5 font-mono">Enter</kbd> expand from the last field · <kbd className="rounded bg-muted px-1 py-0.5 font-mono">Esc</kbd> cancel</div>
    : <div className="text-center pt-1 text-[9px] font-medium text-amber-700" data-testid="macro-unfilled-count">{filledCount} of {vars.length} filled — every field needs a value before Expand</div>)}</div></div></div>;
}
