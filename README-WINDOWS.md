# Running the Diagnostic Center Billing ERP on Windows

This project was built on Replit but can run on a regular Windows (or macOS / Linux)
machine with a few one-time setup steps.

---

## 1. Install the prerequisites

Install all of these once:

| Tool | Where to get it | Notes |
| --- | --- | --- |
| **Node.js 20 or newer** | https://nodejs.org (pick the LTS installer) | During install, leave "Add to PATH" checked. |
| **pnpm** | After Node is installed, open PowerShell and run: `npm install -g pnpm` | This project does not work with `npm` or `yarn`. |
| **PostgreSQL 14 or newer** | https://www.postgresql.org/download/windows/ | Remember the password you set for the `postgres` user. |
| **Git** *(optional but recommended)* | https://git-scm.com/download/win | Only needed if you want to pull updates from a Git repo. |

> Tip: open a **new** PowerShell window after each install so the new commands are on the PATH.

---

## 2. Get the code

If you downloaded `project.tar.gz`, extract it with 7-Zip or Windows Explorer.
You should end up with a folder that contains `package.json`, `pnpm-workspace.yaml`,
`artifacts/`, `lib/`, etc.

Open a **PowerShell** window inside that folder.

---

## 3. Create a database

In PowerShell (or pgAdmin), create an empty database, e.g.:

```powershell
psql -U postgres -c "CREATE DATABASE diagnostic_erp;"
```

---

## 4. Configure environment variables

Copy the example file:

```powershell
copy .env.example .env
```

Open `.env` in any editor and at minimum set `DATABASE_URL` to point at the database
you just created. For the default Postgres install on Windows that will look like:

```
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/diagnostic_erp
```

The optional variables (Gemini AI, PACS, etc.) are only needed if you actually
use those features.

---

## 5. Install project dependencies

From the project root:

```powershell
pnpm install
```

This pulls down everything for all the workspaces. It can take a few minutes the first time.

---

## 6. Create the database tables

```powershell
pnpm db:push
```

You should see drizzle apply the schema and exit cleanly. If you ever change the
schema in `lib/db/src/schema`, just run this command again.

---

## 7. Start the apps

```powershell
pnpm dev
```

This launches three services in parallel and prints their logs side by side:

| Service | URL |
| --- | --- |
| Diagnostic ERP web UI | http://localhost:5173 |
| API server | http://localhost:8080/api |

The web UIs talk to the API server on the same machine, so just open the URLs above
in your browser.

To stop everything, press `Ctrl + C` in the PowerShell window.

### Auto-restart mode

If you want the three dev services to relaunch automatically after a crash, use:

```powershell
pnpm dev:restart
```


### Running services individually

You can also start them one at a time in separate PowerShell windows:

```powershell
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/diagnostic-erp run dev
```

---

## Building a production bundle

```powershell
pnpm build
```

Then to serve the API server in production mode:

```powershell
pnpm --filter @workspace/api-server run start
```

The web frontends are built as static files into
`artifacts/diagnostic-erp/dist/public` and
file server (IIS, nginx, `npx serve`, etc.).

---

## Troubleshooting

* **`pnpm: command not found`** — close and reopen PowerShell after `npm install -g pnpm`.
* **`DATABASE_URL must be set`** — your `.env` file is missing or `DATABASE_URL` is empty.
  Make sure `.env` lives in the project root (next to `package.json`).
* **Port already in use** — change the port in `.env`:
  `PORT=6000` (api server) or edit the per-app port in the npm script.
* **`Use pnpm instead`** during install — you ran `npm install` or `yarn`. Use `pnpm install`.
* **Postgres password issues** — verify the credentials with
  `psql -U postgres -h localhost -d diagnostic_erp` first.