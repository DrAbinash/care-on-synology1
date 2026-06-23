# UI Workflow Plan — Enterprise RIS/PACS

## Staff Navigation — Radiology & Imaging Group

```
Radiology & Imaging
├── Study Workflow (/radiology)
├── PACS Worklist (/radiology/worklist)
│   └── Table of all DICOM studies with filters
│       ├── Status badges: Received, AI Draft, In Progress, Final, Delivered
│       ├── Search: patient name, accession, modality
│       ├── Actions: Open Weasis, Open OHIF, AI Draft, Workspace, Mark Final
│       └── Auto-refresh every 30s
├── PACS Viewer (/pacs)
├── DICOM Q/R (/radiology/dicom-qr)
├── Reporting Workspace (/radiology/reporting-workspace/:id)
│   └── Three-column layout
│       ├── LEFT: Patient demographics + template selector
│       ├── CENTER: Report editor + embedded DICOM viewer (toggle)
│       └── RIGHT: AI assistant drawer
├── Report Generator (/radiology/report-generator)
├── PACS Command Center (/radiology/pacs-dashboard)
│   └── Enterprise monitoring dashboard
│       ├── Queue depth visualization
│       ├── AI health panel with provider cards
│       ├── Critical findings alert feed
│       ├── Radiologist productivity cards
│       └── RIS sync status indicators
├── PACS Settings (/radiology/pacs-settings)
├── PACS Logs (/radiology/pacs-logs)
├── Agent Monitor (/radiology/dicom-agent-dashboard)
├── Modalities (/radiology/modality-management)
├── DICOM Nodes (/dicom-nodes)
├── MWL Dashboard (/radiology/mwl-dashboard)
├── Agent Setup (/radiology/agent-setup)
├── AI Reporting (/radiology/ai-reporting-settings)
├── Archive Lifecycle (/radiology/archive-lifecycle) ← NEW
│   └── Storage tier management
│       ├── Hot/Warm/Cold/Archived distribution cards
│       ├── Compression controls per study
│       ├── Storage metrics (original vs compressed vs savings)
│       └── Manual restore from cold/archived
├── Watchdog (/radiology/watchdog) ← NEW
│   └── Service health cards
│       ├── Heartbeat timeline
│       ├── Auto-restart toggle per service
│       ├── Manual restart button
│       └── Consecutive failure counters
├── GPU Inference (/radiology/ai-inference-settings) ← NEW
│   └── AI backend configuration
│       ├── GPU endpoint URL
│       ├── Model selection (preset list)
│       ├── Batch size / timeout / concurrency
│       ├── Fallback-to-cloud toggle
│       ├── Connection test button
│       └── 24h health check log stream
└── Teleradiology Portal (/teleradiology)
```

## Patient Portal — Radiology Flow
```
Patient Login → My Reports → View Radiology Report
  └── Report with findings, impression, key images
  └── Share via WhatsApp / Email / Link
```

## Key UX Principles
- All radiology pages accessible to any logged-in staff (no /orders permission gate)
- Embedded viewer collapsible — radiologist chooses when to see images
- AI drafts require explicit "Mark Final" — no auto-finalization
- Archive tier changes require confirmation; restore from cold is instant
- Watchdog auto-restart defaults ON but can be disabled per service
