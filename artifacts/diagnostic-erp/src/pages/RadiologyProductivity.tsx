// Phase 8: Radiology Productivity Dashboard
// Per-doctor and department analytics for radiology reporting.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  BarChart3, ArrowLeft, TrendingUp, Activity, Users,
  Calendar, FileText, ScanLine, Stethoscope,
} from "lucide-react";

interface ProductivityData {
  totalReports: number;
  byRadiologist: {
    name: string;
    count: number;
    avgImages: number;
    modalities: string[];
    bodyParts: string[];
  }[];
  byModality: { name: string; count: number }[];
  byBodyPart: { name: string; count: number }[];
  dailyCounts: { date: string; count: number }[];
}

export default function RadiologyProductivity() {
  const [_, navigate] = useLocation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["radiology-productivity", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return api.get<ProductivityData>(`/radiology-copilot/productivity?${params.toString()}`);
    },
  });

  const stats = data ?? {
    totalReports: 0,
    byRadiologist: [],
    byModality: [],
    byBodyPart: [],
    dailyCounts: [],
  };

  const maxDaily = Math.max(...stats.dailyCounts.map((d) => d.count), 1);
  const maxRadiologist = Math.max(...stats.byRadiologist.map((r) => r.count), 1);
  const maxModality = Math.max(...stats.byModality.map((m) => m.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Radiology Productivity Dashboard"
        subtitle="Per-doctor and department reporting analytics"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/radiology")}>
          <ArrowLeft size={16} className="mr-2" /> Radiology
        </Button>
      </div>

      {/* Date filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-muted-foreground" />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm w-40"
          />
        </div>
        <span className="text-sm text-muted-foreground">to</span>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm w-40"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setDateFrom(""); setDateTo(""); }}
        >
          Clear
        </Button>
      </div>

      {/* Total reports */}
      <div className="bg-card border border-card-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-primary" />
          <div>
            <div className="text-3xl font-bold">{stats.totalReports}</div>
            <div className="text-sm text-muted-foreground">Finalized Reports</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* By Radiologist */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Users size={16} className="text-primary" /> Reports by Radiologist
            </h3>
            <div className="space-y-3">
              {stats.byRadiologist.map((r) => (
                <div key={r.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.name}</span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{r.count} reports</span>
                      <span>{r.avgImages} avg images</span>
                    </div>
                  </div>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min((r.count / maxRadiologist) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.modalities.map((m) => (
                      <Badge key={m} variant="outline" className="text-[10px] px-1 py-0">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
              {stats.byRadiologist.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No reports yet</p>
              )}
            </div>
          </div>

          {/* By Modality */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <ScanLine size={16} className="text-primary" /> Reports by Modality
            </h3>
            <div className="space-y-2">
              {stats.byModality.map((m) => (
                <div key={m.name} className="flex items-center gap-3">
                  <span className="text-sm w-20 truncate">{m.name}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min((m.count / maxModality) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{m.count}</span>
                </div>
              ))}
              {stats.byModality.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              )}
            </div>
          </div>

          {/* By Body Part */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <Stethoscope size={16} className="text-primary" /> Reports by Body Part
            </h3>
            <div className="space-y-2">
              {stats.byBodyPart.map((bp) => (
                <div key={bp.name} className="flex items-center gap-3">
                  <span className="text-sm w-32 truncate">{bp.name}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min((bp.count / stats.totalReports) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{bp.count}</span>
                </div>
              ))}
              {stats.byBodyPart.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              )}
            </div>
          </div>

          {/* Daily Trend */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-primary" /> Daily Trend
            </h3>
            <div className="space-y-2">
              {stats.dailyCounts.map((d) => (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="text-[10px] w-20 text-muted-foreground">{d.date}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min((d.count / maxDaily) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-6 text-right">{d.count}</span>
                </div>
              ))}
              {stats.dailyCounts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No daily data yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
