import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListExpenses,
  useGetExpensesSummary,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  getListExpensesQueryKey,
  getGetExpensesSummaryQueryKey,
  type Expense,
  type ExpenseSummaryRow,
} from "@workspace/api-client-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  Plus,
  Edit2,
  Trash2,
  Search,
  TrendingDown,
  IndianRupee,
  Filter,
  PieChart,
  X,
} from "lucide-react";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const CATEGORIES = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "equipment",
  "marketing",
  "travel",
  "miscellaneous",
];

const PAYMENT_MODES = ["cash", "bank-transfer", "cheque", "upi", "card"];

const CATEGORY_COLORS: Record<string, string> = {
  rent: "bg-blue-100 text-blue-700",
  salaries: "bg-purple-100 text-purple-700",
  utilities: "bg-yellow-100 text-yellow-700",
  supplies: "bg-green-100 text-green-700",
  maintenance: "bg-orange-100 text-orange-700",
  equipment: "bg-cyan-100 text-cyan-700",
  marketing: "bg-pink-100 text-pink-700",
  travel: "bg-teal-100 text-teal-700",
  miscellaneous: "bg-gray-100 text-gray-700",
};

const EMPTY_FORM = {
  category: "miscellaneous",
  description: "",
  amount: "",
  expenseDate: new Date().toISOString().slice(0, 10),
  paymentMode: "cash",
  paidTo: "",
  approvedBy: "",
  notes: "",
};

export default function Expenses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editExp, setEditExp] = useState<Expense | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState<"list" | "summary">("list");

  const listParams = {
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    paymentMode: paymentFilter !== "all" ? paymentFilter : undefined,
    from: from || undefined,
    to: to || undefined,
    search: search || undefined,
  };

  const summaryParams = {
    from: from || undefined,
    to: to || undefined,
  };

  const { data: expenses = [], isLoading } = useListExpenses(listParams);

  const { data: summary = [] } = useGetExpensesSummary(summaryParams);

  function invalidateExpenses() {
    qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetExpensesSummaryQueryKey() });
  }

  const createMut = useCreateExpense({
    mutation: {
      onSuccess: () => {
        invalidateExpenses();
        setShowForm(false);
        setForm({ ...EMPTY_FORM });
        toast({ title: "Expense recorded" });
      },
      onError: () => toast({ title: "Failed to record expense", variant: "destructive" }),
    },
  });

  const updateMut = useUpdateExpense({
    mutation: {
      onSuccess: () => {
        invalidateExpenses();
        setEditExp(null);
        toast({ title: "Expense updated" });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    },
  });

  const deleteMut = useDeleteExpense({
    mutation: {
      onSuccess: () => {
        invalidateExpenses();
        toast({ title: "Expense deleted" });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  function openEdit(exp: Expense) {
    setEditExp(exp);
    setForm({
      category: exp.category,
      description: exp.description,
      amount: String(exp.amount),
      expenseDate: exp.expenseDate,
      paymentMode: exp.paymentMode,
      paidTo: exp.paidTo || "",
      approvedBy: exp.approvedBy || "",
      notes: exp.notes || "",
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      category: form.category,
      description: form.description,
      amount: Number(form.amount),
      expenseDate: form.expenseDate,
      paymentMode: form.paymentMode,
      paidTo: form.paidTo || null,
      approvedBy: form.approvedBy || null,
      notes: form.notes || null,
    };
    if (editExp) {
      updateMut.mutate({ id: editExp.id, data: body });
    } else {
      createMut.mutate({ data: body });
    }
  }

  const totalExpenses = expenses.reduce((s: number, e: Expense) => s + e.amount, 0);
  const grandTotal = summary.reduce((s: number, r: ExpenseSummaryRow) => s + r.total, 0);

  const hasFilters = categoryFilter !== "all" || paymentFilter !== "all" || from || to || search;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Expense Management"
        subtitle="Track and manage operational expenses"
        actions={
          <Button onClick={() => { setShowForm(true); setForm({ ...EMPTY_FORM }); }}>
            <Plus size={15} className="mr-1.5" /> Add Expense
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-card-border">
        {[
          { key: "list", label: "Expense List", icon: Wallet },
          { key: "summary", label: "Category Summary", icon: PieChart },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as "list" | "summary")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs w-52"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={setPaymentFilter}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Payment mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modes</SelectItem>
            {PAYMENT_MODES.map((m) => (
              <SelectItem key={m} value={m} className="capitalize">{m.replace("-", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 text-xs w-36"
          placeholder="From"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 text-xs w-36"
          placeholder="To"
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => {
              setSearch("");
              setCategoryFilter("all");
              setPaymentFilter("all");
              setFrom("");
              setTo("");
            }}
          >
            <X size={12} className="mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* LIST TAB */}
      {activeTab === "list" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {expenses.length} record{expenses.length !== 1 ? "s" : ""} — Total: <strong className="text-foreground">{inr(totalExpenses)}</strong>
            </span>
          </div>

          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : expenses.length === 0 ? (
              <div className="p-12 text-center">
                <TrendingDown size={36} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground text-sm">No expenses recorded</p>
                <Button className="mt-4" size="sm" onClick={() => setShowForm(true)}>
                  <Plus size={13} className="mr-1" /> Add First Expense
                </Button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-card-border bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Paid To</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Mode</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp: Expense) => {
                    const catColor = CATEGORY_COLORS[exp.category] || "bg-gray-100 text-gray-700";
                    return (
                      <tr key={exp.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{exp.expenseId}</td>
                        <td className="px-4 py-3 text-xs">
                          {new Date(exp.expenseDate + "T00:00:00").toLocaleDateString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${catColor}`}>
                            {exp.category}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{exp.description}</div>
                          {exp.notes && <div className="text-xs text-muted-foreground">{exp.notes}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{exp.paidTo || "—"}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs capitalize">{exp.paymentMode.replace("-", " ")}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{inr(exp.amount)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEdit(exp)}
                            >
                              <Edit2 size={12} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm("Delete this expense?")) deleteMut.mutate({ id: exp.id });
                              }}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-card-border bg-muted/30">
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-right">Total</td>
                    <td className="px-4 py-3 text-right font-bold">{inr(totalExpenses)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}

      {/* SUMMARY TAB */}
      {activeTab === "summary" && (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Grand total: <strong className="text-foreground">{inr(grandTotal)}</strong>
          </div>
          {summary.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No data in selected range</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {summary.map((row: ExpenseSummaryRow) => {
                const pct = grandTotal ? (row.total / grandTotal) * 100 : 0;
                const catColor = CATEGORY_COLORS[row.category] || "bg-gray-100 text-gray-700";
                return (
                  <div key={row.category} className="bg-card border border-card-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${catColor}`}>
                        {row.category}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.count} entries</span>
                    </div>
                    <div className="text-xl font-bold">{inr(row.total)}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Share of total</span>
                        <span>{pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog
        open={showForm || !!editExp}
        onOpenChange={(o) => {
          if (!o) { setShowForm(false); setEditExp(null); }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editExp ? "Edit Expense" : "Record Expense"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Description *</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What was this expense for?"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <div className="relative">
                  <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="pl-8"
                    placeholder="0"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Mode *</Label>
                <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">{m.replace("-", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Paid To</Label>
                <Input
                  value={form.paidTo}
                  onChange={(e) => setForm({ ...form, paidTo: e.target.value })}
                  placeholder="Vendor / person name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Approved By</Label>
                <Input
                  value={form.approvedBy}
                  onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
                  placeholder="Approver name"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any additional notes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowForm(false); setEditExp(null); }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {createMut.isPending || updateMut.isPending
                  ? "Saving…"
                  : editExp
                  ? "Update Expense"
                  : "Record Expense"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
