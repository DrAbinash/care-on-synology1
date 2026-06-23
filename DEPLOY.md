# Deploying the Diagnostic Center Billing ERP

> ⚠️ **Before going live, change the default database password.**
> The example `.env` ships with `DB_PASSWORD=changeme`. Edit `.env` and pick a
> long random password before exposing the app to anyone other than yourself,
> *especially* on a NAS or any always-on server. Patient data lives in this
> database.

You have **three** ways to run this software outside Replit. Pick the one that
matches your situation.

| Option | Best for | Difficulty | Auto-restart on reboot |
| --- | --- | --- | --- |
| **A. Plain `pnpm dev`** | Quick personal use on one Windows PC | Easiest | No |
| **B. Docker on Windows / macOS / Linux** | Reliable single-machine install | Easy | Yes |
| **C. Docker on Synology NAS** | Always-on clinic server | Easy (DSM 7+) | Yes |

> All three options use the **same database** schema and the same code. You can
> migrate from A → B → C later without losing data, as long as you back up the
> Postgres database first.

---

## Option A — Simplest (no Docker, just Node + Postgres)

Use the step-by-step guide in **`README-WINDOWS.md`**. In short:

```powershell
# one time
copy .env.example .env       # then edit DATABASE_URL
pnpm install
pnpm db:push

# every day
pnpm dev
```

Then open http://localhost:5173 (billing) and
http://localhost:5174/super-admin-portal/.

**Pros:** fewest moving parts, easy to inspect logs in PowerShell.
**Cons:** you have to start it manually each day; no built-in reverse proxy
(you have to reach each frontend on its own port).

---

## Option B — Docker on Windows (recommended for one PC)

Docker bundles Postgres + the API + the web frontends + an nginx reverse proxy
into a single stack you can start with one command. After this is set up, the
software runs in the background and starts automatically with Windows.

### B1. Install Docker Desktop

1. Download Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/
2. Run the installer, accept the WSL 2 backend (the default), and reboot when asked.
3. Open Docker Desktop once and wait until the green "Engine running" indicator
   appears in the bottom-left corner.

### B2. Get the project files

Extract the project tarball (or `git clone`) into a folder such as
`C:\diagnostic-erp`. You should see `Dockerfile`, `docker-compose.yml`,
`package.json`, etc. in that folder.

Open **PowerShell** in that folder (right-click → "Open in Terminal").

### B3. Configure (optional)

The defaults work out of the box. To customize the host port or set a strong
database password:

```powershell
copy .env.docker.example .env
notepad .env
```

The most important variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST_PORT` | `8888` | The port your browser opens. `http://localhost:8888` |
| `DB_PASSWORD` | `changeme` | Postgres password (please change for production) |

### B4. Build the images and start everything

```powershell
docker compose up -d --build
```

The first build downloads ~500 MB and takes 5–10 minutes. Subsequent starts
are instant.

### B5. Create the database tables (one time)

```powershell
docker compose run --rm migrate
```

You should see `drizzle-kit` apply the schema and exit cleanly. Run this
command again any time you update the project to a newer version.

### B6. Open the app

| Address | What it is |
| --- | --- |
| `http://localhost:8888/` | Diagnostic ERP (billing, patients, reports) |
| `http://localhost:8888/super-admin-portal/` | Super Admin Portal |
| `http://localhost:8888/api/healthz` | API health check (returns JSON) |

### B7. Day-to-day commands

```powershell
docker compose logs -f api    # follow the API server logs
docker compose logs -f web    # follow the nginx logs
docker compose ps             # see what's running
docker compose stop           # stop everything (data is preserved)
docker compose start          # start it back up
docker compose down           # stop and remove containers (data preserved)
docker compose pull           # update postgres / nginx base images
```

### B8. Auto-start on Windows boot

Docker Desktop already starts at login (toggle in Docker Desktop → Settings →
General). Containers with `restart: unless-stopped` (which is the default in
this `docker-compose.yml`) come back up automatically. Nothing else to do.

### B9. Letting other PCs in your clinic use it

1. Find your PC's IP: `ipconfig` → look for the `IPv4 Address` (e.g.
   `192.168.1.50`).
2. Allow port `8888` through Windows Firewall:
   **Windows Defender Firewall → Advanced Settings → Inbound Rules → New Rule
   → Port → TCP → 8888 → Allow**.
3. Other PCs open `http://192.168.1.50:8888/`.

### B10. Backups

The Postgres data lives in a Docker volume named `db_data`. To back it up
into a SQL file:

```powershell
docker compose exec db pg_dump -U erp diagnostic_erp > backup.sql
```

To restore:

```powershell
type backup.sql | docker compose exec -T db psql -U erp -d diagnostic_erp
```

---

## Option C — Docker on a Synology NAS

**Yes — this works on any Synology with DSM 7.2+ and the Container Manager
package installed.** It's actually a great way to run the ERP because the NAS
is always on and already has a real LAN IP.

### Tested on

* DSM 7.2 with **Container Manager** (the new name for "Docker")
* Models with x86_64 CPUs (DS220+, DS224+, DS423+, DS923+, DS1522+, RS-series).
  ARM-only models like the DS218j are not supported by Docker on Synology.

### C1. Install Container Manager

DSM → **Package Center** → search "Container Manager" → **Install**.

### C2. Upload the project files

1. Open **File Station** on the NAS.
2. In the `docker` shared folder (Container Manager creates this), make a
   sub-folder called `diagnostic-erp`.
3. Upload the entire project folder into it. After upload it should look like:
   ```
   /docker/diagnostic-erp/
       Dockerfile
       docker-compose.yml
       package.json
       artifacts/
       lib/
       …
   ```

### C3. Create a Project in Container Manager

1. Open **Container Manager → Project → Create**.
2. **Project name:** `diagnostic-erp`.
3. **Path:** browse to `/docker/diagnostic-erp`.
4. **Source:** "Use existing docker-compose.yml in this path".
5. Container Manager will read the file and show you the 4 services
   (db, api, web, migrate). Click **Next**.
6. Optionally edit the auto-generated `.env` to set a real `DB_PASSWORD` and
   change `HOST_PORT` if 8888 is already used by another DSM service.
7. Click **Done**. The first build takes 10–15 minutes on a typical NAS CPU.

### C4. Run the one-time database migration

In Container Manager → Project → `diagnostic-erp` → **Action → Build / Up
the migrate service**, *or* via SSH:

```bash
sudo docker compose -f /volume1/docker/diagnostic-erp/docker-compose.yml \
     run --rm migrate
```

### C5. Open the app

* From your phone or any PC on the same Wi-Fi:
  `http://<NAS_IP>:8888/`
* From inside the NAS itself:
  `http://localhost:8888/`

The container's `restart: unless-stopped` policy means the app comes back up
automatically after a NAS reboot or DSM update.

### C6. Putting it on a real domain (optional)

If you want `https://erp.myclinic.com` instead of an IP+port URL:

1. Synology DSM → **Control Panel → Login Portal → Reverse Proxy → Create**.
2. **Source:** HTTPS, your domain, port 443.
3. **Destination:** HTTP, `localhost`, port `8888`.
4. Either use a free Let's Encrypt cert (DSM → Security → Certificate) or
   your own.

### C7. Backups on Synology

Use Hyper Backup to back up the `db_data` volume regularly. Or run the
same `pg_dump` command from C/B10 inside an SSH session.

---

## Updating to a newer version of the project

Whichever option you're using:

1. Stop the app (`docker compose down` for B/C, or `Ctrl+C` for A).
2. Replace the project folder with the new version (or `git pull`).
3. Re-run the migration step (`docker compose run --rm migrate` or
   `pnpm db:push`).
4. Start again (`docker compose up -d --build` or `pnpm dev`).

Your Postgres data is **never** deleted by these steps — it lives in either
the Postgres install on your PC (Option A) or the `db_data` Docker volume
(Options B/C).

---

## Troubleshooting

### `docker compose up` fails with "no space left on device"
Open Docker Desktop → Settings → Resources → increase the disk image size.

### Port 8888 is already in use
Edit `.env` and set `HOST_PORT=8889` (or any free port), then
`docker compose up -d`.

### "Cannot connect to the Docker daemon"
Docker Desktop isn't running. Open it from the Start menu and wait for the
green "Engine running" status.

### Slow first build
Most of the time is spent in `pnpm install` (~3 minutes) and the production
bundle (~1 minute). Subsequent builds re-use the Docker layer cache and take
seconds.

### Can I use this on macOS or Linux?
Yes — every Docker command above works identically on macOS (Docker Desktop)
and Linux (`docker` + `docker compose` from your distro).

### Can I use this on a Raspberry Pi?
Only if it's a Pi 4 / Pi 5 with a 64-bit OS. The base images (`node:24-alpine`,
`postgres:16-alpine`, `nginx:alpine`) are all multi-arch, so the build itself
works. Performance is acceptable for a small clinic but not great for heavy
reporting.
