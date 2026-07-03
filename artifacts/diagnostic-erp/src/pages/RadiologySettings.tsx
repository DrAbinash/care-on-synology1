// PHASE E (Radiology V2): PRESERVED. /settings/radiology now opens the unified
// Radiology Settings page. Kept for rollback/reference — do not delete.
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Settings2, Server, Radio, Cpu, BrainCircuit, Archive, Wrench, ExternalLink, Sparkles, ShieldAlert, Info } from "lucide-react";
import { ModalityPanel } from "@/pages/ModalityManagement";
import { DicomNodesPanel } from "@/pages/DicomNodes";
import { AgentSetupPanel } from "@/pages/AgentSetup";
import { ArchiveLifecyclePanel } from "@/pages/PacsArchiveLifecycle";
import { AiInferencePanel } from "@/pages/AiInferenceSettings";
import { AiReportingPanel } from "@/pages/AiReportingSettings";
import {
  AiImpressionCard, QualityCheckerCard, FollowUpRecommendationsCard,
  TemplateLearningCard, MultiLanguageCard, RoutingRulesCard,
  AmendmentManagerCard, SonographerModeCard, DicomSrExportCard,
} from "@/components/smartRadiology/SmartRadiologyCards";
import {
  RisMonitorCommandGrid,
} from "@/components/risMonitoring/RisMonitorCards";

type PacsSetting = { id: number; key: string; value: string; category: string; isSecret: boolean };

const PACS_KEY_LABELS: { key: string; label: string }[] = [
  { key: "conquest_url",         label: "Conquest URL" },
  { key: "ae_title",             label: "Server AE Title" },
  { key: "conquest_port",        label: "PACS HTTP Port" },
  { key: "mwl_port",             label: "MWL Port" },
  { key: "dicom_port",           label: "DICOM Port" },
  { key: "storage_path",         label: "Storage Path" },
  { key: "max_concurrent_pulls", label: "Max Concurrent Pulls" },
  { key: "weasis_url",           label: "Viewer URL" },
];

function PacsConfigPanel() {
  const [, navigate] = useLocation();
  const { data: settings = [] } = useQuery<PacsSetting[]>({
    queryKey: ["pacs-settings-preview"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
  });
  const get = (key: string) => settings.find((s) => s.key === key)?.value ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base">PACS Configuration</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Key settings for Conquest PACS, MWL, and study routing
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/radiology/pacs-settings")}>
          <ExternalLink size={14} className="mr-1.5" />Full PACS Settings
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PACS_KEY_LABELS.map(({ label, key }) => (
          <div key={key} className="rounded-lg border p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
            <div className="text-sm font-medium truncate">{get(key)}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={() => navigate("/radiology/pacs-settings")}>
          <Settings2 size={14} className="mr-1.5" />Configure Full PACS Settings
        </Button>
      </div>
    </div>
  );
}

export default function RadiologySettings() {
  const [, navigate] = useLocation();
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Radiology Settings"
        subtitle="PACS configuration, imaging devices, DICOM nodes, agents, storage, and AI"
      />

      <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Info className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" size={18} />
          <div>
            <h4 className="font-semibold text-sm">These settings have moved!</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              To simplify configuration and avoid profile/IP mismatches, all PACS, DICOM, Modality, and AI settings are now consolidated in the unified Settings Center.
            </p>
          </div>
        </div>
        <Button variant="default" size="sm" onClick={() => navigate("/radiology/settings-center")} className="shrink-0">
          Go to Settings Center
        </Button>
      </div>

      <Tabs defaultValue="pacs-config" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="pacs-config">
            <Settings2 size={13} className="mr-1.5" />PACS Config
          </TabsTrigger>
          <TabsTrigger value="modalities">
            <Server size={13} className="mr-1.5" />Modalities
          </TabsTrigger>
          <TabsTrigger value="dicom-nodes">
            <Radio size={13} className="mr-1.5" />DICOM Nodes
          </TabsTrigger>
          <TabsTrigger value="agent-setup">
            <Wrench size={13} className="mr-1.5" />Agent Setup
          </TabsTrigger>
          <TabsTrigger value="archive">
            <Archive size={13} className="mr-1.5" />Archive &amp; Retention
          </TabsTrigger>
          <TabsTrigger value="ai-inference">
            <Cpu size={13} className="mr-1.5" />AI Inference
          </TabsTrigger>
          <TabsTrigger value="ai-reporting">
            <BrainCircuit size={13} className="mr-1.5" />AI Reporting
          </TabsTrigger>
          <TabsTrigger value="smart-platform">
            <Sparkles size={13} className="mr-1.5" />Smart Platform
          </TabsTrigger>
          <TabsTrigger value="production-hardening">
            <ShieldAlert size={13} className="mr-1.5" />Hardening
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pacs-config">
          <PacsConfigPanel />
        </TabsContent>

        <TabsContent value="modalities">
          <ModalityPanel />
        </TabsContent>

        <TabsContent value="dicom-nodes">
          <DicomNodesPanel />
        </TabsContent>

        <TabsContent value="agent-setup">
          <AgentSetupPanel />
        </TabsContent>

        <TabsContent value="archive">
          <ArchiveLifecyclePanel />
        </TabsContent>

        <TabsContent value="ai-inference">
          <AiInferencePanel />
        </TabsContent>

        <TabsContent value="ai-reporting">
          <AiReportingPanel />
        </TabsContent>

        <TabsContent value="smart-platform" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <AiImpressionCard />
            <QualityCheckerCard />
            <FollowUpRecommendationsCard />
            <TemplateLearningCard />
            <MultiLanguageCard />
            <RoutingRulesCard />
            <AmendmentManagerCard />
            <SonographerModeCard />
            <DicomSrExportCard />
          </div>
        </TabsContent>

        <TabsContent value="production-hardening" className="space-y-4">
          <RisMonitorCommandGrid />
        </TabsContent>
      </Tabs>
    </div>
  );
}
