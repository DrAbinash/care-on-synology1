import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

interface TatRow {
  id: number;
  worklistId: number;
  modality: string | null;
  radiologistName: string | null;
  minutesToReport: number | null;
  dateBucket: string;
}

interface TatAggregate {
  count: number;
  avgMinutes: number;
  min: number;
  max: number;
}

export default function TurnaroundTimeAnalytics() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["turnaroundTimes", dateFrom, dateTo, groupBy],
    enabled: submitted,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (groupBy) params.set("groupBy", groupBy);
      return await api.get<{ rows?: TatRow[]; aggregates?: Record<string, TatAggregate> }>(`/api/ai-reporting/turnaround-times?${params.toString()}`);
    },
  });

  const chartData = data?.aggregates ? Object.entries(data.aggregates).map(([k, v]) => ({ name: k, avg: v.avgMinutes, count: v.count })) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Turnaround Time Analytics" subtitle="Phase 18 — Track study-to-report time per modality, radiologist, and period." />
      <div className="flex gap-2 items-end">
        <div className="w-40"><Label className="text-sm">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="w-40"><Label className="text-sm">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="w-40"><Label className="text-sm">Group By</Label>
          <select className="w-full border rounded px-2 py-1 text-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">none</option><option value="modality">modality</option><option value="radiologist">radiologist</option><option value="date">date</option>
          </select>
        </div>
        <Button onClick={() => setSubmitted(true)}>Analyze</Button>
      </div>
      {isLoading && <div className="text-muted-foreground">Loading…</div>}
      {data?.aggregates && chartData.length > 0 && (
        <Card>
          <CardContent className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avg" fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      {data?.rows && data.rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Worklist</TableHead><TableHead>Modality</TableHead><TableHead>Radiologist</TableHead><TableHead>Minutes</TableHead><TableHead>Date</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.worklistId}</TableCell>
                    <TableCell>{r.modality ?? "—"}</TableCell>
                    <TableCell>{r.radiologistName ?? "—"}</TableCell>
                    <TableCell>{r.minutesToReport ?? "—"}</TableCell>
                    <TableCell>{r.dateBucket}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
