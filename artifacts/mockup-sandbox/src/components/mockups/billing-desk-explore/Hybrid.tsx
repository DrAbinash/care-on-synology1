import './_group.css';
import { useState, useRef } from "react";
import {
  Receipt, Search, User, UserPlus, Stethoscope, X,
  FlaskConical, Package, IndianRupee, Star, CheckCircle2,
  Phone, Percent, RefreshCcw, Plus, Printer, AlertTriangle,
  Hash, CalendarDays, Zap, ChevronRight, ChevronDown, ChevronLeft,
  Banknote, CreditCard, Wallet, Landmark, Building2, Check
} from "lucide-react";

const STEPS = [
  { id: 1, title: "Patient", icon: User, subtitle: "Search or register" },
  { id: 2, title: "Doctor", icon: Stethoscope, subtitle: "Referral" },
  { id: 3, title: "Tests & Packages", icon: FlaskConical, subtitle: "Add tests & packages" },
  { id: 4, title: "Summary", icon: Receipt, subtitle: "Bill & pay" },
];

export function Hybrid() {
  const [currentStep, setCurrentStep] = useState(1);
  const [stepCompleted, setStepCompleted] = useState<Set<number>>(new Set([1, 2, 3, 4]));
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<{ firstName: string; lastName: string; patientId: string; gender: string; phone: string; bloodGroup: string; dateOfBirth: string; ageValue: number; ageUnit: string } | null>({
    firstName: "Ramesh", lastName: "Kumar", patientId: "CD-240615", gender: "male", phone: "+91 98765 43210", bloodGroup: "O+", dateOfBirth: "1985-03-12", ageValue: 41, ageUnit: "years"
  });
  const [selectedTests, setSelectedTests] = useState([
    { id: 1, name: "CBC (Complete Blood Count)", code: "CBC", price: 450, category: "Pathology" },
    { id: 2, name: "Lipid Profile", code: "LIPID", price: 1200, category: "Pathology" },
    { id: 3, name: "X-ray Chest PA", code: "XR-CHEST", price: 800, category: "Radiology" },
    { id: 4, name: "USG Whole Abdomen", code: "USG-ABD", price: 1500, category: "Radiology" },
  ]);
  const [doctorId, setDoctorId] = useState(1);
  const [doctorName, setDoctorName] = useState("Dr. Priya Sharma");
  const [doctorSpecialty, setDoctorSpecialty] = useState("Cardiology");
  const [doctorBills, setDoctorBills] = useState(124);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [subtotal] = useState(3950);
  const [discount] = useState(395);
  const [total] = useState(3555);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [payNow, setPayNow] = useState(true);
  const [notes, setNotes] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [needsDicom] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [doctorMode] = useState("doctor");
  const [discountType] = useState<"amount" | "pct">("amount");
  const [discountValue] = useState(395);
  const [testSearch, setTestSearch] = useState("");
  const [categoryFilter] = useState("all");
  const [packageSearch, setPackageSearch] = useState("");
  const [selectedPackages, setSelectedPackages] = useState<string[]>(["Basic Health Check"]);
  const contentRef = useRef<HTMLDivElement>(null);

  const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const today = () => new Date().toLocaleDateString("en-IN", { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  const goToStep = (step: number) => {
    if (step <= currentStep || stepCompleted.has(step - 1)) {
      setCurrentStep(step);
      setTimeout(() => contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      setStepCompleted((prev) => new Set([...prev, currentStep]));
      setCurrentStep(currentStep + 1);
      setTimeout(() => contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const advanceStep = () => {
    if (currentStep < STEPS.length && autoAdvance) {
      setTimeout(() => {
        setStepCompleted((prev) => new Set([...prev, currentStep]));
        setCurrentStep((prev) => prev + 1);
        setTimeout(() => contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }, 300);
    }
  };

  const StepHeader = ({ step, title, subtitle }: { step: number; title: string; subtitle: string }) => (
    <div className="flex items-center gap-3 mb-6">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
        step === currentStep ? 'bg-violet-600 text-white' : stepCompleted.has(step) ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
      }`}>
        {stepCompleted.has(step) ? <Check size={16} /> : step}
      </div>
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );

  const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );

  const QuickAddButton = ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button
      onClick={onClick}
      className="h-8 px-3 text-[11px] font-bold bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm flex items-center gap-1"
    >
      <Plus size={10} /> {label}
    </button>
  );

  const addTest = (name: string, code: string, price: number, category: string) => {
    setSelectedTests((prev) => {
      if (prev.find((t) => t.code === code)) return prev;
      return [...prev, { id: Date.now(), name, code, price, category }];
    });
  };

  const addPackage = (pkg: string) => {
    setSelectedPackages((prev) => {
      if (prev.includes(pkg)) return prev;
      return [...prev, pkg];
    });
    advanceStep();
  };

  const PaymentModeBtn = ({ mode, label, icon: Icon }: { mode: string; label: string; icon: any }) => (
    <button
      onClick={() => setPaymentMode(mode)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition-colors border ${
        paymentMode === mode
          ? "bg-violet-600 text-white border-violet-600 shadow-sm"
          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-foreground" style={{ fontFamily: 'var(--app-font-sans), Inter, sans-serif' }}>
      {/* ── TOP BAR ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shadow-sm z-20">
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

      {/* ── STEP HEADER ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 z-10">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          {/* Stepper */}
          <div className="flex items-center">
            {STEPS.map((step, index) => {
              const isActive = currentStep === step.id;
              const isCompleted = stepCompleted.has(step.id);
              const isPast = currentStep > step.id;
              const canClick = isPast || isCompleted || isActive;
              const StepIcon = step.icon;
              return (
                <div key={step.id} className="flex items-center">
                  <button
                    onClick={() => canClick && goToStep(step.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                      isActive ? 'bg-violet-50 text-violet-700' : canClick ? 'hover:bg-gray-50 text-gray-600' : 'text-gray-300 cursor-not-allowed'
                    }`}
                    disabled={!canClick}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isActive ? 'bg-violet-600 text-white shadow-sm' : isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {isCompleted ? <Check size={14} /> : <StepIcon size={14} />}
                    </div>
                    <div className="text-left">
                      <div className={`text-[11px] font-bold leading-tight ${isActive ? 'text-violet-700' : 'text-gray-600'}`}>{step.title}</div>
                      <div className="text-[10px] text-gray-400 leading-tight">{step.subtitle}</div>
                    </div>
                  </button>
                  {index < STEPS.length - 1 && (
                    <div className={`w-6 h-px mx-1 transition-colors ${isCompleted ? 'bg-violet-400' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
          {/* Step summary + auto-advance toggle */}
          <div className="text-right flex items-center gap-3">
            {selectedPatient && (
              <span className="text-xs text-gray-500 truncate max-w-[150px]">{selectedPatient.firstName} {selectedPatient.lastName}</span>
            )}
            {selectedTests.length > 0 && (
              <span className="text-xs text-gray-500">{selectedTests.length} tests</span>
            )}
            <span className="text-sm font-bold text-violet-700">{inr(total)}</span>
            <button
              onClick={() => setAutoAdvance(!autoAdvance)}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${autoAdvance ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
              title="Auto-advance to next step on selection"
            >
              <Zap size={10} /> Auto-advance {autoAdvance ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div ref={contentRef} className="flex-1 flex flex-col items-center overflow-y-auto pb-40">
        <div className="w-full max-w-4xl p-6 space-y-8">

          {/* ═══════════════ STEP 1: PATIENT ═══════════════ */}
          {currentStep === 1 && (
            <div className="animate-in fade-in duration-300">
              <StepHeader step={1} title="Patient" subtitle="Search existing patient or register new" />

              {/* Search Patient */}
              <Card className="mb-4">
                <div className="h-1 bg-blue-500" />
                <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Search Patient</span>
                  </div>
                </div>
                <div className="p-4">
                  {selectedPatient ? (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                        {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-sm text-gray-900">{selectedPatient.firstName} {selectedPatient.lastName}</div>
                          <button className="text-xs text-gray-400 hover:text-gray-600"><X size={11} /> Change</button>
                        </div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5">{selectedPatient.patientId}</div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><Phone size={10} /> {selectedPatient.phone}</span>
                          <span className="capitalize">{selectedPatient.gender}</span>
                          <span>{selectedPatient.ageValue} Yrs</span>
                          <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-bold">{selectedPatient.bloodGroup}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search by name, ID or phone" />
                    </div>
                  )}
                </div>
              </Card>

              {/* Register New */}
              {!selectedPatient && (
                <Card>
                  <div className="h-1 bg-violet-500" />
                  <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50">
                    <UserPlus size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Register New</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">First Name *</label>
                        <input className="w-full h-9 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="First name" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Last Name *</label>
                        <input className="w-full h-9 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Last name" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Phone *</label>
                        <input className="w-full h-9 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="10-digit" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Age *</label>
                        <div className="flex gap-1 mt-0.5">
                          <input className="flex-1 h-9 text-sm border border-gray-200 rounded-md px-2 bg-gray-50" placeholder="Value" />
                          <select className="h-9 text-xs border border-gray-200 rounded-md px-1 w-16 bg-gray-50">
                            <option>Yrs</option><option>Mo</option><option>Days</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Gender *</label>
                        <select className="w-full h-9 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50">
                          <option>male</option><option>female</option><option>other</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedPatient({ firstName: "Ramesh", lastName: "Kumar", patientId: "CD-240615", gender: "male", phone: "+91 98765 43210", bloodGroup: "O+", dateOfBirth: "1985-03-12", ageValue: 41, ageUnit: "years" });
                        advanceStep();
                      }}
                      className="w-full h-9 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <UserPlus size={12} /> Register & Select
                    </button>
                  </div>
                </Card>
              )}

              {/* Duplicate Bill Warning */}
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px]">
                <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-amber-800">Bill already exists today</span>
                  <span className="text-amber-700"> — 2026050015 was created at 10:45. Are you sure you want to create another?</span>
                </div>
              </div>

              {/* DICOM MWL */}
              {needsDicom && selectedPatient && (
                <Card className="mt-4">
                  <div className="h-1 bg-blue-400" />
                  <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-blue-50">
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">DICOM Worklist</span>
                    <span className="ml-auto text-[10px] text-green-600 font-bold"><CheckCircle2 size={10} /> Ready</span>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Study Description</label>
                      <input className="w-full h-8 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Brain MRI" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Body Part</label>
                      <input className="w-full h-8 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 font-mono" placeholder="BRAIN" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Station AE</label>
                      <input className="w-full h-8 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50 font-mono" placeholder="MRI_ROOM1" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Referring Doctor</label>
                      <input className="w-full h-8 text-xs border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Dr. Sharma" />
                    </div>
                  </div>
                </Card>
              )}

              {/* Form F */}
              {selectedPatient && !needsDicom && (
                <div className="mt-4 bg-orange-50 border border-orange-300 rounded-xl overflow-hidden">
                  <div className="h-10 px-4 flex items-center gap-2 border-b border-orange-200 bg-orange-100">
                    <AlertTriangle size={13} className="text-orange-700" />
                    <span className="text-[11px] font-bold text-orange-800">PCPNDT Form F Required</span>
                  </div>
                  <div className="p-4 space-y-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Husband's / Father's Name *</label>
                      <input className="w-full h-8 text-sm border border-orange-200 rounded-md px-2 mt-0.5 bg-white" placeholder="Required for compliance" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500">Full Address *</label>
                      <input className="w-full h-8 text-sm border border-orange-200 rounded-md px-2 mt-0.5 bg-white" placeholder="Patient's address" />
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-end mt-6">
                <button onClick={nextStep} className="h-10 px-6 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  Next: Doctor <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════ STEP 2: DOCTOR ═══════════════ */}
          {currentStep === 2 && (
            <div className="animate-in fade-in duration-300">
              <StepHeader step={2} title="Referring Doctor" subtitle="Select doctor or walk-in" />

              <Card>
                <div className="h-1 bg-teal-500" />
                <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Stethoscope size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Doctor</span>
                  </div>
                  <div className="flex gap-1">
                    <button className={`h-6 px-2.5 text-[10px] font-bold rounded-md transition-colors ${doctorMode === "doctor" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>Doctor</button>
                    <button className={`h-6 px-2.5 text-[10px] font-bold rounded-md transition-colors ${doctorMode === "self" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>Self</button>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {/* Quick Doctor Slots */}
                  <div className="flex items-center gap-2 text-[10px] font-bold text-teal-700 mb-1">
                    <Zap size={11} /> Quick Doctor Slots
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {["Dr. Sharma", "Dr. Mishra", "Dr. Patel", "Dr. Kumar", null, null].map((doc, i) => (
                      <div key={i} className="relative group flex-shrink-0">
                        <button className={`h-7 rounded-full border text-[10px] font-bold px-3 flex items-center gap-1 transition-colors whitespace-nowrap ${
                          doc ? "border-teal-200 bg-teal-50 text-teal-700" : "border-dashed border-gray-200 bg-gray-50 text-gray-400"
                        }`}>
                          {doc ? doc : <><Plus size={10} />Dr {i + 1}</>}
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Search */}
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search doctor by name or code" />
                  </div>
                  {/* Doctor Cards */}
                  <div className="flex gap-2">
                    <div className="flex-1 p-3 border border-teal-200 rounded-md bg-teal-50/30 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold">PS</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-900">{doctorName}</div>
                        <div className="text-xs text-gray-500">{doctorSpecialty} · {doctorBills} bills</div>
                      </div>
                      <CheckCircle2 size={14} className="text-teal-600" />
                    </div>
                    <div
                      onClick={() => {
                        setDoctorName("Dr. Amit Mishra");
                        setDoctorSpecialty("Orthopedics");
                        setDoctorBills(89);
                        advanceStep();
                      }}
                      className="flex-1 p-3 border border-gray-200 rounded-md flex items-center gap-2 hover:bg-gray-50 cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-bold">AM</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-900">Dr. Amit Mishra</div>
                        <div className="text-xs text-gray-500">Orthopedics · 89 bills</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Navigation */}
              <div className="flex justify-between mt-6">
                <button onClick={prevStep} className="h-10 px-4 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={nextStep} className="h-10 px-6 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  Next: Tests <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════ STEP 3: TESTS ═══════════════ */}
          {currentStep === 3 && (
            <div className="animate-in fade-in duration-300">
              <StepHeader step={3} title="Tests & Packages" subtitle={`${selectedTests.length} tests selected · ${inr(subtotal)}`} />

              {/* Quick Test Tabs */}
              <Card className="mb-4">
                <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50">
                  <Zap size={14} className="text-violet-500" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Quick Tests</span>
                  <span className="text-[10px] text-gray-400">Hover ✏️ to customize</span>
                </div>
                <div className="p-4">
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {["CBC", "LFT", "KFT", "Sugar", "Thyroid", "Lipid"].map((t, i) => {
                      const added = i < 2;
                      return (
                        <div key={i} className="relative group flex-shrink-0">
                          <button className={`min-w-[108px] max-w-[130px] rounded-md border text-[10px] leading-tight px-2 py-1.5 flex flex-col items-start transition-all shadow-sm ${
                            added ? "border-primary/40 bg-primary/10 text-primary cursor-default" : "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700"
                          }`}>
                            <span className="font-bold w-full truncate">{t}</span>
                            <span className="text-[9px] opacity-70 w-full truncate mt-0.5">Pathology · ₹{i * 100 + 450}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* Test Search */}
              <Card className="mb-4">
                <div className="h-1 bg-violet-500" />
                <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Add Tests</span>
                    <span className="text-[11px] text-gray-400 font-medium">{selectedTests.length} selected · {inr(subtotal)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="h-6 px-2 text-[10px] font-bold bg-violet-100 text-violet-700 rounded-md flex items-center gap-1" onClick={() => setQuickAddOpen(!quickAddOpen)}>
                      <Zap size={10} /> Quick Add <ChevronDown size={12} className={`transition-transform ${quickAddOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {/* Quick Add Buttons */}
                  {quickAddOpen && (
                    <div className="flex flex-wrap gap-1.5 p-2 bg-emerald-50/50 rounded-md border border-emerald-100">
                      <span className="text-[10px] font-bold text-emerald-700 uppercase w-full mb-1">Quick Add</span>
                      {(
                        [
                          ["CBC", "CBC", 450, "Pathology"] as const,
                          ["LFT", "LFT", 1200, "Pathology"] as const,
                          ["KFT", "KFT", 800, "Pathology"] as const,
                          ["Sugar", "SUG", 350, "Pathology"] as const,
                          ["Thyroid", "THY", 1800, "Pathology"] as const,
                          ["Lipid", "LIPID", 1200, "Pathology"] as const,
                          ["Urine R/E", "URINE", 300, "Pathology"] as const,
                          ["X-ray Chest", "XR-CHEST", 800, "Radiology"] as const,
                          ["USG Abdomen", "USG-ABD", 1500, "Radiology"] as const,
                          ["ECG", "ECG", 400, "Cardiology"] as const,
                        ] as [string, string, number, string][]
                      ).map(([name, code, price, category]) => (
                        <QuickAddButton key={name} label={name} onClick={() => addTest(name, code, price, category)} />
                      ))}
                    </div>
                  )}
                  {/* Search */}
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search tests by name or code" value={testSearch} onChange={(e) => setTestSearch(e.target.value)} />
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
                    {/* Unselected */}
                    <div onClick={() => addTest("Liver Function Test", "LFT", 1200, "Pathology")} className="flex items-center p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-4 h-4 rounded border border-gray-300" />
                        <span className="text-sm text-gray-600">Liver Function Test</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">LFT</span>
                      </div>
                      <span className="text-sm font-bold text-gray-400">₹1,200</span>
                      <Plus size={14} className="text-gray-400 ml-2" />
                    </div>
                    <div onClick={() => addTest("Thyroid Profile", "THY", 1800, "Pathology")} className="flex items-center p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-4 h-4 rounded border border-gray-300" />
                        <span className="text-sm text-gray-600">Thyroid Profile</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">THY</span>
                      </div>
                      <span className="text-sm font-bold text-gray-400">₹1,800</span>
                      <Plus size={14} className="text-gray-400 ml-2" />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Packages — same step */}
              <Card className="mb-4">
                <div className="h-1 bg-rose-500" />
                <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Packages</span>
                  </div>
                  <button className="text-[11px] text-gray-400 hover:text-gray-600">Manage</button>
                </div>
                <div className="p-4 space-y-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="w-full h-9 pl-9 pr-3 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:border-violet-400" placeholder="Search packages by name, code, or test" value={packageSearch} onChange={(e) => setPackageSearch(e.target.value)} />
                  </div>
                  <div className="flex gap-2 flex-wrap pt-1">
                    {["Basic Health Check", "Complete Wellness", "Diabetes Panel", "Cardiac Profile", "Women's Health"].map((pkg, i) => {
                      const added = selectedPackages.includes(pkg);
                      return (
                        <button
                          key={i}
                          onClick={() => !added && addPackage(pkg)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-colors shadow-sm ${
                            added ? "border-primary/40 bg-primary/10 text-primary cursor-default" : "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700"
                          }`}
                        >
                          <Package size={10} />
                          <span>{pkg}</span>
                          <span className="opacity-60 text-[10px]">{5 + i} tests</span>
                          <span className="font-bold">₹{(i + 1) * 1000}</span>
                          {added ? <CheckCircle2 size={11} /> : <Plus size={11} />}
                        </button>
                      );
                    })}
                  </div>
                  {selectedPackages.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Selected Packages</div>
                      {selectedPackages.map((pkg, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-gray-900">{pkg}</div>
                            <div className="text-xs text-gray-500">5 tests included</div>
                          </div>
                          <button className="text-gray-400 hover:text-red-500 transition-colors"><X size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* Navigation */}
              <div className="flex justify-between mt-6">
                <button onClick={prevStep} className="h-10 px-4 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={nextStep} className="h-10 px-6 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  Next: Summary <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════ STEP 4: SUMMARY ═══════════════ */}
          {currentStep === 4 && (
            <div className="animate-in fade-in duration-300">
              <StepHeader step={4} title="Bill Summary" subtitle="Review and collect payment" />

              {/* Selected Tests Summary */}
              <Card className="mb-4">
                <div className="h-1 bg-violet-500" />
                <div className="h-10 px-4 flex items-center justify-between border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <FlaskConical size={14} className="text-gray-500" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Selected Tests</span>
                    <span className="text-[11px] text-gray-400 font-medium">({selectedTests.length})</span>
                  </div>
                  <button className="text-xs text-gray-400 hover:text-gray-600">Clear All</button>
                </div>
                <div className="p-4 space-y-1.5">
                  {selectedTests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <span className="truncate text-gray-700">{t.name}</span>
                      <span className="font-bold text-gray-900">₹{t.price.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between text-sm font-bold">
                    <span className="text-gray-500">Total</span>
                    <span className="text-gray-900">₹{subtotal.toLocaleString()}</span>
                  </div>
                </div>
              </Card>

              {/* Bill Summary */}
              <Card className="mb-4">
                <div className="h-1 bg-violet-500" />
                <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50">
                  <Receipt size={14} className="text-gray-500" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Bill Summary</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-bold text-gray-900">₹{subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Discount</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                        <button className={`px-2 py-1 text-xs flex items-center gap-0.5 ${discountType === "amount" ? "bg-violet-600 text-white" : "hover:bg-gray-50"}`}><IndianRupee size={10} /> ₹</button>
                        <button className={`px-2 py-1 text-xs flex items-center gap-0.5 ${discountType === "pct" ? "bg-violet-600 text-white" : "hover:bg-gray-50"}`}><Percent size={10} /> %</button>
                      </div>
                      <input className="w-14 h-7 text-xs border border-gray-200 rounded-md text-right px-2 bg-gray-50" value={discountValue} />
                      <span className="font-bold text-emerald-600">−₹{discount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                    <span className="font-bold text-base text-gray-900">Total</span>
                    <span className="font-bold text-2xl text-violet-700">₹{total.toLocaleString()}</span>
                  </div>
                </div>
              </Card>

              {/* Payment */}
              <Card className="mb-4">
                <div className="h-1 bg-violet-500" />
                <div className="h-10 px-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50">
                  <IndianRupee size={14} className="text-gray-500" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">Collect Payment</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPayNow(!payNow)} className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${payNow ? "bg-violet-600" : "bg-gray-300"}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${payNow ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-sm font-bold text-gray-700">Collect Payment Now</span>
                  </div>
                  {payNow && (
                    <>
                      <div className="flex gap-2 flex-wrap">
                        <PaymentModeBtn mode="cash" label="Cash" icon={Banknote} />
                        <PaymentModeBtn mode="card" label="Card" icon={CreditCard} />
                        <PaymentModeBtn mode="upi" label="UPI" icon={Wallet} />
                        <PaymentModeBtn mode="cheque" label="Cheque" icon={Landmark} />
                        <PaymentModeBtn mode="insurance" label="Insurance" icon={Building2} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-500">₹</span>
                        <input className="flex-1 h-10 text-lg font-bold border border-gray-200 rounded-md px-3 bg-gray-50 text-gray-900" value={total.toLocaleString()} />
                        <span className="text-xs text-emerald-600 font-bold whitespace-nowrap">Paid in full</span>
                      </div>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Notes</label>
                      <input className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 mt-0.5 bg-gray-50" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Referral</label>
                      <div className="flex gap-1 mt-0.5">
                        <input className="flex-1 h-8 text-sm border border-gray-200 rounded-md px-2 bg-gray-50" placeholder="Code" value={referralCode} onChange={(e) => setReferralCode(e.target.value)} />
                        <button className="h-8 px-2.5 bg-gray-100 hover:bg-gray-200 rounded-md text-[10px] font-bold text-gray-600 transition-colors">Apply</button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Navigation */}
              <div className="flex justify-between mt-6">
                <button onClick={prevStep} className="h-10 px-4 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  <ChevronLeft size={16} /> Back
                </button>
                <button className="h-10 px-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
                  <Check size={16} /> Complete Bill
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── FIXED BOTTOM ACTION BAR ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-30 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          {/* Left: Summary */}
          <div className="flex items-center gap-4 flex-1">
            <div className="flex items-center gap-2">
              <FlaskConical size={16} className="text-gray-500" />
              <span className="text-sm font-bold text-gray-900">{selectedTests.length}</span>
              <span className="text-xs text-gray-500">tests</span>
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-gray-500">Total</span>
              <span className="text-xl font-bold text-violet-700">₹{total.toLocaleString()}</span>
              {discount > 0 && (
                <span className="text-xs text-emerald-600 font-bold">Saved ₹{discount.toLocaleString()}</span>
              )}
            </div>
          </div>

          {/* Center: Payment Mode */}
          {payNow && (
            <div className="hidden md:flex items-center gap-1">
              {paymentMode === "cash" && <Banknote size={14} className="text-gray-400" />}
              {paymentMode === "card" && <CreditCard size={14} className="text-gray-400" />}
              {paymentMode === "upi" && <Wallet size={14} className="text-gray-400" />}
              {paymentMode === "cheque" && <Landmark size={14} className="text-gray-400" />}
              {paymentMode === "insurance" && <Building2 size={14} className="text-gray-400" />}
              <span className="text-xs text-gray-500 capitalize">{paymentMode}</span>
            </div>
          )}

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button className="h-10 px-4 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors">
              <Receipt size={14} /> Save Only
            </button>
            <button className="h-10 px-6 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-md">
              <Printer size={16} /> Save & Print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
