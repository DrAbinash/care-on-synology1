import { useEffect, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
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
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";
import {
  CHOCOLATE_BOX_CHANGED,
  deleteChocolateTile,
  listedChocolateBoxSets,
  loadChocolateTiles,
  resetChocolateTiles,
  saveChocolateTiles,
  upsertChocolateTile,
  type ChocolateBoxSet,
  type ChocolateTile,
} from "@/lib/findingsMacros";
import { upsertChocolateTileOnServer } from "@/lib/chocolateMacrosApi";
import type { MacroSectionsOwned } from "@/lib/chocolateMacroOwnership";
import { FINDINGS_TOOL_SETTINGS } from "@/lib/reportSectionAccordion";
import { SectionSettingsLink } from "@/components/radiology/zai-workspace/section-settings-link";

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
  const [impressionText, setImpressionText] = useState(state?.tile?.impressionText ?? "");
  const [showOwnership, setShowOwnership] = useState(false);
  const [anatomicalSection, setAnatomicalSection] = useState(state?.tile?.anatomicalSection ?? "");
  const [conflictGroup, setConflictGroup] = useState(state?.tile?.conflictGroup ?? "");
  const [baselineReplaces, setBaselineReplaces] = useState(state?.tile?.baselineReplaces ?? "");
  const [supportsLaterality, setSupportsLaterality] = useState(Boolean(state?.tile?.supportsLaterality));
  const [ownFindings, setOwnFindings] = useState(
    !state?.tile?.sectionsOwned || state.tile.sectionsOwned.includes("findings"),
  );
  const [ownImpression, setOwnImpression] = useState(
    Boolean(state?.tile?.sectionsOwned?.includes("impression")),
  );
  const [legacyAppend, setLegacyAppend] = useState(
    state?.tile ? Boolean(state.tile.legacyAppend) : true,
  );
  useEffect(() => {
    setLabel(state?.tile?.label ?? "");
    setText(state?.tile?.text ?? "");
    setImpressionText(state?.tile?.impressionText ?? "");
    setAnatomicalSection(state?.tile?.anatomicalSection ?? "");
    setConflictGroup(state?.tile?.conflictGroup ?? "");
    setBaselineReplaces(state?.tile?.baselineReplaces ?? "");
    setSupportsLaterality(Boolean(state?.tile?.supportsLaterality));
    setOwnFindings(!state?.tile?.sectionsOwned || state.tile.sectionsOwned.includes("findings"));
    setOwnImpression(Boolean(state?.tile?.sectionsOwned?.includes("impression")));
    setLegacyAppend(state?.tile ? Boolean(state.tile.legacyAppend) : true);
    setShowOwnership(Boolean(
      state?.tile?.anatomicalSection || state?.tile?.conflictGroup || state?.tile?.baselineReplaces,
    ));
  }, [state]);
  if (!state) return null;
  const canSave = label.trim().length > 0 && text.trim().length > 0;
  const handleSave = () => {
    if (!canSave) return;
    const sectionsOwned: MacroSectionsOwned = [];
    if (ownFindings) sectionsOwned.push("findings");
    if (ownImpression) sectionsOwned.push("impression");
    const tile = upsertChocolateTile(state.key, {
      id: state.tile?.id,
      label,
      text,
      impressionText: impressionText.trim() || undefined,
      anatomicalSection: anatomicalSection.trim() || undefined,
      conflictGroup: conflictGroup.trim() || undefined,
      baselineReplaces: baselineReplaces.trim() || undefined,
      supportsLaterality,
      sectionsOwned: sectionsOwned.length ? sectionsOwned : ["findings"],
      legacyAppend: legacyAppend && !anatomicalSection.trim() && !conflictGroup.trim(),
    });
    void upsertChocolateTileOnServer(state.key, { ...tile, serverId: state.tile?.serverId })
      .then((synced) => {
        const tiles = loadChocolateTiles(state.key).map((t) =>
          t.id === synced.id
            ? {
              ...t,
              ...synced,
              id: t.id,
              serverId: synced.serverId,
            }
            : t,
        );
        saveChocolateTiles(state.key, tiles);
      })
      .catch(() => { /* offline — local cache remains */ });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" data-testid="chocolate-box-editor">
        <DialogHeader>
          <DialogTitle>{state.tile ? "Edit macro box" : "Add macro box"}</DialogTitle>
          <DialogDescription>
            Clicking the box inserts this text into Findings. Use [brackets] for bits to overwrite. Ownership uses the same fields as Quick Select.
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
          <button
            type="button"
            className="text-[11px] font-semibold text-indigo-700 hover:underline"
            onClick={() => setShowOwnership((v) => !v)}
          >
            {showOwnership ? "Hide ownership" : "Ownership (advanced)"}
          </button>
          {showOwnership && (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <input
                  id="cb-legacy"
                  type="checkbox"
                  checked={legacyAppend}
                  onChange={(e) => setLegacyAppend(e.target.checked)}
                />
                <Label htmlFor="cb-legacy" className="font-normal">Generic append-only (no anatomy replace)</Label>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">anatomicalSection</Label>
                <Input className="h-7 text-xs" value={anatomicalSection} onChange={(e) => { setAnatomicalSection(e.target.value); setLegacyAppend(false); }} placeholder="basal ganglia" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">conflictGroup</Label>
                <Input className="h-7 text-xs" value={conflictGroup} onChange={(e) => { setConflictGroup(e.target.value); setLegacyAppend(false); }} placeholder="hemorrhage" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">baselineReplaces</Label>
                <Input className="h-7 text-xs" value={baselineReplaces} onChange={(e) => setBaselineReplaces(e.target.value)} placeholder="Basal ganglia are normal" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Impression text (optional)</Label>
                <Textarea className="min-h-[56px] text-xs" value={impressionText} onChange={(e) => setImpressionText(e.target.value)} placeholder="Acute {side} basal ganglia hemorrhage." />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={supportsLaterality} onChange={(e) => setSupportsLaterality(e.target.checked)} />
                  supportsLaterality ({"{side}"})
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={ownFindings} onChange={(e) => setOwnFindings(e.target.checked)} />
                  Findings
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={ownImpression} onChange={(e) => setOwnImpression(e.target.checked)} />
                  Impression
                </label>
              </div>
            </div>
          )}
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
  onRemoveBundle,
}: {
  setKey: string;
  label: string;
  disabled?: boolean;
  onInsert: (tile: ChocolateTile) => void;
  onRemoveBundle?: (bundleId: string) => void;
}) {
  const tiles = useChocolateTiles(setKey);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const patches = useWorkspaceSelector((s) => s.appliedPathologyPatches);
  const activeBundleByTile = new Map<string, string>();
  for (const p of patches) {
    const bid = p.observation?.bundleId ?? "";
    const m = /^choco-(.+)-[a-z0-9]+$/i.exec(bid);
    if (m) activeBundleByTile.set(m[1]!, bid);
    else if (bid) {
      // Test / non-timestamp bundle ids: match tile.id prefix.
      const tileId = tiles.find((t) => bid === t.id || bid.startsWith(`choco-${t.id}`) || bid.startsWith(t.id))?.id;
      if (tileId && !activeBundleByTile.has(tileId)) activeBundleByTile.set(tileId, bid);
    }
  }
  return (
    <div
      className="space-y-1.5 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/80 via-violet-50/50 to-fuchsia-50/40 p-2 shadow-sm"
      data-testid="chocolate-box"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-800">
        <span>{label} macros</span>
        {FINDINGS_TOOL_SETTINGS.macros ? (
          <SectionSettingsLink
            {...FINDINGS_TOOL_SETTINGS.macros}
            testId="chocolate-macros-settings-link"
            className="normal-case tracking-normal font-medium"
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tiles.map((tile, i) => {
          const bundleId = (tile.observations?.length ?? 0) > 0 ? activeBundleByTile.get(tile.id) : undefined;
          return (
          <div key={tile.id} className="group relative" data-testid={`chocolate-bundle-chip-${tile.id}`}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={`h-7 ${bundleId ? "pr-10" : "pr-6"} text-[10px] font-bold rounded-lg border shadow-sm hover:shadow-md hover:-translate-y-px transition-all ${PALETTES[i % PALETTES.length]}`}
              disabled={disabled}
              onClick={() => onInsert(tile)}
              data-testid={`chocolate-box-tile-${tile.id}`}
              title={tile.text}
            >
              {tile.label}
            </Button>
            {bundleId && onRemoveBundle && (
              <button
                type="button"
                className="absolute right-5 top-1/2 -translate-y-1/2 rounded p-0.5 text-indigo-700 hover:bg-white/80"
                title={`Deselect ${tile.label} bundle`}
                data-testid={`chocolate-bundle-deselect-${tile.id}`}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBundle(bundleId);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
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
          );
        })}
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
