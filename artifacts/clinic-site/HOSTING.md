# Hosting the Clinic Website Anywhere

The public clinic site (`artifacts/clinic-site`) is a plain static React + Vite
single-page app. Once built it is just a folder of HTML / JS / CSS files that
can be served by **any** static web host — Apache, nginx, Caddy, Synology Web
Station, Netlify, Vercel, Cloudflare Pages, GitHub Pages, IIS, S3, etc.

The only moving piece you must keep running somewhere reachable from your
visitors is the **api-server** (Node.js), which serves `/api/website/*` and
the uploaded images under `/uploads/*`. The static site fetches all its
content from that API at runtime.

---

## 1. Build a portable bundle

From the monorepo root:

```bash
# 1. Tell the build where the api-server will live in production.
#    Skip this step if the site and the API will share the same domain
#    (e.g. clinic.com serves both / and /api).
cat > artifacts/clinic-site/.env.production <<'EOF'
VITE_API_BASE_URL=https://api.my-clinic.com
VITE_ASSET_BASE_URL=https://api.my-clinic.com
BASE_PATH=/
EOF

# 2. Install + build
pnpm install
pnpm --filter @workspace/clinic-site run build
```

The output lands in `artifacts/clinic-site/dist/public/`. Upload the **entire
contents** of that folder to your host's web root.

`BASE_PATH=/` is correct for a domain root (`https://clinic.com/`). If you
serve under a sub-path like `https://clinic.com/site/`, set `BASE_PATH=/site/`
before building.

---

## 2. Required server config — SPA fallback

This is a single-page app, so **every unknown URL must serve `index.html`**
(otherwise reloading `/about` returns 404). Each host below shows how.

### Apache (`.htaccess` in the web root)

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### nginx

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

### Caddy

```caddyfile
clinic.com {
  root * /var/www/clinic-site
  try_files {path} /index.html
  file_server
}
```

### Netlify / Vercel / Cloudflare Pages

Add a `_redirects` file with `/* /index.html 200`, or set the framework preset
to "Vite" — the platforms detect SPA routing automatically.

---

## 3. Hosting on a Synology NAS  ✅ Yes, fully supported

You will run **two pieces** on the NAS:

| Piece           | DSM package          | Purpose                                |
|-----------------|----------------------|----------------------------------------|
| Static frontend | **Web Station**      | Serves the built `dist/public/` folder |
| API + DB        | **Container Manager**| Runs the api-server + Postgres         |

DSM's built-in **Reverse Proxy** ties them together on a single domain.

### 3.1 Prerequisites

- DSM 7.2 or later
- Packages installed from Package Center:
  - **Web Station** (and the **Apache HTTP Server 2.4** or **Nginx** package
    it offers)
  - **Container Manager** (formerly "Docker")
- A domain pointing at your NAS and a Let's Encrypt certificate
  (Control Panel → Security → Certificate)
- Ports 80 and 443 forwarded to the NAS on your router

### 3.2 Deploy the static site via Web Station

1. **Build** the site with `BASE_PATH=/` and your public API URL set
   (see section 1).
2. In DSM, open **File Station** and create a folder under the `web` shared
   folder, e.g. `/web/clinic-site/`.
3. Upload everything inside `dist/public/` into that folder. The folder must
   contain `index.html` at its top level.
4. Open **Web Station → Web Service Portal → Create**:
   - Service: *Static website*
   - Document root: `/web/clinic-site`
   - Choose *Apache 2.4* (so the `.htaccess` SPA fallback below works) or
     *Nginx* (then put the `try_files` block in 3.4).
   - Hostname: e.g. `clinic.example.com` (or use a port-based portal).
5. Drop a `.htaccess` file (Apache) in `/web/clinic-site/` with the
   contents from section 2.
6. Web Station → **Script Language Settings** → make sure HTTPS is on and
   HTTP is redirected.

Test by visiting `https://clinic.example.com/` — the home page should load.
Try `https://clinic.example.com/about` and refresh — it must still work
(SPA fallback test).

### 3.3 Deploy the api-server via Container Manager

The simplest path is a Docker stack with two services: Postgres + the API.

1. SSH into the NAS, or use **Container Manager → Project → Create**.
2. Create a folder, e.g. `/volume1/docker/clinic-api/`, and place a
   `docker-compose.yml`:

   ```yaml
   services:
     db:
       image: postgres:16-alpine
       restart: unless-stopped
       environment:
         POSTGRES_USER: clinic
         POSTGRES_PASSWORD: change-me-please
         POSTGRES_DB: clinic
       volumes:
         - ./pgdata:/var/lib/postgresql/data
     api:
       # Build the api-server image once on a workstation:
       #   pnpm --filter @workspace/api-server run build
       #   docker build -t clinic-api -f artifacts/api-server/Dockerfile .
       # then push to your registry, or load it on the NAS via
       #   docker load -i clinic-api.tar
       image: clinic-api:latest
       restart: unless-stopped
       depends_on: [db]
       environment:
         NODE_ENV: production
         PORT: 8080
         DATABASE_URL: postgres://clinic:change-me-please@db:5432/clinic
         # CORS — allow the static site to call this API
         CORS_ORIGIN: https://clinic.example.com
       volumes:
         - ./uploads:/app/data/uploads   # persist uploaded photos/logos
       ports:
         - "127.0.0.1:8080:8080"          # bind to localhost; reverse proxy exposes it
   ```

3. Container Manager → **Project → Create → Use docker-compose.yml** →
   point it at the file → **Build**.
4. Run the database migration once (see `lib/db/README` or the
   `db-migrate` build the windows-build script produces).

### 3.4 Wire it up with DSM Reverse Proxy

Open **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:

| Field                | Value                                |
|----------------------|--------------------------------------|
| Source protocol      | HTTPS                                |
| Source hostname      | `clinic.example.com`                 |
| Source port          | 443                                  |
| Destination protocol | HTTP                                 |
| Destination hostname | `localhost`                          |
| Destination port     | 8080                                 |

Then under **Custom header** add:

```
X-Forwarded-For       $proxy_add_x_forwarded_for
X-Forwarded-Proto     $scheme
X-Real-IP             $remote_addr
```

Add **two location rules** under that proxy entry so only `/api` and
`/uploads` hit the Node app while everything else stays on Web Station:

| Location  | Destination               |
|-----------|---------------------------|
| `/api`    | `http://localhost:8080`   |
| `/uploads`| `http://localhost:8080`   |

If you prefer to keep the API on its own subdomain (e.g.
`api.clinic.example.com`) instead, set `VITE_API_BASE_URL` to that subdomain
when building the static site, and skip the location rules above.

### 3.5 Auto-renew TLS

Control Panel → **Security → Certificate** → assign your Let's Encrypt
certificate to both `clinic.example.com` and the reverse-proxy entry. DSM
renews it automatically every ~60 days.

---

## 4. Hosting on Netlify / Vercel / Cloudflare Pages

1. Push the repo to GitHub.
2. In the platform UI, create a new project pointing at the repo.
3. Configure the build:
   - **Base directory:** `artifacts/clinic-site`
   - **Build command:** `pnpm install --filter @workspace/clinic-site... && pnpm --filter @workspace/clinic-site run build`
   - **Output directory:** `dist/public`
   - **Environment variables:** `VITE_API_BASE_URL`, `VITE_ASSET_BASE_URL`,
     `BASE_PATH=/`
4. SPA routing is auto-detected on all three platforms.
5. Host the api-server separately (Fly.io, Railway, your Synology, a VPS, …).

---

## 5. CORS checklist when API is on a different origin

If your API runs on a different domain from the static site, the api-server
already enables `cors()` globally (see `artifacts/api-server/src/app.ts`).
For production you should restrict it to your real frontend domain by setting
`CORS_ORIGIN=https://clinic.example.com` and reading it inside the cors
middleware (open an issue if you need this hardened — the dev default `*` is
fine while testing).

---

## 6. Quick "is it working?" checklist

After uploading the build:

- [ ] `https://your-domain/` shows the home page (hero + services).
- [ ] `https://your-domain/about` works after a hard refresh
      (SPA fallback OK).
- [ ] DevTools → Network shows `GET /api/website/settings` returning 200
      from your API origin.
- [ ] `Coming soon` page does NOT appear → means `isPublished=true` in the
      ERP and the API is reachable.
- [ ] Uploaded logo / favicon load (asset base resolves correctly).
- [ ] WhatsApp floating button appears if you enabled it in the ERP.
