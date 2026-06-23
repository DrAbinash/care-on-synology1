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

interface ProviderRow {
  provider: string;
  model: string;
  total: number;
}

export default function FeedbackLoopAnalytics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["feedbackLoopAnalytics", from, to],
    enabled: submitted,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return await api.get<{ dateFrom: string; dateTo: string; byProvider: ProviderRow[] }>(`/api/ai-reporting/feedback-loop-analytics?${params.toString()}`);
    },
  });

  const chartData = data?.byProvider?.map((r) => ({
    name: `${r.provider} (${r.model ?? "default"})`,
    drafts: r.total,
  })) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="AI Feedback Loop Analytics" subtitle="Phase 14 — Correlates radiologist feedback with AI model/provider performance over time." />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-sm">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={() => setSubmitted(true)}>Analyze</Button>
      </div>
      {isLoading && <div className="text-muted-foreground">Loading analytics…</div>}
      {data && (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">Period: {new Date(data.dateFrom).toLocaleDateString()} — {new Date(data.dateTo).toLocaleDateString()}</div>
          <Card>
            <CardContent className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="drafts" fill="var(--color-primary)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Total Drafts</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProvider.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.provider}</TableCell>
                      <TableCell>{r.model ?? "—"}</TableCell>
                      <TableCell>{r.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
