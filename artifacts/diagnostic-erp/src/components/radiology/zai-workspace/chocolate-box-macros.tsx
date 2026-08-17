import { useEffect, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  CHOCOLATE_BOX_CHANGED,
  deleteChocolateTile,
  listedChocolateBoxSets,
  loadChocolateTiles,
  resetChocolateTiles,
  upsertChocolateTile,
  type ChocolateBoxSet,
  type ChocolateTile,
} from "@/lib/findingsMacros";

const PALETTES = [
  "border-indigo-300 bg-gradient-to-br from-indigo-50 to-white text-indigo-900 hover:border-indigo-500 hover:shadow-indigo-200/50",
  "border-violet-300 bg-gradient-to-br from-violet-50 to-white text-violet-900 hover:border-violet-500 hover:shadow-violet-200/50",
  "border-fuchsia-300 bg-gradient-to-br from-fuchsia-50 to-white text-fuchsia-900 hover:border-fuchsia-500 hover:shadow-fuchsia-200/50",
  "border-sky-300 bg-gradient-to-br from-sky-50 to-white text-sky-900 hover:border-sky-500 hover:shadow-sky-200/50",
  "border-teal-300 bg-gradient-to-br from-teal-50 to-white text-teal-900 hover:border-teal-500 hover:shadow-teal-200/50",
  "border-amber-300 bg-gradient-to-br from-amber-50 to-white text-amber-900 hover:border-amber-500 hover:shadow-amber-200/50",
];

function useChocolateTiles(key: string): ChocolateTile[] {
  const [tiles, setTiles] = useState(() => loadChocolateTiles(key));
  useEffect(() => {
    const sync = () => setTiles(loadChocolateTiles(key));
    sync();
    window.addEventListener(CHOCOLATE_BOX_CHANGED, sync);
    return () => window.removeEventListener(CHOCOLATE_BOX_CHANGED, sync);
  }, [key]);
  return tiles;
}

function useListedSets(): ChocolateBoxSet[] {
  const [sets, setSets] = useState(() => listedChocolateBoxSets());
  useEffect(() => {
    const sync = () => setSets(listedChocolateBoxSets());
    sync();
    window.addEventListener(CHOCOLATE_BOX_CHANGED, sync);
    return () => window.removeEventListener(CHOCOLATE_BOX_CHANGED, sync);
  }, []);
  return sets;
}

interface EditorState {
  key: string;
  tile: ChocolateTile | null;
}

function MacroBoxEditor({
  state,
  onClose,
}: {
  state: EditorState | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(state?.tile?.label ?? "");
  const [text, setText] = useState(state?.tile?.text ?? "");
  useEffect(() => {
    setLabel(state?.tile?.label ?? "");
    setText(state?.tile?.text ?? "");
  }, [state]);
  if (!state) return null;
  const canSave = label.trim().length > 0 && text.trim().length > 0;
  const handleSave = () => {
    if (!canSave) return;
    upsertChocolateTile(state.key, { id: state.tile?.id, label, text });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" data-testid="chocolate-box-editor">
        <DialogHeader>
          <DialogTitle>{state.tile ? "Edit macro box" : "Add macro box"}</DialogTitle>
          <DialogDescription>
            Clicking the box inserts this text into Findings. Use [brackets] for bits to overwrite.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cb-label" className="text-[11px] uppercase tracking-wider">
              Box label
            </Label>
            <Input
              id="cb-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Meningioma"
              className="h-8 text-sm"
              autoFocus
              data-testid="chocolate-box-label"
            />
          </div>
          <div>
            <Label htmlFor="cb-text" className="text-[11px] uppercase tracking-wider">
              Inserted text
            </Label>
            <Textarea
              id="cb-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Extra-axial [dural-based] mass in the [location]…"
              className="min-h-[96px] text-sm"
              data-testid="chocolate-box-text"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {state.tile && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-rose-600 hover:bg-rose-50"
              onClick={() => {
                deleteChocolateTile(state.key, state.tile!.id);
                onClose();
              }}
              data-testid="chocolate-box-delete"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="chocolate-box-save"
          >
            {state.tile ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChocolateBoxMacros({
  setKey,
  label,
  disabled,
  onInsert,
}: {
  setKey: string;
  label: string;
  disabled?: boolean;
  onInsert: (text: string) => void;
}) {
  const tiles = useChocolateTiles(setKey);
  const [editor, setEditor] = useState<EditorState | null>(null);
  return (
    <div
      className="space-y-1.5 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/80 via-violet-50/50 to-fuchsia-50/40 p-2 shadow-sm"
      data-testid="chocolate-box"
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-800">
        {label} macros
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tiles.map((tile, i) => (
          <div key={tile.id} className="group relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={`h-7 pr-6 text-[10px] font-bold rounded-lg border shadow-sm hover:shadow-md hover:-translate-y-px transition-all ${PALETTES[i % PALETTES.length]}`}
              disabled={disabled}
              onClick={() => onInsert(tile.text)}
              data-testid={`chocolate-box-tile-${tile.id}`}
              title={tile.text}
            >
              {tile.label}
            </Button>
            <button
              type="button"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-indigo-400 opacity-70 hover:bg-white/80 hover:text-indigo-800 group-hover:opacity-100"
              title={`Edit ${tile.label}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditor({ key: setKey, tile });
              }}
              data-testid={`chocolate-box-edit-${tile.id}`}
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setEditor({ key: setKey, tile: null })}
          className="inline-flex h-7 items-center gap-1 rounded-lg border-2 border-dashed border-indigo-300/80 bg-white/60 px-2 text-[10px] font-semibold text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50"
          data-testid="chocolate-box-add"
          title="Add a blank macro box"
        >
          <Plus className="h-3 w-3" />
          <Pencil className="h-2.5 w-2.5 opacity-70" />
          <span>Add box</span>
        </button>
      </div>
      <MacroBoxEditor state={editor} onClose={() => setEditor(null)} />
    </div>
  );
}

/** Settings page — same add/edit/delete as the workspace, for every region set. */
export function ChocolateBoxSettingsPanel() {
  const sets = useListedSets();
  const [editor, setEditor] = useState<EditorState | null>(null);
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4" data-testid="chocolate-box-settings">
      <div>
        <h3 className="text-sm font-semibold">Findings macro boxes</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          These are the coloured boxes at the top of Findings (Infarct, Normal Brain, …).
          Add or edit them here or with the pencil / blank box in the reporting workspace.
          Clicking a box inserts its text. Use [brackets] for bits to overwrite while reporting.
        </p>
      </div>
      {sets.map((set) => (
        <div key={set.key} className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide">{set.label}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-[10px]"
              onClick={() => resetChocolateTiles(set.key)}
              title="Restore built-in boxes for this region"
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Reset
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {set.tiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border bg-background px-2 py-1 text-[11px] font-semibold hover:border-indigo-400"
                onClick={() => setEditor({ key: set.key, tile })}
              >
                {tile.label}
                <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setEditor({ key: set.key, tile: null })}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border-2 border-dashed px-2 py-1 text-[11px] font-semibold text-indigo-700",
                "border-indigo-300 hover:bg-indigo-50",
              )}
            >
              <Plus className="h-3 w-3" />
              <Pencil className="h-2.5 w-2.5" />
              Add box
            </button>
          </div>
        </div>
      ))}
      <MacroBoxEditor state={editor} onClose={() => setEditor(null)} />
    </div>
  );
}
