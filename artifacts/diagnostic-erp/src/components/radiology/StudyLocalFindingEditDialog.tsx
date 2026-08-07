/**
 * Study-local edit of a Quick Select finding before insert.
 * Changes apply only to the current report — never PATCH the global catalog.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { QuickFinding } from "./QuickFindingsPanel";
import { renderAbnormality, EMPTY_INSTANCE } from "@/lib/abnormalityEngine";

export type StudyLocalTextOverride = {
  finding: string;
  impression: string;
  technique: string;
  recommendation: string;
};

interface Props {
  finding: QuickFinding;
  initial?: StudyLocalTextOverride | null;
  onApply: (override: StudyLocalTextOverride) => void;
  onCancel: () => void;
}

export function defaultTextOverride(finding: QuickFinding): StudyLocalTextOverride {
  const rendered = renderAbnormality(finding, EMPTY_INSTANCE);
  return {
    finding: rendered.finding || finding.findingText || "",
    impression: rendered.impression || finding.impressionText || "",
    technique: rendered.technique || finding.techniqueText || "",
    recommendation: rendered.recommendation || finding.recommendationText || "",
  };
}

export default function StudyLocalFindingEditDialog({ finding, initial, onApply, onCancel }: Props) {
  const seed = initial ?? defaultTextOverride(finding);
  const [findingText, setFindingText] = useState(seed.finding);
  const [impressionText, setImpressionText] = useState(seed.impression);
  const [techniqueText, setTechniqueText] = useState(seed.technique);
  const [recommendationText, setRecommendationText] = useState(seed.recommendation);
  const firstRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    firstRef.current?.select();
  }, []);

  function submit() {
    onApply({
      finding: findingText.trim(),
      impression: impressionText.trim(),
      technique: techniqueText.trim(),
      recommendation: recommendationText.trim(),
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="study-local-finding-edit"
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{finding.label}</h3>
          <p className="text-[10px] text-muted-foreground">
            Edit for this study only — catalog button is unchanged. Ctrl+Enter to insert.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Findings text</Label>
          <Textarea
            ref={firstRef}
            value={findingText}
            onChange={(e) => setFindingText(e.target.value)}
            className="text-sm min-h-[72px]"
            data-testid="study-local-finding-text"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Impression text</Label>
          <Textarea
            value={impressionText}
            onChange={(e) => setImpressionText(e.target.value)}
            className="text-sm min-h-[52px]"
            data-testid="study-local-impression-text"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Technique (optional)</Label>
            <Textarea value={techniqueText} onChange={(e) => setTechniqueText(e.target.value)} className="text-sm min-h-[40px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Recommendation (optional)</Label>
            <Textarea value={recommendationText} onChange={(e) => setRecommendationText(e.target.value)} className="text-sm min-h-[40px]" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" className="h-7 text-xs" onClick={submit} data-testid="study-local-apply">
            Insert edited text
          </Button>
        </div>
      </div>
    </div>
  );
}
