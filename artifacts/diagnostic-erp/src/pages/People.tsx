import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Search, Award, GraduationCap, FileText, GitBranch, Clock, ShieldAlert, UserCircle2,
} from "lucide-react";

// ── Types (mirror the /api/people/staff/:id/profile response) ────────────────
type StaffRow = { id: number; staffId: string; firstName: string; lastName: string; role: string; department: string | null; isActive: boolean; phone: string | null; email: string | null; joiningDate: string | null };
type Skill = { id: number; skillId: number; level: string; certified: boolean; name: string; category: string | null };
type TimelineEvent = { id: number; eventType: string; title: string; description: string | null; occurredAt: string; sourceModule: string };
type StatusEvent = { id: number; status: string; previousStatus: string | null; effectiveFrom: string; reason: string | null };
type DocMeta = { id: number; docType: string; title: string | null; fileName: string | null; confidential: boolean; createdAt: string };
type Profile = {
  staff: StaffRow;
  employment: { department: string | null; role: string; joiningDate: string | null; isActive: boolean };
  reportsTo: { supervisorStaffId: number; supervisorName: string | null; relationship: string }[];
  directReports: { staffId: number; name: string | null }[];
  skills: Skill[];
  timeline: TimelineEvent[];
  statusHistory: StatusEvent[];
  documents: DocMeta[];
  identity: { id: number; name: string; role: string } | null;
};

const initials = (f: string, l: string) => `${f?.[0] ?? ""}${l?.[0] ?? ""}`.toUpperCase();

const LEVEL_STYLES: Record<string, string> = {
  trainer: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  advanced: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  intermediate: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  beginner: "bg-muted text-muted-foreground",
};

function tenure(joiningDate: string | null): string {
  if (!joiningDate) return "—";
  const start = new Date(joiningDate);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  const y = Math.floor(months / 12), m = months % 12;
  return `${y ? `${y}y ` : ""}${m}m`;
}

export default function PeoplePage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: staff = [], isLoading: loadingList } = useQuery({
    queryKey: ["people-directory", search],
    queryFn: () => api.get<StaffRow[]>(`/api/staff?active=true${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="People" subtitle="360° employee profiles — the single source of truth" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr] gap-4">
        {/* Directory */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search staff…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[70vh] overflow-y-auto">
            {loadingList ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : staff.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No staff found.</p>
            ) : (
              staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted ${selectedId === s.id ? "bg-muted" : ""}`}
                >
                  <Avatar className="h-9 w-9"><AvatarFallback>{initials(s.firstName, s.lastName)}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.firstName} {s.lastName}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.role}{s.department ? ` · ${s.department}` : ""}</div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Profile */}
        {selectedId == null ? (
          <Card className="flex items-center justify-center min-h-[300px]">
            <div className="text-center text-muted-foreground">
              <UserCircle2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a staff member to view their 360° profile.</p>
            </div>
          </Card>
        ) : (
          <ProfilePanel staffId={selectedId} />
        )}
      </div>
    </div>
  );
}

function ProfilePanel({ staffId }: { staffId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["people-profile", staffId],
    queryFn: () => api.get<Profile>(`/api/people/staff/${staffId}/profile`),
    retry: false,
  });

  if (isLoading) return <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></CardContent></Card>;

  if (error) {
    const msg = (error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <Card className="min-h-[300px] flex items-center justify-center">
        <div className="text-center text-muted-foreground max-w-sm px-6">
          <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
          <p className="text-sm font-medium mb-1">{shadow ? "People platform is in Shadow Mode" : "Could not load profile"}</p>
          <p className="text-xs">{shadow ? "Enable the ff_hr_staff_enhanced feature flag to view 360° profiles." : msg}</p>
        </div>
      </Card>
    );
  }
  if (!data) return null;

  const { staff, employment, reportsTo, directReports, skills, timeline, statusHistory, documents, identity } = data;

  return (
    <Card>
      {/* Header */}
      <CardHeader className="pb-4 border-b">
        <div className="flex items-start gap-4">
          <Avatar className="h-16 w-16 text-lg"><AvatarFallback>{initials(staff.firstName, staff.lastName)}</AvatarFallback></Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-xl">{staff.firstName} {staff.lastName}</CardTitle>
              <Badge variant={staff.isActive ? "default" : "secondary"}>{staff.isActive ? "Active" : "Inactive"}</Badge>
              {identity && <Badge variant="outline">Linked ERP user</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{staff.role}{employment.department ? ` · ${employment.department}` : ""} · {staff.staffId}</p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
              <span>Tenure: <b className="text-foreground">{tenure(employment.joiningDate)}</b></span>
              <span>Skills: <b className="text-foreground">{skills.length}</b></span>
              <span>Reports: <b className="text-foreground">{directReports.length}</b></span>
              {reportsTo[0]?.supervisorName && <span>Manager: <b className="text-foreground">{reportsTo[0].supervisorName}</b></span>}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="skills"><GraduationCap className="h-3.5 w-3.5 mr-1" />Skills</TabsTrigger>
            <TabsTrigger value="timeline"><Clock className="h-3.5 w-3.5 mr-1" />Timeline</TabsTrigger>
            <TabsTrigger value="reporting"><GitBranch className="h-3.5 w-3.5 mr-1" />Reporting</TabsTrigger>
            <TabsTrigger value="documents"><FileText className="h-3.5 w-3.5 mr-1" />Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Employee code" value={staff.staffId} />
              <Field label="Role" value={staff.role} />
              <Field label="Department" value={employment.department ?? "—"} />
              <Field label="Phone" value={staff.phone ?? "—"} />
              <Field label="Email" value={staff.email ?? "—"} />
              <Field label="Joining date" value={employment.joiningDate ?? "—"} />
            </div>
            {statusHistory[0] && (
              <div className="text-xs text-muted-foreground">Current status: <b className="text-foreground">{statusHistory[0].status}</b> since {statusHistory[0].effectiveFrom}</div>
            )}
          </TabsContent>

          <TabsContent value="skills">
            {skills.length === 0 ? <Empty icon={GraduationCap} text="No skills recorded yet." /> : (
              <div className="flex flex-wrap gap-2">
                {skills.map((sk) => (
                  <span key={sk.id} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${LEVEL_STYLES[sk.level] ?? LEVEL_STYLES.beginner}`}>
                    {sk.name}
                    <span className="opacity-70">· {sk.level}</span>
                    {sk.certified && <Award className="h-3 w-3" />}
                  </span>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="timeline">
            {timeline.length === 0 ? <Empty icon={Clock} text="No timeline events yet." /> : (
              <ol className="relative border-l ml-2 space-y-4">
                {timeline.map((t) => (
                  <li key={t.id} className="ml-4">
                    <div className="absolute -left-1.5 h-3 w-3 rounded-full bg-primary" />
                    <div className="text-sm font-medium">{t.title}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                    <div className="text-[11px] text-muted-foreground mt-0.5">{new Date(t.occurredAt).toLocaleDateString()} · {t.sourceModule}</div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>

          <TabsContent value="reporting" className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Reports to</div>
              {reportsTo.length === 0 ? <p className="text-sm text-muted-foreground">No supervisor set.</p> :
                reportsTo.map((r) => <div key={r.supervisorStaffId} className="text-sm">{r.supervisorName ?? `Staff #${r.supervisorStaffId}`} <span className="text-xs text-muted-foreground">({r.relationship})</span></div>)}
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Direct reports ({directReports.length})</div>
              {directReports.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> :
                <div className="flex flex-wrap gap-2">{directReports.map((r) => <Badge key={r.staffId} variant="secondary">{r.name ?? `Staff #${r.staffId}`}</Badge>)}</div>}
            </div>
          </TabsContent>

          <TabsContent value="documents">
            {documents.length === 0 ? <Empty icon={FileText} text="No documents in the vault." /> : (
              <div className="space-y-2">
                {documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.title || d.fileName || d.docType}</div>
                      <div className="text-xs text-muted-foreground">{d.docType} · {new Date(d.createdAt).toLocaleDateString()}</div>
                    </div>
                    {d.confidential && <Badge variant="outline" className="text-[10px]">Confidential</Badge>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm truncate">{value}</div>
    </div>
  );
}
function Empty({ icon: Icon, text }: { icon: typeof Users; text: string }) {
  return <div className="text-center text-muted-foreground py-8"><Icon className="h-8 w-8 mx-auto mb-2 opacity-50" /><p className="text-sm">{text}</p></div>;
}
