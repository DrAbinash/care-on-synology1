/**
 * QueueDisplay.tsx — Configurable TV/kiosk queue display
 *
 * Route: /queue/:roomKey  (e.g. caredeoghar.com/queue/usg, /queue/mri, /queue/ct)
 * Also reachable at /display/:roomKey for backward compatibility with any
 * TV already configured with the older URL.
 *
 * This is the SINGLE canonical TV display — a duplicate copy used to exist
 * in diagnostic-erp (routes /queue/:roomKey, /display/:roomKey there) but
 * was unreachable at any real TV URL, since diagnostic-erp is served under
 * the /erp/ path (see docker/nginx.conf) while this page is served at the
 * bare origin. That duplicate was removed; this is the only display page.
 *
 * Supports both portrait (1080x1920, the original signage design — green
 * Now Serving bar, blue Next Patients bar, QR booking card, instruction
 * rows, announcement strip, footer) and landscape (1920x1080, two-column
 * body) orientations, selected per-room via settings.layoutOrientation.
 *
 * Data sources:
 *  - Presentation config: GET /api/settings/queue-display/:roomKey
 *    (branding, layout, theme, kiosk-mode toggles, which cards to show)
 *  - Live token data: reuses the EXISTING /api/display/queue-stream (SSE)
 *    and /api/display/queue (polling fallback) endpoints unchanged — same
 *    display-token auth, same department grouping, same privacy masking.
 *  - Remote commands: GET /api/settings/queue-display/:roomKey/stream (SSE)
 *    lets Settings ▸ Queue Display ▸ Remote Control force a reload.
 *
 * No new queue logic was written. No billing/registration/payment code was
 * touched. Safe for unattended Android TV / Fully Kiosk Browser: no
 * scrollbars, no browser chrome dependencies, auto-reconnecting SSE with a
 * 15s polling fallback, plus kiosk-mode hardening (useKioskMode) — wake
 * lock, auto-fullscreen, offline/staleness auto-reload, remote reload.
 *
 * Also: per-patient wait-time estimate (server-computed, display.ts),
 * optional voice announcement on token change (SpeechSynthesis), a small
 * en/hi label dictionary (settings.language), a branding/video interstitial
 * that takes over the screen periodically (settings.mediaItems), and
 * quiet-hours screen dimming (CSS brightness, not a real power-off).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api";
import { resolveAssetUrl } from "../config";
import { useKioskMode } from "../hooks/useKioskMode";

type InstructionItem = { id: string; icon: string; text: string; color: string; enabled: boolean };
type MediaItem = { id: string; type: "image" | "video"; url: string; durationSeconds: number; enabled: boolean };
type Language = "en" | "hi";

type QueueDisplaySettings = {
  id: number;
  roomKey: string;
  displayName: string;
  location: string;
  logoUrl: string;
  showLogo: boolean;
  showDisplayName: boolean;
  showLocation: boolean;
  roomTitle: string;
  showRoomTitle: boolean;
  showNowServing: boolean;
  showNextPatients: boolean;
  nextPatientCount: number;
  showQrBooking: boolean;
  qrImageUrl: string;
  qrHeading: string;
  qrSubheading: string;
  qrDescription: string;
  qrButtonText: string;
  instructionItems: InstructionItem[];
  showAnnouncement: boolean;
  announcementText: string;
  phone: string;
  showPhone: boolean;
  website: string;
  showWebsite: boolean;
  slogan: string;
  showSlogan: boolean;
  themeMode: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  cardBackgroundColor: string;
  textColor: string;
  layoutOrientation: "portrait" | "landscape";
  kioskWakeLock: boolean;
  kioskAutoFullscreen: boolean;
  kioskAutoReload: boolean;
  kioskPreventExit: boolean;
  showWaitEstimate: boolean;
  voiceAnnouncementEnabled: boolean;
  language: Language;
  showMedia: boolean;
  mediaItems: MediaItem[];
  mediaIntervalMinutes: number;
  mediaDurationSeconds: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursDimPercent: number;
  ledgerId: number;
  departments: string;
};

type TokenEntry = {
  id: number;
  tokenNo: number;
  patientLabel: string;
  testName: string | null;
  floorLabel: string;
  priority: number;
  department?: string;
  roomNumber?: string;
  estimatedWaitMinutes?: number;
};

type DeptCard = {
  department: string;
  roomNumber: string;
  floorLabel: string;
  nowServing: (TokenEntry & { calledAt: string | null }) | null;
  waiting: TokenEntry[];
  waitingCount: number;
};

type DisplayPayload = { date: string; departments: DeptCard[] };

interface QueueDisplayProps {
  roomKey?: string;
}

// "" from settings means "not configured — use the built-in default" (CSS
// var fallback), not "set to an empty color".
function cssVar(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

// Small built-in dictionary for the fixed on-screen labels — not a full
// i18n system, just enough to make the board readable in the clinic's
// primary local language. Admin-entered text (room title, QR heading,
// instructions, announcement, etc.) is already free-text and unaffected.
const LABELS: Record<Language, Record<string, string>> = {
  en: {
    nowServing: "NOW SERVING",
    upNext: "UP NEXT",
    waitingForNext: "Waiting for next token…",
    nextPatients: "NEXT PATIENTS",
    queueClear: "Queue is clear",
    waitSuffix: "min wait",
    proceed: "Please proceed to",
    prepare: "Have your token ready — you will be called shortly",
    queueStats: "in queue",
    estWait: "Est. wait for last in list",
    live: "Live",
    reconnecting: "Updating…",
    vip: "VIP",
    position: "Position",
  },
  hi: {
    nowServing: "अभी बुलाया जा रहा है",
    upNext: "अगला",
    waitingForNext: "अगले टोकन की प्रतीक्षा है…",
    nextPatients: "अगले मरीज़",
    queueClear: "कतार खाली है",
    waitSuffix: "मिनट प्रतीक्षा",
    proceed: "कृपया आगे बढ़ें",
    prepare: "अपना टोकन तैयार रखें — जल्द बुलाया जाएगा",
    queueStats: "कतार में",
    estWait: "अंतिम की अनुमानित प्रतीक्षा",
    live: "लाइव",
    reconnecting: "अपडेट…",
    vip: "VIP",
    position: "क्रम",
  },
};

function t(language: Language | undefined, key: keyof (typeof LABELS)["en"]): string {
  return LABELS[language ?? "en"]?.[key] ?? LABELS.en[key];
}

/** Department prefix for signage tokens — USG-23, MRI-5, etc. */
function tokenPrefix(department: string | undefined, roomKey: string): string {
  const raw = (department || roomKey || "usg").toUpperCase().replace(/[-_\s]+/g, " ").trim();
  if (/\bUSG\b/.test(raw) || raw.startsWith("USG")) return "USG";
  if (/\bMRI\b/.test(raw) || raw.startsWith("MRI")) return "MRI";
  if (/\bCT\b/.test(raw) || raw.startsWith("CT")) return "CT";
  if (/\bX[- ]?RAY\b/.test(raw) || raw.includes("XRAY")) return "X-RAY";
  const word = raw.replace(/\s+ROOM$/i, "").split(/\s+/)[0] ?? "TKN";
  return word.slice(0, 8) || "TKN";
}

function formatTokenLabel(entry: { tokenNo: number; department?: string }, roomKey: string): string {
  return `${tokenPrefix(entry.department, roomKey)}-${entry.tokenNo}`;
}

// "HH:MM" strings compared against the current time, handling ranges that
// wrap past midnight (e.g. 22:00 → 06:00).
function isWithinQuietHours(now: Date, start: string, end: string): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // wraps past midnight
}

export default function QueueDisplay({ roomKey: propRoomKey }: QueueDisplayProps = {}) {
  const params = useParams<{ roomKey: string }>();
  const search = new URLSearchParams(window.location.search);
  // Accept roomKey from prop, URL params, or query string
  // Accept both "/display/usg" and "/display/usg-room" — normalize to the
  // bare key so a TV URL matches the settings row created via the admin UI.
  const rawRoomKey = (propRoomKey || params.roomKey || search.get("roomKey") || "usg").toLowerCase();
  const finalRoomKey = rawRoomKey.replace(/-?room$/, "") || rawRoomKey;
  const displayToken = search.get("displayToken") ?? "";

  const qc = useQueryClient();
  const [now, setNow] = useState(new Date());
  const [streamLive, setStreamLive] = useState(false);
  const [tokenPulse, setTokenPulse] = useState(false);

  // ── Settings (presentation config) ────────────────────────────────────
  const { data: settings, isLoading: settingsLoading, isError: settingsError, error: settingsErrObj } = useQuery<QueueDisplaySettings>({
    queryKey: ["queue-display-settings", finalRoomKey, displayToken],
    queryFn: () => api.queueDisplay.settings(finalRoomKey, displayToken),
    staleTime: 30_000,
    refetchInterval: 60_000, // pick up admin edits without a manual refresh
    retry: 2,
  });

  // Clinic website logo — fallback when queue-display row has no logoUrl yet.
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings-queue-logo"],
    queryFn: () => api.settings(),
    staleTime: 300_000,
    retry: 1,
  });

  // ── Live queue data — reuses the existing display feed, unchanged ──────
  const departments = settings?.departments ? settings.departments.split(",").map(d => d.trim()) : [];

  const { data: queueData } = useQuery<DisplayPayload>({
    queryKey: ["queue-display-feed", finalRoomKey, settings?.ledgerId, departments, displayToken],
    enabled: !!settings,
    queryFn: () => api.queueDisplay.queue(settings?.ledgerId ?? 1, displayToken, undefined, departments),
    refetchInterval: 15_000, // spec: auto-refresh every 15s as a safety net
  });

  useEffect(() => {
    if (!settings || typeof EventSource === "undefined") return;
    const streamUrl = api.queueDisplay.queueStream(settings.ledgerId, displayToken, undefined, departments);
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(streamUrl);
      es.onopen = () => setStreamLive(true);
      es.onmessage = (evt) => {
        if (!evt.data || evt.data.startsWith(":")) return;
        try {
          const payload = JSON.parse(evt.data) as DisplayPayload;
          qc.setQueryData(
            ["queue-display-feed", finalRoomKey, settings.ledgerId, departments, displayToken],
            payload,
          );
          setStreamLive(true);
        } catch { /* ignore malformed event */ }
      };
      es.onerror = () => {
        setStreamLive(false);
        es?.close();
        es = null;
        if (!closed) reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [settings, finalRoomKey, displayToken, departments, qc]);

  // Flatten across department cards (a single-room display usually has one).
  const queueSummary = useMemo(() => {
    const cards = queueData?.departments ?? [];
    const servingCard = cards.find((c) => c.nowServing);
    const serving = servingCard?.nowServing
      ? {
          ...servingCard.nowServing,
          department: servingCard.department,
          roomNumber: servingCard.roomNumber,
          floorLabel: servingCard.nowServing.floorLabel || servingCard.floorLabel,
        }
      : null;
    // Queue order: lowest token number first (matches physical queue / call order).
    const upcoming = cards
      .flatMap((c) =>
        c.waiting.map((w) => ({
          ...w,
          department: c.department,
          roomNumber: c.roomNumber,
          floorLabel: w.floorLabel || c.floorLabel,
        })),
      )
      .filter((w) => w.id !== serving?.id)
      .sort((a, b) => a.tokenNo - b.tokenNo || b.priority - a.priority);
    const totalWaiting = cards.reduce((n, c) => n + c.waitingCount, 0);
    const lastWait = upcoming.length > 0 ? upcoming[upcoming.length - 1]?.estimatedWaitMinutes : undefined;
    const floorHint = serving?.floorLabel || upcoming[0]?.floorLabel || cards[0]?.floorLabel || "";
    return { current: serving, next: upcoming, totalWaiting, lastWait, floorHint };
  }, [queueData]);

  const { current, next, totalWaiting, lastWait, floorHint } = queueSummary;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Pulse the token number briefly when now-serving changes (draws the eye).
  const pulseRef = useRef<number | null>(null);
  useEffect(() => {
    const id = current?.id ?? null;
    if (id === null || pulseRef.current === null) {
      pulseRef.current = id;
      return undefined;
    }
    if (id === pulseRef.current) {
      return undefined;
    }
    pulseRef.current = id;
    setTokenPulse(true);
    const t = setTimeout(() => setTokenPulse(false), 4000);
    return () => clearTimeout(t);
  }, [current?.id]);

  // ── Kiosk-mode hardening — wake lock, fullscreen, watchdog, remote reload
  const [lastDataAt, setLastDataAt] = useState<number | null>(null);
  useEffect(() => {
    if (queueData) setLastDataAt(Date.now());
  }, [queueData]);

  const { needsFullscreenTap, tapToEnterFullscreen } = useKioskMode({
    roomKey: finalRoomKey,
    displayToken,
    wakeLock: settings?.kioskWakeLock ?? true,
    autoFullscreen: settings?.kioskAutoFullscreen ?? true,
    autoReload: settings?.kioskAutoReload ?? true,
    preventExit: settings?.kioskPreventExit ?? true,
    lastDataAt,
  });

  // ── Voice announcement — speak the token number when "now serving" changes.
  // Skips the very first render (a TV that just loaded shouldn't announce
  // whatever was already being served) and only speaks on an actual change.
  const announcedRef = useRef<{ id: number | null; ready: boolean }>({ id: null, ready: false });
  useEffect(() => {
    if (!settings?.voiceAnnouncementEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const currentId = current?.id ?? null;
    if (!announcedRef.current.ready) {
      announcedRef.current = { id: currentId, ready: true };
      return;
    }
    if (currentId === announcedRef.current.id || currentId === null) return;
    announcedRef.current = { id: currentId, ready: true };
    const utter = new SpeechSynthesisUtterance(
      `Token number ${current?.tokenNo}. ${current?.patientLabel || ""}. Please proceed to ${settings.roomTitle || "the counter"}.`,
    );
    utter.lang = settings.language === "hi" ? "hi-IN" : "en-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }, [current?.id, settings?.voiceAnnouncementEnabled, settings?.language, settings?.roomTitle]);

  // ── Branding / video interstitial — full-screen takeover every N minutes.
  const enabledMedia = useMemo(
    () => (settings?.mediaItems ?? []).filter((m) => m.enabled),
    [settings?.mediaItems],
  );
  const [mediaBreak, setMediaBreak] = useState<MediaItem | null>(null);
  const [mediaIndex, setMediaIndex] = useState(0);
  useEffect(() => {
    if (!settings?.showMedia || enabledMedia.length === 0) { setMediaBreak(null); return; }
    const intervalMs = Math.max(1, settings.mediaIntervalMinutes) * 60_000;
    const durationMs = Math.max(3, settings.mediaDurationSeconds) * 1000;
    const startBreak = () => {
      setMediaIndex((i) => {
        const item = enabledMedia[i % enabledMedia.length];
        setMediaBreak(item);
        setTimeout(() => setMediaBreak(null), item.durationSeconds ? item.durationSeconds * 1000 : durationMs);
        return i + 1;
      });
    };
    const t = setInterval(startBreak, intervalMs);
    return () => clearInterval(t);
  }, [settings?.showMedia, settings?.mediaIntervalMinutes, settings?.mediaDurationSeconds, enabledMedia]);

  // ── Quiet hours — dim (not power off) the screen outside clinic hours.
  const dimmed = !!settings?.quietHoursEnabled && isWithinQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd);
  const dimBrightness = dimmed ? Math.max(10, 100 - (settings?.quietHoursDimPercent ?? 40)) : 100;

  // Distinguish "still loading" from "failed to load". Without this the page
  // sits on "Loading display…" forever whenever the settings fetch fails —
  // most commonly a 401 because the TV opened the URL without a ?displayToken.
  if (settingsError && !settings) {
    const msg = settingsErrObj instanceof Error ? settingsErrObj.message : "Could not load display settings.";
    const looksUnauthorized = /401|unauthor|forbidden|token/i.test(msg);
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#03152f", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", padding: "6vw", fontFamily: "Inter, Arial, sans-serif" }}>
        <div style={{ fontSize: 30, fontWeight: 800 }}>Display not available</div>
        <div style={{ fontSize: 20, opacity: 0.85, maxWidth: 640 }}>
          {looksUnauthorized
            ? "This screen needs its display link. Open Settings ▸ Queue Display (TV) in the ERP, copy the “TV browser URL” (it includes the display token), and load that link on this TV."
            : msg}
        </div>
        <div style={{ fontSize: 15, opacity: 0.5 }}>Room: {finalRoomKey}</div>
      </div>
    );
  }

  if (settingsLoading || !settings) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#03152f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, Arial, sans-serif", fontSize: 28 }}>
        Loading display…
      </div>
    );
  }

  const s = settings;
  const nextCount = s.nextPatientCount || 5;
  const nextList = next.slice(0, nextCount);
  const upNext = !current && nextList.length > 0 ? nextList[0] : null;
  // When someone is already serving, show the full live waiting list (12, 13, 14…).
  // UP NEXT mode only splits the list when nobody has been called yet.
  const nextForPanel = current ? nextList : (upNext ? nextList.slice(1) : nextList);
  const enabledInstructions = (s.instructionItems || []).filter((i) => i.enabled);
  const isLandscape = s.layoutOrientation === "landscape";
  const logoSrc = s.logoUrl
    ? resolveAssetUrl(s.logoUrl)
    : siteSettings?.logoUrl
      ? resolveAssetUrl(siteSettings.logoUrl)
      : null;
  const displayName = s.displayName || siteSettings?.siteTitle || "CARE DIAGNOSTICS";
  const locationLabel = s.location || "Deoghar";
  const roomLabel = s.roomTitle || `${finalRoomKey.toUpperCase()} ROOM`;

  return (
    <div
      className={["usg-display", isLandscape ? "landscape" : "portrait", s.kioskPreventExit ? "kiosk-lock" : ""].filter(Boolean).join(" ")}
      style={{
        // Colors are fully configurable via settings — no hardcoded palette.
        // @ts-ignore CSS custom properties
        "--primary-color": s.primaryColor,
        "--secondary-color": s.secondaryColor,
        "--accent-color": s.accentColor,
        "--bg-color": cssVar(s.backgroundColor),
        "--card-bg-color": cssVar(s.cardBackgroundColor),
        "--text-color": cssVar(s.textColor),
        filter: dimBrightness < 100 ? `brightness(${dimBrightness}%)` : undefined,
      }}
    >
      <style>{DISPLAY_CSS}</style>

      {mediaBreak && (
        <div className="media-break">
          {mediaBreak.type === "video" ? (
            <video src={mediaBreak.url} autoPlay muted loop playsInline />
          ) : (
            <img src={mediaBreak.url} alt="" />
          )}
        </div>
      )}

      <header className="top">
        {s.showLogo && logoSrc && (
          <img src={logoSrc} className="logo" alt="" />
        )}
        <div className="top-titles">
          {s.showDisplayName && (
            <h1>{displayName}</h1>
          )}
          {s.showLocation && (
            <p>{locationLabel}</p>
          )}
        </div>
        {s.showRoomTitle && (
          <div className="room-badge">
            <span className="room-icon" aria-hidden="true">🩺</span>
            <span>{roomLabel}</span>
          </div>
        )}
        <div className="top-clock">
          <strong>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
          <span>
            {now.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
            {" · "}
            {now.toLocaleDateString([], { weekday: "long" })}
          </span>
          <span className={`live-dot${streamLive ? " live" : ""}`}>
            <span className="live-ping" />{streamLive ? t(s.language, "live") : t(s.language, "reconnecting")}
          </span>
        </div>
      </header>

      {(totalWaiting > 0 || current) && (
        <div className="queue-stats-bar">
          {current && (
            <span className="stat-chip stat-serving">
              {formatTokenLabel(current, finalRoomKey)} {t(s.language, "nowServing").toLowerCase()}
            </span>
          )}
          {totalWaiting > 0 && (
            <span className="stat-chip">
              <strong>{totalWaiting}</strong> {t(s.language, "queueStats")}
            </span>
          )}
          {s.showWaitEstimate && lastWait != null && lastWait > 0 && (
            <span className="stat-chip stat-wait">
              {t(s.language, "estWait")}: ~{lastWait} {t(s.language, "waitSuffix")}
            </span>
          )}
          {floorHint && (
            <span className="stat-chip stat-floor">📍 {floorHint}</span>
          )}
        </div>
      )}

      <div className="body">
        {s.showNowServing && (
          <section className={`now-card${upNext ? " up-next-mode" : ""}${tokenPulse ? " token-pulse" : ""}`}>
            <div className={`green-bar${upNext ? " up-next-bar" : ""}`}>
              <span>{upNext ? t(s.language, "upNext") : t(s.language, "nowServing")}</span>
            </div>
            {current ? (
              <>
                <h3 className={tokenPulse ? "pulse" : ""}>{formatTokenLabel(current, finalRoomKey)}</h3>
                <h4>{current.patientLabel}</h4>
                <p>
                  {current.testName && <>{current.testName}</>}
                  {current.priority > 0 && <span className="vip-badge">{t(s.language, "vip")}</span>}
                </p>
                <div className="room-strip">
                  📍 {[roomLabel, current.floorLabel].filter(Boolean).join(" · ")}
                </div>
              </>
            ) : upNext ? (
              <>
                <h3>{formatTokenLabel(upNext, finalRoomKey)}</h3>
                <h4>{upNext.patientLabel}</h4>
                <p>{upNext.testName || ""}</p>
                {s.showWaitEstimate && upNext.estimatedWaitMinutes ? (
                  <p className="wait-hint">~{upNext.estimatedWaitMinutes} {t(s.language, "waitSuffix")}</p>
                ) : null}
                <div className="proceed-cta prepare">{t(s.language, "prepare")}</div>
              </>
            ) : (
              <div className="no-serving">{t(s.language, "waitingForNext")}</div>
            )}
          </section>
        )}

        {s.showNextPatients && (
          <section className="next-card">
            <div className="blue-bar">
              {t(s.language, "nextPatients")}
              {nextForPanel.length > 0 && <span className="bar-count"> ({nextForPanel.length})</span>}
            </div>
            {nextForPanel.length === 0 ? (
              <div className="next-empty">{t(s.language, "queueClear")}</div>
            ) : (
              nextForPanel.map((p) => (
                <div className="next-row" key={p.id}>
                  <div className="token-badge">{formatTokenLabel(p, finalRoomKey)}</div>
                  <span>
                    {p.patientLabel}
                    {p.priority > 0 && <span className="vip-badge inline">{t(s.language, "vip")}</span>}
                  </span>
                  {s.showWaitEstimate && p.estimatedWaitMinutes ? (
                    <em>~{p.estimatedWaitMinutes} {t(s.language, "waitSuffix")}</em>
                  ) : (
                    <em>{p.testName || ""}</em>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        <div className="right-col">
        {s.showQrBooking && (() => {
          const fallbackTarget = s.website
            ? (s.website.startsWith("http") ? s.website : `https://${s.website}`).replace(/\/+$/, "") + "/book"
            : `${window.location.origin}/book`;
          return (
            <section className="qr-card">
              {s.qrHeading && <h3>{s.qrHeading}</h3>}
              {s.qrSubheading && <h2>{s.qrSubheading}</h2>}
              {s.qrDescription && <p>{s.qrDescription}</p>}
              {s.qrImageUrl ? (
                <img src={resolveAssetUrl(s.qrImageUrl)} className="qr" alt="Booking QR code" />
              ) : (
                <div className="qr qr-auto">
                  <QRCodeSVG value={fallbackTarget} size={256} level="M" includeMargin={false} />
                </div>
              )}
              {s.qrButtonText && <div className="qr-btn">{s.qrButtonText}</div>}
            </section>
          );
        })()}

        {enabledInstructions.length > 0 && (
          <section className="instruction-row" style={{ gridTemplateColumns: `repeat(${Math.min(enabledInstructions.length, 3)}, 1fr)` }}>
            {enabledInstructions.map((i) => (
              <div className="instruction" key={i.id} style={{ borderColor: i.color, color: i.color }}>
                <span>{i.icon}</span>
                <p>{i.text}</p>
              </div>
            ))}
          </section>
        )}
        </div>
      </div>

      {s.showAnnouncement && s.announcementText && (
        <section className="announcement-row">
          <div className="announcement">🔔 {s.announcementText}</div>
          <div className="thank-you">Thank You! <span aria-hidden="true">❤️</span></div>
        </section>
      )}

      <footer>
        {s.showPhone && s.phone && <span>☎ {s.phone}</span>}
        <span className="footer-time">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
          {now.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        {s.showWebsite && s.website && <span>🌐 {s.website}</span>}
      </footer>
      {s.showSlogan && s.slogan && <div className="slogan-strip">{s.slogan}</div>}

      {needsFullscreenTap && (
        <button type="button" className="fullscreen-tap" onClick={tapToEnterFullscreen}>
          ⛶ Tap for fullscreen
        </button>
      )}
    </div>
  );
}

function roomKeyLabel(roomTitle: string): string {
  return roomTitle || "";
}

// Scoped CSS — kept in-file (no Tailwind dependency needed for a fixed
// signage layout) and driven entirely by --primary/secondary/accent/bg/
// card-bg/text custom properties from settings, per DEVELOPMENT_PRINCIPLES
// ("never hardcode" applies to colors/branding just as much as IPs/ports).
const DISPLAY_CSS = `
.usg-display {
  width: 100vw;
  height: 100vh;
  background: var(--bg-color, linear-gradient(180deg, #03152f, #05295a));
  color: var(--text-color, white);
  font-family: Inter, Arial, sans-serif;
  padding: 2.2vh 2.2vw;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}
.usg-display * { box-sizing: border-box; }
.usg-display.kiosk-lock { user-select: none; -webkit-user-select: none; cursor: none; }

/* Header — logo left, clinic centre, room badge, clock right (reference layout) */
.top {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 1.4vw;
  flex-shrink: 0;
  margin-bottom: 0.8vh;
  padding: 0.4vh 0.2vw;
}
.logo {
  width: 7vh;
  height: 7vh;
  object-fit: contain;
  border-radius: 10px;
  background: white;
  padding: 5px;
  flex-shrink: 0;
}
.top-titles { min-width: 0; text-align: left; }
.top-titles h1 {
  font-size: clamp(2.6vh, 3.4vw, 3.8vh);
  margin: 0;
  color: var(--primary-color, #4ee24e);
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1.1;
}
.top-titles p {
  font-size: 1.9vh;
  margin: 0.2vh 0 0;
  opacity: 0.9;
  font-weight: 700;
}
.room-badge {
  display: flex;
  align-items: center;
  gap: 0.6vw;
  font-size: clamp(2.4vh, 3vw, 3.4vh);
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.room-icon { font-size: 1.1em; }
.top-clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15vh;
  font-size: 1.45vh;
  font-weight: 700;
  opacity: 0.92;
  flex-shrink: 0;
}
.top-clock strong {
  font-size: 2.2vh;
  font-variant-numeric: tabular-nums;
}
.live-dot {
  display: flex;
  align-items: center;
  gap: 0.4vw;
  font-size: 1.3vh;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.65;
}
.live-dot.live { opacity: 1; color: #4ade80; }
.live-dot .live-ping {
  width: 0.7vh;
  height: 0.7vh;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}
.live-dot.live .live-ping {
  animation: live-pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 6px #4ade80;
}
@keyframes live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

.queue-stats-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.8vw;
  margin-bottom: 1vh;
  flex-shrink: 0;
}
.stat-chip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  padding: 0.5vh 1.2vw;
  font-size: 1.55vh;
  font-weight: 700;
}
.stat-chip strong { font-size: 1.8vh; margin-right: 0.2vw; }
.stat-serving { background: rgba(74, 222, 128, 0.15); border-color: rgba(74, 222, 128, 0.4); color: #86efac; }
.stat-wait { color: var(--accent-color, #fde047); }
.stat-floor { opacity: 0.9; }

.body { display: contents; }
.right-col { display: contents; }
.now-card, .next-card, .qr-card, .announcement, footer {
  border-radius: 18px;
  border: 2px solid var(--secondary-color, #1687ff);
  background: var(--card-bg-color, #06224a);
  margin-bottom: 1.4vh;
  overflow: hidden;
  flex-shrink: 0;
}
.green-bar { background: var(--primary-color, #03a814); font-size: 2.6vh; font-weight: 900; padding: 1.2vh; text-align: center; display: flex; flex-direction: column; gap: 0.2vh; }
.green-bar .bar-sub, .blue-bar .bar-count { font-size: 1.4vh; font-weight: 600; opacity: 0.75; letter-spacing: 0.03em; }
.blue-bar .bar-count { opacity: 0.85; }
.green-bar.up-next-bar { background: #2563eb; }
.now-card.up-next-mode { border-color: #2563eb; }
.now-card.token-pulse { box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.5); }
.blue-bar { background: var(--secondary-color, #075fe0); font-size: 2.3vh; font-weight: 900; padding: 1.2vh; text-align: center; }
.now-card { background: white; color: #00143d; text-align: center; flex: 1.6; display: flex; flex-direction: column; justify-content: center; min-height: 0; transition: box-shadow 0.3s ease; }
.now-card h3 { font-size: 9vh; margin: 1.4vh 0 0.2vh; line-height: 1; font-weight: 900; }
.now-card h3.pulse { animation: token-flash 0.8s ease-in-out 3; }
@keyframes token-flash {
  0%, 100% { transform: scale(1); color: #00143d; }
  50% { transform: scale(1.06); color: var(--primary-color, #03a814); }
}
.now-card h4 { font-size: 3.6vh; margin: 0 0 0.8vh; font-weight: 800; text-transform: uppercase; }
.now-card p { font-size: 1.9vh; font-weight: 700; min-height: 2.4vh; margin: 0 0 0.6vh; }
.now-card p.wait-hint { color: #2563eb; font-size: 2.2vh; margin-bottom: 0.8vh; }
.proceed-cta {
  background: var(--primary-color, #08a51a);
  color: white;
  font-size: 2.2vh;
  font-weight: 900;
  padding: 1.2vh 1.5vw;
  margin-top: auto;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.proceed-cta.prepare { background: #2563eb; font-size: 1.8vh; font-weight: 700; text-transform: none; }
.vip-badge {
  display: inline-block;
  background: #d97706;
  color: white;
  font-size: 1.4vh;
  font-weight: 900;
  padding: 0.2vh 0.6vw;
  border-radius: 6px;
  margin-left: 0.5vw;
  vertical-align: middle;
}
.vip-badge.inline { font-size: 1.2vh; margin-left: 0.4vw; }
.now-card p span { color: inherit; margin-left: 0; }
.no-serving { font-size: 3vh; font-weight: 700; color: #64748b; padding: 6vh 0; }
.room-strip { background: var(--primary-color, #08a51a); color: white; font-size: 2.4vh; font-weight: 900; padding: 1.2vh; }
.next-card { flex: 1.6; display: flex; flex-direction: column; min-height: 0; }
.next-row {
  display: grid;
  grid-template-columns: minmax(4.8em, 7vh) 1fr auto;
  align-items: center;
  gap: 1vw;
  background: white;
  color: #061942;
  font-size: 2vh;
  padding: 1vh 1.4vw;
  border-bottom: 1px solid #cbd8ee;
}
.next-row:last-child { border-bottom: none; }
.next-empty { background: white; color: #64748b; text-align: center; padding: 3vh; font-size: 2vh; }
.token-badge {
  background: var(--secondary-color, #075fe0);
  color: white;
  border-radius: 8px;
  padding: 0.55vh 0.5vw;
  text-align: center;
  font-size: clamp(1.5vh, 1.9vh, 2.2vh);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 3.2em;
  line-height: 1.2;
}
.next-row span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: uppercase; }
.next-row em { font-style: normal; text-align: right; opacity: 0.7; font-size: 1.6vh; white-space: nowrap; }
.qr-card { text-align: center; padding: 1.6vh; flex: 2.4; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; }
.qr-card h3 { color: var(--primary-color, #60e243); font-size: 2.2vh; margin: 0; letter-spacing: 0.04em; }
.qr-card h2 { font-size: 3.4vh; margin: 0.4vh 0 0.8vh; font-weight: 900; }
.qr-card p { font-size: 1.7vh; margin: 0 0 1.2vh; opacity: 0.9; max-width: 80%; }
.qr { width: min(32vh, 60vw); height: min(32vh, 60vw); background: white; padding: 1.2vh; border-radius: 14px; }
.qr-auto { display: flex; align-items: center; justify-content: center; }
.qr-auto svg { width: 100%; height: 100%; }
.qr-btn {
  margin-top: 1.2vh;
  background: var(--primary-color, #44c72f);
  border-radius: 30px;
  padding: 1vh 3vw;
  font-size: 1.9vh;
  font-weight: 900;
  display: inline-block;
}
.instruction-row { display: grid; gap: 1vw; margin-bottom: 1.4vh; flex-shrink: 0; }
.instruction {
  border-radius: 14px;
  border: 1.5px solid;
  background: var(--card-bg-color, #06224a);
  padding: 1.2vh 0.8vw;
  text-align: center;
  font-weight: 700;
}
.instruction span { font-size: 3.2vh; display: block; margin-bottom: 0.4vh; }
.instruction p { font-size: 1.5vh; margin: 0; color: #e5e7eb; }
.announcement-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1vw;
  margin-bottom: 1vh;
  flex-shrink: 0;
}
.announcement {
  padding: 1.2vh 1.4vw;
  font-size: 2vh;
  font-weight: 800;
  color: var(--accent-color, #ffe600);
  text-align: left;
  border-radius: 14px;
  border: 2px solid var(--secondary-color, #1687ff);
  background: var(--card-bg-color, #06224a);
}
.thank-you {
  font-size: 2.4vh;
  font-weight: 800;
  font-style: italic;
  white-space: nowrap;
  padding: 0 0.5vw;
}
footer {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 1.2vh;
  font-size: 1.7vh;
  font-weight: 700;
  text-align: center;
  flex-shrink: 0;
  gap: 1vw;
}
.footer-time { opacity: 0.85; }
.slogan-strip {
  background: var(--secondary-color, #075fe0);
  text-align: center;
  padding: 1vh;
  font-weight: 800;
  font-size: 1.8vh;
  border-radius: 14px;
  flex-shrink: 0;
}

/* ── Landscape — Now Serving | Next Patients | QR + instructions ─────── */
.usg-display.landscape .top { margin-bottom: 0.6vh; }
.usg-display.landscape .queue-stats-bar { justify-content: flex-start; margin-bottom: 0.6vh; }
.usg-display.landscape .body {
  display: grid;
  grid-template-columns: 1.15fr 1fr 0.88fr;
  grid-template-areas: "now next side";
  gap: 1.2vh 1.4vw;
  flex: 1;
  min-height: 0;
}
.usg-display.landscape .now-card { grid-area: now; margin-bottom: 0; }
.usg-display.landscape .next-card { grid-area: next; margin-bottom: 0; overflow: auto; }
.usg-display.landscape .right-col {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 1vh;
  min-height: 0;
  overflow: hidden;
}
.usg-display.landscape .qr-card { margin-bottom: 0; flex: 1; min-height: 0; }
.usg-display.landscape .instruction-row {
  display: flex;
  flex-direction: column;
  gap: 0.8vh;
  margin-bottom: 0;
  overflow: auto;
}
.usg-display.landscape .instruction {
  display: flex;
  align-items: center;
  gap: 0.8vw;
  text-align: left;
  padding: 0.9vh 1vw;
}
.usg-display.landscape .instruction span { margin-bottom: 0; font-size: 2.2vh; }

/* ── Branding / video interstitial — full-screen takeover ─────────────── */
.media-break {
  position: absolute;
  inset: 0;
  z-index: 500;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.media-break img, .media-break video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* ── Kiosk fullscreen-tap fallback — shown only until fullscreen granted ─ */
.fullscreen-tap {
  position: absolute;
  bottom: 1.5vh;
  right: 1.5vw;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 10px;
  padding: 0.8vh 1.2vw;
  font-size: 1.6vh;
  font-family: inherit;
  cursor: pointer;
  z-index: 999;
}
`;
