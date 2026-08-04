# Modality Worklist (MWL) — Simple Setup

Bill a USG → patient name appears on the ultrasound machine → scan returns to ERP automatically.

## What you need

| Piece | Role |
|-------|------|
| **care-api** | Writes `.wl` files when you bill USG/MRI/CT |
| **Shared folder** | Same folder visible to API and Orthanc |
| **Orthanc worklists plugin** | Serves worklist to USG via DICOM C-FIND |
| **USG machine** | Queries worklist before each scan |

---

## Step 1 — Host folder (Synology NAS)

SSH into the NAS and run:

```bash
mkdir -p /volume1/docker/care-pacs/orthanc/worklists
chmod 777 /volume1/docker/care-pacs/orthanc/worklists
```

---

## Step 2 — care.env (ERP stack)

Add or confirm these lines in `deploy/synology/care.env` (or your `.env`):

```env
ORTHANC_WORKLIST_DIR=/orthanc-worklists
ORTHANC_WORKLIST_HOST_DIR=/volume1/docker/care-pacs/orthanc/worklists
PACS_PROVIDER=orthanc
INTERNAL_API_KEY=<same-secret-as-orthanc-notify-script>
```

`docker-compose.yml` already mounts the host folder into care-api at `/orthanc-worklists`.

Restart API:

```bash
cd /volume1/docker/care-erp   # your ERP compose folder
docker compose up -d care-api
```

---

## Step 3 — Orthanc (care-pacs stack)

In **orthanc.json** (care-pacs project), enable the worklists plugin:

```json
{
  "Plugins": [ "/usr/share/orthanc/plugins", "/usr/local/share/orthanc/plugins" ],
  "Worklists": {
    "Enable": true,
    "Database": "/var/lib/orthanc/worklists"
  }
}
```

Mount the **same host folder** into the Orthanc container:

```yaml
volumes:
  - /volume1/docker/care-pacs/orthanc/worklists:/var/lib/orthanc/worklists
```

Restart Orthanc:

```bash
docker compose -f care-pacs-compose.yml up -d care-orthanc
```

Verify plugin loaded: open Orthanc UI → Plugins → should list **worklists**.

---

## Step 4 — USG machine (GE Voluson / similar)

On the ultrasound console:

1. **Service / DICOM** → add a **Worklist** or **MWL** server  
2. **AE Title**: often `ORTHANC` or `WORKLIST` (match Orthanc MWL config)  
3. **IP**: NAS IP (e.g. `172.16.1.139`)  
4. **Port**: `4242` (Orthanc DICOM port — confirm in orthanc.json)  

On the machine, open **Worklist** before scanning — today's billed patients should appear with ERP accession numbers.

---

## Step 5 — Verify in ERP

1. **Settings → Radiology → DICOM & MWL** — all green checks (or follow Fix hints)  
2. Bill a **USG test** for a patient  
3. Table should show accession with **.wl file = Yes**  
4. If missing, click **Sync MWL files now**  
5. After scan completes, check **PACS Worklist** — study should appear as `STUDY_RECEIVED` and queue token should complete

---

## Alternative: Windows MWL agent

If the USG cannot reach Orthanc directly, run the Windows MWL SCP agent (see Agent Setup in Settings). It polls:

`GET /api/internal/radiology/mwl` with `Authorization: Bearer <INTERNAL_API_KEY>`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| No `.wl` files | Check ORTHANC_WORKLIST_DIR + volume mount; run Sync |
| USG worklist empty | Orthanc worklists plugin off or wrong folder path |
| Study not in ERP | INTERNAL_API_KEY mismatch; check Orthanc `erp_notify.lua` |
| Patient name wrong on USG | Bill must include patient; accession must copy to study |

See also: `docker/orthanc/orthanc-worklists-config.snippet.json`
