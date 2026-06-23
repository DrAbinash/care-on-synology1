import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Monitor, Search, RefreshCw, ExternalLink, AlertTriangle,
  Image, Layers, Calendar, User, Settings2, ChevronRight,
  PlayCircle, Eye, Wifi, WifiOff,
} from "lucide-react";

type PACSConfig = {
  configured: boolean;
  url: string | null;
  hasCredentials: boolean;
  viewerType: string;
  ohifUrl: string | null;
};

type DicomStudy = {
  ID: string;
  MainDicomTags: {
    StudyDate?: string;
    StudyTime?: string;
    StudyDescription?: string;
    StudyInstanceUID?: string;
    AccessionNumber?: string;
    ReferringPhysicianName?: string;
    InstitutionName?: string;
  };
  PatientMainDicomTags: {
    PatientName?: string;
    PatientID?: string;
    PatientBirthDate?: string;
    PatientSex?: string;
  };
  Series: string[];
  IsStable: boolean;
  LastUpdate: string;
};

type DicomSeries = {
  ID: string;
  MainDicomTags: {
    Modality?: string;
    SeriesDescription?: string;
    SeriesNumber?: string;
    SeriesDate?: string;
    SeriesTime?: string;
    BodyPartExamined?: string;
  };
  Instances: string[];
  Status: string;
};

const MODALITY_COLORS: Record<string, string> = {
  CT: "bg-blue-100 text-blue-700",
  MR: "bg-purple-100 text-purple-700",
  MRI: "bg-purple-100 text-purple-700",
  CR: "bg-green-100 text-green-700",
  DX: "bg-green-100 text-green-700",
  US: "bg-cyan-100 text-cyan-700",
  NM: "bg-orange-100 text-orange-700",
  PT: "bg-red-100 text-red-700",
  XA: "bg-indigo-100 text-indigo-700",
  RF: "bg-yellow-100 text-yellow-700",
};

function formatDicomDate(d?: string): string {
  if (!d || d.length < 8) return d || "—";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function formatPatientName(name?: string): string {
  if (!name) return "Unknown";
  return name.replace(/\^/g, " ").replace(/\s+/g, " ").trim();
}

export default function PACS() {
  const [search, setSearch] = useState("");
  const [selectedStudy, setSelectedStudy] = useState<DicomStudy | null>(null);
  const [weasisUrls, setWeasisUrls] = useState<{ weasisUrl: string; orthancViewerUrl: string; ohifUrl: string | null; studyInstanceUID: string } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [ohifEmbedOpen, setOhifEmbedOpen] = useState(false);

  const { data: config } = useQuery<PACSConfig>({
    queryKey: ["pacs-config"],
    queryFn: () => api.get("/api/pacs/config"),
  });

  const { data: health, refetch: refetchHealth } = useQuery<{ connected: boolean; system: Record<string, unknown> | null }>({
    queryKey: ["pacs-health"],
    queryFn: () => api.get("/api/pacs/health"),
    enabled: !!config?.configured,
    retry: false,
  });

  const { data: studies = [], isLoading, refetch } = useQuery<DicomStudy[]>({
    queryKey: ["pacs-studies", search],
    queryFn: () => search
      ? api.get(`/api/pacs/search?q=${encodeURIComponent(search)}`)
      : api.get("/api/pacs/studies"),
    enabled: !!config?.configured && health?.connected === true,
    retry: false,
  });

  const { data: series = [], isLoading: seriesLoading } = useQuery<DicomSeries[]>({
    queryKey: ["pacs-series", selectedStudy?.ID],
    queryFn: () => api.get(`/api/pacs/studies/${selectedStudy!.ID}/series`),
    enabled: !!selectedStudy,
  });

  const openInWeasis = async (study: DicomStudy) => {
    try {
      const data = await api.get<{ weasisUrl: string; orthancViewerUrl: string; ohifUrl: string | null; studyInstanceUID: string }>(`/api/pacs/studies/${study.ID}/weasis-url`);
      setWeasisUrls(data);
      setViewerOpen(true);
    } catch {
      alert("Could not get viewer URL.");
    }
  };

  if (!config?.configured) {
    return (
      <div className="pb-8">
        <PageHeader title="PACS Viewer" subtitle="DICOM Medical Imaging" />
        <div className="px-6">
          <div className="max-w-lg bg-amber-50 border border-amber-200 rounded-xl p-6 flex gap-4">
            <AlertTriangle size={24} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800">PACS Not Configured</p>
              <p className="text-sm text-amber-700 mt-1">
                Set your Orthanc PACS server URL in the environment variables to connect.
              </p>
              <div className="mt-4 bg-white border border-amber-200 rounded-lg p-4 text-xs font-mono space-y-1">
                <p className="text-muted-foreground font-sans text-xs mb-2">Required environment variables:</p>
                <p><span className="text-primary">ORTHANC_URL</span>=http://your-orthanc-server:8042</p>
                <p><span className="text-primary">ORTHANC_USERNAME</span>=orthanc <span className="text-muted-foreground">(optional)</span></p>
                <p><span className="text-primary">ORTHANC_PASSWORD</span>=orthanc <span className="text-muted-foreground">(optional)</span></p>
                <p><span className="text-primary">PACS_VIEWER_TYPE</span>=weasis <span className="text-muted-foreground">(weasis|ohif)</span></p>
                <p><span className="text-primary">OHIF_URL</span>=http://your-ohif <span className="text-muted-foreground">(optional)</span></p>
              </div>
              <p className="text-xs text-amber-700 mt-3">
                Supports Orthanc DICOM server. Weasis and OHIF viewer integration included.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="PACS Viewer"
        subtitle="DICOM Medical Imaging — Orthanc"
        actions={
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${health?.connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {health?.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {health?.connected ? "Connected" : "Disconnected"}
            </div>
            <Button size="sm" variant="outline" onClick={() => { refetch(); refetchHealth(); }}>
              <RefreshCw size={14} className="mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="px-6 space-y-4">
        {!health?.connected && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
            <WifiOff size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-sm">Cannot connect to PACS server</p>
              <p className="text-xs text-red-700 mt-0.5">
                Verify the Orthanc server is running at <code className="font-mono">{config.url}</code>
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="studies">
          <TabsList>
            <TabsTrigger value="studies">Studies</TabsTrigger>
            {selectedStudy && <TabsTrigger value="detail">Study Detail</TabsTrigger>}
            <TabsTrigger value="about">About PACS</TabsTrigger>
          </TabsList>

          {/* ── Studies Tab ── */}
          <TabsContent value="studies" className="space-y-4 mt-4">
            <div className="flex gap-3 flex-wrap items-center">
              <div className="relative flex-1 min-w-[240px] max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by patient name or ID…"
                  className="pl-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <span className="text-sm text-muted-foreground">{studies.length} studies</span>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
              </div>
            ) : studies.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Monitor size={40} className="mx-auto mb-3 opacity-30" />
                {health?.connected ? "No DICOM studies found in this PACS server" : "Connect to PACS server to view studies"}
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Patient</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Study</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Date</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Series</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studies.map(study => (
                      <tr key={study.ID} className="border-b border-card-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-sm">{formatPatientName(study.PatientMainDicomTags?.PatientName)}</p>
                          <p className="text-xs text-muted-foreground">{study.PatientMainDicomTags?.PatientID || "—"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm max-w-[200px] truncate">{study.MainDicomTags?.StudyDescription || "No description"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{study.MainDicomTags?.AccessionNumber || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-sm">
                          {formatDicomDate(study.MainDicomTags?.StudyDate)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-sm font-medium">
                            <Layers size={13} className="text-muted-foreground" /> {study.Series?.length ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setSelectedStudy(study)}
                            >
                              <Eye size={12} className="mr-1" /> Details
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openInWeasis(study)}
                            >
                              <PlayCircle size={12} className="mr-1" /> View
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Study Detail Tab ── */}
          {selectedStudy && (
            <TabsContent value="detail" className="space-y-5 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-base">{formatPatientName(selectedStudy.PatientMainDicomTags?.PatientName)}</h2>
                  <p className="text-sm text-muted-foreground">{selectedStudy.MainDicomTags?.StudyDescription || "Study"} · {formatDicomDate(selectedStudy.MainDicomTags?.StudyDate)}</p>
                </div>
                <Button onClick={() => openInWeasis(selectedStudy)}>
                  <PlayCircle size={14} className="mr-1.5" /> Open in Viewer
                </Button>
              </div>

              {/* Study metadata */}
              <div className="bg-card border border-card-border rounded-xl p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Patient ID</p>
                  <p className="mt-1 font-medium font-mono">{selectedStudy.PatientMainDicomTags?.PatientID || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Birth Date</p>
                  <p className="mt-1 font-medium">{formatDicomDate(selectedStudy.PatientMainDicomTags?.PatientBirthDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Gender</p>
                  <p className="mt-1 font-medium capitalize">{selectedStudy.PatientMainDicomTags?.PatientSex || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Accession #</p>
                  <p className="mt-1 font-medium font-mono">{selectedStudy.MainDicomTags?.AccessionNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Referring Physician</p>
                  <p className="mt-1 font-medium">{formatPatientName(selectedStudy.MainDicomTags?.ReferringPhysicianName)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Institution</p>
                  <p className="mt-1 font-medium">{selectedStudy.MainDicomTags?.InstitutionName || "—"}</p>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Study Instance UID</p>
                  <p className="mt-1 font-mono text-xs break-all">{selectedStudy.MainDicomTags?.StudyInstanceUID || "—"}</p>
                </div>
              </div>

              {/* Series */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Series ({series.length})</h3>
                {seriesLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />)}
                  </div>
                ) : series.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No series found</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {series.map(s => {
                      const modality = s.MainDicomTags?.Modality || "??";
                      const colorCls = MODALITY_COLORS[modality] || "bg-gray-100 text-gray-700";
                      return (
                        <div key={s.ID} className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <Badge className={`${colorCls} text-xs font-bold`}>{modality}</Badge>
                            <span className="text-xs text-muted-foreground">{s.Instances?.length ?? 0} instances</span>
                          </div>
                          <p className="font-medium text-sm">{s.MainDicomTags?.SeriesDescription || "Series"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Series #{s.MainDicomTags?.SeriesNumber || "—"} · {s.MainDicomTags?.BodyPartExamined || ""}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDicomDate(s.MainDicomTags?.SeriesDate)}</p>
                          {/* Instance thumbnail preview (first instance) */}
                          {s.Instances?.[0] && (
                            <div className="mt-3 flex items-center justify-center bg-muted/40 rounded-lg h-24 overflow-hidden">
                              <img
                                src={`/api/pacs/instances/${s.Instances[0]}/preview`}
                                alt="DICOM preview"
                                className="max-h-24 object-contain"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                  (e.target as HTMLImageElement).parentElement!.innerHTML =
                                    `<div class="text-xs text-muted-foreground flex items-center gap-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-6-6L5 21"/></svg> Preview unavailable</div>`;
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {/* ── About Tab ── */}
          <TabsContent value="about" className="mt-4">
            <div className="max-w-2xl space-y-4">
              <div className="bg-card border border-card-border rounded-xl p-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Monitor size={18} className="text-primary" /> PACS Integration
                </h3>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-[140px]">Server Type:</span>
                    Orthanc DICOM Server
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-[140px]">Server URL:</span>
                    <code className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{config.url || "Not configured"}</code>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-[140px]">Auth:</span>
                    {config.hasCredentials ? "Credentials configured" : "No authentication"}
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-[140px]">Viewer:</span>
                    {config.viewerType === "ohif" && config.ohifUrl ? "OHIF Viewer (Web)" : "Weasis (Desktop)"}
                  </div>
                  <div className="flex gap-2">
                    <span className="font-medium text-foreground min-w-[140px]">Status:</span>
                    <span className={health?.connected ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                      {health?.connected ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-800">
                <p className="font-semibold mb-2">Weasis Viewer Setup</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Download Weasis from <strong>weasis.org</strong></li>
                  <li>Install and register the <code>weasis://</code> protocol handler</li>
                  <li>Click "Open in Viewer" on any study to launch Weasis</li>
                  <li>Weasis will automatically fetch DICOM data from your PACS</li>
                </ol>
              </div>

              {config.ohifUrl && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-sm text-purple-800">
                  <p className="font-semibold mb-1">OHIF Web Viewer</p>
                  <p className="text-xs">OHIF viewer is configured at: <code className="font-mono">{config.ohifUrl}</code></p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Viewer Launch Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor size={16} className="text-primary" /> Open DICOM Study
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose how to view this DICOM study:</p>

            {weasisUrls && (
              <>
                <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Weasis Desktop Viewer</p>
                    <p className="text-xs text-muted-foreground mb-2">Opens the study in Weasis (must be installed)</p>
                    <Button
                      className="w-full"
                      onClick={() => {
                        window.open(weasisUrls.weasisUrl, "_blank");
                      }}
                    >
                      <PlayCircle size={15} className="mr-2" /> Launch in Weasis
                    </Button>
                  </div>
                </div>

                {weasisUrls.orthancViewerUrl && (
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Orthanc Built-in Explorer</p>
                    <p className="text-xs text-muted-foreground mb-2">Opens Orthanc's built-in web viewer (requires direct server access)</p>
                    <Button variant="outline" className="w-full" onClick={() => window.open(weasisUrls.orthancViewerUrl, "_blank")}>
                      <ExternalLink size={14} className="mr-2" /> Open Orthanc Explorer
                    </Button>
                  </div>
                )}

                {weasisUrls.ohifUrl && (
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">OHIF Web Viewer</p>
                    <p className="text-xs text-muted-foreground mb-2">Opens study in OHIF browser-based DICOM viewer</p>
                    <Button variant="outline" className="w-full" onClick={() => window.open(weasisUrls.ohifUrl!, "_blank")}>
                      <ExternalLink size={14} className="mr-2" /> Open in OHIF
                    </Button>
                  </div>
                )}

                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Study Instance UID</p>
                  <p className="font-mono text-xs break-all text-muted-foreground">{weasisUrls.studyInstanceUID}</p>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
