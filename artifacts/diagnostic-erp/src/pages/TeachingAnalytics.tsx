// Phase 8: Teaching Analytics Dashboard
// Per-doctor and department analytics for teaching file usage.

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  BarChart3, ArrowLeft, TrendingUp, Eye, Heart, BookOpen,
  GraduationCap, Users, Star, Activity,
} from "lucide-react";

interface AnalyticsData {
  totalCases: number;
  totalViews: number;
  myCases: number;
  myFavorites: number;
  researchCases: number;
  byCategory: { category: string; count: number }[];
  byModality: { modality: string; count: number }[];
  mostViewed: { id: number; title: string; viewCount: number }[];
}

export default function TeachingAnalytics() {
  const [_, navigate] = useLocation();

  const { data } = useQuery({
    queryKey: ["teaching-analytics"],
    queryFn: async () => {
      return api.get<AnalyticsData>("/teaching-cases/analytics");
    },
  });

  const stats = data ?? {
    totalCases: 0, totalViews: 0, myCases: 0, myFavorites: 0,
    researchCases: 0, byCategory: [], byModality: [], mostViewed: [],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Analytics"
        subtitle="Usage statistics and insights for teaching files"
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate("/teaching-cases")}>
          <ArrowLeft size={16} className="mr-2" /> Teaching Files
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <BookOpen size={18} className="text-primary" />
            <div className="text-2xl font-bold">{stats.totalCases}</div>
          </div>
          <div className="text-xs text-muted-foreground">Total Cases</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Eye size={18} className="text-blue-500" />
            <div className="text-2xl font-bold">{stats.totalViews}</div>
          </div>
          <div className="text-xs text-muted-foreground">Total Views</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <GraduationCap size={18} className="text-purple-500" />
            <div className="text-2xl font-bold">{stats.myCases}</div>
          </div>
          <div className="text-xs text-muted-foreground">My Cases</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Heart size={18} className="text-red-500" />
            <div className="text-2xl font-bold">{stats.myFavorites}</div>
          </div>
          <div className="text-xs text-muted-foreground">My Favorites</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Star size={18} className="text-amber-500" />
            <div className="text-2xl font-bold">{stats.researchCases}</div>
          </div>
          <div className="text-xs text-muted-foreground">Research Cases</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By Category */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-primary" /> Cases by Category
          </h3>
          <div className="space-y-2">
            {stats.byCategory.map((cat) => (
              <div key={cat.category} className="flex items-center gap-3">
                <span className="text-sm w-32 truncate">{cat.category}</span>
                <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min((cat.count / (stats.totalCases || 1)) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-8 text-right">{cat.count}</span>
              </div>
            ))}
            {stats.byCategory.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
            )}
          </div>
        </div>

        {/* By Modality */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Activity size={16} className="text-primary" /> Cases by Modality
          </h3>
          <div className="space-y-2">
            {stats.byModality.map((mod) => (
              <div key={mod.modality} className="flex items-center gap-3">
                <span className="text-sm w-32 truncate">{mod.modality}</span>
                <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min((mod.count / (stats.totalCases || 1)) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-8 text-right">{mod.count}</span>
              </div>
            ))}
            {stats.byModality.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Most Viewed */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-primary" /> Most Viewed Cases
        </h3>
        <div className="space-y-2">
          {stats.mostViewed.map((mv, i) => (
            <div key={mv.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/teaching-cases/${mv.id}`)}>
              <Badge variant="outline">{i + 1}</Badge>
              <span className="text-sm font-medium flex-1">{mv.title}</span>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Eye size={12} /> {mv.viewCount}
              </span>
            </div>
          ))}
          {stats.mostViewed.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No views yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
