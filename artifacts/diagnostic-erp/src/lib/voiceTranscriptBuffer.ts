/**
 * Pure interim/final transcript buffer for radiology dictation.
 * Finals append once; interim is display-only and never committed twice.
 */

export type VoiceTranscriptBuffer = {
  committed: string;
  interim: string;
};

export function emptyVoiceTranscriptBuffer(): VoiceTranscriptBuffer {
  return { committed: "", interim: "" };
}

export function voiceTranscriptDisplay(buf: VoiceTranscriptBuffer): string {
  const c = buf.committed.trim();
  const i = buf.interim.trim();
  if (!c) return i;
  if (!i) return c;
  return `${c} ${i}`.replace(/\s+/g, " ").trim();
}

/** Append a final recognition segment exactly once (idempotent on exact trailing duplicate). */
export function appendFinalTranscript(
  buf: VoiceTranscriptBuffer,
  segment: string,
): VoiceTranscriptBuffer {
  const t = segment.replace(/\s+/g, " ").trim();
  if (!t) return { ...buf, interim: "" };
  const committed = buf.committed.trim();
  if (!committed) return { committed: t, interim: "" };
  // Prevent classic restart/dup: "mild disc" + "mild disc bulge" when engine re-emits prefix.
  if (t === committed || committed.endsWith(t)) {
    return { committed, interim: "" };
  }
  if (t.startsWith(committed) && t.length > committed.length) {
    return { committed: t, interim: "" };
  }
  return { committed: `${committed} ${t}`.replace(/\s+/g, " ").trim(), interim: "" };
}

export function setInterimTranscript(
  buf: VoiceTranscriptBuffer,
  interim: string,
): VoiceTranscriptBuffer {
  return { ...buf, interim: interim.replace(/\s+/g, " ").trim() };
}

export function clearInterimTranscript(buf: VoiceTranscriptBuffer): VoiceTranscriptBuffer {
  return { ...buf, interim: "" };
}
