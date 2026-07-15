import { useEffect, useMemo, useState } from "react";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Zap, Activity, FileText, ClipboardList, Layers, TerminalSquare, Settings2, FolderSearch, Star,
} from "lucide-react";
import {
  buildPaletteView, flattenSections, type PaletteItem, type PaletteItemKind,
} from "@/lib/commandPalette";

/**
 * CommandPalette — the universal Ctrl+K palette for the Reporting Workspace.
 *
 * A thin, keyboard-first view: the ranking / grouping / recents / favourites
 * all come from the pure `commandPalette` engine, the items are built from data
 * the workspace already has cached, and running an item calls back into the
 * workspace's EXISTING handlers. cmdk provides accessible arrow/Enter
 * navigation (its own filtering is disabled — we feed it our ranked list).
 *
 * No AI, no per-keystroke backend calls — search is entirely local.
 */

const KIND_ICON: Record<PaletteItemKind, React.ComponentType<{ className?: string }>> = {
  finding: Zap,
  protocol: Activity,
  template: FileText,
  history: ClipboardList,
  combination: Layers,
  command: TerminalSquare,
  setting: Settings2,
  study: FolderSearch,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  recent: string[];
  favourites: Set<string>;
  onToggleFavourite: (id: string) => void;
  onRun: (item: PaletteItem) => void;
}

export default function CommandPalette({ open, onOpenChange, items, recent, favourites, onToggleFavourite, onRun }: Props) {
  const [query, setQuery] = useState("");

  // Fresh query every time it opens (keyboard-first: type immediately).
  useEffect(() => { if (open) setQuery(""); }, [open]);

  const sections = useMemo(
    () => buildPaletteView(items, { query, recent, favourites }),
    [items, query, recent, favourites],
  );
  // Stable value → item lookup so cmdk's Enter runs the right thing.
  const byValue = useMemo(() => new Map(flattenSections(sections).map((it) => [it.id, it])), [sections]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-2xl gap-0" data-testid="command-palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          shouldFilter={false}
          onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search findings, protocols, templates, history, commands…"
          />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>No matches. Try a finding, protocol, template, or command.</CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.key} heading={section.label}>
                {section.items.map((it) => {
                  const Icon = KIND_ICON[it.kind];
                  const isFav = favourites.has(it.id);
                  return (
                    <CommandItem
                      key={it.id}
                      value={it.id}
                      onSelect={() => { const item = byValue.get(it.id); if (item) onRun(item); }}
                    >
                      <Icon className="text-muted-foreground" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{it.title}</span>
                        {it.subtitle && <span className="truncate text-[11px] text-muted-foreground">{it.subtitle}</span>}
                      </div>
                      {it.favouritable && (
                        <button
                          type="button"
                          aria-label={isFav ? "Unfavourite" : "Favourite"}
                          className={`ml-auto shrink-0 p-1 ${isFav ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500"}`}
                          // Toggle without letting cmdk select/run the row.
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavourite(it.id); }}
                        >
                          <Star size={14} fill={isFav ? "currentColor" : "none"} />
                        </button>
                      )}
                      <CommandShortcut className={it.favouritable ? "ml-2" : "ml-auto"}>
                        {CATEGORY_SHORT[it.kind]}
                      </CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> run</span>
            <span><kbd>Esc</kbd> close</span>
            <span className="ml-auto"><kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const CATEGORY_SHORT: Record<PaletteItemKind, string> = {
  finding: "Finding",
  protocol: "Protocol",
  template: "Template",
  history: "History",
  combination: "Combo",
  command: "Command",
  setting: "Setting",
  study: "Study",
};
