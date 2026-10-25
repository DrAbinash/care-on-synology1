/**
 * The delivery counter's permission vocabulary, in one place.
 *
 * `requireStaffPermission("/report-delivery")` already treats a stored
 * `"/report-delivery:handover"` as holding the module
 * (middleware/requireStaffAuth.ts:264), and Settings → Users renders sub-permission
 * ticks for any module listed in MODULE_SUB_PERMISSIONS, so these four actions
 * need no new permission machinery — only one agreed spelling of them. The
 * spelling used to be invented per call site, which is how `deliveryMode:
 * "HANDED"` came to sit outside the documented values of the table storing it.
 *
 * Nothing here is granted by default. That is deliberate for the endpoints that
 * are NEW (the custody ledger routes in PR-3/PR-4): failing closed costs an admin
 * assignment step but strands nobody, because no workflow uses them yet. It is
 * deliberately NOT applied to the existing counter route, whose current operators
 * cannot be derived from this repository — see requireStaffAnyModule.
 */
export const DELIVERY_MODULE = "/report-delivery";

export const DELIVERY_ACTIONS = ["view", "receive", "handover", "correct"] as const;

export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];
