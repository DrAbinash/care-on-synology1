/**
 * Teleradiology Portal — standalone login for external/night radiologists.
 * Accessed at /teleradiology — does NOT use the main staff ERP session.
 * Uses its own teleradiology_sessions table via /api/teleradiology-portal/*.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Radio, LogOut, RefreshCw, User, FileText, AlertTriangle,
  Eye, EyeOff, CheckCircle2, Clock, Send, Zap, X,
  ChevronLeft, Lock, BrainCircuit,
} from "lucide-react";

const TELE_TOKEN_KEY = "tele_session_token";

interface TeleUser {
  id: number;
  name: string;
  email: string;
  role: string;
  specialty: string | null;
  canDoFinalReport: boolean;
  canUseAI: boolean;
}

interface TeleStudy {
  assignmentId: number;
  studyId: number;
  priority: string;
  status: string;
  isCritical: boolean;
  deadline: string | null;
  assignedAt: string;
  patientName: string;
  accessionNumber: string;
  modality: string;
  studyDate: string | null;
  clinicalHistory: string | null;
  studyInstanceUID: string | null;
  ohifUrl: string | null;
  currentPrelim: string | null;
  currentFinal: string | null;
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string, user: TeleUser) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const loginMutation = useMutation({
    mutationFn: () => fetchApi<{ token: string; user: TeleUser }>("/api/teleradiology-portal/login", { method: "POST", body: JSON.stringify({ email, pin }) }),
    onSuccess: (d) => {
      localStorage.setItem(TELE_TOKEN_KEY, d.token);
      onLogin(d.token, d.user);
    },
    onError: (e: Error) => toast({ title: "Login failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 rounded-2xl bg-cyan-600/20 border border-cyan-500/30">
              <Radio size={32} className="text-cyan-400" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white">Teleradiology Portal</h1>
          <p className="text-sm text-slate-400">External radiologist access</p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg border border-slate-700 bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              placeholder="your@email.com"
              onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400">PIN</label>
            <div className="relative">
              <input
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-slate-700 bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono tracking-widest"
                placeholder="••••••"
                onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                onClick={() => setShowPin(!showPin)}
              >
                {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <Button
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white gap-2"
            onClick={() => loginMutation.mutate()}
            disabled={loginMutation.isPending || !email || !pin}
          >
            {loginMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
            Sign In
          </Button>
        </div>

        <p className="text-center text-xs text-slate-600">Contact your diagnostic center administrator for credentials.</p>
      </div>
    </div>
  );
}

// ─── Study Detail ─────────────────────────────────────────────────────────────
function StudyDetail({ study, user, token, onBack }: { study: TeleStudy; user: TeleUser; token: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prelim, setPrelim] = useState(study.currentPrelim ?? "");
  const [finalReport, setFinalReport] = useState(study.currentFinal ?? "");
  const [isCritical, setIsCritical] = useState(study.isCritical);

  const submitMutation = useMutation({
    mutationFn: (payload: { type: "prelim" | "final"; text: string; critical?: boolean }) =>
      fetchApi(
        `/api/teleradiology-portal/assignments/${study.assignmentId}/${payload.type}`,
        { method: "POST", body: JSON.stringify({ report: payload.text, critical: payload.critical }), headers: { Authorization: `Bearer ${token}` } },
      ),
    onSuccess: () => {
      toast({ title: "Report submitted" });
      void queryClient.invalidateQueries({ queryKey: ["tele-studies", token] });
      onBack();
    },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button onClick={onBack} className="text-slate-400 hover:text-white p-1"><ChevronLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{study.patientName}</p>
          <p className="text-[11px] text-slate-400 font-mono">{study.accessionNumber} · {study.modality}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${study.priority === "STAT" ? "bg-red-600" : study.priority === "URGENT" ? "bg-amber-600" : "bg-slate-700"}`}>
            {study.priority}
          </Badge>
          {study.ohifUrl && (
            <a href={study.ohifUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="h-7 gap-1 text-xs bg-cyan-600 hover:bg-cyan-700">
                <Eye size={11} /> View
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Clinical info */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase">Clinical Info</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><p className="text-slate-500">Study Date</p><p>{study.studyDate ?? "—"}</p></div>
            <div><p className="text-slate-500">Modality</p><p><Badge variant="outline" className="text-[10px] border-slate-600">{study.modality}</Badge></p></div>
            {study.deadline && <div><p className="text-slate-500">TAT Deadline</p><p className="text-amber-400">{new Date(study.deadline).toLocaleString()}</p></div>}
          </div>
          {study.clinicalHistory && (
            <div>
              <p className="text-xs text-slate-500">Clinical History</p>
              <p className="text-sm mt-0.5">{study.clinicalHistory}</p>
            </div>
          )}
        </div>

        {/* Critical flag */}
        <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer ${isCritical ? "border-red-500 bg-red-950/20" : "border-slate-700 bg-slate-900"}`}>
          <div className="flex items-center gap-2">
            <Zap size={14} className={isCritical ? "text-red-400" : "text-slate-500"} />
            <div>
              <p className="text-xs font-semibold">Critical / Urgent Finding</p>
              <p className="text-[10px] text-slate-500">Alerts the ERP staff immediately</p>
            </div>
          </div>
          <div className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${isCritical ? "bg-red-500" : "bg-slate-700"}`}
            onClick={() => setIsCritical(!isCritical)}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isCritical ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
        </label>

        {/* Preliminary report */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase">Preliminary Report</label>
          <textarea
            value={prelim}
            onChange={(e) => setPrelim(e.target.value)}
            rows={10}
            className="w-full p-3 text-sm rounded-xl border border-slate-700 bg-slate-900 text-white placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-500 font-mono leading-relaxed"
            placeholder="Technique:&#10;&#10;Findings:&#10;&#10;Impression:"
          />
          <Button
            className="w-full gap-2 bg-cyan-600 hover:bg-cyan-700"
            onClick={() => submitMutation.mutate({ type: "prelim", text: prelim, critical: isCritical })}
            disabled={submitMutation.isPending || !prelim.trim()}
          >
            {submitMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            Submit Preliminary Report
          </Button>
        </div>

        {/* Final report — only if authorised */}
        {user.canDoFinalReport && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase">Final Report</label>
            <textarea
              value={finalReport}
              onChange={(e) => setFinalReport(e.target.value)}
              rows={10}
              className="w-full p-3 text-sm rounded-xl border border-amber-700/50 bg-slate-900 text-white placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500 font-mono leading-relaxed"
              placeholder="Final report (authorised radiologists only)…"
            />
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-2 text-[10px] text-amber-300 flex gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              Final reports are reviewed by the ERP staff before delivery. You are responsible for clinical accuracy.
            </div>
            <Button
              variant="outline"
              className="w-full gap-2 border-amber-600 text-amber-400 hover:bg-amber-950/30"
              onClick={() => submitMutation.mutate({ type: "final", text: finalReport, critical: isCritical })}
              disabled={submitMutation.isPending || !finalReport.trim()}
            >
              <CheckCircle2 size={14} /> Submit Final Report
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Studies List ─────────────────────────────────────────────────────────────
function StudiesList({ token, user, onLogout }: { token: string; user: TeleUser; onLogout: () => void }) {
  const { toast } = useToast();
  const [selectedStudy, setSelectedStudy] = useState<TeleStudy | null>(null);

  const { data: studies = [], isLoading, refetch } = useQuery<TeleStudy[]>({
    queryKey: ["tele-studies", token],
    queryFn: (): Promise<TeleStudy[]> => fetchApi("/api/teleradiology-portal/studies", { headers: { Authorization: `Bearer ${token}` } }),
    refetchInterval: 30_000,
  });

  if (selectedStudy) {
    return <StudyDetail study={selectedStudy} user={user} token={token} onBack={() => setSelectedStudy(null)} />;
  }

  const pending = studies.filter((s) => s.status === "assigned" || s.status === "in_progress");
  const completed = studies.filter((s) => s.status === "submitted" || s.status === "completed");

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="p-1.5 rounded-lg bg-cyan-600/20">
          <Radio size={16} className="text-cyan-400" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">{user.name}</p>
          <p className="text-[11px] text-slate-400">{user.specialty ?? user.role}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-slate-400 hover:text-white gap-1 text-xs" onClick={() => void refetch()}>
            <RefreshCw size={12} /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-slate-400 hover:text-white gap-1 text-xs" onClick={onLogout}>
            <LogOut size={12} /> Logout
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-16"><RefreshCw size={24} className="animate-spin text-slate-500" /></div>
        )}

        {!isLoading && studies.length === 0 && (
          <div className="text-center py-16 space-y-2">
            <Clock size={32} className="mx-auto text-slate-600" />
            <p className="text-slate-400 font-medium">No studies assigned</p>
            <p className="text-slate-600 text-sm">Studies assigned to you will appear here.</p>
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pending ({pending.length})</h3>
            {pending.map((study) => (
              <button
                key={study.assignmentId}
                className="w-full text-left rounded-xl border border-slate-700 bg-slate-900 hover:border-cyan-600 p-4 transition-colors space-y-2"
                onClick={() => setSelectedStudy(study)}
              >
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm flex-1 truncate">{study.patientName}</p>
                  <Badge className={`text-[10px] shrink-0 ${study.priority === "STAT" ? "bg-red-600" : study.priority === "URGENT" ? "bg-amber-600" : "bg-slate-700"}`}>
                    {study.priority}
                  </Badge>
                  {study.isCritical && <Badge className="text-[10px] bg-red-800 shrink-0">⚡ CRITICAL</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="font-mono">{study.accessionNumber}</span>
                  <Badge variant="outline" className="text-[10px] border-slate-700">{study.modality}</Badge>
                  {study.studyDate && <span>{study.studyDate}</span>}
                  {study.deadline && <span className="text-amber-400">Due: {new Date(study.deadline).toLocaleString()}</span>}
                </div>
                {study.clinicalHistory && (
                  <p className="text-xs text-slate-500 line-clamp-1">{study.clinicalHistory}</p>
                )}
              </button>
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Completed ({completed.length})</h3>
            {completed.map((study) => (
              <button
                key={study.assignmentId}
                className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-sm"
                onClick={() => setSelectedStudy(study)}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  <span className="flex-1 truncate">{study.patientName}</span>
                  <span className="text-xs text-slate-500 font-mono">{study.accessionNumber}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────
export default function TeleradiologyPortal() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TELE_TOKEN_KEY));
  const [user, setUser] = useState<TeleUser | null>(null);

  // Verify existing token
  const { isLoading: verifying, data: verifiedUser, isError: verifyError } = useQuery<TeleUser>({
    queryKey: ["tele-verify", token],
    queryFn: (): Promise<TeleUser> => fetchApi("/api/teleradiology-portal/me", { headers: { Authorization: `Bearer ${token}` } }),
    enabled: !!token && !user,
    retry: false,
  });

  useEffect(() => {
    if (verifiedUser && !user) setUser(verifiedUser);
  }, [verifiedUser, user]);

  useEffect(() => {
    if (verifyError) {
      localStorage.removeItem(TELE_TOKEN_KEY);
      setToken(null);
    }
  }, [verifyError]);

  function handleLogin(newToken: string, newUser: TeleUser) {
    setToken(newToken);
    setUser(newUser);
  }

  function handleLogout() {
    localStorage.removeItem(TELE_TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  if (verifying) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!token || !user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <StudiesList token={token} user={user} onLogout={handleLogout} />;
}
