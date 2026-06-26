# DEP_SOP_001: Reception, Queue & Kiosk Operations
## Care Diagnostics ERP Standard Operating Procedure

---

## 1. Purpose & Scope
*   **Purpose**: Ensure smooth patient flow, clear queue assignments, and correct usage of self-service kiosks.
*   **Scope**: Hospital lobby, reception counter, and self-registration kiosks.
*   **Responsibility**: Receptionists, Lobby Managers, and Kiosk Attendants.

---

## 2. Step-by-Step Workflow

### A. Patient Greeting & Queue Ticket Generation
1.  Greet the patient.
2.  If the patient has a pre-booked appointment (online or call):
    *   Search their name or booking code on the **Appointments Screen**.
    *   Confirm check-in time.
    *   Click **Check-In** to generate a queue number (e.g. `Q-101`).
3.  If the patient is a walk-in:
    *   Generate a token based on the required department (Radiology, Pathology, USG).
    *   Direct them to the waiting area.

### B. Self-Registration Kiosk Operation
1.  Assist elderly or non-technical patients at the touch-screen kiosk.
2.  The kiosk prompts: "New Patient" or "Returning Patient".
3.  For **Returning Patient**: Prompt them to place their finger on the USB scanner or enter their mobile number.
4.  For **New Patient**: Prompt them to enter phone number, name, and age.
5.  Select required tests -> Kiosk displays payment options.
6.  The patient scans the QR code or pays cash at the Billing Desk using the printed queue slip.

---

## 3. ERP Modules & Screens Involved
*   **Queue Dashboard**: `http://<local-ip>:8888/erp/queue`
*   **Appointments Calendar**: `http://<local-ip>:8888/erp/appointments`
*   **Kiosk Interface**: Configured on local touch-screen terminals.

---

## 4. Common Errors & Troubleshooting

| Error | Cause | Corrective Action / Troubleshooting |
| :--- | :--- | :--- |
| **Kiosk fingerprint scanner not responding** | The Windows Biometric Bridge service is stopped on the terminal client. | Restart the service: Open Command Prompt, run `nssm restart DiagnoFingerprintBridge` or notify IT. |
| **Token printer jam** | Thermal paper roll is empty or misaligned. | Open printer cover, replace thermal paper roll with shiny side facing up. Run a self-test feed. |

---

## 5. Escalation Path
1.  **Level 1**: Lobby Manager (for queue disputes).
2.  **Level 2**: IT Helpdesk (for printer/kiosk computer freezes).
3.  **Level 3**: IT Admin (for database or local bridge service errors).

---

## 6. Daily Checklist
- [ ] Thermal paper rolls checked and stocked at reception and kiosks.
- [ ] Kiosk screen sanitized and touch controls verified responsive.
- [ ] Biometric fingerprint scanner cleaned with isopropyl alcohol.

---

## 7. Revision History
*   **v1.0 (June 2026)**: Initial Release.
*   *Author*: Operations Audit Team
