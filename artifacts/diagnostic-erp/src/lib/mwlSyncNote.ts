/**
 * What the modality was actually told after a referring-doctor correction.
 *
 * `PATCH /api/radiology/pacs-worklist/:id/referring-doctor` answers with the MWL
 * republish outcome and the workspace used to ignore it, so the desk saw
 * "Referring doctor set" while the console still held the name the radiologist
 * had just replaced — and, for a study that was never published, while there was
 * no worklist item to correct at all. The sentence is what makes that state
 * visible at the moment it is created.
 *
 * Silence is deliberate for the states that are normal for this clinic: no
 * worklist folder configured (`skipped`), and a booked test the machine is not
 * supposed to be handed (`withheld`, whose file was removed rather than rewritten).
 */
export type MwlSyncOutcome = {
  attempted?: boolean;
  action?: string;
  written?: boolean;
} | null | undefined;

export function mwlSyncNote(outcome: MwlSyncOutcome): string | null {
  if (!outcome || typeof outcome.action !== "string") return null;
  if (outcome.action === "no_procedure_row")
    return "this study has no worklist entry, so nothing was sent to the machine";
  if (outcome.action === "failed")
    return "the worklist file could not be rewritten";
  if (outcome.action === "written" && outcome.written === false)
    return "the worklist file could not be rewritten";
  return null;
}

/** The toast line: the name that was set, plus the worklist verdict when it is not simply "done". */
export function referringDoctorToastDescription(
  referringDoctor: string | null,
  outcome: MwlSyncOutcome,
): string {
  const name = referringDoctor || "Cleared";
  const note = mwlSyncNote(outcome);
  return note ? `${name} — ${note}` : name;
}
