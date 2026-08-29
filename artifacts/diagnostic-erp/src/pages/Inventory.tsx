import { useState, useRef } from "react";
import { loadReportOrientation, persistReportOrientation, type PaperOrientation } from "@/lib/paperSize";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { MobileTableScroll } from "@/components/MobileTableScroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useListTests } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import {
  Plus, AlertTriangle, ArrowDown, ArrowUp, Settings2,
  Package, Trash2, History, SlidersHorizontal, Pencil,
  LayoutGrid, Table as TableIcon, Download, FileSpreadsheet,
  FileText, FileType, Truck, Phone, Mail, MapPin, Eye,
  ClipboardList, ShoppingCart, Layers,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  exportInventoryExcel,
  exportInventoryPDF,
  exportInventoryWord,
} from "@/lib/inventoryExports";
import { useToast } from "@/hooks/use-toast";
import { buildCsv, downloadCsv, parseCsv } from "@/lib/csv";
import { Upload, ScanLine } from "lucide-react";
import PurchaseInvoiceScannerPanel from "@/components/PurchaseInvoiceScannerPanel";
import InventoryDemandPanel from "@/components/InventoryDemandPanel";
import InventoryReorderPanel from "@/components/InventoryReorderPanel";
import InventoryBatchesPanel from "@/components/InventoryBatchesPanel";
import InventoryBarcodeStrip from "@/components/InventoryBarcodeStrip";

type Item = {
  id: number; name: string; unit: string; category: string;
  currentStock: number; minStock: number; costPrice: number; isActive: boolean;
  preferredVendorId?: number | null;
  barcode?: string | null;
  trackExpiry?: boolean;
};
type TxnRow = {
  id: number; type: string; quantity: string; stockBefore: string;
  stockAfter: string; reason?: string; reference?: string; performedBy?: string;
  vendorId?: number | null; vendorName?: string | null;
  invoiceNumber?: string | null; invoiceDate?: string | null; unitCost?: string | null;
  createdAt: string;
};
type ConsumptionRule = {
  id: number; testId: number; itemId: number; quantity: string;
  testName?: string; itemName?: string; itemUnit?: string;
};
type Vendor = {
  id: number; code: string; name: string;
  contactPerson?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; city?: string | null; state?: string | null; pincode?: string | null;
  gstin?: string | null; paymentTerms?: string | null; category?: string | null;
  openingBalance: number; notes?: string | null; isActive: boolean;
  itemCount: number; purchaseCount: number; totalPurchaseQty: number;
  totalPurchaseCost: number; lastPurchaseAt: string | null;
};
type VendorDetail = {
  vendor: Vendor;
  items: Item[];
  purchases: Array<{
    id: number; itemId: number; itemName?: string | null; itemUnit?: string | null;
    quantity: number; unitCost: number | null;
    invoiceNumber?: string | null; invoiceDate?: string | null;
    reference?: string | null; reason?: string | null;
    performedBy?: string | null; createdAt: string;
  }>;
  summary: { itemCount: number; purchaseCount: number; totalPurchaseQty: number; totalPurchaseCost: number };
};

const CATEGORIES = ["consumable", "reagent", "equipment", "stationery", "other"];

function fmt(n: number) { return n.toLocaleString("en-IN"); }
// Mutually-exclusive states. An item is OUT, LOW, or IN — never both LOW and OUT.
function isOut(item: Item) { return Number(item.currentStock) <= 0; }
function isLow(item: Item) {
  return !isOut(item) && Number(item.currentStock) <= Number(item.minStock);
}

export default function Inventory() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pdfOrientation, setPdfOrientation] = useState<PaperOrientation>(() => loadReportOrientation());
  const [stockDialog, setStockDialog] = useState<{ item: Item; mode: "in" | "out" | "adjust" } | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  // Vendor management state
  const [vendorDialog, setVendorDialog] = useState<{ mode: "add" | "edit"; vendor?: Vendor } | null>(null);
  const [vendorDetailId, setVendorDetailId] = useState<number | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  // Local state for stock-in vendor/invoice fields (kept outside react-hook-form
  // because the Select component is uncontrolled-style here).
  const [stockInVendorId, setStockInVendorId] = useState<string>("");
  // Multi-item rule editor state. When non-null, the dialog is open and is
  // editing this test's full rule set. `testId === ""` means "Add new" — the
  // user picks a test inside the dialog. Otherwise the test is locked
  // (you cannot retarget an existing rule group to a different test).
  const [ruleEditor, setRuleEditor] = useState<
    | { testId: string; rows: { itemId: string; quantity: string }[]; mode: "add" | "edit" }
    | null
  >(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [scannedItem, setScannedItem] = useState<Item | null>(null);

  // ── CSV export/import for items + vendors ─────────────────────────────
  // Two separate file inputs (one per tab) so the user can't accidentally
  // upload a vendor file on the items tab or vice versa.
  const [csvBusy, setCsvBusy] = useState<null | "item-export" | "item-import" | "vendor-export" | "vendor-import">(null);
  const itemImportRef = useRef<HTMLInputElement>(null);
  const vendorImportRef = useRef<HTMLInputElement>(null);

  const exportItemsCsv = () => {
    if (csvBusy) return;
    setCsvBusy("item-export");
    try {
      const vendorMap = new Map((vendors ?? []).map((v) => [v.id, v.code]));
      const rows = items.map((it) => ({
        name: it.name,
        unit: it.unit,
        category: it.category,
        currentStock: Number(it.currentStock).toFixed(2),
        minStock: Number(it.minStock).toFixed(2),
        costPrice: Number(it.costPrice).toFixed(2),
        vendorCode: it.preferredVendorId ? vendorMap.get(it.preferredVendorId) ?? "" : "",
        isActive: it.isActive ? "true" : "false",
      }));
      const csv = buildCsv(
        ["name","unit","category","currentStock","minStock","costPrice","vendorCode","isActive"],
        rows,
      );
      downloadCsv(csv, `inventory-items-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: "Export ready", description: `${rows.length} items downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message || "Could not export items.", variant: "destructive" });
    } finally {
      setCsvBusy(null);
    }
  };

  const onItemsImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setCsvBusy("item-import");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) { toast({ title: "Empty file", variant: "destructive" }); return; }
      const result = await api.post<{ inserted: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }>("/api/inventory/import", { rows });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      const desc = `${result.inserted} added, ${result.updated} updated`
        + (result.skipped > 0 ? `, ${result.skipped} skipped` : "")
        + (result.errors[0] ? ` — first issue: row ${result.errors[0].row}: ${result.errors[0].reason}` : "");
      toast({ title: result.skipped > 0 ? "Import finished with warnings" : "Import complete", description: desc, variant: result.skipped > 0 ? "destructive" : "default" });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message || "Could not import.", variant: "destructive" });
    } finally { setCsvBusy(null); }
  };

  const exportVendorsCsv = () => {
    if (csvBusy) return;
    setCsvBusy("vendor-export");
    try {
      const rows = (vendors ?? []).map((v) => ({
        code: v.code,
        name: v.name,
        contactPerson: v.contactPerson ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
        address: v.address ?? "",
        city: v.city ?? "",
        state: v.state ?? "",
        pincode: v.pincode ?? "",
        gstin: v.gstin ?? "",
        paymentTerms: v.paymentTerms ?? "",
        category: v.category ?? "",
        openingBalance: Number(v.openingBalance ?? 0).toFixed(2),
        notes: v.notes ?? "",
        isActive: v.isActive ? "true" : "false",
      }));
      const csv = buildCsv(
        ["code","name","contactPerson","phone","email","address","city","state","pincode","gstin","paymentTerms","category","openingBalance","notes","isActive"],
        rows,
      );
      downloadCsv(csv, `vendors-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: "Export ready", description: `${rows.length} vendors downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message || "Could not export vendors.", variant: "destructive" });
    } finally {
      setCsvBusy(null);
    }
  };

  const onVendorsImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setCsvBusy("vendor-import");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) { toast({ title: "Empty file", variant: "destructive" }); return; }
      const result = await api.post<{ inserted: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }>("/api/vendors/import", { rows });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      const desc = `${result.inserted} added, ${result.updated} updated`
        + (result.skipped > 0 ? `, ${result.skipped} skipped` : "")
        + (result.errors[0] ? ` — first issue: row ${result.errors[0].row}: ${result.errors[0].reason}` : "");
      toast({ title: result.skipped > 0 ? "Import finished with warnings" : "Import complete", description: desc, variant: result.skipped > 0 ? "destructive" : "default" });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message || "Could not import.", variant: "destructive" });
    } finally { setCsvBusy(null); }
  };

  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["inventory"],
    queryFn: () => api.get("/api/inventory"),
  });
  const { data: lowStock = [] } = useQuery<Item[]>({
    queryKey: ["inventory-low"],
    queryFn: () => api.get("/api/inventory/low-stock"),
  });

  const { data: pendingDemands = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/inventory/demands", "pending"],
    queryFn: () => api.get("/api/inventory/demands?status=pending"),
  });

  const { data: reorderSuggestions = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/inventory/reorder/requests"],
    queryFn: () => api.get("/api/inventory/reorder/requests?status=suggested"),
  });

  const { data: rules = [] } = useQuery<ConsumptionRule[]>({
    queryKey: ["consumption-rules"],
    queryFn: () => api.get("/api/inventory/consumption-rules"),
  });
  const { data: history = [] } = useQuery<TxnRow[]>({
    queryKey: ["inventory-history", historyItem?.id],
    queryFn: () => api.get(`/api/inventory/${historyItem!.id}/history`),
    enabled: !!historyItem,
  });
  const { data: testsData } = useListTests({});
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["vendors"],
    queryFn: () => api.get("/api/vendors"),
  });
  const { data: vendorDetail } = useQuery<VendorDetail>({
    queryKey: ["vendor-detail", vendorDetailId],
    queryFn: () => api.get(`/api/vendors/${vendorDetailId}`),
    enabled: !!vendorDetailId,
  });

  const saveVendor = useMutation({
    mutationFn: (d: { id?: number; body: Record<string, unknown> }) =>
      d.id ? api.patch(`/api/vendors/${d.id}`, d.body) : api.post("/api/vendors", d.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["vendor-detail"] });
      setVendorDialog(null);
      toast({ title: "Vendor saved" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not save vendor";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });
  const deleteVendor = useMutation({
    mutationFn: (id: number) => api.delete(`/api/vendors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast({ title: "Vendor deleted" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not delete vendor";
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  const addItem = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/inventory", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); setAddOpen(false); resetAdd(); },
  });
  const updateItem = useMutation({
    mutationFn: (d: { id: number; body: Record<string, unknown> }) => api.patch(`/api/inventory/${d.id}`, d.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["inventory-low"] }); setEditItem(null); },
  });
  const stockIn = useMutation({
    mutationFn: (d: { id: number; body: Record<string, unknown> }) => api.post(`/api/inventory/${d.id}/stock-in`, d.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["inventory-low"] }); setStockDialog(null); resetStock(); },
  });
  const stockOut = useMutation({
    mutationFn: (d: { id: number; body: Record<string, unknown> }) => api.post(`/api/inventory/${d.id}/stock-out`, d.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["inventory-low"] }); setStockDialog(null); resetStock(); },
  });
  const adjust = useMutation({
    mutationFn: (d: { id: number; body: Record<string, unknown> }) => api.post(`/api/inventory/${d.id}/adjust`, d.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["inventory-low"] }); setStockDialog(null); resetStock(); },
  });
  // Replace ALL consumption rules for a test in one atomic call.
  const saveTestRules = useMutation({
    mutationFn: (d: { testId: number; items: { itemId: number; quantity: number }[] }) =>
      api.put(`/api/inventory/consumption-rules/by-test/${d.testId}`, { items: d.items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consumption-rules"] });
      setRuleEditor(null);
      toast({ title: "Consumption rule saved" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not save rule";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });
  // Delete EVERY rule for a given test (the per-test card-level Delete button).
  const deleteTestRules = useMutation({
    mutationFn: (testId: number) =>
      api.delete(`/api/inventory/consumption-rules/by-test/${testId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consumption-rules"] });
      toast({ title: "Consumption rule removed" });
    },
  });

  const { register: regAdd, handleSubmit: subAdd, reset: resetAdd, setValue: setAddVal } = useForm<Record<string, string>>();
  const { register: regStock, handleSubmit: subStock, reset: resetStock } = useForm<Record<string, string>>();

  // Group flat rule rows by testId so the UI shows one row per test with all
  // consumed items listed under it (matching the user's mockup).
  const rulesByTest = (() => {
    const map = new Map<number, { testId: number; testName: string; items: ConsumptionRule[] }>();
    for (const r of rules) {
      const key = r.testId;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(r);
      } else {
        map.set(key, {
          testId: r.testId,
          testName: r.testName || `Test #${r.testId}`,
          items: [r],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.testName.localeCompare(b.testName));
  })();

  function openAddRule() {
    setRuleEditor({ testId: "", rows: [{ itemId: "", quantity: "1" }], mode: "add" });
  }
  function openEditRule(testId: number) {
    const group = rulesByTest.find((g) => g.testId === testId);
    if (!group) return;
    setRuleEditor({
      testId: String(testId),
      mode: "edit",
      rows: group.items.map((it) => ({ itemId: String(it.itemId), quantity: String(it.quantity) })),
    });
  }
  function updateRow(idx: number, patch: Partial<{ itemId: string; quantity: string }>) {
    setRuleEditor((cur) => {
      if (!cur) return cur;
      const rows = cur.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      return { ...cur, rows };
    });
  }
  function addRow() {
    setRuleEditor((cur) => (cur ? { ...cur, rows: [...cur.rows, { itemId: "", quantity: "1" }] } : cur));
  }
  function removeRow(idx: number) {
    setRuleEditor((cur) => {
      if (!cur) return cur;
      const rows = cur.rows.filter((_, i) => i !== idx);
      // Always keep at least one row so the user can edit something.
      return { ...cur, rows: rows.length ? rows : [{ itemId: "", quantity: "1" }] };
    });
  }
  function saveRuleEditor() {
    if (!ruleEditor) return;
    const testId = Number(ruleEditor.testId);
    if (!Number.isFinite(testId) || testId <= 0) {
      toast({ title: "Pick a test", variant: "destructive" });
      return;
    }
    // Reject empty/invalid rows and tell the user which one is bad.
    const items: { itemId: number; quantity: number }[] = [];
    for (let i = 0; i < ruleEditor.rows.length; i++) {
      const row = ruleEditor.rows[i];
      const itemId = Number(row.itemId);
      const qty = Number(row.quantity);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        toast({ title: `Row ${i + 1}: pick an item`, variant: "destructive" });
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        toast({ title: `Row ${i + 1}: quantity must be > 0`, variant: "destructive" });
        return;
      }
      items.push({ itemId, quantity: qty });
    }
    if (items.length === 0) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    saveTestRules.mutate({ testId, items });
  }

  const filtered = items.filter((i) => {
    if (search) {
      const s = search.toLowerCase();
      if (!i.name.toLowerCase().includes(s) && !i.category.toLowerCase().includes(s)) return false;
    }
    if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
    if (stockFilter === "low" && !isLow(i)) return false;
    if (stockFilter === "out" && i.currentStock > 0) return false;
    return true;
  });

  // Aggregates for the table-view summary bar. Guard every read with Number()
  // and a NaN-safe fallback so a malformed numeric column can never propagate
  // a NaN into the summary or the totals row of the export.
  const safeNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totalStockValue = filtered.reduce(
    (acc, i) => acc + safeNum(i.currentStock) * safeNum(i.costPrice),
    0,
  );
  const outOfStockCount = filtered.filter(isOut).length;
  const lowStockCount = filtered.filter(isLow).length;

  // Build the meta line for exports based on the current filters so the
  // downloaded file matches what the user is looking at on screen.
  function buildExportMeta() {
    const parts: string[] = [];
    if (categoryFilter !== "all") parts.push(`Category: ${categoryFilter}`);
    if (stockFilter === "low") parts.push("Low stock only");
    if (stockFilter === "out") parts.push("Out of stock only");
    if (search) parts.push(`Search: "${search}"`);
    return {
      title: "Inventory Stock Report",
      subtitle: "Care Diagnostics Billing ERP",
      filterLabel: parts.length ? parts.join(" · ") : "All items",
      generatedAt: new Date().toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
    };
  }

  function handleSetPdfOrientation(o: PaperOrientation) {
    persistReportOrientation(o);
    setPdfOrientation(o);
  }

  async function handleExport(kind: "excel" | "pdf" | "word") {
    if (filtered.length === 0) {
      toast({ title: "Nothing to export", description: "Adjust filters so at least one item is shown.", variant: "destructive" });
      return;
    }
    try {
      const meta = buildExportMeta();
      const rows = filtered.map((i) => ({
        name: i.name,
        category: i.category,
        currentStock: Number(i.currentStock),
        unit: i.unit,
        minStock: Number(i.minStock),
        costPrice: Number(i.costPrice),
        isActive: i.isActive,
      }));
      if (kind === "excel") await exportInventoryExcel(rows, meta);
      else if (kind === "pdf") await exportInventoryPDF(rows, meta);
      else await exportInventoryWord(rows, meta);
      toast({ title: `Downloaded ${rows.length} item${rows.length === 1 ? "" : "s"}`, description: `Format: ${kind.toUpperCase()}` });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    }
  }

  const typeBadge = (type: string) => {
    if (type === "in") return <Badge className="bg-green-100 text-green-700 text-xs">Stock In</Badge>;
    if (type === "out") return <Badge className="bg-red-100 text-red-700 text-xs">Stock Out</Badge>;
    return <Badge className="bg-blue-100 text-blue-700 text-xs">Adjustment</Badge>;
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Inventory"
        subtitle={`${items.length} items · ${lowStock.length} low stock`}
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={items.length === 0}>
                  <Download size={14} className="mr-1.5" /> Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => handleExport("excel")}>
                  <FileSpreadsheet size={14} className="mr-2 text-emerald-600" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  <FileText size={14} className="mr-2 text-red-600" />
                  PDF (.pdf)
                </DropdownMenuItem>
                <div className="flex items-center gap-1 px-2 pb-1">
                  <span className="text-[10px] text-muted-foreground mr-1">PDF layout:</span>
                  <button
                    type="button"
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${pdfOrientation === "portrait" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    onClick={(e) => { e.preventDefault(); handleSetPdfOrientation("portrait"); }}
                  >
                    Portrait
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${pdfOrientation === "landscape" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    onClick={(e) => { e.preventDefault(); handleSetPdfOrientation("landscape"); }}
                  >
                    Landscape
                  </button>
                </div>
                <DropdownMenuItem onClick={() => handleExport("word")}>
                  <FileType size={14} className="mr-2 text-blue-600" />
                  Word (.docx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={itemImportRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onItemsImportFile} />
            <Button size="sm" variant="outline" onClick={() => itemImportRef.current?.click()} disabled={csvBusy === "item-import"} title="Upload a CSV to add or update items in bulk (matched by name)">
              <Upload size={14} className="mr-1.5" /> {csvBusy === "item-import" ? "Importing…" : "Import CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportItemsCsv} disabled={csvBusy === "item-export" || items.length === 0} title="Download the full item list as CSV">
              <Download size={14} className="mr-1.5" /> {csvBusy === "item-export" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" onClick={() => { setAddOpen(true); resetAdd(); }}>
              <Plus size={14} className="mr-1" /> Add Item
            </Button>
          </div>
        }
      />

      <div className="px-6">
        <Tabs defaultValue="items">
          <TabsList className="mb-4">
            <TabsTrigger value="items">
              Items
              {lowStock.length > 0 && (
                <span className="ml-2 bg-red-500 text-white rounded-full text-xs px-1.5 py-0.5">{lowStock.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="demands">
              <ClipboardList size={13} className="mr-1" />
              Staff Demands
              {pendingDemands.length > 0 && (
                <span className="ml-2 bg-violet-500 text-white rounded-full text-xs px-1.5 py-0.5">{pendingDemands.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reorders">
              <ShoppingCart size={13} className="mr-1" />
              Reorders
              {reorderSuggestions.length > 0 && (
                <span className="ml-2 bg-amber-500 text-white rounded-full text-xs px-1.5 py-0.5">{reorderSuggestions.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="batches">
              <Layers size={13} className="mr-1" />
              Lots & Expiry
            </TabsTrigger>
            <TabsTrigger value="rules">Consumption Rules</TabsTrigger>
            <TabsTrigger value="vendors">
              Vendors
              <span className="ml-2 bg-muted text-muted-foreground rounded-full text-xs px-1.5 py-0.5">{vendors.length}</span>
            </TabsTrigger>
            <TabsTrigger value="scan-invoice">
              <ScanLine size={13} className="mr-1" /> Scan Invoice
            </TabsTrigger>
          </TabsList>

          {/* ── Items Tab ── */}
          <TabsContent value="items" className="space-y-4">
            <InventoryBarcodeStrip
              onItemFound={(item) => {
                setScannedItem(item as Item);
                setSearch(item.name);
              }}
            />
            {scannedItem && (
              <div className="flex flex-wrap items-center gap-2 text-xs bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2">
                <span>Scanned: <strong>{scannedItem.name}</strong> ({scannedItem.barcode ?? `INV-${scannedItem.id}`})</span>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setStockDialog({ item: scannedItem, mode: "in" })}>Stock In</Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setStockDialog({ item: scannedItem, mode: "out" })}>Stock Out</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setScannedItem(null)}>Clear</Button>
              </div>
            )}
            {lowStock.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Low Stock Alert</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {lowStock.map(i => `${i.name} (${fmt(i.currentStock)} ${i.unit})`).join(", ")} — reorder needed
                  </p>
                </div>
              </div>
            )}

            {/* Filters + view toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as typeof stockFilter)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stock</SelectItem>
                  <SelectItem value="low">Low stock</SelectItem>
                  <SelectItem value="out">Out of stock</SelectItem>
                </SelectContent>
              </Select>

              <div
                className="ml-auto inline-flex border border-card-border rounded-md overflow-hidden"
                role="group"
                aria-label="Inventory view"
              >
                <button
                  type="button"
                  onClick={() => setView("cards")}
                  aria-pressed={view === "cards"}
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                    view === "cards" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  }`}
                  title="Card view"
                >
                  <LayoutGrid size={12} /> Cards
                </button>
                <button
                  type="button"
                  onClick={() => setView("table")}
                  aria-pressed={view === "table"}
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                    view === "table" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  }`}
                  title="Table view (all stock levels)"
                >
                  <TableIcon size={12} /> Table
                </button>
              </div>
            </div>

            {/* Summary bar — visible whenever there are results */}
            {!isLoading && filtered.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-card border border-card-border rounded-lg p-2.5">
                  <p className="text-muted-foreground">Items shown</p>
                  <p className="font-bold text-base mt-0.5">{filtered.length}</p>
                </div>
                <div className="bg-card border border-card-border rounded-lg p-2.5">
                  <p className="text-muted-foreground">Low stock</p>
                  <p className="font-bold text-base mt-0.5 text-amber-600">{lowStockCount}</p>
                </div>
                <div className="bg-card border border-card-border rounded-lg p-2.5">
                  <p className="text-muted-foreground">Out of stock</p>
                  <p className="font-bold text-base mt-0.5 text-red-600">{outOfStockCount}</p>
                </div>
                <div className="bg-card border border-card-border rounded-lg p-2.5">
                  <p className="text-muted-foreground">Total stock value</p>
                  <p className="font-bold text-base mt-0.5">
                    ₹{totalStockValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="h-36 bg-muted rounded-xl animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No items found</div>
            ) : view === "table" ? (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-card-border">
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="text-left px-4 py-3 font-semibold">#</th>
                        <th className="text-left px-4 py-3 font-semibold">Item</th>
                        <th className="text-left px-4 py-3 font-semibold">Category</th>
                        <th className="text-right px-4 py-3 font-semibold">Current</th>
                        <th className="text-left px-2 py-3 font-semibold">Unit</th>
                        <th className="text-right px-4 py-3 font-semibold">Min</th>
                        <th className="text-center px-4 py-3 font-semibold">Status</th>
                        <th className="text-right px-4 py-3 font-semibold">Cost (₹)</th>
                        <th className="text-right px-4 py-3 font-semibold">Value (₹)</th>
                        <th className="px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item, idx) => {
                        const value = safeNum(item.currentStock) * safeNum(item.costPrice);
                        const out = isOut(item);
                        const low = isLow(item);
                        return (
                          <tr key={item.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                            <td className="px-4 py-2.5 font-medium">{item.name}</td>
                            <td className="px-4 py-2.5 text-muted-foreground capitalize">{item.category}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${low ? "text-amber-600" : out ? "text-red-600" : ""}`}>
                              {fmt(item.currentStock)}
                            </td>
                            <td className="px-2 py-2.5 text-muted-foreground">{item.unit}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(item.minStock)}</td>
                            <td className="px-4 py-2.5 text-center">
                              {out ? (
                                <Badge className="bg-red-100 text-red-700 text-xs">Out of Stock</Badge>
                              ) : low ? (
                                <Badge className="bg-amber-100 text-amber-700 text-xs">Low Stock</Badge>
                              ) : (
                                <Badge className="bg-green-100 text-green-700 text-xs">In Stock</Badge>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{Number(item.costPrice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-4 py-2.5 text-right font-medium">{value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-2 py-2.5">
                              <div className="flex justify-end gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Stock In" onClick={() => { setStockDialog({ item, mode: "in" }); resetStock(); }}>
                                  <ArrowDown size={12} className="text-green-600" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Stock Out" onClick={() => { setStockDialog({ item, mode: "out" }); resetStock(); }}>
                                  <ArrowUp size={12} className="text-red-500" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Adjust" onClick={() => { setStockDialog({ item, mode: "adjust" }); resetStock(); }}>
                                  <SlidersHorizontal size={12} />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="History" onClick={() => setHistoryItem(item)}>
                                  <History size={12} />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => setEditItem(item)}>
                                  <Pencil size={12} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t-2 border-card-border">
                      <tr className="text-xs">
                        <td colSpan={3} className="px-4 py-2.5 font-semibold">TOTAL ({filtered.length} items)</td>
                        <td className="px-4 py-2.5 text-right font-semibold">—</td>
                        <td colSpan={3} className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Total Value:</td>
                        <td className="px-4 py-2.5 text-right font-bold text-primary">
                          ₹{totalStockValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((item) => (
                  <div key={item.id} className={`bg-card border rounded-xl p-5 shadow-sm transition-shadow hover:shadow-md ${isLow(item) ? "border-amber-300" : "border-card-border"}`}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Package size={15} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{item.category}</p>
                        </div>
                      </div>
                      {isLow(item) && <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-muted-foreground">Current</p>
                        <p className={`font-bold text-sm ${isLow(item) ? "text-amber-600" : "text-foreground"}`}>
                          {fmt(item.currentStock)} <span className="font-normal text-muted-foreground">{item.unit}</span>
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-muted-foreground">Min Stock</p>
                        <p className="font-semibold text-sm">{fmt(item.minStock)} <span className="font-normal text-muted-foreground">{item.unit}</span></p>
                      </div>
                    </div>

                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => { setStockDialog({ item, mode: "in" }); resetStock(); }}>
                        <ArrowDown size={11} className="mr-1 text-green-600" /> Stock In
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => { setStockDialog({ item, mode: "out" }); resetStock(); }}>
                        <ArrowUp size={11} className="mr-1 text-red-500" /> Stock Out
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2" title="Adjust" onClick={() => { setStockDialog({ item, mode: "adjust" }); resetStock(); }}>
                        <SlidersHorizontal size={11} />
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2" title="History" onClick={() => setHistoryItem(item)}>
                        <History size={11} />
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 px-2" title="Edit" onClick={() => setEditItem(item)}>
                        <Pencil size={11} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Staff Demands Tab ── */}
          <TabsContent value="demands" className="space-y-4">
            <InventoryDemandPanel items={items} />
          </TabsContent>

          {/* ── Reorders Tab ── */}
          <TabsContent value="reorders" className="space-y-4">
            <InventoryReorderPanel />
          </TabsContent>

          <TabsContent value="batches" className="space-y-4">
            <InventoryBatchesPanel items={items} />
          </TabsContent>

          {/* ── Consumption Rules Tab ── */}
          <TabsContent value="rules" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Define which consumables are used per test. A single test can consume multiple items
                (e.g. X-Ray Chest = 1 film + 1 polybag + 1 reporting page + 1 envelope).
              </p>
              <Button size="sm" onClick={openAddRule}>
                <Plus size={14} className="mr-1" /> Add Rule
              </Button>
            </div>

            {rulesByTest.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No consumption rules defined yet</div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-card-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-muted-foreground">Test Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-xs uppercase text-muted-foreground">Consumed Items</th>
                      <th className="px-4 py-3 text-right font-semibold text-xs uppercase text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rulesByTest.map((g) => (
                      <tr key={g.testId} className="border-b border-card-border last:border-0 hover:bg-muted/20 align-top">
                        <td className="px-4 py-3 font-medium">{g.testName}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <ul className="space-y-0.5">
                            {g.items.map((it) => (
                              <li key={it.id}>
                                {it.itemName || `Item #${it.itemId}`}{" "}
                                <span className="text-foreground/80">({Number(it.quantity)})</span>
                                {it.itemUnit ? <span className="text-muted-foreground/70"> {it.itemUnit}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title="Edit consumed items"
                            onClick={() => openEditRule(g.testId)}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title="Remove all rules for this test"
                            onClick={() => {
                              if (confirm(`Remove all consumption rules for "${g.testName}"?`)) {
                                deleteTestRules.mutate(g.testId);
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Vendors Tab ── */}
          <TabsContent value="vendors" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search vendors by name or code..."
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                className="max-w-xs"
              />
              <input ref={vendorImportRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onVendorsImportFile} />
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => vendorImportRef.current?.click()}
                disabled={csvBusy === "vendor-import"}
                title="Upload a CSV to add or update vendors (matched by code)"
              >
                <Upload size={14} className="mr-1.5" /> {csvBusy === "vendor-import" ? "Importing…" : "Import CSV"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportVendorsCsv}
                disabled={csvBusy === "vendor-export" || vendors.length === 0}
                title="Download all vendors as CSV"
              >
                <Download size={14} className="mr-1.5" /> {csvBusy === "vendor-export" ? "Exporting…" : "Export CSV"}
              </Button>
              <Button
                size="sm"
                onClick={() => setVendorDialog({ mode: "add" })}
              >
                <Plus size={14} className="mr-1" /> Add Vendor
              </Button>
            </div>

            {vendors.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Truck size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No vendors yet. Add your first supplier to start tracking purchases.</p>
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-card-border">
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="text-left px-4 py-3 font-semibold">Code</th>
                        <th className="text-left px-4 py-3 font-semibold">Vendor</th>
                        <th className="text-left px-4 py-3 font-semibold">Contact</th>
                        <th className="text-left px-4 py-3 font-semibold">GSTIN</th>
                        <th className="text-right px-4 py-3 font-semibold">Items</th>
                        <th className="text-right px-4 py-3 font-semibold">Purchases</th>
                        <th className="text-right px-4 py-3 font-semibold">Total Cost</th>
                        <th className="text-center px-4 py-3 font-semibold">Status</th>
                        <th className="px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {vendors
                        .filter((v) => {
                          if (!vendorSearch) return true;
                          const s = vendorSearch.toLowerCase();
                          return v.name.toLowerCase().includes(s) || v.code.toLowerCase().includes(s);
                        })
                        .map((v) => (
                          <tr key={v.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-mono text-xs">{v.code}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{v.name}</div>
                              {v.contactPerson && <div className="text-xs text-muted-foreground">{v.contactPerson}</div>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {v.phone && <div className="flex items-center gap-1"><Phone size={10} /> {v.phone}</div>}
                              {v.email && <div className="flex items-center gap-1"><Mail size={10} /> {v.email}</div>}
                              {!v.phone && !v.email && <span>—</span>}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{v.gstin || "—"}</td>
                            <td className="px-4 py-2.5 text-right">{v.itemCount}</td>
                            <td className="px-4 py-2.5 text-right">{v.purchaseCount}</td>
                            <td className="px-4 py-2.5 text-right font-medium">
                              {v.totalPurchaseCost > 0 ? `₹${v.totalPurchaseCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {v.isActive ? (
                                <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600 text-xs">Inactive</Badge>
                              )}
                            </td>
                            <td className="px-2 py-2.5">
                              <div className="flex justify-end gap-0.5">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View details" onClick={() => setVendorDetailId(v.id)}>
                                  <Eye size={12} />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => setVendorDialog({ mode: "edit", vendor: v })}>
                                  <Pencil size={12} />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  title="Delete"
                                  onClick={() => {
                                    if (confirm(`Delete vendor "${v.name}"?\n\nThis is only allowed if no items or purchases reference this vendor.`)) {
                                      deleteVendor.mutate(v.id);
                                    }
                                  }}
                                >
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="scan-invoice" className="space-y-4">
            <PurchaseInvoiceScannerPanel />
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Item Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Inventory Item</DialogTitle></DialogHeader>
          <form onSubmit={subAdd((d) => addItem.mutate(d))} className="space-y-4">
            <div><Label>Item Name *</Label><Input {...regAdd("name", { required: true })} className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Unit *</Label><Input {...regAdd("unit", { required: true })} className="mt-1" placeholder="pcs, ml, box…" /></div>
              <div>
                <Label>Category</Label>
                <Select onValueChange={(v) => setAddVal("category", v)} defaultValue="consumable">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Opening Stock</Label><Input type="number" step="any" {...regAdd("currentStock")} className="mt-1" defaultValue="0" /></div>
              <div><Label>Min Stock</Label><Input type="number" step="any" {...regAdd("minStock")} className="mt-1" defaultValue="0" /></div>
              <div><Label>Cost (₹)</Label><Input type="number" step="any" {...regAdd("costPrice")} className="mt-1" defaultValue="0" /></div>
            </div>
            <div>
              <Label>Preferred Vendor</Label>
              <Select onValueChange={(v) => setAddVal("preferredVendorId", v === "__none__" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {vendors.filter(v => v.isActive).map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name} ({v.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addItem.isPending}>{addItem.isPending ? "Saving…" : "Add Item"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock In / Out / Adjust Dialog */}
      {stockDialog && (
        <Dialog open onOpenChange={() => { setStockDialog(null); setStockInVendorId(""); }}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {stockDialog.mode === "in" ? "Stock In" : stockDialog.mode === "out" ? "Stock Out" : "Adjust Stock"} — {stockDialog.item.name}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={subStock((d) => {
                const id = stockDialog.item.id;
                if (stockDialog.mode === "in") {
                  // Send vendor / invoice fields alongside qty/reason etc.
                  // The vendor select stores its value in `stockInVendorId` (controlled);
                  // the date / invoice / cost fields go through react-hook-form.
                  // If user never touched the select, fall back to the item's
                  // preferred vendor (matches the visual pre-fill behavior).
                  const effectiveVendorId =
                    stockInVendorId !== ""
                      ? stockInVendorId
                      : stockDialog.item.preferredVendorId
                        ? String(stockDialog.item.preferredVendorId)
                        : "__none__";
                  stockIn.mutate({
                    id,
                    body: {
                      ...d,
                      vendorId: effectiveVendorId && effectiveVendorId !== "__none__" ? Number(effectiveVendorId) : null,
                      invoiceNumber: d.invoiceNumber || null,
                      invoiceDate: d.invoiceDate || null,
                      unitCost: d.unitCost ? Number(d.unitCost) : null,
                    },
                  });
                  setStockInVendorId("");
                } else if (stockDialog.mode === "out") {
                  stockOut.mutate({ id, body: d });
                } else {
                  adjust.mutate({ id, body: { newQuantity: d.newQuantity, reason: d.reason, performedBy: d.performedBy } });
                }
              })}
              className="space-y-4"
            >
              <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm">
                Current: <strong>{fmt(stockDialog.item.currentStock)} {stockDialog.item.unit}</strong>
              </div>
              {stockDialog.mode === "adjust" ? (
                <div>
                  <Label>New Quantity ({stockDialog.item.unit}) *</Label>
                  <Input type="number" step="any" {...regStock("newQuantity", { required: true })} className="mt-1" />
                </div>
              ) : (
                <div>
                  <Label>Quantity ({stockDialog.item.unit}) *</Label>
                  <Input type="number" step="any" min="0.01" {...regStock("quantity", { required: true })} className="mt-1" />
                </div>
              )}

              {stockDialog.mode === "in" && (
                <div className="space-y-3 border border-card-border rounded-md p-3 bg-muted/10">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Purchase / Vendor Info (optional)</p>
                  <div>
                    <Label>Vendor</Label>
                    <Select
                      value={stockInVendorId || (stockDialog.item.preferredVendorId ? String(stockDialog.item.preferredVendorId) : undefined)}
                      onValueChange={(v) => setStockInVendorId(v)}
                    >
                      <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {vendors.filter(v => v.isActive).map(v => (
                          <SelectItem key={v.id} value={String(v.id)}>{v.name} ({v.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {stockDialog.item.preferredVendorId && !stockInVendorId && (
                      <p className="text-xs text-muted-foreground mt-1">Pre-filled with preferred vendor.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Invoice #</Label><Input {...regStock("invoiceNumber")} className="mt-1" /></div>
                    <div><Label>Invoice Date</Label><Input type="date" {...regStock("invoiceDate")} className="mt-1" /></div>
                  </div>
                  <div><Label>Unit Cost (₹)</Label><Input type="number" step="any" {...regStock("unitCost")} className="mt-1" placeholder={String(stockDialog.item.costPrice || "")} /></div>
                </div>
              )}

              <div><Label>Reason</Label><Input {...regStock("reason")} className="mt-1" /></div>
              {stockDialog.mode !== "in" && (
                <div><Label>Reference (Order#, Bill#)</Label><Input {...regStock("reference")} className="mt-1" /></div>
              )}
              <div><Label>Performed By</Label><Input {...regStock("performedBy")} className="mt-1" /></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setStockDialog(null); setStockInVendorId(""); }}>Cancel</Button>
                <Button type="submit">{stockDialog.mode === "adjust" ? "Adjust" : stockDialog.mode === "in" ? "Add Stock" : "Deduct Stock"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Transaction History Dialog */}
      {historyItem && (
        <Dialog open onOpenChange={() => setHistoryItem(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Stock History — {historyItem.name}</DialogTitle></DialogHeader>
            {history.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No transactions yet</p>
            ) : (
              <MobileTableScroll>
              <table className="w-full text-sm min-w-[40rem]">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted-foreground uppercase">
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-right py-2">Qty</th>
                    <th className="text-right py-2">After</th>
                    <th className="text-left py-2 pl-4">Vendor</th>
                    <th className="text-left py-2 pl-4">Invoice</th>
                    <th className="text-left py-2 pl-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-card-border last:border-0">
                      <td className="py-2 text-muted-foreground whitespace-nowrap">{new Date(h.createdAt).toLocaleDateString("en-IN")}</td>
                      <td className="py-2">{typeBadge(h.type)}</td>
                      <td className={`py-2 text-right font-medium ${h.type === "in" ? "text-green-600" : h.type === "out" ? "text-red-500" : "text-blue-600"}`}>
                        {h.type === "out" ? "-" : h.type === "in" ? "+" : "→"}{Math.abs(Number(h.quantity))} {historyItem.unit}
                      </td>
                      <td className="py-2 text-right">{Number(h.stockAfter).toLocaleString("en-IN")}</td>
                      <td className="py-2 pl-4 text-muted-foreground">{h.vendorName || "—"}</td>
                      <td className="py-2 pl-4 text-muted-foreground text-xs">
                        {h.invoiceNumber ? <div>{h.invoiceNumber}</div> : null}
                        {h.invoiceDate ? <div className="text-muted-foreground/70">{new Date(h.invoiceDate).toLocaleDateString("en-IN")}</div> : null}
                        {!h.invoiceNumber && !h.invoiceDate && "—"}
                      </td>
                      <td className="py-2 pl-4 text-muted-foreground">{h.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </MobileTableScroll>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Vendor Add / Edit Dialog */}
      {vendorDialog && (
        <Dialog open onOpenChange={(o) => { if (!o) setVendorDialog(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{vendorDialog.mode === "add" ? "Add Vendor" : `Edit Vendor — ${vendorDialog.vendor?.name}`}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const code = String(fd.get("code") || "").trim();
                const name = String(fd.get("name") || "").trim();
                if (!code || !name) {
                  toast({ title: "Code and name are required", variant: "destructive" });
                  return;
                }
                const body: Record<string, unknown> = {
                  code,
                  name,
                  contactPerson: String(fd.get("contactPerson") || "").trim() || null,
                  phone: String(fd.get("phone") || "").trim() || null,
                  email: String(fd.get("email") || "").trim() || null,
                  address: String(fd.get("address") || "").trim() || null,
                  city: String(fd.get("city") || "").trim() || null,
                  state: String(fd.get("state") || "").trim() || null,
                  pincode: String(fd.get("pincode") || "").trim() || null,
                  gstin: String(fd.get("gstin") || "").trim() || null,
                  paymentTerms: String(fd.get("paymentTerms") || "").trim() || null,
                  category: String(fd.get("category") || "").trim() || null,
                  openingBalance: Number(fd.get("openingBalance") || 0),
                  notes: String(fd.get("notes") || "").trim() || null,
                  isActive: fd.get("isActive") === "on",
                };
                saveVendor.mutate({ id: vendorDialog.vendor?.id, body });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Code *</Label>
                  <Input name="code" defaultValue={vendorDialog.vendor?.code} required className="mt-1" placeholder="e.g. SUP-001" />
                </div>
                <div>
                  <Label>Vendor Name *</Label>
                  <Input name="name" defaultValue={vendorDialog.vendor?.name} required className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Contact Person</Label><Input name="contactPerson" defaultValue={vendorDialog.vendor?.contactPerson ?? ""} className="mt-1" /></div>
                <div><Label>Category</Label><Input name="category" defaultValue={vendorDialog.vendor?.category ?? ""} className="mt-1" placeholder="e.g. Reagents, Equipment" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input name="phone" defaultValue={vendorDialog.vendor?.phone ?? ""} className="mt-1" /></div>
                <div><Label>Email</Label><Input type="email" name="email" defaultValue={vendorDialog.vendor?.email ?? ""} className="mt-1" /></div>
              </div>
              <div><Label>Address</Label><Input name="address" defaultValue={vendorDialog.vendor?.address ?? ""} className="mt-1" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>City</Label><Input name="city" defaultValue={vendorDialog.vendor?.city ?? ""} className="mt-1" /></div>
                <div><Label>State</Label><Input name="state" defaultValue={vendorDialog.vendor?.state ?? ""} className="mt-1" /></div>
                <div><Label>Pincode</Label><Input name="pincode" defaultValue={vendorDialog.vendor?.pincode ?? ""} className="mt-1" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>GSTIN</Label><Input name="gstin" defaultValue={vendorDialog.vendor?.gstin ?? ""} className="mt-1" placeholder="22AAAAA0000A1Z5" /></div>
                <div><Label>Payment Terms</Label><Input name="paymentTerms" defaultValue={vendorDialog.vendor?.paymentTerms ?? ""} className="mt-1" placeholder="Net 30" /></div>
                <div><Label>Opening Balance (₹)</Label><Input type="number" step="any" name="openingBalance" defaultValue={vendorDialog.vendor?.openingBalance ?? 0} className="mt-1" /></div>
              </div>
              <div><Label>Notes</Label><Input name="notes" defaultValue={vendorDialog.vendor?.notes ?? ""} className="mt-1" /></div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="vendor-isActive"
                  name="isActive"
                  defaultChecked={vendorDialog.vendor?.isActive ?? true}
                  className="h-4 w-4"
                />
                <Label htmlFor="vendor-isActive" className="text-sm font-normal cursor-pointer">Active</Label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setVendorDialog(null)}>Cancel</Button>
                <Button type="submit" disabled={saveVendor.isPending}>{saveVendor.isPending ? "Saving…" : "Save Vendor"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Vendor Detail Dialog */}
      {vendorDetailId && (
        <Dialog open onOpenChange={(o) => { if (!o) setVendorDetailId(null); }}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {vendorDetail?.vendor.name ?? "Vendor"}
                {vendorDetail?.vendor.code ? <span className="ml-2 text-sm text-muted-foreground font-normal">({vendorDetail.vendor.code})</span> : null}
              </DialogTitle>
            </DialogHeader>
            {!vendorDetail ? (
              <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
            ) : (
              <div className="space-y-4">
                {/* Info card */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-card border border-card-border rounded-lg p-3">
                    <p className="text-muted-foreground">Items supplied</p>
                    <p className="font-bold text-base mt-0.5">{vendorDetail.summary.itemCount}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-lg p-3">
                    <p className="text-muted-foreground">Purchases</p>
                    <p className="font-bold text-base mt-0.5">{vendorDetail.summary.purchaseCount}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-lg p-3">
                    <p className="text-muted-foreground">Total qty</p>
                    <p className="font-bold text-base mt-0.5">{vendorDetail.summary.totalPurchaseQty.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="bg-card border border-card-border rounded-lg p-3">
                    <p className="text-muted-foreground">Total cost</p>
                    <p className="font-bold text-base mt-0.5">₹{vendorDetail.summary.totalPurchaseCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
                  </div>
                </div>

                {/* Contact strip */}
                <div className="bg-muted/30 rounded-lg p-3 text-sm flex flex-wrap gap-x-6 gap-y-2">
                  {vendorDetail.vendor.contactPerson && <div><span className="text-muted-foreground">Contact:</span> <strong>{vendorDetail.vendor.contactPerson}</strong></div>}
                  {vendorDetail.vendor.phone && <div className="flex items-center gap-1"><Phone size={12} /> {vendorDetail.vendor.phone}</div>}
                  {vendorDetail.vendor.email && <div className="flex items-center gap-1"><Mail size={12} /> {vendorDetail.vendor.email}</div>}
                  {vendorDetail.vendor.gstin && <div><span className="text-muted-foreground">GSTIN:</span> <span className="font-mono text-xs">{vendorDetail.vendor.gstin}</span></div>}
                  {vendorDetail.vendor.paymentTerms && <div><span className="text-muted-foreground">Terms:</span> {vendorDetail.vendor.paymentTerms}</div>}
                  {(vendorDetail.vendor.address || vendorDetail.vendor.city) && (
                    <div className="flex items-center gap-1 w-full"><MapPin size={12} className="flex-shrink-0" /> {[vendorDetail.vendor.address, vendorDetail.vendor.city, vendorDetail.vendor.state, vendorDetail.vendor.pincode].filter(Boolean).join(", ")}</div>
                  )}
                </div>

                {/* Linked items */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">Items Supplied ({vendorDetail.items.length})</h3>
                  {vendorDetail.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3">No items have this vendor as their preferred supplier.</p>
                  ) : (
                    <div className="border border-card-border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                          <tr><th className="text-left px-3 py-2">Item</th><th className="text-left px-3 py-2">Category</th><th className="text-right px-3 py-2">Stock</th><th className="text-right px-3 py-2">Cost</th></tr>
                        </thead>
                        <tbody>
                          {vendorDetail.items.map((it) => (
                            <tr key={it.id} className="border-t border-card-border">
                              <td className="px-3 py-2 font-medium">{it.name}</td>
                              <td className="px-3 py-2 text-muted-foreground capitalize">{it.category}</td>
                              <td className="px-3 py-2 text-right">{Number(it.currentStock)} {it.unit}</td>
                              <td className="px-3 py-2 text-right">₹{Number(it.costPrice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Purchase history */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">Purchase History ({vendorDetail.purchases.length})</h3>
                  {vendorDetail.purchases.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3">No purchases recorded yet. Use Stock-In on an item and pick this vendor.</p>
                  ) : (
                    <div className="border border-card-border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="text-left px-3 py-2">Date</th>
                            <th className="text-left px-3 py-2">Item</th>
                            <th className="text-right px-3 py-2">Qty</th>
                            <th className="text-right px-3 py-2">Unit Cost</th>
                            <th className="text-right px-3 py-2">Line Total</th>
                            <th className="text-left px-3 py-2">Invoice</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorDetail.purchases.map((p) => {
                            const lineTotal = p.unitCost == null ? null : p.quantity * p.unitCost;
                            return (
                              <tr key={p.id} className="border-t border-card-border">
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                                <td className="px-3 py-2">{p.itemName ?? `Item #${p.itemId}`}</td>
                                <td className="px-3 py-2 text-right">{p.quantity} {p.itemUnit ?? ""}</td>
                                <td className="px-3 py-2 text-right">{p.unitCost == null ? "—" : `₹${p.unitCost.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}</td>
                                <td className="px-3 py-2 text-right font-medium">{lineTotal == null ? "—" : `₹${lineTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                  {p.invoiceNumber ? <div>{p.invoiceNumber}</div> : null}
                                  {p.invoiceDate ? <div className="text-muted-foreground/70">{new Date(p.invoiceDate).toLocaleDateString("en-IN")}</div> : null}
                                  {!p.invoiceNumber && !p.invoiceDate && "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => setVendorDetailId(null)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Item Dialog */}
      {editItem && (
        <Dialog open onOpenChange={() => setEditItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit Item — {editItem.name}</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const rawVendor = String(fd.get("preferredVendorId") || "");
                updateItem.mutate({
                  id: editItem.id,
                  body: {
                    name: String(fd.get("name") || "").trim(),
                    unit: String(fd.get("unit") || "").trim(),
                    category: String(fd.get("category") || editItem.category),
                    minStock: Number(fd.get("minStock") || 0),
                    costPrice: Number(fd.get("costPrice") || 0),
                    preferredVendorId: rawVendor && rawVendor !== "__none__" ? Number(rawVendor) : null,
                    barcode: String(fd.get("barcode") || "").trim() || null,
                  },
                });
              }}
              className="space-y-4"
            >
              <div><Label>Item Name *</Label><Input name="name" defaultValue={editItem.name} required className="mt-1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Unit *</Label><Input name="unit" defaultValue={editItem.unit} required className="mt-1" /></div>
                <div>
                  <Label>Category</Label>
                  <Select name="category" defaultValue={editItem.category}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Min Stock</Label><Input type="number" step="any" name="minStock" defaultValue={editItem.minStock} className="mt-1" /></div>
                <div><Label>Cost Price (₹)</Label><Input type="number" step="any" name="costPrice" defaultValue={editItem.costPrice} className="mt-1" /></div>
              </div>
              <div>
                <Label>Barcode / SKU</Label>
                <Input
                  name="barcode"
                  defaultValue={editItem.barcode ?? `INV-${editItem.id}`}
                  placeholder="INV-123 or custom code"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label>Preferred Vendor</Label>
                <Select
                  name="preferredVendorId"
                  defaultValue={editItem.preferredVendorId ? String(editItem.preferredVendorId) : "__none__"}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {vendors.filter(v => v.isActive || v.id === editItem.preferredVendorId).map(v => (
                      <SelectItem key={v.id} value={String(v.id)}>{v.name} ({v.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Current stock can only be changed via Stock In / Out / Adjust.</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
                <Button type="submit" disabled={updateItem.isPending}>Save Changes</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Multi-item Consumption Rule editor ──
          Lets the user pick a test, then add as many (item, quantity) rows
          as needed. Save calls the bulk PUT endpoint which atomically
          replaces every rule that exists for the chosen test. */}
      {ruleEditor && (
        <Dialog open onOpenChange={(o) => { if (!o) setRuleEditor(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {ruleEditor.mode === "edit" ? "Edit Consumption Rule" : "Add Consumption Rule"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Test *</Label>
                {ruleEditor.mode === "edit" ? (
                  // Test is locked when editing — switching tests is the same
                  // as deleting these rules and creating brand-new ones for
                  // a different test, which is confusing as a single action.
                  <div className="mt-1 px-3 py-2 rounded-md bg-muted/50 text-sm font-medium">
                    {testsData?.tests?.find((t) => t.id === Number(ruleEditor.testId))?.name
                      ?? `Test #${ruleEditor.testId}`}
                  </div>
                ) : (
                  <Select
                    value={ruleEditor.testId || undefined}
                    onValueChange={(v) => setRuleEditor((cur) => (cur ? { ...cur, testId: v } : cur))}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select test…" /></SelectTrigger>
                    <SelectContent>
                      {testsData?.tests
                        // Hide tests that already have a rule group — those use Edit, not Add,
                        // to avoid silently overwriting an existing rule on save.
                        ?.filter((t) => !rulesByTest.some((g) => g.testId === t.id))
                        .map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Consumed Items *</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addRow}>
                    <Plus size={12} className="mr-1" /> Add Item
                  </Button>
                </div>
                <div className="space-y-2 border border-card-border rounded-md p-2 bg-muted/20">
                  {ruleEditor.rows.map((row, idx) => {
                    const selectedItem = items.find((i) => i.id === Number(row.itemId));
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}.</span>
                        <Select
                          value={row.itemId || undefined}
                          onValueChange={(v) => updateRow(idx, { itemId: v })}
                        >
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Pick inventory item…" /></SelectTrigger>
                          <SelectContent>
                            {items
                              // Prevent duplicates within the SAME dialog session — the
                              // backend de-dupes by summing qty, but the UI is clearer
                              // if each item appears at most once.
                              .filter(
                                (i) =>
                                  String(i.id) === row.itemId ||
                                  !ruleEditor.rows.some((r, j) => j !== idx && r.itemId === String(i.id)),
                              )
                              .map((i) => (
                                <SelectItem key={i.id} value={String(i.id)}>
                                  {i.name} ({i.unit})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          step="any"
                          min="0.01"
                          value={row.quantity}
                          onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                          className="w-24"
                          placeholder="Qty"
                        />
                        <span className="text-xs text-muted-foreground w-12 truncate">
                          {selectedItem?.unit ?? ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => removeRow(idx)}
                          disabled={ruleEditor.rows.length === 1}
                          title="Remove this item"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Each item listed here is automatically deducted from stock when this test is ordered.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setRuleEditor(null)}>
                  Cancel
                </Button>
                <Button onClick={saveRuleEditor} disabled={saveTestRules.isPending}>
                  {saveTestRules.isPending ? "Saving…" : "Save Rule"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
