import './_group.css';
import { useState } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, Package, IndianRupee, Star, CheckCircle2,
  Phone, Percent, RefreshCcw, Plus, Printer, AlertTriangle,
  Hash, CalendarDays, ChevronRight, ChevronLeft, CreditCard,
  Banknote, FileText, Check
} from "lucide-react";

const STEPS = [
  { id: 1, title: "Patient", icon: User },
  { id: 2, title: "Doctor", icon: Stethoscope },
  { id: 3, title: "Tests", icon: FlaskConical },
  { id: 4, title: "Payment", icon: IndianRupee },
  { id: 5, title: "Summary", icon: FileText }
];

export function VariantB() {
  const [currentStep, setCurrentStep] = useState(1);
  
  // Data state (copied from Current.tsx)
  const [patientSearch, setPatientSearch] = useState("");
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
  const [paymentMode, setPaymentMode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [needsDicom] = useState(false);

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, STEPS.length));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-foreground font-sans" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      
      {/* Top Navigation / Stepper */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-inner">
            <Receipt size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-900">New Bill</h1>
            <p className="text-xs text-slate-500 font-medium">Thu, Jun 5, 2026</p>
          </div>
        </div>

        {/* Stepper Center */}
        <div className="flex items-center">
          {STEPS.map((step, index) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            const StepIcon = step.icon;
            
            return (
              <div key={step.id} className="flex items-center">
                <button 
                  onClick={() => setCurrentStep(step.id)}
                  disabled={step.id > currentStep && !isCompleted}
                  className={`flex flex-col items-center gap-1.5 w-20 relative group outline-none
                    ${(step.id > currentStep && !isCompleted) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 border-2
                    ${isActive ? 'bg-violet-600 border-violet-600 text-white shadow-md scale-110' : 
                      isCompleted ? 'bg-violet-100 border-violet-200 text-violet-600' : 
                      'bg-white border-slate-200 text-slate-400 group-hover:border-slate-300'}
                  `}>
                    {isCompleted ? <Check size={18} strokeWidth={3} /> : <StepIcon size={18} />}
                  </div>
                  <span className={`text-[11px] font-bold tracking-wide uppercase transition-colors
                    ${isActive ? 'text-violet-700' : isCompleted ? 'text-violet-600' : 'text-slate-400'}
                  `}>
                    {step.title}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div className={`w-12 h-0.5 mx-1 rounded-full transition-colors
                    ${isCompleted ? 'bg-violet-600' : 'bg-slate-200'}
                  `} />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button className="h-9 px-4 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors">
            Cancel
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex max-w-[1400px] w-full mx-auto p-6 gap-6 h-[calc(100vh-85px)]">
        
        {/* Left: Active Step Content */}
        <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
          
          <div className="flex-1 overflow-y-auto p-8 relative">
            {/* Step 1: Patient */}
            {currentStep === 1 && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center space-y-2 mb-8">
                  <h2 className="text-2xl font-bold text-slate-900">Who is the patient?</h2>
                  <p className="text-slate-500">Search for an existing patient or register a new one.</p>
                </div>

                <div className="relative group">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-violet-500 transition-colors" />
                  <input 
                    className="w-full h-14 pl-12 pr-4 text-lg border-2 border-slate-200 rounded-xl focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 outline-none transition-all shadow-sm" 
                    placeholder="Search by phone number, name, or patient ID..." 
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                  />
                </div>

                {selectedPatient && (
                  <div className="bg-violet-50 border-2 border-violet-200 rounded-xl p-5 relative overflow-hidden group hover:border-violet-300 transition-colors">
                    <div className="absolute top-0 right-0 p-3">
                       <CheckCircle2 className="text-violet-600" size={24} />
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-violet-200 flex items-center justify-center text-violet-700 font-bold text-xl shadow-inner">
                        RK
                      </div>
                      <div>
                        <div className="text-xl font-bold text-slate-900">{selectedPatient.firstName} {selectedPatient.lastName}</div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-600">
                          <span className="font-mono bg-white px-2 py-0.5 rounded shadow-sm border border-violet-100">{selectedPatient.patientId}</span>
                          <span className="flex items-center gap-1"><Phone size={14}/> {selectedPatient.phone}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-violet-200/60">
                      <div>
                        <div className="text-[11px] font-bold text-violet-500 uppercase tracking-wider">Gender</div>
                        <div className="font-medium capitalize text-slate-800">{selectedPatient.gender}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-violet-500 uppercase tracking-wider">DOB / Age</div>
                        <div className="font-medium text-slate-800">{selectedPatient.dateOfBirth} (41y)</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-violet-500 uppercase tracking-wider">Blood Group</div>
                        <div className="font-medium text-red-600 bg-red-100 w-fit px-2 py-0.5 rounded-md inline-block">{selectedPatient.bloodGroup}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-slate-200"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-3 bg-white text-sm text-slate-400 font-medium">OR</span>
                  </div>
                </div>

                <button className="w-full h-14 bg-white border-2 border-dashed border-slate-300 rounded-xl text-slate-600 font-bold flex items-center justify-center gap-2 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-all">
                  <UserPlus size={18} /> Register New Patient
                </button>
              </div>
            )}

            {/* Step 2: Doctor */}
            {currentStep === 2 && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <div className="text-center space-y-2 mb-8">
                  <h2 className="text-2xl font-bold text-slate-900">Referring Doctor</h2>
                  <p className="text-slate-500">Who referred the patient for these tests?</p>
                </div>

                <div className="flex bg-slate-100 p-1.5 rounded-xl w-fit mx-auto shadow-inner">
                  <button className="px-6 py-2 rounded-lg text-sm font-bold bg-white text-slate-900 shadow-sm">Doctor</button>
                  <button className="px-6 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700">Self Walk-in</button>
                </div>

                <div className="relative group">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-teal-500 transition-colors" />
                  <input className="w-full h-14 pl-12 pr-4 text-lg border-2 border-slate-200 rounded-xl focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all shadow-sm" placeholder="Search referring doctor..." />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center p-4 border-2 border-teal-500 bg-teal-50/50 rounded-xl cursor-pointer">
                    <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-lg font-bold shadow-sm">PS</div>
                    <div className="ml-4 flex-1">
                      <div className="text-lg font-bold text-slate-900">Dr. Priya Sharma</div>
                      <div className="text-sm text-slate-500 font-medium">Cardiology</div>
                    </div>
                    <CheckCircle2 size={24} className="text-teal-600" />
                  </div>

                  <div className="flex items-center p-4 border-2 border-transparent hover:border-slate-200 bg-white hover:bg-slate-50 rounded-xl cursor-pointer transition-colors">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-lg font-bold">AM</div>
                    <div className="ml-4 flex-1">
                      <div className="text-lg font-bold text-slate-900">Dr. Amit Mishra</div>
                      <div className="text-sm text-slate-500 font-medium">Orthopedics</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Tests */}
            {currentStep === 3 && (
              <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
                <div className="text-center space-y-1 shrink-0">
                  <h2 className="text-2xl font-bold text-slate-900">Add Tests & Packages</h2>
                  <p className="text-slate-500">Search and select diagnostic tests.</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-sm font-bold shadow-sm">Quick Add</button>
                  <button className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Pathology</button>
                  <button className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Radiology</button>
                  <button className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Cardiology</button>
                  <button className="px-4 py-2 bg-violet-50 border border-violet-200 text-violet-700 rounded-lg text-sm font-bold ml-auto flex items-center gap-2"><Package size={16}/> Packages</button>
                </div>

                <div className="relative group shrink-0">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                  <input className="w-full h-14 pl-12 pr-4 text-lg border-2 border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all shadow-sm" placeholder="Search tests by name, code, or synonym..." />
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-2 pb-10">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 mt-4">Selected Tests</h3>
                  {selectedTests.map((t) => (
                    <div key={t.code} className="flex items-center p-3 border border-emerald-200 bg-emerald-50/30 rounded-xl group hover:border-emerald-300 transition-colors">
                       <CheckCircle2 size={20} className="text-emerald-600 mr-3" />
                       <div className="flex-1">
                          <div className="font-bold text-slate-900">{t.name}</div>
                          <div className="text-xs text-slate-500 flex gap-2"><span className="font-mono bg-white px-1 border rounded">{t.code}</span> <span>{t.category}</span></div>
                       </div>
                       <div className="text-right">
                          <div className="font-bold text-lg">₹{t.price.toLocaleString()}</div>
                          <button className="text-xs text-red-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 justify-end w-full"><X size={12}/> Remove</button>
                       </div>
                    </div>
                  ))}

                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 mt-6">Frequent Tests</h3>
                  {[
                    { name: "Liver Function Test", code: "LFT", price: 1200, category: "Pathology" },
                    { name: "Thyroid Profile Total", code: "THY", price: 1800, category: "Pathology" },
                  ].map((t) => (
                    <div key={t.code} className="flex items-center p-3 border border-slate-200 bg-white rounded-xl hover:border-emerald-500 hover:shadow-md cursor-pointer transition-all">
                       <div className="w-5 h-5 rounded border-2 border-slate-300 mr-3 flex-shrink-0" />
                       <div className="flex-1">
                          <div className="font-bold text-slate-800">{t.name}</div>
                          <div className="text-xs text-slate-500 flex gap-2"><span className="font-mono bg-slate-50 px-1 border rounded">{t.code}</span> <span>{t.category}</span></div>
                       </div>
                       <div className="text-right flex items-center gap-4">
                          <div className="font-bold text-slate-500 text-lg">₹{t.price.toLocaleString()}</div>
                          <button className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-emerald-100 hover:text-emerald-600"><Plus size={16}/></button>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4: Payment */}
            {currentStep === 4 && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center space-y-2 mb-8">
                  <h2 className="text-2xl font-bold text-slate-900">Payment Collection</h2>
                  <p className="text-slate-500">Apply discounts and record payment.</p>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Subtotal</span>
                    <span className="text-xl font-bold">₹{subtotal.toLocaleString()}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 font-medium">Discount</span>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <input className="w-24 h-10 text-right pr-8 pl-3 border border-slate-300 rounded-lg font-bold text-lg focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none" value="10" />
                        <Percent size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                      <span className="text-lg font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">-₹{discount.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="h-px bg-slate-200 w-full my-4"></div>

                  <div className="flex justify-between items-center">
                    <span className="text-lg text-slate-900 font-bold">Net Total</span>
                    <span className="text-4xl font-extrabold text-violet-700 tracking-tight">₹{total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-sm font-bold text-slate-900">Payment Method</label>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'cash', label: 'Cash', icon: Banknote },
                      { id: 'upi', label: 'UPI / QR', icon: Hash },
                      { id: 'card', label: 'Card', icon: CreditCard },
                      { id: 'insurance', label: 'Insurance', icon: Receipt },
                    ].map(method => (
                      <button 
                        key={method.id}
                        onClick={() => setPaymentMode(method.id)}
                        className={`h-16 rounded-xl flex flex-col items-center justify-center gap-1 border-2 transition-all
                          ${paymentMode === method.id ? 'border-violet-600 bg-violet-50 text-violet-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}
                        `}
                      >
                        <method.icon size={20} />
                        <span className="text-xs font-bold">{method.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-sm font-bold text-slate-900">Amount Collected</label>
                  <div className="relative">
                    <IndianRupee size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="w-full h-14 pl-12 pr-4 text-2xl font-bold border-2 border-slate-200 rounded-xl focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 outline-none transition-all shadow-sm" value={total.toLocaleString()} />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-sm font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                      <CheckCircle2 size={16}/> Paid in full
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Internal Notes</label>
                    <input className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none" placeholder="Add remarks..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Referral Code</label>
                    <input className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none font-mono uppercase" placeholder="CODE" />
                  </div>
                </div>

              </div>
            )}

            {/* Step 5: Summary / Done */}
            {currentStep === 5 && (
              <div className="max-w-2xl mx-auto flex flex-col items-center justify-center text-center space-y-6 pt-10 animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mb-4 shadow-inner">
                   <CheckCircle2 size={48} className="text-emerald-600" />
                </div>
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Ready to Print</h2>
                <p className="text-lg text-slate-500 max-w-md">Bill is fully configured. Please review the summary on the right before saving.</p>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 w-full mt-8 flex flex-col items-center gap-4">
                  <AlertTriangle className="text-amber-500" size={24} />
                  <p className="text-slate-600 font-medium">Verify DICOM worklist requirements and patient details.</p>
                </div>
              </div>
            )}

          </div>

          {/* Bottom Action Bar */}
          <div className="p-6 bg-white border-t border-slate-200 flex justify-between items-center shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-10">
            <button 
              onClick={prevStep}
              className={`h-12 px-6 rounded-xl font-bold flex items-center gap-2 transition-colors
                ${currentStep === 1 ? 'invisible' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
              `}
            >
              <ChevronLeft size={20} /> Back
            </button>
            
            {currentStep < STEPS.length ? (
               <button 
                onClick={nextStep}
                className="h-12 px-8 rounded-xl font-bold flex items-center gap-2 bg-violet-600 text-white shadow-md hover:bg-violet-700 hover:shadow-lg transition-all active:scale-95"
              >
                Next Step <ChevronRight size={20} />
              </button>
            ) : (
              <button 
                className="h-12 px-10 rounded-xl font-bold flex items-center gap-3 bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 hover:shadow-xl transition-all active:scale-95 text-lg"
              >
                <Printer size={20} /> Save & Print Bill
              </button>
            )}
          </div>
        </div>

        {/* Right Sidebar: Persistent Live Summary */}
        <div className="w-[380px] bg-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden text-slate-300 relative border border-slate-800">
           {/* Receipt header styling */}
           <div className="bg-slate-950 p-6 border-b border-slate-800 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 rounded-full blur-3xl"></div>
             <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase mb-4">Live Summary</h3>
             <div className="flex justify-between items-end">
               <div>
                 <div className="text-2xl font-bold text-white mb-1">₹{total.toLocaleString()}</div>
                 <div className="text-xs text-slate-400 font-mono">Total Payable</div>
               </div>
               <div className="text-right">
                 <div className="text-sm font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded uppercase tracking-wider">{paymentMode}</div>
               </div>
             </div>
           </div>

           <div className="flex-1 overflow-y-auto p-6 space-y-8">
             
             {/* Patient & Doctor Snapshot */}
             <div className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Patient</div>
                  {selectedPatient ? (
                    <div className="flex items-center gap-3">
                      <User size={16} className="text-slate-400" />
                      <span className="font-medium text-white">{selectedPatient.firstName} {selectedPatient.lastName}</span>
                      <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">{selectedPatient.patientId}</span>
                    </div>
                  ) : <span className="text-sm italic text-slate-600">Not selected</span>}
                </div>

                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Referring Doctor</div>
                  <div className="flex items-center gap-3">
                    <Stethoscope size={16} className="text-slate-400" />
                    <span className="font-medium text-white">{doctorName}</span>
                  </div>
                </div>
             </div>

             <div className="h-px bg-slate-800 w-full" />

             {/* Tests Snapshot */}
             <div>
                <div className="flex justify-between items-center mb-3">
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Tests ({selectedTests.length})</div>
                </div>
                <div className="space-y-3">
                  {selectedTests.map(t => (
                    <div key={t.code} className="flex justify-between items-start text-sm">
                      <div className="pr-4">
                        <div className="text-slate-200">{t.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{t.code}</div>
                      </div>
                      <div className="font-medium text-white shrink-0">₹{t.price}</div>
                    </div>
                  ))}
                </div>
             </div>

             <div className="h-px bg-slate-800 w-full" />

             {/* Financials Snapshot */}
             <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Subtotal</span>
                  <span className="text-white">₹{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Discount (10%)</span>
                  <span className="text-emerald-400">-₹{discount.toLocaleString()}</span>
                </div>
             </div>

           </div>
           
           {/* Sidebar Bottom Action (Always visible but disabled until end) */}
           <div className="p-6 bg-slate-950 border-t border-slate-800 mt-auto">
             <button 
               className={`w-full h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all
                 ${currentStep === STEPS.length ? 'bg-violet-600 text-white shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:bg-violet-500' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}
               `}
               disabled={currentStep !== STEPS.length}
             >
               <Printer size={18} /> Print Final Bill
             </button>
           </div>
        </div>

      </div>
    </div>
  );
}
