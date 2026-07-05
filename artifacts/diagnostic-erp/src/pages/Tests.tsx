import { useState, useRef } from "react";
import {
  useListTests,
  useCreateTest,
  useUpdateTest,
  useDeleteTest,
  getListTestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { buildCsv, downloadCsv, parseCsv } from "@/lib/csv";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Pencil, Settings2, Trash2, Download, Upload, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

type TestForm = {
  code: string;
  name: string;
  category: string;
  price: number;
  duration: string;
  description?: string;
  isActive: boolean;
  department?: string;
  roomNumber?: string;
  roomId?: number | null;
  modalityId?: number | null;
  testType?: string;
  outsourcedLabId?: number | null;
  outsourceCost?: string | number | null;
};

type RoomOption = { id: number; name: string; floorName: string | null; isActive: boolean };
type ModalityOption = { id: number; name: string; isActive: boolean };

const NO_OUTSOURCED_LAB = "__none__";

type OutsourcedLab = { id: number; name: string; isActive: boolean };

const DEPARTMENT_OPTIONS = [
  "Pathology", "X-Ray", "USG", "MRI", "CT", "ECG",
  "Endoscopy", "Mammography", "Cardiology", "Dental", "Other",
];

type TestCategory = {
  id: number;
  name: string;
  isActive: boolean;
  testCount: number;
};

const TEST_CATEGORIES_KEY = ["test-categories"] as const;
const OUTSOURCED_LABS_KEY = ["outsourced-labs"] as const;

function useTestCategories() {
  return useQuery<TestCategory[]>({
    queryKey: TEST_CATEGORIES_KEY,
    queryFn: () => api.get<TestCategory[]>("/api/test-categories"),
  });
}

function useOutsourcedLabs() {
  return useQuery<OutsourcedLab[]>({
    queryKey: OUTSOURCED_LABS_KEY,
    queryFn: () => api.get<OutsourcedLab[]>("/api/outsourced-labs"),
  });
}

function useRooms() {
  return useQuery<RoomOption[]>({
    queryKey: ["rooms"],
    queryFn: () => api.get<RoomOption[]>("/api/rooms"),
  });
}

function useModalities() {
  return useQuery<ModalityOption[]>({
    queryKey: ["modalities"],
    queryFn: () => api.get<ModalityOption[]>("/api/modalities"),
  });
}

export default function Tests() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editTest, setEditTest] = useState<{ id: number } & TestForm | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useListTests({ search: search || undefined, category: category || undefined });
  const { data: allCategories = [] } = useTestCategories();
  const { data: outsourcedLabs = [] } = useOutsourcedLabs();
  const { data: rooms = [] } = useRooms();
  const { data: modalities = [] } = useModalities();
  const activeCategories = allCategories.filter((c) => c.isActive);
  const activeOutsourcedLabs = outsourcedLabs.filter((l) => l.isActive);
  const activeRooms = rooms.filter((r) => r.isActive);
  const activeModalities = modalities.filter((m) => m.isActive);

  const [submitErr, setSubmitErr] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Export the entire test catalog as a CSV file. Always exports the FULL
  // catalog (ignores the current search/category filter) so a single click
  // produces a complete backup the user can re-import elsewhere.
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get<{ tests: Array<{
        code: string; name: string; category: string; department?: string;
        price: number | string; duration: string; roomNumber?: string;
        description?: string | null; isActive: boolean;
      }>; total: number }>("/api/tests?limit=10000");
      const rows = (res?.tests ?? []).map((t) => ({
        code: t.code, name: t.name, category: t.category, department: t.department ?? "",
        price: Number(t.price).toFixed(2), duration: t.duration, roomNumber: t.roomNumber ?? "",
        description: t.description ?? "", isActive: t.isActive ? "true" : "false",
      }));
      const csv = buildCsv(
        ["code","name","category","department","price","duration","roomNumber","description","isActive"],
        rows,
      );
      downloadCsv(csv, `test-catalog-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: "Export ready", description: `${rows.length} tests downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message || "Could not export the catalog.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // Import a CSV the user picks from disk. Tests are upserted by `code`
  // server-side, so re-importing the same file is safe (it will just
  // refresh existing rows). Returns a toast summary with insert/update/skip
  // counts plus the first row error if any.
  const onImportFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";  // allow picking the same file again later
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No data rows found in the CSV.", variant: "destructive" });
        return;
      }
      const normalizedRows = rows.map((row) => ({
        code: row.code ?? row.testCode ?? row.test_code ?? row.Code ?? row["test code"] ?? "",
        name: row.name ?? row.testName ?? row.test_name ?? row["Test Name"] ?? row["name "] ?? "",
        category: row.category ?? row.testCategory ?? row.test_category ?? row["Category"] ?? "",
        department: row.department ?? row.Department ?? "Pathology",
        price: row.price ?? row.Price ?? "",
        duration: row.duration ?? row.Duration ?? "30 min",
        roomNumber: row.roomNumber ?? row.room_number ?? row.room ?? "",
        description: row.description ?? row.Description ?? "",
        isActive: row.isActive ?? row.is_active ?? row.active ?? row.Active ?? "true",
      }));
      const result = await api.post<{ inserted: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }>(
        "/api/tests/import", { rows: normalizedRows },
      );
      queryClient.invalidateQueries({ queryKey: getListTestsQueryKey() });
      const desc = `${result.inserted} added, ${result.updated} updated`
        + (result.skipped > 0 ? `, ${result.skipped} skipped` : "")
        + (result.errors[0] ? ` — first issue: row ${result.errors[0].row}: ${result.errors[0].reason}` : "");
      toast({
        title: result.skipped > 0 ? "Import finished with warnings" : "Import complete",
        description: desc,
        variant: result.skipped > 0 ? "destructive" : "default",
      });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message || "Could not import the file.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const createTest = useCreateTest({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTestsQueryKey() }); setOpen(false); setSubmitErr(""); reset(); },
      onError: (e: Error) => setSubmitErr(e.message || "Could not save the test"),
    },
  });
  const updateTest = useUpdateTest({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTestsQueryKey() }); setEditTest(null); setSubmitErr(""); },
      onError: (e: Error) => setSubmitErr(e.message || "Could not update the test"),
    },
  });
  const deleteTest = useDeleteTest({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListTestsQueryKey() }); toast({ title: "Test deleted" }); },
      onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm<TestForm>({ defaultValues: { isActive: true } });

  const onSubmit = (data: TestForm) => {
    setSubmitErr("");
    // Surface the silent-failure case where the user opened the dialog and
    // hit Save without selecting a category from the dropdown. The Select
    // only registers the field via setValue, so react-hook-form's `required`
    // can't catch this for us.
    if (!data.category || !data.category.trim()) {
      setSubmitErr("Please pick a category. Click 'Categories' to add one if the list is empty.");
      return;
    }
    const testType = data.testType ?? "inhouse";
    const outsourcedLabId = testType === "outsourced" ? data.outsourcedLabId ?? null : null;
    if (testType === "outsourced" && !outsourcedLabId) {
      setSubmitErr("Please select an outsourced lab for outsourced tests.");
      return;
    }
    if (!Number.isFinite(Number(data.price)) || Number(data.price) < 0) {
      setSubmitErr("Price must be a positive number.");
      return;
    }
    // Cast through unknown so the codegen'd zod doesn't reject the new
    // department/roomNumber fields. The server reads them off req.body.
    const payload = {
      ...data,
      price: Number(data.price),
      testType,
      outsourcedLabId,
      roomId: data.roomId ?? null,
      modalityId: data.modalityId ?? null,
      outsourceCost: data.outsourceCost ? Number(data.outsourceCost) : null,
    } as unknown as Parameters<typeof createTest.mutate>[0]["data"];
    if (editTest) {
      updateTest.mutate({ id: editTest.id, data: payload as unknown as Parameters<typeof updateTest.mutate>[0]["data"] });
    } else {
      createTest.mutate({ data: payload });
    }
  };

  const openEdit = (t: { id: number; code: string; name: string; category: string; price: number; duration: string; description?: string | null; isActive: boolean; department?: string; roomNumber?: string; roomId?: number | null; modalityId?: number | null; testType?: string | null; outsourcedLabId?: number | null; outsourceCost?: string | number | null }) => {
    const tx = t as typeof t & { department?: string; roomNumber?: string; roomId?: number | null; modalityId?: number | null; testType?: string | null; outsourcedLabId?: number | null; outsourceCost?: string | number | null };
    setEditTest({ id: t.id, code: t.code, name: t.name, category: t.category, price: t.price, duration: t.duration, description: t.description ?? "", isActive: t.isActive, department: tx.department, roomNumber: tx.roomNumber, roomId: tx.roomId ?? null, modalityId: tx.modalityId ?? null, testType: tx.testType ?? "inhouse", outsourcedLabId: tx.outsourcedLabId ?? null, outsourceCost: tx.outsourceCost ?? null });
    setValue("code", t.code);
    setValue("name", t.name);
    setValue("category", t.category);
    setValue("price", t.price);
    setValue("duration", t.duration);
    setValue("description", t.description ?? "");
    setValue("isActive", t.isActive);
    setValue("department", tx.department ?? "Pathology");
    setValue("roomId", tx.roomId ?? null);
    setValue("modalityId", tx.modalityId ?? null);
    setValue("testType", tx.testType ?? "inhouse");
    setValue("outsourcedLabId", tx.outsourcedLabId ?? null);
    setValue("outsourceCost", t.outsourceCost != null ? Number(t.outsourceCost) : null);
    setOpen(true);
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Test Catalog"
        subtitle={`${data?.total ?? 0} diagnostic tests`}
        actions={
          <div className="flex gap-2">
            <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFileChosen} />
            <Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={importing} title="Upload a CSV to add or update tests in bulk (matched by `code`)">
              <Upload size={14} className="mr-1" /> {importing ? "Importing…" : "Import CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting} title="Download the entire catalog as CSV">
              <Download size={14} className="mr-1" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
              <Settings2 size={14} className="mr-1" /> Categories
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDupOpen(true)}>
              <AlertTriangle size={14} className="mr-1" /> Duplicates
            </Button>
            <Button size="sm" onClick={() => { setEditTest(null); reset({ isActive: true }); setOpen(true); }}>
              <Plus size={14} className="mr-1" /> Add Test
            </Button>
          </div>
        }
      />

      <div className="px-6 space-y-4">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search tests..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {activeCategories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="inhouse">In-House</SelectItem>
              <SelectItem value="outsourced">Outsourced</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Test Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium text-right">Outsource Cost</th>
                  <th className="px-4 py-3 font-medium">Status</th>
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
                ) : data?.tests?.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No tests found</td></tr>
                ) : (
                  data?.tests?.filter((t) => {
                    if (!typeFilter) return true;
                    const tt = (t as { testType?: string }).testType ?? "inhouse";
                    return tt === typeFilter;
                  }).map((t) => {
                    const testType = (t as { testType?: string }).testType ?? "inhouse";
                    return (
                    <tr key={t.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{t.code}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{t.name}</div>
                        {t.description && <div className="text-xs text-muted-foreground truncate max-w-xs">{t.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">{t.category}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${testType === "outsourced" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"}`}>
                          {testType === "outsourced" ? "Outsourced" : "In-House"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">₹{Number(t.price).toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.duration}</td>
                      <td className="px-4 py-3 text-right">
                        {(t as any).outsourceCost != null ? (
                          <span className="font-mono text-xs text-orange-700 dark:text-orange-300">₹{Number((t as any).outsourceCost).toFixed(2)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                          {t.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(t)} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"><Pencil size={14} /></button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete test "${t.name}" (${t.code})?\n\nThis cannot be undone. Tests that have been used in orders cannot be deleted — mark them Inactive instead.`)) {
                                deleteTest.mutate({ id: t.id });
                              }
                            }}
                            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                            disabled={deleteTest.isPending}
                            title="Delete test"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditTest(null); reset({ isActive: true }); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editTest ? "Edit Test" : "Add Diagnostic Test"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col min-h-0 flex-1">
          <div className="space-y-4 overflow-y-auto flex-1 pr-1 -mr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Test Code *</Label>
                <Input {...register("code", { required: true })} className="mt-1" placeholder="CBC" />
              </div>
              <div>
                <Label>Price (₹) *</Label>
                <Input type="number" step="0.01" {...register("price", { required: true, valueAsNumber: true })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Test Name *</Label>
              <Input {...register("name", { required: true })} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category *</Label>
                <Select value={watch("category")} onValueChange={(v) => setValue("category", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {activeCategories.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No categories yet — click "Categories" to add one.
                      </div>
                    ) : (
                      activeCategories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Duration *</Label>
                <Input {...register("duration", { required: true })} className="mt-1" placeholder="4-6 hours" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Department *</Label>
                <Select value={watch("department") ?? "Pathology"} onValueChange={(v) => setValue("department", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENT_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Drives which queue (e.g. USG room) this test routes to.</p>
              </div>
              <div>
                <Label>Room / Counter</Label>
                <Select
                  value={String(watch("roomId") ?? "")}
                  onValueChange={(v) => setValue("roomId", v && v !== "__none__" ? Number(v) : null)}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Not assigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not assigned</SelectItem>
                    {activeRooms.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}{r.floorName ? ` · ${r.floorName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeRooms.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">Add rooms in Settings → Locations.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Modality</Label>
                <Select
                  value={String(watch("modalityId") ?? "")}
                  onValueChange={(v) => setValue("modalityId", v && v !== "__none__" ? Number(v) : null)}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Not assigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not assigned</SelectItem>
                    {activeModalities.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {activeModalities.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">Add modalities in Settings → Locations.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Test Type</Label>
                <Select value={watch("testType") ?? "inhouse"} onValueChange={(v) => {
                  setValue("testType", v);
                  if (v === "inhouse") setValue("outsourcedLabId", null);
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inhouse">In-House</SelectItem>
                    <SelectItem value="outsourced">Outsourced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {watch("testType") === "outsourced" && (
                <div>
                  <Label>Outsourced Lab</Label>
                  <Select
                    value={String(watch("outsourcedLabId") ?? "")}
                    onValueChange={(v) => setValue("outsourcedLabId", v ? Number(v) : null)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select lab…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_OUTSOURCED_LAB}>None</SelectItem>
                      {activeOutsourcedLabs.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {activeOutsourcedLabs.length === 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">No labs yet — add one in "Outsourced Labs".</p>
                  )}
                </div>
              )}
            </div>
            {watch("testType") === "outsourced" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Outsource Cost (₹)</Label>
                  <Input type="number" step="0.01" min={0} {...register("outsourceCost")} className="mt-1" placeholder="Leave blank to use lab default" />
                  <p className="text-[11px] text-muted-foreground mt-1">Overrides the lab’s default rate for this specific test.</p>
                </div>
              </div>
            )}
            <div>
              <Label>Description</Label>
              <Input {...register("description")} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isActive" {...register("isActive")} className="rounded" />
              <Label htmlFor="isActive">Active</Label>
            </div>
            {submitErr && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {submitErr}
              </div>
            )}
          </div>
            <div className="flex justify-end gap-2 pt-3 mt-1 border-t border-card-border shrink-0">
              <Button type="button" variant="outline" onClick={() => { setOpen(false); setSubmitErr(""); }}>Cancel</Button>
              <Button type="submit" disabled={createTest.isPending || updateTest.isPending}>
                {createTest.isPending || updateTest.isPending ? "Saving…" : (editTest ? "Save Changes" : "Add Test")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DuplicatesDialog open={dupOpen} onOpenChange={setDupOpen} />
      <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}

// ── Duplicates Finder ──────────────────────────────────────────────────────
type DuplicateGroup = {
  name: string;
  tests: Array<{
    id: number; code: string; name: string; price: number | string;
    category: string; isActive: boolean; testType?: string | null;
  }>;
};

function DuplicatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: rawRes, isLoading } = useQuery({
    queryKey: ["all-tests-for-dups"],
    queryFn: () => api.get<{ tests: DuplicateGroup["tests"] }>("/api/tests?limit=10000"),
    enabled: open,
  });
  const { toast } = useToast();

  const delTest = useDeleteTest({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTestsQueryKey() });
        qc.invalidateQueries({ queryKey: ["all-tests-for-dups"] });
        toast({ title: "Duplicate deleted" });
      },
      onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    },
  });

  const tests = (rawRes as { tests?: DuplicateGroup["tests"] } | undefined)?.tests ?? [];

  const groups: DuplicateGroup[] = (() => {
    const map = new Map<string, DuplicateGroup["tests"]>();
    for (const t of tests) {
      const key = (t.name ?? "").trim().toLowerCase();
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    const out: DuplicateGroup[] = [];
    for (const [name, list] of map) {
      if (list.length > 1) out.push({ name, tests: list });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Duplicate Tests</DialogTitle>
          <DialogDescription>
            Tests with the same name are grouped below. Click the trash icon to delete the duplicate you don't want. Tests that have been used in orders are protected from deletion.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading catalog…</div>
          ) : groups.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No duplicate tests found. All test names are unique.</div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.name} className="border border-card-border rounded-lg overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 font-semibold text-sm border-b border-card-border flex items-center gap-2">
                    <AlertTriangle size={14} className="text-orange-500" />
                    {g.name}
                    <span className="text-muted-foreground font-normal text-xs">({g.tests.length} entries with same name)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Code</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Price</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.tests.map((t) => (
                        <tr key={t.id} className="border-b border-card-border/50 last:border-0 hover:bg-muted/10">
                          <td className="px-4 py-2 font-mono text-xs font-bold text-primary">{t.code}</td>
                          <td className="px-4 py-2">{t.category}</td>
                          <td className="px-4 py-2 text-right font-semibold">₹{Number(t.price).toFixed(2)}</td>
                          <td className="px-4 py-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${(t.testType ?? "inhouse") === "outsourced" ? "bg-orange-100 text-orange-700" : "bg-teal-100 text-teal-700"}`}>
                              {(t.testType ?? "inhouse") === "outsourced" ? "Outsourced" : "In-House"}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${t.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                              {t.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => {
                                if (confirm(`Delete duplicate "${t.name}" (${t.code})?\n\nThis cannot be undone. If this test has been used in orders, the delete will be blocked.`)) {
                                  delTest.mutate({ id: t.id });
                                }
                              }}
                              className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                              disabled={delTest.isPending}
                              title="Delete this duplicate"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManageCategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: categories = [], isLoading } = useTestCategories();

  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: TEST_CATEGORIES_KEY });
    qc.invalidateQueries({ queryKey: getListTestsQueryKey() });
  };

  const addCategory = useMutation({
    mutationFn: (name: string) => api.post("/api/test-categories", { name }),
    onSuccess: () => { invalidate(); setNewName(""); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const updateCategory = useMutation({
    mutationFn: (body: { id: number; data: { name?: string; isActive?: boolean } }) =>
      api.patch(`/api/test-categories/${body.id}`, body.data),
    onSuccess: () => { invalidate(); setEditId(null); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: number) => api.delete(`/api/test-categories/${id}`),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setError(null); setEditId(null); setNewName(""); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Test Categories</DialogTitle>
          <DialogDescription>
            Add, rename, deactivate, or remove the categories that appear in the Test Catalog (e.g. Radiology, Hematology). Renaming a category updates every test currently in it. Categories that still contain tests can't be deleted — mark them inactive instead.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); const trimmed = newName.trim(); if (trimmed) addCategory.mutate(trimmed); }}
          className="flex gap-2"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category (e.g. Cytology)"
            className="flex-1"
          />
          <Button type="submit" disabled={!newName.trim() || addCategory.isPending}>
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </form>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="border border-card-border rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : categories.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No categories yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-card-border sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-20">Tests</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-24">Status</th>
                  <th className="px-4 py-2.5 w-28" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2">
                      {editId === c.id ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editName.trim()) updateCategory.mutate({ id: c.id, data: { name: editName.trim() } });
                            if (e.key === "Escape") { setEditId(null); setError(null); }
                          }}
                          autoFocus
                          className="h-8"
                        />
                      ) : (
                        <span className="font-medium">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.testCount}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => updateCategory.mutate({ id: c.id, data: { isActive: !c.isActive } })}
                        className={`text-xs px-2 py-1 rounded font-medium ${c.isActive ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                      >
                        {c.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {editId === c.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!editName.trim()}
                              onClick={() => updateCategory.mutate({ id: c.id, data: { name: editName.trim() } })}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditId(null); setError(null); }}>✕</Button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditId(c.id); setEditName(c.name); setError(null); }}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Rename"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => {
                                if (c.testCount > 0) {
                                  setError(`"${c.name}" still has ${c.testCount} test${c.testCount === 1 ? "" : "s"} — reassign or remove them first, or just toggle the category off.`);
                                  return;
                                }
                                if (confirm(`Delete category "${c.name}"?`)) deleteCategory.mutate(c.id);
                              }}
                              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
