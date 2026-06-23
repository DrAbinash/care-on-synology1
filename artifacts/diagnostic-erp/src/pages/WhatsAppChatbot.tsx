// =============================================================================
// WhatsApp Chatbot Dashboard
//
// ERP UI for managing WhatsApp conversations, contacts, bot flows,
// templates, message logs, and settings.
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare, Users, LayoutDashboard, FileText, Settings2,
  Phone, Clock, ArrowLeftRight, Send, CheckCircle, AlertCircle,
  Bot, User, X, Check
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Dashboard Tab ──────────────────────────────────────────────────────
function DashboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["wa-dashboard"],
    queryFn: () => api.get("/api/wa-chatbot/dashboard"),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading dashboard...</div>;

  const stats = data as { totalConversations: number; humanConversations: number; totalMessages: number; incomingToday: number; totalContacts: number } | undefined;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Conversations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.totalConversations ?? 0}</div>
          <p className="text-xs text-muted-foreground mt-1">{stats?.humanConversations ?? 0} awaiting human reply</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Messages Today</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.incomingToday ?? 0}</div>
          <p className="text-xs text-muted-foreground mt-1">Incoming messages</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.totalContacts ?? 0}</div>
          <p className="text-xs text-muted-foreground mt-1">Unique WhatsApp numbers</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.totalMessages ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Conversations Tab ───────────────────────────────────────────────────
function ConversationsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["wa-conversations"],
    queryFn: () => api.get("/api/wa-chatbot/conversations?page=1&limit=50"),
  });

  const { data: messages } = useQuery({
    queryKey: ["wa-messages", selectedId],
    queryFn: () => selectedId ? api.get(`/api/wa-chatbot/conversations/${selectedId}/messages`) : Promise.resolve([]),
    enabled: !!selectedId,
  });

  const reply = useMutation({
    mutationFn: (body: { id: number; message: string }) => api.post(`/api/wa-chatbot/conversations/${body.id}/reply`, { message: body.message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-messages", selectedId] });
      setReplyText("");
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => toast({ title: "Failed to send reply", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: (body: { id: number; status: string }) => api.patch(`/api/wa-chatbot/conversations/${body.id}/status`, { status: body.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
  });

  const conversations = (data as { conversations?: Array<{ id: number; phone: string; status: string; contactName?: string; contactType?: string; lastMessageAt?: string; currentFlow?: string }> } | undefined)?.conversations ?? [];

  const statusColor: Record<string, string> = { bot: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", human: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", open: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", closed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-12rem)]">
      {/* Conversation list */}
      <Card className="md:col-span-1 overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Inbox</CardTitle></CardHeader>
        <ScrollArea className="h-[calc(100%-3rem)]">
          <div className="p-2 space-y-1">
            {isLoading && <p className="text-sm text-muted-foreground p-2">Loading...</p>}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn("w-full text-left p-2 rounded-lg transition-colors", selectedId === c.id ? "bg-accent" : "hover:bg-muted")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium">{c.contactName || c.phone}</span>
                  </div>
                  <Badge className={cn("text-xs", statusColor[c.status] || statusColor.bot)}>{c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.currentFlow || "Main menu"}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* Chat pane */}
      <Card className="md:col-span-2 flex flex-col overflow-hidden">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">{selectedId ? "Conversation" : "Select a conversation"}</CardTitle>
          {selectedId && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: selectedId, status: "human" })}>Handover</Button>
              <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: selectedId, status: "bot" })}>Bot</Button>
              <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: selectedId, status: "closed" })}>Close</Button>
            </div>
          )}
        </CardHeader>
        <ScrollArea className="flex-1 p-3">
          {!selectedId && <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a conversation from the inbox</div>}
          <div className="space-y-2">
            {(messages as Array<{ id: number; direction: string; messageText: string; createdAt: string; messageType: string }> | undefined)?.slice().reverse().map((m) => (
              <div key={m.id} className={cn("flex", m.direction === "incoming" ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", m.direction === "incoming" ? "bg-muted" : "bg-primary text-primary-foreground")}>
                  <p>{m.messageText}</p>
                  <p className={cn("text-[10px] mt-1", m.direction === "incoming" ? "text-muted-foreground" : "text-primary-foreground/70")}>
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        {selectedId && (
          <div className="p-2 border-t flex gap-2">
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type a reply..."
              onKeyDown={(e) => { if (e.key === "Enter" && replyText.trim()) reply.mutate({ id: selectedId, message: replyText.trim() }); }}
            />
            <Button onClick={() => reply.mutate({ id: selectedId, message: replyText.trim() })} disabled={!replyText.trim() || reply.isPending}>
              <Send size={14} />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Contacts Tab ──────────────────────────────────────────────────────────────────
function ContactsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["wa-contacts", page],
    queryFn: () => api.get(`/api/wa-chatbot/contacts?page=${page}`),
  });

  const contacts = (data as { contacts?: Array<{ id: number; phone: string; name: string; contactType: string; consentStatus: string; lastInteractionAt: string }>; total?: number } | undefined)?.contacts ?? [];
  const total = (data as { total?: number } | undefined)?.total ?? 0;
  const limit = 50;

  const typeIcon: Record<string, React.ReactNode> = {
    patient: <User size={14} />,
    doctor: <AlertCircle size={14} />,
    staff: <CheckCircle size={14} />,
    admin: <Check size={14} />,
    unknown: <Phone size={14} />,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">WhatsApp Contacts</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page} of {Math.max(1, Math.ceil(total / limit))}</span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr><th className="text-left px-3 py-2">Phone</th><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Consent</th><th className="text-left px-3 py-2">Last Active</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Loading...</td></tr>}
            {contacts.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/50">
                <td className="px-3 py-2 font-mono">{c.phone}</td>
                <td className="px-3 py-2">{c.name || "—"}</td>
                <td className="px-3 py-2"><span className="flex items-center gap-1">{typeIcon[c.contactType] || typeIcon.unknown} {c.contactType}</span></td>
                <td className="px-3 py-2"><Badge variant={c.consentStatus === "granted" ? "default" : c.consentStatus === "denied" ? "destructive" : "outline"}>{c.consentStatus}</Badge></td>
                <td className="px-3 py-2 text-muted-foreground">{c.lastInteractionAt ? new Date(c.lastInteractionAt).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Message Logs Tab ───────────────────────────────────────────────────────
function MessageLogsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["wa-audit-logs", page],
    queryFn: () => api.get(`/api/wa-chatbot/audit-logs?page=${page}&limit=50`),
  });

  const logs = (data as { logs?: Array<{ id: number; action: string; provider: string; phone: string; status: string; details: string; performedBy: string; createdAt: string }>; total?: number } | undefined)?.logs ?? [];
  const total = (data as { total?: number } | undefined)?.total ?? 0;
  const limit = 50;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Audit Logs</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page} of {Math.max(1, Math.ceil(total / limit))}</span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => p + 1)} disabled={page * limit >= total}>Next</Button>
        </div>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr><th className="text-left px-3 py-2">Time</th><th className="text-left px-3 py-2">Action</th><th className="text-left px-3 py-2">Provider</th><th className="text-left px-3 py-2">Phone</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Details</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Loading...</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/50">
                <td className="px-3 py-2 text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-medium">{l.action}</td>
                <td className="px-3 py-2"><Badge variant="outline">{l.provider}</Badge></td>
                <td className="px-3 py-2 font-mono">{l.phone || "—"}</td>
                <td className="px-3 py-2"><Badge variant={l.status === "sent" || l.status === "replied" ? "default" : "destructive"}>{l.status}</Badge></td>
                <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{l.details || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Settings Tab ───────────────────────────────────────────────────────────
function SettingsTab() {
  const providers = ["mock", "meta", "twilio", "gupshup", "wati", "interakt"];
  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader><CardTitle className="text-base">WhatsApp Provider Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
            <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2"><AlertCircle size={15} /> Environment Secrets</h3>
            <p className="text-sm text-amber-800 dark:text-amber-300">These are loaded server-side only and never exposed to the browser:</p>
            <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-2 py-1">
              WHATSAPP_PROVIDER=mock
            </div>
            <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-2 py-1">
              WHATSAPP_ACCESS_TOKEN=your_access_token
            </div>
            <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-2 py-1">
              WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
            </div>
            <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-2 py-1">
              WHATSAPP_VERIFY_TOKEN=your_verify_token
            </div>
            <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-2 py-1">
              WHATSAPP_APP_SECRET=your_app_secret
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">Supported providers: {providers.join(", ")}</p>
          </div>

          <div className="bg-muted rounded-xl p-4 space-y-2">
            <h4 className="font-bold text-sm">Bot Flows Available</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>1. Book Appointment (Pathology / Radiology / OPD)</li>
              <li>2. Check Report Status (by patient mobile or bill)</li>
              <li>3. Download Report (secure link when ready)</li>
              <li>4. Check Bill / Dues (pending amount lookup)</li>
              <li>5. Location (clinic address + phone)</li>
              <li>6. Talk to Staff (human handover)</li>
            </ul>
          </div>

          <div className="bg-muted rounded-xl p-4 space-y-2">
            <h4 className="font-bold text-sm">Admin / Staff Commands</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>TODAY — today's revenue summary</li>
              <li>CASH — cash vs digital collection</li>
              <li>DUES — outstanding bills</li>
              <li>REPORTS — pending vs verified reports</li>
              <li>MY COLLECTION — personal daily collection</li>
              <li>MY PENDING — pending orders</li>
            </ul>
          </div>

          <div className="bg-muted rounded-xl p-4 space-y-2">
            <h4 className="font-bold text-sm">Doctor Commands</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>TODAY PATIENTS — patients referred today</li>
              <li>PENDING REPORTS — pending reports for your patients</li>
              <li>COMMISSION SUMMARY — referral commission overview</li>
            </ul>
          </div>

          <div className="bg-muted rounded-xl p-4 space-y-2">
            <h4 className="font-bold text-sm">Security Features</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Webhook signature verification per provider</li>
              <li>Consent tracking (opt-in / opt-out)</li>
              <li>Role-based command access (admin/staff/doctor/patient)</li>
              <li>Audit logging for every message and action</li>
              <li>Session expiry (30 minutes) with automatic reset</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────────────────
export default function WhatsAppChatbotPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquare size={24} /> WhatsApp Chatbot</h1>
      </div>
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard"><LayoutDashboard size={14} className="mr-1" /> Dashboard</TabsTrigger>
          <TabsTrigger value="conversations"><MessageSquare size={14} className="mr-1" /> Conversations</TabsTrigger>
          <TabsTrigger value="contacts"><Users size={14} className="mr-1" /> Contacts</TabsTrigger>
          <TabsTrigger value="logs"><FileText size={14} className="mr-1" /> Logs</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 size={14} className="mr-1" /> Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-4"><DashboardTab /></TabsContent>
        <TabsContent value="conversations" className="mt-4"><ConversationsTab /></TabsContent>
        <TabsContent value="contacts" className="mt-4"><ContactsTab /></TabsContent>
        <TabsContent value="logs" className="mt-4"><MessageLogsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
