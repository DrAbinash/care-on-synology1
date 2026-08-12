/**
 * VoiceBar — retired. The modular workspace uses a single Care voice session
 * (useVoiceSession + VoiceCommandBar + FieldCareMic). Kept as a no-op export
 * so any stale imports fail closed instead of mounting a second mic path.
 */
export function VoiceBar(_props: { voice?: unknown }) {
  return null;
}
