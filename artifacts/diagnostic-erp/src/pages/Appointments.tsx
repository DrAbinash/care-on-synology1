import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAppointments,
  useGetAppointmentStats,
  useListPatients,
  useListDoctors,
  useCreateAppointment,
  useUpdateAppointment,
  useDeleteAppointment,
  getListAppointmentsQueryKey,
  getGetAppointmentStatsQueryKey,
  type Appointment,
} from "@workspace/api-client-react";
import { todayISO, shiftISODate } from "@/lib/dateRangePresets";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Calendar,
  Clock,
  Plus,
  User,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCcw,
  Edit2,
  Trash2,
} from "lucide-react";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const STATUS_META: Record<string, { label: string; color: string }> = {
  scheduled:  { label: "Scheduled",  color: "bg-blue-100 text-blue-700" },
  confirmed:  { label: "Confirmed",  color: "bg-indigo-100 text-indigo-700" },
  completed:  { label: "Completed",  color: "bg-green-100 text-green-700" },
  cancelled:  { label: "Cancelled",  color: "bg-red-100 text-red-700" },
  "no-show":  { label: "No Show",    color: "bg-orange-100 text-orange-700" },
};

const TIME_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30",
];

function formatDate(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

export default function Appointments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = todayISO();

  const [selectedDate, setSelectedDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editApt, setEditApt] = useState<Appointment | null>(null);
  const [statusDialog, setStatusDialog] = useState<Appointment | null>(null);

  const [form, setForm] = useState({
    patientSearch: "",
    selectedPatientId: "",
    selectedDoctorId: "",
    appointmentDate: today,
    timeSlot: "09:00",
    type: "walk-in",
    notes: "",
  });

  const { data: appointments = [], isLoading } = useListAppointments({
    date: selectedDate,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { data: stats } = useGetAppointmentStats();

  const { data: patientsData } = useListPatients({ limit: 500 });
  const patients = patientsData?.patients ?? [];

  const { data: doctorsData } = useListDoctors();
  const doctors = doctorsData?.doctors ?? [];

  function invalidateAppointments() {
    qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAppointmentStatsQueryKey() });
  }

  const createMut = useCreateAppointment({
    mutation: {
      onSuccess: () => {
        invalidateAppointments();
        setShowForm(false);
        resetForm();
        toast({ title: "Appointment booked" });
      },
      onError: (e) => toast({ title: "Failed to create appointment", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const updateMut = useUpdateAppointment({
    mutation: {
      onSuccess: () => {
        invalidateAppointments();
        setEditApt(null);
        setStatusDialog(null);
        toast({ title: "Appointment updated" });
      },
      onError: (e) => toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }),
    },
  });

  const deleteMut = useDeleteAppointment({
    mutation: {
      onSuccess: () => {
        invalidateAppointments();
        toast({ title: "Appointment deleted" });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  function resetForm() {
    setForm({
      patientSearch: "",
      selectedPatientId: "",
      selectedDoctorId: "",
      appointmentDate: today,
      timeSlot: "09:00",
      type: "walk-in",
      notes: "",
    });
  }

  function navigateDate(offset: number) {
    setSelectedDate(shiftISODate(selectedDate, offset));
  }

  const filteredPatients = form.patientSearch
    ? patients.filter(
        (p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(form.patientSearch.toLowerCase()) ||
          p.patientId.toLowerCase().includes(form.patientSearch.toLowerCase()) ||
          p.phone.includes(form.patientSearch)
      )
    : patients.slice(0, 8);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.selectedPatientId) {
      toast({ title: "Please select a patient", variant: "destructive" });
      return;
    }
    createMut.mutate({
      data: {
        patientId: Number(form.selectedPatientId),
        doctorId: form.selectedDoctorId ? Number(form.selectedDoctorId) : null,
        appointmentDate: form.appointmentDate,
        timeSlot: form.timeSlot,
        type: form.type,
        notes: form.notes || null,
      },
    });
  }

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "completed") return <CheckCircle2 size={13} />;
    if (status === "cancelled" || status === "no-show") return <XCircle size={13} />;
    if (status === "confirmed") return <CheckCircle2 size={13} />;
    return <AlertCircle size={13} />;
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Appointments"
        subtitle="Schedule and manage patient appointments"
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={15} className="mr-1.5" /> Book Appointment
          </Button>
        }
      />

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total Today", value: stats.total, color: "text-foreground" },
            { label: "Scheduled", value: stats.scheduled, color: "text-blue-600" },
            { label: "Confirmed", value: stats.confirmed, color: "text-indigo-600" },
            { label: "Completed", value: stats.completed, color: "text-green-600" },
            { label: "Cancelled", value: stats.cancelled, color: "text-red-600" },
            { label: "No Show", value: stats.noShow, color: "text-orange-600" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-card-border rounded-xl p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Date Navigator + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg px-2 py-1">
          <button onClick={() => navigateDate(-1)} className="p-1 rounded hover:bg-muted transition-colors">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm font-medium bg-transparent border-none outline-none cursor-pointer px-2"
          />
          <button onClick={() => navigateDate(1)} className="p-1 rounded hover:bg-muted transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSelectedDate(today)}>
          Today
        </Button>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no-show">No Show</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">
          {formatDate(selectedDate)} — {appointments.length} appointment{appointments.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Appointments List */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : appointments.length === 0 ? (
          <div className="p-12 text-center">
            <Calendar size={36} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">No appointments for this date</p>
            <Button className="mt-4" size="sm" onClick={() => setShowForm(true)}>
              <Plus size={13} className="mr-1" /> Book One
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {appointments
              .slice()
              .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
              .map((apt) => {
                const meta = STATUS_META[apt.status] || STATUS_META.scheduled;
                return (
                  <div key={apt.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                    <div className="w-16 text-center flex-shrink-0">
                      <div className="text-sm font-semibold">{apt.timeSlot}</div>
                      <div className="text-xs text-muted-foreground">{apt.type}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <User size={13} className="text-muted-foreground flex-shrink-0" />
                        <span className="font-medium text-sm truncate">
                          {apt.patient ? `${apt.patient.firstName} ${apt.patient.lastName}` : "—"}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{apt.patient?.patientId}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {apt.doctor && (
                          <>
                            <Stethoscope size={11} className="text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Dr. {apt.doctor.name}</span>
                          </>
                        )}
                        {apt.notes && (
                          <span className="text-xs text-muted-foreground italic truncate max-w-[200px]">
                            · {apt.notes}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
                        <StatusIcon status={apt.status} />
                        {meta.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setStatusDialog(apt)}
                        title="Change status"
                      >
                        <RefreshCcw size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditApt(apt)}
                        title="Edit"
                      >
                        <Edit2 size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm("Delete this appointment?")) deleteMut.mutate({ id: apt.id });
                        }}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Book Appointment Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { setShowForm(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Book Appointment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Patient search */}
            <div className="space-y-1.5">
              <Label>Patient *</Label>
              <Input
                placeholder="Search by name, ID or phone…"
                value={form.patientSearch}
                onChange={(e) => setForm({ ...form, patientSearch: e.target.value, selectedPatientId: "" })}
              />
              {!form.selectedPatientId && (
                <div className="border border-card-border rounded-lg max-h-40 overflow-y-auto divide-y divide-card-border">
                  {filteredPatients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        setForm({
                          ...form,
                          patientSearch: `${p.firstName} ${p.lastName} (${p.patientId})`,
                          selectedPatientId: String(p.id),
                        });
                      }}
                    >
                      <span className="font-medium">{p.firstName} {p.lastName}</span>
                      <span className="ml-2 text-muted-foreground font-mono text-xs">{p.patientId}</span>
                      <span className="ml-2 text-muted-foreground text-xs">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.selectedPatientId && (
                <div className="text-xs text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 size={12} /> Patient selected
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.appointmentDate}
                  onChange={(e) => setForm({ ...form, appointmentDate: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Time Slot *</Label>
                <Select value={form.timeSlot} onValueChange={(v) => setForm({ ...form, timeSlot: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Doctor (optional)</Label>
                <Select value={form.selectedDoctorId || "none"} onValueChange={(v) => setForm({ ...form, selectedDoctorId: v === "none" ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No doctor</SelectItem>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>Dr. {d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk-in">Walk-in</SelectItem>
                    <SelectItem value="scheduled">Pre-scheduled</SelectItem>
                    <SelectItem value="emergency">Emergency</SelectItem>
                    <SelectItem value="follow-up">Follow-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                placeholder="Any additional notes…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Booking…" : "Book Appointment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      {editApt && (
        <Dialog open onOpenChange={() => setEditApt(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit Appointment</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input
                  type="date"
                  defaultValue={editApt.appointmentDate}
                  id="edit-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Time Slot</Label>
                <Select defaultValue={editApt.timeSlot} onValueChange={(v) => setEditApt({ ...editApt, timeSlot: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input
                  defaultValue={editApt.notes || ""}
                  id="edit-notes"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditApt(null)}>Cancel</Button>
                <Button
                  disabled={updateMut.isPending}
                  onClick={() => {
                    const dateVal = (document.getElementById("edit-date") as HTMLInputElement)?.value;
                    const notesVal = (document.getElementById("edit-notes") as HTMLInputElement)?.value;
                    updateMut.mutate({
                      id: editApt.id,
                      data: {
                        appointmentDate: dateVal || editApt.appointmentDate,
                        timeSlot: editApt.timeSlot,
                        notes: notesVal || null,
                      },
                    });
                  }}
                >
                  {updateMut.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Status Change Dialog */}
      {statusDialog && (
        <Dialog open onOpenChange={() => setStatusDialog(null)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>Update Status</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-3">
              {statusDialog.patient?.firstName} {statusDialog.patient?.lastName} — {statusDialog.timeSlot}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <button
                  key={key}
                  disabled={statusDialog.status === key || updateMut.isPending}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors
                    ${statusDialog.status === key ? "ring-2 ring-primary " + meta.color : "hover:bg-muted/50 border border-card-border"}`}
                  onClick={() => updateMut.mutate({ id: statusDialog.id, data: { status: key } })}
                >
                  <span className={`w-2 h-2 rounded-full ${meta.color.replace("text-", "bg-").split(" ")[0]}`} />
                  {meta.label}
                  {statusDialog.status === key && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
