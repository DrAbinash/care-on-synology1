const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const state = {
  me: null,
  locked: true,
  session: null,
  syncedAt: null,
  patient: null,
  lines: [],
  doctors: [],
  reasons: [],
  bills: [],
  receipt: null,
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
function syncedLabel() {
  if (!state.syncedAt) return "Tariff/master data last synchronized: never — push from CARE before an outage";
  const d = new Date(state.syncedAt);
  return "Tariff/master data last synchronized: " + d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function render() {
  if (!state.me) return renderLogin();
  renderMain();
}

function renderLogin() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <h1>CARE Emergency Billing</h1>
        <p class="muted">Local DS225+ capture only. CARE on DS1522+ remains the source of truth.</p>
        <div class="banner ${state.locked ? "lock" : "ok"}">${state.locked ? "EMERGENCY BILLING LOCKED" : "Emergency session ACTIVE"}</div>
        <p class="muted">${syncedLabel()}</p>
        <form id="login">
          <label>Username</label>
          <input name="username" autocomplete="username" required />
          <label>PIN</label>
          <input name="pin" type="password" autocomplete="current-password" required />
          <div class="row" style="margin-top:12px"><button type="submit">Login</button></div>
          <p id="err" class="muted"></p>
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
  app.innerHTML = `
    <div class="wrap">
      <div class="row" style="justify-content:space-between">
        <div>
          <h1>CARE Emergency Billing</h1>
          <div class="muted">${state.me.name} · ${state.me.role}</div>
        </div>
        <div class="row">
          ${admin && state.locked ? `<button id="start">START EMERGENCY SESSION</button>` : ""}
          ${admin && !state.locked ? `<button id="end" class="secondary">END EMERGENCY SESSION</button>` : ""}
          ${admin ? `<button id="csv" class="secondary">Export CSV</button><button id="json" class="secondary">Export JSON</button><button id="usb" class="secondary">USB package</button>` : ""}
          <button id="logout" class="secondary">Logout</button>
        </div>
      </div>
      <div class="banner ${state.locked ? "lock" : "ok"}">${state.locked ? "EMERGENCY BILLING LOCKED" : "SESSION ACTIVE — reception may bill"}</div>
      <div class="banner warn">${syncedLabel()}</div>
      ${state.locked ? `<div class="card">Ask the owner/admin to start an emergency session. Reception cannot unlock this screen.</div>` : billForm()}
      <div class="card">
        <h2>Today's emergency bills</h2>
        <div id="bills"></div>
      </div>
      <div id="receipt" class="receipt hidden"></div>
    </div>`;
  $("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); state.me = null; render(); };
  if ($("#start")) $("#start").onclick = startSession;
  if ($("#end")) $("#end").onclick = endSession;
  if ($("#csv")) $("#csv").onclick = () => download("/api/export/csv", "emergency.csv");
  if ($("#json")) $("#json").onclick = () => download("/api/export/json", "emergency.json");
  if ($("#usb")) $("#usb").onclick = exportUsb;
  if (!state.locked) bindBillForm();
  renderBills();
}

function billForm() {
  return `
    <div class="card">
      <h2>New emergency bill</h2>
      <div class="grid">
        <div>
          <label>Search patient (name / UHID / mobile)</label>
          <input id="pq" placeholder="Type at least 2 characters" />
          <div id="psug" class="suggest hidden"></div>
          <div class="grid" style="margin-top:8px">
            <div><label>First name</label><input id="fn" /></div>
            <div><label>Last name</label><input id="ln" /></div>
            <div><label>Mobile</label><input id="mob" /></div>
            <div><label>Sex</label><select id="sex"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
            <div><label>Age</label><input id="age" type="number" min="0" /></div>
            <div><label>UHID</label><input id="uhid" readonly /></div>
          </div>
        </div>
        <div>
          <label>Referring doctor</label>
          <select id="doc"><option value="">Walk-in / none</option>${state.doctors.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select>
          <label>Search service</label>
          <input id="sq" placeholder="MRI, CBC…" />
          <div id="ssug" class="suggest hidden"></div>
          <div id="lines"></div>
        </div>
      </div>
      <div class="tot" style="margin:12px 0">
        <div>Gross <b id="gross">₹0</b></div>
        <div>Discount <input id="disc" type="number" min="0" value="0" /></div>
        <div>Net <b id="net">₹0</b></div>
        <div>Due <b id="due">₹0</b></div>
      </div>
      <div class="grid">
        <div><label>Discount reason</label><select id="dreason"><option value="">—</option>${state.reasons.map(r => `<option>${escapeHtml(r)}</option>`).join("")}</select></div>
        <div><label>Notes</label><input id="notes" /></div>
        <div><label>Cash</label><input id="cash" type="number" min="0" value="0" /></div>
        <div><label>UPI</label><input id="upi" type="number" min="0" value="0" /></div>
        <div><label>Card</label><input id="card" type="number" min="0" value="0" /></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button id="save">Save & print receipt</button>
        <span id="berr" class="muted"></span>
      </div>
    </div>`;
}

function bindBillForm() {
  $("#pq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) { $("#psug").classList.add("hidden"); return; }
    const rows = await api("/api/patients?q=" + encodeURIComponent(q));
    const box = $("#psug");
    box.classList.remove("hidden");
    box.innerHTML = rows.map((p) => `<div data-id="${p.id}">${escapeHtml(p.patient_id)} — ${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.phone)}</div>`).join("") || "<div>No local match — register below</div>";
    box.querySelectorAll("div[data-id]").forEach((el) => {
      el.onclick = () => {
        const p = rows.find((x) => String(x.id) === el.dataset.id);
        state.patient = p;
        $("#fn").value = p.first_name;
        $("#ln").value = p.last_name;
        $("#mob").value = p.phone;
        $("#uhid").value = p.patient_id;
        $("#age").value = p.age_value || "";
        $("#sex").value = String(p.gender || "").toLowerCase().startsWith("f") ? "F" : String(p.gender || "").toLowerCase().startsWith("m") ? "M" : "O";
        box.classList.add("hidden");
      };
    });
  });
  $("#sq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 1) { $("#ssug").classList.add("hidden"); return; }
    const rows = await api("/api/services?q=" + encodeURIComponent(q));
    const box = $("#ssug");
    box.classList.remove("hidden");
    box.innerHTML = rows.map((s) => `<div data-id="${s.id}">${escapeHtml(s.category)} · ${escapeHtml(s.name)} — ${fmt(s.price)}</div>`).join("");
    box.querySelectorAll("div[data-id]").forEach((el) => {
      el.onclick = () => {
        const s = rows.find((x) => String(x.id) === el.dataset.id);
        state.lines.push({ careServiceId: s.id, serviceName: s.name, category: s.category, quantity: 1, unitPrice: Number(s.price) });
        $("#sq").value = "";
        box.classList.add("hidden");
        renderLines();
      };
    });
  });
  $("#disc").oninput = $("#cash").oninput = $("#upi").oninput = $("#card").oninput = updateTotals;
  $("#save").onclick = saveBill;
  renderLines();
}

function renderLines() {
  const el = $("#lines");
  if (!el) return;
  el.innerHTML = state.lines.map((l, i) => `<div class="row">${escapeHtml(l.serviceName)} × <input data-i="${i}" class="qty" type="number" min="1" value="${l.quantity}" style="width:70px"> ${fmt(l.unitPrice * l.quantity)} <button class="danger rm" data-i="${i}">×</button></div>`).join("");
  el.querySelectorAll(".qty").forEach((inp) => inp.oninput = () => { state.lines[Number(inp.dataset.i)].quantity = Number(inp.value || 1); renderLines(); });
  el.querySelectorAll(".rm").forEach((b) => b.onclick = () => { state.lines.splice(Number(b.dataset.i), 1); renderLines(); });
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
  $("#berr").textContent = "";
  try {
    const docSel = $("#doc");
    const txn = await api("/api/bills", {
      method: "POST",
      body: {
        patient: {
          carePatientId: state.patient?.id || null,
          uhid: $("#uhid").value || null,
          firstName: $("#fn").value,
          lastName: $("#ln").value,
          mobile: $("#mob").value,
          sex: $("#sex").value,
          ageValue: $("#age").value ? Number($("#age").value) : null,
          ageUnit: "years",
        },
        referringDoctorId: docSel.value || null,
        referringDoctorName: docSel.value ? docSel.options[docSel.selectedIndex].text : null,
        lines: state.lines.map((l) => ({ careServiceId: l.careServiceId, quantity: l.quantity })),
        discountAmount: Number($("#disc").value || 0),
        discountReason: $("#dreason").value || null,
        notes: $("#notes").value || null,
        payments: [
          { method: "cash", amount: Number($("#cash").value || 0) },
          { method: "upi", amount: Number($("#upi").value || 0) },
          { method: "card", amount: Number($("#card").value || 0) },
        ],
      },
    });
    state.lines = [];
    state.patient = null;
    printReceipt(txn);
    await refreshBills();
    render();
    printReceipt(txn);
  } catch (err) { $("#berr").textContent = err.message; }
}

function printReceipt(t) {
  const el = $("#receipt");
  el.classList.remove("hidden");
  el.innerHTML = `
    <h2>CARE Emergency Receipt</h2>
    <div><b>${t.emergencyBillNumber}</b></div>
    <div>${t.patient.firstName} ${t.patient.lastName} ${t.patient.uhid || ""}</div>
    <div>${t.patient.mobile}</div>
    <table>${t.lines.map((l) => `<tr><td>${l.serviceName}</td><td>${l.quantity}</td><td>${fmt(l.lineGross)}</td></tr>`).join("")}</table>
    <p>Gross ${fmt(t.grossAmount)} · Discount ${fmt(t.discountAmount)} · Net ${fmt(t.netAmount)}</p>
    <p>Received ${fmt(t.amountReceived)} · Due ${fmt(t.dueAmount)}</p>
    <p>${t.payments.map((p) => p.method + " " + fmt(p.amount)).join(" · ")}</p>
    <p>Staff: ${t.createdByStaffName}</p>
    <p>This is an emergency receipt. Final CARE bill is issued after reconciliation.</p>`;
  window.print();
  api("/api/bills/" + t.emergencyTransactionUuid + "/reprint", { method: "POST" }).catch(() => {});
}

function renderBills() {
  const el = $("#bills");
  if (!el) return;
  el.innerHTML = `<table><thead><tr><th>No</th><th>Patient</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${state.bills.map((b) => `<tr>
      <td>${escapeHtml(b.emergencyBillNumber)}</td>
      <td>${escapeHtml(b.patient.firstName + " " + b.patient.lastName)}</td>
      <td>${fmt(b.netAmount)}</td>
      <td>${fmt(b.amountReceived)}</td>
      <td>${fmt(b.dueAmount)}</td>
      <td>${b.status}</td>
      <td>${b.status === "PENDING" ? `<button class="danger void" data-u="${b.emergencyTransactionUuid}">Void</button>` : ""}
          <button class="secondary pr" data-u="${b.emergencyTransactionUuid}">Print</button></td>
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
async function boot() {
  try {
    const me = await api("/api/me");
    state.me = me.staff;
    state.locked = me.locked;
    state.session = me.session;
    state.syncedAt = me.masterDataLastSyncedAt;
    state.doctors = await api("/api/doctors");
    state.reasons = await api("/api/discount-reasons");
    await refreshBills();
  } catch {
    const st = await api("/api/status");
    state.me = null;
    state.locked = st.locked;
    state.syncedAt = st.masterDataLastSyncedAt;
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
