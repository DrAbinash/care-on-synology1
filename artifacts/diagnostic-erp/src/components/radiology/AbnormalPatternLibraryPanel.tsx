/**
 * Settings → Radiology → Patterns.
 * Edits bundle text with the same Dialog / Textarea / Button primitives as
 * MacroEditorDialog. Writes the existing pacs-settings key
 * `abnormal_pattern_library` (no new route).
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ABNORMAL_PATTERN_LIBRARY_KEY,
  ABNORMAL_PATTERN_SUGGESTIONS_ENABLED_KEY,
  resolveAbnormalPatternSettings,
  serializeAbnormalPatternLibrary,
  type AbnormalPattern,
} from "@/lib/reporting/abnormalPatterns";

type SettingRow = { key: string; value: string | null };

export function AbnormalPatternLibraryPanel({
  rows,
  disabled,
  onUpsert,
}: {
  rows: SettingRow[];
  disabled: boolean;
  onUpsert: (body: { key: string; value: string; category: string }) => void;
}) {
  const resolved = useMemo(() => resolveAbnormalPatternSettings(rows), [rows]);
  const [editing, setEditing] = useState<AbnormalPattern | null>(null);

  const writeLibrary = (patterns: AbnormalPattern[]) => {
    onUpsert({
      key: ABNORMAL_PATTERN_LIBRARY_KEY,
      value: serializeAbnormalPatternLibrary(patterns),
      category: "report",
    });
  };

  const toggleEnabled = (id: string, enabled: boolean) => {
    writeLibrary(resolved.patterns.map((p) => (p.id === id ? { ...p, enabled } : p)));
  };

  const saveEdit = () => {
    if (!editing) return;
    const next = resolved.patterns.map((p) => (
      p.id === editing.id
        ? {
          ...editing,
          version: p.version + 1,
          updatedAt: new Date().toISOString(),
          owner: p.owner === "builtin" ? "clinic" : p.owner,
        }
        : p
    ));
    writeLibrary(next);
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-sm font-semibold">Suggest abnormal patterns</div>
          <div className="text-xs text-muted-foreground">Suggestion only. A pattern is never applied until the radiologist confirms the merge preview.</div>
        </div>
        <Switch
          checked={resolved.suggestionsEnabled}
          disabled={disabled}
          onCheckedChange={(v) => onUpsert({
            key: ABNORMAL_PATTERN_SUGGESTIONS_ENABLED_KEY,
            value: String(v),
            category: "report",
          })}
        />
      </div>
      <div className="rounded-md border divide-y">
        {resolved.patterns.map((pattern) => (
          <div key={pattern.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-[220px] flex-1">
              <div className="text-sm font-medium">{pattern.label}</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {pattern.id} · v{pattern.version} · {pattern.owner}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[11px]">Enabled</Label>
              <Switch
                checked={pattern.enabled !== false}
                disabled={disabled}
                onCheckedChange={(v) => toggleEnabled(pattern.id, v)}
              />
            </div>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setEditing({
              ...pattern,
              bundle: pattern.bundle.map((item) => ({ ...item })),
            })}
            >
              Edit bundle
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {editing?.label}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {editing.bundle.map((item, index) => (
                <div key={`${item.concept}-${index}`} className="space-y-1 rounded border p-2">
                  <div className="text-[11px] font-mono text-muted-foreground">{item.concept} · {item.conflictGroup}</div>
                  <Label className="text-[11px]">Findings</Label>
                  <Textarea
                    value={item.findingsText}
                    className="min-h-[72px] text-sm"
                    onChange={(e) => {
                      const findingsText = e.target.value;
                      setEditing({
                        ...editing,
                        bundle: editing.bundle.map((row, i) => (i === index ? { ...row, findingsText } : row)),
                      });
                    }}
                  />
                  <Label className="text-[11px]">Impression</Label>
                  <Textarea
                    value={item.impressionText}
                    className="min-h-[56px] text-sm"
                    onChange={(e) => {
                      const impressionText = e.target.value;
                      setEditing({
                        ...editing,
                        bundle: editing.bundle.map((row, i) => (i === index ? { ...row, impressionText } : row)),
                      });
                    }}
                  />
                  <Label className="text-[11px]">Recommendation</Label>
                  <Textarea
                    value={item.recommendationText ?? ""}
                    className="min-h-[48px] text-sm"
                    onChange={(e) => {
                      const recommendationText = e.target.value;
                      setEditing({
                        ...editing,
                        bundle: editing.bundle.map((row, i) => (i === index ? { ...row, recommendationText } : row)),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="button" onClick={saveEdit} disabled={disabled}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
