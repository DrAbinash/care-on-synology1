import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw } from "lucide-react";

type AccessLogRow = {
  id: number;
  studyId: number;
  userId: number;
  userName: string | null;
  userRole: string | null;
  action: string;
  detailsJson: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export default function StudyAccessLogs() {
  const [studyId, setStudyId] = useState("");
  const [userId, setUserId] = useState("");

  const params = new URLSearchParams();
  if (studyId.trim()) params.set("studyId", studyId.trim());
  if (userId.trim()) params.set("userId", userId.trim());
  params.set("limit", "500");

  const { data = [], isLoading, refetch, isFetching } = useQuery<AccessLogRow[]>({
    queryKey: ["radiology-workflow-access-logs", studyId, userId],
    queryFn: () => api.get(`/api/radiology-workflow/access-logs?${params.toString()}`),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Study Access Logs"
        subtitle="Audit trail when staff open or act on imaging studies (admin only)."
      />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Study ID</Label>
          <Input className="w-32" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">User ID</Label>
          <Input className="w-32" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Optional" />
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Study</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No access log entries.</TableCell>
                </TableRow>
              )}
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.studyId}</TableCell>
                  <TableCell className="text-xs">
                    {row.userName ?? "—"}
                    <span className="text-muted-foreground"> #{row.userId}</span>
                  </TableCell>
                  <TableCell className="text-xs">{row.userRole ?? "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{row.action}</TableCell>
                  <TableCell className="text-xs font-mono">{row.ipAddress ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[240px] truncate" title={row.detailsJson ?? ""}>
                    {row.detailsJson ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
