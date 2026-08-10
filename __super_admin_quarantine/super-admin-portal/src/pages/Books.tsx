import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, BookOpen, Plus, Pencil, Trash2, Users, FileText,
  Calendar, AlertTriangle, Check, X, Loader2, Star, PersonStanding,
} from "lucide-react";
import {
  type Book,
  type Doctor,
} from "@workspace/api-client-react";
import { saAuthHeaders } from "@/lib/saApi";
import { doctorMatchesQuery } from "@/lib/doctorSearch";

const SA_BOOKS_KEY = ["/api/super-admin/books"] as const;
const SA_DOCTORS_KEY = ["/api/super-admin/doctors-list"] as const;

export default function BooksManager({ token, onBack }: { token: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [assignTarget, setAssignTarget] = useState<Book | null>(null);
  const [resetTarget, setResetTarget] = useState<Book | null>(null);
  const [resetReason, setResetReason] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  const { data: booksData, isLoading, error: booksError } = useQuery({
    queryKey: SA_BOOKS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/books", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load books");
      return res.json() as Promise<Book[]>;
    },
  });
  const books: Book[] = Array.isArray(booksData) ? booksData : [];

  useEffect(() => {
    if (booksError) {
      toast({ title: "Failed to load", description: "Network error", variant: "destructive" });
    }
  }, [booksError, toast]);

  const { data: doctorsData } = useQuery({
    queryKey: SA_DOCTORS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: Doctor[] }>;
    },
  });
  const doctors: Doctor[] = doctorsData?.doctors ?? [];

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/super-admin/books", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token, name }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<Book>;
    },
    onSuccess: (data) => {
      toast({ title: "Book created", description: data.name });
      setNewName("");
      queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Could not create", description: (e as Error).message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await fetch(`/api/super-admin/books/${id}`, {
        method: "PATCH",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token, name }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<Book>;
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Rename failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/books/${id}`, {
        method: "DELETE",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: (_, id) => {
      const book = books.find(b => b.id === id);
      toast({ title: "Book deleted", description: book?.name });
      queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
      queryClient.invalidateQueries({ queryKey: SA_DOCTORS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Cannot delete", description: (e as Error).message, variant: "destructive" });
    },
  });

  const setWalkInMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/books/${id}/set-walk-in`, {
        method: "POST",
        headers: saAuthHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ ok: boolean; walkInLedgerId: number; name: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Walk-in destination set", description: `"${data.name}" will now receive all walk-in / self-referral bills` });
      queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const res = await fetch(`/api/super-admin/books/${id}/reset`, {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{
        ok: boolean; book: string; by: string; reason: string;
        wiped: { bills: number; orders: number; patients: number };
      }>;
    },
    onSuccess: (body) => {
      toast({
        title: `"${body.book}" reset to bill #1`,
        description: `Wiped ${body.wiped.bills} bills \u00b7 ${body.wiped.orders} orders \u00b7 ${body.wiped.patients} patients`,
      });
      setResetTarget(null);
      setResetReason("");
      setResetConfirm("");
      queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: "Reset failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate(name);
  };

  const saveRename = (id: number) => {
    const name = editingName.trim();
    if (!name) { setEditingId(null); return; }
    renameMutation.mutate({ id, name });
  };

  const deleteBook = (book: Book) => {
    if (!confirm(`Delete the book "${book.name}"? Doctors assigned to it will move back to Default.`)) return;
    deleteMutation.mutate(book.id);
  };

  const doReset = () => {
    if (!resetTarget) return;
    if (resetConfirm !== resetTarget.name) {
      toast({ title: "Type the book name to confirm", variant: "destructive" });
      return;
    }
    if (resetReason.trim().length < 3) {
      toast({ title: "Reason is required (min 3 characters)", variant: "destructive" });
      return;
    }
    resetMutation.mutate({ id: resetTarget.id, reason: resetReason.trim() });
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft size={18} /></Button>
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Books / Ledgers</h1>
            <p className="text-xs text-muted-foreground">Partition bills, patients & financials by referral doctor groups</p>
          </div>
        </div>

        {/* Create new book */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-6">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Create new book</Label>
          <div className="flex gap-2 mt-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Dr Abinash + Dr Ramesh"
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <Button onClick={create} disabled={createMutation.isPending || !newName.trim()}>
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <Plus size={14} className="mr-1" />}
              Create
            </Button>
          </div>
        </div>

        {/* Books list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {books.map((b) => (
              <div key={b.id} className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    {editingId === b.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(b.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button size="icon" variant="ghost" onClick={() => saveRename(b.id)}><Check size={14} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X size={14} /></Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold">{b.name}</h3>
                        {b.isDefault && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded px-1.5 py-0.5">
                            <Star size={10} /> Default
                          </span>
                        )}
                        {b.isWalkIn && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded px-1.5 py-0.5">
                            <PersonStanding size={10} /> Walk-in
                          </span>
                        )}
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(b.id); setEditingName(b.name); }}>
                          <Pencil size={11} />
                        </Button>
                      </div>
                    )}
                  </div>
                  {!b.isDefault && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => deleteBook(b)}
                      className="text-destructive hover:bg-destructive/10"
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                  <Stat icon={Users} label="Doctors" value={b.doctorCount} />
                  <Stat icon={Users} label="Patients" value={b.patientCount} />
                  <Stat icon={FileText} label="Bills" value={b.billCount} />
                  <Stat icon={FileText} label="Orders" value={b.orderCount} />
                  <Stat icon={Calendar} label="Appointments" value={b.appointmentCount} />
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
                  <Button variant="outline" size="sm" onClick={() => setAssignTarget(b)}>
                    <Users size={13} className="mr-1.5" /> Assign Doctors
                  </Button>
                  {!b.isWalkIn && (
                    <Button
                      variant="outline" size="sm"
                      className="border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                      onClick={() => {
                        if (confirm(`Set "${b.name}" as the walk-in destination?\n\nAll future Walk-in / Self (no referral) bills will go to this book.`)) {
                          setWalkInMutation.mutate(b.id);
                        }
                      }}
                      disabled={setWalkInMutation.isPending}
                    >
                      <PersonStanding size={13} className="mr-1.5" /> Set as Walk-in
                    </Button>
                  )}
                  <Button
                    variant="outline" size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => { setResetTarget(b); setResetReason(""); setResetConfirm(""); }}
                  >
                    <AlertTriangle size={13} className="mr-1.5" /> Reset to Bill #1
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign doctors modal */}
      {assignTarget && (
        <AssignDoctorsModal
          book={assignTarget}
          allDoctors={doctors}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null);
            queryClient.invalidateQueries({ queryKey: SA_BOOKS_KEY });
            queryClient.invalidateQueries({ queryKey: SA_DOCTORS_KEY });
          }}
        />
      )}

      {/* Reset confirmation modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-destructive/40 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="text-destructive" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold">Reset &ldquo;{resetTarget.name}&rdquo;?</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  This permanently deletes <b>{resetTarget.billCount} bills</b>, <b>{resetTarget.orderCount} orders</b>,{" "}
                  <b>{resetTarget.patientCount} patients</b>, all payments and appointments in this book.
                  Doctors, tests and packages remain intact. Bill numbering restarts at <b>BILL-…-0001</b>.
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <Label className="text-xs">Reason</Label>
                <Input value={resetReason} onChange={(e) => setResetReason(e.target.value)} placeholder="Why are you resetting?" />
              </div>
              <div>
                <Label className="text-xs">Type <span className="font-mono text-destructive">{resetTarget.name}</span> to confirm</Label>
                <Input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={resetMutation.isPending || resetConfirm !== resetTarget.name || resetReason.trim().length < 3}
                onClick={doReset}
              >
                {resetMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
                Permanently Reset
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number }) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon size={10} /> {label}
      </div>
      <div className="text-lg font-bold mt-0.5">{value.toLocaleString("en-IN")}</div>
    </div>
  );
}

function AssignDoctorsModal({
  book, allDoctors, onClose, onSaved,
}: {
  book: Book;
  allDoctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(allDoctors.filter(d => d.ledgerId === book.id).map(d => d.id)),
  );
  const [filter, setFilter] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/super-admin/books/${book.id}/assign-doctors`, {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ doctorIds: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ assigned: number }>;
    },
    onSuccess: () => {
      toast({ title: "Doctors updated", description: `${selected.size} assigned to ${book.name}` });
      onSaved();
    },
    onError: (e: unknown) => {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const filtered = allDoctors.filter((d) => doctorMatchesQuery(d, filter));

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">Assign doctors to &ldquo;{book.name}&rdquo;</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Selected doctors will route their bills/orders to this book.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X size={16} /></Button>
        </div>

        <Input
          placeholder="Search by name (e.g. abi), specialty, or ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3"
        />

        <div className="flex-1 overflow-y-auto border border-border rounded-lg divide-y divide-border">
          {filtered.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-6">No doctors found.</div>
          )}
          {filtered.map(d => {
            const isHere = selected.has(d.id);
            const elsewhere = !isHere && d.ledgerId && d.ledgerId !== book.id;
            return (
              <label key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 cursor-pointer">
                <input type="checkbox" checked={isHere} onChange={() => toggle(d.id)} className="w-4 h-4" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{d.specialization}</div>
                </div>
                {elsewhere && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                    in another book
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
