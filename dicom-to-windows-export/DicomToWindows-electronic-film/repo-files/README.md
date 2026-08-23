# DICOM Print SCP → Windows Printer Bridge

A self-contained DICOM Print SCP that receives print jobs from ultrasound/echo
machines (and any DICOM Print SCU), calibrates the images for glossy photo
paper, tiles them onto an A4/A5 page at 300 DPI, and sends the result to a
network printer — including a Windows-shared printer — via CUPS or raw
JetDirect. Runs as a single Docker container on a Synology NAS (Part 1) or on
a Windows PC with Docker Desktop (Part 1B). It also exposes a small HTTP API
(Part 2) so an ERP or hospital web app can print the same way without a DICOM
modality involved at all.

No code editor required:

| File | Purpose |
|---|---|
| `server.py` | The DICOM Print SCP + image calibration + layout + printing pipeline |
| `requirements.txt` | Exact pinned Python package versions |
| `Dockerfile` | Builds the container: Python + CUPS + printer drivers + SMB backend |
| `docker-entrypoint.sh` | Starts CUPS, then the bridge — and logs loudly if either has a problem |
| `cups/cupsd.conf` | The CUPS settings baked into the image (open web admin UI on port 631) |
| `docker-compose.yml` | Ports, volumes, and every setting — the only file you'll ever edit, and only through Container Manager's own screen (see Step 3) |

---

## Part 1 — Doctor's Deployment Guide (Synology DSM, Container Manager)

Follow these steps in order. You will not need to open a code editor or type
any code — only click buttons in DSM.

### Step 1 — Make sure Container Manager is installed

1. Open **Package Center** on your Synology NAS (DSM 7.2 or later).
2. Search for **Container Manager**. If it says "Open" instead of "Install",
   you already have it — skip to Step 2.
3. Click **Install** and wait for it to finish.

### Step 2 — Get the files onto your NAS

If you already cloned this repo onto the NAS via SSH (`git clone
https://github.com/DrAbinash/DicomToWindows.git`), skip to sub-step 3 — you
already have everything in one folder. Otherwise:

1. Open **File Station**.
2. Go to the `docker` shared folder (create it via **Control Panel → Shared
   Folder → Create** if it doesn't exist yet).
3. Inside `docker`, create a new folder named `dicomtowindows` (or use the
   folder you cloned into).
4. Download this repo as a ZIP from GitHub (**Code → Download ZIP**) and
   upload/extract `server.py`, `requirements.txt`, `Dockerfile`, and
   `docker-compose.yml` directly into that folder — or drag-and-drop them
   individually if you downloaded them one at a time.
5. Inside that same folder, create three more empty folders:
   - `print-jobs` (every rendered page is saved here as a backup/audit trail —
     handy if a print job needs to be redone)
   - `cups-config` (the printer setup you do in Step 6 is saved here, so it
     survives container rebuilds)
   - `branding` (put your clinic logo image here if you want one on the
     printed page — see "Add your clinic name, address, and logo" below)

Your folder should now look like:

```
docker/dicomtowindows/
├── server.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── print-jobs/        (empty for now)
├── cups-config/       (empty for now)
└── branding/          (empty, or put a logo image in here)
```

### Step 3 — Create the Project in Container Manager

1. Open **Container Manager**.
2. Click **Project** in the left sidebar, then click **Create**.
3. **Project name:** `dicomtowindows`
4. **Path:** click **Browse** and select the folder from Step 2.
5. Container Manager detects the `docker-compose.yml` already in that folder
   and shows you its contents on the next screen — you don't need to type or
   paste anything. Skim it if you like; every setting there is explained in
   the **Settings Reference** below and can be changed later.
6. Click **Next**, then **Done** (or **Build**). It now builds the image
   (downloading Python, CUPS, and printer drivers — 3–8 minutes the first
   time, with a live progress log).
7. When it finishes, the project starts automatically. Check the **Container**
   tab — you should see `dicomtowindows` (or `dicom-print-scp`, the container's
   own name) with a green "Running" status.

If you'd rather change a setting later (gamma, layout, AE title, etc.), come
back to **Project → dicomtowindows → Action → Edit docker-compose.yml**,
change the value, then **Action → Rebuild and start**.

### Step 4 — Confirm the DICOM listener is up

1. In Container Manager, click the `dicom-print-scp` container, then open the
   **Log** tab.
2. You should see a startup banner like:

   ```
   DICOM Print SCP  |  AE Title=PRINTSCP  Port=104
   Layout: 4x4 images per page (max 16) on A4 PORTRAIT @ 300 DPI
   Print method: CUPS
     CUPS server=localhost:631 printer=(not set!)
   ```

   The "(not set!)" warning is expected — you haven't added a printer yet
   (that's Step 6).
3. On your ultrasound/echo machine (or PACS), configure a new DICOM print
   destination:
   - **AE Title:** `PRINTSCP` (or whatever you set `DICOM_AET` to)
   - **IP Address:** your NAS's IP address
   - **Port:** `104`
4. Run its "Verify"/"Echo" connectivity test. It should succeed — you'll see
   an `Echo Request` line appear in the container's Log tab.

### Step 5 — Find out how your Windows printer is shared

Before adding the printer in CUPS, get two pieces of information from the
Windows PC the printer is plugged into:

1. On the Windows PC, open **Settings → Bluetooth & devices → Printers &
   scanners**, click the printer (e.g. `EPSON L18050` or `Canon G1030`), open
   **Printer properties → Sharing**, and confirm **Share this printer** is
   turned on. Note the **Share name** shown there.
2. Find the PC's name or IP address (Command Prompt → `ipconfig`, or
   `hostname`). The IP address is usually the more reliable one to use.

Write these down — you'll use them as `<PC-NAME-OR-IP>` and `<SHARE-NAME>` in
the next step.

### Step 6 — Add the Windows printer inside the container (CUPS)

The container runs its own copy of CUPS specifically so you can point it at
that Windows-shared printer.

1. Open a browser to `http://<your-nas-ip>:631` (port 631, not the usual DSM
   port). This is the CUPS admin page running inside the container.
2. Click **Administration → Add Printer**.
3. Under **Other Network Printers**, choose **Windows Printer via SAMBA**,
   click **Continue**.
4. For the **Connection** field, enter:
   - `smb://<PC-NAME-OR-IP>/<SHARE-NAME>` — if the Windows share doesn't need
     a login, or
   - `smb://<username>:<password>@<PC-NAME-OR-IP>/<SHARE-NAME>` — if Windows
     asks for credentials to use the share.
5. Click **Continue**. Give it a **Name** with no spaces — for example
   `WindowsPrinter`. Remember this name exactly.
6. On the driver selection screen, search for your printer's exact model
   (e.g. "Epson L18050" or "Canon G1030"). This container ships with the
   Gutenprint driver pack, which has good native support for most Epson and
   Canon photo printers. If your exact model isn't listed, pick the closest
   Epson/Canon Gutenprint match, or fall back to a "Generic"/raw queue.
7. Click **Add Printer**, then set the default paper size to **A4** (or A5)
   on the options page that follows, and **Set Default Options**.
8. Print a CUPS test page from this same screen to confirm the Windows share
   actually accepts jobs before moving on.

### Step 7 — Tell the bridge which printer to use

1. Back in Container Manager, open **Project → dicomtowindows → Action →
   Edit docker-compose.yml**.
2. Change the line `CUPS_PRINTER_NAME: ""` to the exact name you chose in
   Step 6, e.g. `CUPS_PRINTER_NAME: "WindowsPrinter"`.
3. **Action → Rebuild and start** (this restarts just the running container
   with the new setting — it does not rebuild the image from scratch, so it's
   quick).
4. Check the Log tab again — the "(not set!)" warning should be gone, and
   the printer status line should read `NORMAL` instead of `FAILURE` the next
   time a print job or status check happens.

### Step 8 — Print something for real

Send a study to print from your ultrasound/echo machine. In the container's
Log tab you should see a sequence like: `Film Session created` → `Film Box
created` → several `Image Box ... received ... pixel data` lines → `Rendering
print job` → `Saved rendered page to ...` → `CUPS accepted the job`.

A copy of every rendered page is also saved as a PDF (or PNG, if you changed
`OUTPUT_FORMAT`) inside `docker/dicomtowindows/print-jobs` on your NAS — open
that folder in File Station any time you want to double-check or manually
reprint something.

### If your machine prints one image at a time (e.g. GE "P1")

Some ultrasound/echo machines don't build a multi-image page themselves —
pressing a print key (GE's "P1" is the common example) sends one single-image
print job per press, the way it always did for a thermal printer. This bridge
is built to handle that directly, with no change in how she works the
machine:

- Press the print key once per image you want on the page — say, 6 times for
  a 2×3 layout, or just 4 if that's all this patient needs.
- The moment the page's worth of images (`LAYOUT_ROWS × LAYOUT_COLS`) has
  arrived, it prints immediately.
- If she presses fewer than that and then moves on to the next patient, the
  bridge waits `BATCH_IDLE_TIMEOUT_SECONDS` (60 seconds by default) with no
  new image before printing whatever arrived — so a 4-image page still prints
  on its own, reflowed to fill the sheet (via `AUTO_FIT_LAYOUT`) instead of
  showing 2 blank slots.
- If a single print job itself carries more images than fit (e.g. the machine
  sends a whole 16-image page at once into a 6-image layout), the extras are
  dropped and logged — never a second sheet for the leftovers.
- Press the key a couple of times *after* a page has already gone out full,
  though, and — without a Patient ID to go on — the bridge can't safely tell
  "that was 2 accidental extra presses" apart from "that's the next patient's
  first 2 images," so it starts a new page with those rather than risk
  silently losing someone's real images. That page prints on its own after
  the usual idle timeout, same as any other partial page.
- These are grouped by whichever machine/AE Title is printing, and by Patient
  ID/Name too if the machine happens to send it (a bonus — not required for
  this to work). A gap longer than `BATCH_IDLE_TIMEOUT_SECONDS` between
  presses is treated as "this must be the next patient," starting a fresh
  page.

If a modality instead sends a whole page's images together in one go (the
"normal" DICOM Print way), this all still works exactly the same — that
single batch just happens to arrive full immediately and prints right away.

### Add your clinic name, address, and logo

Every printed page can carry a letterhead band at the top (header) and/or
bottom (footer) — a black bar with white text by default, matching the style
of a typical film-printer letterhead: an optional small first line, a bigger
bold second line, and an optional logo. Both are off by default (no header,
no footer) until you set some text.

1. If you want a logo, copy the image file (PNG or JPEG) into the `branding`
   folder from Step 2 via File Station — e.g. `branding/logo.png`.
2. **Project → dicomtowindows → Action → Edit docker-compose.yml**, and fill
   in whichever of these you want:

   ```yaml
   HEADER_LINE1: ""
   HEADER_LINE2: "CARE DIAGNOSTIC CENTER"
   HEADER_LOGO_PATH: "/data/branding/logo.png"
   HEADER_ALIGN: CENTER

   FOOTER_LINE1: ""
   FOOTER_LINE2: "Subhash Chowk, Deoghar - 814112 | Ph: 0XXXX-XXXXXX"
   FOOTER_ALIGN: CENTER
   ```

   (`HEADER_LOGO_PATH`/`FOOTER_LOGO_PATH` are container-side paths — always
   `/data/branding/<filename>`, matching what you named the file in the
   `branding` folder; that's the same folder regardless of which of the two
   banners you point it at.)
3. **Action → Rebuild and start.**

See the Settings Reference below for `HEADER_HEIGHT_MM`/`FOOTER_HEIGHT_MM`
(band thickness) and `BANNER_BACKGROUND_COLOR` (`BLACK` or `WHITE`) if you
want to adjust the look further.

### Letterhead: let the ERP be the single source

By default the clinic letterhead on a **film** comes from this container's
`HEADER_*`/`FOOTER_*` settings, while a print sent from the **ERP** carries the
clinic details the ERP already holds. That means the same name, address and
logo are maintained in two places, and they drift apart the first time
anything changes — a renamed clinic updates ERP prints instantly and leaves
films showing the old name until someone remembers to edit this container too.

Point the bridge at the ERP's public clinic-settings endpoint and that
disappears:

```env
ERP_BRANDING_URL=http://192.168.1.137:3000/api/clinic-settings/branding
```

The clinic name, tagline, address, phone, email **and logo** are then read
from the ERP's own settings page — the same row Billing prints from — and
refreshed every few minutes. Nothing to re-type here, no logo file to copy
into `branding/`, no restart when it changes.

Precedence is:

1. What a print job explicitly carries (the HTTP print API sends its own)
2. What the ERP last told us
3. The `HEADER_*`/`FOOTER_*` settings below

So the env values stay as the fallback for anything the ERP leaves blank, and
for whenever it is unreachable. **A print never fails or comes out blank
because of a branding lookup**: the last good values are kept if the ERP is
restarting, and the env fallback covers a bridge that has never reached it.

Leave `ERP_BRANDING_URL` unset and behaviour is exactly as before.

### Patient identification on the film

DICOM films print a patient line under the header — name, ID, study date and
modality — so a sheet leaving the department can always be matched back to a
patient. It only shows what the modality actually sent: print SCUs are not
required to include patient tags, and the line simply shrinks to whatever is
present (or disappears entirely if nothing is). Turn it off with
`SHOW_PATIENT_BANNER=false`.

Pages printed through the HTTP API don't get this line — the ERP sends its
own header/footer branding with each request.

### Printing A3 and A3+ glossy PET film

CT and MRI are commonly printed on larger stock than ultrasound. Set the size
and, for anything the driver doesn't call by its plain name, the CUPS media:

```env
PAGE_SIZE=A3PLUS
CUPS_MEDIA=SuperA3      # whatever `lpoptions -p <queue> -l` calls it
```

**Check `CUPS_MEDIA` against your driver.** A3+ (329 × 483 mm / 13 × 19 in) has
no single agreed CUPS name — `SuperA3`, `A3.Wide`, `Super_A3_B` and `13x19` are
all in use depending on the PPD. Getting it wrong doesn't fail loudly; the
printer quietly falls back to its default tray size and the sheet comes out
the right shape but the wrong size. `A4`, `A3` and `A5` need no override.

The bridge now always passes the media to `lp`. Before, it passed only
`fit-to-page`, so a larger page was scaled down onto whatever was loaded.

### Page orientation

By default (`PAGE_ORIENTATION=AUTO`) the bridge turns the sheet whichever way
prints the images largest, comparing how much of a grid cell the images would
actually fill in each direction. The grid you configured never changes — only
the sheet turns.

This matters more than it sounds. A 3-column grid of 4:3 ultrasound frames on
an upright A4 gets cells twice as tall as they are wide, so every frame prints
at roughly half the size it would on a landscape sheet:

| | Cell aspect | Total printed image area |
|---|---|---|
| Portrait | 0.50 | 19,208 mm² |
| Landscape | 1.08 | 40,044 mm² |

Set `PAGE_ORIENTATION=SCU` to follow the modality's Film Orientation instead
(the previous behaviour), or `PORTRAIT` / `LANDSCAPE` to pin it.

### If you'd rather skip CUPS entirely (raw JetDirect)

Some networked printers (or a hardware print server) accept files sent
directly to TCP port 9100 without needing a driver at all. If yours does:

1. In the docker-compose.yml, change:
   ```yaml
   PRINT_METHOD: jetdirect
   JETDIRECT_HOST: "<printer-ip-address>"
   JETDIRECT_PORT: "9100"
   ```
2. Rebuild and start.

This skips CUPS/driver setup entirely, but only works if the printer (or
print server) can rasterize the PDF/PNG file itself — most consumer inkjets
plugged into a Windows PC (like the ones in the screenshots this bridge was
built to replace) do **not** support this; use the CUPS/SMB path (Steps 5–7)
for those.

---

## Part 1B — Deploying on Windows (Docker Desktop)

Everything above assumes a Synology NAS, but the same container runs on a
Windows PC — often the very PC the printer is already plugged into, which
removes the SMB hop entirely.

### Step 1 — Install Docker Desktop

Download **Docker Desktop for Windows** from docker.com and install it with
the default (WSL 2) options. Reboot if it asks, then open Docker Desktop once
and wait for the whale icon in the system tray to say **Engine running**.

### Step 2 — Get the files

Open **PowerShell** and clone the repo (or download the ZIP and extract it):

```powershell
git clone https://github.com/DrAbinash/DicomToWindows.git
cd DicomToWindows
```

You do **not** need to create the `print-jobs`, `cups-config`, or `branding`
folders by hand — Docker creates them next to `docker-compose.yml` on first
start.

> If you downloaded the ZIP instead of cloning, extract it with Windows'
> built-in extractor or 7-Zip. Either is fine; the repo ships a
> `.gitattributes` that keeps the container's startup script in the Unix line
> endings Linux needs, and the image scrubs any stray carriage returns anyway.

### Step 3 — Start it

```powershell
docker compose up -d --build
```

The first build downloads Python, CUPS and the printer drivers — 3–8 minutes.
Then check that it actually came up:

```powershell
docker compose ps
docker compose logs
```

You are looking for the startup banner:

```
ENTRYPOINT: DICOM Print SCP container starting
ENTRYPOINT: CUPS is up (pid 12)
ENTRYPOINT: Starting the DICOM print bridge (server.py)...
DICOM Print SCP  |  AE Title=PRINTSCP  Port=104
```

If `docker compose ps` shows the container restarting, or the log stops part
way through that banner, the log itself will say what went wrong — read it
before changing anything.

### Step 4 — Let the modality reach port 104

Windows Defender Firewall blocks inbound connections by default, so the
ultrasound machine will not be able to reach the bridge until you allow it.
In an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "DICOM Print SCP" -Direction Inbound -Protocol TCP -LocalPort 104 -Action Allow
```

Then point the modality at this PC's IP address (`ipconfig`), port `104`, AE
Title `PRINTSCP`, and run its Verify/Echo test.

> **Port 104 already in use?** Windows occasionally reserves low port ranges
> for Hyper-V. Check with
> `netsh interface ipv4 show excludedportrange protocol=tcp`. If 104 is
> listed, change the **host** side of the mapping in `docker-compose.yml` to
> a free port (e.g. `"11104:104"`) and tell the modality to use that port
> instead. Leave the container side as `104`.

### Step 5 — Add the printer

Open `http://localhost:631` and follow **Part 1, Steps 5–7**. Because the
container is on the same PC as the printer, you can usually skip SMB and pick
the printer's own network/IPP entry directly. Then set `CUPS_PRINTER_NAME` in
`docker-compose.yml` and run `docker compose up -d` again.

### Keeping it running

Docker Desktop does not start automatically after a reboot unless you tell it
to: **Settings → General → Start Docker Desktop when you sign in**. The
container's own `restart: unless-stopped` policy then brings the bridge back
by itself. On a PC that gets signed out, or that goes to sleep, prefer the
NAS deployment in Part 1 — a clinic's print bridge should not depend on
someone being logged in.

---

## Part 2 — Printing directly from your ERP or hospital software

This section is for whoever maintains your clinic's other software (an ERP,
reporting workspace, kiosk app, etc.), not for day-to-day use by the doctor
or sonographer. Everything in Part 1 keeps working exactly as before —
this is an *additional*, optional way to reach the same printer, for a
request that starts as a button click in a web app instead of a button
press on the ultrasound machine.

Alongside the DICOM listener, this container also runs a small HTTP API so
another program can ask it to print directly:

- `GET /api/v1/health` — returns the current printer status, with no
  authentication required (matches typical container health-check
  conventions; it reveals only online/offline state, nothing about patients).
- `POST /api/v1/print-jobs` — renders and prints one or more images.
  Requires an `Authorization: Bearer <HTTP_BRIDGE_SECRET>` header. The API
  refuses every request (`503`) until you set `HTTP_BRIDGE_SECRET` to a real
  value in `docker-compose.yml` — it does not default to "open."
- `GET /api/v1/print-jobs/{jobKey}` — checks on a job submitted above (same
  bearer token required). Since printing happens in the background, this is
  how a caller finds out whether a job actually printed rather than just
  that it was accepted.

**Enabling it:**

```yaml
HTTP_PORT: "8090"
HTTP_BRIDGE_SECRET: "choose-a-long-random-string-here"
```

Then **Action → Rebuild and start**. Give that same secret to whoever is
configuring the ERP side, over a secure channel (not chat/email in the clear).

**Request body:**

```json
{
  "images": ["data:image/jpeg;base64,/9j/4AAQSkZJRg...", "<...more base64 images...>"],
  "copies": 1,
  "orientation": "PORTRAIT",
  "layout": {"rows": 2, "cols": 3},
  "header": {"line1": "City Diagnostic Centre", "line2": "12 MG Road, Pune",
             "logo": "data:image/png;base64,iVBORw0KGgo...", "align": "CENTER"},
  "footer": {"line1": "Printed from the reporting workspace"}
}
```

Only `images` is required. Everything else falls back to this container's
own configured defaults (`LAYOUT_ROWS`/`LAYOUT_COLS`, `HEADER_*`/`FOOTER_*`,
etc.) when omitted — `layout`/`header`/`footer` here *replace* those defaults
for this one request, they don't merge with them field-by-field.

Example call from a backend server (never call this directly from a browser
— it's meant to sit behind your ERP's own API, on the same private network):

```bash
curl -X POST http://<nas-ip>:8090/api/v1/print-jobs \
  -H "Authorization: Bearer choose-a-long-random-string-here" \
  -H "Content-Type: application/json" \
  -d '{"images": ["data:image/jpeg;base64,...=="], "copies": 1}'
```

A successful call responds immediately with `202 Accepted` and
`{"status": "accepted", "jobKey": "...", "pages": N, "images": N}` — the
same "respond now, print in the background" behavior as the DICOM path, so a
slow printer never makes the web app hang.

**Checking whether it actually printed:**

```bash
curl http://<nas-ip>:8090/api/v1/print-jobs/<jobKey> \
  -H "Authorization: Bearer choose-a-long-random-string-here"
```

```json
{
  "jobKey": "...", "status": "completed",
  "pages": 2, "images": 5, "copies": 1, "error": null,
  "createdAt": "2026-07-23T05:08:58.907000", "updatedAt": "2026-07-23T05:08:59.112000"
}
```

`status` is `queued` (accepted, waiting for a free worker — normally
instantaneous), `processing` (actively rendering/printing), `completed`, or
`failed` (`error` then carries a short reason, e.g. the printer being
unreachable). A `404` means the job key was never issued, or its record aged
out — finished job records are kept for about an hour, then dropped; a job
that's still `queued`/`processing` is never aged out this way, since a job
stuck in progress is exactly the kind of thing you'd want to keep visible
rather than have quietly disappear.

**This is deliberately different from the DICOM "P1 button" behavior in one
way:** a DICOM Film Box that overflows the configured grid *drops* the extra
images (see `LAYOUT_ROWS`/`LAYOUT_COLS` below) because a physical button
press is ambiguous — there's no reliable way to tell "2 accidental extra
presses" apart from "the next patient's first 2 images." An HTTP request has
no such ambiguity: whoever built the request in the ERP chose exactly those
images on purpose, so instead of dropping any of them, they spill onto
additional pages (`ceil(images / (rows × cols))` pages total, each laid out
and calibrated exactly like any other page from this bridge).

Other limits worth knowing: at most `HTTP_MAX_IMAGES_PER_JOB` images (default
200) and `HTTP_MAX_BODY_BYTES` bytes (default ~60&nbsp;MB) per request, and at
most `20` copies per job (a fixed safety ceiling — nobody legitimately prints
more than that in one go). A request over either limit gets a `400`/`413`
response immediately, before anything is rendered.

---

## Part 3 — Settings Reference

Every setting below is an environment variable in `docker-compose.yml`.
Change a value, then **Action → Rebuild and start** to apply it.

| Variable | Default | What it does |
|---|---|---|
| `DICOM_AET` | `PRINTSCP` | The AE Title modalities call to reach this bridge |
| `DICOM_PORT` | `104` | DICOM listen port |
| `ALLOWED_CALLING_AETS` | *(empty = allow all)* | Comma-separated list to restrict which modality AE Titles may connect |
| `GAMMA` | `2.0` | Gamma correction strength. Higher = brighter. `1.0` disables gamma (contrast stretch still applies) |
| `CONTRAST_LOW_PERCENTILE` / `CONTRAST_HIGH_PERCENTILE` | `1.0` / `99.0` | Black-point/white-point percentiles used for contrast stretching |
| `ENABLE_CALIBRATION` | `true` | Set `false` to print frames exactly as received, with no brightening |
| `PAGE_SIZE` | `A4` | Sheet/film size: `A5`, `A4`, `A3`, `A3PLUS` (Super A3 / A3 Wide / 13×19in — glossy PET film), or the radiology film sizes `8X10`, `8_5X11`, `10X12`, `10X14`, `11X14`, `11X17`, `14X14`, `14X17`, `24CMX24CM`, `24CMX30CM`. DICOM Film Size ID spellings (`14INX17IN`, `8INX10IN`, …) and `A3+` are accepted too |
| `HONOR_SCU_FILM_SIZE` | `false` | Let the Film Box's Film Size ID choose the size. Off by default — a department that stocks one film size wants every sheet on that stock whatever the modality asks for |
| `SHOW_IMAGE_LABELS` | `true` | Caption each frame with its series description and image number, when the modality sends them |
| `IMAGE_LABEL_HEIGHT_MM` | `4.5` | Height of that caption strip |
| `PAGE_ORIENTATION` | `AUTO` | `AUTO` turns the sheet whichever way prints the images largest (see "Page orientation" below). `SCU` follows whatever the modality requests. `PORTRAIT` / `LANDSCAPE` pin it |
| `DPI` | `300` | Render resolution |
| `MARGIN_MM` | `5.0` | Outer page margin |
| `GUTTER_MM` | `2.0` | Spacing between tiled images |
| `LAYOUT_ROWS` / `LAYOUT_COLS` | `2` / `3` | The maximum page grid, e.g. 2×3 = 6 images per page. **A page is capped at exactly `rows × cols` images and never spills onto a second page** — extra images beyond that are dropped and logged, not printed on a following sheet |
| `LAYOUT_<MODALITY>` | *(none)* | Per-modality grid as `ROWSxCOLS`, e.g. `LAYOUT_USG=2x3`, `LAYOUT_CT=2x2`, `LAYOUT_XR=1x2`. Used when the images carry a matching Modality; DICOM defined terms map onto the names, so `US`→`LAYOUT_USG`, `MR`→`LAYOUT_MRI`, `CR`/`DX`/`XA`/`RF`→`LAYOUT_XR`. Anything unmatched uses `LAYOUT_ROWS`/`LAYOUT_COLS` |
| `SHOW_PATIENT_BANNER` | `true` | Print the patient identification line (name, ID, study date, modality) under the header on DICOM films. Only shows what the modality actually sent; the HTTP print API supplies its own branding instead |
| `PATIENT_BANNER_HEIGHT_MM` | `6.0` | Height of that identification line |
| `STRETCH_TO_FIT` | `false` | `true` distorts each image to completely fill its cell instead of preserving its aspect ratio |
| `AUTO_FIT_LAYOUT` | `true` | For a partial page (e.g. 4 of a 2×3 layout), shrink the grid to fit exactly what arrived instead of leaving empty cells |
| `BATCH_GROUP_BY` | `auto` | `auto`: combine single-image print jobs from the same patient/machine into one page (see "one image at a time" above). `session`: legacy mode — each Film Box prints alone, immediately, never combined |
| `BATCH_IDLE_TIMEOUT_SECONDS` | `60` | How long to wait with no new image before printing a partial page. Only used when `BATCH_GROUP_BY=auto` |
| `BACKGROUND_COLOR` | `WHITE` | `WHITE` or `BLACK` page background |
| `HEADER_LINE1` / `HEADER_LINE2` | *(empty)* | Clinic letterhead text for the top band. No header is drawn at all until one of these (or `HEADER_LOGO_PATH`) is set |
| `HEADER_LOGO_PATH` | *(empty)* | Container-side path to a logo image for the header, e.g. `/data/branding/logo.png` |
| `HEADER_ALIGN` | `CENTER` | `LEFT`, `CENTER`, or `RIGHT` |
| `HEADER_HEIGHT_MM` | `14.0` | Header band thickness |
| `FOOTER_LINE1` / `FOOTER_LINE2` | *(empty)* | Clinic address/footer text for the bottom band. No footer is drawn until one of these (or `FOOTER_LOGO_PATH`) is set |
| `FOOTER_LOGO_PATH` | *(empty)* | Container-side path to a logo image for the footer |
| `FOOTER_ALIGN` | `CENTER` | `LEFT`, `CENTER`, or `RIGHT` |
| `FOOTER_HEIGHT_MM` | `10.0` | Footer band thickness |
| `BANNER_BACKGROUND_COLOR` | `BLACK` | `BLACK` or `WHITE` — the header/footer band color (text is always the opposite color for contrast) |
| `ERP_BRANDING_URL` | *(empty)* | Pull the clinic letterhead (name, tagline, address, phone, email, logo) from the ERP's public clinic-settings endpoint, e.g. `http://192.168.1.137:3000/api/clinic-settings/branding`, so it is maintained in one place. See "Letterhead" above. Empty = use the `HEADER_*`/`FOOTER_*` settings only |
| `ERP_BRANDING_REFRESH_SECONDS` | `300` | How often to re-read it |
| `ERP_BRANDING_TIMEOUT_SECONDS` | `5` | Per-request timeout on that fetch |
| `OUTPUT_DIR` | `/data/print-jobs` | Where rendered pages are saved (map this to a real NAS folder, see Step 2) |
| `OUTPUT_FORMAT` | `pdf` | `pdf` or `png` |
| `JOB_RETENTION_DAYS` | `30` | Old files in `OUTPUT_DIR` older than this are deleted automatically. `0` keeps everything forever |
| `PRINT_METHOD` | `cups` | `cups` or `jetdirect` |
| `CUPS_SERVER` | `localhost:631` | CUPS server address (leave as-is unless you're pointing at an external CUPS server) |
| `CUPS_PRINTER_NAME` | *(empty)* | The exact queue name you gave the printer in Step 6 |
| `CUPS_MEDIA` | *(from `PAGE_SIZE`)* | The `lp -o media=` value. Sizes whose CUPS name is driver-specific need this set explicitly — **A3+ above all**, which PPDs variously call `SuperA3`, `A3.Wide`, `Super_A3_B` or `13x19`. Run `lpoptions -p <queue> -l` and use what the driver lists |
| `START_CUPS` | `true` | Set to `false` to skip starting CUPS altogether. Only useful with `PRINT_METHOD=jetdirect`, or when you only want the rendered PDFs in `print-jobs/`. The bridge itself starts either way |
| `JETDIRECT_HOST` / `JETDIRECT_PORT` | *(empty)* / `9100` | Used only when `PRINT_METHOD=jetdirect` |
| `SESSION_TTL_MINUTES` | `120` | A safety net that clears a print session's memory if a modality disconnects without cleaning up |
| `LOG_LEVEL` | `INFO` | Set to `DEBUG` for very detailed logs while troubleshooting |
| `HTTP_PORT` | `8090` | Listen port for the print-from-app HTTP API (Part 2) |
| `HTTP_BRIDGE_SECRET` | *(empty = API disabled)* | Bearer secret required on every `POST /api/v1/print-jobs` call. Leave empty to keep the HTTP API turned off entirely |
| `HTTP_MAX_BODY_BYTES` | `60000000` | Request body size cap (~60 MB) for the HTTP API |
| `HTTP_MAX_IMAGES_PER_JOB` | `200` | Maximum images accepted in a single HTTP print-jobs request |

---

## Part 4 — Troubleshooting

**The container is created but never runs, and the log is completely empty.**
This was a real bug, fixed — if you are still seeing it, you are running an
older build. Pull the latest files and rebuild
(`docker compose up -d --build`, or **Action → Rebuild and start** in
Container Manager).

What used to happen: `/etc/cups` is deliberately mounted from a host folder so
the printer you add in Step 6 survives a rebuild. Mounting a folder over a
path hides whatever the image put there, so on a first run CUPS found *no
configuration at all*, exited immediately, and — because the config it could
not read is the same config that tells it where to log — printed nothing
whatsoever. The old startup script ran under `set -e`, so it gave up at that
point and never reached the Python bridge. With `restart: unless-stopped`, the
result was a container that looked deployed but silently restarted forever
with an empty log.

The container now seeds `/etc/cups` from a copy the mount cannot hide, sends
CUPS's own messages to the container log, and starts the DICOM bridge even
when CUPS is unavailable. If CUPS still cannot start you will get an
explicit, boxed warning in the log saying so, and DICOM printing will keep
working as far as the rendered pages in `print-jobs/`.

**The container restarts over and over for some other reason.**
Read the log from the very first line — `docker compose logs` on Windows, or
the **Log** tab in Container Manager. The startup banner is printed in stages
(entrypoint → CUPS → bridge), so where it stops tells you which stage failed.

**"Echo"/connectivity test fails from the modality.**
Check DSM's firewall (Control Panel → Security → Firewall) allows inbound
port 104, and that the modality is using the NAS's actual IP address.

**Echo succeeds, but images never print.**
Open the Log tab and look for the printer status line. `PrinterStatus:
FAILURE` with a reason like `CUPS_PRINTER_NAM` means `CUPS_PRINTER_NAME` isn't
set yet, or doesn't exactly match the queue name from Step 6 (names are
case-sensitive). A reason mentioning the printer being disabled means CUPS
itself has paused the queue — open `http://<nas-ip>:631`, find the printer
under **Printers**, and check **Resume Printer**.

**Only part of a study prints, or only the first page.**
This is expected behavior, not a bug — see `LAYOUT_ROWS`/`LAYOUT_COLS` above.
Increase the grid size if you want more images per page; there's currently no
setting to spill extras onto a second page, by design.

**A page printed too soon (with fewer images than expected), or took too long
to print after the last image.**
Tune `BATCH_IDLE_TIMEOUT_SECONDS` — lower it if pages are printing later than
you'd like after the last press, raise it if a page is printing before all of
one patient's images have arrived (i.e. there was a pause longer than the
timeout mid-exam).

**Two different patients ended up combined on the same page.**
This means the modality doesn't send Patient ID/Name with its print jobs, so
the AE-Title-and-timing fallback merged them — raise `BATCH_IDLE_TIMEOUT_SECONDS`
only if pages are cutting off too early; if patients are actively getting
merged, the real fix is either more of a pause between patients than the
timeout allows, or asking the modality vendor whether Patient ID can be
included in its print requests.

**Images still look dark on glossy paper.**
Raise `GAMMA` (try `2.5` or `3.0`) and rebuild/start. If an image looks
washed out or has lost detail instead, lower it back down, or narrow the
`CONTRAST_LOW_PERCENTILE`/`CONTRAST_HIGH_PERCENTILE` gap slightly.

**The Windows printer works from other PCs but not from this bridge.**
Test the SMB path in isolation: from a terminal inside the container (Container
Manager → container → **Terminal** tab → **Create** → `sh`), run
`smbclient -L //<PC-NAME-OR-IP> -U <username>` and confirm the share is
visible and the credentials work. If that fails, the problem is the Windows
share/network, not this bridge.

**A print job's rendered page looks correct in `print-jobs/` but the physical
printer never received it.**
That confirms the DICOM → calibration → layout pipeline all worked correctly,
and the problem is isolated to Step 6/7 (the CUPS ↔ Windows-share connection).
Re-check the printer's status page at `http://<nas-ip>:631`.

**The HTTP API returns 503 for every request.**
`HTTP_BRIDGE_SECRET` isn't set — the API refuses everything by design until
you configure a real secret (Part 2). This is not a bug.

**The HTTP API returns 401.**
The `Authorization: Bearer <secret>` header is missing, or the secret it
carries doesn't match `HTTP_BRIDGE_SECRET` exactly (it's case-sensitive and
whitespace-sensitive).

**An HTTP print job was accepted (`202`) but nothing came out of the printer,
and the caller has no idea why.**
That's what `GET /api/v1/print-jobs/{jobKey}` is for — poll it with the
`jobKey` from the original `202` response. `status: "failed"` carries an
`error` message (usually the same reason `check_printer_status`/CUPS would
give — printer offline, queue disabled, wrong `CUPS_PRINTER_NAME`, etc.); fix
whatever it names and the next print job should go through.

---

## Part 4B — Admin UI & Electronic Film (v1.1)

Open **`http://<bridge-ip>:8090/admin`** in a browser on your LAN.

- **First login:** username `admin` (or `ADMIN_USERNAME`). If no password was
  set yet, enter a new password (≥8 characters) — it is hashed and stored in
  `/data/config/config.json`.
- **Dashboard:** bridge status, DICOM listener, CARE ERP reachability, capture
  mode, physical printer, last association, last capture/print.
- **Settings** persist to `/data/config/config.json` (mount `./config` in
  docker-compose). Environment variables still win when set (existing
  deployments unchanged).
- **Capture modes:** `CAPTURE_ONLY` (electronic film only), `CAPTURE_AND_PRINT`
  (film + physical; print failure does not erase film), `PRINT_ONLY` (legacy).
- **Identity audit:** each DICOM job records which tags (StudyInstanceUID,
  AccessionNumber, PatientID, etc.) were present — PHI-safe redacted values
  for troubleshooting UIH/console behavior before CARE auto-match.
- **CARE API:** `GET /api/v1/print-jobs`, `GET /api/v1/print-jobs/{jobKey}`,
  `GET /api/v1/print-jobs/{jobKey}/artifact` (Bearer `HTTP_BRIDGE_SECRET`).

See `ELECTRONIC_FILM_DELIVERABLE.md` for full architecture and live-test checklist.

---

## Part 5 — What this does and doesn't do (scope notes)

- Supports both **Basic Grayscale** (`1.2.840.10008.5.1.1.9`) and **Basic
  Color** (`1.2.840.10008.5.1.1.18`) Print Management Meta SOP Classes —
  covering standard grayscale studies as well as color Doppler frames from
  ultrasound/echo machines — plus C-ECHO (Verification), Printer status
  (N-GET), and Print Job housekeeping.
- Pixel data is accepted uncompressed (Implicit VR Little Endian, Explicit VR
  Little Endian, Explicit VR Big Endian). `YBR_FULL_422` (chroma-subsampled
  color) is explicitly rejected with a clear log message rather than
  silently mis-rendered — ask the modality to send `RGB` or `YBR_FULL`
  instead if you hit this.
- Printing happens in the background after the DICOM association responds
  success to the print command, per the DICOM Print Management workflow's
  own design — a slow printer never blocks or times out the modality's
  association.
- This is a bridge/appliance, not a PACS — it doesn't store or forward
  studies anywhere; it only renders what it's asked to print and hands the
  result to CUPS/JetDirect. Rendered pages are kept in `OUTPUT_DIR` purely as
  a local audit trail (subject to `JOB_RETENTION_DAYS`) — apply your own
  data-retention policy to that folder if required.
- The HTTP API (Part 2) is plain HTTP with a shared-secret bearer token, not
  HTTPS — it's designed to be called from a trusted backend over your
  private LAN/Docker network (e.g. the ERP's own API server), the same trust
  boundary CUPS's admin UI already assumes. Don't forward `HTTP_PORT` to the
  public internet; put a reverse proxy with TLS in front of it if it ever
  needs to cross an untrusted network.
