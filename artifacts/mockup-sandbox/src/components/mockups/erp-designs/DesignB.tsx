export function DesignB() {
  const stats = [
    { label: "Today's Revenue", value: "₹48,250", sub: "+12% vs yesterday", accent: "#2563eb", bg: "#eff6ff", icon: "💰" },
    { label: "Patients Today", value: "34", sub: "6 pending, 28 done", accent: "#0891b2", bg: "#ecfeff", icon: "🧑‍⚕️" },
    { label: "Tests Ordered", value: "127", sub: "Across 34 visits", accent: "#059669", bg: "#ecfdf5", icon: "🧪" },
    { label: "Pending Reports", value: "11", sub: "3 overdue", accent: "#dc2626", bg: "#fef2f2", icon: "📋" },
  ];

  const recentBills = [
    { name: "Priya Sharma", tests: "CBC, LFT, TSH", amount: "₹2,400", status: "Paid", time: "10:42 AM" },
    { name: "Ramesh Kumar", tests: "X-Ray Chest, ECG", amount: "₹1,850", status: "Pending", time: "10:31 AM" },
    { name: "Anita Singh", tests: "Urine R/M, HbA1c", amount: "₹980", status: "Paid", time: "10:18 AM" },
    { name: "Vikram Patel", tests: "MRI Brain Contrast", amount: "₹8,500", status: "Partial", time: "09:55 AM" },
    { name: "Sunita Devi", tests: "CBC, CRP, ESR", amount: "₹1,200", status: "Paid", time: "09:40 AM" },
  ];

  const navItems = [
    { icon: "⚡", label: "Billing Desk", active: false },
    { icon: "📊", label: "Dashboard", active: true },
    { icon: "👥", label: "Patients", active: false },
    { icon: "🧪", label: "Test Catalog", active: false },
    { icon: "🧾", label: "Billing", active: false },
    { icon: "📈", label: "Reports", active: false },
    { icon: "💊", label: "Inventory", active: false },
    { icon: "🏥", label: "Appointments", active: false },
    { icon: "⚙️", label: "Settings", active: false },
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar — bright white, border-right only */}
      <div className="w-52 flex-shrink-0 flex flex-col bg-white border-r border-gray-100">
        {/* Logo */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white text-sm font-bold">D</div>
          <div>
            <div className="text-gray-900 font-bold text-sm">Care Diagnostics</div>
            <div className="text-blue-500 text-[10px] font-medium">Medical ERP</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.map((item) => (
            <div key={item.label}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer text-xs transition-all ${
                item.active
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
              {item.active && <div className="ml-auto w-1 h-3.5 rounded-full bg-blue-500" />}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">A</div>
            <div className="min-w-0">
              <div className="text-gray-800 text-xs font-semibold truncate">Dr. Abinash</div>
              <div className="text-gray-400 text-[10px]">Super Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <div className="text-gray-900 font-bold text-base">Good morning, Dr. Abinash 👋</div>
            <div className="text-gray-400 text-xs">Saturday, 10 May 2026 · 10:45 AM</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-full text-xs text-green-700 font-medium border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Clinic Open
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">A</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: s.bg, color: s.accent }}>↑ 12%</span>
                </div>
                <div className="text-2xl font-extrabold text-gray-900 mb-0.5">{s.value}</div>
                <div className="text-xs text-gray-500 font-medium">{s.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-gray-800 font-semibold text-sm">Revenue Trend</div>
                  <div className="text-gray-400 text-xs">Last 7 days</div>
                </div>
                <div className="flex gap-1">
                  {["Day","Week","Month"].map((t, i) => (
                    <button key={t} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      i === 1 ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-50"
                    }`}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-2 h-24">
                {[60, 85, 45, 90, 70, 55, 95].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-md" style={{
                      height: `${h}%`,
                      background: i === 6 ? "#2563eb" : "#dbeafe",
                    }} />
                    <div className="text-[9px] text-gray-400">
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <div className="text-gray-800 font-semibold text-sm mb-1">Quick Actions</div>
              <div className="text-gray-400 text-xs mb-4">Common tasks</div>
              {[
                { label: "New Patient", icon: "➕", color: "#2563eb", bg: "#eff6ff" },
                { label: "Create Bill", icon: "🧾", color: "#059669", bg: "#ecfdf5" },
                { label: "Add Report", icon: "📋", color: "#7c3aed", bg: "#f5f3ff" },
                { label: "View Payments", icon: "💳", color: "#dc2626", bg: "#fef2f2" },
              ].map((a) => (
                <div key={a.label} className="flex items-center gap-3 p-2.5 rounded-xl mb-2 cursor-pointer hover:scale-[1.01] transition-transform"
                  style={{ background: a.bg }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                    style={{ background: "white" }}>{a.icon}</div>
                  <span className="text-xs font-semibold" style={{ color: a.color }}>{a.label}</span>
                  <span className="ml-auto text-gray-400 text-xs">→</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent bills */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <div className="text-gray-800 font-semibold text-sm">Recent Bills</div>
              <div className="text-blue-600 text-xs font-medium cursor-pointer">View all →</div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  {["Patient", "Tests", "Amount", "Status", "Time"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left text-gray-400 font-semibold text-[10px] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentBills.map((b, idx) => (
                  <tr key={b.name} className={`border-b border-gray-50 hover:bg-blue-50/40 transition-colors ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                    <td className="px-5 py-3 text-gray-800 font-semibold">{b.name}</td>
                    <td className="px-5 py-3 text-gray-500">{b.tests}</td>
                    <td className="px-5 py-3 text-gray-900 font-bold">{b.amount}</td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold" style={{
                        background: b.status === "Paid" ? "#ecfdf5" : b.status === "Pending" ? "#fffbeb" : "#eff6ff",
                        color: b.status === "Paid" ? "#059669" : b.status === "Pending" ? "#d97706" : "#2563eb",
                      }}>{b.status}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{b.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
