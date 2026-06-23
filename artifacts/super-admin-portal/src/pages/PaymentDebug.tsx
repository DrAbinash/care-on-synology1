import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, RefreshCw, AlertTriangle, ShieldCheck, Terminal, Shield,
  Eye, EyeOff, Clipboard, Calendar, DollarSign
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface PaymentLog {
  id: number;
  bookingRef: string;
  patientName: string;
  gateway: string;
  amount: string;
  status: string; // initiated | success | failed | refunded
  requestPayload: string | null;
  responsePayload: string | null;
  errorMessage: string | null;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function maskSecrets(jsonStr: string | null): string {
  if (!jsonStr) return "";
  try {
    const obj = JSON.parse(jsonStr);
    const keysToMask = ["key", "salt", "secret", "password", "token", "apikey", "secretkey", "securehash"];
    
    const recurse = (item: any) => {
      if (typeof item !== "object" || item === null) return;
      for (const k of Object.keys(item)) {
        if (typeof item[k] === "string" && keysToMask.some(key => k.toLowerCase().includes(key))) {
          item[k] = item[k].slice(0, 4) + "********" + item[k].slice(-4);
        } else if (typeof item[k] === "object") {
          recurse(item[k]);
        }
      }
    };
    
    recurse(obj);
    return JSON.stringify(obj, null, 2);
  } catch {
    return jsonStr;
  }
}

export default function PaymentDebugScreen({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [selectedLog, setSelectedLog] = useState<PaymentLog | null>(null);
  const [showPayloadSecrets, setShowPayloadSecrets] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery<{ logs: PaymentLog[]; total: number }>({
    queryKey: ["/api/super-admin/payment-logs"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/payment-logs", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load payment logs");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const logs = data?.logs || [];

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Payload copied to clipboard." });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "success":
      case "paid":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Success</Badge>;
      case "failed":
      case "payment_failed":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
      case "initiated":
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Initiated</Badge>;
      default:
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Payment Debug Logs</h1>
              <p className="text-sm text-muted-foreground">Admin payload inspection, request trace, and gateway verification logs.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading || isRefetching}>
            <RefreshCw size={13} className={`mr-1.5 ${(isLoading || isRefetching) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Info card warning about masked secrets */}
        <div className="bg-muted/40 border border-border rounded-xl p-4 flex items-start gap-3">
          <ShieldCheck size={18} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Security Protocol Enforced</p>
            <p className="text-xs text-muted-foreground mt-1">
              All credentials, API keys, merchant keys, hash secrets, and merchant salts are automatically masked inside request and response payloads to prevent credential leakage.
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between text-sm font-medium">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-primary" />
              Trace Logs (Last 200 Transactions)
            </div>
            <span className="text-xs text-muted-foreground">{data?.total ?? 0} logs found</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">ID</TableHead>
                  <TableHead>Booking Ref</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead className="w-[100px] text-right">Payloads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading payment logs…</TableCell></TableRow>
                )}
                {!isLoading && logs.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No payment log traces recorded yet.</TableCell></TableRow>
                )}
                {logs.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedLog(log)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{log.id}</TableCell>
                    <TableCell className="font-mono font-medium">{log.bookingRef}</TableCell>
                    <TableCell>{log.patientName}</TableCell>
                    <TableCell className="capitalize">{log.gateway}</TableCell>
                    <TableCell className="font-semibold">₹{Number(log.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>{statusBadge(log.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }} className="h-8 text-primary">
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Payload dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Terminal size={18} className="text-primary" />
                  Transaction Trace #{selectedLog.id} ({selectedLog.bookingRef})
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 my-2">
                {/* Meta grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-muted/40 rounded-lg text-sm border border-border">
                  <div>
                    <span className="text-xs text-muted-foreground block">Patient Name</span>
                    <strong className="block text-foreground">{selectedLog.patientName}</strong>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Gateway Provider</span>
                    <strong className="block capitalize text-foreground">{selectedLog.gateway}</strong>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Amount</span>
                    <strong className="block text-foreground">₹{Number(selectedLog.amount).toLocaleString("en-IN")}</strong>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Verification Status</span>
                    <div className="mt-0.5">{statusBadge(selectedLog.status)}</div>
                  </div>
                </div>

                {/* Error Banner */}
                {selectedLog.errorMessage && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded-lg flex items-start gap-2 text-xs">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block mb-0.5">Gateway Exception Recorded</span>
                      {selectedLog.errorMessage}
                    </div>
                  </div>
                )}

                {/* Request Payload */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                    <span>INITIATE / VERIFY REQUEST PAYLOAD</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => copyToClipboard(maskSecrets(selectedLog.requestPayload))} className="hover:text-foreground inline-flex items-center gap-1">
                        <Clipboard size={12} /> Copy
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-zinc-950 text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto max-h-48 border border-zinc-800">
                    {maskSecrets(selectedLog.requestPayload)}
                  </pre>
                </div>

                {/* Response Payload */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                    <span>GATEWAY RESPONSE / RAW CALLBACK PAYLOAD</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => copyToClipboard(maskSecrets(selectedLog.responsePayload))} className="hover:text-foreground inline-flex items-center gap-1">
                        <Clipboard size={12} /> Copy
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-zinc-950 text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto max-h-64 border border-zinc-800">
                    {selectedLog.responsePayload ? maskSecrets(selectedLog.responsePayload) : "// No response payload logged"}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-2 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => setSelectedLog(null)}>Close Trace</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
