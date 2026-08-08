import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ClipboardList, FileText, Receipt, UserRound } from "lucide-react";

type TimelinePayload = {
  patient: {
    id: number;
    patientId: string;
    name: string;
    gender: string;
    phone: string;
  };
  counts: { orders: number; bills: number; reports: number; payments: number };
  events: Array<{
    id: string;
    type: "order" | "bill" | "report";
    at: string | null;
    title: string;
    status: string;
    detail?: string;
    href?: string;
    amount?: number;
    tests?: Array<{ id: number; name: string; department?: string | null; status: string }>;
    payments?: Array<{ id: number; amount: number; method: string; settlementStatus?: string | null; at: string | null }>;
    milestones?: Record<string, string | null>;
  }>;
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function fmtMoney(n: number | undefined) {
  if (n == null) return "";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function iconFor(type: TimelinePayload["events"][number]["type"]) {
  if (type === "bill") return Receipt;
  if (type === "report") return FileText;
  return ClipboardList;
}

export default function PatientTimeline() {
  const [, params] = useRoute<{ id: string }>("/patients/:id/timeline");
  const patientId = params?.id;
  const { data, isLoading, error, refetch, isFetching } = useQuery<TimelinePayload>({
    queryKey: ["/api/patients/timeline", patientId],
    queryFn: () => api.get(`/api/patients/${patientId}/timeline`),
    enabled: !!patientId,
  });

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Patient Timeline"
        subtitle="Bills, orders, payments, and reports in one chronological view."
      />

      {isLoading ? (
        <div className="rounded-xl border border-card-border p-8 text-sm text-muted-foreground">Loading timeline…</div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Failed to load patient timeline.
        </div>
      ) : data ? (
        <>
          <div className="rounded-xl border border-card-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <UserRound size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold">{data.patient.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {data.patient.patientId} · {data.patient.gender} · {data.patient.phone}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{data.counts.orders} orders</Badge>
              <Badge variant="outline">{data.counts.bills} bills</Badge>
              <Badge variant="outline">{data.counts.reports} reports</Badge>
              <Badge variant="outline">{data.counts.payments} payments</Badge>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                Refresh
              </Button>
            </div>
          </div>

          {data.events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-card-border p-10 text-center text-sm text-muted-foreground">
              No clinical or billing activity found for this patient yet.
            </div>
          ) : (
            <div className="space-y-3">
              {data.events.map((event) => {
                const Icon = iconFor(event.type);
                const critical = event.detail?.toLowerCase().includes("critical");
                return (
                  <div key={event.id} className="rounded-xl border border-card-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold truncate">{event.title}</h3>
                            <Badge variant={critical ? "destructive" : "secondary"} className="capitalize">
                              {event.status}
                            </Badge>
                            {critical && <AlertTriangle size={14} className="text-destructive" />}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {fmtDate(event.at)}{event.detail ? ` · ${event.detail}` : ""}
                            {event.amount != null ? ` · ${fmtMoney(event.amount)}` : ""}
                          </p>
                        </div>
                      </div>
                      {event.href && (
                        <Link href={event.href}>
                          <Button size="sm" variant="outline">Open</Button>
                        </Link>
                      )}
                    </div>

                    {event.tests && event.tests.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {event.tests.map((test) => (
                          <Badge key={test.id} variant="outline" className="text-[11px]">
                            {test.name}{test.department ? ` · ${test.department}` : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {event.payments && event.payments.length > 0 && (
                      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {event.payments.map((payment) => (
                          <div key={payment.id} className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                            <strong>{fmtMoney(payment.amount)}</strong> via {payment.method}
                            <div className="text-muted-foreground">{fmtDate(payment.at)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
