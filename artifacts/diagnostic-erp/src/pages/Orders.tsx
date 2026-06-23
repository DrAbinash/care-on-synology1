import { useState } from "react";
import { Link } from "wouter";
import {
  useListOrders,
  useCreateOrder,
  useListPatients,
  useListTests,
  useListDoctors,
  getListOrdersQueryKey,
  ListOrdersStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Plus, Search, ChevronRight, X } from "lucide-react";
import { useForm } from "react-hook-form";

type OrderForm = {
  patientId: number;
  doctorId?: number;
  notes?: string;
};

const STATUSES = ["pending", "collected", "processing", "completed", "cancelled"];

export default function Orders() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState<number[]>([]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useListOrders({ status: (status || undefined) as ListOrdersStatus | undefined, page, limit: 20 });
  const { data: patients } = useListPatients({ limit: 200 });
  const { data: tests } = useListTests();
  const { data: doctors } = useListDoctors();

  const createOrder = useCreateOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        setOpen(false);
        reset();
        setSelectedTestIds([]);
      },
    },
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm<OrderForm>();

  const onSubmit = (data: OrderForm) => {
    if (selectedTestIds.length === 0) return;
    createOrder.mutate({
      data: {
        patientId: Number(data.patientId),
        doctorId: data.doctorId ? Number(data.doctorId) : undefined,
        testIds: selectedTestIds,
        notes: data.notes || undefined,
      },
    });
  };

  const toggleTest = (id: number) => {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedTests = tests?.tests?.filter((t) => selectedTestIds.includes(t.id)) ?? [];
  const total = selectedTests.reduce((sum, t) => sum + Number(t.price), 0);

  return (
    <div className="pb-8 bg-slate-50 dark:bg-slate-900/20 min-h-full">
      <PageHeader
        title="Orders"
        subtitle={`${data?.total ?? 0} total orders`}
        actions={
          <Button
            size="sm"
            onClick={() => { setOpen(true); reset(); setSelectedTestIds([]); }}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md"
          >
            <Plus size={14} className="mr-1" /> New Order
          </Button>
        }
      />

      <div className="px-6 space-y-4">
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-blue-50 to-transparent border-l-4 border-l-blue-500">
            <div className="flex items-center gap-2">
              <Search size={15} className="text-blue-600" />
              <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Test Orders</span>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative min-w-[200px] max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search orders..." className="pl-9 h-8 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-muted/30">
                  <th className="px-4 py-3 font-medium">Order No.</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Doctor</th>
                  <th className="px-4 py-3 font-medium">Tests</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>)}
                    </tr>
                  ))
                ) : data?.orders?.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No orders found</td></tr>
                ) : (
                  data?.orders?.map((o) => (
                    <tr key={o.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{o.orderNumber}</td>
                      <td className="px-4 py-3">
                        {o.patient ? (
                          <div>
                            <div className="font-medium text-foreground">{o.patient.firstName} {o.patient.lastName}</div>
                            <div className="text-xs text-muted-foreground">{o.patient.patientId}</div>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{o.doctor?.name ?? <span className="text-muted-foreground/40">—</span>}</td>
                      <td className="px-4 py-3 text-muted-foreground">{o.tests?.length ?? 0} test(s)</td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-right font-semibold">₹{Number(o.totalAmount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <Link href={`/orders/${o.id}`} className="text-muted-foreground hover:text-foreground inline-flex">
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create order dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Test Order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Patient *</Label>
                <Select onValueChange={(v) => setValue("patientId", Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select patient..." /></SelectTrigger>
                  <SelectContent>
                    {patients?.patients?.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.firstName} {p.lastName} ({p.patientId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Referring Doctor</Label>
                <Select onValueChange={(v) => setValue("doctorId", Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select doctor..." /></SelectTrigger>
                  <SelectContent>
                    {doctors?.doctors?.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name} — {d.specialization}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Input {...register("notes")} className="mt-1" placeholder="e.g. Fasting required" />
            </div>

            {/* Test selection */}
            <div>
              <Label className="mb-2 block">Select Tests *</Label>
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-52 overflow-y-auto divide-y divide-border">
                  {tests?.tests?.filter((t) => t.isActive).map((t) => (
                    <label key={t.id} className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/30">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={selectedTestIds.includes(t.id)}
                          onChange={() => toggleTest(t.id)}
                          className="rounded"
                        />
                        <div>
                          <div className="text-sm font-medium text-foreground">{t.name}</div>
                          <div className="text-xs text-muted-foreground">{t.code} · {t.category} · {t.duration}</div>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-foreground">₹{Number(t.price).toFixed(0)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {selectedTestIds.length > 0 && (
                <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedTests.map((t) => (
                      <span key={t.id} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                        {t.code}
                        <button type="button" onClick={() => toggleTest(t.id)}><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                  <p className="text-sm font-bold text-foreground">Total: ₹{total.toFixed(2)}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={selectedTestIds.length === 0 || createOrder.isPending}>
                {createOrder.isPending ? "Creating..." : "Create Order"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
