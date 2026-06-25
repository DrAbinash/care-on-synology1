# Care Diagnostics — Doctor-Friendly Synology NAS Installation Guide

> Last updated: 20 May 2026

## What You Need

1. **Synology NAS** with DSM 7.0 or newer (any model that supports Docker — DS220+, DS920+, DS923+, etc.)
2. **Docker & Docker Compose** installed from Package Center (free)
3. A computer on the same network to copy files
4. About 30 minutes of your time

---

## Step 1: Prepare Your NAS

1. Open **Synology DSM** in your browser (`http://your-nas-ip:5000`)
2. Go to **Package Center** → Search for **"Container Manager"** → Install it
3. Container Manager includes Docker — no separate download needed

---

## Step 2: Create a Shared Folder

1. Open **Control Panel** → **Shared Folder** → **Create**
2. Name it: `care-diagnostics`
3. Pick a volume with enough space (50 GB minimum recommended)
4. Click through the wizard (default permissions are fine)

This folder will hold all your software files and patient database.

---

## Step 3: Copy the Software Files

On your Windows PC or Mac:

1. Open **File Station** (in DSM) or use **Windows File Explorer** and browse to `\\your-nas-ip\care-diagnostics`
2. Create a new folder inside called `deploy`
3. Copy these files into the `deploy` folder (they will be provided on a USB drive or download link):
   - `docker-compose.yml`
   - `Dockerfile`
   - `docker/nginx.conf`
   - `.env.docker.example` (rename this to `.env` and edit it — see Step 4)

---

## Step 4: Set Your Password (Important!)

1. Open the `.env` file you just copied (use Notepad or any text editor)
2. Find this line:
   ```
   DB_PASSWORD=changeme
   ```
3. Change `changeme` to a **strong password** (at least 12 characters, mix of letters and numbers)
4. **Save the file**

> ⚠️ **Never skip this step.** Your patient data lives in this database. A weak password is a security risk.

---

## Step 5: Start the System

1. Open **Container Manager** in DSM
2. Click **Project** (left sidebar) → **Create**
3. Pick:
   - **Path**: `/volume1/care-diagnostics/deploy` (or wherever you put the files)
   - **Source**: **Create docker-compose.yml**
4. It will auto-detect the `docker-compose.yml` file
5. Click **Next** → **Build**
6. Wait 5–10 minutes while it downloads and builds

---

## Step 6: Create the Database (One-Time Setup)

After the build finishes:

1. In Container Manager, go to **Container** (left sidebar)
2. You should see these containers running:
   - `care-db` (green dot)
   - `care-api` (green dot)
   - `care-web` (green dot)
3. Click **care-db** → make sure it says **Running**
4. Go back to **Project** → click the **...** menu next to your project → **Run**
5. In the dropdown, choose `migrate` → **Run**
6. Wait 30 seconds — this creates all the database tables

> You only need to run `migrate` **once** when setting up. After that, the system runs automatically.

---

## Step 7: Open Care Diagnostics

1. Open your browser
2. Go to: `http://your-nas-ip:8888`
   - Replace `your-nas-ip` with your NAS's actual IP address (e.g., `192.168.1.50`)
3. You should see the **public clinic website**
4. Staff login: `http://your-nas-ip:8888/erp/`

---

## Step 8: First-Time Setup

### Create Your Admin Account

2. Click **Setup** → create your Admin PIN
3. Log in with that PIN

### Configure Clinic Details

1. Go to **Settings** → **Clinic Info**
2. Enter:
   - Clinic name
   - Address
   - Phone number
   - GSTIN (if applicable)
3. Upload your clinic logo
4. Click **Save**

### Add Your First Staff Member

2. Enter name, phone, email, role
3. Set a 6-digit PIN for login
4. The staff member can now log in at `http://your-nas-ip:8888/erp/`

---

## Daily Operation

### Starting the System

The system **auto-starts** when your NAS boots. You don't need to do anything manually.

To check if it's running:
1. Open **Container Manager** → **Container**
2. All three containers (`care-db`, `care-api`, `care-web`) should have a green dot

### Shutting Down (Optional)

If you ever need to stop the system:
1. Container Manager → **Project** → **Stop**
2. This pauses everything safely

### Updating the Software

When a new version is released:
1. Copy the new `docker-compose.yml` and `Dockerfile` into the `deploy` folder
2. Container Manager → **Project** → **Rebuild**
3. Your data is preserved — only the software updates

---

## Backing Up Your Data

Your patient data is stored in the `db_data` Docker volume. For non-technical backup:

### Method 1: Synology Hyper Backup (Recommended)

1. Install **Hyper Backup** from Package Center
2. Create a backup task
3. Select the `care-diagnostics` shared folder
4. Schedule daily backups to an external USB drive or another NAS

### Method 2: Manual Export

1. In the ERP, go to **Settings** → **Backup**
2. Click **Export Database** → download the `.sql` file
3. Store it safely (USB drive, cloud storage, etc.)

---

## Troubleshooting

| Problem | What to Do |
|---------|------------|
| Can't open the website | Check that `care-web` container is running (green dot). Make sure you're using the NAS IP, not `localhost`. |
| "Cannot connect to database" | Check that `care-db` is running. Wait 2 minutes after NAS boot — database takes time to start. |
| Want to change the port (8888) | Edit `.env` → change `HOST_PORT=8888` to another number (e.g., `8080`) → rebuild the project. |
| Slow performance | Your NAS may be underpowered. Models like DS220+ or DS923+ handle this well. DS118 may feel slow. |

---

## URL Quick Reference

| What You Want | URL (replace `your-nas-ip`) |
|---------------|----------------------------|
| Public clinic website | `http://your-nas-ip:8888/` |
| Staff ERP login | `http://your-nas-ip:8888/erp/` |
| Patient portal | `http://your-nas-ip:8888/erp/portal` |
| Mobile app preview | `http://your-nas-ip:8888/mobile/` |

---

## Need Help?

- Check the full technical docs in `DEPLOY.md` (for IT staff)
- The Windows desktop version guide is in `README-WINDOWS.md`
- Security and threat model details are in `threat_model.md`

---

*Care Diagnostics — Making diagnostics simple, one test at a time.*