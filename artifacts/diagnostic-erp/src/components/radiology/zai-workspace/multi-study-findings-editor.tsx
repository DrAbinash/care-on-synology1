import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  findingsSectionBlocks,
  replaceFindingsSectionBody,
  type FindingsStudySection,
} from "@/lib/multiStudyReport";

/**
 * Two findings blocks for a combined report. Each block writes back through
 * setField so there is still one findings document and one zustand ingress.
 */
export function MultiStudyFindingsEditors({
  disabled,
}: {
  disabled?: boolean;
}) {
  const findingsText = useWorkspace((s) => s.findingsText);
  const primary = useWorkspace((s) => s.primaryFindingsSection);
  const linked = useWorkspace((s) => s.linkedStudy);
  const activeId = useWorkspace((s) => s.activeFindingsSectionId);

  if (!primary || !linked) return null;
  const sections: FindingsStudySection[] = [primary, linked];
  const blocks = findingsSectionBlocks(findingsText, sections);

  return (
    <div className="flex flex-col gap-3" data-testid="multi-study-findings">
      {blocks.map((block) => {
        const active = activeId === block.studyId;
        return (
          <section
            key={block.studyId}
            data-testid="findings-subsection"
            data-section-title={block.title}
            data-active={active ? "true" : "false"}
            className={`rounded-md border p-2 ${active ? "border-emerald-500 ring-1 ring-emerald-400" : "border-border"}`}
            onPointerDown={() => useWorkspace.getState().setActiveFindingsSection(block.studyId)}
          >
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
              {block.title}
            </div>
            <textarea
              value={block.body}
              disabled={disabled}
              data-editor="findings"
              data-testid={`findings-subsection-body-${block.studyId}`}
              placeholder={`Findings for ${block.title}`}
              className="min-h-[18vh] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm"
              onFocus={() => useWorkspace.getState().setActiveFindingsSection(block.studyId)}
              onChange={(e) => {
                const state = useWorkspace.getState();
                const primaryNow = state.primaryFindingsSection;
                const linkedNow = state.linkedStudy;
                if (!primaryNow || !linkedNow) return;
                const next = replaceFindingsSectionBody(
                  state.findingsText,
                  [primaryNow, linkedNow],
                  block.studyId,
                  e.target.value,
                );
                state.setActiveFindingsSection(block.studyId);
                state.setField("findings", next);
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
