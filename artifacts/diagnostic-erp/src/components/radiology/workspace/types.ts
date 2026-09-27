/**
 * View-model for RadiologyReportingWorkspace shell columns.
 *
 * Generated from `useWorkspaceClinicalUi`'s returned object literal via
 * `ReturnType` — all keys and exact inferred member types. Adding/removing a
 * key on the clinical UI return updates this contract automatically.
 *
 * Top-level members are not `any`. Nested `any` appears only where third-party
 * APIs parameterize with it (see PR description):
 *   - `navigate` — wouter's `navigate<S = any>(...)`
 *   - `toast` — shadcn/useToast props bag (DOM/`slot` widenings)
 */
import type { useWorkspaceClinicalUi } from "@/hooks/radiology-workspace/useWorkspaceClinicalUi";

export type RadiologyWorkspaceVm = ReturnType<typeof useWorkspaceClinicalUi>;

/** Compile-time guard: fail typecheck if a top-level Vm key regresses to `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;
type TopLevelAnyKeys = {
  [K in keyof RadiologyWorkspaceVm]-?: IsAny<RadiologyWorkspaceVm[K]> extends true ? K : never;
}[keyof RadiologyWorkspaceVm];
type AssertNoTopLevelAny = TopLevelAnyKeys extends never ? true : ["TOP_LEVEL_ANY", TopLevelAnyKeys];
const _assertNoTopLevelAny: AssertNoTopLevelAny = true;
void _assertNoTopLevelAny;
