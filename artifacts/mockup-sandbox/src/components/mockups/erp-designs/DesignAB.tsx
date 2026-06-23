export function DesignAB() {
  const stats = [
    { label: "Today's Revenue", value: "₹48,250", sub: "+12% vs yesterday", icon: "💰", color: "#7c3aed", light: "#f5f3ff", border: "#ddd6fe" },
    { label: "Patients Today", value: "34", sub: "6 pending · 28 done", icon: "🧑‍⚕️", color: "#0891b2", light: "#ecfeff", border: "#a5f3fc" },
    { label: "Tests Ordered", value: "127", sub: "Across 34 visits", icon: "🧪", color: "#059669", light: "#ecfdf5", border: "#6ee7b7" },
    { label: "Pending Reports", value: "11", sub: "3 overdue", icon: "📋", color: "#dc2626", light: "#fef2f2", border: "#fca5a5" },
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
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: "'Inter', sans-serif", background: "#f1f5f9" }}>

      {/* ── Sidebar: Between A & B — rich navy-indigo, not near-black ── */}
      <div className="w-56 flex-shrink-0 flex flex-col relative overflow-hidden" style={{
        background: "linear-gradient(160deg, #1e3a8a 0%, #1e2462 100%)",
      }}>
        {/* Soft top glow — blue rather than deep purple */}
        <div className="absolute top-0 left-0 w-full h-48 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 50% 0%, rgba(99,179,237,0.2) 0%, transparent 70%)"
        }} />
        {/* Subtle bottom violet hint */}
        <div className="absolute bottom-0 left-0 w-full h-32 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 30% 100%, rgba(124,58,237,0.12) 0%, transparent 70%)"
        }} />

        {/* Logo */}
        <div className="px-5 py-4 flex items-center gap-3 border-b relative z-10" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{
            background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            boxShadow: "0 4px 14px rgba(59,130,246,0.45)"
          }}>D</div>
          <div>
            <div className="text-white font-bold text-sm tracking-tight">Care Diagnostics</div>
            <div className="text-[10px] font-medium" style={{ color: "#93c5fd" }}>Medical ERP</div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 relative z-10">
          {navItems.map((item) => (
            <div key={item.label}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[13px] transition-all"
              style={item.active ? {
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#ffffff",
                fontWeight: 600,
              } : {
                color: "rgba(255,255,255,0.5)",
                border: "1px solid transparent",
              }}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span>{item.label}</span>
              {item.active && (
                <div className="ml-auto w-1.5 h-4 rounded-full" style={{ background: "#93c5fd", boxShadow: "0 0 6px rgba(147,197,253,0.7)" }} />
              )}
            </div>
          ))}
        </nav>

        {/* User row */}
        <div className="px-4 py-4 border-t relative z-10" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: "0 0 10px rgba(59,130,246,0.35)"
            }}>A</div>
            <div className="min-w-0">
              <div className="text-white text-xs font-semibold truncate">Dr. Abinash Kumar</div>
              <div className="text-[10px]" style={{ color: "#93c5fd" }}>Super Admin</div>
            </div>
            <div className="ml-auto w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.7)" }} />
          </div>
        </div>
      </div>

      {/* ── Main: Direction B clean white ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="h-14 bg-white border-b border-slate-100 flex items-center justify-between px-6 flex-shrink-0" style={{
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
        }}>
          <div>
            <div className="text-slate-900 font-bold text-base">Good morning, Dr. Abinash 👋</div>
            <div className="text-slate-400 text-xs">Saturday, 10 May 2026 · 10:45 AM</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border" style={{
              background: "#f0fdf4", borderColor: "#bbf7d0", color: "#15803d"
            }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Clinic Open
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{
              background: "linear-gradient(135deg, #7c3aed, #4f46e5)"
            }}>A</div>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5" style={{ background: "#f8fafc" }}>

          {/* Stat cards — B layout with A accent colors */}
          <div className="grid grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 border relative overflow-hidden" style={{
                borderColor: s.border,
                boxShadow: `0 2px 8px ${s.color}18, 0 0 0 1px ${s.border}60`
              }}>
                {/* Subtle color wash top-right */}
                <div className="absolute top-0 right-0 w-24 h-16 pointer-events-none rounded-bl-3xl" style={{
                  background: `linear-gradient(225deg, ${s.light}, transparent)`
                }} />
                <div className="flex items-start justify-between mb-3 relative">
                  <span className="text-xl">{s.icon}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                    background: s.light, color: s.color
                  }}>↑ 12%</span>
                </div>
                <div className="text-[26px] font-extrabold leading-none mb-1 relative" style={{ color: "#0f172a" }}>{s.value}</div>
                <div className="text-xs font-semibold mb-0.5" style={{ color: "#334155" }}>{s.label}</div>
                <div className="text-[10px]" style={{ color: "#94a3b8" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-4">
            {/* Revenue bar chart */}
            <div className="col-span-2 bg-white rounded-2xl p-5 border border-slate-100" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-slate-800 font-bold text-sm">Revenue Trend</div>
                  <div className="text-slate-400 text-xs mt-0.5">Last 7 days</div>
                </div>
                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-0.5">
                  {["Day","Week","Month"].map((t, i) => (
                    <button key={t} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors" style={
                      i === 1 ? { background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "white" }
                               : { color: "#94a3b8" }
                    }>{t}</button>
                  ))}
                </div>
              </div>
              {/* Bars */}
              <div className="flex items-end gap-2 h-28">
                {[60, 85, 45, 90, 70, 55, 95].map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full rounded-t-lg" style={{
                      height: `${h}%`,
                      background: i === 6
                        ? "linear-gradient(180deg, #7c3aed, #4f46e5)"
                        : "#ede9fe",
                      boxShadow: i === 6 ? "0 4px 12px rgba(124,58,237,0.35)" : undefined
                    }} />
                    <div className="text-[9px] font-medium" style={{ color: i === 6 ? "#7c3aed" : "#cbd5e1" }}>
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-400">
                <span>Avg: <strong className="text-slate-700">₹6,892/day</strong></span>
                <span>Peak: <strong className="text-violet-600">₹48,250 today</strong></span>
              </div>
            </div>

            {/* Dept mix + Quick actions */}
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-2xl p-4 border border-slate-100 flex-1" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                <div className="text-slate-800 font-bold text-sm mb-3">Department Mix</div>
                {[
                  { label: "Pathology", pct: 48, color: "#7c3aed" },
                  { label: "Radiology", pct: 28, color: "#0891b2" },
                  { label: "Cardiology", pct: 14, color: "#059669" },
                  { label: "Others", pct: 10, color: "#f59e0b" },
                ].map((row) => (
                  <div key={row.label} className="mb-2.5">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">{row.label}</span>
                      <span className="font-bold" style={{ color: row.color }}>{row.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${row.pct}%`, background: row.color,
                        boxShadow: `0 0 6px ${row.color}60`
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Bills table — Direction B clean style */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div className="text-slate-800 font-bold text-sm">Recent Bills</div>
              <button className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all" style={{
                color: "#7c3aed", borderColor: "#ddd6fe", background: "#faf5ff"
              }}>View all →</button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-50" style={{ background: "#f8fafc" }}>
                  {["Patient", "Tests", "Amount", "Status", "Time"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]" style={{ color: "#94a3b8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentBills.map((b, idx) => (
                  <tr key={b.name} className="border-b border-slate-50 transition-colors"
                    style={{ background: idx % 2 === 0 ? "white" : "#fafbfc" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#faf5ff")}
                    onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? "white" : "#fafbfc")}
                  >
                    <td className="px-5 py-3 font-semibold" style={{ color: "#0f172a" }}>{b.name}</td>
                    <td className="px-5 py-3" style={{ color: "#64748b" }}>{b.tests}</td>
                    <td className="px-5 py-3 font-bold" style={{ color: "#1e293b" }}>{b.amount}</td>
                    <td className="px-5 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold" style={{
                        background: b.status === "Paid" ? "#f0fdf4" : b.status === "Pending" ? "#fffbeb" : "#eff6ff",
                        color: b.status === "Paid" ? "#15803d" : b.status === "Pending" ? "#b45309" : "#1d4ed8",
                        border: `1px solid ${b.status === "Paid" ? "#bbf7d0" : b.status === "Pending" ? "#fde68a" : "#bfdbfe"}`
                      }}>{b.status}</span>
                    </td>
                    <td className="px-5 py-3" style={{ color: "#94a3b8" }}>{b.time}</td>
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
