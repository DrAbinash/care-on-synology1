const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const state = {
  me: null,
  locked: true,
  session: null,
  syncedAt: null,
  ageBand: "never",
  neverSynced: true,
  patient: null,
  lines: [],
  referringDoctor: null,
  reasons: [],
  bills: [],
  careStatus: { state: "unknown", label: "Checking…", lastCheckedAt: null },
  ops: null,
  toast: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function fmt(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
function todayLabel() {
  return new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}
function syncedLabel() {
  if (!state.syncedAt || state.neverSynced || state.ageBand === "never") {
    return "Never synced with Main CARE — use Sync From Main CARE when online";
  }
  const when = new Date(state.syncedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  if (state.ageBand === "stale") return `Last synced with CARE: ${when} — STALE (>24h)`;
  if (state.ageBand === "warning") return `Last synced with CARE: ${when} — aging (>6h)`;
  return `Last synced with CARE: ${when}`;
}
function syncChipClass() {
  if (!state.syncedAt || state.ageBand === "never") return "bad";
  if (state.ageBand === "stale") return "bad";
  if (state.ageBand === "warning") return "warn";
  return "ok";
}
function carePillClass() {
  if (state.careStatus.state === "online") return "online";
  if (state.careStatus.state === "offline") return "offline";
  return "unknown";
}
function toast(msg, kind = "ok") {
  state.toast = { msg, kind, at: Date.now() };
  render();
  setTimeout(() => {
    if (state.toast && Date.now() - state.toast.at >= 2800) {
      state.toast = null;
      render();
    }
  }, 3000);
}

function render() {
  if (!state.me) return renderLogin();
  renderMain();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="emg-banner" style="margin:-24px -24px 16px;border-radius:14px 14px 0 0">EMERGENCY MODE</div>
        <h1>CARE Billing Desk</h1>
        <p class="muted">Emergency capture on this PC. Main CARE remains the source of truth.</p>
        <div class="chip ${state.locked ? "bad" : "ok"}" style="display:inline-flex;margin:8px 0;padding:4px 10px;border-radius:999px;border:1px solid #e2e8f0;font-size:12px;font-weight:700">
          ${state.locked ? "Emergency billing LOCKED" : "Emergency session ACTIVE"}
        </div>
        <p class="muted">${syncedLabel()}</p>
        <form id="login">
          <label>Username</label>
          <input name="username" autocomplete="username" required />
          <label>PIN</label>
          <input name="pin" type="password" autocomplete="current-password" required />
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Login</button></div>
          <p id="err" class="muted" style="color:#b91c1c"></p>
        </form>
      </div>
    </div>`;
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/login", { method: "POST", body: { username: fd.get("username"), pin: fd.get("pin") } });
      await boot();
    } catch (err) { $("#err").textContent = err.message; }
  };
}

function renderMain() {
  const admin = state.me.role === "admin" || state.me.role === "super_admin";
  const pending = state.ops?.pendingTransactionCount ?? state.bills.filter((b) => b.status === "PENDING").length;
  const failed = state.ops?.failedTransactionCount ?? 0;
  const conflicts = state.ops?.conflictTransactionCount ?? 0;

  app.innerHTML = `
    <div class="desk" data-desk="modern">
      <div class="emg-banner">
        EMERGENCY MODE — PRIMARY CARE ERP OFFLINE
        <span>${state.careStatus.state === "online" ? "(Main CARE reachable — still emergency capture)" : "(Use this desk until Main CARE is restored)"}</span>
      </div>

      <div class="topbar">
        <span class="date">${todayLabel()}</span>
        <span class="title">Billing Desk</span>
        <span class="next">Emergency capture · EMG-* bills</span>
        <div class="spacer"></div>
        <span class="pill ${carePillClass()}" title="Main CARE reachability">
          MAIN CARE · ${escapeHtml(String(state.careStatus.label || state.careStatus.state).toUpperCase())}
        </span>
        <span class="pill">${escapeHtml(state.me.name)} · ${escapeHtml(state.me.role)}</span>
        ${admin && state.locked ? `<button class="topbar-btn primary" id="start">START SESSION</button>` : ""}
        ${admin && !state.locked ? `<button class="topbar-btn" id="end">END SESSION</button>` : ""}
        <button class="topbar-btn" id="newbill">New</button>
        <button class="topbar-btn" id="logout">Logout</button>
      </div>

      <div class="status-strip">
        <span class="chip ${syncChipClass()}"><span class="dot"></span>${syncedLabel()}</span>
        <span class="chip ${state.careStatus.state === "online" ? "ok" : state.careStatus.state === "offline" ? "bad" : "warn"}">
          <span class="dot"></span>Main CARE: ${escapeHtml(state.careStatus.label || state.careStatus.state)}
        </span>
        <span class="chip">Pending: <b>${pending}</b></span>
        ${failed ? `<span class="chip bad">Failed: <b>${failed}</b></span>` : ""}
        ${conflicts ? `<span class="chip bad">Conflicts: <b>${conflicts}</b></span>` : ""}
      </div>

      <div class="lock-banner ${state.locked ? "locked" : "active"}">
        ${state.locked
          ? "EMERGENCY BILLING LOCKED — owner/admin must START SESSION before reception can bill"
          : "SESSION ACTIVE — reception may bill on this emergency desk"}
      </div>

      ${state.locked
        ? `<div class="locked-card">Ask the owner/admin to start an emergency session. Reception cannot unlock this screen.</div>`
        : deskLayout()}

      ${admin ? opsPanel() : ""}

      <div class="card" style="margin:10px">
        <div class="sec-h slate">Today's emergency bills</div>
        <div class="sec-body" id="bills"></div>
      </div>

      ${state.toast ? `<div class="toast ${state.toast.kind}">${escapeHtml(state.toast.msg)}</div>` : ""}
    </div>`;

  $("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); state.me = null; render(); };
  if ($("#start")) $("#start").onclick = startSession;
  if ($("#end")) $("#end").onclick = endSession;
  if ($("#newbill")) $("#newbill").onclick = () => {
    state.patient = null;
    state.lines = [];
    state.referringDoctor = null;
    render();
  };
  if (!state.locked) bindBillForm();
  bindOps();
  renderBills();
}

function deskLayout() {
  const p = state.patient;
  return `
    <div class="desk-body">
      <div class="col-left">
        <div class="card">
          <div class="sec-h sky">Patient</div>
          <div class="sec-body">
            ${p ? `
              <div class="patient-selected">
                <div>
                  <div class="name">${escapeHtml(p.first_name || p.firstName || "")} ${escapeHtml(p.last_name || p.lastName || "")}</div>
                  <div class="meta">${escapeHtml(p.patient_id || p.uhid || "New")} · ${escapeHtml(p.phone || p.mobile || "")}</div>
                </div>
                <button type="button" class="clear" id="clear-patient" title="Clear">×</button>
              </div>` : `
              <div class="search-wrap">
                <span class="search-ico">⌕</span>
                <input class="input" id="pq" placeholder="Search patient (name / UHID / mobile)…" autocomplete="off" />
                <div id="psug" class="suggest hidden"></div>
              </div>
              <div class="grid-2" style="margin-top:10px">
                <div><label class="field-label">First name</label><input class="input" id="fn" /></div>
                <div><label class="field-label">Last name</label><input class="input" id="ln" /></div>
                <div><label class="field-label">Mobile</label><input class="input" id="mob" /></div>
                <div><label class="field-label">Sex</label>
                  <select class="select" id="sex"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select>
                </div>
                <div><label class="field-label">Age</label><input class="input" id="age" type="number" min="0" /></div>
                <div><label class="field-label">UHID</label><input class="input" id="uhid" readonly placeholder="Auto / from CARE cache" /></div>
              </div>`}
          </div>
        </div>

        <div class="card">
          <div class="sec-h violet">Referring Doctor</div>
          <div class="sec-body">
            ${state.referringDoctor ? `
              <div class="doc-picked">
                <span>${escapeHtml(state.referringDoctor.name)}${state.referringDoctor.specialization ? " · " + escapeHtml(state.referringDoctor.specialization) : ""}</span>
                <button type="button" class="clear" id="clear-doc">×</button>
              </div>` : ""}
            <div class="search-wrap">
              <span class="search-ico">⌕</span>
              <input class="input" id="dq" placeholder="Search doctor or leave blank for Walk-in…" autocomplete="off"
                value="${state.referringDoctor ? escapeHtml(state.referringDoctor.name) : ""}" />
              <div id="dsug" class="suggest hidden"></div>
            </div>
            <p class="muted" style="margin:8px 0 0">${state.referringDoctor ? "Selected above" : "Walk-in / none"}</p>
          </div>
        </div>

        <div class="card">
          <div class="sec-h teal">Investigations</div>
          <div class="sec-body">
            <div class="search-wrap">
              <span class="search-ico">⌕</span>
              <input class="input" id="sq" placeholder="Search investigations (MRI, CBC…)" autocomplete="off" />
              <div id="ssug" class="suggest hidden"></div>
            </div>
            <p class="muted" style="margin:8px 0 0">Selected tests appear on the right — same as CARE Billing Desk.</p>
          </div>
        </div>
      </div>

      <div class="col-right">
        <div class="card">
          <div class="sec-h amber">Selected Tests</div>
          <div class="sec-body" id="lines"></div>
        </div>

        <div class="card">
          <div class="sec-h emerald">Bill Summary</div>
          <div class="sec-body">
            <div class="sum-row"><span>Gross</span><span class="val tabular" id="gross">₹0</span></div>
            <div class="sum-row">
              <span>Discount</span>
              <input class="input" id="disc" type="number" min="0" value="0" style="width:110px;height:30px;text-align:right" />
            </div>
            <div style="margin:6px 0">
              <label class="field-label">Discount reason</label>
              <select class="select" id="dreason"><option value="">—</option>${state.reasons.map((r) => `<option>${escapeHtml(r)}</option>`).join("")}</select>
            </div>
            <div style="margin:6px 0">
              <label class="field-label">Notes</label>
              <input class="input" id="notes" placeholder="Optional notes…" />
            </div>
            <div class="sum-net"><span class="lbl">Net Total</span><span class="val tabular" id="net">₹0</span></div>
            <div class="sum-row" style="margin-top:4px"><span>Due</span><span class="val tabular" id="due">₹0</span></div>
          </div>
        </div>

        <div class="card">
          <div class="sec-h indigo">Payment</div>
          <div class="sec-body">
            <div class="pay-grid">
              <div><label class="field-label">Cash</label><input class="input" id="cash" type="number" min="0" value="0" /></div>
              <div><label class="field-label">UPI</label><input class="input" id="upi" type="number" min="0" value="0" /></div>
              <div><label class="field-label">Card</label><input class="input" id="card" type="number" min="0" value="0" /></div>
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" id="save">Save &amp; Print Receipt</button>
            </div>
            <p id="berr" class="muted" style="color:#b91c1c;margin-top:8px"></p>
          </div>
        </div>
      </div>
    </div>`;
}

function opsPanel() {
  return `
    <div class="card" style="margin:10px">
      <div class="sec-h slate">Emergency System Status</div>
      <div class="sec-body">
        <div class="ops-grid">
          <div class="ops-stat"><div class="k">Main CARE</div><div class="v">${escapeHtml(state.careStatus.label || state.careStatus.state)}</div></div>
          <div class="ops-stat"><div class="k">Emergency DB</div><div class="v">${state.ops?.databaseHealthy === false ? "Failed" : "Healthy"}</div></div>
          <div class="ops-stat"><div class="k">Pending</div><div class="v">${state.ops?.pendingTransactionCount ?? "—"}</div></div>
          <div class="ops-stat"><div class="k">Failed / Conflict</div><div class="v">${(state.ops?.failedTransactionCount ?? 0) + (state.ops?.conflictTransactionCount ?? 0)}</div></div>
        </div>
        <div class="ops-actions">
          <button class="btn btn-amber" id="sync-from-main">Sync From Main CARE</button>
          <button class="btn btn-primary" id="push-to-main" style="width:auto">Push Emergency Data</button>
          <button class="btn btn-secondary" id="retry-failed">Retry Failed</button>
          <button class="btn btn-secondary" id="csv">Export CSV</button>
          <button class="btn btn-secondary" id="json">Export JSON</button>
          <button class="btn btn-secondary" id="usb">USB package</button>
          <button class="btn btn-secondary" id="backup-dl">Download Backup</button>
        </div>
        <p id="ops-msg" class="muted" style="margin-top:8px"></p>
      </div>
    </div>`;
}

function bindOps() {
  const msg = (t, ok = true) => {
    const el = $("#ops-msg");
    if (el) { el.style.color = ok ? "#065f46" : "#b91c1c"; el.textContent = t; }
    toast(t, ok ? "ok" : "err");
  };
  if ($("#sync-from-main")) $("#sync-from-main").onclick = async () => {
    try {
      const r = await api("/api/care/sync-master", { method: "POST" });
      await boot();
      msg(`Synced from Main CARE — ${r.serviceCount ?? "?"} services, ${r.doctorCount ?? "?"} doctors`);
    } catch (err) { msg(err.message, false); }
  };
  if ($("#push-to-main")) $("#push-to-main").onclick = async () => {
    try {
      const r = await api("/api/care/push-transactions", { method: "POST" });
      await refreshBills();
      await refreshOps();
      render();
      msg(`Pushed to Main CARE — created ${r.created ?? 0}, already ${r.alreadyReconciled ?? r.duplicates ?? 0}, failed ${r.failures ?? 0}`);
    } catch (err) { msg(err.message, false); }
  };
  if ($("#retry-failed")) $("#retry-failed").onclick = async () => {
    try {
      const r = await api("/api/care/retry-failed", { method: "POST" });
      await refreshBills();
      await refreshOps();
      render();
      msg(`Retry complete — created ${r.created ?? 0}, failed ${r.failures ?? 0}`);
    } catch (err) { msg(err.message, false); }
  };
  if ($("#csv")) $("#csv").onclick = () => download("/api/export/csv", "emergency.csv");
  if ($("#json")) $("#json").onclick = () => download("/api/export/json", "emergency.json");
  if ($("#usb")) $("#usb").onclick = exportUsb;
  if ($("#backup-dl")) $("#backup-dl").onclick = () => download("/api/export/backup.sql", `care_emergency_backup_${Date.now()}.sql`);
}

function bindBillForm() {
  if ($("#clear-patient")) $("#clear-patient").onclick = () => { state.patient = null; render(); };
  if ($("#clear-doc")) $("#clear-doc").onclick = () => { state.referringDoctor = null; render(); };

  if ($("#pq")) $("#pq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) { $("#psug").classList.add("hidden"); return; }
    const rows = await api("/api/patients?q=" + encodeURIComponent(q));
    const box = $("#psug");
    box.classList.remove("hidden");
    box.innerHTML = rows.length
      ? rows.map((p) => `<button type="button" data-id="${p.id}"><strong>${escapeHtml(p.patient_id)}</strong> — ${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} <span class="muted">${escapeHtml(p.phone)}</span></button>`).join("")
      : `<div class="empty">No local match — register below</div>`;
    box.querySelectorAll("button[data-id]").forEach((el) => {
      el.onclick = () => {
        const p = rows.find((x) => String(x.id) === el.dataset.id);
        state.patient = p;
        render();
      };
    });
  });

  if ($("#dq")) $("#dq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (state.referringDoctor && q !== state.referringDoctor.name) state.referringDoctor = null;
    const box = $("#dsug");
    if (q.length < 1) { box.classList.add("hidden"); return; }
    const rows = await api("/api/doctors?q=" + encodeURIComponent(q));
    box.classList.remove("hidden");
    box.innerHTML = `<button type="button" data-id="">Walk-in / none</button>` + rows.map((d) =>
      `<button type="button" data-id="${d.id}">${escapeHtml(d.name)}${d.specialization ? `<span class="muted" style="margin-left:auto">${escapeHtml(d.specialization)}</span>` : ""}</button>`
    ).join("");
    box.querySelectorAll("button[data-id]").forEach((el) => {
      el.onclick = () => {
        if (!el.dataset.id) {
          state.referringDoctor = null;
        } else {
          const d = rows.find((x) => String(x.id) === el.dataset.id);
          state.referringDoctor = d ? { id: d.id, name: d.name, specialization: d.specialization || "" } : null;
        }
        render();
      };
    });
  });

  if ($("#sq")) $("#sq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 1) { $("#ssug").classList.add("hidden"); return; }
    const rows = await api("/api/services?q=" + encodeURIComponent(q));
    const box = $("#ssug");
    box.classList.remove("hidden");
    box.innerHTML = rows.map((s) =>
      `<button type="button" data-id="${s.id}"><span>${escapeHtml(s.category)} · ${escapeHtml(s.name)}</span><strong class="tabular" style="margin-left:auto">${fmt(s.price)}</strong></button>`
    ).join("") || `<div class="empty">No services</div>`;
    box.querySelectorAll("button[data-id]").forEach((el) => {
      el.onclick = () => {
        const s = rows.find((x) => String(x.id) === el.dataset.id);
        state.lines.push({ careServiceId: s.id, serviceName: s.name, category: s.category, quantity: 1, unitPrice: Number(s.price) });
        $("#sq").value = "";
        box.classList.add("hidden");
        renderLines();
      };
    });
  });

  if ($("#disc")) $("#disc").oninput = updateTotals;
  if ($("#cash")) $("#cash").oninput = updateTotals;
  if ($("#upi")) $("#upi").oninput = updateTotals;
  if ($("#card")) $("#card").oninput = updateTotals;
  if ($("#save")) $("#save").onclick = saveBill;

  // Prefill patient fields when selected card is showing register form path
  if (state.patient && $("#fn")) {
    $("#fn").value = state.patient.first_name || "";
    $("#ln").value = state.patient.last_name || "";
    $("#mob").value = state.patient.phone || "";
    $("#uhid").value = state.patient.patient_id || "";
    $("#age").value = state.patient.age_value || "";
    $("#sex").value = String(state.patient.gender || "").toLowerCase().startsWith("f") ? "F"
      : String(state.patient.gender || "").toLowerCase().startsWith("m") ? "M" : "O";
  }
  renderLines();
}

function renderLines() {
  const el = $("#lines");
  if (!el) return;
  if (!state.lines.length) {
    el.innerHTML = `<p class="muted">No investigations selected yet.</p>`;
    updateTotals();
    return;
  }
  el.innerHTML = state.lines.map((l, i) => `
    <div class="line-row">
      <div class="nm">${escapeHtml(l.serviceName)}</div>
      <input class="qty" data-i="${i}" type="number" min="1" value="${l.quantity}" />
      <div class="amt tabular">${fmt(l.unitPrice * l.quantity)}</div>
      <button type="button" class="rm" data-i="${i}">×</button>
    </div>`).join("");
  el.querySelectorAll(".qty").forEach((inp) => {
    inp.oninput = () => { state.lines[Number(inp.dataset.i)].quantity = Number(inp.value || 1); renderLines(); };
  });
  el.querySelectorAll(".rm").forEach((b) => {
    b.onclick = () => { state.lines.splice(Number(b.dataset.i), 1); renderLines(); };
  });
  updateTotals();
}

function updateTotals() {
  const gross = state.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const disc = Number($("#disc")?.value || 0);
  const net = Math.max(0, gross - disc);
  const rec = Number($("#cash")?.value || 0) + Number($("#upi")?.value || 0) + Number($("#card")?.value || 0);
  if ($("#gross")) $("#gross").textContent = fmt(gross);
  if ($("#net")) $("#net").textContent = fmt(net);
  if ($("#due")) $("#due").textContent = fmt(Math.max(0, net - rec));
}

async function saveBill() {
  if ($("#berr")) $("#berr").textContent = "";
  try {
    const doc = state.referringDoctor;
    const selected = state.patient;
    const txn = await api("/api/bills", {
      method: "POST",
      body: {
        patient: {
          carePatientId: selected?.id || null,
          uhid: selected?.patient_id || $("#uhid")?.value || null,
          firstName: selected?.first_name || $("#fn")?.value,
          lastName: selected?.last_name || $("#ln")?.value,
          mobile: selected?.phone || $("#mob")?.value,
          sex: selected
            ? (String(selected.gender || "").toLowerCase().startsWith("f") ? "F"
              : String(selected.gender || "").toLowerCase().startsWith("m") ? "M" : "O")
            : $("#sex")?.value,
          ageValue: selected?.age_value != null ? Number(selected.age_value)
            : ($("#age")?.value ? Number($("#age").value) : null),
          ageUnit: selected?.age_unit || "years",
        },
        referringDoctorId: doc?.id || null,
        referringDoctorName: doc?.name || null,
        lines: state.lines.map((l) => ({ careServiceId: l.careServiceId, quantity: l.quantity })),
        discountAmount: Number($("#disc")?.value || 0),
        discountReason: $("#dreason")?.value || null,
        notes: $("#notes")?.value || null,
        payments: [
          { method: "cash", amount: Number($("#cash")?.value || 0) },
          { method: "upi", amount: Number($("#upi")?.value || 0) },
          { method: "card", amount: Number($("#card")?.value || 0) },
        ],
      },
    });
    state.lines = [];
    state.patient = null;
    state.referringDoctor = null;
    await refreshBills();
    await refreshOps();
    render();
    toast(`Bill ${txn.emergencyBillNumber} saved`);
    await printReceipt(txn);
  } catch (err) {
    if ($("#berr")) $("#berr").textContent = err.message;
  }
}

function patientDisplayName(p) {
  return [p?.firstName, p?.lastName]
    .map((x) => String(x || "").trim())
    .filter((x) => x && x !== "-")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function sexShort(sex) {
  const v = String(sex || "").trim().toUpperCase();
  if (!v) return "";
  if (v === "M" || v.startsWith("MALE")) return "M";
  if (v === "F" || v.startsWith("FEMALE")) return "F";
  return "O";
}
function ageUnitShort(unit) {
  const s = String(unit || "years").toLowerCase();
  if (s.startsWith("month")) return "M";
  if (s.startsWith("day")) return "D";
  if (s.startsWith("week")) return "W";
  return "Y";
}
function ageSexLine(p) {
  const ageNum = p?.ageValue;
  const hasAge = ageNum != null && ageNum !== "" && !Number.isNaN(Number(ageNum));
  const age = hasAge ? `${Number(ageNum)}${ageUnitShort(p.ageUnit)}` : "";
  const sex = sexShort(p?.sex);
  if (age && sex) return `${age} / ${sex}`;
  return age || sex || "—";
}
function istStamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function receiptHtml(t) {
  const p = t.patient || {};
  const name = patientDisplayName(p);
  const doctor = String(t.referringDoctorName || "").trim();
  const lines = Array.isArray(t.lines) ? t.lines : [];
  const pays = (Array.isArray(t.payments) ? t.payments : []).filter((x) => Number(x.amount) > 0);
  const voided = String(t.status || "").toUpperCase() === "VOID";
  return `
    <div class="rcpt">
      <div class="rcpt-head">
        <img class="rcpt-logo" src="/logo.png" alt="" />
        <div>
          <div class="rcpt-title">Emergency Receipt</div>
          <div class="rcpt-sub">Not a final CARE bill — Billing Desk emergency capture</div>
        </div>
      </div>
      ${voided ? `<div class="rcpt-void">VOID${t.voidReason ? " — " + escapeHtml(t.voidReason) : ""}</div>` : ""}
      <div class="rcpt-meta">
        <div><b>Bill No.</b> ${escapeHtml(t.emergencyBillNumber)}</div>
        <div><b>Date</b> ${escapeHtml(istStamp(t.createdAt))}</div>
      </div>
      <div class="rcpt-patient">
        <div class="rcpt-pat-left">
          <div class="rcpt-pat-row">
            <span class="rcpt-name">${escapeHtml(name || "—")}</span>
            <span class="rcpt-agesex">${escapeHtml(ageSexLine(p))}</span>
          </div>
          <div class="rcpt-pat-row rcpt-ref"><b>Ref. Doctor</b> ${escapeHtml(doctor || "Walk-in")}</div>
        </div>
        <div class="rcpt-pat-right">
          <div class="rcpt-pat-row"><b>UHID</b> ${escapeHtml(p.uhid || "—")}</div>
          <div class="rcpt-pat-row"><b>Mobile</b> ${escapeHtml(p.mobile || "—")}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Service</th><th class="qty">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${lines.map((l) => `<tr>
            <td>${escapeHtml(l.serviceName)}</td>
            <td class="qty">${escapeHtml(l.quantity)}</td>
            <td class="num">${fmt(l.unitPrice)}</td>
            <td class="num">${fmt(l.lineGross)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="rcpt-sum">
        <div class="rcpt-sum-row"><span>Gross</span><span>${fmt(t.grossAmount)}</span></div>
        <div class="rcpt-sum-row"><span>Discount${t.discountReason ? " (" + escapeHtml(t.discountReason) + ")" : ""}</span><span>${fmt(t.discountAmount)}</span></div>
        <div class="rcpt-sum-row emph"><span>Net</span><span>${fmt(t.netAmount)}</span></div>
        <div class="rcpt-sum-row"><span>Received</span><span>${fmt(t.amountReceived)}</span></div>
        <div class="rcpt-sum-row emph"><span>Due</span><span>${fmt(t.dueAmount)}</span></div>
      </div>
      <div class="rcpt-pay"><b>Paid by</b> ${pays.length ? pays.map((x) => escapeHtml(String(x.method).toUpperCase()) + " " + fmt(x.amount)).join(" · ") : "—"}</div>
      ${t.notes ? `<div class="rcpt-pay"><b>Notes</b> ${escapeHtml(t.notes)}</div>` : ""}
      <div class="rcpt-foot">
        Staff: ${escapeHtml(t.createdByStaffName || "")}<br />
        This is an emergency receipt. The final CARE bill is issued after reconciliation.
      </div>
    </div>`;
}

async function printReceipt(t) {
  const el = $("#receipt");
  if (!el) return;
  el.innerHTML = receiptHtml(t);
  el.classList.remove("hidden");
  const img = el.querySelector("img.rcpt-logo");
  if (img && !img.complete) {
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      setTimeout(resolve, 400);
    });
  }
  const hide = () => {
    el.classList.add("hidden");
    window.removeEventListener("afterprint", hide);
  };
  window.addEventListener("afterprint", hide);
  window.print();
  api("/api/bills/" + t.emergencyTransactionUuid + "/reprint", { method: "POST" }).catch(() => {});
}

function renderBills() {
  const el = $("#bills");
  if (!el) return;
  if (!state.bills.length) {
    el.innerHTML = `<p class="muted">No emergency bills yet today.</p>`;
    return;
  }
  el.innerHTML = `<table class="bills"><thead><tr><th>No</th><th>Patient</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${state.bills.map((b) => `<tr>
      <td>${escapeHtml(b.emergencyBillNumber)}</td>
      <td>${escapeHtml((b.patient?.firstName || "") + " " + (b.patient?.lastName || ""))}</td>
      <td class="tabular">${fmt(b.netAmount)}</td>
      <td class="tabular">${fmt(b.amountReceived)}</td>
      <td class="tabular">${fmt(b.dueAmount)}</td>
      <td><span class="badge ${escapeHtml(b.syncStatus || b.status)}">${escapeHtml(String(b.syncStatus || b.status).toUpperCase())}</span></td>
      <td>
        ${b.status === "PENDING" ? `<button class="btn btn-danger void" data-u="${b.emergencyTransactionUuid}" style="height:28px;font-size:11px">Void</button>` : ""}
        <button class="btn btn-secondary pr" data-u="${b.emergencyTransactionUuid}" style="height:28px;font-size:11px">Print</button>
      </td>
    </tr>`).join("")}
  </tbody></table>`;
  el.querySelectorAll(".void").forEach((b) => b.onclick = async () => {
    const reason = prompt("Void reason?");
    if (!reason) return;
    await api("/api/bills/" + b.dataset.u + "/void", { method: "POST", body: { reason } });
    await refreshBills();
    render();
  });
  el.querySelectorAll(".pr").forEach((b) => b.onclick = () => {
    const t = state.bills.find((x) => x.emergencyTransactionUuid === b.dataset.u);
    if (t) printReceipt(t);
  });
}

async function startSession() {
  const reason = prompt("Reason for emergency billing?");
  if (!reason) return;
  await api("/api/session/start", { method: "POST", body: { reason, workstation: navigator.userAgent } });
  await boot();
}
async function endSession() {
  if (!confirm("End emergency session? Reception will be locked.")) return;
  await api("/api/session/end", { method: "POST", body: {} });
  await boot();
}
async function download(url, name) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    toast("Download failed", "err");
    return;
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
async function exportUsb() {
  const data = await api("/api/export/usb-package");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "CARE_EMERGENCY_BACKUP_PACKAGE.json";
  a.click();
}
async function refreshBills() {
  try { state.bills = await api("/api/bills"); } catch { state.bills = []; }
}
async function refreshOps() {
  try { state.ops = await api("/api/ops/status"); } catch { /* optional */ }
}
async function refreshCareStatus() {
  try {
    state.careStatus = await api("/api/care/status");
  } catch {
    state.careStatus = { state: "unknown", label: "Unavailable" };
  }
}
async function boot() {
  try {
    const me = await api("/api/me");
    state.me = me.staff;
    state.locked = me.locked;
    state.session = me.session;
    state.syncedAt = me.masterDataLastSyncedAt;
    state.ageBand = me.ageBand || "never";
    state.neverSynced = !!me.neverSynced;
    state.reasons = await api("/api/discount-reasons");
    await refreshBills();
    await refreshOps();
    await refreshCareStatus();
  } catch {
    const st = await api("/api/status");
    state.me = null;
    state.locked = st.locked;
    state.syncedAt = st.masterDataLastSyncedAt;
    state.ageBand = st.ageBand || "never";
    state.neverSynced = !!st.neverSynced;
    await refreshCareStatus();
  }
  render();
}
function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();
setInterval(() => { if (state.me) refreshCareStatus().then(() => {
  // soft refresh top pill without full re-render unless state changed
}).catch(() => {}); }, 30_000);
