import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
  BarChart2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  ScanSearch,
  Search,
  Settings2,
  TestTube,
  Users,
} from "lucide-react";

const actions = [
  { label: "Billing Desk", path: "/", group: "Core", icon: Receipt, hint: "Bill" },
  { label: "Patients", path: "/patients", group: "Core", icon: Users, hint: "Patient list" },
  { label: "Orders", path: "/orders", group: "Core", icon: ClipboardList, hint: "Orders" },
  { label: "Reports", path: "/reports", group: "Core", icon: FileText, hint: "Reports" },
  { label: "Samples", path: "/samples", group: "Lab", icon: TestTube, hint: "Lab" },
  { label: "Radiology Worklist", path: "/radiology/worklist", group: "Radiology", icon: ScanSearch, hint: "Worklist" },
  { label: "Reporting Workspace", path: "/radiology/reporting-workspace", group: "Radiology", icon: FileText, hint: "Report" },
  { label: "Inventory", path: "/inventory", group: "Operations", icon: Package, hint: "Stock" },
  { label: "My Daily Summary", path: "/my-daily-summary", group: "Analytics", icon: BarChart2, hint: "Today" },
  { label: "Owner Dashboard", path: "/dashboard", group: "Analytics", icon: LayoutDashboard, hint: "Admin" },
  { label: "Settings", path: "/settings", group: "Admin", icon: Settings2, hint: "Config" },
];

export default function GlobalCommandPalette() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => Array.from(new Set(actions.map((a) => a.group))), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
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
        <CommandInput placeholder="Search pages, modules, and workflows…" />
        <CommandList>
          <CommandEmpty>No matching action.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {actions.filter((a) => a.group === group).map((action) => {
                const Icon = action.icon;
                return (
                  <CommandItem key={action.path} value={`${action.label} ${action.hint}`} onSelect={() => go(action.path)}>
                    <Icon size={15} />
                    <span>{action.label}</span>
                    <CommandShortcut>{action.hint}</CommandShortcut>
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
