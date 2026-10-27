import { useState, useEffect, useRef } from "react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { Command as Cmdk } from "cmdk";
import { Search, ChevronRight, AlertTriangle, Brain, Mic, Save, Printer, Plus, Undo2, Redo2 } from "lucide-react";
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

export function CommandPalette({
  onPrintReport, onFinalize, onNextStudy, onParkStudy,
}: {
  onPrintReport?: () => void;
  onFinalize?: () => void;
  onNextStudy?: () => void;
  onParkStudy?: () => void;
}) {
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
    // A-03 — these two used to call the STORE's `advanceToNextStudy()` / `parkStudy()`.
    // Those change which study the workspace holds without any navigation, because the
    // store has no router access, so the route stayed on B while the store moved to C:
    // the radiologist kept looking at B's worklist row and B's demographics over a canvas
    // holding C's context, and an autosave initiated for the route study committed against
    // B with C's content. They now run the workspace's own guarded commands — the same
    // `commandDispatcher.next` / `.park` the keyboard uses, which go through
    // `requestLeaveThen` → `beginTransition` → `openStudy` and therefore navigate, select
    // and hydrate as one transition. Same convention as the print and finalize items:
    // unwired means absent, never silently the unsafe path.
    ...(onNextStudy
      ? [{ id: "next", label: "Next study", icon: ChevronRight, group: "Navigate", action: () => onNextStudy(), shortcut: "N" } as CommandItem]
      : []),
    ...(onParkStudy
      ? [{ id: "park", label: "Park study", icon: Save, group: "Navigate", action: () => onParkStudy(), shortcut: "P" } as CommandItem]
      : []),
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
    // A-01 consequence, not cleanup. This command used to call `ws.startFinalize()` and
    // nothing else — it armed the flag without ever running the gauntlet. That was
    // harmless only because nothing read `isFinalizing`: the repository's sole
    // `startFinalize()` caller set a flag that made the finalize dialog show a spinner
    // while the report was never actually being signed. Now that the real finalize arms
    // the flag and the leave guard honours it, a stuck `true` would wedge every study
    // switch in the workspace. So the command runs what its label advertises, through the
    // same callback-prop seam the print item below uses — and when no finalize route is
    // wired the command is absent rather than misleading, exactly the rule the print item
    // already follows. ⌃↵ on the keyboard was always the real path (it dispatches
    // `commandDispatcher.finalize`); this item simply never joined it.
    ...(onFinalize
      ? [{
        id: "finalize",
        label: "Finalize & sign",
        icon: AlertTriangle,
        group: "Actions",
        action: () => onFinalize(),
        shortcut: "⌃↵",
      } as CommandItem]
      : []),
    // Printing the workspace window would put the worklist, the viewer and every
    // other patient's row on paper, so this command exists only when the real
    // print route is wired — and then it IS that route, not the browser's own.
    ...(onPrintReport
      ? [{
        id: "print",
        label: "Print report",
        detail: "Saves, then prints the final layout",
        icon: Printer,
        group: "Actions",
        action: () => onPrintReport(),
      } as CommandItem]
      : []),
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
    // The palette is the only place these keystrokes are written down for the radiologist to read, and
    // it claimed ⌃⇧Z for undo — which is now redo. Two entries, each naming its own combination, so the
    // help cannot disagree with the keyboard again.
    { id: "undo-patch", label: "Undo last clinical change", detail: "Restore the report text, observations and selection from before the last change", icon: Undo2, group: "Actions", action: () => ws.undoLastPatch(), shortcut: "⌃Z" },
    { id: "redo-patch", label: "Redo last undone clinical change", detail: "Replay the change you just undid; a new clinical edit clears this history", icon: Redo2, group: "Actions", action: () => ws.redoLastPatch(), shortcut: "⌃⇧Z / ⌃Y" },
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
