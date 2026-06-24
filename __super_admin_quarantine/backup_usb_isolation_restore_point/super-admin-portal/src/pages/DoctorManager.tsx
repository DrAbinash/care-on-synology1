import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Stethoscope, AlertTriangle, Trash2, Loader2, BookOpen,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";

type SaDoctor = {
  id: number;
  name: string;
  specialization: string | null;
  ledgerId: number | null;
  defaultCommission: number | null;
  defaultCommissionType: string | null;
};

type SaBook = { id: number; name: string };

const SA_DOCTORS_KEY = ["/api/super-admin/doctors-list"] as const;
const SA_BOOKS_KEY = ["/api/super-admin/books"] as const;

export default function DoctorManager({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [purgeTarget, setPurgeTarget] = useState<SaDoctor | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState("");

  const { data: doctorsData, isLoading: doctorsLoading } = useQuery({
    queryKey: SA_DOCTORS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });

  const { data: booksData } = useQuery({
    queryKey: SA_BOOKS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/books", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load books");
      return res.json() as Promise<SaBook[]>;
    },
  });

  const doctors = doctorsData?.doctors ?? [];
  const books = Array.isArray(booksData) ? booksData : [];
  const bookMap = new Map(books.map((b) => [b.id, b.name]));

  const purgeMutation = useMutation({
    mutationFn: async ({ doctorId, confirmPhrase }: { doctorId: number; confirmPhrase: string }) => {
      const res = await fetch("/api/super-admin/doctors/purge", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ doctorIds: [doctorId], confirmPhrase }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ deleted: Record<string, number> }>;
    },
    onSuccess: (data, vars) => {
      const totals = Object.values(data.deleted).reduce((s, n) => s + n, 0);
      toast({
        title: "Data purged",
        description: `${totals} record(s) deleted for doctor #${vars.doctorId}`,
      });
      setPurgeTarget(null);
      setPurgeConfirm("");
      queryClient.invalidateQueries({ queryKey: SA_DOCTORS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Purge failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const doPurge = () => {
    if (!purgeTarget) return;
    if (purgeConfirm.trim() !== "DELETE MY DATA") {
      toast({ title: "Confirm phrase mismatch", description: 'Type DELETE MY DATA exactly to proceed.', variant: "destructive" });
      return;
    }
    purgeMutation.mutate({ doctorId: purgeTarget.id, confirmPhrase: purgeConfirm.trim() });
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft size={18} /></Button>
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Stethoscope className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Doctors</h1>
            <p className="text-xs text-muted-foreground">Manage referring doctors and purge their data</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-6 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Irreversible deletion</p>
            <p className="mt-0.5">
              Purging a doctor deletes all their orders, bills, patients, appointments, payments,
              reports, and linked records across 30+ tables. This action cannot be undone.
            </p>
          </div>
        </div>

        {/* Doctors list */}
        {doctorsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading…
          </div>
        ) : doctors.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No doctors found.
          </div>
        ) : (
          <div className="space-y-3">
            {doctors.map((d) => (
              <div
                key={d.id}
                className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold">{d.name}</h3>
                    {d.specialization && (
                      <span className="text-[10px] uppercase tracking-wide bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {d.specialization}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>ID #{d.id}</span>
                    {d.ledgerId && (
                      <span className="inline-flex items-center gap-1">
                        <BookOpen size={10} />
                        {bookMap.get(d.ledgerId) ?? `Book #${d.ledgerId}`}
                      </span>
                    )}
                    {d.defaultCommission != null && (
                      <span>
                        Commission: {d.defaultCommissionType === "percentage" ? `${d.defaultCommission}%` : `₹${d.defaultCommission}`}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => { setPurgeTarget(d); setPurgeConfirm(""); }}
                >
                  <Trash2 size={13} className="mr-1.5" /> Purge Data
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Purge confirmation dialog */}
        {purgeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-card border border-border rounded-xl shadow-lg max-w-md w-full p-5 space-y-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle size={18} />
                <h2 className="text-base font-bold">Purge All Data for {purgeTarget.name}</h2>
              </div>

              <p className="text-sm text-muted-foreground">
                This will permanently delete every record linked to <strong>{purgeTarget.name}</strong>:
                orders, bills, patients, appointments, payments, reports, samples, studies,
                vouchers, tokens, and audit trails. There is no recovery option.
              </p>

              <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-xs space-y-1">
                <p className="font-semibold text-destructive">Type the confirmation phrase to proceed:</p>
                <p className="font-mono bg-background border border-border rounded px-2 py-1">DELETE MY DATA</p>
              </div>

              <div>
                <Label>Confirmation phrase</Label>
                <Input
                  className="mt-1"
                  value={purgeConfirm}
                  onChange={(e) => setPurgeConfirm(e.target.value)}
                  placeholder="DELETE MY DATA"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => { setPurgeTarget(null); setPurgeConfirm(""); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={purgeMutation.isPending || purgeConfirm.trim() !== "DELETE MY DATA"}
                  onClick={doPurge}
                >
                  {purgeMutation.isPending ? (
                    <><Loader2 size={14} className="animate-spin mr-1.5" /> Purging…</>
                  ) : (
                    <><Trash2 size={14} className="mr-1.5" /> Purge Data</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
