import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { bridge, useBridgeStatus } from "@/hooks/useBridge";
import { isFeatureEnabled } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Fingerprint, Wifi, WifiOff, LogIn, LogOut, ShieldAlert, UserPlus } from "lucide-react";

type StaffRow = { id: number; staffId: string; firstName: string; lastName: string; role: string };

export default function AttendanceDevicesPage() {
  const { toast } = useToast();
  const { status } = useBridgeStatus();
  const enabled = isFeatureEnabled("ff_hr_biometric_attendance");

  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [fingerName, setFingerName] = useState("right-index");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: staff = [] } = useQuery({
    queryKey: ["attendance-staff"],
    queryFn: () => api.get<StaffRow[]>("/api/staff?active=true"),
  });

  const enroll = async () => {
    const id = Number(selectedStaff);
    if (!id) { toast({ title: "Select a staff member first", variant: "destructive" }); return; }
    setBusy("enroll");
    try {
      const res = await bridge.enroll("staff", id, fingerName);
      toast({ title: "Fingerprint enrolled", description: `Template #${res.template.id} for staff #${id}` });
    } catch (e) {
      toast({ title: "Enrollment failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const punch = async (action: "in" | "out") => {
    setBusy(action);
    try {
      const res = await bridge.staffPunch(action);
      toast({ title: `Punched ${res.action}`, description: `${res.staff.name} (${res.staff.staffId})` });
    } catch (e) {
      toast({ title: "Punch failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="Attendance Devices" subtitle="USB fingerprint enrollment & punch (bridge-based)" />

      {!enabled && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Shadow Mode</p>
              <p className="text-muted-foreground">Fingerprint attendance is off. Enable the <code>ff_hr_biometric_attendance</code> feature flag and set <code>FINGERPRINT_BRIDGE_SECRET</code> on the server to go live.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bridge status */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Fingerprint className="h-4 w-4" />Local bridge</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          {status.connected ? (
            <>
              <Badge className="gap-1"><Wifi className="h-3 w-3" />Connected</Badge>
              <span className="text-sm text-muted-foreground">Vendor: <b className="text-foreground">{status.vendor ?? "—"}</b> · Device: <b className="text-foreground">{status.deviceConnected ? (status.deviceModel ?? "ready") : "not detected"}</b></span>
            </>
          ) : (
            <>
              <Badge variant="secondary" className="gap-1"><WifiOff className="h-3 w-3" />Offline</Badge>
              <span className="text-sm text-muted-foreground">Start <code>bridge-service</code> on this workstation (port 8765). {status.error ? `(${status.error})` : ""}</span>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Enrollment */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" />Enroll fingerprint</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.firstName} {s.lastName} · {s.staffId}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Finger (e.g. right-index)" value={fingerName} onChange={(e) => setFingerName(e.target.value)} />
            <Button onClick={enroll} disabled={!status.connected || busy !== null} className="w-full">
              {busy === "enroll" ? "Capturing…" : "Capture & enroll"}
            </Button>
            <p className="text-xs text-muted-foreground">Requires the bridge connected and a scanner (or the mock adapter for testing).</p>
          </CardContent>
        </Card>

        {/* Punch */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Punch attendance</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" variant="default" onClick={() => punch("in")} disabled={!status.connected || busy !== null}>
                <LogIn className="h-4 w-4 mr-1" />{busy === "in" ? "…" : "Punch In"}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => punch("out")} disabled={!status.connected || busy !== null}>
                <LogOut className="h-4 w-4 mr-1" />{busy === "out" ? "…" : "Punch Out"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Place the enrolled finger on the scanner, then press. Records an immutable raw punch and updates today's attendance.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
