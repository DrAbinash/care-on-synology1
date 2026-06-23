export function DesignA() {
  const stats = [
    { label: "Today's Revenue", value: "₹48,250", sub: "+12% vs yesterday", color: "from-violet-500 to-purple-600", icon: "💰" },
    { label: "Patients Today", value: "34", sub: "6 pending, 28 done", color: "from-blue-500 to-cyan-500", icon: "🧑‍⚕️" },
    { label: "Tests Ordered", value: "127", sub: "Across 34 visits", color: "from-emerald-500 to-teal-500", icon: "🧪" },
    { label: "Pending Reports", value: "11", sub: "3 overdue", color: "from-rose-500 to-pink-500", icon: "📋" },
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
    <div className="flex h-screen bg-slate-950 font-sans overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 flex flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #1e1040 0%, #0f0a2e 100%)" }}>
        {/* Glow orb behind sidebar */}
        <div className="absolute top-0 left-0 w-full h-40 opacity-30 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, #7c3aed 0%, transparent 70%)" }} />

        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10 relative z-10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>D</div>
          <div>
            <div className="text-white font-bold text-sm tracking-tight">Care Diagnostics</div>
            <div className="text-violet-400 text-[10px]">ERP v2</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 relative z-10">
          {navItems.map((item) => (
            <div key={item.label}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ${
                item.active
                  ? "text-white font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              style={item.active ? {
                background: "linear-gradient(90deg, rgba(124,58,237,0.35), rgba(79,70,229,0.2))",
                boxShadow: "inset 0 0 0 1px rgba(139,92,246,0.3)"
              } : {}}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
              {item.active && <div className="ml-auto w-1 h-4 rounded-full bg-violet-400" />}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}>A</div>
            <div className="min-w-0">
              <div className="text-white text-xs font-semibold truncate">Dr. Abinash Kumar</div>
              <div className="text-violet-400 text-[10px]">Super Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-14 flex items-center justify-between px-6 flex-shrink-0 border-b border-white/5"
          style={{ background: "rgba(15,10,46,0.7)", backdropFilter: "blur(12px)" }}>
          <div>
            <div className="text-white font-bold text-lg">Dashboard</div>
            <div className="text-slate-400 text-xs">Saturday, 10 May 2026</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5"
              style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · 10 May 2026
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6"
          style={{ background: "linear-gradient(160deg, #0d0a24 0%, #080614 100%)" }}>

          {/* Stat Cards */}
          <div className="grid grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="relative rounded-2xl overflow-hidden p-4"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)"
                }}>
                <div className="absolute top-0 right-0 w-20 h-20 opacity-20 pointer-events-none"
                  style={{ background: `radial-gradient(circle at 100% 0%, ${s.color.includes("violet") ? "#7c3aed" : s.color.includes("blue") ? "#3b82f6" : s.color.includes("emerald") ? "#10b981" : "#f43f5e"}, transparent 70%)` }} />
                <div className="text-2xl mb-2">{s.icon}</div>
                <div className="text-2xl font-bold text-white mb-0.5">{s.value}</div>
                <div className="text-xs text-slate-400">{s.label}</div>
                <div className="text-[10px] text-slate-500 mt-1">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-4">
            {/* Revenue Chart */}
            <div className="col-span-2 rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-semibold text-sm">Revenue Trend</div>
                  <div className="text-slate-500 text-xs">Last 7 days</div>
                </div>
                <div className="px-2.5 py-1 rounded-lg text-xs text-violet-400"
                  style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.2)" }}>Weekly</div>
              </div>
              {/* Bar chart */}
              <div className="flex items-end gap-2 h-28">
                {[60, 85, 45, 90, 70, 55, 95].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-md" style={{
                      height: `${h}%`,
                      background: i === 6
                        ? "linear-gradient(180deg, #7c3aed, #4f46e5)"
                        : "rgba(124,58,237,0.25)",
                      border: i === 6 ? "none" : "1px solid rgba(124,58,237,0.2)"
                    }} />
                    <div className="text-[9px] text-slate-600">
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Test mix */}
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-white font-semibold text-sm mb-1">Test Mix</div>
              <div className="text-slate-500 text-xs mb-4">By department today</div>
              {[
                { label: "Pathology", pct: 48, color: "#7c3aed" },
                { label: "Radiology", pct: 28, color: "#3b82f6" },
                { label: "Cardiology", pct: 14, color: "#10b981" },
                { label: "Others", pct: 10, color: "#f59e0b" },
              ].map((row) => (
                <div key={row.label} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{row.label}</span>
                    <span className="text-slate-300 font-medium">{row.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5">
                    <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent bills */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
              <div className="text-white font-semibold text-sm">Recent Bills</div>
              <div className="text-violet-400 text-xs cursor-pointer">View all →</div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  {["Patient", "Tests", "Amount", "Status", "Time"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentBills.map((b) => (
                  <tr key={b.name} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-white font-medium">{b.name}</td>
                    <td className="px-5 py-3 text-slate-400">{b.tests}</td>
                    <td className="px-5 py-3 text-white font-semibold">{b.amount}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{
                        background: b.status === "Paid" ? "rgba(16,185,129,0.15)" : b.status === "Pending" ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.15)",
                        color: b.status === "Paid" ? "#34d399" : b.status === "Pending" ? "#fbbf24" : "#60a5fa",
                        border: `1px solid ${b.status === "Paid" ? "rgba(16,185,129,0.3)" : b.status === "Pending" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)"}`
                      }}>{b.status}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{b.time}</td>
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
