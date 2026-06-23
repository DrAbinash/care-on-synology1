import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Save, RefreshCw, AlertTriangle, CheckCircle2,
  Send, Eye, FileCode, Settings, BookOpen, Network,
  Info, ChevronDown, ChevronUp,
} from "lucide-react";

interface Hl7Settings {
  id?: number;
  isEnabled: boolean;
  sendingFacility: string;
  receivingFacility: string;
  hl7Version: string;
  enabledMessageTypes: string;
  inboundEndpointSecret: string;
  notes: string;
}

interface Hl7Message {
  id: number;
  direction: string;
  messageType: string;
  sendingFacility: string | null;
  patientId: string | null;
  accessionNumber: string | null;
  messageControlId: string | null;
  status: string;
  rawMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const MESSAGE_TYPES = ["ADT", "ORM", "ORU", "ACK", "QBP", "RSP"];
const HL7_VERSIONS = ["2.3", "2.3.1", "2.4", "2.5", "2.5.1", "2.6"];

const STATUS_COLORS: Record<string, string> = {
  received: "bg-blue-100 text-blue-800",
  processed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  ignored: "bg-gray-100 text-gray-600",
};

export default function Hl7Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"settings" | "messages" | "docs">("settings");
  const [expandedMsg, setExpandedMsg] = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<Hl7Settings>({
    queryKey: ["hl7-settings"],
    queryFn: () => api.get("/api/radiology/hl7/settings"),
  });

  const [form, setForm] = useState<Hl7Settings>({
    isEnabled: false,
    sendingFacility: "",
    receivingFacility: "",
    hl7Version: "2.5",
    enabledMessageTypes: "ADT,ORM,ORU",
    inboundEndpointSecret: "",
    notes: "",
  });

  const [hydrated, setHydrated] = useState(false);
  if (settings && !hydrated) {
    setHydrated(true);
    setForm({ ...form, ...settings });
  }

  const { data: messages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<Hl7Message[]>({
    queryKey: ["hl7-messages"],
    queryFn: () => api.get("/api/radiology/hl7/messages?limit=50"),
    enabled: activeTab === "messages",
  });

  const saveMutation = useMutation({
    mutationFn: (data: Hl7Settings) => api.put("/api/radiology/hl7/settings", data),
    onSuccess: () => { toast({ title: "HL7 settings saved" }); void queryClient.invalidateQueries({ queryKey: ["hl7-settings"] }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>("/api/radiology/hl7/test", {}),
    onSuccess: (r) => toast({ title: r.success ? "HL7 test passed" : "HL7 test failed", description: r.message, variant: r.success ? "default" : "destructive" }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const toggleMsgType = (type: string) => {
    const current = form.enabledMessageTypes.split(",").filter(Boolean);
    const updated = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    setForm((f) => ({ ...f, enabledMessageTypes: updated.join(",") }));
  };

  const TABS = [
    { id: "settings" as const, icon: Settings, label: "Settings" },
    { id: "messages" as const, icon: FileCode, label: "Messages" },
    { id: "docs" as const, icon: BookOpen, label: "Documentation" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="HL7 Integration"
        subtitle="HL7 v2 message handling for HIS/RIS system integration — ADT, ORM (orders), ORU (results)"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !form.isEnabled}>
              {testMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              Test Connection
            </Button>
            <Button className="gap-2" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              Save Settings
            </Button>
          </div>
        }
      />

      {/* HL7 master toggle */}
      <div className={`rounded-xl border p-5 flex items-center justify-between ${form.isEnabled ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800" : "bg-muted/30"}`}>
        <div className="flex items-center gap-3">
          <Network size={22} className={form.isEnabled ? "text-green-600" : "text-muted-foreground"} />
          <div>
            <p className="font-semibold text-sm">{form.isEnabled ? "HL7 Integration ENABLED" : "HL7 Integration DISABLED"}</p>
            <p className="text-xs text-muted-foreground">Enables the inbound HL7 endpoint and message logging</p>
          </div>
        </div>
        <div className={`relative w-12 h-6 rounded-full cursor-pointer transition-colors ${form.isEnabled ? "bg-green-500" : "bg-muted-foreground/30"}`}
          onClick={() => setForm((f) => ({ ...f, isEnabled: !f.isEnabled }))}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isEnabled ? "translate-x-7" : "translate-x-1"}`} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${activeTab === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* ── Settings Tab ── */}
      {activeTab === "settings" && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Facility Configuration</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Sending Facility (MSH-4)</label>
                <input value={form.sendingFacility} onChange={(e) => setForm((f) => ({ ...f, sendingFacility: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" placeholder="e.g. CARE_DIAGNOSTICS" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Receiving Facility (MSH-6)</label>
                <input value={form.receivingFacility} onChange={(e) => setForm((f) => ({ ...f, receivingFacility: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" placeholder="e.g. HIS_SYSTEM" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">HL7 Version</label>
                <select value={form.hl7Version} onChange={(e) => setForm((f) => ({ ...f, hl7Version: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
                  {HL7_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Enabled Message Types</label>
              <div className="flex flex-wrap gap-2">
                {MESSAGE_TYPES.map((t) => {
                  const enabled = form.enabledMessageTypes.split(",").includes(t);
                  return (
                    <button key={t} onClick={() => toggleMsgType(t)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${enabled ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50"}`}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Inbound Endpoint Secret</label>
              <div className="flex gap-2">
                <input type={showSecret ? "text" : "password"} value={form.inboundEndpointSecret}
                  onChange={(e) => setForm((f) => ({ ...f, inboundEndpointSecret: e.target.value }))}
                  className="flex-1 h-9 px-3 text-sm rounded-lg border bg-background font-mono"
                  placeholder="Bearer token for POST /api/internal/hl7/inbound" />
                <Button variant="outline" size="sm" onClick={() => setShowSecret(!showSecret)}>
                  <Eye size={14} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Sending HIS must include this as "Authorization: Bearer &lt;secret&gt;" on the inbound endpoint.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full p-2 text-sm rounded-lg border bg-background resize-none" placeholder="Integration notes, vendor contact, etc." />
            </div>
          </div>

          {/* Inbound endpoint info */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">Inbound Endpoint</h3>
            <div className="flex gap-2 items-center">
              <code className="text-xs bg-muted px-2 py-1 rounded flex-1">POST {window.location.origin}/api/internal/hl7/inbound</code>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/api/internal/hl7/inbound`); toast({ title: "Copied" }); }}>
                <CheckCircle2 size={10} /> Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Plain HL7 v2 ER7 (pipe-delimited) in request body. Content-Type: text/plain or application/hl7-v2+er7.</p>
          </div>
        </div>
      )}

      {/* ── Messages Tab ── */}
      {activeTab === "messages" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Recent HL7 messages (last 50)</p>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => void refetchMessages()}>
              <RefreshCw size={12} /> Refresh
            </Button>
          </div>

          {messagesLoading && <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-muted-foreground" /></div>}

          {!messagesLoading && messages.length === 0 && (
            <div className="rounded-xl border-2 border-dashed p-8 text-center text-muted-foreground text-sm">
              No HL7 messages received yet.{form.isEnabled ? " Waiting for inbound messages." : " Enable HL7 integration above."}
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="rounded-xl border bg-card overflow-hidden">
              <div className="p-4 flex items-center gap-3">
                <Badge variant="outline" className="shrink-0 font-mono">{msg.messageType}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[msg.status] ?? "bg-muted text-muted-foreground"}`}>{msg.status}</span>
                    <span className="text-[10px] text-muted-foreground">{msg.direction}</span>
                    {msg.patientId && <span className="text-xs">PT: {msg.patientId}</span>}
                    {msg.accessionNumber && <span className="text-xs font-mono">ACC: {msg.accessionNumber}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{new Date(msg.createdAt).toLocaleString()}</p>
                </div>
                <button onClick={() => setExpandedMsg(expandedMsg === msg.id ? null : msg.id)}>
                  {expandedMsg === msg.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {expandedMsg === msg.id && msg.rawMessage && (
                <div className="border-t bg-muted/20 p-3">
                  <pre className="text-[10px] font-mono whitespace-pre-wrap overflow-x-auto text-muted-foreground">{msg.rawMessage}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Documentation Tab ── */}
      {activeTab === "docs" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Info size={14} /> HL7 Integration Guide</h3>
            <div className="prose-sm space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">What is HL7 v2?</strong> Health Level 7 version 2 is a healthcare messaging standard used to exchange clinical and administrative data between HIS, RIS, PACS, and LIS systems.</p>
              <div className="space-y-2">
                <p className="font-semibold text-foreground">Supported Message Types</p>
                {[
                  ["ADT", "Admit, Discharge, Transfer — patient demographic updates"],
                  ["ORM", "Order Message — new radiology/lab orders from HIS"],
                  ["ORU", "Observation Result — report delivery back to HIS"],
                ].map(([type, desc]) => (
                  <div key={type} className="flex gap-3 p-2 rounded bg-muted/30">
                    <code className="w-10 shrink-0 font-mono font-bold text-xs">{type}</code>
                    <span className="text-xs">{desc}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 text-xs">
                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                <p>This is a <strong>foundation implementation</strong>. Messages are received, logged, and acknowledged. Full ADT patient sync and ORM order auto-creation require custom configuration. Contact your HIS vendor for the HL7 interface specification.</p>
              </div>
              <p className="font-semibold text-foreground">Integration Steps</p>
              <ol className="space-y-1 text-xs list-decimal list-inside">
                <li>Enable HL7 integration and set facility codes matching your HIS.</li>
                <li>Generate or set an inbound endpoint secret.</li>
                <li>Provide your HIS vendor with the inbound endpoint URL and bearer token.</li>
                <li>Configure your HIS to send ADT, ORM messages to this endpoint.</li>
                <li>Verify messages appear in the Messages tab.</li>
                <li>Configure ORU outbound to push verified reports back to HIS (future).</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
