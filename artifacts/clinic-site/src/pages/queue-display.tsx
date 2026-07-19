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
import { api } from "../api";
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
    waitingForNext: "Waiting for next token…",
    nextPatients: "NEXT PATIENTS",
    queueClear: "Queue is clear",
    waitSuffix: "min wait",
  },
  hi: {
    nowServing: "अभी बुलाया जा रहा है",
    waitingForNext: "अगले टोकन की प्रतीक्षा है…",
    nextPatients: "अगले मरीज़",
    queueClear: "कतार खाली है",
    waitSuffix: "मिनट प्रतीक्षा",
  },
};

function t(language: Language | undefined, key: keyof (typeof LABELS)["en"]): string {
  return LABELS[language ?? "en"]?.[key] ?? LABELS.en[key];
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

  // ── Settings (presentation config) ────────────────────────────────────
  const { data: settings, isLoading: settingsLoading, isError: settingsError, error: settingsErrObj } = useQuery<QueueDisplaySettings>({
    queryKey: ["queue-display-settings", finalRoomKey, displayToken],
    queryFn: () => api.queueDisplay.settings(finalRoomKey, displayToken),
    staleTime: 30_000,
    refetchInterval: 60_000, // pick up admin edits without a manual refresh
    retry: 2,
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
    const es = new EventSource(streamUrl);
    es.onmessage = (evt) => {
      if (!evt.data || evt.data.startsWith(":")) return;
      try {
        const payload = JSON.parse(evt.data) as DisplayPayload;
        qc.setQueryData(
          ["queue-display-feed", finalRoomKey, settings.ledgerId, departments, displayToken],
          payload,
        );
      } catch { /* ignore malformed event */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [settings, finalRoomKey, displayToken, departments, qc]);

  // Flatten across department cards (a single-room display usually has one).
  const { current, next } = useMemo(() => {
    const cards = queueData?.departments ?? [];
    const serving = cards.find((c) => c.nowServing)?.nowServing ?? null;
    const upcoming = cards.flatMap((c) => c.waiting.map((w) => ({ ...w, roomNumber: c.roomNumber })));
    return { current: serving, next: upcoming };
  }, [queueData]);

  // ── Live clock ───────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
  const enabledInstructions = (s.instructionItems || []).filter((i) => i.enabled);
  const isLandscape = s.layoutOrientation === "landscape";

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
        {s.showLogo && s.logoUrl && <img src={s.logoUrl} className="logo" alt="" />}
        <div>
          {s.showDisplayName && <h1>{s.displayName}</h1>}
          {s.showLocation && s.location && <p>{s.location}</p>}
        </div>
      </header>

      {s.showRoomTitle && (
        <section className="room-title">
          <h2>{s.roomTitle}</h2>
        </section>
      )}

      <div className="body">
        {s.showNowServing && (
          <section className="now-card">
            <div className="green-bar">{t(s.language, "nowServing")}</div>
            {current ? (
              <>
                <h3>#{current.tokenNo}</h3>
                <h4>{current.patientLabel}</h4>
                <p>
                  {current.testName && <>{current.testName}</>}
                  {current.priority > 0 && <span> · VIP</span>}
                </p>
                <div className="room-strip">
                  {[roomKeyLabel(s.roomTitle), current.floorLabel].filter(Boolean).join(" · ")}
                </div>
              </>
            ) : (
              <div className="no-serving">{t(s.language, "waitingForNext")}</div>
            )}
          </section>
        )}

        {s.showNextPatients && (
          <section className="next-card">
            <div className="blue-bar">{t(s.language, "nextPatients")}</div>
            {nextList.length === 0 ? (
              <div className="next-empty">{t(s.language, "queueClear")}</div>
            ) : (
              nextList.map((p) => (
                <div className="next-row" key={p.id}>
                  <b>{p.tokenNo}</b>
                  <span>{p.patientLabel}</span>
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

        {s.showQrBooking && s.qrImageUrl && (
          <section className="qr-card">
            <h3>{s.qrHeading}</h3>
            <h2>{s.qrSubheading}</h2>
            <p>{s.qrDescription}</p>
            <img src={s.qrImageUrl} className="qr" alt="Booking QR code" />
            <div className="qr-btn">{s.qrButtonText}</div>
          </section>
        )}

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

      {s.showAnnouncement && s.announcementText && (
        <section className="announcement">🔔 {s.announcementText}</section>
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
.top { display: flex; align-items: center; gap: 1.6vw; justify-content: center; flex-shrink: 0; }
.logo { width: 6vh; height: 6vh; object-fit: contain; border-radius: 8px; background: white; padding: 4px; }
.top h1 { font-size: 3.4vh; margin: 0; color: var(--primary-color, #4ee24e); text-align: center; }
.top p { font-size: 1.9vh; margin: 2px 0 0; text-align: center; opacity: 0.85; }
.room-title { margin: 1.6vh 0 1.2vh; text-align: center; flex-shrink: 0; }
.room-title h2 { font-size: 3vh; font-weight: 800; margin: 0; letter-spacing: 0.02em; }
.body { display: contents; }
.now-card, .next-card, .qr-card, .announcement, footer {
  border-radius: 18px;
  border: 2px solid var(--secondary-color, #1687ff);
  background: var(--card-bg-color, #06224a);
  margin-bottom: 1.4vh;
  overflow: hidden;
  flex-shrink: 0;
}
.green-bar { background: var(--primary-color, #03a814); font-size: 2.6vh; font-weight: 900; padding: 1.2vh; text-align: center; }
.blue-bar { background: var(--secondary-color, #075fe0); font-size: 2.3vh; font-weight: 900; padding: 1.2vh; text-align: center; }
.now-card { background: white; color: #00143d; text-align: center; flex: 1.6; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
.now-card h3 { font-size: 9vh; margin: 1.4vh 0 0.2vh; line-height: 1; font-weight: 900; }
.now-card h4 { font-size: 3.6vh; margin: 0 0 1.2vh; font-weight: 800; }
.now-card p { font-size: 1.9vh; font-weight: 700; min-height: 2.4vh; margin: 0 0 1vh; }
.now-card p span { color: #d97706; margin-left: 10px; }
.no-serving { font-size: 3vh; font-weight: 700; color: #64748b; padding: 6vh 0; }
.room-strip { background: var(--primary-color, #08a51a); color: white; font-size: 2.4vh; font-weight: 900; padding: 1.2vh; }
.next-card { flex: 1.6; display: flex; flex-direction: column; min-height: 0; }
.next-row {
  display: grid;
  grid-template-columns: 5.5vh 1fr auto;
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
.next-row b { background: var(--secondary-color, #075fe0); color: white; border-radius: 8px; padding: 0.6vh; text-align: center; font-size: 2vh; }
.next-row span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next-row em { font-style: normal; text-align: right; opacity: 0.7; font-size: 1.6vh; white-space: nowrap; }
.qr-card { text-align: center; padding: 1.6vh; flex: 2.4; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; }
.qr-card h3 { color: var(--primary-color, #60e243); font-size: 2.2vh; margin: 0; letter-spacing: 0.04em; }
.qr-card h2 { font-size: 3.4vh; margin: 0.4vh 0 0.8vh; font-weight: 900; }
.qr-card p { font-size: 1.7vh; margin: 0 0 1.2vh; opacity: 0.9; max-width: 80%; }
.qr { width: min(32vh, 60vw); height: min(32vh, 60vw); background: white; padding: 1.2vh; border-radius: 14px; }
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
.announcement { padding: 1.4vh; font-size: 2vh; font-weight: 800; color: var(--accent-color, #ffe600); text-align: center; flex-shrink: 0; }
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

/* ── Landscape (1920x1080-style) layout — two-column body ────────────── */
.usg-display.landscape .body {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  grid-template-rows: 1fr auto;
  grid-template-areas: "now qr" "next instructions";
  gap: 1.2vh 1.6vw;
  flex: 1;
  min-height: 0;
}
.usg-display.landscape .now-card { grid-area: now; margin-bottom: 0; }
.usg-display.landscape .next-card { grid-area: next; margin-bottom: 0; overflow: auto; }
.usg-display.landscape .qr-card { grid-area: qr; margin-bottom: 0; }
.usg-display.landscape .instruction-row {
  grid-area: instructions;
  display: flex;
  flex-direction: column;
  gap: 1vh;
  margin-bottom: 0;
  overflow: auto;
}
.usg-display.landscape .instruction { display: flex; align-items: center; gap: 0.8vw; text-align: left; padding: 1vh 1vw; }
.usg-display.landscape .instruction span { margin-bottom: 0; font-size: 2.4vh; }

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
