# Super-Admin USB Pen Drive — Setup Guide

The Super Admin Portal is gated by a physical USB pen drive. Without the pen
drive, the Super Admin link does not appear in the billing UI and the
super-admin login endpoint refuses every request — regardless of who you are
or whether you know the PIN.

This works the same way on:

- the cloud deploy (e.g. `caredeoghar.replit.app`)
- the Windows portable / desktop build that runs from the pen drive itself

## One-time setup (do this once)

### Step 1: Generate the key file

1. **Generate a strong random key** on any computer:
   ```bash
   openssl rand -hex 32
   ```
   This produces a 64-character string. Treat it like a password — do not
   share it, do not paste it into chat.

2. **Save the same value in TWO places, exactly identical:**

   a. **As the Replit secret `SUPER_ADMIN_USB_KEY`** in your project (Tools →
      Secrets). The api-server reads this at startup. If unset, the USB gate
      stays disabled and super-admin works on PIN alone (back-compat).

   b. **As a plain text file named `superadmin.key` on your USB pen drive.**
      Just the value — no quotes, no newline tricks needed. Notepad / nano
      will work fine.

### Step 2: Generate the PIN file (optional, for auto-login)

1. **Generate a PIN** (e.g., 4-8 digits):
   ```bash
   openssl rand -hex 4
   ```
   This produces an 8-character hex string. You can also use a simple numeric PIN.

2. **Save the same value in TWO places:**

   a. **As the Replit secret `SUPER_ADMIN_USB_PIN`** in your project (Tools →
      Secrets). The api-server reads this at startup. If unset, auto-login is
      disabled and you must type the PIN manually (back-compat).

   b. **As a plain text file named `superadmin.pin` on your USB pen drive.**
      Just the value — no quotes, no newline tricks needed.

3. **Plug the pen drive into the computer you bill from.**

## One-time pairing — billing PC (do this ONCE per browser profile)

There is **no visible button** for this. Operators who don't know the
combo cannot tell that USB-key support exists.

1. Plug in the pen drive.
2. In the billing app, press **Ctrl + Alt + U**. A small "Pair super-admin
   pen drive" dialog appears.
3. Click **"Pick pen-drive folder"**. Chrome's folder picker opens — pick
   the **root of the pen drive** (the folder that contains
   `superadmin.key`). Allow read access when prompted.
4. The dialog closes silently. The Super Admin link appears in the sidebar.

The browser remembers the folder permanently for this PC. If you ever want
to pair a different drive, press Ctrl+Alt+U again and click **"Re-pair"**.

### Browser support

The auto-detect needs the **File System Access API**, available in Chrome,
Edge, Brave, Opera, Arc, and other Chromium-based browsers (Windows, macOS,
Linux, Chrome OS). Firefox and Safari fall back to a simple file picker
inside the same Ctrl+Alt+U dialog — they need to pick `superadmin.key` once
per session manually.

## Daily use

1. Plug in the pen drive **before** opening the billing app (or while it's
   open — within a few seconds the link appears).
2. The amber **"Super Admin"** link with a `KEY` badge will be visible at
   the bottom of the sidebar.
3. Click it → opens the Super Admin Portal in a new tab.
   - If you have `superadmin.pin` on the pen drive, you'll be logged in
     **automatically** — no typing needed.
   - If you don't have the PIN file, you'll see the PIN screen. Log in with
     your PIN as before.
4. **Pull the pen drive** when you're done. Within 4 seconds the link
   disappears and the in-browser key is cleared automatically — anyone
   else using this PC sees no trace of the super-admin surface. Closing
   the tab also clears the key.

## Direct super-admin portal access

If you open `/super-admin-portal/` directly (without going through the billing
UI), you'll be greeted by the **"Insert USB Key"** unlock screen first. Same
file picker — pick `superadmin.key`, then the PIN screen appears.

## What happens if someone steals the cloud URL

Nothing. Without the `superadmin.key` file content, every super-admin
endpoint returns `401 USB key required`. The PIN form on the portal won't
even submit. The Super Admin link in the billing UI is invisible.

## Rotating the key

If a pen drive is lost or you suspect the key leaked:

1. Generate a new value (`openssl rand -hex 32`).
2. Update the Replit secret `SUPER_ADMIN_USB_KEY`.
3. Restart the api-server workflow (it reads the env at startup).
4. Re-write `superadmin.key` on a fresh pen drive with the new value.
5. Old pen drives stop working immediately.

## Disabling the gate (NOT recommended)

Delete the `SUPER_ADMIN_USB_KEY` secret. The api-server will log a warning at
startup and let super-admin requests through with PIN-only auth (legacy
behavior). The "Insert USB key" button disappears from the billing UI sidebar.
