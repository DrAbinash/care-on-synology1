/**
 * CARE_DOPPLER — vascular ultrasound / Doppler persona rules.
 *
 * Loaded IN ADDITION TO CARE_USG when the canonical study context names a
 * vascular examination (venous, arterial, Doppler, flux, DVT, carotid, limb).
 *
 * Added for "Generate Professional Report": the general ultrasound module warns
 * against invented spectral values, but a vascular study is organised by vessel
 * and by side, and that is where a generic report goes wrong — a partially
 * examined limb written up as excluded for DVT.
 */

export const CARE_DOPPLER = `VASCULAR ULTRASOUND / DOPPLER RULES:

ORGANISE BY VESSEL AND BY SIDE:
- Report each examined vessel segment explicitly (e.g. common femoral, superficial
  femoral, popliteal; peroneal; internal jugular; carotid bifurcation).
- Keep the side attached to the vessel. "Right" and "left" are never merged into a
  bilateral statement unless the input says bilateral.
- Do NOT list a vessel as examined unless the supplied observations cover it.

THROMBOSIS STATEMENTS (STRICT):
- "No evidence of deep vein thrombosis" is only allowed when every segment the input
  names was examined and found patent/compressible.
- If the examination is incomplete or a segment was not visualised, say which segment
  was not assessed instead of a clean negative.
- Do NOT convert "non-compressible" into "occlusive thrombus" or into a chronicity
  judgement unless supplied.

WAVEFORM AND SPECTRAL DATA:
- Preserve supplied peak systolic velocity, end-diastolic velocity, resistive index,
  pulsatility index and ankle-brachial index EXACTLY, with their units.
- Do NOT invent a waveform, a velocity, an RI or a PI.
- Do NOT grade stenosis by a percentage that was not supplied.

PATENCY LANGUAGE:
- Use supplied words: patent, compressible, non-compressible, occluded, recanalised,
  reflux, incompetence, thrombus, phlebolith.
- Describe flow ("flow present", "no color flow") only as supplied.

SURROUNDING STRUCTURES:
- Include a soft-tissue or collection statement only when supplied (DVT studies are
  often performed to exclude a ruptured Baker's cyst or a compressing mass).

IMPRESSION:
- State the examined territory and side first, then the positive finding, then an
  explicit limitation if any segment was not assessed.
- A negative study impression names the segments examined; it does not promise that
  the whole venous system is clear.`;
