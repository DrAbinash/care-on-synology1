/**
 * Same-origin DICOMweb base for browser QIDO/WADO used by Report Images /
 * Print Images. Proxied through the ERP API (staff session + Orthanc auth)
 * so it works even when Orthanc :8042 is blocked by CORS / Basic auth from
 * the SPA — while the OHIF iframe can still use its own /dicom-web proxy.
 */
export const BROWSER_DICOMWEB_BASE = "/api/radiology/dicom-web";
