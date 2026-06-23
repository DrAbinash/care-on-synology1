import { Link } from "wouter";
import { useGetOrder, useUpdateOrder, getGetOrderQueryKey, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const STATUS_FLOW = ["pending", "collected", "processing", "completed"];

export default function OrderDetail({ id }: { id: number }) {
  const { data: order, isLoading } = useGetOrder(id);
  const queryClient = useQueryClient();
  const updateOrder = useUpdateOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      },
    },
  });

  if (isLoading) return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-64" /></div>;
  if (!order) return <div className="p-6 text-muted-foreground">Order not found.</div>;

  const currentIdx = STATUS_FLOW.indexOf(order.status);
  const nextStatus = STATUS_FLOW[currentIdx + 1] as string | undefined;

  const advanceStatus = () => {
    if (nextStatus) updateOrder.mutate({ id, data: { status: nextStatus as "pending" | "collected" | "processing" | "completed" | "cancelled" } });
  };

  return (
    <div className="pb-8">
      <div className="px-6 pt-4">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} /> Back to Orders
        </Link>
      </div>

      <PageHeader
        title={order.orderNumber}
        subtitle={`Created ${new Date(order.createdAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            {order.status !== "completed" && order.status !== "cancelled" && nextStatus && (
              <Button size="sm" onClick={advanceStatus} disabled={updateOrder.isPending}>
                Mark as {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
              </Button>
            )}
            {order.status !== "cancelled" && order.status !== "completed" && (
              <Button size="sm" variant="destructive" onClick={() => updateOrder.mutate({ id, data: { status: "cancelled" } })}>
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6 space-y-5">
        {/* Status progress */}
        <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Status Progress</h3>
          <div className="flex items-center gap-0">
            {STATUS_FLOW.map((s, i) => {
              const done = STATUS_FLOW.indexOf(order.status) >= i;
              const current = order.status === s;
              return (
                <div key={s} className="flex items-center flex-1 last:flex-none">
                  <div className={`flex flex-col items-center`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${done ? "bg-primary border-primary text-white" : "border-border text-muted-foreground"}`}>
                      {i + 1}
                    </div>
                    <span className={`mt-1 text-xs ${current ? "text-primary font-semibold" : done ? "text-foreground" : "text-muted-foreground"}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                  </div>
                  {i < STATUS_FLOW.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${done && order.status !== s ? "bg-primary" : "bg-border"}`} />}
                </div>
              );
            })}
          </div>
          {order.status === "cancelled" && (
            <div className="mt-3 px-3 py-2 bg-destructive/10 text-destructive rounded-lg text-sm font-medium">
              Order Cancelled
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Patient & Doctor */}
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Patient</h3>
            {order.patient && (
              <div>
                <Link href={`/patients/${order.patient.id}`} className="font-semibold text-primary hover:underline">{order.patient.firstName} {order.patient.lastName}</Link>
                <p className="text-xs text-muted-foreground">{order.patient.patientId} · {order.patient.phone}</p>
              </div>
            )}
            {order.doctor && (
              <>
                <div className="border-t border-border/50 pt-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Referring Doctor</h3>
                  <p className="text-sm font-medium">{order.doctor.name}</p>
                  <p className="text-xs text-muted-foreground">{order.doctor.specialization}</p>
                </div>
              </>
            )}
            {order.notes && (
              <div className="pt-2 text-sm text-muted-foreground italic">"{order.notes}"</div>
            )}
          </div>

          {/* Financial summary */}
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Summary</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tests</span>
                <span>{order.tests?.length ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-border pt-1.5 mt-1.5">
                <span>Total</span>
                <span className="text-foreground">₹{Number(order.totalAmount).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border">
              <Link href="/billing" asChild>
                <Button size="sm" variant="outline" className="w-full">Create Bill</Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Tests list */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Tests Ordered</h2>
          <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Test Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {order.tests?.map((ot) => (
                  <tr key={ot.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{ot.test?.code}</td>
                    <td className="px-4 py-3 font-medium">{ot.test?.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ot.test?.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ot.test?.duration}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{Number(ot.price).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td colSpan={4} className="px-4 py-3 text-sm font-bold text-right">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">₹{Number(order.totalAmount).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
