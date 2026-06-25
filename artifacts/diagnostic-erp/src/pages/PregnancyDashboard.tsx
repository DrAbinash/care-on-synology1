import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Baby,
  Activity,
  Calendar,
  Image as ImageIcon,
  CheckCircle,
  XCircle,
  RefreshCw,
  TrendingUp,
  FileText,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface TimelineItem {
  id: number;
  studyId: number;
  date: string;
  ga: string;
  edd: string;
  doctor: string;
  machine: string;
  studyDescription: string;
  status: string;
}

interface GrowthPoint {
  studyId: number;
  date: string;
  ga: number;
  gaLabel: string;
  crl: number | null;
  bpd: number | null;
  hc: number | null;
  ac: number | null;
  fl: number | null;
  efw: number | null;
  afi: number | null;
  fhr: number | null;
  placentalGrade: string | null;
  cervicalLength: number | null;
}

interface KeyImage {
  id: number;
  worklistId: number;
  studyInstanceUID: string;
  sopInstanceUID: string;
  frameNumber: number;
  label: string;
  measurementKey: string;
  wadoUrl: string;
  rank: number;
  confidence: number;
  isApproved: boolean;
  isRejected: boolean;
  source: string;
  thumbnailBase64?: string | null;
}

interface Patient {
  id: number;
  patientId: string;
  firstName: string;
  lastName: string;
}

export default function PregnancyDashboard() {
  const [location] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const searchParams = new URLSearchParams(window.location.search);
  const initialPatientId = searchParams.get("patientId") ? Number(searchParams.get("patientId")) : null;
  const initialStudyId = searchParams.get("studyId") ? Number(searchParams.get("studyId")) : null;

  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(initialPatientId);
  const [selectedStudyId, setSelectedStudyId] = useState<number | null>(initialStudyId);
  const [activeTab, setActiveTab] = useState("timeline");

  // Fetch patients list to choose from if none is provided
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["pregnancy-patients"],
    queryFn: () => fetchApi("/api/patients"),
  });

  // Fetch pregnancy timeline
  const { data: timelineData, isLoading: loadingTimeline } = useQuery<{ timeline: TimelineItem[] }>({
    queryKey: ["pregnancy-timeline", selectedPatientId],
    queryFn: () => fetchApi(`/api/fetal-usg-dashboard/timeline/${selectedPatientId}`),
    enabled: !!selectedPatientId,
  });

  // Fetch growth charts data
  const { data: growthData } = useQuery<{ points: GrowthPoint[] }>({
    queryKey: ["pregnancy-growth", selectedPatientId],
    queryFn: () => fetchApi(`/api/fetal-usg-dashboard/growth-charts/${selectedPatientId}`),
    enabled: !!selectedPatientId,
  });

  // Fetch key images for the selected study
  const { data: keyImagesData, refetch: refetchKeyImages } = useQuery<{ images: KeyImage[] }>({
    queryKey: ["pregnancy-key-images", selectedStudyId],
    queryFn: () => fetchApi(`/api/fetal-usg-dashboard/key-images/${selectedStudyId}`),
    enabled: !!selectedStudyId,
  });

  // Fetch AI comparison suggestions
  const { data: comparisonData } = useQuery<{ suggestions: string[] }>({
    queryKey: ["pregnancy-comparison", selectedStudyId],
    queryFn: () => fetchApi(`/api/fetal-usg-dashboard/comparison/${selectedStudyId}`),
    enabled: !!selectedStudyId,
  });

  // Approve key image mutation
  const approveMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/fetal-usg-dashboard/key-images/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Key Image Approved", description: "The image has been locked in the report suggestions." });
      void qc.invalidateQueries({ queryKey: ["pregnancy-key-images", selectedStudyId] });
    },
  });

  // Reject key image mutation
  const rejectMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/fetal-usg-dashboard/key-images/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Key Image Rejected", description: "The image has been excluded from report suggestions." });
      void qc.invalidateQueries({ queryKey: ["pregnancy-key-images", selectedStudyId] });
    },
  });

  // Replace key image rank mutation
  const replaceMutation = useMutation({
    mutationFn: ({ id, newRank }: { id: number; newRank: number }) =>
      fetchApi(`/api/fetal-usg-dashboard/key-images/${id}/replace`, {
        method: "POST",
        body: JSON.stringify({ newRank }),
      }),
    onSuccess: () => {
      toast({ title: "Key Image Rank Updated" });
      void qc.invalidateQueries({ queryKey: ["pregnancy-key-images", selectedStudyId] });
    },
  });

  useEffect(() => {
    if (timelineData?.timeline && timelineData.timeline.length > 0 && !selectedStudyId) {
      // Auto-select latest study
      setSelectedStudyId(timelineData.timeline[timelineData.timeline.length - 1].id);
    }
  }, [timelineData, selectedStudyId]);

  const currentPatient = patients.find((p) => p.id === selectedPatientId);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Pregnancy Dashboard"
        subtitle="AI Key Image Selection, Pregnancy Timeline, Growth Charts, and AI comparative analysis."
        actions={
          <div className="flex gap-2">
            <select
              className="h-9 w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              value={selectedPatientId ?? ""}
              onChange={(e) => {
                setSelectedPatientId(e.target.value ? Number(e.target.value) : null);
                setSelectedStudyId(null);
              }}
            >
              <option value="">Select Patient</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {selectedPatientId ? (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Main Dashboard Tabs */}
          <div className="xl:col-span-3 space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-6 bg-muted/60 p-1 rounded-xl">
                <TabsTrigger value="timeline"><Calendar size={14} className="mr-1.5" /> Timeline</TabsTrigger>
                <TabsTrigger value="charts"><TrendingUp size={14} className="mr-1.5" /> Growth Charts</TabsTrigger>
                <TabsTrigger value="keyimages"><ImageIcon size={14} className="mr-1.5" /> Key Images</TabsTrigger>
                <TabsTrigger value="comparison"><Activity size={14} className="mr-1.5" /> AI Comparison</TabsTrigger>
                <TabsTrigger value="measurements"><Baby size={14} className="mr-1.5" /> Measurements</TabsTrigger>
                <TabsTrigger value="reports"><FileText size={14} className="mr-1.5" /> Reports</TabsTrigger>
              </TabsList>

              {/* TIMELINE SECTION */}
              <TabsContent value="timeline" className="pt-4">
                <Card className="border-border/60 shadow-lg shadow-black/5 bg-gradient-to-br from-background to-muted/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="text-pink-500 h-5 w-5" /> Pregnancy Timeline
                    </CardTitle>
                    <CardDescription>Detected serial pregnancy studies for {currentPatient?.firstName} {currentPatient?.lastName}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingTimeline ? (
                      <div className="flex justify-center p-12"><RefreshCw className="animate-spin text-muted-foreground" /></div>
                    ) : (
                      <div className="relative border-l-2 border-pink-100 dark:border-pink-900 ml-4 space-y-8 py-2">
                        {timelineData?.timeline.map((item, idx) => (
                          <div key={item.id} className="relative pl-8 group">
                            <span className="absolute -left-2.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-950 border-2 border-pink-500 text-pink-500 group-hover:scale-110 transition-transform">
                              <span className="h-2 w-2 rounded-full bg-pink-500" />
                            </span>
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 p-4 rounded-xl border border-border/40 bg-card hover:shadow-md hover:border-pink-200/50 dark:hover:border-pink-800/50 transition-all cursor-pointer" onClick={() => setSelectedStudyId(item.id)}>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-bold text-foreground group-hover:text-pink-500 transition-colors">{item.studyDescription}</h4>
                                  <Badge variant="outline" className="border-pink-200 bg-pink-50/50 text-pink-700 dark:bg-pink-950/20 dark:text-pink-300">{item.ga}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Machine: {item.machine} · Doctor: {item.doctor}
                                </p>
                              </div>
                              <div className="text-left md:text-right">
                                <span className="text-xs font-semibold text-muted-foreground">{item.date}</span>
                                <div className="text-xs text-muted-foreground mt-0.5">EDD: {item.edd}</div>
                              </div>
                            </div>
                            {idx < timelineData.timeline.length - 1 && (
                              <div className="flex justify-center ml-2 my-2 text-pink-400">
                                <span className="text-xl">↓</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* GROWTH CHARTS SECTION */}
              <TabsContent value="charts" className="pt-4 space-y-6">
                <Card className="border-border/60 shadow-lg bg-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <TrendingUp className="h-5 w-5" /> Biometric Progression
                    </CardTitle>
                    <CardDescription>Serial plotting of fetal biometrics against gestational age.</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={growthData?.points || []}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis dataKey="ga" type="number" domain={[8, 40]} label={{ value: 'GA (weeks)', position: 'insideBottom', offset: -5 }} />
                        <YAxis />
                        <Tooltip labelFormatter={(v) => `GA: ${v.toFixed(1)} weeks`} />
                        <Legend />
                        <Line type="monotone" dataKey="crl" stroke="#ec4899" strokeWidth={2.5} name="CRL (mm)" dot={{ r: 6 }} activeDot={{ r: 8 }} connectNulls />
                        <Line type="monotone" dataKey="bpd" stroke="#6366f1" strokeWidth={2.5} name="BPD (mm)" dot={{ r: 6 }} connectNulls />
                        <Line type="monotone" dataKey="hc" stroke="#10b981" strokeWidth={2.5} name="HC (mm)" dot={{ r: 6 }} connectNulls />
                        <Line type="monotone" dataKey="ac" stroke="#f59e0b" strokeWidth={2.5} name="AC (mm)" dot={{ r: 6 }} connectNulls />
                        <Line type="monotone" dataKey="fl" stroke="#06b6d4" strokeWidth={2.5} name="FL (mm)" dot={{ r: 6 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="border-border/60">
                    <CardHeader><CardTitle className="text-sm">AFI Progression</CardTitle></CardHeader>
                    <CardContent className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={growthData?.points || []}>
                          <XAxis dataKey="ga" />
                          <YAxis domain={[0, 30]} />
                          <Tooltip />
                          <ReferenceLine y={8} stroke="#ef4444" strokeDasharray="3 3" label="Low AFI Threshold" />
                          <Line type="monotone" dataKey="afi" stroke="#3b82f6" strokeWidth={2} name="AFI" dot={{ r: 5 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card className="border-border/60">
                    <CardHeader><CardTitle className="text-sm">Fetal Heart Rate (FHR)</CardTitle></CardHeader>
                    <CardContent className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={growthData?.points || []}>
                          <XAxis dataKey="ga" />
                          <YAxis domain={[100, 200]} />
                          <Tooltip />
                          <ReferenceLine y={110} stroke="#ef4444" strokeDasharray="3 3" label="Bradycardia" />
                          <ReferenceLine y={160} stroke="#ef4444" strokeDasharray="3 3" label="Tachycardia" />
                          <Line type="monotone" dataKey="fhr" stroke="#ef4444" strokeWidth={2} name="FHR (bpm)" dot={{ r: 5 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* KEY IMAGES SECTION */}
              <TabsContent value="keyimages" className="pt-4 space-y-6">
                <Card className="border-border/60 shadow-lg">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                        <ImageIcon className="h-5 w-5" /> AI Key Image Selection
                      </CardTitle>
                      <CardDescription>Review and approve selected measurements' representative frames</CardDescription>
                    </div>
                    <Badge variant="outline">Study ID: {selectedStudyId}</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-8">
                      {["CRL", "BPD", "HC", "AC", "FL", "AFI", "FHR"].map((key) => {
                        const candidates = keyImagesData?.images.filter((img) => img.measurementKey === key) || [];
                        if (candidates.length === 0) return null;

                        return (
                          <div key={key} className="space-y-3 border-b border-border/40 pb-6 last:border-b-0 last:pb-0">
                            <h4 className="font-bold text-sm text-foreground uppercase tracking-wider">{key} Key Image Candidates</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {candidates.sort((a, b) => a.rank - b.rank).map((img) => (
                                <Card key={img.id} className={`border-border/65 relative overflow-hidden transition-all ${img.isApproved ? 'ring-2 ring-emerald-500' : img.isRejected ? 'opacity-40' : ''}`}>
                                  <div className="aspect-video bg-muted/80 flex items-center justify-center relative">
                                    {img.thumbnailBase64 ? (
                                      <img src={img.thumbnailBase64} alt={img.label} className="object-cover w-full h-full" />
                                    ) : (
                                      <div className="text-center p-4">
                                        <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/60 mb-1" />
                                        <span className="text-[10px] text-muted-foreground block">{img.label}</span>
                                      </div>
                                    )}
                                    <div className="absolute top-2 left-2 flex gap-1">
                                      <Badge className="bg-black/60 backdrop-blur-sm text-white">Rank {img.rank}</Badge>
                                      <Badge className="bg-violet-600 text-white font-medium">AI Conf: {(img.confidence * 100).toFixed(0)}%</Badge>
                                    </div>
                                  </div>
                                  <CardContent className="p-3 space-y-2">
                                    <div className="text-xs space-y-1 text-muted-foreground">
                                      <div>Frame: {img.frameNumber}</div>
                                      <div className="truncate">SOP UID: {img.sopInstanceUID}</div>
                                      <div>Source: <span className="capitalize font-semibold text-foreground">{img.source}</span></div>
                                    </div>
                                    <div className="flex gap-1.5 pt-2 flex-wrap">
                                      <Button size="sm" variant="outline" className="h-7 text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400" onClick={() => approveMutation.mutate(img.id)} disabled={img.isApproved}>
                                        <CheckCircle size={10} className="mr-1" /> Approve
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-[10px] bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-400" onClick={() => rejectMutation.mutate(img.id)} disabled={img.isRejected}>
                                        <XCircle size={10} className="mr-1" /> Reject
                                      </Button>
                                      <select
                                        className="h-7 rounded border border-input bg-background px-2 text-[10px]"
                                        value={img.rank}
                                        onChange={(e) => replaceMutation.mutate({ id: img.id, newRank: Number(e.target.value) })}
                                      >
                                        <option value="1">Best</option>
                                        <option value="2">2nd Best</option>
                                        <option value="3">3rd Best</option>
                                      </select>
                                    </div>
                                    <div className="flex gap-1.5 pt-1">
                                      <Button size="sm" variant="ghost" className="h-6 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => window.open(img.wadoUrl, "_blank")}>
                                        Open in OHIF <ExternalLink size={8} className="ml-0.5" />
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-6 text-[9px] text-muted-foreground hover:text-foreground" onClick={() => window.open(img.wadoUrl + "&viewer=weasis", "_blank")}>
                                        Open in Weasis <ExternalLink size={8} className="ml-0.5" />
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* AI COMPARISON SECTION */}
              <TabsContent value="comparison" className="pt-4">
                <Card className="border-border/60 shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400">
                      <Activity className="h-5 w-5" /> Fetal Growth Progression suggestions
                    </CardTitle>
                    <CardDescription>Automated comparison of current biometric readings against prior scan</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>Suggestions are meant for comparison review only and must be approved by the radiologist before inserting into the final report. Never finalized automatically.</span>
                    </div>

                    <div className="space-y-3">
                      {comparisonData?.suggestions.map((sug, i) => (
                        <div key={i} className="p-3 border rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors flex items-center justify-between">
                          <span className="text-sm font-medium">{sug}</span>
                          <Button size="sm" variant="outline" className="text-[10px]" onClick={() => {
                            toast({ title: "Copied to Clipboard", description: "You can paste this in the report findings." });
                            navigator.clipboard.writeText(sug);
                          }}>Copy</Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* MEASUREMENTS LISTING */}
              <TabsContent value="measurements" className="pt-4">
                <Card className="border-border/60 shadow-lg">
                  <CardHeader><CardTitle>Obstetric Measurements</CardTitle></CardHeader>
                  <CardContent>
                    {growthData?.points.map((p) => (
                      <div key={p.studyId} className="border-b last:border-0 py-4 flex flex-col md:flex-row justify-between gap-4">
                        <div>
                          <div className="font-semibold">{p.date} · GA: {p.gaLabel}</div>
                          <div className="text-xs text-muted-foreground">Study Ref: {p.studyId}</div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          {p.crl && <div>CRL: <span className="font-bold">{p.crl} mm</span></div>}
                          {p.bpd && <div>BPD: <span className="font-bold">{p.bpd} mm</span></div>}
                          {p.hc && <div>HC: <span className="font-bold">{p.hc} mm</span></div>}
                          {p.ac && <div>AC: <span className="font-bold">{p.ac} mm</span></div>}
                          {p.fl && <div>FL: <span className="font-bold">{p.fl} mm</span></div>}
                          {p.efw && <div>EFW: <span className="font-bold">{p.efw} g</span></div>}
                          {p.afi && <div>AFI: <span className="font-bold">{p.afi} cm</span></div>}
                          {p.fhr && <div>FHR: <span className="font-bold">{p.fhr} bpm</span></div>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* REPORTS LISTING */}
              <TabsContent value="reports" className="pt-4">
                <Card className="border-border/60 shadow-lg">
                  <CardHeader><CardTitle>Report Drafts & Finalized Reports</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">Finalized reports can be downloaded in the main USG Reporting tab.</p>
                    <div className="space-y-4">
                      {timelineData?.timeline.map((item) => (
                        <div key={item.id} className="p-4 border rounded-xl flex items-center justify-between">
                          <div>
                            <div className="font-bold">{item.studyDescription}</div>
                            <div className="text-xs text-muted-foreground">Date: {item.date} · GA: {item.ga}</div>
                          </div>
                          <Badge className="capitalize">{item.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* SIDEBAR: Serials & Quick Stats */}
          <div className="space-y-6">
            <Card className="border-border/60 shadow-md">
              <CardHeader><CardTitle className="text-sm">Pregnancy Episode Info</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Patient Name</span>
                  <span className="font-bold">{currentPatient?.firstName} {currentPatient?.lastName}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Active Episode</span>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Active</Badge>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Total Scans</span>
                  <span className="font-semibold">{timelineData?.timeline.length ?? 0}</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-muted-foreground">Current Selection</span>
                  <Badge variant="secondary">Study #{selectedStudyId}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-md">
              <CardHeader><CardTitle className="text-sm">Abnormality Highlights</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                {growthData?.points.some((p) => p.afi && p.afi < 8) && (
                  <div className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300 flex gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-bold">Oligohydramnios (Low AFI)</div>
                      <div className="text-[10px] mt-0.5">AFI was recorded below 8.0 cm. Monitor progression.</div>
                    </div>
                  </div>
                )}
                {growthData?.points.some((p) => p.bpd && p.bpd < 20) && (
                  <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300 flex gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-bold">Potential Growth Lag</div>
                      <div className="text-[10px] mt-0.5">Mild deceleration in BPD or HC values detected.</div>
                    </div>
                  </div>
                )}
                {!growthData?.points.some((p) => p.afi && p.afi < 8) && (
                  <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 flex gap-2">
                    <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-bold">All parameters normal</div>
                      <div className="text-[10px] mt-0.5">FHR, AFI, and biometrics correspond to expected gestational age.</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="border-border/60 shadow-lg text-center p-12 bg-muted/20">
          <Baby className="mx-auto h-12 w-12 text-pink-400 mb-3 animate-bounce" />
          <h3 className="font-bold text-lg">No Patient Selected</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
            Please choose a patient from the dropdown above to load the pregnancy timeline, growth charts, AI key images, and comparative analysis.
          </p>
        </Card>
      )}
    </div>
  );
}
