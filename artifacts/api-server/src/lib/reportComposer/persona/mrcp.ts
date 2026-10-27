/**
 * CARE_MRCP — MR cholangiopancreatography persona rules.
 *
 * Loaded IN ADDITION TO the general MRI rules when the canonical study context
 * names an MRCP / biliary / pancreatic-duct examination.
 *
 * Added for "Generate Professional Report": an MRCP is a heavily T2 fluid sequence
 * study, usually without contrast and often without a full diagnostic abdomen
 * protocol. Routing it through the generic MRI path is how a report ends up
 * claiming enhancement, gallstone sensitivity or a liver parenchymal diagnosis
 * that the acquisition never supported.
 */

export const CARE_MRCP = `MRCP RULES:

WHAT MRCP IS:
- Primarily a T2-weighted fluid-sensitive bile-duct / pancreatic-duct study, commonly
  without ionising radiation and commonly without IV contrast.
- Do NOT describe contrast enhancement, arterial or portal venous phase behaviour unless
  the supplied technique explicitly includes contrast.
- Do NOT claim a full diagnostic abdominal MRI, liver-specific contrast agent, MR
  angiography or diffusion findings unless supplied.

DUCTAL FINDINGS:
- Report the intrahepatic ducts, common bile duct, cystic duct and pancreatic duct
  separately, only where the input covers them.
- Preserve supplied duct calibre measurements exactly, with units (mm).
- Preserve supplied stone/obstruction words: filling defect, calculus, abrupt
  cut-off, transition, upstream dilatation, tapering.
- Do NOT turn "prominent CBD" into "choledocholithiasis", and do NOT call a filling
  defect a stone unless supplied.
- Pancreatic duct dilatation and parenchymal change stay as supplied; do not infer
  pancreatitis, IgG4 disease or malignancy from calibre alone.

NEGATIVE STATEMENTS:
- "No filling defect" / "no ductal dilatation" only for the segments actually covered
  by the input.
- Do NOT state that gallstones are excluded — MRCP has limited sensitivity for small
  gallbladder stones; if the input does not address the gallbladder, say it was not
  assessed rather than calling it normal.

CORRELATION:
- When the input names a suspected obstruction without a demonstrable cause, preserve
  that uncertainty in the Impression; do not resolve it into a diagnosis.

IMPRESSION:
- Summarise the ductal anatomy, any obstruction with its level and cause if supplied,
  and the pancreatic duct.
- Recommendations only when supplied or when an obstructing cause is clearly named in
  the input (e.g. surgical or endoscopic correlation).`;
