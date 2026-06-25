# Patient Self-Registration Kiosk

## Is it possible?
Yes. The ERP can support a self-registration kiosk where patients enter their details, capture a photo, scan an ID/QR code, and create a queued registration for staff approval or direct billing.

## Recommended devices
- Touchscreen kiosk PC or Android tablet
- Webcam or document camera
- QR/barcode scanner
- Thermal printer for token/receipt
- UPS or battery backup
- Optional: fingerprint reader for repeat patient lookup
- Optional: passport-size photo camera
- Optional: card reader if you want ID-based lookup

## Build steps
1. Create a kiosk mode in the ERP with a minimal UI.
2. Add patient self-registration form with validation.
3. Support photo capture and ID scan.
4. Generate a temporary registration token or queue entry.
5. Push the registration to staff review or auto-create a patient record based on rules.
6. Add device support for scanner, camera, and printer.
7. Add kiosk auth/session isolation so patients cannot access staff data.
8. Add logging and retry handling for offline or device failures.
9. Test the complete kiosk flow end-to-end.

## Scope options
- Basic: patient fills form and gets queue token
- Standard: form + photo + ID scan + printout
- Advanced: form + biometrics + OCR + auto-merge with existing patient records

## Before building
Decide whether the kiosk should:
- only pre-register patients, or
- fully create patient records and bills automatically.

