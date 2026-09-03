# Radiology Settings / PACS / MWL — Architecture Audit & Consolidation Plan

**Date:** 11 August 2026  
**Branch:** `cursor/radiology-settings-consolidation-098d`  
**Status:** Implemented on this branch (UI consolidation + hardened MWL status). No production deploy from this PR.

**Constraint:** Additive / conservative. No storage-path changes. Preserve MWL safety work.

---

## Canonical home (after consolidation)

**All radiology / USG / PACS / MWL admin settings:** `Settings → Radiology` (`/settings/radiology`).

| Tab | Contents (was) |
| --- | --- |
| Overview | Traffic lights, sync-worker flags, Orthanc URL display, duplicate-sync warning |
| PACS / Viewer / MWL / Modalities / Sync | Existing center panels + Agent Setup on Sync |
| USG | `UsgExtractionPanel` (was `/radiology/usg-admin-settings`, `/usg/settings`) |
| Quick Select | embedded `RadiologyQuickSelectSettings` (was `/settings/radiology-quick-select`) |
| AI | AiReporting + AiInference panels (was sidebar AI settings pages) |
| Deployment | Read-only env: worklist dirs, Orthanc internal URL, secrets present/absent |
| Advanced | Hardening + deep-tool shortcuts (prefer `?tab=` when embedded) |

Legacy URLs redirect into the matching tab. Sidebar USG Admin / Quick Select entries removed.

### Still deploy-only (not editable in ERP UI)
- `ORTHANC_INTERNAL_URL`, Orthanc credentials, `INTERNAL_API_KEY`
- Host mount for `/orthanc-worklists` (staging lives at `/orthanc-worklists/staging` on that same bind)
- Orthanc `StorageDirectory` / `IndexDirectory` (care-pacs)
- Orthanc worklists plugin + care-mwl-guard

---

## A. Current-state map (pre-change audit snapshot)

### Canonical hub (already exists)
| Route | Page | Notes |
|-------|------|-------|
| `/settings/radiology` | `RadiologySettingsCenter.tsx` | Aliases: `/radiology/settings`, `/radiology/settings-center`, `/radiology/pacs-settings` |
| Tabs today | General, Reading Suite, Profiles, Modalities, PACS Servers, PACS/DICOM Full, Viewers, DICOM & MWL, AI, USG, Style, Premium, Voice, Diagnostics, History, Advanced | Too many; duplicates + stale copy |

### Standalone ops / diagnostics
| Route | Page |
|-------|------|
| `/radiology/flight-deck` | Flight Deck (read-only diagnostics) |
| `/radiology/network-control-center` | Network Control Center |
| `/radiology/watchdog` | Pacs Watchdog |
| `/radiology/dicom-agent-dashboard` | DICOM Agent |
| `/radiology/agent-setup` | Agent Setup (docs) |
| `/radiology/pacs-dashboard` | Pacs Dashboard |
| `/radiology/pacs-logs` | Pacs Logs |
| `/radiology/mwl-manager` | Phase-12 MWL entries (different model) |
| `/dicom-nodes` | DICOM Q/R nodes |
| `/radiology/modality-management` | Modalities |
| `/pacs` | Legacy PACS browser |

### Setting sources
| Source | Examples |
|--------|----------|
| `pacs_settings` DB | OHIF/Weasis URLs, Orthanc AE/IP/ports, voice, network routes |
| `.env` / compose | `ORTHANC_INTERNAL_URL`, `ORTHANC_WORKLIST_DIR`, `ORTHANC_WORKLIST_HOST_DIR`, credentials, poller flags |
| Orthanc `orthanc.json` | Worklists plugin, StorageDirectory (care-pacs — do not edit from ERP) |
| Runtime probes | `/api/radiology/mwl-status`, `/network/health`, Flight Deck |

### Important paths (production)
| Role | Container path | Host path |
|------|----------------|-----------|
| Live MWL | `/orthanc-worklists` | `/volume1/docker/care-pacs/orthanc/worklists` |
| Staging | `/orthanc-worklists/staging` | `/volume1/docker/care-pacs/orthanc/worklists/staging` (same bind as live) |
| Quarantine (mwl-guard) | `/worklists-bad` (read-only) | `/volume1/docker/care-pacs/orthanc/worklists-bad` |
| Internal Orthanc | `ORTHANC_INTERNAL_URL=http://172.16.1.139:8042` | Separate Docker network from care-api |

---

## B. Duplicate / scattered controls

1. OHIF / Weasis URLs: Viewers tab + PacsSettings + ViewerNetworkRoutesCard  
2. Network profile: localStorage banner vs `viewer_network_mode`  
3. Watchdog / Agent / Logs: standalone routes + PacsDashboard embeds  
4. Two MWL systems: Orthanc `.wl` files vs Phase-12 `mwl_entries` vs Windows agent API  
5. `viewer_mode` enum conflict: `LAN/VPN/DYNAMIC` vs `WEASIS/OHIF/BOTH` vs `BOTH/OHIF_ONLY/WEASIS_ONLY`

---

## C. Incorrect / stale assumptions

1. **Hardcoded** `http://care-orthanc:8042` in RadiologySettingsCenter with claim that Docker service names are fine — **false** when ERP and Orthanc are on separate Compose networks.  
2. MWL `ready=true` when only `env_dir` + `dir_writable` + `dump2dcm` pass — **misses EXDEV**, publish gap (1173 scheduled / 0 `.wl`), Orthanc unreachable.  
3. Probe fallback invents `care-orthanc:8042` when env unset.  
4. Dead keys: `mwl_default_*` written by PacsSettings, unused by api-server.  
5. `MwlDashboard.tsx` not routed.

---

## D. Proposed consolidated architecture

**One hub:** Radiology → Settings (`/settings/radiology`)

| Tab | Purpose |
|-----|---------|
| **Overview** | Green/yellow/red for Orthanc, OHIF, MWL, sync, modalities |
| **PACS Server** | Endpoints, AE, ports; storage status READ-ONLY |
| **Viewer** | Browser URLs vs server URLs clearly labeled |
| **Modality Worklist** | Enabled, staging/live mounts, counts, sync, guard/plugin, no false PASS |
| **Modalities** | AE/IP/port panels (existing) |
| **Sync / Automation** | Which workers are active; duplicate warning |
| **Diagnostics** | Links to Flight Deck, logs, watchdog, agent, network (no duplicate editors) |
| **Advanced / Deployment** | READ-ONLY env-derived values (actual resolved, never invented) |
| *Legacy* | Reading Suite, AI, Style, Voice, etc. kept under secondary group |

Preserve old routes via redirects/banners.

---

## E. Files / endpoints that change

| Area | Change |
|------|--------|
| `mwlDeploymentStatus.ts` | Staging/atomic publish probes; publish-gap fail; verdict; real Orthanc URL; dcmdump |
| `mwlWorklistWriter.ts` | Export `getMwlStagingDir()` (no behavior change) |
| `GET /api/radiology/mwl-status` | Richer payload (backward compatible) |
| `GET /api/radiology/admin-overview` | **New** overview aggregation |
| `MwlStatusPanel.tsx` | RED on failed; show staging/gap/atomic |
| `RadiologyAdminOverview.tsx` | **New** Overview tab |
| `RadiologyDeploymentPanel.tsx` | **New** Advanced read-only env panel |
| `RadiologySettingsCenter.tsx` | Tab IA + remove hardcoded care-orthanc |
| Tests | MWL healthy/degraded/EXDEV/unreachable/separate-network |

---

## F. Risks

| Risk | Mitigation |
|------|------------|
| Stricter `ready=false` alarms clinics that previously saw green | Correct — false green was the bug; document in PR |
| Overview endpoint timeout if Orthanc slow | Short timeouts; parallel probes; degrade to yellow |
| Tab rename breaks bookmarks | Keep old tab values as aliases where possible |
| Secrets leak | Never return passwords; mask username presence only |

---

## G. Migration plan

1. Ship additive API + UI on this branch.  
2. Keep PacsSettings / Flight Deck / Network Control routes.  
3. Banner on redundant pages: “Canonical settings: Radiology → Settings”.  
4. Do **not** delete legacy pages in this PR.  
5. Manual deploy still required for: `ORTHANC_INTERNAL_URL`, worklist mounts, Orthanc plugin, care-pacs guard, credentials.
