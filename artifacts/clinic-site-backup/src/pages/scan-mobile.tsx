import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, AlertTriangle, CheckCircle, Smartphone, Send, ArrowLeft } from "lucide-react";
import jsQR from "jsqr";

type Step = "initializing" | "mode-select" | "camera" | "preview" | "uploading" | "success" | "error" | "pair-device" | "paired-active";
type CaptureSlot = "front" | "back" | "document";

interface ScanMobilePageProps {
  settings: any;
}

export default function ScanMobilePage({ settings }: ScanMobilePageProps) {
  const [step, setStep] = useState<Step>("initializing");
  const [token, setToken] = useState<string>("");
  const [captureSlot, setCaptureSlot] = useState<CaptureSlot>("front");
  
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [qrData, setQrData] = useState<any | null>(null);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean>(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  // Pairing refs & state
  const [deviceName, setDeviceName] = useState<string>("");
  const [pairedDeviceId, setPairedDeviceId] = useState<string>("");
  const [pairedDeviceName, setPairedDeviceName] = useState<string>("");
  const [isPairingSaved, setIsPairingSaved] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Parse path or query params
  useEffect(() => {
    const pathParts = window.location.pathname.split("/");
    // path pattern: /scan-mobile/:token or /scan-mobile/pair
    const tokenFromPath = pathParts[pathParts.length - 1];
    
    // Check local storage for existing pairing
    const savedId = localStorage.getItem("care_paired_device_id");
    const savedName = localStorage.getItem("care_paired_device_name");
    if (savedId && savedName) {
      setPairedDeviceId(savedId);
      setPairedDeviceName(savedName);
      setIsPairingSaved(true);
    }

    if (tokenFromPath === "pair") {
      setStep("pair-device");
      const urlParams = new URLSearchParams(window.location.search);
      const pairingToken = urlParams.get("token") || "";
      setToken(pairingToken);
    } else if (tokenFromPath && tokenFromPath !== "scan-mobile") {
      setToken(tokenFromPath);
      setStep("camera");
      setCaptureSlot("front");
    } else {
      // Default fallback
      if (savedId) {
        setStep("paired-active");
      } else {
        setStep("mode-select");
      }
    }
  }, []);

  // Poll for paired device notifications
  useEffect(() => {
    if (step !== "paired-active" || !pairedDeviceId) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    let active = true;

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(`/api/scan-sessions/mobile-poll/${encodeURIComponent(pairedDeviceId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.pending && data.sessionToken) {
            setToken(data.sessionToken);
            setStep("camera");
            setCaptureSlot("front");
            setFrontImage(null);
            setBackImage(null);
            setQrData(null);
          }
        }
      } catch (err) {
        console.error("Failed to poll scan request:", err);
      }
      
      if (active) {
        setTimeout(poll, 2000);
      }
    }

    poll();

    return () => {
      active = false;
    };
  }, [step, pairedDeviceId]);

  // Request cameras list
  useEffect(() => {
    if (step === "camera") {
      initCamera();
    }
    return () => {
      stopCamera();
    };
  }, [step, selectedDeviceId]);

  // QR scanning loop
  useEffect(() => {
    let active = true;
    let scanTimeout: any = null;

    function scanQR() {
      if (!active || step !== "camera" || !videoRef.current || !canvasRef.current) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      
      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        try {
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          
          if (code && code.data) {
            // Check if it looks like an Aadhaar QR code (XML string)
            const rawText = code.data;
            if (rawText.includes("PrintLetterBarcodeData") || rawText.startsWith("<?xml")) {
              const parsed = parseAadhaarXml(rawText);
              setQrData(parsed);
              
              // Automatically snap the picture
              captureFrame();
              return;
            }
          }
        } catch (e) {
          // ignore scan error
        }
      }
      
      scanTimeout = setTimeout(scanQR, 400);
    }

    if (step === "camera") {
      scanQR();
    }

    return () => {
      active = false;
      if (scanTimeout) clearTimeout(scanTimeout);
    };
  }, [step]);

  function parseAadhaarXml(xml: string) {
    const getAttr = (attr: string) => {
      const m = xml.match(new RegExp(`${attr}="([^"]*)"`));
      return m ? m[1] : "";
    };

    const name = getAttr("name");
    const gender = getAttr("gender") || getAttr("gnd");
    const yob = getAttr("yob");
    const dob = getAttr("dob");
    const uid = getAttr("uid");
    
    const co = getAttr("co");
    const house = getAttr("house");
    const street = getAttr("street");
    const loc = getAttr("loc");
    const vtc = getAttr("vtc");
    const dist = getAttr("dist");
    const state = getAttr("state");
    const pc = getAttr("pc");

    let address = [house, street, loc, vtc, dist, state, pc].filter(Boolean).join(", ");
    if (co) address = `C/O ${co}, ${address}`;

    return {
      name,
      gender: gender === "M" ? "Male" : gender === "F" ? "Female" : gender,
      dob: dob || (yob ? `01/01/${yob}` : ""),
      uid: uid ? `XXXX-XXXX-${uid.slice(-4)}` : "",
      address,
      rawXml: xml
    };
  }

  async function initCamera() {
    try {
      stopCamera();
      
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId 
          ? { deviceId: { exact: selectedDeviceId } }
          : { facingMode: "environment" }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      setHasCameraPermission(true);

      // Get list of cameras
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === "videoinput");
      setDevices(videoDevices);
      if (!selectedDeviceId && videoDevices.length > 0) {
        // Try to select the back camera by default
        const backCam = videoDevices.find(d => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("environment"));
        setSelectedDeviceId(backCam?.deviceId || videoDevices[videoDevices.length - 1].deviceId);
      }
    } catch (err) {
      console.error("Camera access failed:", err);
      setHasCameraPermission(false);
      setErrorMsg("Unable to access camera. Please grant permissions and reload.");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }

  function captureFrame() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    
    if (captureSlot === "front") {
      setFrontImage(dataUrl);
    } else if (captureSlot === "back") {
      setBackImage(dataUrl);
    }
    
    stopCamera();
    setStep("preview");
  }

  async function handleUpload() {
    if (!frontImage && !backImage) {
      setErrorMsg("Please scan or capture at least one image.");
      return;
    }

    setStep("uploading");
    try {
      const response = await fetch(`/api/scan-sessions/upload/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontImage: frontImage || undefined,
          backImage: backImage || undefined,
          qrData: qrData || undefined,
        }),
      });

      if (response.ok) {
        setStep("success");
      } else {
        const err = await response.json();
        setErrorMsg(err.error || "Failed to upload images.");
        setStep("error");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setErrorMsg("Network error. Unable to upload scanned files.");
      setStep("error");
    }
  }

  async function handlePairDevice() {
    if (!deviceName.trim()) {
      alert("Please enter a device name.");
      return;
    }

    const uuid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    try {
      const response = await fetch("/api/scan-sessions/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: uuid,
          deviceName: deviceName.trim(),
          sessionToken: token || undefined,
        }),
      });

      if (response.ok) {
        localStorage.setItem("care_paired_device_id", uuid);
        localStorage.setItem("care_paired_device_name", deviceName.trim());
        setPairedDeviceId(uuid);
        setPairedDeviceName(deviceName.trim());
        setIsPairingSaved(true);
        setStep("paired-active");
      } else {
        const err = await response.json();
        alert(err.error || "Failed to pair device.");
      }
    } catch (err) {
      alert("Network error occurred during device pairing.");
    }
  }

  function handleUnpair() {
    if (confirm("Are you sure you want to unpair this device?")) {
      localStorage.removeItem("care_paired_device_id");
      localStorage.removeItem("care_paired_device_name");
      setPairedDeviceId("");
      setPairedDeviceName("");
      setIsPairingSaved(false);
      setStep("mode-select");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(to bottom, #111827, #030712)",
      color: "#f9fafb",
      fontFamily: "Inter, system-ui, sans-serif",
      display: "flex",
      flexDirection: "column"
    }}>
      {/* Header bar */}
      <div style={{
        padding: "1rem",
        background: "#1f2937",
        borderBottom: "1px solid #374151",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Smartphone size={20} className="text-primary" style={{ color: "#3b82f6" }} />
          <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>Care Scanner</span>
        </div>
        {pairedDeviceName && (
          <span style={{ fontSize: "0.75rem", background: "#374151", padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
            Paired: {pairedDeviceName}
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "1.5rem" }}>
        
        {step === "initializing" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #374151", borderTopColor: "#3b82f6", animation: "spin 1s linear infinite" }} />
            <p style={{ marginTop: "1rem", color: "#9ca3af" }}>Initializing camera permissions...</p>
          </div>
        )}

        {step === "mode-select" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.5rem" }}>
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Wireless Scanning</h2>
              <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                Use your phone as a mobile scanner for Care Diagnostics ERP.
              </p>
            </div>

            <button
              onClick={() => setStep("pair-device")}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "1rem",
                padding: "1.5rem",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "1rem"
              }}
            >
              <div style={{ background: "#3b82f6", width: "3rem", height: "3rem", borderRadius: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Smartphone size={24} style={{ color: "#fff", margin: "auto" }} />
              </div>
              <div>
                <h3 style={{ fontWeight: 700, fontSize: "1.1rem" }}>Pair Reception Phone</h3>
                <p style={{ color: "#9ca3af", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                  Pair this phone once. Receive scan requests automatically without QR codes.
                </p>
              </div>
            </button>
            
            <div style={{ textAlign: "center", color: "#6b7280", fontSize: "0.8rem" }}>
              Or scan a QR code from the Care ERP desktop application to scan directly.
            </div>
          </div>
        )}

        {step === "pair-device" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: "400px", margin: "0 auto", width: "100%", gap: "1.5rem" }}>
            <div style={{ textAlign: "center" }}>
              <Smartphone size={48} style={{ color: "#3b82f6", margin: "0 auto" }} />
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "1rem" }}>Pair this Device</h2>
              <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                Give this phone a name to register it as a wireless document scanner.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem", color: "#9ca3af", fontWeight: 600 }}>Device Name</label>
              <input
                type="text"
                placeholder="e.g. Front Desk Phone"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                style={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                  color: "#fff",
                  fontSize: "1rem"
                }}
              />
            </div>

            <button
              onClick={handlePairDevice}
              style={{
                background: "#3b82f6",
                color: "#fff",
                fontWeight: 700,
                padding: "0.9rem",
                borderRadius: "0.5rem",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontSize: "1rem"
              }}
            >
              <Check size={18} /> Pair Phone
            </button>

            {isPairingSaved && (
              <button
                onClick={() => setStep("paired-active")}
                style={{ background: "transparent", border: "none", color: "#9ca3af", textDecoration: "underline", fontSize: "0.9rem" }}
              >
                Back to Paired Mode
              </button>
            )}
          </div>
        )}

        {step === "paired-active" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "1.5rem" }}>
            <div style={{ position: "relative" }}>
              <div style={{
                width: "6rem",
                height: "6rem",
                borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <Smartphone size={44} style={{ color: "#3b82f6" }} />
              </div>
              <div style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: "1.5rem",
                height: "1.5rem",
                borderRadius: "50%",
                background: "#10b981",
                border: "3px solid #111827"
              }} />
            </div>

            <div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>Device Paired &amp; Ready</h2>
              <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                Active: <strong>{pairedDeviceName}</strong>
              </p>
              <p style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "1rem" }}>
                Keep this page open. When a scan request is triggered from the ERP desktop, your camera will open automatically.
              </p>
            </div>

            {isPolling && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#10b981", fontSize: "0.85rem" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", animation: "pulse 1.5s infinite" }} />
                Waiting for scan request...
              </div>
            )}

            <button
              onClick={handleUnpair}
              style={{
                marginTop: "2rem",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "0.5rem",
                padding: "0.5rem 1rem",
                color: "#ef4444",
                fontSize: "0.85rem"
              }}
            >
              Unpair Phone
            </button>
          </div>
        )}

        {step === "camera" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
            <div style={{ marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, color: "#3b82f6" }}>
                Scan: {captureSlot.toUpperCase()} Card / Doc
              </span>
              
              {devices.length > 1 && (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  style={{
                    background: "#1f2937",
                    border: "1px solid #374151",
                    color: "#fff",
                    fontSize: "0.8rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "0.25rem"
                  }}
                >
                  {devices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{
              flex: 1,
              position: "relative",
              background: "#000",
              borderRadius: "0.75rem",
              overflow: "hidden",
              display: "flex",
              alignItems: "center"
            }}>
              {!hasCameraPermission ? (
                <div style={{ padding: "2rem", textAlign: "center", margin: "auto" }}>
                  <AlertTriangle size={36} style={{ color: "#f59e0b", margin: "0 auto 1rem" }} />
                  <p>Camera permission denied or unavailable.</p>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  {/* Overlay guides */}
                  <div style={{
                    position: "absolute",
                    inset: "2rem",
                    border: "2px dashed rgba(255, 255, 255, 0.4)",
                    borderRadius: "0.5rem",
                    pointerEvents: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <div style={{
                      color: "rgba(255, 255, 255, 0.5)",
                      fontSize: "0.8rem",
                      textAlign: "center",
                      background: "rgba(0, 0, 0, 0.5)",
                      padding: "0.4rem 0.8rem",
                      borderRadius: "9999px"
                    }}>
                      Align card or QR code here
                    </div>
                  </div>
                </>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: "none" }} />

            <div style={{ display: "flex", justifyContent: "center", gap: "1rem", marginTop: "1rem" }}>
              <button
                onClick={captureFrame}
                disabled={!hasCameraPermission}
                style={{
                  background: "#3b82f6",
                  color: "#fff",
                  width: "4.5rem",
                  height: "4.5rem",
                  borderRadius: "50%",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)"
                }}
              >
                <Camera size={28} />
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Verify Scanned Document</h2>
            
            <div style={{
              flex: 1,
              borderRadius: "0.75rem",
              overflow: "hidden",
              border: "1px solid #374151",
              background: "#000",
              display: "flex"
            }}>
              <img
                src={captureSlot === "front" ? frontImage || "" : backImage || ""}
                alt="Captured document preview"
                style={{ width: "100%", maxHeight: "55vh", objectFit: "contain", margin: "auto" }}
              />
            </div>

            {qrData && (
              <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "0.5rem", padding: "0.75rem" }}>
                <p style={{ color: "#10b981", fontWeight: 700, fontSize: "0.85rem" }}>✓ Aadhaar QR Code Decoded</p>
                <p style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}><strong>Name:</strong> {qrData.name}</p>
                <p style={{ fontSize: "0.85rem" }}><strong>DOB:</strong> {qrData.dob}</p>
                <p style={{ fontSize: "0.85rem" }}><strong>Gender:</strong> {qrData.gender}</p>
                <p style={{ fontSize: "0.85rem", color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <strong>Address:</strong> {qrData.address}
                </p>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", gap: "1rem" }}>
                <button
                  onClick={() => {
                    setStep("camera");
                    initCamera();
                  }}
                  style={{
                    flex: 1,
                    background: "#374151",
                    color: "#fff",
                    fontWeight: 700,
                    padding: "0.85rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem"
                  }}
                >
                  <RotateCcw size={16} /> Retake
                </button>
                
                <button
                  onClick={() => {
                    if (captureSlot === "front") {
                      // If Aadhaar scanned, we usually only need front or we can ask for back
                      if (qrData) {
                        // Directly go to upload if Aadhaar QR detected
                        handleUpload();
                      } else {
                        // Ask for Back side
                        if (confirm("Capture the back side of the card?")) {
                          setCaptureSlot("back");
                          setStep("camera");
                        } else {
                          handleUpload();
                        }
                      }
                    } else {
                      handleUpload();
                    }
                  }}
                  style={{
                    flex: 1,
                    background: "#10b981",
                    color: "#fff",
                    fontWeight: 700,
                    padding: "0.85rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem"
                  }}
                >
                  <Check size={16} /> Accept &amp; Continue
                </button>
              </div>

              {captureSlot === "front" && !qrData && (
                <button
                  onClick={handleUpload}
                  style={{
                    background: "transparent",
                    color: "#9ca3af",
                    border: "none",
                    textDecoration: "underline",
                    fontSize: "0.85rem"
                  }}
                >
                  Skip Back, Upload Front Only
                </button>
              )}
            </div>
          </div>
        )}

        {step === "uploading" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #374151", borderTopColor: "#10b981", animation: "spin 1s linear infinite" }} />
            <p style={{ marginTop: "1rem", color: "#9ca3af" }}>Uploading scans directly to Care ERP...</p>
          </div>
        )}

        {step === "success" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "1.5rem" }}>
            <CheckCircle size={64} style={{ color: "#10b981" }} />
            <div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Upload Successful!</h2>
              <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                The captured images have been received by the ERP desktop client.
              </p>
            </div>
            
            <button
              onClick={() => {
                if (pairedDeviceId) {
                  setStep("paired-active");
                } else {
                  setStep("mode-select");
                }
              }}
              style={{
                background: "#3b82f6",
                color: "#fff",
                fontWeight: 700,
                padding: "0.75rem 2rem",
                borderRadius: "0.5rem",
                border: "none"
              }}
            >
              Done
            </button>
          </div>
        )}

        {step === "error" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "1.5rem" }}>
            <AlertTriangle size={64} style={{ color: "#ef4444" }} />
            <div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Upload Failed</h2>
              <p style={{ color: "#ef4444", fontSize: "0.9rem", marginTop: "0.5rem" }}>
                {errorMsg || "An unknown error occurred during upload."}
              </p>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={() => setStep("preview")}
                style={{
                  background: "#374151",
                  color: "#fff",
                  fontWeight: 700,
                  padding: "0.75rem 1.5rem",
                  borderRadius: "0.5rem",
                  border: "none"
                }}
              >
                Back to Preview
              </button>
              
              <button
                onClick={handleUpload}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  fontWeight: 700,
                  padding: "0.75rem 1.5rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem"
                }}
              >
                <Send size={16} /> Retry
              </button>
            </div>
          </div>
        )}

      </div>

      {/* CSS Animation injection */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }
      `}</style>
    </div>
  );
}
