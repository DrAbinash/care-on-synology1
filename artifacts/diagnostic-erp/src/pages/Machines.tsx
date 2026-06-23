import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Wrench, AlertTriangle, History, BellRing, Activity, Plus, Pencil,
  Trash2, RefreshCcw, ClipboardList, Cog, FileText, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";

// ----------------------------- Types -----------------------------
type Machine = {
  id: number;
  code: string;
  name: string;
  modelNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  department: string;
  location: string | null;
  purchaseDate: string | null;
  purchaseCost: string | null;
  warrantyEnd: string | null;
  status: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  openBreakdownCount: number;
  amcStatus: string;
  amcEndDate: string | null;
  nextCalibrationDue: string | null;
};

type MachineSummary = {
  total: number;
  active: number;
  inMaintenance: number;
  retired: number;
  openBreakdowns: number;
};

type AmcContract = {
  id: number;
  machineId: number;
  contractType: string;
  vendor: string;
  contractNumber: string | null;
  startDate: string;
  endDate: string;
  cost: string;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  coverage: string | null;
  notes: string | null;
  isActive: boolean;
};

type Breakdown = {
  id: number;
  machineId: number;
  machineName?: string | null;
  machineCode?: string | null;
  department?: string | null;
  reportedAt: string;
  reportedBy: string | null;
  description: string;
  severity: string;
  status: string;
  resolvedAt: string | null;
  resolution: string | null;
  downtimeHours: string | null;
  repairCost: string;
  serviceVendor: string | null;
  notes: string | null;
};

type ServiceRecord = {
  id: number;
  machineId: number;
  machineName?: string | null;
  machineCode?: string | null;
  department?: string | null;
  serviceDate: string;
  serviceType: string;
  engineer: string | null;
  vendor: string | null;
  cost: string;
  partsReplaced: string | null;
  notes: string | null;
  nextDueDate: string | null;
  certificateNumber: string | null;
  certificateUrl: string | null;
  performedBy: string | null;
};

type CalibrationReminder = {
  id: number;
  machineId: number;
  machineName: string | null;
  machineCode: string | null;
  department: string | null;
  lastCalibrationDate: string;
  nextDueDate: string;
  daysToDue: number;
  status: "overdue" | "due_soon";
  certificateNumber: string | null;
  engineer: string | null;
  vendor: string | null;
};

type DowntimeRow = {
  machineId: number;
  machineCode: string;
  machineName: string;
  department: string;
  status: string;
  downtimeHours: number;
  repairCost: number;
  incidents: number;
  openIncidents: number;
};

const fmtINR = (v: number | string) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_OPTIONS = ["active", "maintenance", "retired", "out_of_service"];
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];
const BREAKDOWN_STATUS_OPTIONS = ["open", "in_progress", "resolved"];
const SERVICE_TYPE_OPTIONS = ["preventive", "corrective", "calibration", "inspection", "installation"];
const CONTRACT_TYPES = ["AMC", "CMC", "Warranty", "Other"];

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  maintenance: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  retired: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  out_of_service: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  open: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  due_soon: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

const TABS = [
  { id: "machines", label: "Machines", icon: Cog },
  { id: "amc", label: "AMC / CMC", icon: ClipboardList },
  { id: "breakdowns", label: "Breakdowns", icon: AlertTriangle },
  { id: "service", label: "Service & Calibration", icon: History },
  { id: "reminders", label: "Calibration Reminders", icon: BellRing },
  { id: "downtime", label: "Downtime Report", icon: Activity },
] as const;
type TabId = typeof TABS[number]["id"];

// ----------------------------- Component -----------------------------
export default function Machines() {
  const [tab, setTab] = useState<TabId>("machines");
  const { toast } = useToast();

  // Machines tab state
  const [machineRows, setMachineRows] = useState<Machine[]>([]);
  const [machineSummary, setMachineSummary] = useState<MachineSummary | null>(null);
  const [machineLoading, setMachineLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);

  // Edit/create machine dialog
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [machineForm, setMachineForm] = useState({
    code: "", name: "", modelNumber: "", serialNumber: "", manufacturer: "",
    department: "", location: "", purchaseDate: "", purchaseCost: "",
    warrantyEnd: "", status: "active", notes: "",
  });

  // Detail / drill-down state
  const [openMachineId, setOpenMachineId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    machine: Machine;
    contracts: AmcContract[];
    breakdowns: Breakdown[];
    services: ServiceRecord[];
    kpis: { totalDowntimeHours: number; totalRepairCost: number; totalServiceCost: number; totalAmcCost: number; openBreakdowns: number };
  } | null>(null);

  // AMC dialog
  const [amcDialogOpen, setAmcDialogOpen] = useState(false);
  const [editingAmc, setEditingAmc] = useState<AmcContract | null>(null);
  const [amcMachineForNew, setAmcMachineForNew] = useState<number | null>(null);
  const [amcForm, setAmcForm] = useState({
    contractType: "AMC", vendor: "", contractNumber: "", startDate: "",
    endDate: "", cost: "", contactPerson: "", contactPhone: "", contactEmail: "",
    coverage: "", notes: "",
  });

  // Breakdown dialog
  const [breakdownDialogOpen, setBreakdownDialogOpen] = useState(false);
  const [editingBreakdown, setEditingBreakdown] = useState<Breakdown | null>(null);
  const [breakdownMachineForNew, setBreakdownMachineForNew] = useState<number | null>(null);
  const [breakdownForm, setBreakdownForm] = useState({
    description: "", severity: "medium", status: "open", reportedBy: "",
    repairCost: "", serviceVendor: "", resolution: "", downtimeHours: "", notes: "",
  });

  // Service dialog
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceRecord | null>(null);
  const [serviceMachineForNew, setServiceMachineForNew] = useState<number | null>(null);
  const [serviceForm, setServiceForm] = useState({
    serviceDate: todayStr(), serviceType: "preventive", engineer: "", vendor: "",
    cost: "", partsReplaced: "", nextDueDate: "", certificateNumber: "",
    certificateUrl: "", performedBy: "", notes: "",
  });

  // Other tab state
  const [allBreakdowns, setAllBreakdowns] = useState<Breakdown[]>([]);
  const [breakdownSummary, setBreakdownSummary] = useState<{ total: number; open: number; inProgress: number; resolved: number; totalDowntimeHours: number; totalRepairCost: number } | null>(null);
  const [breakdownStatusFilter, setBreakdownStatusFilter] = useState("");

  const [allServices, setAllServices] = useState<ServiceRecord[]>([]);
  const [serviceTypeFilter, setServiceTypeFilter] = useState("");

  const [reminders, setReminders] = useState<CalibrationReminder[]>([]);
  const [reminderSummary, setReminderSummary] = useState<{ overdue: number; dueSoon: number; windowDays: number } | null>(null);
  const [reminderDays, setReminderDays] = useState(30);

  const [downtimeRows, setDowntimeRows] = useState<DowntimeRow[]>([]);
  const [downtimeSummary, setDowntimeSummary] = useState<{ totalDowntimeHours: number; totalRepairCost: number; totalIncidents: number; machinesAffected: number } | null>(null);
  const [downtimeFrom, setDowntimeFrom] = useState("");
  const [downtimeTo, setDowntimeTo] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ kind: string; id: number; label: string } | null>(null);

  // ----------------- Fetchers -----------------
  const loadMachines = async () => {
    setMachineLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterDept) params.set("department", filterDept);
      if (filterStatus) params.set("status", filterStatus);
      const data = await api.get<{ rows: Machine[]; summary: MachineSummary }>(`/api/machines?${params}`);
      setMachineRows(data.rows);
      setMachineSummary(data.summary);
    } catch (err) {
      toast({ title: "Failed to load machines", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setMachineLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    try {
      const data = await api.get<typeof detail>(`/api/machines/${id}`);
      setDetail(data);
    } catch (err) {
      toast({ title: "Failed to load machine detail", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const loadDepartments = async () => {
    try {
      const rows = await api.get<{ name: string }[]>("/api/departments");
      setDepartments(rows.map(r => r.name).sort());
    } catch {
      // non-fatal
    }
  };

  const loadAllBreakdowns = async () => {
    const params = new URLSearchParams();
    if (breakdownStatusFilter) params.set("status", breakdownStatusFilter);
    const data = await api.get<{ rows: Breakdown[]; summary: typeof breakdownSummary }>(`/api/machines/breakdowns/all?${params}`);
    setAllBreakdowns(data.rows);
    setBreakdownSummary(data.summary);
  };

  const loadAllServices = async () => {
    const params = new URLSearchParams();
    if (serviceTypeFilter) params.set("type", serviceTypeFilter);
    const rows = await api.get<ServiceRecord[]>(`/api/machines/services/all?${params}`);
    setAllServices(rows);
  };

  const loadReminders = async () => {
    const data = await api.get<{ rows: CalibrationReminder[]; summary: typeof reminderSummary }>(`/api/machines/calibration/reminders?days=${reminderDays}`);
    setReminders(data.rows);
    setReminderSummary(data.summary);
  };

  const loadDowntime = async () => {
    const params = new URLSearchParams();
    if (downtimeFrom) params.set("from", downtimeFrom);
    if (downtimeTo) params.set("to", downtimeTo);
    const data = await api.get<{ rows: DowntimeRow[]; summary: typeof downtimeSummary }>(`/api/machines/downtime/report?${params}`);
    setDowntimeRows(data.rows);
    setDowntimeSummary(data.summary);
  };

  // ----------------- Effects -----------------
  useEffect(() => { loadDepartments(); /* once */ }, []);
  useEffect(() => { if (tab === "machines") loadMachines(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, search, filterDept, filterStatus]);
  useEffect(() => { if (tab === "breakdowns") loadAllBreakdowns(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, breakdownStatusFilter]);
  useEffect(() => { if (tab === "service") loadAllServices(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, serviceTypeFilter]);
  useEffect(() => { if (tab === "reminders") loadReminders(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, reminderDays]);
  useEffect(() => { if (tab === "downtime") loadDowntime(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tab, downtimeFrom, downtimeTo]);
  useEffect(() => { if (openMachineId !== null) loadDetail(openMachineId); else setDetail(null); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [openMachineId]);

  // ----------------- Machine create/edit -----------------
  const openCreateMachine = () => {
    setEditingMachine(null);
    setMachineForm({
      code: "", name: "", modelNumber: "", serialNumber: "", manufacturer: "",
      department: departments[0] || "", location: "", purchaseDate: "", purchaseCost: "",
      warrantyEnd: "", status: "active", notes: "",
    });
    setMachineDialogOpen(true);
  };

  const openEditMachine = (m: Machine) => {
    setEditingMachine(m);
    setMachineForm({
      code: m.code, name: m.name,
      modelNumber: m.modelNumber || "", serialNumber: m.serialNumber || "",
      manufacturer: m.manufacturer || "", department: m.department,
      location: m.location || "", purchaseDate: m.purchaseDate || "",
      purchaseCost: m.purchaseCost || "", warrantyEnd: m.warrantyEnd || "",
      status: m.status, notes: m.notes || "",
    });
    setMachineDialogOpen(true);
  };

  const submitMachine = async () => {
    if (!machineForm.code.trim() || !machineForm.name.trim()) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    try {
      if (editingMachine) {
        await api.patch(`/api/machines/${editingMachine.id}`, machineForm);
        toast({ title: "Machine updated" });
      } else {
        await api.post(`/api/machines`, machineForm);
        toast({ title: "Machine added" });
      }
      setMachineDialogOpen(false);
      loadMachines();
      if (openMachineId) loadDetail(openMachineId);
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // ----------------- AMC create/edit -----------------
  const openCreateAmc = (machineId: number) => {
    setEditingAmc(null);
    setAmcMachineForNew(machineId);
    setAmcForm({
      contractType: "AMC", vendor: "", contractNumber: "",
      startDate: todayStr(), endDate: "", cost: "",
      contactPerson: "", contactPhone: "", contactEmail: "", coverage: "", notes: "",
    });
    setAmcDialogOpen(true);
  };

  const openEditAmc = (a: AmcContract) => {
    setEditingAmc(a);
    setAmcMachineForNew(null);
    setAmcForm({
      contractType: a.contractType, vendor: a.vendor,
      contractNumber: a.contractNumber || "", startDate: a.startDate,
      endDate: a.endDate, cost: a.cost,
      contactPerson: a.contactPerson || "", contactPhone: a.contactPhone || "",
      contactEmail: a.contactEmail || "", coverage: a.coverage || "", notes: a.notes || "",
    });
    setAmcDialogOpen(true);
  };

  const submitAmc = async () => {
    if (!amcForm.vendor.trim() || !amcForm.startDate || !amcForm.endDate) {
      toast({ title: "Vendor, start date and end date are required", variant: "destructive" });
      return;
    }
    if (amcForm.endDate < amcForm.startDate) {
      toast({ title: "End date must be on or after start date", variant: "destructive" });
      return;
    }
    try {
      if (editingAmc) {
        await api.patch(`/api/machines/amc/${editingAmc.id}`, amcForm);
        toast({ title: "Contract updated" });
      } else if (amcMachineForNew !== null) {
        await api.post(`/api/machines/${amcMachineForNew}/amc`, amcForm);
        toast({ title: "Contract added" });
      }
      setAmcDialogOpen(false);
      if (openMachineId) loadDetail(openMachineId);
      loadMachines();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // ----------------- Breakdown create/edit -----------------
  const openCreateBreakdown = (machineId: number) => {
    setEditingBreakdown(null);
    setBreakdownMachineForNew(machineId);
    setBreakdownForm({
      description: "", severity: "medium", status: "open",
      reportedBy: "", repairCost: "", serviceVendor: "",
      resolution: "", downtimeHours: "", notes: "",
    });
    setBreakdownDialogOpen(true);
  };

  const openEditBreakdown = (b: Breakdown) => {
    setEditingBreakdown(b);
    setBreakdownMachineForNew(null);
    setBreakdownForm({
      description: b.description, severity: b.severity, status: b.status,
      reportedBy: b.reportedBy || "", repairCost: b.repairCost,
      serviceVendor: b.serviceVendor || "", resolution: b.resolution || "",
      downtimeHours: b.downtimeHours || "", notes: b.notes || "",
    });
    setBreakdownDialogOpen(true);
  };

  const submitBreakdown = async () => {
    if (!breakdownForm.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    try {
      if (editingBreakdown) {
        await api.patch(`/api/machines/breakdowns/${editingBreakdown.id}`, breakdownForm);
        toast({ title: "Breakdown updated" });
      } else if (breakdownMachineForNew !== null) {
        await api.post(`/api/machines/${breakdownMachineForNew}/breakdowns`, breakdownForm);
        toast({ title: "Breakdown logged" });
      }
      setBreakdownDialogOpen(false);
      if (openMachineId) loadDetail(openMachineId);
      loadMachines();
      if (tab === "breakdowns") loadAllBreakdowns();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // ----------------- Service create/edit -----------------
  const openCreateService = (machineId: number, type: string = "preventive") => {
    setEditingService(null);
    setServiceMachineForNew(machineId);
    setServiceForm({
      serviceDate: todayStr(), serviceType: type, engineer: "", vendor: "",
      cost: "", partsReplaced: "", nextDueDate: "", certificateNumber: "",
      certificateUrl: "", performedBy: "", notes: "",
    });
    setServiceDialogOpen(true);
  };

  const openEditService = (s: ServiceRecord) => {
    setEditingService(s);
    setServiceMachineForNew(null);
    setServiceForm({
      serviceDate: s.serviceDate, serviceType: s.serviceType,
      engineer: s.engineer || "", vendor: s.vendor || "",
      cost: s.cost, partsReplaced: s.partsReplaced || "",
      nextDueDate: s.nextDueDate || "", certificateNumber: s.certificateNumber || "",
      certificateUrl: s.certificateUrl || "", performedBy: s.performedBy || "",
      notes: s.notes || "",
    });
    setServiceDialogOpen(true);
  };

  const submitService = async () => {
    if (!serviceForm.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceForm.serviceDate)) {
      toast({ title: "Service date is required", variant: "destructive" });
      return;
    }
    try {
      if (editingService) {
        await api.patch(`/api/machines/services/${editingService.id}`, serviceForm);
        toast({ title: "Service record updated" });
      } else if (serviceMachineForNew !== null) {
        await api.post(`/api/machines/${serviceMachineForNew}/services`, serviceForm);
        toast({ title: "Service record added" });
      }
      setServiceDialogOpen(false);
      if (openMachineId) loadDetail(openMachineId);
      loadMachines();
      if (tab === "service") loadAllServices();
      if (tab === "reminders") loadReminders();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // ----------------- Delete -----------------
  const performDelete = async () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    try {
      let path = "";
      if (kind === "machine") path = `/api/machines/${id}`;
      else if (kind === "amc") path = `/api/machines/amc/${id}`;
      else if (kind === "breakdown") path = `/api/machines/breakdowns/${id}`;
      else if (kind === "service") path = `/api/machines/services/${id}`;
      await api.delete(path);
      toast({ title: "Deleted" });
      setDeleteTarget(null);
      if (kind === "machine") {
        setOpenMachineId(null);
        loadMachines();
      } else {
        if (openMachineId) loadDetail(openMachineId);
        if (tab === "breakdowns") loadAllBreakdowns();
        if (tab === "service") loadAllServices();
        if (tab === "reminders") loadReminders();
        loadMachines();
      }
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // ----------------- Render -----------------
  const departmentOptions = useMemo(() => {
    const set = new Set(departments);
    machineRows.forEach(m => m.department && set.add(m.department));
    return [...set].sort();
  }, [departments, machineRows]);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <PageHeader
        title="Machine / Maintenance"
        subtitle="Equipment master, AMC contracts, breakdowns, service history, calibration & downtime"
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === id
                ? "border-violet-600 text-violet-700 dark:text-violet-400"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* MACHINES TAB */}
      {tab === "machines" && (
        <div className="space-y-3">
          {machineSummary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label="Total" value={String(machineSummary.total)} icon={Cog} color="violet" />
              <KpiCard label="Active" value={String(machineSummary.active)} icon={CheckCircle2} color="emerald" />
              <KpiCard label="In Maintenance" value={String(machineSummary.inMaintenance)} icon={Wrench} color="amber" />
              <KpiCard label="Retired" value={String(machineSummary.retired)} icon={History} color="zinc" />
              <KpiCard label="Open Breakdowns" value={String(machineSummary.openBreakdowns)} icon={AlertTriangle} color="rose" />
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">Search</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or serial" className="h-9" />
            </div>
            <div className="min-w-[140px]">
              <Label className="text-xs">Department</Label>
              <Select value={filterDept || "__all__"} onValueChange={(v) => setFilterDept(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {departmentOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[140px]">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus || "__all__"} onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadMachines()}>
              <RefreshCcw size={14} className="mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreateMachine}>
              <Plus size={14} className="mr-1" /> Add Machine
            </Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Code</th>
                    <th className="px-3 py-2 font-medium text-xs">Name</th>
                    <th className="px-3 py-2 font-medium text-xs">Department</th>
                    <th className="px-3 py-2 font-medium text-xs">Location</th>
                    <th className="px-3 py-2 font-medium text-xs">Status</th>
                    <th className="px-3 py-2 font-medium text-xs">AMC</th>
                    <th className="px-3 py-2 font-medium text-xs">Next Calibration</th>
                    <th className="px-3 py-2 font-medium text-xs text-center">Open BD</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {machineLoading ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-xs">Loading…</td></tr>
                  ) : machineRows.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-xs">No machines yet — click "Add Machine" to get started</td></tr>
                  ) : (
                    machineRows.map(m => {
                      const calibStatus = m.nextCalibrationDue
                        ? (m.nextCalibrationDue < todayStr() ? "overdue" : "ok")
                        : "none";
                      return (
                        <tr key={m.id} className="border-t border-border/50 hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                          <td className="px-3 py-2">
                            <button className="font-medium hover:underline text-left" onClick={() => setOpenMachineId(m.id)}>{m.name}</button>
                            <div className="text-[10px] text-muted-foreground">{m.modelNumber || ""}{m.serialNumber ? ` · S/N ${m.serialNumber}` : ""}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">{m.department || "—"}</td>
                          <td className="px-3 py-2 text-xs">{m.location || "—"}</td>
                          <td className="px-3 py-2"><Badge className={STATUS_BADGE[m.status] || ""}>{m.status.replace("_", " ")}</Badge></td>
                          <td className="px-3 py-2 text-xs">
                            {m.amcEndDate
                              ? <span className={m.amcEndDate < todayStr() ? "text-rose-600" : "text-emerald-600"}>until {m.amcEndDate}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {m.nextCalibrationDue
                              ? <span className={calibStatus === "overdue" ? "text-rose-600 font-medium" : ""}>{m.nextCalibrationDue}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {m.openBreakdownCount > 0
                              ? <Badge className="bg-rose-100 text-rose-700">{m.openBreakdownCount}</Badge>
                              : <span className="text-muted-foreground text-xs">0</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => setOpenMachineId(m.id)} title="Open detail">
                                <FileText size={13} />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openEditMachine(m)} title="Edit">
                                <Pencil size={13} />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "machine", id: m.id, label: m.name })} title="Delete">
                                <Trash2 size={13} className="text-rose-500" />
                              </Button>
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
      )}

      {/* AMC TAB */}
      {tab === "amc" && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-3 text-xs text-muted-foreground">
            View and manage Annual Maintenance Contracts (AMC) and Comprehensive Maintenance Contracts (CMC) per machine. Open a machine to add or edit its contracts.
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Machine</th>
                    <th className="px-3 py-2 font-medium text-xs">Type</th>
                    <th className="px-3 py-2 font-medium text-xs">Vendor</th>
                    <th className="px-3 py-2 font-medium text-xs">Period</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Cost</th>
                    <th className="px-3 py-2 font-medium text-xs">Contact</th>
                    <th className="px-3 py-2 font-medium text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {machineRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">No machines yet</td></tr>
                  ) : (
                    machineRows.map(m => (
                      <tr key={m.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <button className="font-medium hover:underline" onClick={() => setOpenMachineId(m.id)}>{m.name}</button>
                          <div className="text-[10px] text-muted-foreground font-mono">{m.code}</div>
                        </td>
                        <td className="px-3 py-2 text-xs" colSpan={5}>
                          <span className={m.amcEndDate ? (m.amcEndDate < todayStr() ? "text-rose-600" : "text-emerald-600") : "text-muted-foreground"}>
                            {m.amcStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="outline" onClick={() => setOpenMachineId(m.id)}>Open</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BREAKDOWNS TAB */}
      {tab === "breakdowns" && (
        <div className="space-y-3">
          {breakdownSummary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label="Total" value={String(breakdownSummary.total)} icon={AlertTriangle} color="violet" />
              <KpiCard label="Open" value={String(breakdownSummary.open)} icon={AlertTriangle} color="rose" />
              <KpiCard label="In Progress" value={String(breakdownSummary.inProgress)} icon={Wrench} color="amber" />
              <KpiCard label="Resolved" value={String(breakdownSummary.resolved)} icon={CheckCircle2} color="emerald" />
              <KpiCard label="Total Downtime" value={`${breakdownSummary.totalDowntimeHours.toFixed(1)} h`} icon={Activity} color="orange" />
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <Label className="text-xs">Status</Label>
              <Select value={breakdownStatusFilter || "__all__"} onValueChange={(v) => setBreakdownStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {BREAKDOWN_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={loadAllBreakdowns}>
              <RefreshCcw size={14} className="mr-1" /> Refresh
            </Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Reported</th>
                    <th className="px-3 py-2 font-medium text-xs">Machine</th>
                    <th className="px-3 py-2 font-medium text-xs">Description</th>
                    <th className="px-3 py-2 font-medium text-xs">Severity</th>
                    <th className="px-3 py-2 font-medium text-xs">Status</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Downtime</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Cost</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allBreakdowns.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-xs">No breakdowns logged</td></tr>
                  ) : (
                    allBreakdowns.map(b => (
                      <tr key={b.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(b.reportedAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-xs">{b.machineName} <span className="text-muted-foreground font-mono">({b.machineCode})</span></td>
                        <td className="px-3 py-2 text-xs max-w-md truncate" title={b.description}>{b.description}</td>
                        <td className="px-3 py-2"><Badge className={STATUS_BADGE[b.severity] || ""}>{b.severity}</Badge></td>
                        <td className="px-3 py-2"><Badge className={STATUS_BADGE[b.status] || ""}>{b.status.replace("_", " ")}</Badge></td>
                        <td className="px-3 py-2 text-xs text-right">{b.downtimeHours ? `${Number(b.downtimeHours).toFixed(1)} h` : "—"}</td>
                        <td className="px-3 py-2 text-xs text-right">{Number(b.repairCost) > 0 ? fmtINR(b.repairCost) : "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => openEditBreakdown(b)}><Pencil size={13} /></Button>
                            <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "breakdown", id: b.id, label: b.description.slice(0, 50) })}><Trash2 size={13} className="text-rose-500" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SERVICE TAB */}
      {tab === "service" && (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <Label className="text-xs">Service Type</Label>
              <Select value={serviceTypeFilter || "__all__"} onValueChange={(v) => setServiceTypeFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All</SelectItem>
                  {SERVICE_TYPE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={loadAllServices}><RefreshCcw size={14} className="mr-1" /> Refresh</Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Date</th>
                    <th className="px-3 py-2 font-medium text-xs">Machine</th>
                    <th className="px-3 py-2 font-medium text-xs">Type</th>
                    <th className="px-3 py-2 font-medium text-xs">Engineer / Vendor</th>
                    <th className="px-3 py-2 font-medium text-xs">Next Due</th>
                    <th className="px-3 py-2 font-medium text-xs">Cert #</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Cost</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allServices.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-xs">No service records yet</td></tr>
                  ) : (
                    allServices.map(s => (
                      <tr key={s.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{s.serviceDate}</td>
                        <td className="px-3 py-2 text-xs">{s.machineName} <span className="text-muted-foreground font-mono">({s.machineCode})</span></td>
                        <td className="px-3 py-2"><Badge variant="outline">{s.serviceType}</Badge></td>
                        <td className="px-3 py-2 text-xs">{s.engineer || "—"}{s.vendor ? ` · ${s.vendor}` : ""}</td>
                        <td className="px-3 py-2 text-xs">
                          {s.nextDueDate
                            ? <span className={s.nextDueDate < todayStr() ? "text-rose-600 font-medium" : ""}>{s.nextDueDate}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{s.certificateNumber || "—"}</td>
                        <td className="px-3 py-2 text-xs text-right">{Number(s.cost) > 0 ? fmtINR(s.cost) : "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => openEditService(s)}><Pencil size={13} /></Button>
                            <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "service", id: s.id, label: `${s.serviceType} on ${s.serviceDate}` })}><Trash2 size={13} className="text-rose-500" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REMINDERS TAB */}
      {tab === "reminders" && (
        <div className="space-y-3">
          {reminderSummary && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard label="Overdue" value={String(reminderSummary.overdue)} icon={AlertTriangle} color="rose" />
              <KpiCard label="Due Soon" value={String(reminderSummary.dueSoon)} icon={BellRing} color="amber" />
              <KpiCard label="Window" value={`${reminderSummary.windowDays} days`} icon={Activity} color="violet" />
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-3 flex items-end gap-3">
            <div>
              <Label className="text-xs">Look-ahead window (days)</Label>
              <Input type="number" min="1" max="365" value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value) || 30)} className="h-9 w-32" />
            </div>
            <Button variant="outline" size="sm" onClick={loadReminders}><RefreshCcw size={14} className="mr-1" /> Refresh</Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Status</th>
                    <th className="px-3 py-2 font-medium text-xs">Machine</th>
                    <th className="px-3 py-2 font-medium text-xs">Last Calibration</th>
                    <th className="px-3 py-2 font-medium text-xs">Due Date</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Days</th>
                    <th className="px-3 py-2 font-medium text-xs">Cert #</th>
                    <th className="px-3 py-2 font-medium text-xs">Last Engineer</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reminders.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-xs">All calibrations are up to date</td></tr>
                  ) : (
                    reminders.map(r => (
                      <tr key={r.id} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2"><Badge className={STATUS_BADGE[r.status] || ""}>{r.status.replace("_", " ")}</Badge></td>
                        <td className="px-3 py-2 text-xs">
                          <button className="font-medium hover:underline" onClick={() => setOpenMachineId(r.machineId)}>{r.machineName}</button>
                          <span className="text-muted-foreground font-mono ml-1">({r.machineCode})</span>
                          <div className="text-[10px] text-muted-foreground">{r.department}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{r.lastCalibrationDate}</td>
                        <td className="px-3 py-2 text-xs font-medium">{r.nextDueDate}</td>
                        <td className="px-3 py-2 text-xs text-right">
                          {r.daysToDue < 0
                            ? <span className="text-rose-600">{Math.abs(r.daysToDue)}d overdue</span>
                            : <span>in {r.daysToDue}d</span>}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.certificateNumber || "—"}</td>
                        <td className="px-3 py-2 text-xs">{r.engineer || r.vendor || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end">
                            <Button size="sm" onClick={() => { setOpenMachineId(r.machineId); setTimeout(() => openCreateService(r.machineId, "calibration"), 200); }}>
                              <Plus size={13} className="mr-1" /> Log Calibration
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DOWNTIME TAB */}
      {tab === "downtime" && (
        <div className="space-y-3">
          {downtimeSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Downtime" value={`${downtimeSummary.totalDowntimeHours.toFixed(1)} h`} icon={Activity} color="rose" />
              <KpiCard label="Total Repair Cost" value={fmtINR(downtimeSummary.totalRepairCost)} icon={Wrench} color="orange" />
              <KpiCard label="Total Incidents" value={String(downtimeSummary.totalIncidents)} icon={AlertTriangle} color="amber" />
              <KpiCard label="Machines Affected" value={String(downtimeSummary.machinesAffected)} icon={Cog} color="violet" />
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={downtimeFrom} onChange={(e) => setDowntimeFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={downtimeTo} onChange={(e) => setDowntimeTo(e.target.value)} className="h-9" />
            </div>
            <Button variant="outline" size="sm" onClick={() => { setDowntimeFrom(""); setDowntimeTo(""); }}>All time</Button>
            <Button variant="outline" size="sm" onClick={loadDowntime}><RefreshCcw size={14} className="mr-1" /> Refresh</Button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs">Machine</th>
                    <th className="px-3 py-2 font-medium text-xs">Department</th>
                    <th className="px-3 py-2 font-medium text-xs">Status</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Downtime (h)</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Incidents</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Open</th>
                    <th className="px-3 py-2 font-medium text-xs text-right">Repair Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {downtimeRows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground text-xs">No downtime in this window</td></tr>
                  ) : (
                    downtimeRows.map(r => (
                      <tr key={r.machineId} className="border-t border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs">
                          <button className="font-medium hover:underline" onClick={() => setOpenMachineId(r.machineId)}>{r.machineName}</button>
                          <span className="text-muted-foreground font-mono ml-1">({r.machineCode})</span>
                        </td>
                        <td className="px-3 py-2 text-xs">{r.department || "—"}</td>
                        <td className="px-3 py-2"><Badge className={STATUS_BADGE[r.status] || ""}>{r.status.replace("_", " ")}</Badge></td>
                        <td className="px-3 py-2 text-xs text-right font-medium">{r.downtimeHours.toFixed(1)}</td>
                        <td className="px-3 py-2 text-xs text-right">{r.incidents}</td>
                        <td className="px-3 py-2 text-xs text-right">{r.openIncidents > 0 ? <span className="text-rose-600 font-medium">{r.openIncidents}</span> : 0}</td>
                        <td className="px-3 py-2 text-xs text-right">{fmtINR(r.repairCost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============== Machine detail dialog ============== */}
      <Dialog open={openMachineId !== null} onOpenChange={(o) => !o && setOpenMachineId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <Cog size={18} /> {detail.machine.name}
                  <Badge className={STATUS_BADGE[detail.machine.status]}>{detail.machine.status.replace("_", " ")}</Badge>
                  <span className="text-xs font-mono text-muted-foreground">{detail.machine.code}</span>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {detail.machine.manufacturer} · {detail.machine.modelNumber || "—"} · S/N {detail.machine.serialNumber || "—"} · {detail.machine.department} {detail.machine.location ? `· ${detail.machine.location}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <KpiCard label="Open Breakdowns" value={String(detail.kpis.openBreakdowns)} icon={AlertTriangle} color={detail.kpis.openBreakdowns > 0 ? "rose" : "emerald"} compact />
                <KpiCard label="Total Downtime" value={`${detail.kpis.totalDowntimeHours.toFixed(1)} h`} icon={Activity} color="amber" compact />
                <KpiCard label="Repair Cost" value={fmtINR(detail.kpis.totalRepairCost)} icon={Wrench} color="orange" compact />
                <KpiCard label="Service Cost" value={fmtINR(detail.kpis.totalServiceCost)} icon={History} color="violet" compact />
                <KpiCard label="AMC Cost" value={fmtINR(detail.kpis.totalAmcCost)} icon={ClipboardList} color="indigo" compact />
              </div>

              {/* AMC Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5"><ClipboardList size={15} /> AMC / CMC Contracts</h3>
                  <Button size="sm" variant="outline" onClick={() => openCreateAmc(detail.machine.id)}><Plus size={13} className="mr-1" /> Add Contract</Button>
                </div>
                <div className="bg-muted/20 border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left"><tr>
                      <th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Vendor</th><th className="px-2 py-1.5">Period</th>
                      <th className="px-2 py-1.5 text-right">Cost</th><th className="px-2 py-1.5">Contact</th><th className="px-2 py-1.5 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {detail.contracts.length === 0
                        ? <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">No contracts on file</td></tr>
                        : detail.contracts.map(c => {
                          const expired = c.endDate < todayStr();
                          return (
                            <tr key={c.id} className="border-t border-border/50">
                              <td className="px-2 py-1.5"><Badge variant="outline">{c.contractType}</Badge></td>
                              <td className="px-2 py-1.5 font-medium">{c.vendor}<div className="text-[10px] text-muted-foreground font-mono">{c.contractNumber || ""}</div></td>
                              <td className="px-2 py-1.5"><span className={expired ? "text-rose-600" : ""}>{c.startDate} → {c.endDate}</span></td>
                              <td className="px-2 py-1.5 text-right">{fmtINR(c.cost)}</td>
                              <td className="px-2 py-1.5">{c.contactPerson || "—"}{c.contactPhone ? ` · ${c.contactPhone}` : ""}</td>
                              <td className="px-2 py-1.5">
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="outline" onClick={() => openEditAmc(c)}><Pencil size={11} /></Button>
                                  <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "amc", id: c.id, label: `${c.contractType} - ${c.vendor}` })}><Trash2 size={11} className="text-rose-500" /></Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Breakdowns Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle size={15} /> Breakdown Log</h3>
                  <Button size="sm" variant="outline" onClick={() => openCreateBreakdown(detail.machine.id)}><Plus size={13} className="mr-1" /> Log Breakdown</Button>
                </div>
                <div className="bg-muted/20 border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left"><tr>
                      <th className="px-2 py-1.5">Reported</th><th className="px-2 py-1.5">Description</th>
                      <th className="px-2 py-1.5">Severity</th><th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5 text-right">Downtime</th><th className="px-2 py-1.5 text-right">Cost</th>
                      <th className="px-2 py-1.5 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {detail.breakdowns.length === 0
                        ? <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No breakdowns logged</td></tr>
                        : detail.breakdowns.map(b => (
                          <tr key={b.id} className="border-t border-border/50">
                            <td className="px-2 py-1.5 whitespace-nowrap">{new Date(b.reportedAt).toLocaleDateString()}</td>
                            <td className="px-2 py-1.5 max-w-xs truncate" title={b.description}>{b.description}</td>
                            <td className="px-2 py-1.5"><Badge className={STATUS_BADGE[b.severity]}>{b.severity}</Badge></td>
                            <td className="px-2 py-1.5"><Badge className={STATUS_BADGE[b.status]}>{b.status.replace("_", " ")}</Badge></td>
                            <td className="px-2 py-1.5 text-right">{b.downtimeHours ? `${Number(b.downtimeHours).toFixed(1)} h` : "—"}</td>
                            <td className="px-2 py-1.5 text-right">{Number(b.repairCost) > 0 ? fmtINR(b.repairCost) : "—"}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => openEditBreakdown(b)}><Pencil size={11} /></Button>
                                <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "breakdown", id: b.id, label: b.description.slice(0, 50) })}><Trash2 size={11} className="text-rose-500" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Service Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5"><History size={15} /> Service History & Calibration</h3>
                  <Button size="sm" variant="outline" onClick={() => openCreateService(detail.machine.id)}><Plus size={13} className="mr-1" /> Add Service</Button>
                </div>
                <div className="bg-muted/20 border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left"><tr>
                      <th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Type</th>
                      <th className="px-2 py-1.5">Engineer / Vendor</th><th className="px-2 py-1.5">Next Due</th>
                      <th className="px-2 py-1.5">Cert #</th><th className="px-2 py-1.5 text-right">Cost</th>
                      <th className="px-2 py-1.5 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {detail.services.length === 0
                        ? <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No service records yet</td></tr>
                        : detail.services.map(s => (
                          <tr key={s.id} className="border-t border-border/50">
                            <td className="px-2 py-1.5 whitespace-nowrap">{s.serviceDate}</td>
                            <td className="px-2 py-1.5"><Badge variant="outline">{s.serviceType}</Badge></td>
                            <td className="px-2 py-1.5">{s.engineer || "—"}{s.vendor ? ` · ${s.vendor}` : ""}</td>
                            <td className="px-2 py-1.5">
                              {s.nextDueDate
                                ? <span className={s.nextDueDate < todayStr() ? "text-rose-600 font-medium" : ""}>{s.nextDueDate}</span>
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{s.certificateNumber || "—"}</td>
                            <td className="px-2 py-1.5 text-right">{Number(s.cost) > 0 ? fmtINR(s.cost) : "—"}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => openEditService(s)}><Pencil size={11} /></Button>
                                <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ kind: "service", id: s.id, label: `${s.serviceType} on ${s.serviceDate}` })}><Trash2 size={11} className="text-rose-500" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading machine details…</div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============== Machine create/edit dialog ============== */}
      <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingMachine ? "Edit Machine" : "Add New Machine"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Code *</Label><Input value={machineForm.code} onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })} disabled={!!editingMachine} className="h-9" /></div>
            <div><Label className="text-xs">Name *</Label><Input value={machineForm.name} onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Manufacturer</Label><Input value={machineForm.manufacturer} onChange={(e) => setMachineForm({ ...machineForm, manufacturer: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Model #</Label><Input value={machineForm.modelNumber} onChange={(e) => setMachineForm({ ...machineForm, modelNumber: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Serial #</Label><Input value={machineForm.serialNumber} onChange={(e) => setMachineForm({ ...machineForm, serialNumber: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Department</Label>
              <Select value={machineForm.department || "__none__"} onValueChange={(v) => setMachineForm({ ...machineForm, department: v === "__none__" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {departmentOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  {!departmentOptions.includes("Pathology") && <SelectItem value="Pathology">Pathology</SelectItem>}
                  {!departmentOptions.includes("Radiology") && <SelectItem value="Radiology">Radiology</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Location / Room</Label><Input value={machineForm.location} onChange={(e) => setMachineForm({ ...machineForm, location: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Status</Label>
              <Select value={machineForm.status} onValueChange={(v) => setMachineForm({ ...machineForm, status: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Purchase Date</Label><Input type="date" value={machineForm.purchaseDate} onChange={(e) => setMachineForm({ ...machineForm, purchaseDate: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Purchase Cost (₹)</Label><Input type="number" min="0" step="0.01" value={machineForm.purchaseCost} onChange={(e) => setMachineForm({ ...machineForm, purchaseCost: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Warranty End</Label><Input type="date" value={machineForm.warrantyEnd} onChange={(e) => setMachineForm({ ...machineForm, warrantyEnd: e.target.value })} className="h-9" /></div>
            <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={machineForm.notes} onChange={(e) => setMachineForm({ ...machineForm, notes: e.target.value })} className="h-9" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMachineDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitMachine}>{editingMachine ? "Save" : "Add Machine"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============== AMC dialog ============== */}
      <Dialog open={amcDialogOpen} onOpenChange={setAmcDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAmc ? "Edit Contract" : "Add AMC / CMC Contract"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Contract Type</Label>
              <Select value={amcForm.contractType} onValueChange={(v) => setAmcForm({ ...amcForm, contractType: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Vendor *</Label><Input value={amcForm.vendor} onChange={(e) => setAmcForm({ ...amcForm, vendor: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Contract #</Label><Input value={amcForm.contractNumber} onChange={(e) => setAmcForm({ ...amcForm, contractNumber: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Cost (₹)</Label><Input type="number" min="0" step="0.01" value={amcForm.cost} onChange={(e) => setAmcForm({ ...amcForm, cost: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Start Date *</Label><Input type="date" value={amcForm.startDate} onChange={(e) => setAmcForm({ ...amcForm, startDate: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">End Date *</Label><Input type="date" value={amcForm.endDate} onChange={(e) => setAmcForm({ ...amcForm, endDate: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Contact Person</Label><Input value={amcForm.contactPerson} onChange={(e) => setAmcForm({ ...amcForm, contactPerson: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Contact Phone</Label><Input value={amcForm.contactPhone} onChange={(e) => setAmcForm({ ...amcForm, contactPhone: e.target.value })} className="h-9" /></div>
            <div className="col-span-2"><Label className="text-xs">Contact Email</Label><Input value={amcForm.contactEmail} onChange={(e) => setAmcForm({ ...amcForm, contactEmail: e.target.value })} className="h-9" /></div>
            <div className="col-span-2"><Label className="text-xs">Coverage / Notes</Label><Input value={amcForm.coverage} onChange={(e) => setAmcForm({ ...amcForm, coverage: e.target.value })} className="h-9" placeholder="e.g. parts + labour, 24×7 support" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAmcDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitAmc}>{editingAmc ? "Save" : "Add Contract"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============== Breakdown dialog ============== */}
      <Dialog open={breakdownDialogOpen} onOpenChange={setBreakdownDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingBreakdown ? "Edit Breakdown" : "Log Breakdown"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Description *</Label><Input value={breakdownForm.description} onChange={(e) => setBreakdownForm({ ...breakdownForm, description: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Severity</Label>
              <Select value={breakdownForm.severity} onValueChange={(v) => setBreakdownForm({ ...breakdownForm, severity: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITY_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Status</Label>
              <Select value={breakdownForm.status} onValueChange={(v) => setBreakdownForm({ ...breakdownForm, status: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{BREAKDOWN_STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Reported By</Label><Input value={breakdownForm.reportedBy} onChange={(e) => setBreakdownForm({ ...breakdownForm, reportedBy: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Service Vendor</Label><Input value={breakdownForm.serviceVendor} onChange={(e) => setBreakdownForm({ ...breakdownForm, serviceVendor: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Repair Cost (₹)</Label><Input type="number" min="0" step="0.01" value={breakdownForm.repairCost} onChange={(e) => setBreakdownForm({ ...breakdownForm, repairCost: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Downtime (hours, leave blank to auto-calc on resolve)</Label><Input type="number" min="0" step="0.1" value={breakdownForm.downtimeHours} onChange={(e) => setBreakdownForm({ ...breakdownForm, downtimeHours: e.target.value })} className="h-9" /></div>
            {breakdownForm.status === "resolved" && (
              <div className="col-span-2"><Label className="text-xs">Resolution</Label><Input value={breakdownForm.resolution} onChange={(e) => setBreakdownForm({ ...breakdownForm, resolution: e.target.value })} className="h-9" /></div>
            )}
            <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={breakdownForm.notes} onChange={(e) => setBreakdownForm({ ...breakdownForm, notes: e.target.value })} className="h-9" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBreakdownDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitBreakdown}>{editingBreakdown ? "Save" : "Log Breakdown"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============== Service dialog ============== */}
      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingService ? "Edit Service Record" : "Add Service / Calibration Record"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Service Date *</Label><Input type="date" value={serviceForm.serviceDate} onChange={(e) => setServiceForm({ ...serviceForm, serviceDate: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Service Type</Label>
              <Select value={serviceForm.serviceType} onValueChange={(v) => setServiceForm({ ...serviceForm, serviceType: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Engineer</Label><Input value={serviceForm.engineer} onChange={(e) => setServiceForm({ ...serviceForm, engineer: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Vendor</Label><Input value={serviceForm.vendor} onChange={(e) => setServiceForm({ ...serviceForm, vendor: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Cost (₹)</Label><Input type="number" min="0" step="0.01" value={serviceForm.cost} onChange={(e) => setServiceForm({ ...serviceForm, cost: e.target.value })} className="h-9" /></div>
            <div><Label className="text-xs">Next Due Date {serviceForm.serviceType === "calibration" ? "(reminder)" : ""}</Label><Input type="date" value={serviceForm.nextDueDate} onChange={(e) => setServiceForm({ ...serviceForm, nextDueDate: e.target.value })} className="h-9" /></div>
            {serviceForm.serviceType === "calibration" && (
              <>
                <div><Label className="text-xs">Certificate #</Label><Input value={serviceForm.certificateNumber} onChange={(e) => setServiceForm({ ...serviceForm, certificateNumber: e.target.value })} className="h-9" /></div>
                <div><Label className="text-xs">Certificate URL</Label><Input value={serviceForm.certificateUrl} onChange={(e) => setServiceForm({ ...serviceForm, certificateUrl: e.target.value })} className="h-9" /></div>
              </>
            )}
            <div className="col-span-2"><Label className="text-xs">Parts Replaced</Label><Input value={serviceForm.partsReplaced} onChange={(e) => setServiceForm({ ...serviceForm, partsReplaced: e.target.value })} className="h-9" /></div>
            <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={serviceForm.notes} onChange={(e) => setServiceForm({ ...serviceForm, notes: e.target.value })} className="h-9" /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setServiceDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitService}>{editingService ? "Save" : "Add Record"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============== Delete confirmation ============== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.label}
              {deleteTarget?.kind === "machine" && (
                <span className="block mt-2 text-rose-600 font-medium">This will also delete all linked AMC contracts, breakdowns and service records.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-rose-600 hover:bg-rose-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ----------------------------- KPI Card -----------------------------
function KpiCard({
  label, value, icon: Icon, color, compact = false,
}: { label: string; value: string; icon: typeof Cog; color: string; compact?: boolean }) {
  const colorMap: Record<string, string> = {
    violet: "from-violet-500/15 to-violet-500/5 border-violet-500/20 text-violet-700 dark:text-violet-400",
    emerald: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
    amber: "from-amber-500/15 to-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400",
    rose: "from-rose-500/15 to-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-400",
    zinc: "from-zinc-500/15 to-zinc-500/5 border-zinc-500/20 text-zinc-700 dark:text-zinc-400",
    orange: "from-orange-500/15 to-orange-500/5 border-orange-500/20 text-orange-700 dark:text-orange-400",
    indigo: "from-indigo-500/15 to-indigo-500/5 border-indigo-500/20 text-indigo-700 dark:text-indigo-400",
  };
  return (
    <div className={`bg-gradient-to-br ${colorMap[color] || colorMap.violet} border rounded-xl ${compact ? "p-2" : "p-3"}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
        <Icon size={compact ? 11 : 13} /> {label}
      </div>
      <div className={`${compact ? "text-base" : "text-xl"} font-bold mt-1`}>{value}</div>
    </div>
  );
}
