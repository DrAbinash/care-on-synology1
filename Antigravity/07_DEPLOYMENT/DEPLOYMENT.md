# Deployment Guide: Care Diagnostics ERP / RIS-PACS Platform

This guide provides steps to deploy Care Diagnostics to:
1. **Windows Docker Desktop** (Development/Local)
2. **Synology Container Manager** (On-Premises Production)
3. **Cloud VPS (Ubuntu/Debian)** (Remote Production)

---

## 1. Windows Docker Desktop

### Prerequisites
* Windows 10/11 Pro/Enterprise or Home (with WSL2 enabled)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
* Git or the unzipped project folder

### Deployment Steps
1. Open PowerShell or Command Prompt in the project folder root.
2. Copy the docker environment example to `.env`:
   ```powershell
   copy .env.example .env
   ```
3. Edit `.env` to specify your secrets and database password:
   ```env
   DB_PASSWORD=your_secure_password
   JWT_SECRET=your_jwt_secret
   SESSION_SECRET=your_session_secret
   ```
4. Start the stack:
   ```bash
   docker compose up -d --build
   ```
5. Wait 3–5 minutes. The migrations container (`care-migrate`) will automatically run and push the schema.
6. Verify containers are running:
   ```bash
   docker compose ps
   ```
7. Open in browser:
   * Public Clinic Site: `http://localhost:8888`
   * Staff ERP Portal: `http://localhost:8888/erp/`

---

## 2. Synology Container Manager (DSM 7.x)

### Prerequisites
* Synology NAS with DSM 7.0 or newer
* **Container Manager** package installed from Package Center
* A Shared Folder named `care-diagnostics` created via Control Panel

### Deployment Steps
1. **Prepare Directories**:
   * Open **File Station** on your NAS.
   * Go to the `care-diagnostics` shared folder.
   * Create a folder called `deploy` inside it.
2. **Transfer Files**:
   * Copy the following files/folders from your computer into `/volume1/care-diagnostics/deploy/`:
     * `docker-compose.yml`
     * `Dockerfile`
     * `docker/nginx.conf`
     * `.env.example` (Rename this to `.env` on the NAS and edit it).
3. **Configure Environment Variables**:
   * Open the `.env` file in File Station Text Editor (or any notepad).
   * Fill out the values (especially `DB_PASSWORD`, `JWT_SECRET`, and `SESSION_SECRET`). Save the file.
4. **Deploy Stack in Container Manager**:
   * Open **Container Manager** on DSM.
   * Go to **Project** (sidebar) → **Create**.
   * Fill in the form:
     * **Project Name**: `care-diagnostics`
     * **Path**: Select the `/volume1/care-diagnostics/deploy` folder.
     * **Source**: Choose **Create docker-compose.yml**.
   * The manager will automatically parse the `docker-compose.yml` file.
   * Click **Next** → **Build**.
5. **Initial DB Setup**:
   * Synology Container Manager will download base images and compile the packages sequentially.
   * After the build completes, the `care-db`, `care-api`, and `care-web` containers will start automatically.
   * The `care-migrate` container will automatically run the schema migrations once. If it fails, select it and choose **Run** or inspect the container log to make sure the database is up.
6. **Access App**:
   * Public Clinic Site: `http://<your-nas-ip>:8888`
   * Staff ERP Portal: `http://<your-nas-ip>:8888/erp/`

---

## 3. Future Cloud VPS Deployment (Ubuntu/Debian)

### Prerequisites
* A VPS (AWS EC2, DigitalOcean, Linode, Hetzner, etc.) with at least **2 vCPUs** and **4 GB RAM**
* Docker and Docker Compose installed:
  ```bash
  sudo apt update
  sudo apt install -y docker.exe docker-compose-plugin
  ```

### Deployment Steps
1. SSH into your VPS:
   ```bash
   ssh root@your-vps-ip
   ```
2. Clone the codebase or upload the zip folder contents to a directory (e.g., `/opt/caredeoghar`).
3. Set up the `.env` file:
   ```bash
   cp .env.example .env
   # Edit env using nano or vim
   nano .env
   ```
4. Build and start the stack:
   ```bash
   docker compose up -d --build
   ```
5. Set up a reverse proxy (like Nginx, Caddy, or Traefik) on the host to enable HTTPS/SSL via Let's Encrypt (port 80/443).
