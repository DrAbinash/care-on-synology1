/**
 * QueueDisplay.tsx — Configurable TV/kiosk queue display (portrait, 9:16)
 *
 * Route: /queue/:roomKey  (e.g. caredeoghar.com/queue/usg, /queue/mri, /queue/ct)
 * Also reachable at /display/:roomKey for backward compatibility with any
 * TV already configured with the older URL.
 *
 * This is an ENHANCEMENT alongside the existing Display.tsx (landscape,
 * multi-department grid board), not a replacement. Display.tsx remains
 * unchanged and continues to serve its existing waiting-room TVs.
 *
 * This page targets a single room's single-department "now serving + next
 * patients" board in portrait orientation (1080x1920 target), matching the
 * reference signage design (green Now Serving bar, blue Next Patients bar,
 * QR booking card, instruction rows, announcement strip, footer).
 *
 * Data sources:
 *  - Presentation config: GET /api/settings/queue-display/:roomKey
 *    (branding, which cards to show, QR image, instruction text, colors)
 *  - Live token data: reuses the EXISTING /api/display/queue-stream (SSE)
 *    and /api/display/queue (polling fallback) endpoints unchanged — same
 *    display-token auth, same department grouping, same privacy masking.
 *
 * No new queue logic was written. No billing/registration/payment code was
 * touched. Safe for unattended Android TV / Fully Kiosk Browser: no
 * scrollbars, no browser chrome dependencies, auto-reconnecting SSE with an
 * 15s polling fallback per the existing Display.tsx pattern.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

type InstructionItem = { id: string; icon: string; text: string; color: string; enabled: boolean };

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

  return (
    <div
      className="usg-display"
      style={{
        // Colors are fully configurable via settings — no hardcoded palette.
        // @ts-ignore CSS custom properties
        "--primary-color": s.primaryColor,
        "--secondary-color": s.secondaryColor,
        "--accent-color": s.accentColor,
      }}
    >
      <style>{DISPLAY_CSS}</style>

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

      {s.showNowServing && (
        <section className="now-card">
          <div className="green-bar">NOW SERVING</div>
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
            <div className="no-serving">Waiting for next token…</div>
          )}
        </section>
      )}

      {s.showNextPatients && (
        <section className="next-card">
          <div className="blue-bar">NEXT PATIENTS</div>
          {nextList.length === 0 ? (
            <div className="next-empty">Queue is clear</div>
          ) : (
            nextList.map((p) => (
              <div className="next-row" key={p.id}>
                <b>{p.tokenNo}</b>
                <span>{p.patientLabel}</span>
                <em>{p.testName || ""}</em>
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
    </div>
  );
}

function roomKeyLabel(roomTitle: string): string {
  return roomTitle || "";
}

// Scoped CSS — kept in-file (no Tailwind dependency needed for a fixed
// 1080x1920 signage layout) and driven entirely by --primary/secondary/accent
// custom properties from settings, per DEVELOPMENT_PRINCIPLES ("never
// hardcode" applies to colors/branding just as much as IPs and ports).
const DISPLAY_CSS = `
.usg-display {
  width: 100vw;
  height: 100vh;
  background: linear-gradient(180deg, #03152f, #05295a);
  color: white;
  font-family: Inter, Arial, sans-serif;
  padding: 2.2vh 2.2vw;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.usg-display * { box-sizing: border-box; }
.top { display: flex; align-items: center; gap: 1.6vw; justify-content: center; flex-shrink: 0; }
.logo { width: 6vh; height: 6vh; object-fit: contain; border-radius: 8px; background: white; padding: 4px; }
.top h1 { font-size: 3.4vh; margin: 0; color: var(--primary-color, #4ee24e); text-align: center; }
.top p { font-size: 1.9vh; margin: 2px 0 0; text-align: center; opacity: 0.85; }
.room-title { margin: 1.6vh 0 1.2vh; text-align: center; flex-shrink: 0; }
.room-title h2 { font-size: 3vh; font-weight: 800; margin: 0; letter-spacing: 0.02em; }
.now-card, .next-card, .qr-card, .announcement, footer {
  border-radius: 18px;
  border: 2px solid var(--secondary-color, #1687ff);
  background: #06224a;
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
  background: #06224a;
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
`;
