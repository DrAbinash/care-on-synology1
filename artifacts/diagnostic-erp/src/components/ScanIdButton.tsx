import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Scan, Camera, Upload, Smartphone, Check, RotateCcw, AlertTriangle, 
  HelpCircle, Link, RefreshCcw, Tablet, CheckCircle, ExternalLink,
  ArrowLeft
} from "lucide-react";
import QRCode from "qrcode";

interface ScanIdButtonProps {
  onScanComplete: (data: {
    frontUrl: string;
    backUrl?: string;
    qrData?: any;
    ocrResult?: any;
  }) => void;
  patientId?: number;
  linkedFormFId?: number;
  buttonLabel?: string;
  className?: string;
}

const SCAN_BRIDGE_URL =
  (import.meta as any).env?.VITE_SCAN_BRIDGE_URL || "http://127.0.0.1:8766"; // local per-workstation scanner bridge; override per PC if ever needed

export default function ScanIdButton({
  onScanComplete,
  patientId,
  linkedFormFId,
  buttonLabel = "Scan ID",
  className = "",
}: ScanIdButtonProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<"select" | "bridge" | "mobile" | "manual">("select");
  
  // Settings
  const { data: clinicSettings } = useQuery<any>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  // Scan Bridge status
  const [scanBridgeOk, setScanBridgeOk] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bridgeAction, setBridgeAction] = useState<"direct" | "watch">("direct");

  // Mobile scanning session
  const [sessionToken, setSessionToken] = useState<string>("");
  const [mobileQrUrl, setMobileQrUrl] = useState<string>("");
  const [sessionStatus, setSessionStatus] = useState<string>("pending");
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [sessionQrData, setSessionQrData] = useState<any | null>(null);
  const [sessionOcrResult, setSessionOcrResult] = useState<any | null>(null);

  // Paired device check
  const { data: pairedPhoneData } = useQuery<any>({
    queryKey: ["paired-phone"],
    queryFn: () => api.get("/api/scan-sessions/paired-phone"),
    enabled: open,
  });

  const [triggeringPhone, setTriggeringPhone] = useState(false);

  // Manual Upload files
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputBackRef = useRef<HTMLInputElement>(null);
  const [manualUploading, setManualUploading] = useState(false);

  // Check scan bridge health when open
  useEffect(() => {
    if (!open) return;
    
    async function checkBridge() {
      try {
        const res = await fetch(`${SCAN_BRIDGE_URL}/health`, { method: "GET", mode: "cors" });
        const data = await res.json().catch(() => ({}));
        setScanBridgeOk(res.ok && data.ok === true);
      } catch {
        setScanBridgeOk(false);
      }
    }
    
    checkBridge();
    const interval = setInterval(checkBridge, 5000);
    return () => clearInterval(interval);
  }, [open]);

  // Mobile session status polling
  useEffect(() => {
    if (activeMode !== "mobile" || !sessionToken || sessionStatus === "completed" || sessionStatus === "expired") {
      return;
    }

    let active = true;

    async function poll() {
      if (!active) return;
      try {
        const data = await api.get<any>(`/api/scan-sessions/status/${sessionToken}`);
        if (data.status) {
          setSessionStatus(data.status);
          
          if (data.status === "completed") {
            setFrontPreview(data.frontImageUrl ? `/uploads/${data.frontImageUrl}` : null);
            setBackPreview(data.backImageUrl ? `/uploads/${data.backImageUrl}` : null);
            if (data.qrData) {
              try { setSessionQrData(JSON.parse(data.qrData)); } catch { setSessionQrData(data.qrData); }
            }
            if (data.ocrResult) {
              try { setSessionOcrResult(JSON.parse(data.ocrResult)); } catch { setSessionOcrResult(data.ocrResult); }
            }
            toast({ title: "Images received!", description: "Verify previews and accept to complete." });
            return;
          }
          
          if (data.status === "expired") {
            toast({ title: "Session expired", description: "Mobile scanning session timed out.", variant: "destructive" });
            return;
          }
        }
      } catch (err) {
        console.error("Error polling scan session:", err);
      }
      
      if (active) {
        setTimeout(poll, 1500);
      }
    }

    poll();

    return () => {
      active = false;
    };
  }, [activeMode, sessionToken, sessionStatus]);

  // Generate QR Code URL
  useEffect(() => {
    if (!sessionToken) return;
    const path = `${window.location.origin}/scan-mobile/${sessionToken}`;
    QRCode.toDataURL(path, { width: 180, margin: 1 }, (err, url) => {
      if (!err) setMobileQrUrl(url);
    });
  }, [sessionToken]);

  // Trigger mobile QR session
  async function startMobileQrSession() {
    try {
      const res = await api.post<any>("/api/scan-sessions/create", {
        patientId,
        linkedFormFId,
        method: "qr",
      });
      setSessionToken(res.sessionToken);
      setSessionStatus("pending");
      setFrontPreview(null);
      setBackPreview(null);
      setSessionQrData(null);
      setSessionOcrResult(null);
      setActiveMode("mobile");
    } catch (err) {
      toast({ title: "Failed to initialize mobile session", variant: "destructive" });
    }
  }

  // Trigger Paired Phone
  async function triggerPairedPhoneScan() {
    setTriggeringPhone(true);
    try {
      const res = await api.post<any>("/api/scan-sessions/create", {
        patientId,
        linkedFormFId,
        method: "paired_phone",
      });
      setSessionToken(res.sessionToken);
      setSessionStatus("pending");
      setFrontPreview(null);
      setBackPreview(null);
      setSessionQrData(null);
      setSessionOcrResult(null);
      setActiveMode("mobile");
      toast({ title: "Scan request sent!", description: "Opening camera on paired phone." });
    } catch (err: any) {
      toast({ title: "Failed to trigger phone", description: err.message, variant: "destructive" });
    } finally {
      setTriggeringPhone(false);
    }
  }

  // Direct Scan Bridge
  async function handleBridgeScan(mode: "direct" | "watch") {
    setScanning(true);
    setBridgeAction(mode);
    try {
      const res = await api.post<any>("/api/form-f/latest-scan-proxy", {
        bridgeUrl: SCAN_BRIDGE_URL,
        mode,
        maxWidth: clinicSettings?.maxScanWidth ?? 1200,
        jpegQuality: clinicSettings?.jpegQuality ?? 85,
      });

      if (res.ok && res.imageBase64) {
        // Automatically save as uploaded file
        setManualUploading(true);
        const uploadRes = await api.post<any>("/api/uploads", {
          module: "patient_documents",
          fileName: res.filename || `scan_${Date.now()}.jpg`,
          mimeType: res.mimeType || "image/jpeg",
          base64Data: res.imageBase64,
          patientId,
        });

        onScanComplete({
          frontUrl: `/uploads/${uploadRes.storagePath}`,
        });
        
        toast({ title: "Document Scanned", description: "Attached successfully." });
        setOpen(false);
      } else {
        throw new Error(res.error || "Bridge returned error.");
      }
    } catch (err: any) {
      toast({ 
        title: "Scan Bridge failed", 
        description: err.message || "Make sure the Scan Bridge app is running.", 
        variant: "destructive" 
      });
    } finally {
      setScanning(false);
      setManualUploading(false);
    }
  }

  // Manual Image Upload
  async function handleManualUpload(e: React.ChangeEvent<HTMLInputElement>, side: "front" | "back") {
    const file = e.target.files?.[0];
    if (!file) return;

    setManualUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = String(reader.result).split(",")[1];
        
        const res = await api.post<any>("/api/uploads", {
          module: "patient_documents",
          fileName: file.name,
          mimeType: file.type,
          base64Data: base64,
          patientId,
        });

        if (side === "front") {
          setFrontPreview(`/uploads/${res.storagePath}`);
          // Auto run OCR if enabled
          if (clinicSettings?.ocrEnabled) {
            try {
              const ocrRes = await api.post<any>("/api/form-f/upload-id", {
                imageBase64: base64,
                mimeType: file.type,
              });
              if (ocrRes.ocr) setSessionOcrResult(ocrRes.ocr);
            } catch { /* ignore OCR error */ }
          }
        } else {
          setBackPreview(`/uploads/${res.storagePath}`);
        }
        
        toast({ title: `${side.toUpperCase()} uploaded` });
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setManualUploading(false);
    }
  }

  // Accept Scan Session result
  function acceptSessionResult() {
    if (!frontPreview) return;
    
    // Remove base path /uploads/ for database storage compatibility
    const cleanFront = frontPreview.replace(/^\/uploads\//, "");
    const cleanBack = backPreview ? backPreview.replace(/^\/uploads\//, "") : undefined;

    onScanComplete({
      frontUrl: cleanFront,
      backUrl: cleanBack,
      qrData: sessionQrData,
      ocrResult: sessionOcrResult,
    });
    
    setOpen(false);
  }

  return (
    <>
      <Button onClick={() => { setOpen(true); setActiveMode("select"); }} className={`gap-1.5 ${className}`}>
        <Scan size={15} /> {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Scan size={18} className="text-primary" /> Scan Identity Card / Document
            </DialogTitle>
          </DialogHeader>

          {activeMode === "select" && (
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground">Select scanning source or method to attach documents:</p>
              
              <div className="grid grid-cols-1 gap-2.5">
                {/* 1. Paired Phone Trigger (Fastest if paired) */}
                {pairedPhoneData?.paired && (
                  <Button 
                    onClick={triggerPairedPhoneScan}
                    disabled={triggeringPhone}
                    className="h-14 justify-start gap-3 border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 text-blue-800 dark:text-blue-200 hover:from-blue-100 hover:to-indigo-100"
                  >
                    <Smartphone size={22} className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <div className="text-left">
                      <div className="font-bold text-sm">Send to Paired Phone</div>
                      <div className="text-[10px] opacity-75">Instant trigger: {pairedPhoneData.device.deviceName}</div>
                    </div>
                  </Button>
                )}

                {/* 2. Mobile Scanner QR code */}
                <Button 
                  variant="outline" 
                  onClick={startMobileQrSession}
                  className="h-14 justify-start gap-3 border-dashed hover:bg-muted/40"
                >
                  <Smartphone size={20} className="text-muted-foreground shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Scan via QR Code</div>
                    <div className="text-[10px] text-muted-foreground">Scan QR with any phone to open camera</div>
                  </div>
                </Button>

                {/* 3. Direct Flatbed/ADF Scanner */}
                <Button 
                  variant="outline"
                  onClick={() => setActiveMode("bridge")}
                  className={`h-14 justify-start gap-3 hover:bg-muted/40 ${scanBridgeOk ? "border-green-200 bg-green-50/10" : ""}`}
                >
                  <Scan size={20} className={scanBridgeOk ? "text-green-600" : "text-muted-foreground"} />
                  <div className="text-left">
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      Direct Flatbed Scanner 
                      <div className={`w-1.5 h-1.5 rounded-full ${scanBridgeOk ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">Uses workstation USB scanner / Scan Bridge</div>
                  </div>
                </Button>

                {/* 4. Manual Upload */}
                <Button 
                  variant="outline" 
                  onClick={() => { setActiveMode("manual"); setFrontPreview(null); setBackPreview(null); }}
                  className="h-14 justify-start gap-3 hover:bg-muted/40"
                >
                  <Upload size={20} className="text-muted-foreground shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-sm">Upload File</div>
                    <div className="text-[10px] text-muted-foreground">Select JPEG or PNG from computer</div>
                  </div>
                </Button>
              </div>

              {/* Pairing instructions shortcut */}
              <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Want to pair a phone?</span>
                <a href="/scan-mobile/pair" target="_blank" className="text-primary hover:underline flex items-center gap-0.5">
                  Pair Link <ExternalLink size={10} />
                </a>
              </div>
            </div>
          )}

          {activeMode === "bridge" && (
            <div className="space-y-4 pt-2 text-center">
              <div className="bg-muted/30 p-4 rounded-xl space-y-2">
                <Scan size={36} className="mx-auto text-primary" />
                <h4 className="font-semibold">Local Workstation Scanner</h4>
                <p className="text-xs text-muted-foreground">Select your action. WIA scan triggers instantly, or watch watches a folder.</p>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={() => handleBridgeScan("direct")} 
                  disabled={scanning || !scanBridgeOk}
                  className="flex-1"
                >
                  {scanning && bridgeAction === "direct" ? "Scanning..." : "Trigger WIA Scan"}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => handleBridgeScan("watch")} 
                  disabled={scanning || !scanBridgeOk}
                  className="flex-1"
                >
                  {scanning && bridgeAction === "watch" ? "Importing..." : "Watch Folder Import"}
                </Button>
              </div>

              <div className="flex justify-between items-center text-xs pt-2">
                <Button variant="ghost" size="sm" onClick={() => setActiveMode("select")}><ArrowLeft size={12} className="mr-1" /> Back</Button>
                {!scanBridgeOk && (
                  <span className="text-red-500 flex items-center gap-1"><AlertTriangle size={12} /> Scanner Bridge offline</span>
                )}
              </div>
            </div>
          )}

          {activeMode === "mobile" && (
            <div className="space-y-4 pt-2 text-center">
              {sessionStatus === "pending" && (
                <div className="space-y-4">
                  {mobileQrUrl ? (
                    <div className="bg-white p-2.5 rounded-lg border inline-block mx-auto">
                      <img src={mobileQrUrl} alt="Scan QR" className="w-40 h-40" />
                    </div>
                  ) : (
                    <div className="w-40 h-40 bg-muted animate-pulse mx-auto rounded-lg" />
                  )}

                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm">Scan QR with your phone</h4>
                    <p className="text-xs text-muted-foreground">It opens the phone camera feed to securely scan documents.</p>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-xs text-amber-500 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 rounded-lg w-fit mx-auto">
                    <Smartphone size={12} className="animate-bounce" />
                    <span>Awaiting mobile camera capture...</span>
                  </div>
                </div>
              )}

              {sessionStatus === "completed" && (
                <div className="space-y-4 text-left">
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                    <CheckCircle size={16} /> Scanned Images Received
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {frontPreview && (
                      <div className="border rounded-lg overflow-hidden bg-muted">
                        <p className="text-[9px] font-bold text-center py-0.5 bg-background">FRONT</p>
                        <img src={frontPreview} className="w-full h-24 object-contain" alt="Front Preview" />
                      </div>
                    )}
                    {backPreview && (
                      <div className="border rounded-lg overflow-hidden bg-muted">
                        <p className="text-[9px] font-bold text-center py-0.5 bg-background">BACK</p>
                        <img src={backPreview} className="w-full h-24 object-contain" alt="Back Preview" />
                      </div>
                    )}
                  </div>

                  {sessionQrData && (
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 rounded-lg p-2.5 text-xs">
                      <p className="font-bold text-emerald-800 dark:text-emerald-300">✓ Aadhaar Demographic Verified</p>
                      <p className="mt-1"><strong>Name:</strong> {sessionQrData.name}</p>
                      <p><strong>DOB/Gender:</strong> {sessionQrData.dob} / {sessionQrData.gender}</p>
                      <p className="truncate"><strong>Address:</strong> {sessionQrData.address}</p>
                    </div>
                  )}

                  {sessionOcrResult && !sessionQrData && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 rounded-lg p-2.5 text-xs">
                      <p className="font-bold text-blue-800 dark:text-blue-300">💡 OCR Fields Extracted</p>
                      <p className="mt-1"><strong>Guardian/Husband:</strong> {sessionOcrResult.guardianName || sessionOcrResult.fullName}</p>
                      <p className="truncate"><strong>Address:</strong> {sessionOcrResult.address}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={startMobileQrSession}><RotateCcw size={14} className="mr-1.5" /> Retake</Button>
                    <Button className="flex-1" onClick={acceptSessionResult}><Check size={14} className="mr-1.5" /> Accept &amp; Attach</Button>
                  </div>
                </div>
              )}

              {sessionStatus === "expired" && (
                <div className="space-y-4">
                  <AlertTriangle size={32} className="mx-auto text-red-500" />
                  <p className="text-sm">This scanning session has expired.</p>
                  <Button onClick={startMobileQrSession}>Generate New QR Code</Button>
                </div>
              )}

              <div className="pt-2 border-t text-left">
                <Button variant="ghost" size="sm" onClick={() => setActiveMode("select")}><ArrowLeft size={12} className="mr-1" /> Back</Button>
              </div>
            </div>
          )}

          {activeMode === "manual" && (
            <div className="space-y-4 pt-2">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Front Side / Document *</label>
                  <div className="flex gap-2">
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleManualUpload(e, "front")} 
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={manualUploading}
                      className="w-full h-10 border-dashed"
                    >
                      <Upload size={14} className="mr-1.5" /> Select File
                    </Button>
                  </div>
                  {frontPreview && <p className="text-[10px] text-green-600 font-semibold">✓ Front side selected</p>}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Back Side (Optional)</label>
                  <div className="flex gap-2">
                    <input 
                      ref={fileInputBackRef}
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => handleManualUpload(e, "back")} 
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => fileInputBackRef.current?.click()}
                      disabled={manualUploading}
                      className="w-full h-10 border-dashed"
                    >
                      <Upload size={14} className="mr-1.5" /> Select File
                    </Button>
                  </div>
                  {backPreview && <p className="text-[10px] text-green-600 font-semibold">✓ Back side selected</p>}
                </div>
              </div>

              {frontPreview && (
                <Button 
                  className="w-full mt-2" 
                  onClick={acceptSessionResult}
                  disabled={manualUploading}
                >
                  <Check size={14} className="mr-1.5" /> Attach Document
                </Button>
              )}

              <div className="pt-2 border-t">
                <Button variant="ghost" size="sm" onClick={() => setActiveMode("select")}><ArrowLeft size={12} className="mr-1" /> Back</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
