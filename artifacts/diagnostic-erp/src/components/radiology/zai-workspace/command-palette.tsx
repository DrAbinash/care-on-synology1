import { useState, useEffect, useRef } from "react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { Command as Cmdk } from "cmdk";
import { Search, ChevronRight, Sparkles, AlertTriangle, Brain, Mic, Save, Printer, Plus } from "lucide-react";
import { lookupMacrosForContext } from "@/lib/zai-workspace/snippet-macros-library";

interface CommandItem {
  id: string;
  label: string;
  detail?: string;
  icon: typeof Search;
  group: string;
  action: () => void;
  shortcut?: string;
}

export function CommandPalette() {
  const open = useWorkspaceSelector((s) => s.showCommandPalette);
  const setOpen = useWorkspaceSelector((s) => s.setCommandPalette);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const ws = useWorkspace.getState();
  const study = ws.studies.find((s) => s.id === ws.activeStudyId);
  const macros = lookupMacrosForContext(ws.snippetMacros, study?.modality, ws.reportingContext);

  const items: CommandItem[] = [
    { id: "next", label: "Next study", icon: ChevronRight, group: "Navigate", action: () => ws.advanceToNextStudy(), shortcut: "N" },
    { id: "park", label: "Park study", icon: Save, group: "Navigate", action: () => ws.parkStudy(), shortcut: "P" },
    {
      id: "ai-imp",
      label: "AI auto-impression",
      detail: "Draft from findings",
      icon: Brain,
      group: "AI",
      action: () =>
        useWorkspace.getState().triggerAiImpression?.() ??
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true })),
      shortcut: "⌃I",
    },
    { id: "ai-ghost", label: "Suggest with AI at cursor", icon: Sparkles, group: "AI", action: () => ws.setGhostText("Findings concerning for acute abnormality.", "findings") },
    { id: "finalize", label: "Finalize & sign", icon: AlertTriangle, group: "Actions", action: () => ws.startFinalize(), shortcut: "⌃↵" },
    { id: "print", label: "Print report", icon: Printer, group: "Actions", action: () => window.print() },
    {
      id: "voice",
      label: "Toggle voice listen",
      icon: Mic,
      group: "Actions",
      shortcut: "⌃⇧V",
      action: () => {
        const bar = document.querySelector("[data-testid='voice-command-bar']") as HTMLElement | null;
        bar?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        window.dispatchEvent(new CustomEvent("zai-toggle-voice-listen"));
      },
    },
    { id: "undo-patch", label: "Undo last Quick Select/Macro merge", detail: "Restore pre-merge report snapshot", icon: Save, group: "Actions", action: () => ws.undoLastPatch(), shortcut: "⌃⇧Z" },
    { id: "save-fmt", label: "Save as format", icon: Save, group: "Actions", action: () => ws.openSaveAsFormatDialog() },
    ...macros.slice(0, 6).map((m) => ({
      id: `m-${m.id}`,
      label: `:${m.trigger} — ${m.label}`,
      detail: m.template.slice(0, 60) + "...",
      icon: Plus,
      group: "Macros",
      action: () => ws.setField("findings", ws.findingsText.replace(/:[a-z][a-z0-9_]*$/i, "") + `:${m.trigger} `),
    })),
  ];

  const filtered = items.filter((i) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return i.label.toLowerCase().includes(q) || (i.detail?.toLowerCase().includes(q) ?? false);
  });

  const grouped: Record<string, CommandItem[]> = {};
  for (const i of filtered) {
    if (!grouped[i.group]) grouped[i.group] = [];
    grouped[i.group].push(i);
  }

  const run = (item: CommandItem) => {
    item.action();
    setRecents((prev) => [item.id, ...prev.filter((x) => x !== item.id)].slice(0, 5));
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <Cmdk
        loop
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Cmdk.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">ESC</kbd>
        </div>

        <Cmdk.List className="max-h-[60vh] overflow-y-auto p-1">
          {recents.length > 0 && !query && (
            <Cmdk.Group
              heading="Recent"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 py-1"
            >
              {recents.map((id) => {
                const item = items.find((x) => x.id === id);
                return item ? <CommandRow key={item.id} item={item} onRun={run} /> : null;
              })}
            </Cmdk.Group>
          )}

          {Object.entries(grouped).map(([group, list]) => (
            <Cmdk.Group
              key={group}
              heading={group}
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 py-1"
            >
              {list.map((item) => (
                <CommandRow key={item.id} item={item} onRun={run} />
              ))}
            </Cmdk.Group>
          ))}

          {filtered.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No matches for &quot;{query}&quot;
            </div>
          )}
        </Cmdk.List>

        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
          <span>↑↓ · ↵ · esc</span>
          <span className="text-emerald-600">Z.ai RadReporting</span>
        </div>
      </Cmdk>
    </div>
  );
}

function CommandRow({ item, onRun }: { item: CommandItem; onRun: (item: CommandItem) => void }) {
  const Icon = item.icon;
  return (
    <Cmdk.Item
      onSelect={() => onRun(item)}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{item.label}</div>
        {item.detail && <div className="text-[10px] text-muted-foreground truncate">{item.detail}</div>}
      </div>
      {item.shortcut && (
        <kbd className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">{item.shortcut}</kbd>
      )}
    </Cmdk.Item>
  );
}
