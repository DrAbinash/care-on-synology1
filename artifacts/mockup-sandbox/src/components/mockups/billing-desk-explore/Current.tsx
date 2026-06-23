import './_group.css';
import { useState } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, Package, IndianRupee, Star, CheckCircle2,
  Phone, Percent, RefreshCcw, Plus, Printer, AlertTriangle,
  Hash, CalendarDays
} from "lucide-react";

export function Current() {
  const [patientSearch] = useState("");
  const [selectedPatient] = useState<{ firstName: string; lastName: string; patientId: string; gender: string; phone: string; bloodGroup: string; dateOfBirth: string } | null>({
    firstName: "Ramesh", lastName: "Kumar", patientId: "CD-240615", gender: "male", phone: "+91 98765 43210", bloodGroup: "O+", dateOfBirth: "1985-03-12"
  });
  const [selectedTests] = useState([
    { name: "CBC (Complete Blood Count)", code: "CBC", price: 450, category: "Pathology" },
    { name: "Lipid Profile", code: "LIPID", price: 1200, category: "Pathology" },
    { name: "X-ray Chest PA", code: "XR-CHEST", price: 800, category: "Radiology" },
    { name: "USG Whole Abdomen", code: "USG-ABD", price: 1500, category: "Radiology" },
  ]);
  const [doctorMode] = useState("doctor");
  const [doctorName] = useState("Dr. Priya Sharma");
  const [subtotal] = useState(3950);
  const [discount] = useState(395);
  const [total] = useState(3555);
  const [paymentMode] = useState("cash");
  const [notes] = useState("");
  const [referralCode] = useState("");
  const [needsDicom] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-foreground font-sans" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      {/* Top bar */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shadow-sm">
        <Receipt size={16} className="text-violet-600" />
        <span className="font-bold text-sm">Billing Desk</span>
        <span className="text-xs text-gray-500">· Thu, Jun 5, 2026</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full h-7 pl-9 text-sm border rounded-md bg-gray-50" placeholder="Search bill by # or name" />
          </div>
          <button className="h-7 px-2 text-xs bg-gray-100 rounded-md flex items-center gap-1"><Receipt size={12} /> Recent</button>
          <button className="h-7 px-2 text-xs bg-gray-100 rounded-md flex items-center gap-1"><RefreshCcw size={12} /> New</button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left column */}
        <div className="w-full lg:w-[65%] flex flex-col overflow-y-auto p-3 space-y-3">
          {/* Search Patient */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-blue-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold uppercase"><User size={14} /> Search Patient</div>
              <button className="text-xs text-gray-300 hover:text-white"><X size={11} /> Change</button>
            </div>
            <div className="p-3">
              {selectedPatient && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-violet-200 flex items-center justify-center text-violet-700 font-bold text-sm">RK</div>
                    <div>
                      <div className="font-bold text-sm">{selectedPatient.firstName} {selectedPatient.lastName}</div>
                      <div className="text-xs text-gray-500 font-mono">{selectedPatient.patientId}</div>
                    </div>
                    <div className="ml-auto text-xs text-gray-500 capitalize">{selectedPatient.gender} · {selectedPatient.dateOfBirth}</div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-500 pl-10">
                    <Phone size={10} /> {selectedPatient.phone}
                    <span className="ml-2 bg-red-100 text-red-600 px-1.5 rounded font-bold">{selectedPatient.bloodGroup}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* DICOM Worklist */}
          {needsDicom && (
            <div className="bg-blue-50 border border-blue-300 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-blue-200 bg-blue-100 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-600" />
                  DICOM Worklist
                </span>
                <span className="text-[11px] text-green-700 font-bold">✓ Ready</span>
              </div>
              <div className="p-3 grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-bold">Study Description</label>
                  <input className="w-full h-7 text-xs border border-blue-300 rounded px-2 bg-white" placeholder="Brain MRI" />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-bold">Body Part</label>
                  <input className="w-full h-7 text-xs border border-blue-300 rounded px-2 bg-white" placeholder="BRAIN" />
                </div>
              </div>
            </div>
          )}

          {/* Register New Patient */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-indigo-800 text-white flex items-center gap-2 text-sm font-bold uppercase">
              <UserPlus size={14} /> Register New Patient
            </div>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs">First Name *</label>
                  <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="First name" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Last Name *</label>
                  <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="Last name" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs">Phone *</label>
                  <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="10-digit" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Age *</label>
                  <div className="flex gap-1">
                    <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="Value" />
                    <select className="h-8 text-sm border rounded-md px-1 w-20"><option>Yrs</option><option>Mo</option></select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Gender *</label>
                  <select className="w-full h-8 text-sm border rounded-md px-2"><option>male</option><option>female</option></select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs">Blood Group</label>
                  <select className="w-full h-8 text-sm border rounded-md px-2"><option>O+</option><option>A+</option></select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Address</label>
                  <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="Address (optional)" />
                </div>
              </div>
              <button className="w-full h-9 bg-violet-600 text-white rounded-md text-sm font-bold flex items-center justify-center gap-2">
                <UserPlus size={14} /> Register & Select
              </button>
            </div>
          </div>

          {/* Doctor Section */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-teal-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold uppercase"><Stethoscope size={14} /> Doctor</div>
              <div className="flex gap-2 text-xs">
                <button className="bg-teal-600 px-2 py-0.5 rounded">Doctor</button>
                <button className="bg-teal-800 px-2 py-0.5 rounded">Self</button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-8 pl-9 text-sm border rounded-md" placeholder="Search doctor by name or code..." />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 p-2 border rounded-md hover:bg-gray-50 cursor-pointer flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold">PS</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold">Dr. Priya Sharma</div>
                    <div className="text-xs text-gray-500">Cardiology · 124 bills</div>
                  </div>
                  <CheckCircle2 size={14} className="text-teal-600" />
                </div>
                <div className="flex-1 p-2 border rounded-md hover:bg-gray-50 cursor-pointer flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold">AM</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold">Dr. Amit Mishra</div>
                    <div className="text-xs text-gray-500">Orthopedics · 89 bills</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tests Section */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-emerald-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold uppercase"><FlaskConical size={14} /> Tests</div>
              <div className="text-xs font-bold">{selectedTests.length} selected · ₹{selectedTests.reduce((s, t) => s + t.price, 0).toLocaleString()}</div>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex gap-1 text-xs">
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold">Quick</span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Lab</span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Imaging</span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Cardio</span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Neuro</span>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Endo</span>
                </div>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-8 pl-9 text-sm border rounded-md" placeholder="Search tests by name or code..." />
              </div>
              <div className="space-y-1">
                {selectedTests.map((t) => (
                  <div key={t.code} className="flex items-center p-2 border rounded-md bg-emerald-50/50">
                    <div className="flex items-center gap-2 flex-1">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span className="text-sm font-bold">{t.name}</span>
                      <span className="text-xs text-gray-500">{t.code}</span>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <span className="text-xs text-gray-500">{t.category}</span>
                      <span className="text-sm font-bold">₹{t.price.toLocaleString()}</span>
                      <button className="text-red-500 hover:text-red-700"><X size={14} /></button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center p-2 border rounded-md hover:bg-gray-50 cursor-pointer">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-5 h-5 rounded border border-gray-300" />
                    <span className="text-sm">Liver Function Test</span>
                    <span className="text-xs text-gray-500">LFT</span>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-xs text-gray-500">Pathology</span>
                    <span className="text-sm font-bold text-gray-500">₹1,200</span>
                    <Star size={14} className="text-gray-300" />
                  </div>
                </div>
                <div className="flex items-center p-2 border rounded-md hover:bg-gray-50 cursor-pointer">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-5 h-5 rounded border border-gray-300" />
                    <span className="text-sm">Thyroid Profile</span>
                    <span className="text-xs text-gray-500">THY</span>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-xs text-gray-500">Pathology</span>
                    <span className="text-sm font-bold text-gray-500">₹1,800</span>
                    <Star size={14} className="text-gray-300" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Packages Section */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2 bg-red-800 text-white flex items-center gap-2 text-sm font-bold uppercase">
              <Package size={14} /> Packages
            </div>
            <div className="p-3">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full h-8 pl-9 text-sm border rounded-md" placeholder="Search packages by name, code, or test..." />
              </div>
              <div className="mt-2 text-sm text-gray-400 text-center py-4">No packages available</div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="w-full lg:w-[35%] border-l border-gray-200 flex flex-col min-h-0 bg-gray-50">
          {/* Selected Tests */}
          <div className="bg-white border-b border-gray-200">
            <div className="px-4 py-2 bg-violet-900 text-white flex items-center justify-between text-sm font-bold uppercase">
              <div className="flex items-center gap-2"><FlaskConical size={14} /> Selected Tests ({selectedTests.length})</div>
              <button className="text-xs text-gray-300 hover:text-white">Clear All</button>
            </div>
            <div className="p-3 space-y-1">
              {selectedTests.map((t) => (
                <div key={t.code} className="flex items-center justify-between text-sm">
                  <span className="truncate">{t.name}</span>
                  <span className="font-bold">₹{t.price.toLocaleString()}</span>
                </div>
              ))}
              <div className="border-t pt-2 mt-2 flex justify-between text-sm font-bold">
                <span>Total</span>
                <span>₹{selectedTests.reduce((s, t) => s + t.price, 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Bill Summary */}
          <div className="bg-white border-b border-gray-200">
            <div className="px-4 py-2 bg-violet-900 text-white flex items-center gap-2 text-sm font-bold uppercase">
              <Receipt size={14} /> Bill Summary
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-bold">₹{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Discount</span>
                <div className="flex items-center gap-2">
                  <input className="w-16 h-7 text-xs border rounded-md text-right" value="10" />
                  <span className="text-xs text-gray-500">%</span>
                  <span className="font-bold text-green-600">-₹{discount.toLocaleString()}</span>
                </div>
              </div>
              <div className="border-t pt-2 flex items-center justify-between">
                <span className="font-bold text-lg">Total</span>
                <span className="font-bold text-lg text-violet-700">₹{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-white border-b border-gray-200">
            <div className="px-4 py-2 bg-violet-900 text-white flex items-center gap-2 text-sm font-bold uppercase">
              <IndianRupee size={14} /> Collect Payment
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2 text-xs">
                {["cash", "card", "upi", "cheque", "insurance"].map((m) => (
                  <button key={m} className={`px-3 py-1.5 rounded-md font-bold capitalize ${m === paymentMode ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600"}`}>{m}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">₹</span>
                <input className="flex-1 h-9 text-lg font-bold border rounded-md px-2" value={total.toLocaleString()} />
              </div>
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 size={14} /> Paid in full
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Notes</label>
                  <input className="w-full h-8 text-sm border rounded-md px-2" placeholder="Notes" value={notes} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Referral</label>
                  <div className="flex gap-1">
                    <input className="flex-1 h-8 text-sm border rounded-md px-2" placeholder="Code" value={referralCode} />
                    <button className="h-8 px-2 bg-gray-100 rounded-md text-xs font-bold">Apply</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save & Print */}
          <div className="p-4 space-y-2">
            <button className="w-full h-11 bg-violet-600 text-white rounded-md text-base font-bold flex items-center justify-center gap-2 hover:bg-violet-700">
              <Printer size={16} /> Save & Print
            </button>
            <button className="w-full h-9 bg-gray-100 text-gray-700 rounded-md text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-200">
              <Receipt size={14} /> Save Only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
