# Security deployment checklist

Use this checklist before exposing a Care Diagnostics deployment beyond local/LAN testing.

## Admin and super-admin access

- Change the bootstrap account PIN immediately after first login.
- Remove `BOOTSTRAP_ADMIN_FORCE` after any one-time reset.
- Set a strong `BOOTSTRAP_ADMIN_PIN` if a bootstrap account must be created during deployment.
- Enable WebAuthn/passkey enrollment for `admin` and `super_admin` users.
- Keep super-admin USB gate enforcement enabled in production.
- Review active staff sessions after every role/permission change.

## Secrets and environment

- Set strong, unique values for `JWT_SECRET`, `SESSION_SECRET`, backup passphrases, payment gateway secrets, WhatsApp tokens, and integration partner secrets.
- Do not reuse staging secrets in production.
- Confirm deployment logs redact tokens, database URLs, and PHI before sharing logs externally.

## Network posture

- Keep Postgres bound to loopback or the private Docker network.
- Expose only the web/API entrypoint required by the clinic.
- Keep Orthanc/OHIF, OCR, AI, and scanner bridges on LAN unless explicitly required.

## Operational proof

- Run `pnpm operations:verify-deployment` or the Admin Operational Health smoke test after deployment.
- Confirm backups are encrypted and restore verification is green.
- Confirm WhatsApp/payment integrations use production credentials only in production.
- Confirm public report/payment links expire as expected.

## Audit review

- Verify audit logs are written for report verification, bill edits, refunds, role changes, and integration delivery.
- Export and retain audit evidence according to the clinic retention policy.
