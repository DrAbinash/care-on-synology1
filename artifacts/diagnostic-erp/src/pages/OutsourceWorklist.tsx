import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Truck, CheckCircle, FileUp, Loader2, ArrowRight, ShieldAlert, Barcode, ClipboardList, Filter
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Order = {
  id: number;
  status: string;
  barcode?: string | null;
  sampleType?: string | null;
  patientCharge: string | number;
  outsourceCost: string | number;
  expectedReportTime?: string | null;
  createdAt: string;
  billNumber: string;
  patientName: string;
  patientPhone?: string | null;
  labName: string;
  testName: string;
  labTestCode: string;
};

export default function OutsourceWorklist() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [trackingDetails, setTrackingDetails] = useState("");
  const [remarks, setRemarks] = useState("");

  const [uploadingOrderId, setUploadingOrderId] = useState<number | null>(null);

  // Status Filter Tabs
  const [activeTab, setActiveTab] = useState<"pending" | "dispatched" | "completed" | "all">("pending");

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["outsource-worklist"],
    queryFn: () => api.get<Order[]>("/api/outsourced-labs/orders/worklist"),
  });

  const { data: labs = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get("/api/outsourced-labs"),
  });

  const dispatchMutation = useMutation({
    mutationFn: (body: { labId: number; courierName: string; trackingDetails: string; remarks: string; orderIds: number[] }) =>
      api.post("/api/outsourced-labs/dispatch/batch", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outsource-worklist"] });
      toast({ title: "Sample dispatch batch created successfully" });
      setDispatchOpen(false);
      setSelectedOrders([]);
      setCourierName("");
      setTrackingDetails("");
      setRemarks("");
    },
    onError: (e: Error) => {
      toast({ title: "Failed to dispatch batch", description: e.message, variant: "destructive" });
    },
  });

  const uploadReportMutation = useMutation({
    mutationFn: ({ orderId, filePath }: { orderId: number; filePath: string }) =>
      api.post(`/api/outsourced-labs/orders/${orderId}/reports`, { filePath }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outsource-worklist"] });
      toast({ title: "Report uploaded and order updated" });
      setUploadingOrderId(null);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to save report association", description: e.message, variant: "destructive" });
      setUploadingOrderId(null);
    },
  });

  const handleFileUpload = async (orderId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingOrderId(orderId);
    try {
      // Read as base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(",")[1];
        try {
          const uploadRes = await api.post<{ storagePath: string }>("/api/uploads", {
            module: "reports",
            fileName: file.name,
            mimeType: file.type,
            base64Data,
          });

          uploadReportMutation.mutate({ orderId, filePath: uploadRes.storagePath });
        } catch (err) {
          toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
          setUploadingOrderId(null);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toast({ title: "File read failed", description: (err as Error).message, variant: "destructive" });
      setUploadingOrderId(null);
    }
  };

  const handleSelectOrder = (id: number) => {
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((oId) => oId !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (filteredOrders: Order[]) => {
    if (selectedOrders.length === filteredOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map((o) => o.id));
    }
  };

  const handleDispatchClick = () => {
    if (selectedOrders.length === 0) return;
    setDispatchOpen(true);
  };

  const handleDispatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedRecords = orders.filter((o) => selectedOrders.includes(o.id));
    const firstLabName = selectedRecords[0]?.labName;
    const isSingleLab = selectedRecords.every((o) => o.labName === firstLabName);

    if (!isSingleLab) {
      toast({ title: "Multi-lab selection", description: "All selected samples must belong to the same reference lab.", variant: "destructive" });
      return;
    }

    const labId = labs.find((l) => l.name === firstLabName)?.id;
    if (!labId) {
      toast({ title: "Lab not found", description: "Could not resolve lab identifier.", variant: "destructive" });
      return;
    }

    dispatchMutation.mutate({
      labId,
      courierName,
      trackingDetails,
      remarks,
      orderIds: selectedOrders,
    });
  };

  // Filter logic
  const filteredOrders = orders.filter((o) => {
    if (activeTab === "pending") {
      return ["ordered", "sample_collected", "sample_packed"].includes(o.status);
    }
    if (activeTab === "dispatched") {
      return ["sent_to_lab", "received_by_lab"].includes(o.status);
    }
    if (activeTab === "completed") {
      return ["report_received", "report_uploaded", "report_delivered"].includes(o.status);
    }
    return true;
  });

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Worklist"
        subtitle="Monitor outsourced orders, package samples, and register vendor lab reports"
        actions={
          selectedOrders.length > 0 && (
            <Button size="sm" className="bg-primary text-white hover:bg-primary/90" onClick={handleDispatchClick}>
              <Truck size={14} className="mr-1.5" />
              Dispatch Selection ({selectedOrders.length})
            </Button>
          )
        }
      />

      <div className="px-6 space-y-4">
        {/* Status filters */}
        <div className="flex justify-between items-center border-b border-border pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => { setActiveTab("pending"); setSelectedOrders([]); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === "pending" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              Pending Dispatch
            </button>
            <button
              onClick={() => { setActiveTab("dispatched"); setSelectedOrders([]); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === "dispatched" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              Dispatched
            </button>
            <button
              onClick={() => { setActiveTab("completed"); setSelectedOrders([]); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === "completed" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              Completed
            </button>
            <button
              onClick={() => { setActiveTab("all"); setSelectedOrders([]); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === "all" ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              Show All
            </button>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Filter size={12} />
            Showing {filteredOrders.length} orders
          </span>
        </div>

        {/* Worklist Table */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/20">
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      className="rounded accent-primary border-input"
                      checked={filteredOrders.length > 0 && selectedOrders.length === filteredOrders.length}
                      onChange={() => handleSelectAll(filteredOrders)}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Order details</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Partner Lab</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Cost (₹)</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-4"><div className="h-4 bg-muted rounded w-20 mx-auto" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                      <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
                      No referred orders in this category
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border/50 hover:bg-muted/10 last:border-0">
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          className="rounded accent-primary border-input"
                          checked={selectedOrders.includes(o.id)}
                          onChange={() => handleSelectOrder(o.id)}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-foreground">{o.testName}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 font-mono">
                          <Barcode size={12} />
                          <span>Barcode: {o.barcode || "—"}</span>
                          <span className="text-border">|</span>
                          <span>Bill: {o.billNumber}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">{o.patientName}</div>
                        {o.patientPhone && <div className="text-xs text-muted-foreground mt-0.5">{o.patientPhone}</div>}
                      </td>
                      <td className="px-4 py-4">
                        <span className="font-semibold text-foreground">{o.labName}</span>
                        <div className="text-[11px] text-muted-foreground mt-0.5">Code: {o.labTestCode}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide uppercase ${
                          ["report_received", "report_uploaded", "report_delivered"].includes(o.status)
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : ["sent_to_lab", "received_by_lab"].includes(o.status)
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}>
                          {o.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs font-bold text-foreground">
                        ₹{Number(o.outsourceCost).toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {uploadingOrderId === o.id ? (
                          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 size={13} className="animate-spin text-primary" />
                            <span>Uploading...</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <input
                              type="file"
                              accept=".pdf"
                              id={`upload-${o.id}`}
                              className="hidden"
                              onChange={(e) => handleFileUpload(o.id, e)}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-[11px] border-primary/30 text-primary hover:bg-primary/5"
                              onClick={() => document.getElementById(`upload-${o.id}`)?.click()}
                            >
                              <FileUp size={11} className="mr-1" />
                              Attach Report
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Dispatch Batch creation dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Truck size={18} className="text-primary" />
              Generate Dispatch manifest
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDispatchSubmit} className="space-y-4 pt-2">
            <div className="bg-muted/40 border border-border p-3.5 rounded-lg text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference Lab:</span>
                <span className="font-bold text-foreground">
                  {orders.find((o) => o.id === selectedOrders[0])?.labName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Investigations Packed:</span>
                <span className="font-bold text-foreground">{selectedOrders.length} samples</span>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground">Courier / Agent Name *</Label>
              <Input
                value={courierName}
                onChange={(e) => setCourierName(e.target.value)}
                placeholder="E.g. Bluedart / Staff Name"
                className="mt-1 bg-background"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground">Tracking ID / Contact Details</Label>
              <Input
                value={trackingDetails}
                onChange={(e) => setTrackingDetails(e.target.value)}
                placeholder="E.g. AW1290382 / Phone"
                className="mt-1 bg-background"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground">Remarks</Label>
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="E.g. Cold chain pack"
                className="mt-1 bg-background"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary text-white hover:bg-primary/90" disabled={dispatchMutation.isPending}>
                {dispatchMutation.isPending ? "Generating..." : "Confirm Dispatch"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
