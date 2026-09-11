-- Point LAN OHIF base at the clinic HTTPS hostname (Synology reverse proxy +
-- Pi-hole split DNS → 172.16.1.139:3010). HTTPS ERP pages can then embed OHIF
-- without mixed-content blocking. Does NOT touch DICOMweb/WADO keys.
--
-- Only rewrites known legacy plain-http LAN values so an admin who already
-- set a custom ohif_base_url is left alone.

UPDATE pacs_settings
SET
  value = 'https://ohif.caredeoghar.com',
  updated_at = NOW()
WHERE key = 'ohif_base_url'
  AND category = 'viewer'
  AND value IN (
    'http://172.16.1.139:3000',
    'http://172.16.1.139:3010',
    'http://192.168.1.137:3010',
    'http://192.168.1.137:3000',
    'http://127.0.0.1:3010',
    'http://127.0.0.1:3000'
  );
