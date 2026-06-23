import './_group.css';
import { useState } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, Package, IndianRupee, Star, CheckCircle2,
  Phone, Percent, RefreshCcw, Plus, Printer, AlertTriangle,
  Hash, CalendarDays, Zap, ChevronDown
} from "lucide-react";

export function Justified() {
  const [selectedPatient] = useState<{ firstName: string; lastName: string; patientId: string; gender: string; phone: string; bloodGroup: string; dateOfBirth: string; ageValue: number; ageUnit: string } | null>({
    firstName: "Ramesh", lastName: "Kumar", patientId: "CD-240615", gender: "male", phone: "+91 98765 43210", bloodGroup: "O+", dateOfBirth: "1985-03-12", ageValue: 41, ageUnit: "years"
  });
  const [selectedTests] = useState([
    { id: 1, name: "CBC (Complete Blood Count)", code: "CBC", price: 450, category: "Pathology" },
    { id: 2, name: "Lipid Profile", code: "LIPID", price: 1200, category: "Pathology" },
    { id: 3, name: "X-ray Chest PA", code: "XR-CHEST", price: 800, category: "Radiology" },
    { id: 4, name: "USG Whole Abdomen", code: "USG-ABD", price: 1500, category: "Radiology" },
  ]);
  const [doctorName] = useState("Dr. Priya Sharma");
  const [doctorSpecialty] = useState("Cardiology");
  const [doctorBills] = useState(124);
  const [subtotal] = useState(3950);
  const [discount] = useState(395);
  const [total] = useState(3555);
  const [paymentMode] = useState("cash");
  const [notes] = useState("");
  const [referralCode] = useState("");
  const [needsDicom] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [doctorMode] = useState("doctor");

  const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const today = () => new Date().toLocaleDateString("en-IN", { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  const SectionHeader = ({ icon: Icon, label, count, right }: { icon: any; label: string; count?: string; right?: React.ReactNode }) => (
    <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50/80">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-gray-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">{label}</span>
        {count && <span className="text-[11px] text-gray-400 font-medium">{count}</span>}
      </div>
      {right}
    </div>
  );

  const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-foreground" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      {/* Top Bar */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Receipt size={16} className="text-violet-600" />
          <span className="font-bold text-sm text-gray-900">Billing Desk</span>
          <span className="text-xs text-gray-400">{today()}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full h-7 pl-9 pr-3 text-xs border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search bill by # or name" />
          </div>
          <button className="h-7 px-2.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md flex items-center gap-1.5 text-gray-600 transition-colors">
            <Receipt size={12} /> Recent
          </button>
          <button className="h-7 px-2.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-md flex items-center gap-1.5 text-gray-600 transition-colors">
            <RefreshCcw size={12} /> New
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Column - 65% */}
        <div className="w-full lg:w-[65%] flex flex-col overflow-y-auto p-3 gap-3">

          {/* Row 1: Patient + Register side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* Patient Card */}
            <Card>
              <div className="h-1 bg-blue-500" />
              <SectionHeader icon={User} label="Search Patient" right={selectedPatient && (
                <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                  <X size={11} /> Change
                </button>
              )} />
              <div className="p-3">
                {selectedPatient ? (
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                      {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-gray-900">{selectedPatient.firstName} {selectedPatient.lastName}</div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">{selectedPatient.patientId}</div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Phone size={10} /> {selectedPatient.phone}</span>
                        <span className="capitalize">{selectedPatient.gender}</span>
                        <span>{selectedPatient.ageValue} {selectedPatient.ageUnit === "years" ? "Yrs" : selectedPatient.ageUnit}</span>
                        <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selectedPatient.bloodGroup}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search by name, ID or phone" />
                  </div>
                )}
              </div>
            </Card>

            {/* Register Card */}
            <Card>
              <div className="h-1 bg-violet-500" />
              <SectionHeader icon={UserPlus} label="Register New" />
              <div className="p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">First Name *</label>
                    <input className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="First name" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Last Name *</label>
                    <input className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Last name" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Phone *</label>
                    <input className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="10-digit" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Age *</label>
                    <div className="flex gap-1 mt-0.5">
                      <input className="flex-1 h-8 text-sm border border-gray-200 rounded-md px-2 bg-gray-50" placeholder="Value" />
                      <select className="h-8 text-xs border border-gray-200 rounded-md px-1 w-16 bg-gray-50">
                        <option>Yrs</option>
                        <option>Mo</option>
                        <option>Days</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Gender *</label>
                    <select className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50">
                      <option>male</option>
                      <option>female</option>
                      <option>other</option>
                    </select>
                  </div>
                </div>
                <button className="w-full h-8 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors">
                  <UserPlus size={12} /> Register & Select
                </button>
              </div>
            </Card>
          </div>

          {/* DICOM Worklist */}
          {needsDicom && (
            <Card>
              <div className="h-1 bg-blue-400" />
              <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50/80">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">DICOM Worklist</span>
                <span className="ml-auto text-[10px] text-green-600 font-bold flex items-center gap-1">
                  <CheckCircle2 size={10} /> Ready
                </span>
              </div>
              <div className="p-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-gray-500">Study Description</label>
                  <input className="w-full h-7 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Brain MRI" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500">Body Part</label>
                  <input className="w-full h-7 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 font-mono" placeholder="BRAIN" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500">Station AE</label>
                  <input className="w-full h-7 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 font-mono" placeholder="MRI_ROOM1" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500">Referring Doctor</label>
                  <input className="w-full h-7 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Dr. Sharma" />
                </div>
              </div>
            </Card>
          )}

          {/* Doctor Section */}
          <Card>
            <div className="h-1 bg-teal-500" />
            <SectionHeader
              icon={Stethoscope}
              label="Doctor"
              right={
                <div className="flex gap-1">
                  <button className={`h-6 px-2.5 text-[10px] font-bold rounded-md transition-colors ${doctorMode === "doctor" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>Doctor</button>
                  <button className={`h-6 px-2.5 text-[10px] font-bold rounded-md transition-colors ${doctorMode === "self" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>Self</button>
                </div>
              }
            />
            <div className="p-3 space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search doctor by name or code" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 p-2.5 border border-gray-200 rounded-md bg-teal-50/30 flex items-center gap-2 cursor-pointer hover:border-teal-300 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold">PS</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900">{doctorName}</div>
                    <div className="text-xs text-gray-500">{doctorSpecialty} · {doctorBills} bills</div>
                  </div>
                  <CheckCircle2 size={14} className="text-teal-600" />
                </div>
                <div className="flex-1 p-2.5 border border-gray-200 rounded-md flex items-center gap-2 cursor-pointer hover:border-gray-300 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-bold">AM</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900">Dr. Amit Mishra</div>
                    <div className="text-xs text-gray-500">Orthopedics · 89 bills</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Tests Section */}
          <Card>
            <div className="h-1 bg-emerald-500" />
            <SectionHeader
              icon={FlaskConical}
              label="Tests & Packages"
              count={`${selectedTests.length} selected · ${inr(selectedTests.reduce((s, t) => s + t.price, 0))}`}
              right={
                <div className="flex items-center gap-1">
                  <button className="h-6 px-2 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-md flex items-center gap-1">
                    <Zap size={10} /> Quick
                  </button>
                  <button className="h-6 px-1.5 text-gray-400 hover:text-gray-600 rounded-md transition-colors" onClick={() => setQuickAddOpen(!quickAddOpen)}>
                    <ChevronDown size={14} className={`transition-transform ${quickAddOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
              }
            />
            <div className="p-3 space-y-2">
              {/* Quick Add Buttons */}
              {quickAddOpen && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-emerald-50/50 rounded-md border border-emerald-100">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase w-full mb-1">Quick Add</span>
                  {["CBC", "LFT", "KFT", "Sugar", "Thyroid", "Lipid", "Urine R/E", "X-ray Chest", "USG Abdomen", "ECG"].map((t) => (
                    <button key={t} className="h-6 px-2.5 text-[11px] font-bold bg-white border border-emerald-200 text-emerald-700 rounded-md hover:bg-emerald-100 transition-colors shadow-sm">
                      + {t}
                    </button>
                  ))}
                </div>
              )}
              {/* Test Search */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search tests by name or code" />
              </div>
              {/* Test List */}
              <div className="space-y-1">
                {selectedTests.map((t) => (
                  <div key={t.id} className="flex items-center p-2.5 border border-emerald-200 rounded-md bg-emerald-50/20">
                    <div className="flex items-center gap-2 flex-1">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span className="text-sm font-bold text-gray-900">{t.name}</span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{t.code}</span>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <span className="text-xs text-gray-500">{t.category}</span>
                      <span className="text-sm font-bold text-gray-900">₹{t.price.toLocaleString()}</span>
                      <button className="text-gray-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                    </div>
                  </div>
                ))}
                {/* Unselected tests */}
                <div className="flex items-center p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-4 h-4 rounded border border-gray-300" />
                    <span className="text-sm text-gray-600">Liver Function Test</span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">LFT</span>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-xs text-gray-400">Pathology</span>
                    <span className="text-sm font-bold text-gray-400">₹1,200</span>
                    <Star size={14} className="text-gray-300" />
                  </div>
                </div>
                <div className="flex items-center p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-4 h-4 rounded border border-gray-300" />
                    <span className="text-sm text-gray-600">Thyroid Profile</span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">THY</span>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-xs text-gray-400">Pathology</span>
                    <span className="text-sm font-bold text-gray-400">₹1,800</span>
                    <Star size={14} className="text-gray-300" />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Packages Section */}
          <Card>
            <div className="h-1 bg-amber-500" />
            <SectionHeader icon={Package} label="Packages" />
            <div className="p-3">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search packages by name, code, or test" />
              </div>
              <div className="mt-2 text-sm text-gray-400 text-center py-4">No packages available</div>
            </div>
          </Card>
        </div>

        {/* Right Column - 35% */}
        <div className="w-full lg:w-[35%] border-l border-gray-200 flex flex-col min-h-0 bg-slate-50">
          {/* Selected Tests */}
          <Card className="border-0 border-b border-gray-200 rounded-none">
            <div className="h-1 bg-violet-500" />
            <SectionHeader
              icon={FlaskConical}
              label="Selected Tests"
              count={`(${selectedTests.length})`}
              right={<button className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Clear All</button>}
            />
            <div className="p-3 space-y-1.5">
              {selectedTests.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-gray-700">{t.name}</span>
                  <span className="font-bold text-gray-900">₹{t.price.toLocaleString()}</span>
                </div>
              ))}
              <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between text-sm font-bold">
                <span className="text-gray-500">Total</span>
                <span className="text-gray-900">₹{selectedTests.reduce((s, t) => s + t.price, 0).toLocaleString()}</span>
              </div>
            </div>
          </Card>

          {/* Bill Summary */}
          <Card className="border-0 border-b border-gray-200 rounded-none">
            <div className="h-1 bg-violet-500" />
            <SectionHeader icon={Receipt} label="Bill Summary" />
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-bold text-gray-900">₹{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Discount</span>
                <div className="flex items-center gap-2">
                  <input className="w-14 h-7 text-xs border border-gray-200 rounded-md text-right px-2 bg-gray-50" value="10" />
                  <span className="text-xs text-gray-400">%</span>
                  <span className="font-bold text-emerald-600">-₹{discount.toLocaleString()}</span>
                </div>
              </div>
              <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                <span className="font-bold text-base text-gray-900">Total</span>
                <span className="font-bold text-xl text-violet-700">₹{total.toLocaleString()}</span>
              </div>
            </div>
          </Card>

          {/* Payment */}
          <Card className="border-0 border-b border-gray-200 rounded-none">
            <div className="h-1 bg-violet-500" />
            <SectionHeader icon={IndianRupee} label="Collect Payment" />
            <div className="p-4 space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                {["cash", "card", "upi", "cheque", "insurance"].map((m) => (
                  <button
                    key={m}
                    className={`h-8 px-3 text-[11px] font-bold rounded-md capitalize transition-colors ${m === paymentMode ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-500">₹</span>
                <input className="flex-1 h-10 text-lg font-bold border border-gray-200 rounded-md px-3 bg-gray-50 text-gray-900" value={total.toLocaleString()} />
                <span className="text-xs text-emerald-600 font-bold whitespace-nowrap">Paid in full</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Notes</label>
                  <input className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Notes" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase">Referral</label>
                  <div className="flex gap-1 mt-0.5">
                    <input className="flex-1 h-8 text-sm border border-gray-200 rounded-md px-2 bg-gray-50" placeholder="Code" />
                    <button className="h-8 px-2.5 bg-gray-100 hover:bg-gray-200 rounded-md text-[10px] font-bold text-gray-600 transition-colors">Apply</button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Save & Print */}
          <div className="p-4 space-y-2">
            <button className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-colors">
              <Printer size={16} /> Save & Print
            </button>
            <button className="w-full h-9 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-colors">
              <Receipt size={14} /> Save Only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
