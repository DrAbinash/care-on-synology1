/**
 * CARE Radiology Reporting Workspace — composition root (Phase 4).
 * Domain hooks run inside useWorkspaceClinicalUi (preserved call order).
 */
import { useWorkspaceClinicalUi } from "@/hooks/radiology-workspace/useWorkspaceClinicalUi";
import { WorkspaceShell } from "@/components/radiology/workspace/WorkspaceShell";
import { WorkspaceOverlays } from "@/components/radiology/workspace/WorkspaceOverlays";

interface Props { studyId?: number; }

export default function RadiologyReportingWorkspace({ studyId }: Props) {
  const vm = useWorkspaceClinicalUi({ studyId });
  return (
    <>
      <WorkspaceShell vm={vm} />
      <WorkspaceOverlays vm={vm} />
    </>
  );
}
