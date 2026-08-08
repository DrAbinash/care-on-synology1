import { useState } from "react";
import { useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Radio, Tv2, FileText, Settings, Activity, FilePen, ShieldAlert,
  ListChecks, Heart, Baby, CheckCircle2, ArrowRight, ChevronDown, ChevronUp,
  Layers, Server, Globe,
} from "lucide-react";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";

type ToolItem = {
  name: string;
  path: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: "Daily" | "Specialty" | "Admin" | "Legacy";
};

const DAILY: ToolItem[] = [
  {
    name: "Worklist",
    path: "/radiology/worklist",
    description: "Open studies, claim, launch viewer, start report.",
    icon: ListChecks,
    badge: "Daily",
  },
  {
    name: "Reporting Workspace",
    path: "/radiology/reporting-workspace",
    description: "Write, finalize, print — the one reporting screen.",
    icon: FileText,
    badge: "Daily",
  },
  {
    name: "Report Delivery",
    path: "/report-delivery",
    description: "Print / share finalized reports with patients.",
    icon: CheckCircle2,
    badge: "Daily",
  },
  {
    name: "Critical Findings",
    path: "/radiology/critical-findings",
    description: "Urgent findings that need clinician call-out.",
    icon: ShieldAlert,
    badge: "Daily",
  },
  {
    name: "PACS Viewer",
    path: "/pacs",
    description: "OHIF browser viewer when you need images alone.",
    icon: Tv2,
    badge: "Daily",
  },
];

const SPECIALTY: ToolItem[] = [
  {
    name: "USG Worklist",
    path: "/radiology/worklist?modality=USG",
    description: "Worklist pre-filtered to ultrasound.",
    icon: Baby,
    badge: "Specialty",
  },
  {
    name: "USG Reporting",
    path: "/radiology/reporting-workspace?modality=USG",
    description: "Same Reporting Workspace, USG templates first.",
    icon: FilePen,
    badge: "Specialty",
  },
  {
    name: "Fetal USG",
    path: "/fetal-usg",
    description: "Level-4 obstetric ultrasound forms.",
    icon: Baby,
    badge: "Specialty",
  },
  {
    name: "Echo",
    path: "/echo",
    description: "Echocardiography measurements and reports.",
    icon: Heart,
    badge: "Specialty",
  },
  {
    name: "Doppler",
    path: "/usg/doppler",
    description: "Vascular / Doppler reporting.",
    icon: Activity,
    badge: "Specialty",
  },
];

const ADMIN: ToolItem[] = [
  {
    name: "Radiology Settings Center",
    path: "/settings/radiology",
    description: "PACS, Orthanc, viewers, MWL, style, voice.",
    icon: Settings,
    badge: "Admin",
  },
  {
    name: "ERP Settings → Radiology",
    path: "/settings?tab=radiology",
    description: "Tools hub + browser device flags.",
    icon: Radio,
    badge: "Admin",
  },
  {
    name: "DICOM Agent",
    path: "/radiology/dicom-agent-dashboard",
    description: "NAS / pull-agent ingestion.",
    icon: Server,
    badge: "Admin",
  },
];

/** Greed / roadmap leftovers — kept for bookmarks, not for daily use. */
const ADVANCED: ToolItem[] = [
  { name: "Command Center (legacy)", path: "/radiology/command-center", description: "Deprecated — use Reporting Workspace.", icon: Layers, badge: "Legacy" },
  { name: "Legacy Report Generator", path: "/radiology/report-generator", description: "Deprecated layout editor.", icon: FilePen, badge: "Legacy" },
  { name: "Legacy Today Hub", path: "/radiology/legacy", description: "Old today’s studies surface.", icon: Activity, badge: "Legacy" },
  { name: "Advanced Tools catalog", path: "/radiology/advanced-tools", description: "Long list of experimental AI / PACS pages.", icon: Layers, badge: "Legacy" },
  { name: "Report Builder", path: "/radiology/report-builder", description: "Template assembly experiments.", icon: FilePen, badge: "Legacy" },
  { name: "Findings Library", path: "/radiology/findings-manager", description: "Catalog editor.", icon: FileText, badge: "Legacy" },
  { name: "Normal Templates", path: "/radiology/normal-templates", description: "Normal-snippet library.", icon: FileText, badge: "Legacy" },
  { name: "Voice Dictation page", path: "/radiology/voice-dictation", description: "Prefer Voice tab in Settings Center.", icon: Activity, badge: "Legacy" },
  { name: "Ops Dashboard", path: "/radiology/operations-dashboard", description: "Volume / TAT dashboards.", icon: ListChecks, badge: "Legacy" },
  { name: "My Analytics", path: "/radiology/my-analytics", description: "Personal reporting stats.", icon: ListChecks, badge: "Legacy" },
  { name: "Teaching Cases", path: "/teaching-cases", description: "Teaching file library.", icon: FileText, badge: "Legacy" },
  { name: "Teleradiology", path: "/teleradiology", description: "Outsourced reporting portal.", icon: Globe, badge: "Legacy" },
];

function badgeClass(badge?: ToolItem["badge"]) {
  switch (badge) {
    case "Daily": return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "Specialty": return "bg-sky-500/10 text-sky-700 border-sky-500/20";
    case "Admin": return "bg-rose-500/10 text-rose-700 border-rose-500/20";
    case "Legacy": return "bg-amber-500/10 text-amber-700 border-amber-500/20";
    default: return "";
  }
}

function ToolGrid({ items, onOpen }: { items: ToolItem[]; onOpen: (path: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.path + item.name}
            className="cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => onOpen(item.path)}
            data-testid={`radiology-hub-${item.path.replace(/\W+/g, "-")}`}
          >
            <CardHeader className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-md border bg-muted/30 shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="font-semibold text-sm truncate">{item.name}</span>
                </div>
                {item.badge && (
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${badgeClass(item.badge)}`}>{item.badge}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{item.description}</p>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

export default function Radiology() {
  const [, navigate] = useLocation();
  const isOwner = FULL_ACCESS_ROLES.has(normalizeRole(readStaffSession()?.user?.role || ""));
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Radiology"
        subtitle="Keep it simple: Worklist → Report → Deliver. Everything else is optional."
      />

      <Card className="border-emerald-500/25 bg-emerald-500/5">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <Badge className="bg-emerald-600 text-white text-[10px] uppercase tracking-wide">Daily path</Badge>
            <CardTitle className="text-lg">Worklist → Reporting Workspace</CardTitle>
            <CardDescription>
              Open a study from the worklist, report in one workspace, finalize, then deliver.
              Extra AI dashboards, legacy editors, and roadmap flags were built for ambition — use them only if you need them.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button onClick={() => navigate("/radiology/worklist")} variant="outline">
              Worklist
            </Button>
            <Button onClick={() => navigate("/radiology/reporting-workspace")} className="gap-1.5">
              Reporting Workspace <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Daily</h2>
        <ToolGrid items={DAILY} onOpen={navigate} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Specialty</h2>
        <ToolGrid items={SPECIALTY} onOpen={navigate} />
      </section>

      {isOwner && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Admin</h2>
          <ToolGrid items={ADMIN} onOpen={navigate} />
        </section>
      )}

      <section className="space-y-3 border-t pt-4">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="radiology-hub-toggle-advanced"
        >
          {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {showAdvanced ? "Hide" : "Show"} advanced / legacy pages
          <span className="text-xs font-normal">({ADVANCED.length} — not needed for routine reporting)</span>
        </button>
        {showAdvanced && (
          <div className="space-y-2">
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              These pages still exist so old bookmarks work. Prefer Worklist + Reporting Workspace + Settings Center.
            </p>
            <ToolGrid items={ADVANCED} onOpen={navigate} />
          </div>
        )}
      </section>
    </div>
  );
}
