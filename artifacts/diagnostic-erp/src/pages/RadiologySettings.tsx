import { useEffect } from "react";
import { useLocation } from "wouter";
import { Info } from "lucide-react";

/**
 * LEGACY REDIRECT STUB — kept only so old bookmarks/links to
 * /radiology/settings-center (this component's current mount point, see
 * App.tsx) keep working. The real, consolidated radiology settings page is
 * now RadiologySettingsCenter.tsx, mounted at /settings/radiology.
 *
 * Task 1 consolidation (see PROTECTED_FILES.md-adjacent audit): this used to
 * be a dead-end page with its own PacsConfigPanel preview tabs; those tabs
 * are gone since every one of their sub-panels (ModalityPanel, DicomNodesPanel,
 * AgentSetupPanel, ArchiveLifecyclePanel, AI panels, Smart Platform cards,
 * RIS monitoring grid) is already rendered inside RadiologySettingsCenter,
 * so nothing here was actually unique — it's safe to redirect rather than
 * duplicate that content a second time.
 */
export default function RadiologySettings() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const t = setTimeout(() => navigate("/settings/radiology"), 400);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-6 flex items-center gap-3 max-w-xl mx-auto mt-12">
        <Info className="text-blue-600 dark:text-blue-400 shrink-0" size={20} />
        <div>
          <p className="font-semibold text-sm">This page has moved</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Redirecting to the consolidated Radiology Settings page…{" "}
            <button className="underline font-medium" onClick={() => navigate("/settings/radiology")}>
              Click here if you're not redirected automatically.
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
