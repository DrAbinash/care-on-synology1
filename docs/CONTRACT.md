# Versioned interchange (CARE ↔ 225app)

Keep this file aligned with `https://github.com/DrAbinash/225app` `lib/emergency-billing`.

| Constant | Payload |
| --- | --- |
| `CARE_EMERGENCY_MASTER_V1` | Master snapshot (`format` + `version: 1`) CARE → DS225+ |
| `CARE_EMERGENCY_BILLING_V1` | CSV of emergency transactions DS225+ → CARE |
| `CARE_EMERGENCY_BILLING_JSON_V1` | JSON package of sessions + transactions DS225+ → CARE |

Unknown `format` or `version` values must be rejected with an explicit error. Do not coerce a future schema into the current one.
