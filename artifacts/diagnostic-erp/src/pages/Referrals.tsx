import { useState } from "react";
import Doctors from "@/pages/Doctors";
import CommissionReportTab from "@/pages/CommissionReportTab";
import { Users, FileBarChart2 } from "lucide-react";

const TABS = [
  { id: "doctors",    label: "Doctors",          icon: Users },
  { id: "commission", label: "Commission Report", icon: FileBarChart2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Referrals() {
  const [activeTab, setActiveTab] = useState<TabId>("doctors");

  return (
    <div>
      {/* Tab bar — rendered above whichever tab's own content */}
      <div className="flex gap-1 border-b border-border px-4 sm:px-6 pt-4 sm:pt-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content — each tab manages its own inner layout/header */}
      {activeTab === "doctors" ? (
        <Doctors />
      ) : (
        <div className="p-4 sm:p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold">Commission Report</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Per-doctor referral commission breakdown by test
            </p>
          </div>
          <CommissionReportTab />
        </div>
      )}
    </div>
  );
}
