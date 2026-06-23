import { useState } from "react";
import { useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Search, Cpu, ExternalLink, ArrowRight, BrainCircuit, Microscope,
  Settings2, Server, ShieldAlert, Monitor, BarChart3, FileText,
  HardDrive, Archive, Activity, Bell, FlaskConical, Eye, Globe,
  Workflow, Database, ListChecks, AlertTriangle,
  BookOpen, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type FeatureStatus = "Active" | "Experimental" | "Deprecated" | "Future";

interface RadiologyFeature {
  name: string;
  route: string;
  purpose: string;
  status: FeatureStatus;
  adminOnly: boolean;
  icon: typeof Cpu;
}

// ─── Feature Catalog ─────────────────────────────────────────────────────────

const FEATURES: RadiologyFeature[] = [
  // Active / Daily but hidden
  {
    name: "Unified Reporting",
    route: "/radiology/reporting-workspace",
    purpose: "New consolidated reporting page with embedded viewer, measurements, AI draft, and templates.",
    status: "Future",
    adminOnly: false,
    icon: FileText,
  },
  {
    name: "AI Extraction Review",
    route: "/radiology/ai-extraction-review",
    purpose: "Queue for reviewing AI-extracted measurements and findings before they are inserted into reports.",
    status: "Active",
    adminOnly: false,
    icon: Microscope,
  },
  {
    name: "AI Reporting Settings",
    route: "/radiology/ai-reporting-settings",
    purpose: "Configure AI providers, model selection, prompt templates, and auto-generation rules.",
    status: "Active",
    adminOnly: true,
    icon: BrainCircuit,
  },
  {
    name: "AI Prompt Templates",
    route: "/radiology/ai-prompt-templates",
    purpose: "Manage radiology-specific prompt templates for AI report generation.",
    status: "Active",
    adminOnly: true,
    icon: FlaskConical,
  },
  {
    name: "AI Model Routing",
    route: "/radiology/ai-model-routing",
    purpose: "Route AI requests to different models based on modality, study type, or complexity.",
    status: "Experimental",
    adminOnly: true,
    icon: Database,
  },
  {
    name: "PACS Dashboard",
    route: "/radiology/pacs-dashboard",
    purpose: "Operational metrics and analytics for the PACS system.",
    status: "Active",
    adminOnly: true,
    icon: BarChart3,
  },
  {
    name: "Command Center",
    route: "/radiology/command-center",
    purpose: "Real-time KPI dashboard: daily volume, TAT, AI usage, quality scores, anomalies.",
    status: "Active",
    adminOnly: true,
    icon: Activity,
  },
  {
    name: "PACS Settings",
    route: "/radiology/pacs-settings",
    purpose: "Configure PACS servers, WADO endpoints, DICOM web settings, and viewer preferences.",
    status: "Active",
    adminOnly: true,
    icon: Settings2,
  },
  {
    name: "PACS Logs",
    route: "/radiology/pacs-logs",
    purpose: "View DICOM study logs, PACS events, and error history.",
    status: "Active",
    adminOnly: true,
    icon: HardDrive,
  },
  {
    name: "Archive Lifecycle",
    route: "/radiology/archive-lifecycle",
    purpose: "Manage study archive policies, retention rules, and storage tiering.",
    status: "Active",
    adminOnly: true,
    icon: Archive,
  },
  {
    name: "DICOM Agent Dashboard",
    route: "/radiology/dicom-agent-dashboard",
    purpose: "Monitor DICOM agent status, connectivity, and study routing.",
    status: "Active",
    adminOnly: true,
    icon: Server,
  },
  {
    name: "Modality Management",
    route: "/radiology/modality-management",
    purpose: "Register, configure, and monitor imaging modalities (CT, MRI, USG, etc.).",
    status: "Active",
    adminOnly: true,
    icon: Monitor,
  },
  {
    name: "Watchdog",
    route: "/radiology/watchdog",
    purpose: "Service monitoring and health checks for PACS and DICOM services.",
    status: "Active",
    adminOnly: true,
    icon: ShieldAlert,
  },
  {
    name: "AI Inference Settings",
    route: "/radiology/ai-inference-settings",
    purpose: "Configure on-premise or cloud AI inference endpoints and credentials.",
    status: "Experimental",
    adminOnly: true,
    icon: BrainCircuit,
  },
  {
    name: "HL7 Settings",
    route: "/radiology/hl7-settings",
    purpose: "Configure HL7 message routing and integration with external systems.",
    status: "Active",
    adminOnly: true,
    icon: Database,
  },
  {
    name: "Agent Setup",
    route: "/radiology/agent-setup",
    purpose: "Install and configure the DICOM agent on imaging workstations.",
    status: "Active",
    adminOnly: true,
    icon: Server,
  },
  {
    name: "Structured Report Templates",
    route: "/radiology/structured-report-templates",
    purpose: "Manage structured report templates with parameters and validation rules.",
    status: "Active",
    adminOnly: true,
    icon: ListChecks,
  },
  {
    name: "AI Audit Log",
    route: "/radiology/ai-audit-log",
    purpose: "Review all AI-generated content, edits, and approvals for compliance.",
    status: "Active",
    adminOnly: true,
    icon: BookOpen,
  },
  {
    name: "Quality Scores",
    route: "/radiology/ai-quality-scores",
    purpose: "View and manage AI quality scores for generated reports.",
    status: "Experimental",
    adminOnly: true,
    icon: BarChart3,
  },
  {
    name: "Prompt Effectiveness",
    route: "/radiology/ai-prompt-effectiveness",
    purpose: "Analyze which prompt templates produce the best AI-generated reports.",
    status: "Experimental",
    adminOnly: true,
    icon: FlaskConical,
  },
  {
    name: "AI DICOM Findings",
    route: "/radiology/ai-dicom-findings",
    purpose: "AI-detected anomalies and findings from DICOM studies.",
    status: "Experimental",
    adminOnly: true,
    icon: Eye,
  },
  {
    name: "RAG Vector Store",
    route: "/radiology/rag-vector-store",
    purpose: "Manage the retrieval-augmented generation vector store for radiology knowledge.",
    status: "Future",
    adminOnly: true,
    icon: Database,
  },
  {
    name: "AI Search Retrieval",
    route: "/radiology/ai-search-retrieval",
    purpose: "Semantic search over radiology reports and findings.",
    status: "Experimental",
    adminOnly: true,
    icon: Search,
  },
  {
    name: "Anomaly Alerts",
    route: "/radiology/anomaly-alerts",
    purpose: "Configure and review automated anomaly detection alerts.",
    status: "Experimental",
    adminOnly: true,
    icon: Bell,
  },
  {
    name: "Report Diff Viewer",
    route: "/radiology/report-diff",
    purpose: "Compare versions of reports to track changes.",
    status: "Active",
    adminOnly: true,
    icon: FileText,
  },
  {
    name: "Feedback Loop Analytics",
    route: "/radiology/feedback-loop-analytics",
    purpose: "Analyze radiologist feedback on AI-generated reports.",
    status: "Experimental",
    adminOnly: true,
    icon: BarChart3,
  },
  {
    name: "Template Versions",
    route: "/radiology/template-versions",
    purpose: "Version control for report templates.",
    status: "Active",
    adminOnly: true,
    icon: FileText,
  },
  {
    name: "AI Billing Suggestions",
    route: "/radiology/billing-suggestions",
    purpose: "AI suggestions for billing codes based on study findings.",
    status: "Future",
    adminOnly: true,
    icon: BrainCircuit,
  },
  {
    name: "Peer Review Assignments",
    route: "/radiology/peer-review-assignments",
    purpose: "Assign and track peer review tasks for quality assurance.",
    status: "Active",
    adminOnly: true,
    icon: ListChecks,
  },
  {
    name: "Turnaround Time Analytics",
    route: "/radiology/turnaround-times",
    purpose: "Analyze and optimize report turnaround times.",
    status: "Active",
    adminOnly: true,
    icon: Activity,
  },
  {
    name: "Training Data Exports",
    route: "/radiology/training-data-exports",
    purpose: "Export annotated data for AI model training.",
    status: "Experimental",
    adminOnly: true,
    icon: Database,
  },
  {
    name: "Quality Gates",
    route: "/radiology/quality-gates",
    purpose: "Automated quality checks before report finalization.",
    status: "Experimental",
    adminOnly: true,
    icon: ShieldAlert,
  },
  {
    name: "Provider Health Monitor",
    route: "/radiology/provider-health",
    purpose: "Monitor AI provider health and quota usage.",
    status: "Active",
    adminOnly: true,
    icon: Activity,
  },
  {
    name: "DICOM Study Worklist",
    route: "/radiology/dicom-study-worklist",
    purpose: "Browse DICOM studies directly from the PACS.",
    status: "Active",
    adminOnly: false,
    icon: HardDrive,
  },
  {
    name: "Radiologist Queue",
    route: "/radiology/radiologist-queue",
    purpose: "View and manage radiologist work queues.",
    status: "Active",
    adminOnly: false,
    icon: ListChecks,
  },
  {
    name: "Technician Workflow",
    route: "/radiology/technician-workflow",
    purpose: "Track technician workflow for study acquisition.",
    status: "Active",
    adminOnly: false,
    icon: Workflow,
  },
  {
    name: "Hanging Protocols",
    route: "/radiology/hanging-protocols",
    purpose: "Configure image layout and display protocols.",
    status: "Active",
    adminOnly: true,
    icon: Eye,
  },
  {
    name: "Acquisition Gateway",
    route: "/radiology/acquisition-gateway",
    purpose: "Manage study acquisition from remote modalities.",
    status: "Active",
    adminOnly: true,
    icon: Server,
  },
  {
    name: "MWL Manager",
    route: "/radiology/mwl-manager",
    purpose: "Configure Modality Worklist (MWL) settings.",
    status: "Active",
    adminOnly: true,
    icon: ListChecks,
  },
  {
    name: "AI Pipeline Manager",
    route: "/radiology/ai-pipeline",
    purpose: "Manage and monitor AI processing pipelines.",
    status: "Experimental",
    adminOnly: true,
    icon: BrainCircuit,
  },
  {
    name: "Critical Alerts Manager",
    route: "/radiology/critical-alerts",
    purpose: "Manage critical finding alert routing and escalation.",
    status: "Active",
    adminOnly: true,
    icon: AlertTriangle,
  },
  {
    name: "Storage Lifecycle",
    route: "/radiology/storage-lifecycle",
    purpose: "Manage storage lifecycle policies for DICOM studies.",
    status: "Active",
    adminOnly: true,
    icon: Archive,
  },
  {
    name: "Radiologist Tools",
    route: "/radiology/productivity-tools",
    purpose: "Additional tools for radiologist productivity.",
    status: "Active",
    adminOnly: false,
    icon: Globe,
  },
  {
    name: "USG Measurements",
    route: "/radiology/usg-measurements",
    purpose: "Review and manage USG measurements extracted from DICOM.",
    status: "Active",
    adminOnly: false,
    icon: Microscope,
  },
  {
    name: "USG Admin Settings",
    route: "/radiology/usg-admin-settings",
    purpose: "Configure USG measurement extraction settings.",
    status: "Active",
    adminOnly: true,
    icon: Settings2,
  },
  {
    name: "Patient Communication",
    route: "/radiology/patient-communication",
    purpose: "Send automated patient communications from radiology.",
    status: "Active",
    adminOnly: false,
    icon: Globe,
  },
  // USG/DOPPLER (legacy standalone module)
  {
    name: "USG Dashboard",
    route: "/usg",
    purpose: "Legacy USG/DOPPLER dashboard. (USG studies are now in Radiology Worklist.)",
    status: "Deprecated",
    adminOnly: false,
    icon: Microscope,
  },
  {
    name: "USG Worklist",
    route: "/usg/worklist",
    purpose: "Legacy USG-specific worklist. (Merged into Radiology Worklist.)",
    status: "Deprecated",
    adminOnly: false,
    icon: ListChecks,
  },
  {
    name: "USG Reporting",
    route: "/usg/reporting",
    purpose: "Legacy USG-specific reporting page. (To be unified into Radiology Reporting.)",
    status: "Deprecated",
    adminOnly: false,
    icon: FileText,
  },
  {
    name: "USG Doppler",
    route: "/usg/doppler",
    purpose: "Legacy Doppler-specific reporting page. (To be unified into Radiology Reporting.)",
    status: "Deprecated",
    adminOnly: false,
    icon: Activity,
  },
  {
    name: "USG Key Images",
    route: "/usg/key-images",
    purpose: "Manage key images for USG studies.",
    status: "Active",
    adminOnly: false,
    icon: Eye,
  },
  {
    name: "USG Critical Alerts",
    route: "/usg/critical",
    purpose: "Critical alerts for USG studies.",
    status: "Active",
    adminOnly: false,
    icon: AlertTriangle,
  },
  {
    name: "USG Analytics",
    route: "/usg/analytics",
    purpose: "Analytics dashboard for USG studies.",
    status: "Active",
    adminOnly: true,
    icon: BarChart3,
  },
  {
    name: "DICOM Nodes",
    route: "/dicom-nodes",
    purpose: "Manage DICOM SCP/SCU nodes and routing rules.",
    status: "Active",
    adminOnly: true,
    icon: Server,
  },
  {
    name: "Mobile Viewer",
    route: "/m/viewer/:studyInstanceUID",
    purpose: "Mobile-optimized DICOM viewer for on-the-go review.",
    status: "Active",
    adminOnly: false,
    icon: Eye,
  },
];

// ─── Status color mapping ────────────────────────────────────────────────────

function statusBadgeColor(status: FeatureStatus): string {
  switch (status) {
    case "Active": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Experimental": return "bg-amber-100 text-amber-800 border-amber-200";
    case "Deprecated": return "bg-slate-100 text-slate-600 border-slate-200";
    case "Future": return "bg-blue-100 text-blue-800 border-blue-200";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RadiologyAdvancedTools() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FeatureStatus | "All">("All");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = FEATURES.filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.purpose.toLowerCase().includes(search.toLowerCase()) ||
      f.route.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || f.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    All: FEATURES.length,
    Active: FEATURES.filter((f) => f.status === "Active").length,
    Experimental: FEATURES.filter((f) => f.status === "Experimental").length,
    Deprecated: FEATURES.filter((f) => f.status === "Deprecated").length,
    Future: FEATURES.filter((f) => f.status === "Future").length,
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Advanced Radiology Tools"
        subtitle="Non-daily-use, experimental, and legacy radiology features. All existing routes are preserved — nothing has been deleted."
      />

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, purpose, or route…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["All", "Active", "Experimental", "Deprecated", "Future"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s} ({statusCounts[s]})
            </Button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-emerald-200">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
              <Activity className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-xl font-bold">{statusCounts.Active}</div>
              <div className="text-xs text-muted-foreground">Active</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <div className="text-xl font-bold">{statusCounts.Experimental}</div>
              <div className="text-xs text-muted-foreground">Experimental</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
              <Archive className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <div className="text-xl font-bold">{statusCounts.Deprecated}</div>
              <div className="text-xs text-muted-foreground">Deprecated</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <Globe className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <div className="text-xl font-bold">{statusCounts.Future}</div>
              <div className="text-xs text-muted-foreground">Future</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((f) => {
          const Icon = f.icon;
          const isExpanded = expanded[f.route];
          return (
            <Card key={f.route} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm leading-tight">{f.name}</CardTitle>
                      <CardDescription className="text-xs font-mono mt-0.5">{f.route}</CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className={`text-[10px] ${statusBadgeColor(f.status)}`}>
                      {f.status}
                    </Badge>
                    {f.adminOnly && (
                      <Badge variant="outline" className="text-[10px] bg-purple-100 text-purple-800 border-purple-200">
                        Admin
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isExpanded ? f.purpose : f.purpose.slice(0, 100) + (f.purpose.length > 100 ? "…" : "")}
                </p>
                {f.purpose.length > 100 && (
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [f.route]: !prev[f.route] }))}
                    className="text-xs text-primary hover:underline flex items-center gap-0.5"
                  >
                    {isExpanded ? (
                      <>Less <ChevronUp className="h-3 w-3" /></>
                    ) : (
                      <>More <ChevronDown className="h-3 w-3" /></>
                    )}
                  </button>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (f.route.includes(":")) {
                        // Route with params — navigate to base route
                        const baseRoute = f.route.split("/:")[0];
                        navigate(baseRoute);
                      } else {
                        navigate(f.route);
                      }
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const baseRoute = f.route.includes(":") ? f.route.split("/:")[0] : f.route;
                      navigator.clipboard.writeText(window.location.origin + baseRoute);
                    }}
                    title="Copy route URL"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Cpu className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No features match your search.</p>
          <p className="text-xs mt-1">Try a different keyword or clear the filter.</p>
        </div>
      )}
    </div>
  );
}
