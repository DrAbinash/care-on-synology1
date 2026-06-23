# Enterprise RIS/PACS + AI Ecosystem — Implementation Roadmap

## Phase 1: Visibility & Monitoring (COMPLETE)

### Wave 1: Schema + Backend Foundation
- radiologist_performance_stats — daily/weekly aggregated productivity
- critical_findings_alerts — life-threatening finding notifications
- ai_server_health_log — per-provider latency, success rate, quota
- pacs_archive_lifecycle — study compression and tiered storage
- Backend APIs: performance-stats, critical-findings, ai-health, archive-lifecycle, queue-monitor

### Wave 2: Frontend Command Center
- PACS Command Center dashboard (enhanced PacsDashboard)
- Real-time RIS sync status indicator
- Queue monitoring with bottleneck analysis
- AI server health panel with provider breakdown
- Critical findings alert feed with severity badges
- Radiologist productivity cards with TAT metrics

## Phase 2: Enterprise Deep Features (COMPLETE)

### Wave 3: Advanced Features
- **Embedded DICOM Viewer** — Zero-footprint WADO viewer integrated into the Reporting Workspace with zoom, pan, window/level, series navigation, and brightness/contrast controls
- **Archive Lifecycle Admin UI** — Tier management (hot/warm/cold/archived), compression queuing, storage metrics, manual restore
- **GPU AI Inference Settings** — Configure local GPU endpoint URL, model selection (CheXNet, lung CT, brain MRI, etc.), batch size, timeout, fallback-to-cloud, connection testing
- **Watchdog Dashboard** — Service health cards with heartbeat monitoring, auto-restart toggle, manual restart signals, consecutive failure tracking

## Phase 3: Integration & Hardening (NEXT)

### Wave 4: Documentation
- Architecture diagram (Canvas)
- Database schema reference
- UI workflow documentation
- Phased deployment strategy

### Wave 5: Production Hardening
- Load testing for concurrent DICOM retrieval
- Backup/restore procedures for archive lifecycle
- SSL termination for GPU inference endpoints
- PII scrubbing for AI inference payloads
- Rate limiting on watchdog heartbeat endpoints

### Wave 6: Advanced AI Features
- DICOM series auto-segmentation (pre-labeling)
- Prior-study comparison with delta highlighting
- AI confidence scoring per finding
- Structured report auto-generation from DICOM SR

## Key Decisions
- Cornerstone.js skipped — WADO JPEG renderer used instead for zero dependency footprint
- All new pages open to all authenticated staff (no /orders permission gate)
- AI drafts never auto-finalize — explicit radiologist action required
- Archive policies run nightly via cron; manual overrides available
