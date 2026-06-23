import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import {
  TrendingUp, Activity, PieChart, ShieldAlert, Award, Star
} from "lucide-react";

type ProfitData = {
  labName: string;
  patientCharge: string | number;
  outsourceCost: string | number;
  netHospitalProfit: string | number;
  orderCount: string | number;
};

export default function OutsourceDashboard() {
  const { data: profitStats = [], isLoading } = useQuery<ProfitData[]>({
    queryKey: ["outsource-profitability"],
    queryFn: () => api.get<ProfitData[]>("/api/outsourced-labs/dashboard/profitability"),
  });

  // Calculate totals
  const totals = (() => {
    let patientCharge = 0;
    let outsourceCost = 0;
    let netProfit = 0;
    let orderCount = 0;

    profitStats.forEach((p) => {
      patientCharge += Number(p.patientCharge);
      outsourceCost += Number(p.outsourceCost);
      netProfit += Number(p.netHospitalProfit);
      orderCount += Number(p.orderCount);
    });

    const marginPercent = patientCharge > 0 ? (netProfit / patientCharge) * 100 : 0;
    return { patientCharge, outsourceCost, netProfit, orderCount, marginPercent };
  })();

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Profitability Dashboard"
        subtitle="Analyze partner lab volume splits, margin performance, and hospital net margins"
      />

      <div className="px-6 space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Patient Billing</span>
            <span className="text-2xl font-bold text-foreground mt-2">₹{totals.patientCharge.toFixed(2)}</span>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Outsource Cost</span>
            <span className="text-2xl font-bold text-foreground mt-2">₹{totals.outsourceCost.toFixed(2)}</span>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 p-5 rounded-xl shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase">Net Hospital Profit</span>
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-2">₹{totals.netProfit.toFixed(2)}</span>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Average Margin %</span>
            <span className="text-2xl font-bold text-primary mt-2">{totals.marginPercent.toFixed(1)}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lab splits table */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col justify-between">
            <div>
              <div className="p-4 border-b border-border/80 bg-muted/20">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Activity size={15} className="text-primary" />
                  Reference Lab breakdown
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/15">
                      <th className="px-5 py-3 font-medium">Lab Name</th>
                      <th className="px-5 py-3 font-medium text-right">Orders</th>
                      <th className="px-5 py-3 font-medium text-right">Billing (₹)</th>
                      <th className="px-5 py-3 font-medium text-right">Cost (₹)</th>
                      <th className="px-5 py-3 font-medium text-right">Net Profit (₹)</th>
                      <th className="px-5 py-3 font-medium text-right">Margin (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [...Array(3)].map((_, i) => (
                        <tr key={i} className="border-b border-border/50 animate-pulse">
                          {[...Array(6)].map((_, j) => (
                            <td key={j} className="px-5 py-3"><div className="h-4 bg-muted rounded w-16 mx-auto" /></td>
                          ))}
                        </tr>
                      ))
                    ) : profitStats.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
                          No outsourced lab data registered.
                        </td>
                      </tr>
                    ) : (
                      profitStats.map((item, idx) => {
                        const bill = Number(item.patientCharge);
                        const profit = Number(item.netHospitalProfit);
                        const margin = bill > 0 ? (profit / bill) * 100 : 0;
                        return (
                          <tr key={idx} className="border-b border-border/50 hover:bg-muted/10 last:border-0">
                            <td className="px-5 py-3 font-semibold text-foreground">{item.labName}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{item.orderCount}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs">₹{bill.toFixed(2)}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs">₹{Number(item.outsourceCost).toFixed(2)}</td>
                            <td className="px-5 py-3 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              ₹{profit.toFixed(2)}
                            </td>
                            <td className="px-5 py-3 text-right font-mono text-xs font-bold text-foreground">
                              {margin.toFixed(1)}%
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

          {/* Side stats card */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-1.5">
              <PieChart size={16} className="text-primary" />
              Volume Distribution
            </h3>
            <div className="space-y-4 pt-2">
              {profitStats.map((item, idx) => {
                const percentage = totals.orderCount > 0 ? (Number(item.orderCount) / totals.orderCount) * 100 : 0;
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-foreground">{item.labName}</span>
                      <span className="text-muted-foreground">{Number(item.orderCount)} orders ({percentage.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="bg-primary h-2 rounded-full" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
              {profitStats.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No lab statistics available.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
