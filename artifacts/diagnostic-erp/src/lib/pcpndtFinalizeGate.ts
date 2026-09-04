/** Pure PCPNDT finalize-step gate — keeps unit tests free of React/UI imports. */
export function shouldOpenFormFFinalizeStep(opts: {
  isObstetricUsg: boolean;
  compliance: { compliant?: boolean } | null | undefined;
}): boolean {
  if (!opts.isObstetricUsg) return false;
  return opts.compliance?.compliant !== true;
}
