# Database Schema Plan — Enterprise Radiology

## Monitoring & Analytics Tables

### radiologist_performance_stats
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| radiologist_id | integer | FK to staff |
| radiologist_name | text | Denormalized for reporting |
| period_type | text | daily / weekly / monthly |
| period_date | text | YYYY-MM-DD or YYYY-WNN |
| total_studies | integer | Count assigned |
| reported_studies | integer | Count finalized |
| preliminary_reports | integer | Draft count |
| final_reports | integer | Final count |
| avg_tat_minutes | integer | Turnaround time |
| stat_studies | integer | STAT priority count |
| emergency_studies | integer | Emergency count |
| routine_studies | integer | Routine count |
| ai_drafts_used | integer | AI drafts consumed |
| ai_drafts_accepted | integer | AI drafts finalized |
| critical_findings_flagged | integer | Critical alerts raised |
| modality_breakdown | text | JSON: {"MR":5,"CT":3} |

### critical_findings_alerts
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| worklist_id | integer | FK to radiology_worklist |
| study_id | integer | FK to radiology_studies |
| accession_number | text | |
| patient_id | integer | |
| patient_name | text | |
| modality | text | |
| severity | text | stat / emergency / high / medium |
| finding_type | text | stroke / hemorrhage / fracture / tumor |
| description | text | |
| flagged_by | text | AI or radiologist name |
| ai_confidence | numeric(3,2) | 0.00-1.00 |
| acknowledged | boolean | |
| status | text | active / acknowledged / resolved |

### ai_server_health_log
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| provider | text | gemini / openai / anthropic |
| model | text | |
| endpoint | text | GPU URL if local |
| status | text | healthy / degraded / down |
| latency_ms | integer | |
| success | boolean | |
| tokens_used | integer | |
| check_type | text | actual_call / periodic_ping |

### pacs_archive_lifecycle
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| study_instance_uid | text unique | |
| accession_number | text | |
| modality | text | |
| original_size_bytes | numeric(20,0) | |
| compressed_size_bytes | numeric(20,0) | |
| compression_ratio | numeric(5,2) | e.g. 3.50 |
| compression_method | text | jpeg2000 / rle / none |
| tier | text | hot / warm / cold / archived |
| last_accessed_at | timestamp | |
| restore_count | integer | |
| auto_compressed | boolean | |
| retention_days | integer | Configured policy |

### watchdog_status
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| service_name | text unique | dicom_pull_agent / ai_worker |
| display_name | text | Human label |
| status | text | healthy / degraded / down / restarting |
| last_heartbeat | timestamp | |
| restart_count | integer | |
| max_restarts | integer | Default 5 |
| auto_restart_enabled | boolean | |
| consecutive_failures | integer | |
| check_interval_seconds | integer | Default 60 |
| metadata | text | JSON extra info |

### ris_sync_status
| Column | Type | Purpose |
|--------|------|---------|
| id | serial PK | |
| sync_type | text | dicom_mwl / pacs_pull / hl7_adt |
| source_system | text | conquest / orthanc / hl7_bridge |
| target_system | text | erp / pacs / ai_server |
| status | text | idle / syncing / synced / error |
| items_pending | integer | |
| items_synced | integer | |
| items_failed | integer | |
| avg_sync_time_ms | integer | |

## Indexing Strategy
- perf_stats: (radiologist_id, period_type, period_date)
- cf_alerts: (status), (severity), (created_at)
- ai_health: (provider), (status), (created_at)
- archive: (study_instance_uid), (tier), (patient_id)
- watchdog: (status), (last_heartbeat)
- ris_sync: (sync_type), (status)
