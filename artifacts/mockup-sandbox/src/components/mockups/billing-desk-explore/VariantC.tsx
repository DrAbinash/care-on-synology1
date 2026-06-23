import './_group.css';
import { useState } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, IndianRupee, CheckCircle2,
  Phone, Printer
} from "lucide-react";

export function VariantC() {
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
    <div className="min-h-screen bg-white text-slate-800 font-sans flex justify-center pb-24" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      
      {/* Main Content Area - Single Column */}
      <div className="w-full max-w-3xl px-6 py-12 space-y-12">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-medium tracking-tight">New Bill</h1>
            <p className="text-sm text-slate-500">Thursday, June 5, 2026</p>
          </div>
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              className="w-full h-9 pl-9 pr-4 text-sm bg-slate-50 border-transparent focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-slate-100 rounded-lg transition-all outline-none" 
              placeholder="Search existing..." 
            />
          </div>
        </header>

        {/* Section 1: Patient */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-400 uppercase tracking-widest">
            <span className="w-5 h-px bg-slate-200"></span> Patient
          </div>
          
          {selectedPatient ? (
            <div className="group relative flex items-start gap-4 p-5 rounded-2xl border border-slate-100 bg-white hover:shadow-sm transition-all">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-medium text-lg shrink-0">
                {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">{selectedPatient.firstName} {selectedPatient.lastName}</h3>
                  <button className="text-sm text-slate-400 hover:text-slate-600 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1">
                    <Search size={14} /> Change
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                  <span className="font-mono text-slate-400">{selectedPatient.patientId}</span>
                  <span className="flex items-center gap-1"><Phone size={12} /> {selectedPatient.phone}</span>
                  <span className="capitalize">{selectedPatient.gender}, {selectedPatient.dateOfBirth}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">{selectedPatient.bloodGroup}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button className="flex items-center justify-center gap-2 p-6 rounded-2xl border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all">
                <Search size={18} />
                <span className="font-medium">Search Existing</span>
              </button>
              <button className="flex items-center justify-center gap-2 p-6 rounded-2xl border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all">
                <UserPlus size={18} />
                <span className="font-medium">Register New</span>
              </button>
            </div>
          )}
        </section>

        {/* Section 2: Referring Doctor */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-400 uppercase tracking-widest">
            <span className="w-5 h-px bg-slate-200"></span> Referral
          </div>
          
          <div className="flex items-center gap-4 p-2 rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                className="w-full h-12 pl-10 pr-4 text-sm bg-transparent outline-none" 
                placeholder="Search referring doctor..." 
                value={doctorName}
                readOnly
              />
            </div>
            <div className="flex items-center gap-1 pr-2">
              <button className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${doctorMode === 'doctor' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Doctor</button>
              <button className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${doctorMode === 'self' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Self</button>
            </div>
          </div>
        </section>

        {/* Section 3: Tests */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-400 uppercase tracking-widest">
              <span className="w-5 h-px bg-slate-200"></span> Investigations
            </div>
            <span className="text-sm font-medium text-slate-500">{selectedTests.length} added</span>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                className="w-full h-14 pl-12 pr-4 text-base bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-slate-100 focus:border-slate-400 transition-all shadow-sm" 
                placeholder="Add tests or packages..." 
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium cursor-pointer hover:bg-slate-200">Path</span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium cursor-pointer hover:bg-slate-200">Rad</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
              <div className="divide-y divide-slate-50">
                {selectedTests.map((t) => (
                  <div key={t.code} className="flex items-center p-4 hover:bg-slate-50 transition-colors group">
                    <div className="w-8 flex justify-center">
                      <div className="w-4 h-4 rounded-full border-2 border-slate-800 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-slate-800"></div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 pr-4">
                      <h4 className="text-sm font-medium truncate">{t.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{t.code} · {t.category}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium tabular-nums">₹{t.price.toLocaleString()}</span>
                      <button className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Floating Summary & Actions Panel */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-4 pointer-events-none z-50">
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-100 p-4 flex items-center gap-6 pointer-events-auto">
          
          {/* Summary Info */}
          <div className="flex items-center gap-6 px-4 border-r border-slate-100 shrink-0">
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">Total Amount</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-medium tracking-tight">₹{total.toLocaleString()}</span>
                {discount > 0 && <span className="text-sm text-slate-400 line-through">₹{subtotal.toLocaleString()}</span>}
              </div>
            </div>
          </div>

          {/* Payment Mode */}
          <div className="flex-1 flex items-center gap-2">
            {["cash", "card", "upi"].map((m) => (
              <button 
                key={m} 
                className={`px-5 py-2.5 rounded-xl text-sm font-medium capitalize transition-all ${
                  m === paymentMode 
                    ? "bg-slate-800 text-white shadow-md shadow-slate-200" 
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button className="h-11 px-6 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2">
              Save Only
            </button>
            <button className="h-11 px-8 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-md shadow-indigo-200 hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center gap-2">
              <Printer size={16} /> Print & Collect
            </button>
          </div>
          
        </div>
      </div>

    </div>
  );
}
