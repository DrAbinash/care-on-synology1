# Care Diagnostics Booking — Mobile App Deployment Guide

How to build, test, and publish the `diagno-booking-mobile` Expo app to the
Google Play Store and Apple App Store, and how to push updates afterward.

This app is already configured for store builds:
- `app.json` — Android package `com.caredeoghar.booking`, iOS bundle id
  `com.caredeoghar.booking`, permissions, adaptive icon.
- `eas.json` — development / preview / production EAS Build profiles.
- `STORE_LISTING.md` (same folder) — ready-to-paste Play Store listing text,
  Data Safety declarations, and reviewer instructions.
- Privacy policy hosted at `https://caredeoghar.com/app-privacy`.

---

## 0. What you need before starting

| Item | Cost | Where |
|---|---|---|
| Google Play Console account | $25 one-time | play.google.com/console |
| Apple Developer Program (iOS only) | $99/year | developer.apple.com |
| Expo (EAS) account | Free tier works | expo.dev |
| A machine with internet access, Node.js + pnpm | — | your laptop/PC |
| The clinic's live API domain reachable over HTTPS | — | already running |

You cannot build or submit from this sandboxed session — it has no network
access to Expo's build servers or the app stores. Everything below runs on
your own machine.

For a clinic/business listing, register the Play Console account as an
**Organization** (needs a D-U-N-S number; verification can take a few days —
start this first, it's the longest lead time in the whole process).

---

## 1. One-time setup

```bash
# On your machine, inside the repo:
cd artifacts/diagno-booking-mobile
pnpm install

npm install -g eas-cli
eas login                 # log in with your Expo account
eas init                  # creates the EAS project, fills app.json's
                           # extra.eas.projectId placeholder for you
```

Confirm `eas.json`'s `env.EXPO_PUBLIC_DOMAIN` (currently `caredeoghar.com`)
is the real domain where `artifacts/api-server` is reachable over HTTPS —
the app calls `https://<that domain>/api/...` at runtime. Edit the `build`
profiles in `eas.json` if it differs.

---

## 2. Build

### Android

```bash
eas build --platform android --profile production
```

- First run: EAS offers to generate and manage an Android signing keystore —
  accept. This is what Google Play requires; EAS stores it for you so you
  never lose it.
- Produces a `.aab` (Android App Bundle — required by Play Store). Build runs
  on Expo's servers (~10–20 min); you get a download link when it finishes.

### iOS

```bash
eas build --platform ios --profile production
```

- Requires your Apple Developer account. EAS will prompt to log in and can
  auto-manage certificates/provisioning profiles.
- Produces a `.ipa`.

### Quick device test build (before spending a production build)

```bash
eas build --platform android --profile preview
```
Produces an installable `.apk` you can side-load onto a test phone directly
— faster feedback loop than a full store submission.

---

## 3. Google Play Store

### 3.1 Create the app

Play Console → **Create app** → set name, default language, category
**Medical**, "Free".

### 3.2 Internal testing first (don't go straight to Production)

**Testing → Internal testing → Create release** → upload the `.aab` → add
your own email as a tester → install via the opt-in link → verify on a real
phone:
- WhatsApp OTP login works end-to-end
- Booking + payment flow completes for at least one gateway
- Reports tab opens a PDF
- Staff login + Bill Desk (if you use it)

### 3.3 Required store listing sections

Everything below is mandatory — Play won't let you publish without it.
Copy-paste content for most of these is in **`STORE_LISTING.md`**.

- **Store listing**: app name, short/full description, icon (512×512,
  derive from `assets/images/icon.png`), feature graphic (1024×500), at
  least 2 phone screenshots.
- **Content rating** questionnaire (Play Console walks you through it).
- **Data safety** form — declare what's collected (phone, name, health/lab
  data, no ads/tracking). Exact answers are in `STORE_LISTING.md`.
- **Privacy policy URL**: `https://caredeoghar.com/app-privacy`
  (mandatory for any health-related app).
- **App access**: reviewers can't receive your WhatsApp OTP — the exact
  instructions to give them are in `STORE_LISTING.md` under "App access
  instructions."
- **Target audience & ads**: no ads, standard audience.

### 3.4 Promote to production

Once internal testing looks good: **Testing → Internal → Promote release →
Production**. First submission gets a manual review — allow a few days to
~2 weeks for a health-category app.

---

## 4. Apple App Store (optional, iOS)

1. Create the app in **App Store Connect** (appstoreconnect.apple.com),
   matching bundle id `com.caredeoghar.booking`.
2. Upload the `.ipa` — easiest via EAS directly:
   ```bash
   eas submit --platform ios
   ```
   (First time, EAS will ask for your Apple credentials / app-specific
   password and app details.)
3. Fill in App Store listing: description, screenshots (per device size
   Apple requires), privacy policy URL (same one), **App Privacy** nutrition
   label (declares the same data categories as the Play Data Safety form —
   phone number, name, health data; no tracking).
4. Add **App Review notes** explaining the WhatsApp OTP login the same way
   as the Play "App access" note, since Apple reviewers face the identical
   problem.
5. Submit for review (typically 1–3 days).

---

## 5. Releasing updates after launch

For every new build:

1. Bump the version in `app.json`:
   - `version` (e.g. `1.0.0` → `1.0.1`) — the human-facing version.
   - `android.versionCode` — the production EAS profile has
     `autoIncrement: true`, so this bumps automatically on each build; no
     manual edit needed.
   - `ios.buildNumber` — bump manually (or also enable autoIncrement).
2. Rebuild: `eas build --platform android --profile production` (and/or
   `ios`).
3. Upload the new `.aab`/`.ipa` the same way as the first release (or use
   `eas submit` to automate the upload once you've set up a Google
   service-account key / Apple credentials).

Because most of the app's *content* (clinic info, services, promo banner,
tab visibility) is admin-editable from **ERP Settings → Mobile App**, most
day-to-day changes don't need a new store release at all — only code
changes (new features, bug fixes) do.

---

## 6. Automating the upload (optional)

Once comfortable with the manual flow:

```bash
eas submit --platform android   # needs a Google Play service-account JSON key
eas submit --platform ios       # needs Apple credentials
```

Set these up under **Play Console → Setup → API access** (service account)
and in your Apple Developer account respectively; EAS's docs walk through
both (`eas submit --help`).

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| App can't reach the API after install | `EXPO_PUBLIC_DOMAIN` in `eas.json` doesn't match the real API host, or the API isn't reachable over HTTPS from the public internet |
| Play rejects for "broken login" | Reviewer couldn't receive the WhatsApp OTP — make sure the App access instructions from `STORE_LISTING.md` are filled in |
| "Duplicate version code" on upload | Bump `android.versionCode` (or rely on the production profile's `autoIncrement`) |
| Payment gateway doesn't open | Confirm the gateway is configured and enabled in ERP → Settings → Online Booking, and that the device has network access to the gateway's domain |
| Build fails with a missing native module error | Run `pnpm install` at the repo root first — some native deps (e.g. `react-native-webview`) must be installed before `eas build` |

---

## Summary checklist

- [ ] Play Console account created (Organization, if a clinic) — start early, verification takes days
- [ ] Apple Developer account created (only if shipping iOS)
- [ ] `eas init` run, `app.json` projectId filled in
- [ ] `EXPO_PUBLIC_DOMAIN` in `eas.json` confirmed correct
- [ ] Production build produced (`eas build`)
- [ ] Tested via Internal Testing track on a real device
- [ ] Icon, feature graphic, screenshots prepared
- [ ] Store listing text pasted from `STORE_LISTING.md`
- [ ] Data Safety / App Privacy answered
- [ ] Privacy policy URL set: `https://caredeoghar.com/app-privacy`
- [ ] App access / review notes added (WhatsApp OTP explanation)
- [ ] Promoted to Production
