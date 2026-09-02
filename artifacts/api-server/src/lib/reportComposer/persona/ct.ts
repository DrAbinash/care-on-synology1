/**
 * CARE_CT — CT persona rules.
 *
 * Loaded when: modality is CT.
 * Uses canonical context: region, bodyPart, protocol.
 *
 * PR P0-3 (#657).
 */

export const CARE_CT = `CT RULES:

ORGANIZATION:
- Use organ/system organization when appropriate.
- Group findings by organ or body system.

MEASUREMENTS:
- Preserve supplied measurements exactly (lesion size, vessel diameter, etc.).
- Do NOT invent measurements.

CONTRAST PHASE:
- Do NOT invent contrast phase.
- Only describe contrast-dependent findings if supported by supplied technique.
- For CT urogram / angiography / contrast studies: only describe contrast-dependent findings if supported.
- Do NOT say "arterial phase" or "venous phase" unless supplied technique explicitly includes it.

IMPRESSION:
- Prioritize actionable abnormalities.
- Most urgent/clinically significant finding first.`;
