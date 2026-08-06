import { useState } from "react";
import { useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Radio, Layers, Tv2, FileText, Settings, Activity, FilePen, ShieldAlert,
  ListChecks, Heart, Baby, Globe, Server, TrendingUp, Terminal,
  GraduationCap, Search, Clock, Sparkles, CheckCircle2, Mic,
  Sliders, ShieldCheck, Database, LayoutGrid, ArrowRight, ShieldAlert as AdminIcon
} from "lucide-react";

type ToolItem = {
  name: string;
  path: string;
  description: string;
  icon: React.ComponentType<any>;
  badge?: "Recommended" | "Legacy" | "Advanced" | "Admin Only";
  openInCommandCenter?: boolean;
};

type GroupSection = {
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  items: ToolItem[];
};

export default function Radiology() {
  const [, navigate] = useLocation();

  const sections: GroupSection[] = [
    {
      title: "1. Daily Workflow",
      description: "Core everyday clinical operational tasks for radiologists and imaging technicians.",
      icon: Activity,
      items: [
        {
          name: "Reporting Workspace",
          path: "/radiology/reporting-workspace",
          description: "THE canonical radiology reporting page: embedded viewer, Quick Select, templates, finalize, print/PDF.",
          icon: FileText,
          badge: "Recommended"
        },
        {
          name: "Radiology Worklist Hub",
          path: "/radiology/worklist",
          description: "Full active study queues, claimant operations, technician schedules, and modality statuses.",
          icon: ListChecks
        },
        {
          name: "Report Delivery & Kiosk",
          path: "/report-delivery",
          description: "Manage finalized report printing, dispatch status, patient search lookup, and delivery queues.",
          icon: CheckCircle2
        },
        {
          name: "Critical Findings Monitor",
          path: "/radiology/critical-findings",
          description: "Oversee urgent findings requiring rapid communication to referring physicians.",
          icon: ShieldAlert
        },
        {
          name: "Radiologist Queue / Pending",
          path: "/radiology/radiologist-queue",
          description: "View and prioritize acquired studies awaiting dictation or formal report drafting.",
          icon: Clock
        },
      ]
    },
    {
      title: "2. Viewers",
      description: "Zero-footprint web and native DICOM image viewer endpoints.",
      icon: Tv2,
      items: [
        {
          name: "OHIF Web Viewer",
          path: "/pacs",
          description: "Launch standard browser-based zero-footprint viewer. Ideal for basic cross-sectional studies review.",
          icon: Tv2
        },
        {
          name: "Viewer Settings & Diagnostics",
          path: "/settings/radiology?tab=viewers",
          description: "Verify configured viewer URLs and test active launching triggers with sample study UIDs.",
          icon: Sliders
        }
      ]
    },
    {
      title: "3. Reporting Tools",
      description: "Manage report libraries, normal templates, and automated AI assistance prompts.",
      icon: FileText,
      items: [
        {
          name: "Structured Templates Editor",
          path: "/radiology/structured-report-templates",
          description: "Configure templates featuring checklist finding-items and interactive macro controls.",
          icon: FilePen
        },
        {
          name: "Normal Snippets Library",
          path: "/radiology/normal-templates",
          description: "Manage pre-defined text structures for normal and common pathological findings.",
          icon: FileText
        },
        {
          name: "AI Copilot Settings & Prompts",
          path: "/radiology/ai-reporting-settings",
          description: "Fine-tune AI prompt templates, gemini models routing, and auto-impression generators.",
          icon: Sparkles,
          badge: "Advanced"
        },
        {
          name: "Voice Dictation Calibrator",
          path: "/radiology/voice-dictation",
          description: "Calibrate local microphone inputs, vocabulary sets, and automated transcription cleanups.",
          icon: Mic
        }
      ]
    },
    {
      title: "4. Extra Radiology Tools / Advanced",
      description: "Specialized diagnostics, legacy managers, and teaching tools.",
      icon: Sliders,
      items: [
        {
          name: "Radiology Command Center",
          path: "/radiology/command-center",
          description: "Legacy single-screen workstation (deprecated — use Reporting Workspace). Owner/admin only.",
          icon: Layers,
          badge: "Legacy",
          openInCommandCenter: true
        },
        {
          name: "Today's Studies Legacy Hub",
          path: "/radiology/legacy",
          description: "Access today's schedule, standard editor workspace, and filmCD tracking logs.",
          icon: Activity,
          badge: "Legacy"
        },
        {
          name: "Legacy Report Generator",
          path: "/radiology/report-generator",
          description: "Deprecated layout/macros editor — prefer Reporting Workspace print tab.",
          icon: FilePen,
          badge: "Legacy"
        },
        {
          name: "PACS Overview & Analytics",
          path: "/radiology/pacs-dashboard",
          description: "Disk storage allocation, system uptime indicators, and ingestion summaries.",
          icon: TrendingUp,
          badge: "Advanced"
        },
        {
          name: "Experimental AI Diagnostics",
          path: "/radiology/advanced-tools",
          description: "Inference pipelines logs, prompt effectiveness graphs, and missed findings detector.",
          icon: Terminal,
          badge: "Advanced"
        },
        {
          name: "Teleradiology Outsourcing Hub",
          path: "/teleradiology",
          description: "Outsourced reporting logs, rate cards reconciliation, and external worklist portals.",
          icon: Globe,
          badge: "Advanced"
        },
        {
          name: "Echocardiography Console",
          path: "/echo",
          description: "Specialized echo cardiology measurements and templates reporting.",
          icon: Heart,
          badge: "Advanced"
        },
        {
          name: "Fetal USG Level 4",
          path: "/fetal-usg",
          description: "Detailed fetal ultrasound reporting forms and growth analysis curves.",
          icon: Baby,
          badge: "Advanced"
        },
        {
          name: "Fetal Echo Reporting",
          path: "/fetal-echo",
          description: "Specialized fetal cardiology reporting templates.",
          icon: Baby,
          badge: "Advanced"
        },
        {
          name: "Teaching Cases File Manager",
          path: "/teaching-cases",
          description: "Research case library, favorite collections, and presentations exporter.",
          icon: GraduationCap,
          badge: "Advanced"
        }
      ]
    },
    {
      title: "5. PACS / DICOM Administration",
      description: "Manage system configurations, agent node settings, connections, and audit trails.",
      icon: Settings,
      items: [
        {
          name: "Radiology Settings Center",
          path: "/settings/radiology",
          description: "THE admin hub: network profiles, PACS/Orthanc, OHIF/Weasis, MWL, report style, voice, USG extraction.",
          icon: Settings,
          badge: "Admin Only"
        },
        {
          name: "PACS Server Integration",
          path: "/settings/radiology?tab=pacs",
          description: "Setup server AE Titles, WADO endpoints, and central database connection parameters.",
          icon: Server,
          badge: "Admin Only"
        },
        {
          name: "DICOM Agent & NAS Setup",
          path: "/radiology/dicom-agent-dashboard",
          description: "Configure local Synology pull agent node mount points and ingestion directories.",
          icon: Server,
          badge: "Admin Only"
        },
        {
          name: "Modality Station Directory",
          path: "/settings/radiology?tab=modalities",
          description: "Manage hospital modality devices (MRI, CT, US) allowed to query MWL.",
          icon: Tv2,
          badge: "Admin Only"
        },
        {
          name: "DICOM Routing & Gateway Rules",
          path: "/radiology/acquisition-gateway",
          description: "Manage DICOM forward configurations, acquisition node rules, and schedules.",
          icon: Database,
          badge: "Admin Only"
        },
        {
          name: "ERP Modality Worklist Sync",
          path: "/settings/radiology?tab=mwl",
          description: "Verify Orthanc database state parity with ERP study schedule list.",
          icon: ListChecks,
          badge: "Admin Only"
        },
        {
          name: "System Connection Watchdog",
          path: "/radiology/watchdog",
          description: "Pings active modality devices and reports connectivity health warnings.",
          icon: ShieldAlert,
          badge: "Admin Only"
        },
        {
          name: "PACS Integration Audit Logs",
          path: "/radiology/pacs-logs",
          description: "Inspect DICOM network transaction history and sync event logs.",
          icon: FileText,
          badge: "Admin Only"
        }
      ]
    }
  ];

  const getBadgeStyle = (badge?: string) => {
    switch (badge) {
      case "Recommended":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold animate-pulse";
      case "Legacy":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "Advanced":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "Admin Only":
        return "bg-rose-500/10 text-rose-500 border-rose-500/20";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Radiology Command Hub"
        subtitle="Grouped navigation console for radiology operations, reporting, and administration"
      />

      {/* Featured Banner — the canonical Reporting Workspace (M1.1 consolidation) */}
      <Card className="border-emerald-500/30 bg-emerald-500/5 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
        <div className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500 text-white font-bold uppercase tracking-wider text-[10px]">Canonical Workspace</Badge>
              <Sparkles className="h-4 w-4 text-emerald-500 animate-spin" style={{ animationDuration: "3s" }} />
            </div>
            <CardTitle className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Layers className="text-emerald-500 h-5 w-5" />
              Reporting Workspace
            </CardTitle>
            <CardDescription className="text-slate-300 text-sm">
              The one radiologist reporting page: embedded viewer, structured Quick Select findings, templates, prior studies, and finalize — open studies from the Worklist Hub with "Open Report".
            </CardDescription>
          </div>
          <Button
            onClick={() => navigate("/radiology/reporting-workspace")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-2 px-5 h-11 shrink-0"
          >
            Open Reporting Workspace
            <ArrowRight size={16} />
          </Button>
        </div>
      </Card>

      {/* Grid of Sections */}
      <div className="space-y-6">
        {sections.map((section, idx) => {
          const SecIcon = section.icon;
          return (
            <div key={idx} className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-800">
                <SecIcon className="h-5 w-5 text-emerald-500" />
                <h2 className="text-base font-bold tracking-tight text-slate-200">{section.title}</h2>
                <span className="text-xs text-slate-500 font-normal">({section.description})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {section.items.map((item, itemIdx) => {
                  const ItemIcon = item.icon;
                  return (
                    <Card
                      key={itemIdx}
                      className={`hover:bg-slate-900/60 transition-colors group cursor-pointer border-slate-800 ${item.badge === "Recommended" ? "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/30" : "bg-slate-950"}`}
                      onClick={() => navigate(item.path)}
                    >
                      <CardHeader className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={`p-2 rounded bg-slate-900 border border-slate-800 group-hover:border-emerald-500/40 transition-colors ${item.badge === "Recommended" ? "bg-emerald-950/20" : ""}`}>
                              <ItemIcon className={`h-4 w-4 ${item.badge === "Recommended" ? "text-emerald-400" : "text-slate-400"}`} />
                            </div>
                            <span className="font-semibold text-xs text-slate-200 group-hover:text-emerald-400 transition-colors">{item.name}</span>
                          </div>
                          {item.badge && (
                            <Badge variant="outline" className={`text-[9px] font-semibold h-5 ${getBadgeStyle(item.badge)}`}>
                              {item.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal min-h-[34px] group-hover:text-slate-300 transition-colors">
                          {item.description}
                        </p>
                        {item.openInCommandCenter && (
                          <div className="pt-1 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                            <span>Open in Command Center</span>
                            <ArrowRight size={10} className="group-hover:translate-x-1 transition-transform" />
                          </div>
                        )}
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
