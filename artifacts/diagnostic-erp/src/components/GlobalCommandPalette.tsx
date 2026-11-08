import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { isRadiologyReportingWorkspaceRoute } from "@/lib/penDrivePairingGuard";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  ClipboardList,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Package,
  Radio,
  Receipt,
  ScanSearch,
  Search,
  Settings2,
  TestTube,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  GLOBAL_COMMANDS,
  commandSearchValue,
  globalCommandGroups,
  isCommandActionVisible,
  type GlobalCommandAction,
} from "@/lib/globalCommandCatalog";

const GROUP_ICONS: Record<string, LucideIcon> = {
  Core: Receipt,
  Billing: Receipt,
  Radiology: ScanSearch,
  Lab: TestTube,
  "Outsource Labs": FlaskConical,
  "Front Desk": ClipboardList,
  Staff: Users,
  Administration: LayoutDashboard,
  Operations: Package,
  Settings: Settings2,
  "Radiology Settings": Radio,
};

function actionIcon(action: GlobalCommandAction): LucideIcon {
  return GROUP_ICONS[action.group] ?? FileText;
}

export default function GlobalCommandPalette() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => globalCommandGroups(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        // U14: inside the Radiology Reporting Workspace, Ctrl+K belongs to the
        // workspace's own command palette (bound capture-phase in
        // useWorkspaceCommands). On mobile — and on desktop whenever the
        // workspace never raised `care:workspace-focus` — both listeners used
        // to be live and one keypress opened two stacked palettes.
        if (isRadiologyReportingWorkspaceRoute(window.location.pathname)) return;
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50"
        title="Open command palette (Ctrl/⌘ K)"
      >
        <Search size={13} />
        Search
        <span className="ml-1 rounded border px-1 py-0.5 text-[10px]">Ctrl K</span>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, settings, radiology, billing…" />
        <CommandList>
          <CommandEmpty>No matching action.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {GLOBAL_COMMANDS.filter((a) => a.group === group && isCommandActionVisible(a)).map((action) => {
                const Icon = actionIcon(action);
                return (
                  <CommandItem
                    key={action.id}
                    value={commandSearchValue(action)}
                    onSelect={() => go(action.path)}
                  >
                    <Icon size={15} />
                    <span>{action.label}</span>
                    {action.hint ? <CommandShortcut>{action.hint}</CommandShortcut> : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
