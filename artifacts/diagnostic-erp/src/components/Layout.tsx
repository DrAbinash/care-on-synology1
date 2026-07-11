import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Activity,
  ShieldAlert,
  Usb,
  Users,
  FlaskConical,
  ClipboardList,
  CreditCard,
  BarChart3,
  Stethoscope,
  Menu,
  X,
  Moon,
  Sun,
  Activity,
  FilePen,
  Package,
  BookOpen,
  UserPlus,
  Settings2,
  KeyRound,
  Inbox,
  Tag,
  Ticket,
  Monitor,
  CalendarDays,
  Boxes,
  TrendingUp,
  TrendingDown,
  Zap,
  Fingerprint,
  Maximize2,
  Minimize2,
  FileText,
  Waypoints,
  LayoutTemplate,
  LogOut,
  AlertCircle,
  CheckCircle,
  Receipt,
  Server,
  Radio,
  Wrench,
  Globe,
  Download,
  ChevronRight,
  MessageSquare,
  ShoppingCart,
  BarChart2,
  Building2,
  IndianRupee,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  WifiOff,
  ScanSearch,
  Archive,
  Database,
  ShieldCheck,
  Terminal,
  Cpu,
  Search,
  Lock,
  Clock,
  HandCoins,
  ListChecks,
  Wallet,
  BrainCircuit,
  Landmark,
  TestTube,
  Network,
  DatabaseBackup,
  Waves,
  ActivitySquare,
  ClipboardCheck,
  Microscope,
  Mic,
  Eye,
  ScanLine,
  Workflow,
  ImagePlus,
  Scan,
  Keyboard,
  HardDrive,
  AlertTriangle,
  Send,
  Bell,
  Heart,
  Baby,
  GraduationCap,
  Gauge,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useServerFeatureFlags } from "@/hooks/useServerFeatureFlags";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useGlobalScanner } from "@/hooks/useGlobalScanner";
import { api } from "@/lib/fetchApi";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SyncPanel, SyncBadge } from "@/components/SyncPanel";
import { readStaffSession, clearStaffSession, canAccess, FULL_ACCESS_ROLES, isFeatureEnabled, normalizeRole } from "@/lib/staffSession";
import { useUserTheme, clearUserTheme } from "@/lib/userTheme";
import {
  getStoredUsbKey,
  storeUsbKey,
  clearUsbKey,
  verifyUsbKey,
  fetchUsbGateEnforced,
  onUsbKeyChange,
  readKeyFile,
  isFsAccessSupported,
  hasPairedPenDrive,
  pairPenDrive,
  unpairPenDrive,
  tryReadKeyFromPairedDir,
  ensurePairedDirPermission,
  tryReadUiFromPairedDir,
  tryReadApiFromPairedDir,
} from "@/lib/usbKey";
import { SIDEBAR_THEMES, DEFAULT_THEME, resolveTheme } from "@/lib/sidebarThemes";

type NavLeaf = { path: string; icon: typeof Zap; label: string; ownerOnly?: boolean; featureFlag?: string };
type NavGroup = { id: string; icon: typeof Zap; label: string; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const isGroup = (n: NavEntry): n is NavGroup => "children" in n;

// Sidebar layout — flat items + collapsible groups. Routes/permissions are
// unchanged; only the visual grouping is consolidated to reduce clutter.
const navItems: NavEntry[] = [
  { path: "/", icon: Zap, label: "Billing Desk" },
  { path: "/my-daily-summary", icon: BarChart2, label: "My Daily Summary" },
  {
    id: "billing-grp",
    icon: Receipt,
    label: "Billing & Payments",
    children: [
      { path: "/billing", icon: Receipt, label: "Bills" },
      { path: "/dues", icon: AlertCircle, label: "Due Payments" },
      { path: "/payments", icon: CreditCard, label: "Payments" },
      { path: "/orders", icon: ClipboardList, label: "Orders" },
    ],
  },
  {
    id: "radiology-grp",
    icon: Radio,
    label: "Radiology & Imaging",
    children: [
      { path: "/radiology/operations-dashboard", icon: Gauge,          label: "Operations Dashboard" },
      { path: "/radiology/my-analytics",         icon: BarChart3,      label: "My Analytics" },
      { path: "/radiology/worklist",            icon: ScanSearch,     label: "Worklist Hub" },
      { path: "/pacs",                        icon: Monitor,        label: "PACS Viewer" },
      { path: "/radiology/normal-templates",   icon: ClipboardCheck, label: "Normal Templates" },
      { path: "/radiology/critical-findings",   icon: AlertCircle,    label: "Critical Findings" },
      { path: "/teleradiology",               icon: Globe,          label: "Teleradiology" },
      { path: "/echo",                        icon: Heart,          label: "Echo Cardiology" },
      { path: "/fetal-usg",                   icon: Baby,           label: "Fetal USG" },
      { path: "/fetal-echo",                  icon: Baby,           label: "Fetal Echo" },
      { path: "/radiology/voice-dictation",   icon: Mic,            label: "Voice Dictation" },
      { path: "/radiology/advanced-tools",    icon: Cpu,            label: "Advanced Tools",        ownerOnly: true },
      // Hidden items kept for gradual rollout / bookmark preservation
      { path: "/radiology/ai-reporting-settings", icon: BrainCircuit, label: "AI Reporting",          ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-prompt-manager",   icon: BookOpen,       label: "AI Prompt Manager",     ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-comparison",       icon: Terminal,       label: "AI Comparison",         ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/missed-finding-detector", icon: AlertTriangle, label: "Missed Finding Detector", ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/image-review",            icon: Eye,            label: "Image Review Assistant",  ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/provider-fallback",          icon: ShieldCheck,    label: "Provider Fallback",       ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/teaching-cases",                   icon: GraduationCap,    label: "Teaching Files",          ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-extraction-review",  icon: Microscope,   label: "AI Extraction Review",  ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/pacs-settings",         icon: Settings2,    label: "PACS Settings",         ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/modality-management",   icon: Monitor,      label: "Modality Management",   ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/dicom-agent-dashboard", icon: Server,       label: "DICOM Agent",           ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/watchdog",              icon: ShieldAlert,  label: "Watchdog",              ownerOnly: true, featureFlag: "hideDeprecatedNav" },
    ],
  },
  { path: "/day-close", icon: Lock, label: "Day Close", ownerOnly: true },
  { path: "/reception-command-center", icon: Inbox, label: "Reception Command Center" },
  { path: "/patients", icon: Users, label: "Patients" },
  { path: "/appointments", icon: CalendarDays, label: "Appointments" },
  { path: "/online-bookings", icon: ShoppingCart, label: "Online Bookings" },
  { path: "/queue", icon: Ticket, label: "Queue Tokens" },
  { path: "/scan-station", icon: ScanLine, label: "Scan Station" },
  { path: "/form-f", icon: FileText, label: "Form F (PCPNDT)" },
  {
    id: "outsource-labs-grp",
    icon: Building2,
    label: "Outsource Labs",
    children: [
      { path: "/outsource/worklist", icon: ClipboardList, label: "Worklist Console" },
      { path: "/outsource/rate-cards", icon: ListChecks, label: "Rate Cards" },
      { path: "/outsource/reconciliation", icon: Landmark, label: "Reconciliation" },
      { path: "/outsource/ledger", icon: BookOpen, label: "Ledgers" },
      { path: "/outsource/dashboard", icon: TrendingUp, label: "Dashboard" },
      { path: "/outsource/settings", icon: Settings2, label: "Outsource Settings" },
    ],
  },
  {
    id: "lab-pathology-grp",
    icon: TestTube,
    label: "Lab & Pathology",
    children: [
      { path: "/samples", icon: TestTube, label: "Samples" },
      { path: "/scan-station", icon: ScanLine, label: "Scan Station" },
      { path: "/report-hub", icon: FileText, label: "Report Hub" },
      { path: "/report-delivery", icon: Send, label: "Report Delivery" },
      { path: "/report-generator", icon: FilePen, label: "Report Generator" },
    ],
  },
  {
    id: "admin-grp",
    icon: Building2,
    label: "Administration",
    children: [
      { path: "/dashboard", icon: LayoutDashboard, label: "Owner Dashboard", ownerOnly: true },
      { path: "/diagnostics", icon: Activity, label: "API Diagnostics", ownerOnly: true },
      { path: "/reports", icon: BarChart3, label: "Reports" },
      { path: "/expenses", icon: TrendingDown, label: "Expenses" },
      { path: "/staff", icon: Fingerprint, label: "Staff Directory" },
      { path: "/hr-forms", icon: FilePen, label: "HR Forms" },
      { path: "/my-day-close", icon: Clock, label: "My Day Close" },
      { path: "/accounting", icon: BookOpen, label: "Accounting" },
      { path: "/banking", icon: Landmark, label: "Banking" },
      { path: "/books-sanity", icon: ShieldCheck, label: "Books Sanity (CA)", ownerOnly: true },
      { path: "/website", icon: Globe, label: "Website Builder" },
      { path: "/whatsapp-chatbot", icon: MessageSquare, label: "WhatsApp Chatbot" },
      { path: "/machines", icon: Wrench, label: "Machines" },
    ],
  },
  {
    id: "settings-grp",
    icon: Settings2,
    label: "Settings",
    children: [
      { path: "/settings",                  icon: Settings2,      label: "General Settings" },
      { path: "/knowledge-base",            icon: BookOpen,       label: "Knowledge Base" },
      { path: "/ai-caller-credentials",     icon: KeyRound,       label: "AI Caller Credentials", ownerOnly: true },
      { path: "/settings/radiology", icon: Radio,          label: "Radiology Settings", ownerOnly: true },
      { path: "/settings/radiology-quick-select", icon: Zap, label: "Quick Select Buttons", ownerOnly: true },
      { path: "/tests",                     icon: FlaskConical,   label: "Test Catalog" },
      { path: "/outsourced-labs",           icon: Building2,      label: "Outsourced Labs" },
      { path: "/outsourced-cost-report",    icon: IndianRupee,    label: "Outsource Costs" },
      { path: "/packages",                  icon: Boxes,          label: "Packages" },
      { path: "/inventory",                 icon: Package,        label: "Inventory" },
      { path: "/discounts",                 icon: Tag,            label: "Discounts" },
      { path: "/referrals",                 icon: Stethoscope,    label: "Doctors" },
      { path: "/backup-replication",        icon: DatabaseBackup, label: "Backup & Replication", ownerOnly: true },
      { path: "/system-update",             icon: Download,       label: "System Update" },
      // Radiology admin items moved from main sidebar (hidden via feature flag)
      { path: "/radiology/network-control-center", icon: Network,        label: "Network Control Center", ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/pacs-settings",         icon: Server,         label: "PACS & DICOM",        ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/dicom-nodes",                     icon: Network,        label: "DICOM Nodes",         ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/modality-management",   icon: Monitor,        label: "Modality Management", ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/dicom-agent-dashboard", icon: Server,         label: "DICOM Agent",         ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/watchdog",              icon: ShieldAlert,    label: "Watchdog",            ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-reporting-settings", icon: BrainCircuit,   label: "AI Reporting",        ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-prompt-manager",   icon: BookOpen,       label: "AI Prompt Manager",   ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/ai-comparison",       icon: Terminal,       label: "AI Comparison",       ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/missed-finding-detector", icon: AlertTriangle, label: "Missed Finding Detector", ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/image-review",            icon: Eye,            label: "Image Review Assistant",  ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/provider-fallback",          icon: ShieldCheck,    label: "Provider Fallback",       ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/teaching-cases",                   icon: GraduationCap,    label: "Teaching Files",          ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/hl7-settings",          icon: Database,       label: "HL7 Settings",        ownerOnly: true, featureFlag: "hideDeprecatedNav" },
      { path: "/radiology/advanced-tools",        icon: Cpu,            label: "Advanced Radiol Tools", ownerOnly: true, featureFlag: "hideDeprecatedNav" },
    ],
  },
];

// Flat list of every leaf path (used for the mobile header label lookup).
const flatNavLeaves = (items: NavEntry[]): NavLeaf[] =>
  items.flatMap((n) => (isGroup(n) ? n.children : [n]));

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    document.documentElement.classList.toggle("dark");
    setDark(!dark);
  };
  return (
    <button onClick={toggle} className="p-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors" title="Toggle theme">
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function FullscreenToggle() {
  const [isFs, setIsFs] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err);
    }
  };

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      title={isFs ? "Exit full screen (F11)" : "Enter full screen (F11)"}
      aria-label={isFs ? "Exit full screen" : "Enter full screen"}
    >
      {isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  // Module B: clinic name centralization — pull from /api/clinic-settings so the
  // sidebar branding matches every other clinic-aware surface (BillDetail, Display, FormF).
  const { data: clinic } = useQuery<{ name?: string; tagline?: string; sidebarTheme?: string }>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [autoMinimise] = useState(() => localStorage.getItem("sidebarAutoMinimise") === "1");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("sidebarAutoMinimise") === "1");
  const session = readStaffSession();

  // Auto-close the mobile overlay sidebar when the viewport expands to ≥768px
  // (desktop). This prevents a stale open-state when the user rotates their
  // device or resizes a browser window while the drawer is visible.
  useEffect(() => {
    if (!isMobile && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, sidebarOpen]);

  // Pass the login-time DB value so the hook seeds localStorage on a fresh device.
  // Effective theme reads purely from localStorage (via userTheme) after seeding so
  // changes and resets take effect immediately without re-login.
  const { userTheme, setTheme: setUserTheme } = useUserTheme(session?.user.id, session?.user.sidebarTheme);
  const effectiveThemeId = userTheme ?? clinic?.sidebarTheme ?? "navy";
  const theme = resolveTheme(effectiveThemeId);

  const { updateAvailable, dismiss: dismissUpdate } = useVersionCheck();
  useServerFeatureFlags(); // hydrates ff_radiology_* flags from /api/feature-flags (Ticket T0.1)
  const isOnline = useOnlineStatus();
  const { isActive: scannerActive } = useGlobalScanner();

  // ── Study Auto-ingest Notifications ───────────────────────────────────────────────────────────────────────────────
  const [newStudyCount, setNewStudyCount] = useState(0);
  const lastCheckRef = useRef<string>(new Date(Date.now() - 5 * 60_000).toISOString());
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const poll = async () => {
      try {
        const res = await api.get<{ studies: Array<{ id: number; patientName: string; modality: string; studyDescription: string | null; numberOfImages: number }>; serverTime: string }>(
          `/api/dicom-studies/new?since=${encodeURIComponent(lastCheckRef.current)}`,
        );
        if (!mounted) return;
        if (res.studies && res.studies.length > 0) {
          setNewStudyCount((c) => c + res.studies.length);
          // Show toast for the most recent study
          const latest = res.studies[0];
          import("@/hooks/use-toast").then(({ toast }) => {
            toast({
              title: `New DICOM study: ${latest.patientName || "Unknown"}`,
              description: `${latest.modality || "OT"} — ${latest.studyDescription || "No description"} (${latest.numberOfImages} images)`,
            });
          });
        }
        lastCheckRef.current = res.serverTime || new Date().toISOString();
      } catch {
        // silently ignore polling errors
      }
    };
    void poll();
    const id = window.setInterval(() => { void poll(); }, 30_000);
    return () => { mounted = false; window.clearInterval(id); };
  }, [session]);

  // Mini sidebar theme picker state
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const themePickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!themePickerOpen) return;
    const close = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [themePickerOpen]);

  // Filter nav by permissions when a staff session exists. For groups, drop
  // children the user can't access; hide the group entirely if nothing left.
  const isOwner = FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""));
  const visibleNav: NavEntry[] = navItems.flatMap<NavEntry>((n) => {
    if (isGroup(n)) {
      const kids = n.children.filter((c) => {
        if (c.ownerOnly && !isOwner) return false;
        if (c.featureFlag && !isFeatureEnabled(c.featureFlag)) return false;
        return canAccess(session, c.path);
      });
      return kids.length ? [{ ...n, children: kids }] : [];
    }
    // Owner-only items are only visible to admin / super_admin.
    if (n.ownerOnly && !FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""))) return [];
    if (n.featureFlag && !isFeatureEnabled(n.featureFlag)) return [];
    return canAccess(session, n.path) ? [n] : [];
  });

  // Auto-expand any group containing the active route; let user toggle others.
  // The "Imaging" group is always default-open so DICOM Nodes / PACS Viewer
  // remain visible at a glance — they're easy to overlook when nested.
  const initialOpen: Record<string, boolean> = {};
  for (const n of visibleNav) {
    if (isGroup(n)) {
      const active = n.children.some((c) =>
        c.path === "/" ? location === "/" : location === c.path || location.startsWith(c.path + "/"),
      );
      initialOpen[n.id] = active;
    }
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  // Re-expand active group on navigation.
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const n of navItems) {
        if (!isGroup(n)) continue;
        const active = n.children.some((c) =>
          c.path === "/" ? location === "/" : location === c.path || location.startsWith(c.path + "/"),
        );
        if (active) next[n.id] = true;
      }
      return next;
    });
  }, [location]);

  // ── Super-admin USB pen-drive gate ──────────────────────────────────────
  // ZERO visible affordance. The Super Admin link only appears when:
  //   (a) the operator previously paired the pen-drive root via the hidden
  //       Ctrl+Shift+K combo (one-time per browser profile), AND
  //   (b) the pen drive is currently plugged in and `superadmin.key` reads
  //       successfully and matches the server secret.
  // Polled every 4s; on read failure the key is cleared and the link
  // disappears — so unplugging the drive logs the operator out instantly.
  const [usbKeyPresent, setUsbKeyPresent] = useState<boolean>(() => getStoredUsbKey() !== null);
  const [usbGateEnforced, setUsbGateEnforced] = useState<boolean>(true);
  const [pairDialog, setPairDialog] = useState<null | { busy: boolean; error: string | null; mode: "fs" | "file" }>(null);
  const usbFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetchUsbGateEnforced().then(setUsbGateEnforced);
    const off = onUsbKeyChange(() => setUsbKeyPresent(getStoredUsbKey() !== null));
    return off;
  }, []);

  // Auto-detect loop: re-read superadmin.key, load UI, and upload API plugin periodically.
  useEffect(() => {
    let stopped = false;
    let lastKey: string | null = null;
    let apiUploaded = false;

    const cleanupUI = () => {
      const script = document.getElementById("superadmin-plugin-ui-script");
      if (script) script.remove();
      if ((window as any).SuperAdminPortal) {
        delete (window as any).SuperAdminPortal;
      }
      try {
        sessionStorage.removeItem("sa_usb_key_v1");
      } catch {}
      window.dispatchEvent(new CustomEvent("superadmin-ui-unloaded"));
    };

    const loadUI = async () => {
      if ((window as any).SuperAdminPortal) return;
      try {
        const uiCode = await tryReadUiFromPairedDir();
        if (uiCode && !stopped) {
          const blob = new Blob([uiCode], { type: "text/javascript" });
          const blobUrl = URL.createObjectURL(blob);
          const script = document.createElement("script");
          script.src = blobUrl;
          script.id = "superadmin-plugin-ui-script";
          script.onload = () => {
            URL.revokeObjectURL(blobUrl);
            window.dispatchEvent(new CustomEvent("superadmin-ui-loaded"));
          };
          script.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            console.error("Failed to load Super Admin UI script from Blob");
          };
          document.body.appendChild(script);
        }
      } catch (err) {
        console.error("Error loading UI plugin:", err);
      }
    };

    const handleBackendPlugin = async (key: string) => {
      if (!apiUploaded) {
        try {
          const apiCode = await tryReadApiFromPairedDir();
          if (apiCode && !stopped) {
            const res = await fetch("/api/super-admin-setup/upload-plugin", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-sa-usb-key": key,
              },
              body: JSON.stringify({ code: apiCode }),
            });
            if (res.ok) {
              apiUploaded = true;
              console.log("Super Admin API plugin uploaded successfully");
            }
          }
        } catch (err) {
          console.error("Error uploading API plugin:", err);
        }
      }

      // Heartbeat
      try {
        await fetch("/api/super-admin-setup/heartbeat", {
          method: "POST",
          headers: { "x-sa-usb-key": key },
        });
      } catch {}
    };

    const tick = async () => {
      if (stopped) return;
      const key = await tryReadKeyFromPairedDir();
      if (stopped) return;
      if (!key) {
        if (getStoredUsbKey() !== null) clearUsbKey();
        lastKey = null;
        apiUploaded = false;
        cleanupUI();
        return;
      }
      if (key === lastKey && getStoredUsbKey() !== null) {
        await loadUI();
        await handleBackendPlugin(key);
        return;
      }
      const ok = await verifyUsbKey(key);
      if (stopped) return;
      if (ok) {
        storeUsbKey(key);
        lastKey = key;
        await loadUI();
        await handleBackendPlugin(key);
      } else {
        if (getStoredUsbKey() !== null) clearUsbKey();
        lastKey = null;
        apiUploaded = false;
        cleanupUI();
      }
    };

    void tick();
    const id = window.setInterval(() => { void tick(); }, 4000);

    // Chrome drops FS Access API permission between page loads. On the first
    // user interaction after mount (click or keydown), silently try to
    // re-grant permission for the already-paired drive, then immediately tick
    // so the Super Admin link reappears without needing Ctrl+Shift+K again.
    let permissionGrantAttempted = false;
    const tryRegrant = () => {
      if (permissionGrantAttempted || stopped) return;
      permissionGrantAttempted = true;
      void ensurePairedDirPermission().then((granted) => {
        if (granted && !stopped) void tick();
      });
    };
    const tryRegrantClick = () => { tryRegrant(); };
    const tryRegrantKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyK") return;
      tryRegrant();
    };
    window.addEventListener("click", tryRegrantClick, { once: true, capture: true });
    window.addEventListener("keydown", tryRegrantKey, { capture: true });

    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener("click", tryRegrantClick, { capture: true });
      window.removeEventListener("keydown", tryRegrantKey, { capture: true });
    };
  }, []);

  // Hidden pairing trigger: Ctrl+Shift+K opens the one-time setup modal.
  // Operators who don't know the combo can't see anything related to USB.
  // Ctrl+Alt+U was the old combo but Chrome intercepts Ctrl+U (View Source)
  // at the browser level before JS can prevent it. Ctrl+Shift+K is safe on
  // all platforms (Chrome, Windows, Linux).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        setPairDialog({ busy: false, error: null, mode: isFsAccessSupported() ? "fs" : "file" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPairFs = async () => {
    setPairDialog((p) => p ? { ...p, busy: true, error: null } : p);
    try {
      const alreadyPaired = await hasPairedPenDrive();
      if (alreadyPaired) {
        const ok = await ensurePairedDirPermission();
        if (!ok) {
          setPairDialog((p) => p ? { ...p, busy: false, error: "Permission denied. Try Re-pair." } : p);
          return;
        }
      } else {
        await pairPenDrive();
      }
      const key = await tryReadKeyFromPairedDir();
      if (!key) { setPairDialog((p) => p ? { ...p, busy: false, error: "superadmin.key not found on the chosen folder." } : p); return; }
      const ok = await verifyUsbKey(key);
      if (!ok) { setPairDialog((p) => p ? { ...p, busy: false, error: "Key file does not match the server secret." } : p); return; }
      storeUsbKey(key);
      setPairDialog(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pairing failed.";
      setPairDialog((p) => p ? { ...p, busy: false, error: msg } : p);
    }
  };

  const onUnpair = async () => {
    setPairDialog((p) => p ? { ...p, busy: true, error: null } : p);
    await unpairPenDrive();
    setPairDialog((p) => p ? { ...p, busy: false, error: "Pen drive unpaired. Pair again to continue." } : p);
  };

  const onUsbFileChosen = async (file: File) => {
    setPairDialog((p) => p ? { ...p, busy: true, error: null } : p);
    try {
      const key = await readKeyFile(file);
      if (!key) { setPairDialog((p) => p ? { ...p, busy: false, error: "Empty key file." } : p); return; }
      const ok = await verifyUsbKey(key);
      if (!ok) { setPairDialog((p) => p ? { ...p, busy: false, error: "Invalid USB key." } : p); return; }
      storeUsbKey(key);
      setPairDialog(null);
    } finally {
      if (usbFileRef.current) usbFileRef.current.value = "";
    }
  };

  const openSuperAdmin = (hash: string = "") => {
    navigate(`/super-admin-portal${hash ? `#${hash}` : ""}`);
  };

  // Super-admin modules surfaced inline in the ERP sidebar when the USB
  // pen drive is verified (or when the gate is not enforced in dev).
  // Each entry deep-links into the matching tab in /super-admin-portal/.
  const superAdminModules: { hash: string; icon: typeof Zap; label: string }[] = [
    { hash: "books",              icon: BookOpen,    label: "Books Manager" },
    { hash: "commission-report",  icon: ListChecks,  label: "Commission Report" },
    { hash: "commission-rules",   icon: HandCoins,   label: "Commission Rules" },
    { hash: "doctor-ledger",      icon: Wallet,      label: "Doctor Ledger" },
    { hash: "money-trail-audit",  icon: ShieldCheck, label: "Money Trail Audit" },
  ];

  const onLogout = async () => {
    // Best-effort: tell the server to invalidate the portal session, and clear
    // BOTH the legacy portal-staff key and the new ERP session key.
    try {
      const token = session?.token;
      if (token) {
        await fetch("/api/portal/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => { /* network errors ignored — local cleanup still proceeds */ });
      }
    } catch { /* ignore */ }
    try { window.localStorage.removeItem("portal_staff_session"); } catch { /* ignore */ }
    clearStaffSession();
    // Land back on the public portal landing page.
    const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL || "/";
    window.location.href = `${base}portal`.replace(/\/+/g, "/").replace(":/", "://");
  };

  const initials = session?.user.name
    ? session.user.name.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join("").toUpperCase()
    : "";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop sidebar — hidden on mobile via conditional render so there's
          no Tailwind display-utility conflict between "flex" and "hidden" */}
      {!isMobile && (
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border transition-all duration-200 relative overflow-hidden",
          sidebarCollapsed ? "w-14" : "w-52",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ background: theme.gradient }}
      >
        {/* Soft top glow orb */}
        <div className="absolute top-0 left-0 w-full h-48 pointer-events-none z-0"
          style={{ background: theme.glow }} />
        {/* Subtle bottom color hint */}
        <div className="absolute bottom-0 left-0 w-full h-32 pointer-events-none z-0"
          style={{ background: theme.bottomHint }} />

        {/* Logo */}
        <div className={cn("flex items-center border-b border-sidebar-border relative z-10", sidebarCollapsed ? "justify-center px-0 py-4 flex-col gap-2" : "gap-3 px-5 py-5")} style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 4px 14px rgba(59,130,246,0.4)" }}>
            <Activity size={20} className="text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-sidebar-foreground leading-tight tracking-tight truncate">{clinic?.name || "Care Diagnostics"}</div>
              <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60 font-medium">{clinic?.tagline || "Billing ERP"}</div>
            </div>
          )}
          {/* Collapse toggle — desktop only */}
          <button
            className={cn("hidden lg:flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10 transition-colors rounded-md p-1", sidebarCollapsed ? "" : "ml-auto")}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((c) => !c)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          <button className={cn("lg:hidden text-sidebar-foreground", sidebarCollapsed ? "" : "ml-auto")} onClick={() => setSidebarOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* Open Radiology Cockpit (federated service) — external link with SSO */}
        {(() => {
          const session = readStaffSession();
          const radUrl = (process.env.NEXT_PUBLIC_RADIOLOGY_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:3002` : "")) + (session?.token ? `/?sso=${encodeURIComponent(session.token)}` : "");
          return radUrl ? (
            <a
              href={radUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the standalone Radiology Cockpit (MRI/CT reporting)"
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-all cursor-pointer bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30",
                sidebarCollapsed ? "justify-center px-0 py-2.5 mx-1" : "gap-2 px-3 py-2.5 mx-2",
              )}
            >
              <BrainCircuit size={16} />
              {!sidebarCollapsed && <span>Radiology Cockpit</span>}
            </a>
          ) : null;
        })()}

        {/* Nav */}
        <nav className={cn("flex-1 py-4 space-y-0.5 overflow-y-auto relative z-10", sidebarCollapsed ? "px-1" : "px-3")}>
          {visibleNav.map((entry) => {
            if (!isGroup(entry)) {
              const { path, icon: Icon, label } = entry;
              const isActive = path === "/" ? location === "/" : location === path || location.startsWith(path + "/");
              return (
                <Link
                  key={path}
                  href={path}
                  title={sidebarCollapsed ? label : undefined}
                  onClick={() => { setSidebarOpen(false); if (autoMinimise) setSidebarCollapsed(true); }}
                  className={cn(
                    "flex items-center rounded-lg text-sm font-medium transition-all cursor-pointer",
                    sidebarCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                    isActive
                      ? "text-white font-semibold"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10",
                  )}
                  style={isActive ? { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" } : { border: "1px solid transparent" }}
                >
                  <Icon size={15} />
                  {!sidebarCollapsed && label}
                  {!sidebarCollapsed && isActive && <div className="ml-auto w-1.5 h-4 rounded-full" style={{ background: theme.accent, boxShadow: `0 0 6px ${theme.accent}b0` }} />}
                </Link>
              );
            }

            const { id, icon: GroupIcon, label, children } = entry;
            const groupActive = children.some((c) =>
              c.path === "/" ? location === "/" : location === c.path || location.startsWith(c.path + "/"),
            );
            const open = openGroups[id] ?? groupActive;

            if (sidebarCollapsed) {
              // Collapsed: show each child as an icon-only link (no group header)
              return (
                <div key={id} className="space-y-0.5">
                  {children.map(({ path, icon: ChildIcon, label: childLabel }) => {
                    const isActive = path === "/" ? location === "/" : location === path || location.startsWith(path + "/");
                    return (
                      <Link
                        key={path}
                        href={path}
                        title={childLabel}
                        onClick={() => { setSidebarOpen(false); if (autoMinimise) setSidebarCollapsed(true); }}
                        className={cn(
                          "flex items-center justify-center px-0 py-2 rounded-md transition-all cursor-pointer",
                          isActive ? "text-white font-semibold" : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-white/10",
                        )}
                        style={isActive ? { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" } : { border: "1px solid transparent" }}
                      >
                        <ChildIcon size={13} />
                      </Link>
                    );
                  })}
                </div>
              );
            }

            return (
              <div key={id}>
                <button
                  type="button"
                  onClick={() => {
                    // Navigate to the first child by default (Bills for billing group)
                    const defaultPath = children[0]?.path;
                    if (defaultPath) {
                      navigate(defaultPath);
                    } else {
                      setOpenGroups((prev) => ({ ...prev, [id]: !open }));
                    }
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                    groupActive
                      ? "text-white"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10",
                  )}
                  style={groupActive ? { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" } : { border: "1px solid transparent" }}
                  aria-expanded={open}
                >
                  <GroupIcon size={15} />
                  <span className="flex-1 text-left">{label}</span>
                  {id === "radiology-grp" && newStudyCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                      {newStudyCount}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={cn("transition-transform duration-150", open && "rotate-90")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroups((prev) => ({ ...prev, [id]: !open }));
                    }}
                  />
                </button>
                {open && (
                  <div className="mt-0.5 ml-4 pl-2 border-l space-y-0.5" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                    {children.map(({ path, icon: ChildIcon, label: childLabel }) => {
                      const isActive = path === "/" ? location === "/" : location === path || location.startsWith(path + "/");
                      return (
                        <Link
                          key={path}
                          href={path}
                          onClick={() => { setSidebarOpen(false); if (autoMinimise) setSidebarCollapsed(true); }}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all cursor-pointer",
                            isActive
                              ? "text-white font-semibold"
                              : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-white/10",
                          )}
                          style={isActive ? { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" } : { border: "1px solid transparent" }}
                        >
                          <ChildIcon size={13} />
                          {childLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Super-admin modules — surfaced inline when:
            - Gate NOT enforced (dev / unconfigured): always visible.
            - Gate enforced (prod): only when the paired pen drive is plugged
              in and superadmin.key validates against the server secret.
            Each entry opens /super-admin-portal/#<view> in a new tab so the
            portal jumps straight into the chosen module after PIN login. */}
        {usbKeyPresent && (
          <div className="px-3 py-2 border-t border-sidebar-border relative z-10" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between px-2.5 pb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                <ShieldAlert size={11} />
                Super Admin
              </span>
              <span className="inline-flex items-center gap-1 text-[9px] text-amber-300/70">
                <Usb size={9} /> KEY
              </span>
            </div>
            <div className="space-y-1">
              {superAdminModules.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.hash}
                    onClick={() => openSuperAdmin(m.hash)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-amber-500/10 border border-amber-500/25 text-amber-100 hover:bg-amber-500/25 transition-colors text-left"
                    title={`Open ${m.label} in a new tab`}
                  >
                    <Icon size={12} className="shrink-0 text-amber-300/90" />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Signed-in user profile block — theme picker lives here when logged in */}
        {session && (
          <div className={cn("py-3 border-t relative z-10", sidebarCollapsed ? "px-1" : "px-3")} ref={themePickerRef} style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <div className={cn("flex items-center rounded-lg", sidebarCollapsed ? "flex-col gap-1 px-0 py-1" : "gap-2.5 px-2 py-2")} style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 10px rgba(59,130,246,0.35)" }}>
                {initials}
              </div>
              {!sidebarCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-sidebar-foreground truncate">{session.user.name}</p>
                  <p className="text-[10px] text-sidebar-foreground/60 capitalize truncate">{session.user.role.replace("_", " ")}</p>
                </div>
              )}
              {/* Per-user theme swatch — visible to all staff; click to open picker */}
              <button
                onClick={() => setThemePickerOpen((o) => !o)}
                className="w-5 h-5 rounded-full shrink-0 ring-2 ring-white/30 hover:ring-white/70 transition-all cursor-pointer"
                style={{ background: theme.gradient }}
                title="My sidebar color — click to change"
                aria-label="Pick my sidebar theme"
              />
              <button
                onClick={onLogout}
                title="Sign out"
                className="p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0"
              >
                <LogOut size={14} />
              </button>
            </div>
            {/* Theme picker popup — positioned above the profile block */}
            {themePickerOpen && (
              <div
                className="absolute bottom-full left-3 right-3 mb-2 z-50 rounded-xl border border-white/20 p-3 shadow-2xl"
                style={{ background: "rgba(15,20,40,0.96)", backdropFilter: "blur(10px)" }}
              >
                <p className="text-[11px] font-semibold text-sidebar-foreground/60 uppercase tracking-wider mb-2 px-1">My Sidebar Color</p>
                <div className="grid grid-cols-3 gap-2">
                  {SIDEBAR_THEMES.map((preset) => {
                    const active = effectiveThemeId === preset.id;
                    const isPersonal = userTheme === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.label}
                        onClick={() => { setUserTheme(preset.id); setThemePickerOpen(false); }}
                        className="relative rounded-lg overflow-hidden focus:outline-none"
                        style={{ border: active ? "2px solid rgba(255,255,255,0.8)" : "2px solid rgba(255,255,255,0.15)", transition: "border-color 0.15s" }}
                      >
                        <div className="h-10 w-full" style={{ background: preset.gradient }} />
                        <div className="py-1 px-1 text-center" style={{ background: "rgba(0,0,0,0.4)" }}>
                          <span className="text-[9px] font-medium text-white/80 truncate block leading-tight">{preset.label}</span>
                          {isPersonal && <span className="text-[8px] text-blue-300 leading-tight block">mine</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {userTheme && (
                  <button
                    type="button"
                    onClick={() => { clearUserTheme(session.user.id); setThemePickerOpen(false); }}
                    className="mt-2 w-full text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors text-center"
                  >
                    Reset to clinic default
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sync panel — only visible when sidebar is expanded and staff is logged in */}
        {session && !sidebarCollapsed && (
          <div className="px-4 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <SyncPanel />
          </div>
        )}

        {/* Footer — compact, just sync panel + palette when logged out */}
        <div className={cn("py-2 border-t flex items-center relative z-10", sidebarCollapsed ? "px-1 justify-center" : "px-3 justify-between")} style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {!sidebarCollapsed && (
            <span className="text-[10px] text-sidebar-foreground/30">Care Diagnostics</span>
          )}
          <div className="flex items-center gap-1">
            {!session && (
              <div className="relative" ref={themePickerRef}>
                <button
                  onClick={() => setThemePickerOpen((o) => !o)}
                  className="p-1.5 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                  title="My sidebar theme"
                  aria-label="Pick my sidebar theme"
                >
                  <Palette size={14} />
                </button>
                {themePickerOpen && (
                  <div
                    className="absolute bottom-full mb-2 right-0 z-50 rounded-xl border border-white/20 p-3 shadow-2xl"
                    style={{ background: "rgba(15,20,40,0.96)", backdropFilter: "blur(10px)", minWidth: 220 }}
                  >
                    <p className="text-[11px] font-semibold text-sidebar-foreground/60 uppercase tracking-wider mb-2 px-1">Sidebar Color</p>
                    <div className="grid grid-cols-3 gap-2">
                      {SIDEBAR_THEMES.map((preset) => {
                        const active = effectiveThemeId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            title={preset.label}
                            onClick={() => { setThemePickerOpen(false); }}
                            className="relative rounded-lg overflow-hidden focus:outline-none"
                            style={{ border: active ? "2px solid rgba(255,255,255,0.8)" : "2px solid rgba(255,255,255,0.15)", transition: "border-color 0.15s" }}
                          >
                            <div className="h-10 w-full" style={{ background: preset.gradient }} />
                            <div className="py-1 px-1 text-center" style={{ background: "rgba(0,0,0,0.4)" }}>
                              <span className="text-[9px] font-medium text-white/80 truncate block leading-tight">{preset.label}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
      )}

      {isMobile && (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border transition-transform duration-200 overflow-hidden w-52",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
          style={{ background: theme.gradient }}
        >
          <div className="absolute top-0 left-0 w-full h-48 pointer-events-none z-0" style={{ background: theme.glow }} />
          <div className="absolute bottom-0 left-0 w-full h-32 pointer-events-none z-0" style={{ background: theme.bottomHint }} />
          <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border relative z-10" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 4px 14px rgba(59,130,246,0.4)" }}>
              <Activity size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-sidebar-foreground leading-tight tracking-tight truncate">{clinic?.name || "Care Diagnostics"}</div>
              <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60 font-medium">{clinic?.tagline || "Billing ERP"}</div>
            </div>
            <button className="text-sidebar-foreground ml-auto" onClick={() => setSidebarOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto relative z-10 px-3">
            {visibleNav.map((entry) => {
              if (!isGroup(entry)) {
                const { path, icon: Icon, label } = entry;
                const isActive = path === "/" ? location === "/" : location === path || location.startsWith(path + "/");
                return (
                  <Link
                    key={path}
                    href={path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                      isActive ? "text-white font-semibold" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10"
                    )}
                    style={isActive ? { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" } : { border: "1px solid transparent" }}
                  >
                    <Icon size={15} />
                    {label}
                  </Link>
                );
              }

              const { id, icon: GroupIcon, label, children } = entry;
              const groupActive = children.some((c) =>
                c.path === "/" ? location === "/" : location === c.path || location.startsWith(c.path + "/"),
              );
              const open = openGroups[id] ?? groupActive;

              return (
                <div key={id}>
                  <button
                    type="button"
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [id]: !open }))}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                      groupActive ? "text-white" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10",
                    )}
                    style={groupActive ? { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" } : { border: "1px solid transparent" }}
                    aria-expanded={open}
                  >
                    <GroupIcon size={15} />
                    <span className="flex-1 text-left">{label}</span>
                    <ChevronRight size={13} className={cn("transition-transform duration-150", open && "rotate-90")} />
                  </button>
                  {open && (
                    <div className="mt-0.5 ml-4 pl-2 border-l space-y-0.5" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                      {children.map(({ path, icon: ChildIcon, label: childLabel }) => {
                        const isActive = path === "/" ? location === "/" : location === path || location.startsWith(path + "/");
                        return (
                          <Link
                            key={path}
                            href={path}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all cursor-pointer",
                              isActive ? "text-white font-semibold" : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-white/10",
                            )}
                            style={isActive ? { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" } : { border: "1px solid transparent" }}
                          >
                            <ChildIcon size={13} />
                            {childLabel}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* ── Mobile top bar ─────────────────────────────────────────────────
            Hamburger (☰) opens the slide-in sidebar. Title shows current
            module. Right side: fullscreen + dark-mode toggles. */}
        {isMobile && (
          <header
            className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
            style={{ minHeight: 52 }}
          >
            {/* ☰ Hamburger — opens the mobile slide-in sidebar */}
            <button
              id="mobile-sidebar-toggle"
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0 text-foreground hover:bg-accent transition-colors"
            >
              <Menu size={22} />
            </button>

            {/* Current module label */}
            <span className="flex-1 font-semibold text-sm truncate">
              {flatNavLeaves(visibleNav).find(
                (n) =>
                  n.path === "/"
                    ? location === "/"
                    : location === n.path || location.startsWith(n.path + "/"),
              )?.label ?? "Care Diagnostics"}
            </span>

            {/* Right controls */}
            <div className="flex items-center gap-0.5 shrink-0">
              <FullscreenToggle />
              <ThemeToggle />
            </div>
          </header>
        )}

        {/* Desktop top-right control bar — thin strip, compact icons */}
        {!isMobile && (
          <div className="flex items-center justify-end gap-1 px-3 py-0.5 border-b border-border/40 bg-card/50">
            <FullscreenToggle />
            <ThemeToggle />
          </div>
        )}

        {/* Offline indicator — shown when the browser loses network connectivity.
            Data is still visible from the service-worker cache; writes are blocked. */}
        {!isOnline && (
          <div className="flex items-center gap-2 bg-slate-800 dark:bg-slate-900 border-b border-slate-600 px-4 py-2 text-sm text-slate-100">
            <WifiOff size={14} className="shrink-0 text-slate-300" />
            <span className="font-medium">You are offline.</span>
            <span className="text-slate-300 text-xs hidden sm:inline">
              Cached data is shown — changes will not save until the connection is restored.
            </span>
          </div>
        )}

        {/* New-version notification bar — shown when a deployment has been pushed
            since the user opened this tab. Soft prompt, never auto-reloads. */}
        {updateAvailable && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm">
            <span className="text-amber-800 dark:text-amber-200 font-medium">
              A new version of the ERP is available.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1 transition-colors"
              >
                Reload now
              </button>
              <button
                onClick={dismissUpdate}
                className="rounded-md border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-xs px-3 py-1 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Hidden pen-drive pairing dialog (Ctrl+Shift+K). Not announced anywhere
          in the UI. Re-pair flow lives here too. */}
      {pairDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !pairDialog.busy && setPairDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert size={18} className="text-amber-500" />
              <h2 className="text-sm font-semibold">Pair super-admin pen drive</h2>
            </div>
            {pairDialog.mode === "fs" ? (
              <>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  Plug in the pen drive, then pick its root folder. The folder
                  is remembered on this PC only — the Super Admin link will
                  appear automatically while the drive is plugged in, and
                  disappear when you remove it.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={onPairFs} disabled={pairDialog.busy} className="flex-1">
                    {pairDialog.busy ? "Working…" : "Pick pen-drive folder"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={onUnpair} disabled={pairDialog.busy}>
                    Re-pair
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  This browser doesn't support auto-detect. Pick
                  <code className="mx-1 px-1 rounded bg-muted">superadmin.key</code>
                  from the pen drive each session.
                </p>
                <input
                  ref={usbFileRef}
                  type="file"
                  accept=".key,text/plain,application/octet-stream"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUsbFileChosen(f);
                  }}
                />
                <Button size="sm" onClick={() => usbFileRef.current?.click()} disabled={pairDialog.busy} className="w-full">
                  {pairDialog.busy ? "Verifying…" : "Choose superadmin.key"}
                </Button>
              </>
            )}
            {pairDialog.error && (
              <p className="text-[11px] text-destructive mt-3">{pairDialog.error}</p>
            )}
            <button
              onClick={() => !pairDialog.busy && setPairDialog(null)}
              className="mt-4 w-full text-[11px] text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
