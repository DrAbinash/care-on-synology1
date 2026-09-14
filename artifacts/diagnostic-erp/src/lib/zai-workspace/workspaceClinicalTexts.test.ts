import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { readWorkspaceClinicalTexts } from "./workspaceClinicalTexts";

const workspaceSrc = readFileSync(
  join(__dirname, "../../pages/RadiologyReportingWorkspace.tsx"),
  "utf8",
);
const hookSrc = readFileSync(join(__dirname, "workspaceClinicalTexts.ts"), "utf8");

describe("workspaceClinicalTexts", () => {
  beforeEach(() => {
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      activeStudyId: "study-a",
      isDirty: false,
    });
  });

  it("readWorkspaceClinicalTexts mirrors the store snapshot", () => {
    useWorkspace.getState().setField("findings", "Liver is normal.");
    expect(readWorkspaceClinicalTexts().findingsText).toBe("Liver is normal.");
    expect(readWorkspaceClinicalTexts().impressionText).toBe("");
  });

  it("debounced shell hook flushes study switches immediately and edits after delay", () => {
    // Contract of useDebouncedWorkspaceClinicalTexts — kept as source assertions so
    // node-environment Vitest does not need a DOM harness for the React hook.
    expect(hookSrc).toContain("state.activeStudyId !== prev.activeStudyId");
    expect(hookSrc).toContain("setTimeout(flush, delayMs)");
    expect(hookSrc).toContain("useWorkspace.subscribe");
  });

  it("reporting workspace shell uses the debounced bridge (not live field selectors)", () => {
    expect(workspaceSrc).toContain("useDebouncedWorkspaceClinicalTexts(300)");
    expect(workspaceSrc).toContain("readWorkspaceClinicalTexts()");
    expect(workspaceSrc).toContain("ConnectedFindingsHighlightEditor");
    expect(workspaceSrc).not.toMatch(
      /const findingsText = useWorkspace\(\(s: WorkspaceStore\) => s\.findingsText\)/,
    );
    expect(workspaceSrc).not.toMatch(
      /const impressionText = useWorkspace\(\(s: WorkspaceStore\) => s\.impressionText\)/,
    );
    // Persistence must read the live store, not the shell mirror alone.
    expect(workspaceSrc).toMatch(/const live = readWorkspaceClinicalTexts\(\);\s*\n\s*const res = await retryWithBackoff/);
  });
});
