export function DesignC() {
  const stats = [
    { label: "Today's Revenue", value: "₹48,250", delta: "+12%", color: "#22d3ee", glow: "rgba(34,211,238,0.15)" },
    { label: "Patients Today", value: "34", delta: "+4", color: "#a78bfa", glow: "rgba(167,139,250,0.15)" },
    { label: "Tests Ordered", value: "127", delta: "+18", color: "#34d399", glow: "rgba(52,211,153,0.15)" },
    { label: "Pending Reports", value: "11", delta: "3 late", color: "#fb7185", glow: "rgba(251,113,133,0.15)" },
  ];

  const recentBills = [
    { name: "Priya Sharma", tests: "CBC, LFT, TSH", amount: "₹2,400", status: "Paid", time: "10:42 AM" },
    { name: "Ramesh Kumar", tests: "X-Ray Chest, ECG", amount: "₹1,850", status: "Pending", time: "10:31 AM" },
    { name: "Anita Singh", tests: "Urine R/M, HbA1c", amount: "₹980", status: "Paid", time: "10:18 AM" },
    { name: "Vikram Patel", tests: "MRI Brain Contrast", amount: "₹8,500", status: "Partial", time: "09:55 AM" },
    { name: "Sunita Devi", tests: "CBC, CRP, ESR", amount: "₹1,200", status: "Paid", time: "09:40 AM" },
  ];

  const navItems = [
    { icon: "⚡", label: "Billing Desk", active: false, color: "#fbbf24" },
    { icon: "📊", label: "Dashboard", active: true, color: "#22d3ee" },
    { icon: "👥", label: "Patients", active: false, color: "#a78bfa" },
    { icon: "🧪", label: "Test Catalog", active: false, color: "#34d399" },
    { icon: "🧾", label: "Billing", active: false, color: "#fb923c" },
    { icon: "📈", label: "Reports", active: false, color: "#f472b6" },
    { icon: "💊", label: "Inventory", active: false, color: "#60a5fa" },
    { icon: "🏥", label: "Appointments", active: false, color: "#4ade80" },
    { icon: "⚙️", label: "Settings", active: false, color: "#94a3b8" },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: "'Inter', sans-serif", background: "#050810" }}>
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 flex flex-col border-r"
        style={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.06)" }}>
        {/* Logo */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", boxShadow: "0 0 12px rgba(34,211,238,0.4)" }}>D</div>
          <div>
            <div className="text-white font-bold text-sm">Care Diagnostics</div>
            <div className="text-[10px] font-medium" style={{ color: "#22d3ee" }}>Medical ERP</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-4 space-y-0.5">
          {navItems.map((item) => (
            <div key={item.label}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer text-xs transition-all"
              style={item.active ? {
                background: "rgba(34,211,238,0.08)",
                border: "1px solid rgba(34,211,238,0.2)",
                color: "#22d3ee",
                fontWeight: 600,
                boxShadow: "0 0 12px rgba(34,211,238,0.05)"
              } : {
                color: "rgba(255,255,255,0.35)",
              }}
            >
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-black text-xs font-bold flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)" }}>A</div>
            <div className="min-w-0">
              <div className="text-white text-xs font-semibold truncate">Dr. Abinash</div>
              <div className="text-xs font-medium" style={{ color: "#22d3ee", fontSize: 10 }}>Super Admin</div>
            </div>
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
              style={{ boxShadow: "0 0 6px #34d399" }} />
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-14 flex items-center justify-between px-6 flex-shrink-0 border-b"
          style={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.06)" }}>
          <div>
            <div className="font-bold text-base text-white">Dashboard</div>
            <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>Sat, 10 May 2026 · 10:45 AM</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5"
              style={{
                background: "rgba(52,211,153,0.1)",
                border: "1px solid rgba(52,211,153,0.25)",
                color: "#34d399",
                boxShadow: "0 0 8px rgba(52,211,153,0.05)"
              }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                style={{ boxShadow: "0 0 4px #34d399" }} />
              Clinic Live
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ background: "#050810" }}>

          {/* Stat Cards */}
          <div className="grid grid-cols-4 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl p-4 relative overflow-hidden"
                style={{
                  background: s.glow,
                  border: `1px solid ${s.color}30`,
                  boxShadow: `0 0 20px ${s.glow}`
                }}>
                <div className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>{s.label}</div>
                <div className="text-2xl font-extrabold text-white mb-0.5">{s.value}</div>
                <div className="text-xs font-semibold px-1.5 py-0.5 rounded-md inline-block"
                  style={{ color: s.color, background: `${s.color}18` }}>{s.delta}</div>
                <div className="absolute bottom-0 right-0 w-16 h-16 rounded-tl-full opacity-10"
                  style={{ background: s.color }} />
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 rounded-2xl p-5 border"
              style={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-semibold text-sm">Revenue Trend</div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Last 7 days</div>
                </div>
                <div className="text-xs font-bold" style={{ color: "#22d3ee" }}>₹3.2L this week ↑</div>
              </div>
              <div className="flex items-end gap-2 h-24">
                {[60, 85, 45, 90, 70, 55, 95].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-t-md" style={{
                      height: `${h}%`,
                      background: i === 6
                        ? "linear-gradient(180deg, #22d3ee, #818cf8)"
                        : "rgba(34,211,238,0.12)",
                      boxShadow: i === 6 ? "0 0 12px rgba(34,211,238,0.4)" : undefined
                    }} />
                    <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-5 border"
              style={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="text-white font-semibold text-sm mb-1">Dept. Mix</div>
              <div className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.35)" }}>Today</div>
              {[
                { label: "Pathology", pct: 48, color: "#a78bfa" },
                { label: "Radiology", pct: 28, color: "#22d3ee" },
                { label: "Cardiology", pct: 14, color: "#34d399" },
                { label: "Others", pct: 10, color: "#fbbf24" },
              ].map((row) => (
                <div key={row.label} className="mb-3">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>{row.label}</span>
                    <span className="font-semibold" style={{ color: row.color }}>{row.pct}%</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${row.pct}%`,
                      background: row.color,
                      boxShadow: `0 0 6px ${row.color}80`
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Bills */}
          <div className="rounded-2xl overflow-hidden border" style={{ background: "#080d1a", borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="text-white font-semibold text-sm">Recent Bills</div>
              <div className="text-xs font-medium cursor-pointer" style={{ color: "#22d3ee" }}>View all →</div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.02)" }}>
                  {["Patient", "Tests", "Amount", "Status", "Time"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]"
                      style={{ color: "rgba(255,255,255,0.3)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentBills.map((b) => (
                  <tr key={b.name} className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                    <td className="px-5 py-3 text-white font-semibold">{b.name}</td>
                    <td className="px-5 py-3" style={{ color: "rgba(255,255,255,0.45)" }}>{b.tests}</td>
                    <td className="px-5 py-3 text-white font-bold">{b.amount}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{
                        background: b.status === "Paid" ? "rgba(52,211,153,0.12)" : b.status === "Pending" ? "rgba(251,191,36,0.12)" : "rgba(34,211,238,0.12)",
                        color: b.status === "Paid" ? "#34d399" : b.status === "Pending" ? "#fbbf24" : "#22d3ee",
                        border: `1px solid ${b.status === "Paid" ? "rgba(52,211,153,0.25)" : b.status === "Pending" ? "rgba(251,191,36,0.25)" : "rgba(34,211,238,0.25)"}`,
                        boxShadow: `0 0 6px ${b.status === "Paid" ? "rgba(52,211,153,0.1)" : b.status === "Pending" ? "rgba(251,191,36,0.1)" : "rgba(34,211,238,0.1)"}`
                      }}>{b.status}</span>
                    </td>
                    <td className="px-5 py-3" style={{ color: "rgba(255,255,255,0.3)" }}>{b.time}</td>
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
