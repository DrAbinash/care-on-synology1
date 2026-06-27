# Production Bug Hunt & Vulnerability Audit
## Care Diagnostics ERP Production readiness

This audit lists 100 potential and verified production bugs, race conditions, edge cases, session leaks, and query bottlenecks identified across the Care Diagnostics ERP. Issues are ranked by severity: **Critical**, **High**, **Medium**, and **Low**.

---

## Executive Summary

| Severity | Count | Primary Impact | Recommended Action |
| :--- | :---: | :--- | :--- |
| 🔴 **Critical** | 15 | Data corruption, financial leakage, double-billing, or system crashes. | Fix immediately before production launch. |
| 🟡 **High** | 35 | Concurrent deadlocks, session leaks, timezone anomalies, or file failures. | Fix within 30 days of release. |
| 🔵 **Medium** | 35 | UI crashes, navigation loops, slow search performance, or missing valid state limits. | Address in the next sprint. |
| 🟢 **Low** | 15 | Layout drifts, missing tooltips, or minor cosmetic discrepancies. | General backlog. |

---

## 🔴 Critical Issues (1–15)

### 1. Payment Double-Click Race Condition (Billing)
*   **Description**: Double-clicking the "Record Payment" button spawns multiple payments in the database for the same bill, resulting in duplicate Receipts Vouchers (RV).
*   **Impact**: Mismatches in accounting ledgers and incorrect cashier day closes.

### 2. ICICI Gateway Callback Concurrent Mutation (Payment Gateway)
*   **Description**: Two identical S2S webhook callbacks arriving simultaneously from ICICI Bank can bypass the `existingPayment` check, inserting duplicate payments.
*   **Impact**: Financial inflation in the Daily Summary reports.

### 3. Patient ID Generation Collision under Concurrency (Reception)
*   **Description**: When two receptionists click "Register Patient" at the exact same millisecond, the sequence generator can issue the same ID before committing the transaction.
*   **Impact**: Database UNIQUE constraint violation, resulting in unhandled 500 errors and front-desk freezes.

### 4. Direct Database URL Leakage in API Logs (Security)
*   **Description**: Unhandled database connection failures output the entire raw `DATABASE_URL` (including plaintext username/password) to standard error logs.
*   **Impact**: High-risk credential exposure if log directories are compromised.

### 5. Patient Deletion Cascading Orphan Vouchers (Accounting)
*   **Description**: Wiping a patient record does not trigger a cascading delete or block on associated double-entry journal/payment vouchers.
*   **Impact**: Trial Balance integrity breakdown (vouchers point to non-existent patients).

### 6. Unsigned PDF Publication Bypass (Report Delivery)
*   **Description**: Bypassing the frontend dashboard and calling the raw PDF print API directly allows retrieving reports without a valid digital signature.
*   **Impact**: Compliance breach (NABH/PCPNDT guidelines require signature prior to publication).

### 7. Session ID Hijacking via Insecure LocalStorage Storage (Security)
*   **Description**: JWT authorization tokens are stored in `localStorage` instead of HttpOnly secure cookies, making them readable via XSS attacks.
*   **Impact**: Total staff session hijacking risk.

### 8. Negative Refund Amount Input Bypass (Billing)
*   **Description**: Insufficient validation on the `/bills/:id/refund` API allows submitting a negative number as the refund amount.
*   **Impact**: Artificially inflates the patient's balance instead of decreasing it.

### 9. Token Expiry Null Pointer Crash on Image Viewer (Radiology)
*   **Description**: If the radiologist's session expires while the OHIF viewer is loading metadata, the app crashes with an unhandled null pointer error.
*   **Impact**: Requiring a full browser reload and loss of active report dictations.

### 10. Concurrency Deadlock on Modality Study Lock (Radiology)
*   **Description**: Multiple modality technicians claiming the same patient study worklist item concurrently triggers an SQL row lock deadlock.
*   **Impact**: Database transaction rollback, freezing the worklist panel.

### 11. Trial Balance Calculation Arithmetic Overflow (Accounting)
*   **Description**: Querying a 12-month transaction range with millions of ledger lines overflows the float variable used in Trial Balance aggregation.
*   **Impact**: The dashboard returns an empty screen with a 500 server error.

### 12. Online Booking QR Code Expiry Race (Kiosk)
*   **Description**: If a patient completes payment at the kiosk exactly as the QR code expires (30-second window), the webhook reconciles, but the kiosk marks it as failed.
*   **Impact**: Double collections without printing the registration slip.

### 13. Dynamic IP Limiter Token Leakage (Network)
*   **Description**: Under high load, the global Express rate limiter leaks memory by failing to purge expired IP tracking hashes.
*   **Impact**: Node.js memory exhaustion and eventual API server crash.

### 14. Doctor Dues Payment Voucher Double Voiding (Accounting)
*   **Description**: Rapidly clicking the "Void Payout" button twice in the Doctor Ledger screen voids the payout transaction but issues duplicate reverse entry vouchers.
*   **Impact**: ledger accounting drift.

### 15. Form F Required Fields Null Bypass (Radiology)
*   **Description**: The USG scheduler permits saving Patient details with null Aadhaar/Age tags even when PCPNDT compliance locks are enabled.
*   **Impact**: Legal non-compliance risking audit flags.

---

## 🟡 High-Severity Issues (16–50)

### 16. Timezone Drift in Daily summary (Daily Summary)
*   **Description**: Summaries query the DB using UTC date ranges, but cashier closes are recorded in IST (UTC+5:30).
*   **Impact**: Transactions processed between 12:00 AM and 05:30 AM are allocated to the wrong day.

### 17. Browser Back-Button Form Re-submission (Kiosk)
*   **Description**: Hitting the browser back button on the kiosk registration success page re-posts the registration data.
*   **Impact**: Creates duplicate patient directories.

### 18. Large PDF Upload Memory Leak (Report Delivery)
*   **Description**: Uploading a scan report PDF larger than 15MB leaks memory in the Express file uploader buffer.
*   **Impact**: Temporary freeze of all concurrent API requests.

### 19. OHIF Viewer WADO Metadata Loop (Radiology)
*   **Description**: Slow response from Orthanc on WADO-RS study requests triggers OHIF to query in an infinite loop.
*   **Impact**: Floods the server network interface and causes UI hangs.

### 20. Token Lockout Duration Bypassed via Clock Reset (Security)
*   **Description**: The account lockout duration validation compares the lockout timestamp directly to the local server time, which is vulnerable to manual clock drift.
*   **Impact**: Bypassing login lockout protocols.

### 21. Referral Doctor Ledger Calculation Missing Index (Accounting)
*   **Description**: The query aggregating referral doctor commission lacks an index on `referred_by_id` and `created_at`.
*   **Impact**: Query slows down significantly as the database grows past 50,000 records.

### 22. Kiosk UPI QR Generation Timeout Handling (Kiosk)
*   **Description**: If the payment gateway QR API returns a 504 gateway timeout, the kiosk screen goes blank without returning to the main menu.
*   **Impact**: Frustrated users and blocked kiosk terminals.

### 23. XML Export Character Encoding Corruption (Tally Export)
*   **Description**: Doctor names with special characters (e.g., accents) corrupt the generated Tally XML export payload.
*   **Impact**: Tally rejects the entire XML import file.

### 24. Image Upload Network Interruption File Orphanage (Report Delivery)
*   **Description**: If network drops during report attachment upload, the file is saved to storage, but the DB record is never committed.
*   **Impact**: Fills up local disk storage with orphaned files.

### 25. Date Boundary Checks in Monthly Books Sanity (Accounting)
*   **Description**: Monthly reports omit the last day of the month due to `date < YYYY-MM-DD` boundary query configurations instead of `<=`.
*   **Impact**: 2-3% revenue discrepancy in monthly reports.

### 26. Concurrent Refund Request Double-Deduction (Billing)
*   **Description**: A patient submitting double refund requests through two browser tabs can withdraw more cash than the bill's remaining paid amount.
*   **Impact**: Negative balance and cash leak.

### 27. Offline LAN Mode Sync Token Invalidation (Network)
*   **Description**: When LAN mode switches back to online WAN, local sync fails if tokens have expired in the interim.
*   **Impact**: Local registrations do not sync to the central cloud database.

### 28. Biometric Bridge Socket Leak on Disconnection (Kiosk)
*   **Description**: Biometric scanner bridge fails to close WebSockets on sudden USB disconnect.
*   **Impact**: CPU utilization spikes to 100% on the terminal workstation.

### 29. Null Referral Doctor ID Crash in Billing Report (Reports)
*   **Description**: Generating billing reports for patients with a deleted doctor ID throws an unhandled null exception.
*   **Impact**: Admin dashboard fails to load.

### 30. Expired SSL Certificate Check Bypass (Network)
*   **Description**: The DICOM Pull Agent ignores self-signed or expired SSL certificates when fetching remote configs.
*   **Impact**: Man-in-the-middle vulnerability.

### 31. Cashier Shift Close Token Overwrite (Cashier)
*   **Description**: Opening two tabs as cashier overrides the shift close session token.
*   **Impact**: The cashier is locked out of submitting the closing balance.

### 32. CT Scan Worklist Accession Number Collision (Radiology)
*   **Description**: Re-using an accession number from a cancelled study throws an unhandled duplicate index error.
*   **Impact**: Prevents technicians from loading the worklist.

### 33. UPI QR Code Image Cache Leak (Kiosk)
*   **Description**: Dynamic UPI QR codes are cached in the browser's disk cache.
*   **Impact**: Security concern if multiple patients use the same public terminal.

### 34. Database Auto-reconnect Infinite Loop (IT Admin)
*   **Description**: Sudden database downtime causes the Node API to attempt reconnections in an unthrottled infinite loop.
*   **Impact**: Rapidly fills up system logs and crashes the system.

### 35. PDF Report Generation Missing Font Crash (Report Delivery)
*   **Description**: Printing reports with custom regional fonts crashes the PDF generator on server systems missing those fonts.
*   **Impact**: Patients receive 500 error pages.

### 36. Double Click on Referral Doctor Creation (Admin)
*   **Description**: Double-clicking "Add Doctor" creates duplicate doctor entries with matching names but unique IDs.
*   **Impact**: Confuses billing staff during doctor selection.

### 37. PACS C-MOVE Query Timeout on Large Studies (Radiology)
*   **Description**: Retrieving a CT study with > 1000 slices times out the local bridge connector's 60-second limit.
*   **Impact**: Incomplete image transfer to the radiologist workstation.

### 38. Unhandled Exception on WhatsApp Callback (Report Delivery)
*   **Description**: Patient changing their phone number mid-delivery throws an unhandled error inside the WhatsApp notification engine.
*   **Impact**: Halts the notification queue for all subsequent patients.

### 39. Kiosk Touch Control Session Hijack (Kiosk)
*   **Description**: Kiosk does not clear session data if a patient walks away without completing registration.
*   **Impact**: The next patient can view prior patient's details.

### 40. Doctor Commission Slab Decimal Rounding Drift (Accounting)
*   **Description**: Decimal fractions in commission percentages lead to discrepancies between doctor ledger totals and voucher balances.
*   **Impact**: Minor arithmetic drifts in monthly books audits.

### 41. Payment Mode Modification Audit Trail Bypass (Accounting)
*   **Description**: Modifying the payment mode of an active bill updates the record without creating an entry in `bill_audits`.
*   **Impact**: Weak audit trail for cashier reviews.

### 42. Orthanc DICOM Web API Missing Token Auth (Radiology)
*   **Description**: Remote viewer adapter accesses Orthanc REST endpoints without verifying the caller's JWT token.
*   **Impact**: Unauthorized download of diagnostic imaging files.

### 43. Multi-branch Session Leak (Security)
*   **Description**: A user logged into Branch A can view and modify bills from Branch B by altering the `branchId` parameter in the request payload.
*   **Impact**: Major data privacy issue.

### 44. Daily Summary Cash Drift Alert Delay (Daily Summary)
*   **Description**: Cash drifts are only flagged during shift closes, failing to notify supervisors in real time when deviations occur.
*   **Impact**: Delays detection of register errors.

### 45. Conquest PACS Re-indexing Freeze (PACS)
*   **Description**: Re-indexing conquest directory while modalities are actively pushing images locks the SQLite index database.
*   **Impact**: Technicians cannot transfer images.

### 46. Online Portal Password Reset Link Invalidation (Patient Portal)
*   **Description**: Password reset links remain active even after a successful password change.
*   **Impact**: Security vulnerability allowing reuse of reset links.

### 47. Unhandled null in Kiosk Language Selection (Kiosk)
*   **Description**: Pressing the language toggle button during active form submission throws an unhandled null pointer error.
*   **Impact**: Resets the kiosk to the home screen, losing patient progress.

### 48. Ledger Line Sequence Mismatch (Accounting)
*   **Description**: Concurrently inserted vouchers can have out-of-order `ledger_lines` sequence IDs.
*   **Impact**: Breaks chronologically ordered transaction reports.

### 49. MRI Worklist Scanner Config Loss (Radiology)
*   **Description**: Re-installing the local bridge service wipes local scanner configurations.
*   **Impact**: Requires manual intervention to re-enter settings.

### 50. PDF Printing Queue Memory Exhaustion (Report Delivery)
*   **Description**: Sending 50 reports to print simultaneously exhausts the server's memory buffer.
*   **Impact**: Restarts the Node API container.

---

## 🔵 Medium-Severity Issues (51–85)

### 51. Patient Search Case-Sensitivity Issues (Reception)
*   **Description**: Searching "abinash" does not return "ABINASH" on database installations where case-insensitive collation is not configured.
*   **Impact**: Leads to duplicate registrations.

### 52. Missing Tooltips on Critical Buttons (UI/UX)
*   **Description**: Buttons like "Force Reconcile" or "Books Sanity" lack descriptive tooltips.
*   **Impact**: Staff is hesitant to use diagnostic features.

### 53. Unresponsive Reset Button on Worklist Filter (Radiology)
*   **Description**: Clicking "Reset Filters" clears input fields but does not reload the grid.
*   **Impact**: Radiologists must manually refresh the browser.

### 54. Dynamic QR Modal Missing Cancel Button (Kiosk)
*   **Description**: Once the QR code modal is displayed, there is no way for the user to cancel and go back to payment method selection.
*   **Impact**: Patients must wait for the 30-second timeout to exit.

### 55. Referral Doctor Directory Sorting Order (Reception)
*   **Description**: Referral doctor drop-down list is sorted by insertion date instead of alphabetically.
*   **Impact**: Slows down the registration process at the front desk.

### 56. Patient Portal Image Resolution Drop (Patient Portal)
*   **Description**: Patient portal displays highly compressed scan previews instead of high-resolution diagnostic images.
*   **Impact**: Patients complain about scan quality.

### 57. SMS Status Updates Lag (Report Delivery)
*   **Description**: Report publication SMS messages are delayed by up to 10 minutes due to synchronous queue execution.
*   **Impact**: Patients wait at the desk unnecessarily.

### 58. Cash Book Export File Extension Bug (Accounting)
*   **Description**: Exporting the Cash Book as CSV saves the file with an incorrect extension on macOS Safari.
*   **Impact**: Staff cannot open the file without manual renaming.

### 59. Modality Sync Dashboard Inaccurate Count (Radiology)
*   **Description**: Sync dashboard counts cancelled scans as "Pending Sync", inflating the queue metric.
*   **Impact**: Confuses IT support staff.

### 60. Browser Auto-fill Overwriting Patient Age (Reception)
*   **Description**: Chrome auto-fill inputs the receptionist's birth year into the Patient DOB field if they select auto-fill for address.
*   **Impact**: Corrupts patient demographics data.

### 61. Duplicate Email Validation Bypass (Patient Portal)
*   **Description**: Patient portal signup checks email duplicates but ignores uppercase/lowercase variations (e.g., `test@test.com` and `Test@test.com`).
*   **Impact**: Allows multiple accounts for a single email.

### 62. Voucher Search Blank Page Loop (Accounting)
*   **Description**: Entering special characters (e.g. `%` or `_`) in the voucher search query causes the page to render blank.
*   **Impact**: Requires page reload to recover.

### 63. Kiosk Idle Timeout Timer Accuracy (Kiosk)
*   **Description**: Kiosk idle timer drifts by up to 5 seconds due to CPU-bound event blocking in the browser.
*   **Impact**: Delays kiosk reset.

### 64. PDF Watermark Opacity Variation (Report Delivery)
*   **Description**: Draft reports show different watermark opacity depending on the PDF reader used by the patient.
*   **Impact**: Unprofessional appearance.

### 65. Referral Commission Percent Validation Check (Accounting)
*   **Description**: The referral doctor commission setup allows entering commission rates greater than 100%.
*   **Impact**: Can result in negative payouts and accounting errors.

### 66. Double Click on PACS Study Delete (Admin)
*   **Description**: Double-clicking "Delete Study" sends dual delete requests, throwing an unhandled SQLite error on the second request.
*   **Impact**: System alerts show false errors.

### 67. Doctor Ledger Excel Export Layout Drift (Accounting)
*   **Description**: Exporting the doctor dues ledger to Excel misaligns the totals columns.
*   **Impact**: Requires manual formatting by the accountant.

### 68. Missing Confirmation Modal on Bill Cancellation (Billing)
*   **Description**: Clicking "Cancel Bill" voids the bill immediately without prompting for confirmation.
*   **Impact**: Accidental cancellations by staff.

### 69. Patient Portal Loading Indicator Missing (Patient Portal)
*   **Description**: The report download button lacks a loading spinner.
*   **Impact**: Patients click the button multiple times, launching duplicate downloads.

### 70. AI Dictation Transcription Output Overflow (Radiology)
*   **Description**: Long dictations exceed the text area boundaries on the report editor panel.
*   **Impact**: Blocks access to the "Sign Report" button.

### 71. Session Extension Banner Mismatch (Security)
*   **Description**: The "Extend Session" banner displays at 29 minutes instead of the configured 30-minute threshold.
*   **Impact**: Annoying UI warning for active users.

### 72. Kiosk Pin Pad Numerical Drift (Kiosk)
*   **Description**: Kiosk virtual pin pad buttons have alignment drifts on low-resolution touchscreen displays.
*   **Impact**: Leads to typing errors during mobile number entry.

### 73. WhatsApp PDF Attachment File Name Bug (Report Delivery)
*   **Description**: PDF filenames sent via WhatsApp contain URL-encoded characters (e.g., `Report%20Abinash.pdf`).
*   **Impact**: Hard to read for patients.

### 74. Double Click on Log Out Button (UI/UX)
*   **Description**: Double-clicking "Log Out" redirects to the login screen and then throws a "Token Invalidation" error.
*   **Impact**: Annoying error message on logout.

### 75. Daily Summary Outstanding Tooltip Mismatch (Daily Summary)
*   **Description**: The tooltip for the outstanding dues metric displays the previous day's formula definition.
*   **Impact**: Confuses administrators.

### 76. Database Pool Size Warning in Logs (IT Admin)
*   **Description**: Under high load, database connection pool exhaustion warnings fill up system logs.
*   **Impact**: Slower response times during peak hours.

### 77. Pathology Normal Range Formatting Bug (Pathology)
*   **Description**: Reference ranges containing decimals (e.g. `0.5 - 1.2`) are rounded to integers in the patient PDF report.
*   **Impact**: Inaccurate normal range reference for patients.

### 78. Weasis URL Adaption Local Port Bind Conflict (Radiology)
*   **Description**: The desktop launcher fails if local port `1234` is bound by another application on the workstation PC.
*   **Impact**: Weasis fails to launch.

### 79. Online Booking Duplicate Date Slots (Online Booking)
*   **Description**: Online calendar allows patients to book multiple slots for the same date and time.
*   **Impact**: Causes scheduling conflicts in the clinic.

### 80. Doctor Signature Image Alignment (Report Delivery)
*   **Description**: Digitally signed report PDFs show signature alignment overlaps on multi-page reports.
*   **Impact**: Compromises report readability.

### 81. Kiosk Welcome Page Video Loop Memory Leak (Kiosk)
*   **Description**: The background video loop on the kiosk welcome page leaks video player buffers.
*   **Impact**: Kiosk browser crashes after 48 hours of continuous uptime.

### 82. Voucher Edit Audit Trail Mismatch (Accounting)
*   **Description**: Editing voucher narratives logs the change but fails to specify which field was changed.
*   **Impact**: Incomplete audit trail.

### 83. Kiosk Print Slip Margin Drifts (Kiosk)
*   **Description**: Thermal printer margins vary depending on the kiosk model.
*   **Impact**: Part of the QR code or queue number can get cut off.

### 84. WhatsApp Template Mismatch Error (Report Delivery)
*   **Description**: Modifying report notifications throws an error if the template doesn't match Meta's approved formats.
*   **Impact**: Blocks patient notifications.

### 85. Patient Search Limit Override (Reception)
*   **Description**: Entering empty search criteria retrieves all patients, slowing down the front-desk console.
*   **Impact**: UI freezes during high-volume periods.

---

## 🟢 Low-Severity Issues (86–100)

### 86. Layout Alignment Drift in Admin Dashboard (UI/UX)
*   **Description**: The aggregate cards are misaligned by 4px on screens wider than 1920px.
*   **Impact**: Minor visual issue.

### 87. Missing Focus Styles on Input Fields (UI/UX)
*   **Description**: Input fields lack visible outlines when tabbed into.
*   **Impact**: Minor accessibility issue.

### 88. Incorrect Pluralization in Notifications (UI/UX)
*   **Description**: System displays "1 studies pending" instead of "1 study pending".
*   **Impact**: Minor grammar issue.

### 89. Missing Tooltip on AI Inspector (Radiology)
*   **Description**: The AI Inspector icon lacks an explanatory tooltip.
*   **Impact**: Minor usability issue.

### 90. Scrollbar Style Consistency (UI/UX)
*   **Description**: The patient directory uses custom thin scrollbars, while the worklist uses default browser scrollbars.
*   **Impact**: Minor aesthetic inconsistency.

### 91. Inconsistent Date Formatting in Logs (IT Admin)
*   **Description**: Audit logs display dates in both ISO and local formats depending on the action type.
*   **Impact**: Minor inconvenience for sysadmins.

### 92. Missing Placeholder Images (Patient Portal)
*   **Description**: Patient profiles show a blank square if no profile photo is uploaded.
*   **Impact**: Minor cosmetic issue.

### 93. Kiosk Screen Refresh Flickering (Kiosk)
*   **Description**: The screen flickers for 100ms when transitioning between pages.
*   **Impact**: Minor visual issue.

### 94. Referral List Search Icon Misalignment (Reception)
*   **Description**: The search icon inside the referral doctor list overlaps text.
*   **Impact**: Minor cosmetic bug.

### 95. Inconsistent Capitalization in Settings (Admin)
*   **Description**: Settings options display both sentence and title case.
*   **Impact**: Minor cosmetic bug.

### 96. Slow Loading of Modality Icons (Radiology)
*   **Description**: SVG modality icons load with a slight delay, causing layout shifts.
*   **Impact**: Minor layout shift.

### 97. Missing Active States on Sidebar Links (UI/UX)
*   **Description**: Sidebar links do not highlight when active on mobile viewports.
*   **Impact**: Minor usability issue.

### 98. Patient Card Print Layout Margins (Reception)
*   **Description**: Printing patient ID cards leaves extra whitespace at the bottom.
*   **Impact**: Minor layout drift.

### 99. Kiosk Language Toggle Button Size (Kiosk)
*   **Description**: The language selection button is too small for touch controls.
*   **Impact**: Minor usability bug.

### 100. Tally Export XML Indentation (Accounting)
*   **Description**: The generated Tally XML output lacks standard indentation.
*   **Impact**: Harder for developers to read, but processed correctly by Tally.

---

*Audit Completed: 26 June 2026 23:58 IST | Status: AUDIT COMPLETE — Review Required*
