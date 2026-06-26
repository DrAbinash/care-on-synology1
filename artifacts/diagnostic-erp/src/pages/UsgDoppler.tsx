import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import {
  Stethoscope,
  ScanSearch,
  FileText,
  Image,
  Activity,
  Settings2,
  ChevronRight,
  Waves,
  AlertCircle,
  CheckCircle2,
  Clock,
  BarChart2,
  Baby,
} from "lucide-react";

interface UsgStats {
  pendingWorklist: number;
  pendingMeasurements: number;
  approvedMeasurements: number;
  draftReports: number;
  finalizedReports: number;
  keyImages: number;
  pendingDoppler: number;
}

interface ModuleCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  path: string;
  gradient: string;
  iconBg: string;
  badgeKey?: keyof UsgStats;
  badgeLabel?: string;
  badgeVariant?: "default" | "destructive" | "secondary" | "outline";
  ownerOnly?: boolean;
}

const CARDS: ModuleCard[] = [
  {
    id: "worklist",
    title: "USG Worklist",
    description: "Pending ultrasound studies awaiting reporting, measurement extraction, and review.",
    icon: Stethoscope,
    path: "/usg/worklist",
    gradient: "from-indigo-50 via-blue-50 to-sky-50 dark:from-indigo-950/40 dark:via-blue-950/40 dark:to-sky-950/40",
    iconBg: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300",
    badgeKey: "pendingWorklist",
    badgeLabel: "Pending",
  },
  {
    id: "measurements",
    title: "USG Measurements",
    description: "AI-extracted measurements from DICOM SR and OCR — BPD, HC, FL, AFI, organ sizes and more.",
    icon: ScanSearch,
    path: "/usg/measurements",
    gradient: "from-emerald-50 via-teal-50 to-cyan-50 dark:from-emerald-950/40 dark:via-teal-950/40 dark:to-cyan-950/40",
    iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300",
    badgeKey: "pendingMeasurements",
    badgeLabel: "Awaiting Review",
  },
  {
    id: "reporting",
    title: "USG Reporting",
    description: "Draft and finalize USG reports for OB, Pelvis, Abdomen, KUB, Thyroid with auto-fill from approved measurements.",
    icon: FileText,
    path: "/usg/reporting",
    gradient: "from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/40 dark:to-yellow-950/40",
    iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300",
    badgeKey: "draftReports",
    badgeLabel: "Drafts",
  },
  {
    id: "key-images",
    title: "USG Key Images",
    description: "Curated key frames selected by the sonologist for inclusion in the final report.",
    icon: Image,
    path: "/usg/key-images",
    gradient: "from-violet-50 via-purple-50 to-fuchsia-50 dark:from-violet-950/40 dark:via-purple-950/40 dark:to-fuchsia-950/40",
    iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300",
    badgeKey: "keyImages",
    badgeLabel: "Images",
    badgeVariant: "secondary",
  },
  {
    id: "doppler",
    title: "Doppler Reporting",
    description: "Structured Doppler velocimetry — PSV, EDV, RI, PI, S/D ratio per vessel with confidence scoring.",
    icon: Activity,
    path: "/usg/doppler",
    gradient: "from-rose-50 via-pink-50 to-red-50 dark:from-rose-950/40 dark:via-pink-950/40 dark:to-red-950/40",
    iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300",
    badgeKey: "pendingDoppler",
    badgeLabel: "Pending",
  },
  {
    id: "prior",
    title: "Prior Comparison",
    description: "Compare current findings against prior finalized USG reports for the same patient.",
    icon: Clock,
    path: "/usg/reporting",
    gradient: "from-cyan-50 via-sky-50 to-blue-50 dark:from-cyan-950/40 dark:via-sky-950/40 dark:to-blue-950/40",
    iconBg: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/50 dark:text-cyan-300",
  },
  {
    id: "pregnancy-dashboard",
    title: "Pregnancy Dashboard",
    description: "Pregnancy Timeline, interactive Growth Charts, AI key image selection, and comparative analysis.",
    icon: Baby,
    path: "/usg/pregnancy-dashboard",
    gradient: "from-pink-50 via-rose-50 to-amber-50 dark:from-pink-950/40 dark:via-rose-950/40 dark:to-amber-950/40",
    iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-900/50 dark:text-pink-300",
  },
  {
    id: "analytics",
    title: "USG Analytics",
    description: "Workforce productivity dashboard with TAT, template usage, amendment rate, and quality metrics.",
    icon: BarChart2,
    path: "/usg/analytics",
    gradient: "from-teal-50 via-emerald-50 to-green-50 dark:from-teal-950/40 dark:via-emerald-950/40 dark:to-green-950/40",
    iconBg: "bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-300",
  },
  {
    id: "critical",
    title: "Critical Alerts & Productivity",
    description: "USG critical findings, TAT & radiologist productivity dashboard plus full audit log.",
    icon: AlertCircle,
    path: "/usg/critical",
    gradient: "from-red-50 via-rose-50 to-pink-50 dark:from-red-950/40 dark:via-rose-950/40 dark:to-pink-950/40",
    iconBg: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300",
  },
  {
    id: "settings",
    title: "USG Extraction Settings",
    description: "Configure AI pipeline — OCR, SR priority, confidence thresholds, auto-reject, machine profiles.",
    icon: Settings2,
    path: "/usg/settings",
    gradient: "from-slate-50 via-gray-50 to-zinc-50 dark:from-slate-950/40 dark:via-gray-950/40 dark:to-zinc-950/40",
    iconBg: "bg-slate-100 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300",
    ownerOnly: true,
  },
];

interface CriticalAlert { id: number; severity: string; findingType: string; patientName: string; createdAt: string; status: string }
interface ProductivityStats {
  reports: { drafts: number; pending: number; verified: number; finalized: number; amended: number; total: number };
  criticalAlerts: number;
}

export default function UsgDoppler() {
  const [, navigate] = useLocation();
  const session = readStaffSession();
  const isOwner = FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""));

  const { data: stats } = useQuery<UsgStats>({
    queryKey: ["usg-stats"],
    queryFn: () => fetchApi("/api/usg-extraction/stats"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: alerts = [] } = useQuery<CriticalAlert[]>({
    queryKey: ["usg-critical-alerts"],
    queryFn: () => fetchApi("/api/usg-critical/alerts?status=active"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: productivity } = useQuery<ProductivityStats>({
    queryKey: ["usg-productivity-7d"],
    queryFn: () => fetchApi("/api/usg-critical/productivity?days=7"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const visibleCards = CARDS.filter((c) => !c.ownerOnly || isOwner);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG / DOPPLER"
        subtitle="Ultrasound & Doppler imaging workflow — AI extraction, measurement review, and report generation"
        actions={
          <div className="flex items-center gap-2">
            <Waves className="h-5 w-5 text-cyan-500" />
            <span className="text-sm text-muted-foreground font-medium">Module Dashboard</span>
          </div>
        }
      />

      {/* Critical alerts banner */}
      {alerts.length > 0 && (
        <button
          onClick={() => navigate("/usg/critical")}
          className="w-full text-left rounded-xl border border-red-300/70 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow"
        >
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800 dark:text-red-200">
              {alerts.length} active USG critical alert{alerts.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-0.5 truncate">
              Latest: {alerts[0].patientName} · {alerts[0].findingType} ({alerts[0].severity})
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-red-600" />
        </button>
      )}

      {/* Summary strip */}
      {stats && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
            <Clock className="h-3.5 w-3.5" />
            {stats.pendingMeasurements} measurements awaiting review
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {stats.approvedMeasurements} approved
          </div>
          {(stats.pendingWorklist > 0) && (
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              {stats.pendingWorklist} studies in worklist
            </div>
          )}
          {productivity && (
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-semibold">
              <FileText className="h-3.5 w-3.5" />
              {productivity.reports.finalized} finalized · {productivity.reports.pending + productivity.reports.drafts} open (7d)
            </div>
          )}
        </div>
      )}

      {/* Module cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleCards.map((card) => {
          const Icon = card.icon;
          const count = card.badgeKey && stats ? stats[card.badgeKey] : undefined;

          return (
            <button
              key={card.id}
              onClick={() => navigate(card.path)}
              className={`
                group relative flex flex-col gap-4 p-5 rounded-2xl border border-border/60
                bg-gradient-to-br ${card.gradient}
                text-left cursor-pointer
                transition-all duration-200
                hover:shadow-lg hover:shadow-black/8 hover:scale-[1.015] hover:border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
              `}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${card.iconBg} shadow-sm`}>
                  <Icon className="h-5 w-5" />
                </div>

                {count !== undefined && count > 0 && (
                  <Badge
                    variant={card.badgeVariant ?? "default"}
                    className="text-xs font-bold flex-shrink-0"
                  >
                    {count} {card.badgeLabel}
                  </Badge>
                )}
                {count !== undefined && count === 0 && (
                  <Badge variant="outline" className="text-xs flex-shrink-0 text-muted-foreground">
                    {card.badgeLabel}: 0
                  </Badge>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="font-bold text-foreground text-base leading-tight group-hover:text-primary transition-colors">
                  {card.title}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {card.description}
                </p>
              </div>

              <div className="flex items-center justify-end mt-auto">
                <span className="text-xs font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Open <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>

              {/* Decorative background pulse on hover */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/0 to-primary/0 group-hover:from-primary/[0.02] group-hover:to-primary/[0.04] transition-all duration-200 pointer-events-none" />
            </button>
          );
        })}
      </div>

      {/* Info footer */}
      <div className="rounded-xl border border-cyan-200/60 dark:border-cyan-800/40 bg-cyan-50/50 dark:bg-cyan-950/20 p-4">
        <div className="flex gap-3">
          <Waves className="h-5 w-5 text-cyan-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">USG / DOPPLER Module</p>
            <p>
              This module provides end-to-end ultrasound and Doppler workflow — from DICOM auto-extraction
              to measurement review, report drafting, and key image management.
              All extracted measurements require human approval before use in reports.
            </p>
            <p className="text-cyan-600 dark:text-cyan-400">
              Confidence coding: <span className="font-semibold text-green-600">Green = DICOM SR (high)</span> ·{" "}
              <span className="font-semibold text-yellow-600">Yellow = OCR (medium)</span> ·{" "}
              <span className="font-semibold text-red-600">Red = uncertain (low)</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
