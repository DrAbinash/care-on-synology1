import React, { useState, useEffect, type ReactNode } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, User, Users as UsersIcon, LogOut, Phone, Mail, MapPin, Calendar,
  Receipt, FileText, ClipboardList, UserCog, ArrowLeft, ArrowRight, CheckCircle2,
  AlertCircle, Clock, ChevronRight, Loader2, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fetchApi, api } from "@/lib/fetchApi";
import { writeStaffSession, firstPermissionedPath, firstAllowedPath, canAccess, normalizeRole, type StaffSession as ErpStaffSession } from "@/lib/staffSession";

// =====================================================================
// Types
// =====================================================================

type PortalSettings = {
  enabled: boolean;
  fido2Enabled?: boolean;
  heading: string;
  welcomeMessage: string;
  centerName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  backgroundImageDataUrl: string | null;
  allowAppointmentBooking: boolean;
  allowProfileEdit: boolean;
};

type PatientSession = {
  token: string;
  patient: {
    id: number;
    patientId: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    photoDataUrl: string | null;
  };
};

type StaffSession = {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
    username?: string | null;
    role: string;
    permissions: string[];
    maxDiscount: number | null;
    photoDataUrl?: string | null;
    sidebarTheme?: string | null;
    defaultStartPage?: string | null;
    mustChangePin?: boolean;
  };
};

// Same order the sidebar uses — the user lands on the first one they have
// permission to view.
const ERP_NAV_ORDER = [
  "/", "/dashboard", "/patients", "/appointments", "/queue", "/orders",
  "/tests", "/packages", "/billing", "/payments", "/reports",
  "/report-generator", "/inventory", "/expenses", "/staff", "/referrals",
  "/accounting", "/discounts", "/form-f", "/pacs", "/settings", "/teleradiology",
];

type Patient = {
  id: number;
  patientId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string | null;
  address: string | null;
  bloodGroup: string | null;
  photoDataUrl: string | null;
};

type Bill = {
  id: number;
  billNumber: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  status: string;
  createdAt: string;
  payments: Array<{ id: number; amount: string; method: string; createdAt: string }>;
};

type Report = {
  orderId: number;
  orderNumber: string;
  orderDate: string;
  testId: number;
  testName: string | null;
  result: string;
  resultStatus: string | null;
};

type Visit = {
  id: number;
  orderNumber: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  tests: Array<{
    id: number;
    testId: number;
    testName: string | null;
    price: string;
    result: string | null;
    resultStatus: string | null;
  }>;
};

type Appointment = {
  id: number;
  appointmentId: string;
  appointmentDate: string;
  timeSlot: string;
  status: string;
  type: string;
  notes: string | null;
  doctor: { id: number; name: string } | null;
};

type Doctor = { id: number; name: string; specialization: string };

// =====================================================================
// Session helpers (localStorage)
// =====================================================================

const PATIENT_KEY = "portal_patient_session";
const STAFF_KEY = "portal_staff_session";

function readPatientSession(): PatientSession | null {
  try { const raw = localStorage.getItem(PATIENT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function readStaffSession(): StaffSession | null {
  try { const raw = localStorage.getItem(STAFF_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function authedFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  return fetchApi<T>(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

// =====================================================================
// Top-level router
// =====================================================================

export default function PortalRoot() {
  // Shared with the per-screen useQuery calls below (same queryKey), so this
  // doesn't add an extra network round trip — it just lets the background
  // image apply consistently behind the landing, login and dashboard screens.
  const { data: settings } = useQuery<PortalSettings>({
    queryKey: ["portal-settings"],
    queryFn: () => api.get("/api/portal/settings"),
  });
  const bgImage = settings?.backgroundImageDataUrl;

  return (
    <div
      className={`min-h-screen ${bgImage ? "bg-slate-900 bg-cover bg-center bg-fixed" : "bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950"}`}
      style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
    >
      <Switch>
        <Route path="/portal" component={PortalLanding} />
        <Route path="/portal/patient-login" component={PatientLogin} />
        <Route path="/portal/staff-login" component={StaffLogin} />
        <Route path="/portal/patient" component={PatientDashboard} />
        {/* Routing fix (July 2026): /erp/login (base-stripped to /login here)
            goes straight to the staff login form, matching the required
            public routing contract — see App.tsx for the outer alias. */}
        <Route path="/login" component={StaffLogin} />

        <Route path="/erp/portal" component={PortalLanding} />
        <Route path="/erp/portal/patient-login" component={PatientLogin} />
        <Route path="/erp/portal/staff-login" component={StaffLogin} />
        <Route path="/erp/portal/patient" component={PatientDashboard} />
        <Route path="/erp/login" component={StaffLogin} />

        <Route component={PortalLanding} />
      </Switch>
    </div>
  );
}

// =====================================================================
// Shared: Header
// =====================================================================

function PortalHeader({ settings, right }: { settings: PortalSettings | undefined; right?: ReactNode }) {
  return (
    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        {settings?.logoDataUrl ? (
          <img src={settings.logoDataUrl} alt="Logo" className="h-10 w-10 rounded-lg object-contain bg-white" />
        ) : (
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Activity className="text-white" size={22} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base truncate">{settings?.heading || settings?.centerName || "Patient Portal"}</p>
          <p className="text-xs text-muted-foreground truncate">{settings?.tagline}</p>
        </div>
        {right}
      </div>
    </div>
  );
}

// =====================================================================
// Landing
// =====================================================================

function PortalLanding() {
  const [, navigate] = useLocation();
  const { data: settings, isLoading } = useQuery<PortalSettings>({
    queryKey: ["portal-settings"],
    queryFn: () => api.get("/api/portal/settings"),
  });

  // Auto-redirect if already logged in as patient
  useEffect(() => {
    if (readPatientSession()) navigate(window.location.pathname.startsWith("/erp") ? "/erp/portal/patient" : "/portal/patient");
  }, [navigate]);

  if (isLoading) return <CenteredSpinner />;

  if (!settings?.enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border rounded-2xl p-8 max-w-md text-center shadow-lg">
          <AlertCircle size={48} className="mx-auto text-amber-500 mb-3" />
          <h1 className="text-xl font-bold mb-2">Portal Not Available</h1>
          <p className="text-muted-foreground text-sm">
            The patient portal is currently disabled. Please contact reception for assistance.
          </p>
          <div className="mt-5 flex gap-2 justify-center">
            <Button asChild>
              <Link to={window.location.pathname.startsWith("/erp") ? "/erp/portal/patient-login" : "/portal/patient-login"}>Patient Login</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={window.location.pathname.startsWith("/erp") ? "/erp/portal/staff-login" : "/portal/staff-login"}>Staff Login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Per-section heading: clinic identity should dominate the page —
  // bigger logo + name than the two action cards. The compact PortalHeader
  // (sticky strip at top) is reused on the inner login screens but the
  // landing page now leads with a hero block.
  const clinicName = settings.heading || settings.centerName || "Patient Portal";
  const pathPrefix = window.location.pathname.startsWith("/erp") ? "/erp" : "";

  return (
    <>
      <PortalHeader settings={settings} />
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Hero — much larger logo + clinic name than the action tabs below */}
        <div className="flex flex-col items-center text-center mb-12">
          {settings.logoDataUrl ? (
            <img
              src={settings.logoDataUrl}
              alt={clinicName}
              className="h-28 w-28 md:h-36 md:w-36 rounded-2xl object-contain bg-white border border-slate-200 dark:border-slate-800 shadow-sm mb-6"
            />
          ) : (
            <div className="h-28 w-28 md:h-36 md:w-36 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 shadow-sm">
              <Activity className="text-white" size={64} />
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-3">{clinicName}</h1>
          {settings.tagline && (
            <p className="text-lg md:text-xl text-muted-foreground font-medium mb-4">{settings.tagline}</p>
          )}
          <p className="text-muted-foreground text-base max-w-2xl mx-auto leading-relaxed">
            {settings.welcomeMessage || "Access your reports, bills and appointments online — anytime, anywhere."}
          </p>
        </div>

        {/* Action tabs — intentionally smaller than the hero above */}
        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => navigate(`${pathPrefix}/portal/patient-login`)}
            className="group bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl p-6 text-left shadow-sm hover:shadow-xl transition-all"
          >
            <div className="h-11 w-11 rounded-xl bg-blue-100 dark:bg-blue-950 group-hover:bg-blue-500 flex items-center justify-center mb-3 transition-colors">
              <User size={22} className="text-blue-600 dark:text-blue-400 group-hover:text-white transition-colors" />
            </div>
            <h2 className="text-xl font-bold mb-1.5">Patient Login</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-3">
              View your bills, lab reports, visit history, and book new appointments.
            </p>
            <span className="inline-flex items-center text-blue-600 dark:text-blue-400 font-semibold text-sm">
              Login with Mobile Number <ChevronRight size={16} className="ml-1" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`${pathPrefix}/portal/staff-login`)}
            className="group bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-2xl p-6 text-left shadow-sm hover:shadow-xl transition-all"
          >
            <div className="h-11 w-11 rounded-xl bg-indigo-100 dark:bg-indigo-950 group-hover:bg-indigo-500 flex items-center justify-center mb-3 transition-colors">
              <UsersIcon size={22} className="text-indigo-600 dark:text-indigo-400 group-hover:text-white transition-colors" />
            </div>
            <h2 className="text-xl font-bold mb-1.5">Staff Login</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-3">
              Sign in with your username and PIN to access the diagnostic center system.
            </p>
            <span className="inline-flex items-center text-indigo-600 dark:text-indigo-400 font-semibold text-sm">
              Sign in <ChevronRight size={16} className="ml-1" />
            </span>
          </button>
        </div>

        {(settings.phone || settings.address) && (
          <div className="mt-12 max-w-3xl mx-auto bg-white/60 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <p className="text-xs uppercase font-semibold text-muted-foreground mb-3">Need Help?</p>
            {/* Address gets its own row + can wrap to multiple lines.
                Phone/email stay on a compact row so the long address
                doesn't get truncated to a single ellipsised line. */}
            <div className="space-y-3 text-sm">
              {(settings.phone || settings.email) && (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {settings.phone && (
                    <a href={`tel:${settings.phone}`} className="flex items-center gap-2 hover:text-blue-600">
                      <Phone size={14} className="text-blue-500 shrink-0" /> <span>{settings.phone}</span>
                    </a>
                  )}
                  {settings.email && (
                    <a href={`mailto:${settings.email}`} className="flex items-center gap-2 hover:text-blue-600 break-all">
                      <Mail size={14} className="text-blue-500 shrink-0" /> <span>{settings.email}</span>
                    </a>
                  )}
                </div>
              )}
              {settings.address && (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-blue-500 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-line leading-relaxed">{settings.address}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
// Patient Login
// =====================================================================

function PatientLogin() {
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [error, setError] = useState("");
  const { data: settings } = useQuery<PortalSettings>({
    queryKey: ["portal-settings"],
    queryFn: () => api.get("/api/portal/settings"),
  });

  const isErp = window.location.pathname.startsWith("/erp");

  const login = useMutation({
    mutationFn: (body: { phone: string; dateOfBirth: string }) =>
      api.post<PatientSession>("/api/portal/patient-login", body),
    onSuccess: (s) => {
      localStorage.setItem(PATIENT_KEY, JSON.stringify(s));
      navigate(isErp ? "/erp/portal/patient" : "/portal/patient");
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = phone.trim().length > 0 && dob.trim().length > 0;

  return (
    <>
      <PortalHeader
        settings={settings}
        right={
          <Link href={isErp ? "/erp/portal" : "/portal"} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Back
          </Link>
        }
      />
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white dark:bg-slate-900 border rounded-2xl p-8 shadow-lg">
          <div className="h-14 w-14 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center mb-4 mx-auto">
            <User size={28} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Patient Login</h1>
          <p className="text-muted-foreground text-sm text-center mb-6">
            Enter your registered mobile number and date of birth to access your records.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              login.mutate({ phone: phone.trim(), dateOfBirth: dob.trim() });
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="phone">Mobile Number</Label>
              <Input
                id="phone"
                inputMode="tel"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1.5 h-12 text-lg"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="dob">Date of Birth</Label>
              <Input
                id="dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="mt-1.5 h-12"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-base" disabled={login.isPending || !canSubmit}>
              {login.isPending ? <><Loader2 size={16} className="mr-2 animate-spin" /> Signing in…</> : <>Continue <ArrowRight size={16} className="ml-2" /></>}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Staff Login
// =====================================================================

function StaffLogin() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [webauthnError, setWebauthnError] = useState("");
  const [webauthnPending, setWebauthnPending] = useState(false);
  // When the freshly-issued session has must_change_pin=true the server is
  // telling us the admin set this user's PIN — keep them out of the ERP
  // until they've picked their own. The session is held in component state
  // (NOT localStorage) until the change succeeds, so a tab close == logout.
  const [pendingSession, setPendingSession] = useState<StaffSession | null>(null);
  const { data: settings } = useQuery<PortalSettings>({
    queryKey: ["portal-settings"],
    queryFn: () => api.get("/api/portal/settings"),
  });
  const fido2Enabled = settings?.fido2Enabled ?? false;
  const webauthnSupported = typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;

  const finalizeSession = (s: StaffSession) => {
    const normalizedUser = { ...s.user, role: normalizeRole(s.user.role) };
    localStorage.setItem(STAFF_KEY, JSON.stringify({ ...s, user: normalizedUser }));
    const erp: ErpStaffSession = { token: s.token, user: normalizedUser };
    writeStaffSession(erp);
    let target = s.user.email.toLowerCase() === "abinashsingh@gmail.com" ? "/my-daily-summary" : "";
    if (!target) {
      if (s.user.defaultStartPage && canAccess(erp, s.user.defaultStartPage)) {
        target = s.user.defaultStartPage;
      } else {
        target = firstPermissionedPath(erp, ERP_NAV_ORDER) ?? firstAllowedPath(erp, ERP_NAV_ORDER);
      }
    }
    const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL || "/";
    window.location.href = `${base}${target}`.replace(/\/+/g, "/").replace(":/", "://");
  };

  const login = useMutation({
    mutationFn: (body: { username: string; pin: string }) => api.post<StaffSession>("/api/portal/staff-login", body),
    onSuccess: (s) => {
      if (s.user.mustChangePin) {
        setPendingSession(s);
        return;
      }
      finalizeSession(s);
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleWebAuthn = async () => {
    setWebauthnError("");
    setWebauthnPending(true);
    try {
      const opts = await api.post<{
        challenge: string;
        rpId: string;
        allowCredentials?: { id: string; type: string; transports?: string[] }[];
        userVerification?: string;
        timeout?: number;
      }>("/api/auth/webauthn/authenticate/begin", {});
      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToBufferWA(opts.challenge),
        rpId: opts.rpId,
        allowCredentials: (opts.allowCredentials || []).map((c) => ({
          id: base64UrlToBufferWA(c.id),
          type: c.type as PublicKeyCredentialType,
          transports: (c.transports ?? []) as AuthenticatorTransport[],
        })),
        userVerification: opts.userVerification as UserVerificationRequirement,
        timeout: opts.timeout,
      };
      const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Authentication cancelled");
      const response = credential.response as AuthenticatorAssertionResponse;
      const s = await api.post<StaffSession>("/api/auth/webauthn/authenticate/complete", {
        response: {
          id: credential.id,
          rawId: credential.id,
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
          response: {
            authenticatorData: bufferToBase64UrlWA(response.authenticatorData),
            clientDataJSON: bufferToBase64UrlWA(response.clientDataJSON),
            signature: bufferToBase64UrlWA(response.signature),
            userHandle: response.userHandle ? bufferToBase64UrlWA(response.userHandle) : undefined,
          },
        },
        expectedChallenge: opts.challenge,
      });
      if (s.user.mustChangePin) {
        setPendingSession(s);
        return;
      }
      finalizeSession(s);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Security key sign-in failed";
      setWebauthnError(msg);
    } finally {
      setWebauthnPending(false);
    }
  };

  if (pendingSession) {
    return (
      <ForceChangePin
        session={pendingSession}
        settings={settings}
        currentPin={pin}
        onSuccess={() => finalizeSession({ ...pendingSession, user: { ...pendingSession.user, mustChangePin: false } })}
        onCancel={() => { setPendingSession(null); setPin(""); }}
      />
    );
  }

  return (
    <>
      <PortalHeader
        settings={settings}
        right={
          <Link href={window.location.pathname.startsWith("/erp") ? "/erp/portal" : "/portal"} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Back
          </Link>
        }
      />
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white dark:bg-slate-900 border rounded-2xl p-8 shadow-lg">
          <div className="h-14 w-14 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center mb-4 mx-auto">
            <UsersIcon size={28} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Staff Login</h1>
          <p className="text-muted-foreground text-sm text-center mb-6">
            Sign in with your username and PIN.
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); setError(""); login.mutate({ username: username.trim().toLowerCase(), pin: pin.trim() }); }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                placeholder="your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1.5 h-12"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="mt-1.5 h-12 text-lg tracking-widest"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-base" disabled={login.isPending || !username.trim() || !pin.trim()}>
              {login.isPending ? <><Loader2 size={16} className="mr-2 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} className="ml-2" /></>}
            </Button>
          </form>

          {fido2Enabled && webauthnSupported && (
            <div className="mt-4">
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <Button
                variant="outline"
                className="w-full h-12 text-base"
                onClick={handleWebAuthn}
                disabled={webauthnPending}
              >
                {webauthnPending ? <><Loader2 size={16} className="mr-2 animate-spin" /> Verifying…</> : <><KeyRound size={16} className="mr-2" /> Sign in with Security Key</>}
              </Button>
              {webauthnError && (
                <p className="text-xs text-destructive text-center mt-2">{webauthnError}</p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-6">
            Forgot your PIN? Please contact your administrator.
          </p>
        </div>
      </div>
      {/* Version footer */}
      <VersionFooter />
    </>
  );
}

// Shown immediately after a successful login when the server reports
// mustChangePin=true. The current PIN is the one the user just typed on the
// login form (the parent passes it down) so they don't have to re-enter it.
function ForceChangePin({
  session,
  settings,
  currentPin,
  onSuccess,
  onCancel,
}: {
  session: StaffSession;
  settings: PortalSettings | undefined;
  currentPin: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");

  const change = useMutation({
    mutationFn: (body: { currentPin: string; newPin: string }) =>
      fetchApi("/api/portal/staff-change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(body),
      }),
    onSuccess: () => onSuccess(),
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPin.length < 6) { setError("New PIN must be at least 6 characters."); return; }
    if (newPin !== confirmPin) { setError("The two PINs don't match."); return; }
    if (newPin === currentPin) { setError("New PIN must be different from your current PIN."); return; }
    change.mutate({ currentPin, newPin });
  };

  return (
    <>
      <PortalHeader
        settings={settings}
        right={
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft size={14} /> Cancel
          </button>
        }
      />
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white dark:bg-slate-900 border rounded-2xl p-8 shadow-lg">
          <div className="h-14 w-14 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center mb-4 mx-auto">
            <AlertCircle size={28} className="text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Set a new PIN</h1>
          <p className="text-muted-foreground text-sm text-center mb-6">
            Hi {session.user.name.split(" ")[0]}, please choose a personal PIN before continuing.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="newPin">New PIN (at least 6 characters)</Label>
              <Input
                id="newPin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••••"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="mt-1.5 h-12 text-lg tracking-widest"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="confirmPin">Confirm new PIN</Label>
              <Input
                id="confirmPin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                placeholder="••••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                className="mt-1.5 h-12 text-lg tracking-widest"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-base" disabled={change.isPending || !newPin || !confirmPin}>
              {change.isPending ? <><Loader2 size={16} className="mr-2 animate-spin" /> Saving…</> : <>Set new PIN <ArrowRight size={16} className="ml-2" /></>}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// Patient Dashboard
// =====================================================================

type Tab = "bills" | "reports" | "appointments" | "visits" | "profile";

function PatientDashboard() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("bills");
  const session = readPatientSession();

  useEffect(() => {
    if (!session) navigate("/portal/patient-login");
  }, [session, navigate]);

  const { data: settings } = useQuery<PortalSettings>({
    queryKey: ["portal-settings"],
    queryFn: () => api.get("/api/portal/settings"),
  });

  if (!session) return <CenteredSpinner />;

  const logout = async () => {
    try { await authedFetch(session.token, "/api/portal/logout", { method: "POST" }); } catch { /* ignore */ }
    localStorage.removeItem(PATIENT_KEY);
    navigate("/portal");
  };

  const tabs: Array<{ id: Tab; label: string; icon: typeof Receipt }> = [
    { id: "bills", label: "Bills", icon: Receipt },
    { id: "reports", label: "Reports", icon: FileText },
    { id: "appointments", label: "Appointments", icon: Calendar },
    { id: "visits", label: "Visit History", icon: ClipboardList },
    { id: "profile", label: "My Profile", icon: UserCog },
  ];

  return (
    <>
      <PortalHeader
        settings={settings}
        right={
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold leading-tight">{session.patient.firstName} {session.patient.lastName}</p>
              <p className="text-xs text-muted-foreground leading-tight">{session.patient.patientId}</p>
            </div>
            {session.patient.photoDataUrl ? (
              <img src={session.patient.photoDataUrl} alt="You" className="h-9 w-9 rounded-full object-cover border-2 border-blue-300" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                <User size={16} className="text-blue-600" />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={logout} title="Logout"><LogOut size={16} /></Button>
          </div>
        }
      />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-slate-900 border rounded-xl p-2 mb-4 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active ? "bg-blue-500 text-white shadow" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon size={15} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === "bills" && <BillsPanel token={session.token} />}
        {tab === "reports" && <ReportsPanel token={session.token} />}
        {tab === "appointments" && <AppointmentsPanel token={session.token} canBook={!!settings?.allowAppointmentBooking} />}
        {tab === "visits" && <VisitsPanel token={session.token} />}
        {tab === "profile" && <ProfilePanel token={session.token} canEdit={!!settings?.allowProfileEdit} />}
      </div>
    </>
  );
}

// =====================================================================
// Panels
// =====================================================================

function PanelCard({ children, title, action }: { children: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Receipt; title: string; hint?: string }) {
  return (
    <div className="text-center py-10">
      <Icon size={40} className="mx-auto text-muted-foreground/40 mb-3" />
      <p className="font-medium text-sm">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function BillsPanel({ token }: { token: string }) {
  const { data, isLoading } = useQuery<Bill[]>({
    queryKey: ["portal-bills"],
    queryFn: () => authedFetch<Bill[]>(token, "/api/portal/me/bills"),
  });
  if (isLoading) return <CenteredSpinner />;
  return (
    <PanelCard title="My Bills">
      {!data?.length ? (
        <EmptyState icon={Receipt} title="No bills yet" hint="Once a bill is generated it will appear here." />
      ) : (
        <div className="space-y-3">
          {data.map((b) => {
            const paid = Number(b.paidAmount);
            const total = Number(b.totalAmount);
            const balance = Number(b.balanceAmount);
            const fullyPaid = balance <= 0;
            return (
              <div key={b.id} className="border rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="font-bold">{b.billNumber}</p>
                    <p className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    fullyPaid ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                    : balance < total ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                  }`}>
                    {fullyPaid ? "Paid" : balance < total ? "Partial" : "Unpaid"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">₹{total.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold text-green-600">₹{paid.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Balance</p><p className="font-semibold text-red-600">₹{balance.toFixed(2)}</p></div>
                </div>
                {b.payments.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{b.payments.length} payment{b.payments.length > 1 ? "s" : ""}</summary>
                    <div className="mt-2 space-y-1 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                      {b.payments.map((p) => (
                        <div key={p.id} className="flex justify-between">
                          <span>{p.method} • {new Date(p.createdAt).toLocaleDateString()}</span>
                          <span className="font-medium">₹{Number(p.amount).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

function ReportsPanel({ token }: { token: string }) {
  const { data, isLoading } = useQuery<Report[]>({
    queryKey: ["portal-reports"],
    queryFn: () => authedFetch<Report[]>(token, "/api/portal/me/reports"),
  });
  if (isLoading) return <CenteredSpinner />;
  return (
    <PanelCard title="My Reports">
      {!data?.length ? (
        <EmptyState icon={FileText} title="No reports available yet" hint="Lab results will appear here as they are completed." />
      ) : (
        <div className="space-y-3">
          {data.map((r, i) => (
            <div key={`${r.orderId}-${r.testId}-${i}`} className="border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-bold">{r.testName || `Test #${r.testId}`}</p>
                  <p className="text-xs text-muted-foreground">{r.orderNumber} • {new Date(r.orderDate).toLocaleDateString()}</p>
                </div>
                {r.resultStatus && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    r.resultStatus.toLowerCase().includes("normal")
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                  }`}>{r.resultStatus}</span>
                )}
              </div>
              <pre className="text-sm bg-slate-50 dark:bg-slate-800/50 rounded p-3 whitespace-pre-wrap font-sans border border-slate-200 dark:border-slate-700">
                {r.result}
              </pre>
              <div className="mt-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => downloadText(`${r.testName || "report"}-${r.orderNumber}.txt`, r.result)}>
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function VisitsPanel({ token }: { token: string }) {
  const { data, isLoading } = useQuery<Visit[]>({
    queryKey: ["portal-visits"],
    queryFn: () => authedFetch<Visit[]>(token, "/api/portal/me/visits"),
  });
  if (isLoading) return <CenteredSpinner />;
  return (
    <PanelCard title="Visit History">
      {!data?.length ? (
        <EmptyState icon={ClipboardList} title="No visits recorded yet" />
      ) : (
        <div className="space-y-3">
          {data.map((v) => (
            <div key={v.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-bold">{v.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()} • {v.tests.length} test{v.tests.length !== 1 ? "s" : ""}</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 capitalize">{v.status}</span>
              </div>
              <div className="space-y-1 text-sm">
                {v.tests.map((t) => (
                  <div key={t.id} className="flex justify-between border-t pt-1.5 first:border-t-0 first:pt-0">
                    <span>{t.testName || `Test #${t.testId}`}</span>
                    <span className="text-muted-foreground">₹{Number(t.price).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 mt-2 font-semibold">
                  <span>Total</span><span>₹{Number(v.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function AppointmentsPanel({ token, canBook }: { token: string; canBook: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [doctorId, setDoctorId] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery<Appointment[]>({
    queryKey: ["portal-appointments"],
    queryFn: () => authedFetch<Appointment[]>(token, "/api/portal/me/appointments"),
  });
  const { data: doctors } = useQuery<Doctor[]>({
    queryKey: ["portal-doctors"],
    queryFn: () => api.get<Doctor[]>("/api/portal/doctors"),
    enabled: showForm,
  });

  const book = useMutation({
    mutationFn: (body: { appointmentDate: string; timeSlot: string; doctorId: number | null; notes: string | null }) =>
      authedFetch(token, "/api/portal/me/appointments", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-appointments"] });
      setShowForm(false);
      setDate(""); setSlot(""); setDoctorId("none"); setNotes(""); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const slots = ["09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM"];
  const today = new Date().toISOString().slice(0, 10);

  if (isLoading) return <CenteredSpinner />;
  return (
    <PanelCard
      title="My Appointments"
      action={canBook && !showForm ? (
        <Button size="sm" onClick={() => setShowForm(true)}><Calendar size={14} className="mr-2" /> Book new</Button>
      ) : null}
    >
      {showForm && canBook && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-4 mb-4 space-y-3">
          <h3 className="font-semibold">Book a new appointment</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Time slot</Label>
              <Select value={slot} onValueChange={setSlot}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a time" /></SelectTrigger>
                <SelectContent>{slots.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Doctor (optional)</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Any available doctor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any available doctor</SelectItem>
                  {doctors?.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}{d.specialization ? ` — ${d.specialization}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Notes (optional)</Label>
              <Input placeholder="Reason for visit, symptoms, etc." value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
            </div>
          </div>
          {error && <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => { setShowForm(false); setError(""); }}>Cancel</Button>
            <Button
              disabled={!date || !slot || book.isPending}
              onClick={() => { setError(""); book.mutate({ appointmentDate: date, timeSlot: slot, doctorId: doctorId === "none" ? null : Number(doctorId), notes: notes.trim() || null }); }}
            >
              {book.isPending ? "Booking…" : "Book Appointment"}
            </Button>
          </div>
        </div>
      )}

      {!data?.length ? (
        <EmptyState icon={Calendar} title="No appointments scheduled" hint={canBook ? "Click 'Book new' to schedule one." : undefined} />
      ) : (
        <div className="space-y-3">
          {data.map((a) => {
            const isPast = new Date(a.appointmentDate + "T23:59:59").getTime() < Date.now();
            return (
              <div key={a.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{new Date(a.appointmentDate).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5"><Clock size={12} /> {a.timeSlot}</p>
                    {a.doctor && <p className="text-sm mt-1">with <span className="font-medium">{a.doctor.name}</span></p>}
                    {a.notes && <p className="text-xs text-muted-foreground mt-1.5 italic">"{a.notes}"</p>}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                    a.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                    : a.status === "cancelled" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                    : isPast ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                  }`}>{a.status}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">{a.appointmentId}</p>
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

function ProfilePanel({ token, canEdit }: { token: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Patient>({
    queryKey: ["portal-me"],
    queryFn: () => authedFetch<Patient>(token, "/api/portal/me"),
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Patient>>({});
  const [error, setError] = useState("");

  useEffect(() => { if (data && !editing) setForm({}); }, [data, editing]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => authedFetch<Patient>(token, "/api/portal/me", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-me"] });
      setEditing(false);
      setForm({});
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <CenteredSpinner />;
  if (!data) return null;

  const merged = { ...data, ...form };
  const dirty = Object.keys(form).length > 0;

  return (
    <PanelCard
      title="My Profile"
      action={canEdit && !editing ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button> : null}
    >
      <div className="space-y-3 max-w-2xl">
        <Field label="Patient ID" value={data.patientId} />
        <Field label="First Name" value={merged.firstName ?? ""} editing={editing} onChange={(v) => setForm({ ...form, firstName: v })} />
        <Field label="Last Name" value={merged.lastName ?? ""} editing={editing} onChange={(v) => setForm({ ...form, lastName: v })} />
        <Field label="Mobile Number" value={merged.phone ?? ""} editing={editing} onChange={(v) => setForm({ ...form, phone: v })} />
        <Field label="Email" value={merged.email ?? ""} editing={editing} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label="Address" value={merged.address ?? ""} editing={editing} onChange={(v) => setForm({ ...form, address: v })} />
        <Field label="Blood Group" value={merged.bloodGroup ?? ""} editing={editing} onChange={(v) => setForm({ ...form, bloodGroup: v })} />
        <Field label="Date of Birth" value={data.dateOfBirth} />
        <Field label="Gender" value={data.gender} />

        {error && <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}

        {editing && (
          <div className="flex gap-2 pt-2 justify-end">
            <Button variant="outline" onClick={() => { setEditing(false); setForm({}); setError(""); }}>Cancel</Button>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(form as Record<string, unknown>)}>
              {save.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground italic mt-2">Profile editing is disabled by the clinic. Contact reception to update your details.</p>}
      </div>
    </PanelCard>
  );
}

function Field({ label, value, editing, onChange }: { label: string; value: string; editing?: boolean; onChange?: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 items-center py-1.5 border-b last:border-b-0">
      <Label className="text-muted-foreground text-sm">{label}</Label>
      <div className="col-span-2">
        {editing && onChange ? (
          <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
        ) : (
          <p className="text-sm font-medium">{value || <span className="text-muted-foreground italic">Not set</span>}</p>
        )}
      </div>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={28} className="animate-spin text-blue-500" />
    </div>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function base64UrlToBufferWA(s: string): ArrayBuffer {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64UrlWA(b: ArrayBuffer): string {
  const bytes = new Uint8Array(b);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


// ── Version footer — shown on login page ─────────────────────────────────────
function VersionFooter() {
  const [ver, setVer] = React.useState<{ version?: string; build?: number; release?: string; commit?: string } | null>(null);
  React.useEffect(() => {
    fetch("/api/system/version/short")
      .then((r) => r.json())
      .then(setVer)
      .catch(() => {});
  }, []);
  return (
    <div className="fixed bottom-3 left-0 right-0 flex justify-center pointer-events-none z-50">
      <div className="bg-black/40 backdrop-blur-sm text-white/60 text-[10px] font-mono px-3 py-1 rounded-full">
        Care ERP {ver?.version ? `v${ver.version}` : ""} {ver?.build ? `· build ${ver.build}` : ""} {ver?.commit ? `· ${ver.commit}` : ""}
      </div>
    </div>
  );
}
