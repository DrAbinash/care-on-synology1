import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useCreateBill,
  useListOrders,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronRight, Printer, Search, X, Receipt, CalendarDays, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { readStaffSession, hasSubPermission } from "@/lib/staffSession";

type BillSearchResult = {
  id: number;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  createdAt: string;
  patientName: string;
  patientId: string;
  phone: string;
  doctorName?: string | null;
};

type BillForm = {
  orderId: number;
  discount?: number;
  dueDate?: string;
};

const STATUSES = ["draft", "pending", "partial", "paid", "cancelled"];

export default function Billing() {
  const session = readStaffSession();
  const canCreateBill = !session || hasSubPermission(session, "/billing", "create");
  const canReprint = !session || hasSubPermission(session, "/billing", "reprint");

  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Module B: billing date filter — defaults to "this month" so heavy clinics don't
  // load every bill on first paint. Operators can clear or widen the window.
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [createdBy, setCreatedBy] = useState("");
  const queryClient = useQueryClient();

  const { data: billCreators = [] } = useQuery<string[]>({
    queryKey: ["bills-creators"],
    queryFn: () => api.get("/api/bills/creators"),
    staleTime: 60_000,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const isSearching = debouncedSearch.length >= 2;

  const { data: searchResults, isFetching: searchFetching } = useQuery<BillSearchResult[]>({
    queryKey: ["bills-search", debouncedSearch],
    queryFn: () => api.get(`/api/bills/search?q=${encodeURIComponent(debouncedSearch)}`),
    enabled: isSearching,
    staleTime: 10_000,
  });

  const billsUrl = (() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    p.set("page", String(page));
    p.set("limit", "20");
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (createdBy) p.set("createdBy", createdBy);
    p.set("compact", "1");
    return `/api/bills?${p.toString()}`;
  })();

  const { data, isLoading } = useQuery<{
    bills: Array<{
      id: number; billNumber: string; totalAmount: number; paidAmount: number;
      balanceAmount: number; status: string; createdAt: string;
      patient?: { firstName: string; lastName: string; patientId: string } | null;
      order?: { orderNumber: string; doctor?: { name: string } | null } | null;
    }>;
    total: number; page: number; limit: number;
    totals: { totalAmount: number; paidAmount: number; balanceAmount: number };
  }>({
    queryKey: ["bills-list", status, page, dateFrom, dateTo, createdBy],
    queryFn: () => api.get(billsUrl),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const { data: orders } = useListOrders({ status: "completed", limit: 100 });

  const createBill = useCreateBill({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["bills-list"] });
        setOpen(false);
        reset();
      },
    },
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm<BillForm>();

  const onSubmit = (data: BillForm) => {
    createBill.mutate({ data: { orderId: Number(data.orderId), discount: data.discount ? Number(data.discount) : undefined, dueDate: data.dueDate || undefined } });
  };

  // ── Referral hand-off prefill (additive; brief §8 "billing pre-population") ──
  // When the HOPE Referrals inbox navigates here with ?orderId=<id>, preselect
  // that referral-created order in the Generate Bill dialog and open it. Bills
  // the EXISTING order via the unchanged createBill({orderId}) path — no
  // duplicate order and no change to the save/money logic. Run-once, opens the
  // dialog only (never auto-submits), and is a no-op without billing permission.
  const prefillRan = useRef(false);
  const [prefillOrderId, setPrefillOrderId] = useState<number | null>(null);
  const { data: prefillOrder } = useQuery<{ id: number; orderNumber: string; totalAmount: number | string; patient?: { firstName?: string; lastName?: string } | null }>({
    queryKey: ["billing-prefill-order", prefillOrderId],
    queryFn: () => api.get(`/api/orders/${prefillOrderId}`),
    enabled: prefillOrderId != null && canCreateBill,
  });
  useEffect(() => {
    if (prefillRan.current || !canCreateBill) return;
    const oid = Number(new URLSearchParams(window.location.search).get("orderId"));
    if (Number.isFinite(oid) && oid > 0) {
      prefillRan.current = true;
      setPrefillOrderId(oid);
      setValue("orderId", oid);
      setOpen(true);
      // Drop the param so a later remount / New Bill click starts clean.
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setValue]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

  return (
    <div className="pb-8 bg-slate-50 dark:bg-slate-900/20 min-h-full">
      <PageHeader
        title="Billing"
        subtitle={`${data?.total ?? 0} bills`}
        actions={
          canCreateBill && (
            <Button
              size="sm"
              onClick={() => { setOpen(true); reset(); }}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md"
            >
              <Plus size={14} className="mr-1" /> New Bill
            </Button>
          )
        }
      />

      <div className="px-6 space-y-4">
        {/* Bills card */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          {/* Section header with search + filters */}
          <div className="border-b border-slate-100 dark:border-border bg-gradient-to-r from-indigo-50 to-transparent border-l-4 border-l-indigo-500 px-4 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Receipt size={15} className="text-indigo-600" />
                <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Bills</span>
              </div>
              {/* Search bar */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient name, ID, or bill number…"
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            {/* Date / status / user filters — collapsed when searching */}
            {!isSearching && (
              <div className="space-y-2">
                {/* Quick date range chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <CalendarDays size={13} className="text-muted-foreground mr-1" />
                  {[
                    { label: "Today", fromDays: 0, toDays: 0 },
                    { label: "Yesterday", fromDays: 1, toDays: 1 },
                    { label: "Day Before", fromDays: 2, toDays: 2 },
                    { label: "Last 7 Days", fromDays: 6, toDays: 0 },
                    { label: "1 Month", fromDays: 30, toDays: 0 },
                  ].map((chip) => {
                    const eTo = new Date();
                    eTo.setDate(eTo.getDate() - chip.toDays);
                    const eFrom = new Date();
                    eFrom.setDate(eFrom.getDate() - chip.fromDays);
                    const toStr = eTo.toISOString().slice(0, 10);
                    const fromStr = eFrom.toISOString().slice(0, 10);
                    const chipActive = dateFrom === fromStr && dateTo === toStr;
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => { setPage(1); setDateFrom(fromStr); setDateTo(toStr); }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${chipActive ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  {(dateFrom || dateTo || createdBy) && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setPage(1); setDateFrom(""); setDateTo(""); setCreatedBy(""); }}>
                      <X size={12} className="mr-1" /> Clear
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={status || "all"} onValueChange={(v) => { setPage(1); setStatus(v === "all" ? "" : v); }}>
                      <SelectTrigger className="w-36 mt-0.5 h-8 text-sm">
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground flex items-center gap-1"><User size={11} /> User</Label>
                    <Select value={createdBy || "all"} onValueChange={(v) => { setPage(1); setCreatedBy(v === "all" ? "" : v); }}>
                      <SelectTrigger className="w-40 mt-0.5 h-8 text-sm">
                        <SelectValue placeholder="All Users" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {billCreators.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} className="w-36 mt-0.5 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value); }} className="w-36 mt-0.5 h-8 text-sm" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-muted/30">
                  <th className="px-4 py-3 font-medium">Bill No.</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  {!isSearching && <th className="px-4 py-3 font-medium">Order</th>}
                  <th className="px-4 py-3 font-medium">Referral</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Balance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {isSearching ? (
                  searchFetching ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={i} className="border-b border-border/50 animate-pulse">
                        {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>)}
                      </tr>
                    ))
                  ) : !searchResults?.length ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No bills match "{debouncedSearch}"</td></tr>
                  ) : (
                    searchResults.map((b) => (
                      <tr key={b.id} className={`border-b last:border-0 ${b.status === "cancelled" ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 opacity-80" : "border-border/50 hover:bg-muted/30"}`}>
                        <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{b.billNumber}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.patientName}</div>
                          <div className="text-xs text-muted-foreground">{b.patientId}{b.phone ? ` · ${b.phone}` : ""}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{b.doctorName ?? <span className="opacity-40">—</span>}</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatCurrency(b.totalAmount)}</td>
                        <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium">{formatCurrency(b.paidAmount)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={b.balanceAmount > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                            {formatCurrency(b.balanceAmount)}
                          </span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {canReprint && (
                              <a href={`/erp/billing/${b.id}?print=1`} target="_blank" rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground inline-flex p-1 rounded hover:bg-muted" title="Print Bill">
                                <Printer size={14} />
                              </a>
                            )}
                            <Link href={`/billing/${b.id}`} className="text-muted-foreground hover:text-foreground inline-flex p-1 rounded hover:bg-muted">
                              <ChevronRight size={16} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )
                ) : isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(9)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>)}
                    </tr>
                  ))
                ) : data?.bills?.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No bills found</td></tr>
                ) : (
                  data?.bills?.map((b) => (
                    <tr key={b.id} className={`border-b last:border-0 ${b.status === "cancelled" ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 opacity-80" : "border-border/50 hover:bg-muted/30"}`}>
                      <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{b.billNumber}</td>
                      <td className="px-4 py-3">
                        {b.patient && (
                          <div>
                            <div className="font-medium">{b.patient.firstName} {b.patient.lastName}</div>
                            <div className="text-xs text-muted-foreground">{b.patient.patientId}</div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{b.order?.orderNumber}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{(b.order as { doctor?: { name: string } | null })?.doctor?.name ?? <span className="opacity-40">—</span>}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(b.totalAmount)}</td>
                      <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium">{formatCurrency(b.paidAmount)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={b.balanceAmount > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                          {formatCurrency(b.balanceAmount)}
                        </span>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {canReprint && (
                            <a
                              href={`/erp/billing/${b.id}?print=1`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground inline-flex p-1 rounded hover:bg-muted"
                              title="Print Bill"
                            >
                              <Printer size={14} />
                            </a>
                          )}
                          <Link href={`/billing/${b.id}`} className="text-muted-foreground hover:text-foreground inline-flex p-1 rounded hover:bg-muted">
                            <ChevronRight size={16} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!isSearching && data && data.total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
          {isSearching && searchResults && searchResults.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{debouncedSearch}"
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Bill</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Select Order *</Label>
              <Select value={watch("orderId") ? String(watch("orderId")) : undefined} onValueChange={(v) => setValue("orderId", Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select completed order..." /></SelectTrigger>
                <SelectContent>
                  {prefillOrder && !orders?.orders?.some((o) => o.id === prefillOrder.id) && (
                    <SelectItem value={String(prefillOrder.id)}>
                      {prefillOrder.orderNumber} — {prefillOrder.patient?.firstName} {prefillOrder.patient?.lastName} (₹{Number(prefillOrder.totalAmount).toFixed(0)}) · HOPE referral
                    </SelectItem>
                  )}
                  {orders?.orders?.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.orderNumber} — {o.patient?.firstName} {o.patient?.lastName} (₹{Number(o.totalAmount).toFixed(0)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Discount (₹)</Label>
                <Input type="number" step="0.01" min="0" {...register("discount", { valueAsNumber: true })} className="mt-1" placeholder="0" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" {...register("dueDate")} className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBill.isPending}>
                {createBill.isPending ? "Generating..." : "Generate Bill"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
