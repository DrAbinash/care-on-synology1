# Care Diagnostics — Orthanc config (NAS)

Copy these files to your Synology care-pacs stack:

| Repo file | NAS path |
|-----------|----------|
| `docker/orthanc/orthanc.json` | `/volume1/docker/care-pacs/orthanc/config/orthanc.json` |
| `docker/orthanc/auto_pull.lua` | `/volume1/docker/care-pacs/orthanc/scripts/auto_pull.lua` |

Then restart:

```bash
cd /volume1/docker/care-pacs/orthanc
docker compose restart care-orthanc
docker logs care-orthanc --tail 50
```

## What this config includes

- **DICOMweb + WADO** — OHIF and ERP viewer (`8042/dicom-web`, `8042/wado`)
- **Worklists (MWL)** — shared folder `/var/lib/orthanc/worklists` (same host path as ERP `ORTHANC_WORKLIST_DIR`)
- **`SetStudyInstanceUidIfMissing`** — prevents housekeeper crash on legacy `.wl` files with empty StudyInstanceUID
- **`DeleteWorklistsOnStableStudy`** — removes MWL entry once images arrive
- **Modalities** — UIH MRI, CT, GE Voluson, X-ray, Weasis
- **`auto_pull.lua`** — logs only; study sync is `care-erp-sync` container

## If Orthanc was crash-looping

Remove bad worklist files once, then redeploy this config and re-sync MWL from ERP:

```bash
rm /volume1/docker/care-pacs/orthanc/worklists/*.wl
docker restart care-orthanc
```

ERP: **Settings → Radiology → Sync MWL files now** (after API deploy with MWL UID fix).
