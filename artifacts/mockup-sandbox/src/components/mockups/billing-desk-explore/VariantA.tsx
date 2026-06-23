import './_group.css';
import { useState } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, Package, IndianRupee, Star, CheckCircle2,
  Phone, RefreshCcw, Printer, AlertCircle, ChevronDown, ChevronUp, Calendar, Droplet, SearchCode
} from "lucide-react";

export function VariantA() {
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

  const [isPatientExpanded, setIsPatientExpanded] = useState(true);
  const [isDoctorExpanded, setIsDoctorExpanded] = useState(true);
  const [isTestsExpanded, setIsTestsExpanded] = useState(true);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800 font-sans" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      {/* Top Navbar */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 h-14 px-6 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white shadow-inner">
            <Receipt size={18} />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 leading-tight">Billing Desk</h1>
            <p className="text-[11px] text-slate-500 font-medium">Care Diagnostics • Thu, Jun 5, 2026</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-64 group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition-colors" />
            <input 
              className="w-full h-9 pl-9 pr-4 text-sm border border-slate-200 rounded-full bg-slate-50 focus:bg-white focus:border-violet-300 focus:ring-2 focus:ring-violet-100 outline-none transition-all" 
              placeholder="Search bill or patient..." 
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="h-9 px-4 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-full transition-colors flex items-center gap-2">
              <RefreshCcw size={14} /> New Bill
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: People & Context (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Patient Card */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col transition-shadow hover:shadow-md">
              <header 
                className="px-5 py-4 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between cursor-pointer hover:bg-blue-50"
                onClick={() => setIsPatientExpanded(!isPatientExpanded)}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-blue-100 flex items-center justify-center text-blue-600">
                    <User size={16} />
                  </div>
                  <h2 className="font-semibold text-blue-900">Patient Details</h2>
                </div>
                {isPatientExpanded ? <ChevronUp size={18} className="text-blue-400" /> : <ChevronDown size={18} className="text-blue-400" />}
              </header>
              
              {isPatientExpanded && (
                <div className="p-5">
                  {selectedPatient ? (
                    <div className="relative">
                      <button className="absolute top-0 right-0 p-1 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-md transition-colors">
                        <SearchCode size={14} />
                      </button>
                      <div className="flex gap-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-700 font-bold text-lg border border-blue-300 shadow-sm">
                          {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-slate-900 text-lg leading-tight">{selectedPatient.firstName} {selectedPatient.lastName}</h3>
                          <p className="text-sm text-slate-500 font-mono mt-0.5">{selectedPatient.patientId}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-y-4 mt-5 pt-5 border-t border-slate-100">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Contact</p>
                          <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><Phone size={12} className="text-slate-400" /> {selectedPatient.phone}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">DOB & Gender</p>
                          <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><Calendar size={12} className="text-slate-400" /> 41Y • {selectedPatient.gender === 'male' ? 'M' : 'F'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Blood Group</p>
                          <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                            <Droplet size={12} className="text-red-400 fill-red-400" /> {selectedPatient.bloodGroup}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Empty state or search form */}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Doctor Card */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col transition-shadow hover:shadow-md">
              <header 
                className="px-5 py-4 bg-teal-50/50 border-b border-teal-100 flex items-center justify-between cursor-pointer hover:bg-teal-50"
                onClick={() => setIsDoctorExpanded(!isDoctorExpanded)}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-teal-100 flex items-center justify-center text-teal-600">
                    <Stethoscope size={16} />
                  </div>
                  <h2 className="font-semibold text-teal-900">Referring Doctor</h2>
                </div>
                {isDoctorExpanded ? <ChevronUp size={18} className="text-teal-400" /> : <ChevronDown size={18} className="text-teal-400" />}
              </header>

              {isDoctorExpanded && (
                <div className="p-5 space-y-4">
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button className="flex-1 py-1.5 text-sm font-semibold bg-white text-teal-700 shadow-sm rounded-md border border-slate-200">Doctor</button>
                    <button className="flex-1 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">Self/Walk-in</button>
                  </div>
                  
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="w-full h-10 pl-9 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none transition-all" placeholder="Search doctor name..." />
                  </div>

                  <div className="p-3 border border-teal-100 bg-teal-50/30 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-sm font-bold">PS</div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{doctorName}</p>
                        <p className="text-xs text-slate-500">Cardiology</p>
                      </div>
                    </div>
                    <CheckCircle2 size={18} className="text-teal-500" />
                  </div>
                </div>
              )}
            </section>

          </div>

          {/* Middle Column: Cart & Items (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-140px)]">
              <header className="px-5 py-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <FlaskConical size={16} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-emerald-900">Investigations</h2>
                    <p className="text-xs text-emerald-600 font-medium mt-0.5">{selectedTests.length} tests added</p>
                  </div>
                </div>
              </header>

              <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-3">
                 <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="w-full h-10 pl-9 pr-24 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 outline-none transition-all bg-white shadow-sm" placeholder="Add test or package (e.g. CBC)..." />
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button className="px-2 h-8 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md">Pkg</button>
                    <button className="px-2 h-8 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md">Profiles</button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50/30">
                {selectedTests.map((t) => (
                  <div key={t.code} className="group p-3 bg-white border border-slate-200 rounded-xl hover:border-emerald-200 hover:shadow-sm transition-all flex items-start gap-3">
                    <div className="mt-0.5">
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-slate-800 text-sm leading-tight pr-4">{t.name}</h4>
                        <span className="font-bold text-slate-900 text-sm whitespace-nowrap">₹{t.price.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{t.code}</span>
                          <span className="text-xs text-slate-500">{t.category}</span>
                        </div>
                        <button className="text-slate-300 hover:text-red-500 transition-colors p-1">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {needsDicom && (
                   <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl mt-4">
                     <div className="flex items-center gap-2 mb-3">
                        <AlertCircle size={14} className="text-blue-600" />
                        <span className="text-sm font-bold text-blue-900">DICOM Requisition</span>
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        <input className="h-8 text-xs border border-blue-200 rounded-md px-2 bg-white" placeholder="Study Description" defaultValue="Brain MRI" />
                        <input className="h-8 text-xs border border-blue-200 rounded-md px-2 bg-white" placeholder="Body Part" defaultValue="BRAIN" />
                     </div>
                   </div>
                )}
              </div>
            </section>
            
          </div>

          {/* Right Column: Checkout (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
              <header className="px-5 py-4 bg-violet-50/50 border-b border-violet-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-violet-100 flex items-center justify-center text-violet-600">
                    <IndianRupee size={16} />
                  </div>
                  <h2 className="font-semibold text-violet-900">Payment</h2>
                </div>
              </header>

              <div className="p-5 space-y-5">
                {/* Summary */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Subtotal ({selectedTests.length} items)</span>
                    <span className="font-bold text-slate-700">₹{subtotal.toLocaleString()}</span>
                  </div>
                  
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Discount</span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input className="w-16 h-7 text-xs border border-slate-200 rounded bg-slate-50 text-right pr-5 font-medium focus:ring-1 focus:ring-violet-300 outline-none" defaultValue="10" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                      </div>
                      <span className="font-bold text-emerald-600">-₹{discount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-100 w-full" />

                {/* Total */}
                <div className="flex justify-between items-end">
                  <span className="text-slate-900 font-bold text-lg">Total Due</span>
                  <div className="text-right">
                    <span className="text-3xl font-black text-violet-700 leading-none">₹{total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="h-px bg-slate-100 w-full" />

                {/* Payment Methods */}
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["cash", "card", "upi"].map((m) => (
                      <button 
                        key={m} 
                        className={`h-10 rounded-lg text-sm font-bold capitalize transition-all border ${
                          m === paymentMode 
                            ? "bg-violet-600 border-violet-600 text-white shadow-md shadow-violet-200" 
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                   <div className="flex items-center justify-between">
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Amount Collected</label>
                     <button className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded">Full Amount</button>
                   </div>
                   <div className="relative">
                     <IndianRupee size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                     <input className="w-full h-12 pl-10 pr-4 text-xl font-bold border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none shadow-sm" defaultValue={total.toLocaleString()} />
                   </div>
                </div>

                <div className="pt-4 space-y-3">
                  <button className="w-full h-12 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-base font-bold flex items-center justify-center gap-2 hover:from-violet-700 hover:to-indigo-700 shadow-lg shadow-violet-200 transition-all transform hover:-translate-y-0.5">
                    <Printer size={18} /> Save & Print Bill
                  </button>
                  <button className="w-full h-10 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                    <Receipt size={16} /> Save Without Print
                  </button>
                </div>

              </div>
            </section>
          </div>

        </div>
      </main>
    </div>
  );
}
