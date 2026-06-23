#!/usr/bin/env python3
"""
HOPE PACS Agent — Reference implementation (from radiology_ris_pacs_integration_bundle).

This agent runs on the Conquest PACS server machine and polls the ERP's internal API
for pending DICOM pull jobs, executes them using findscu/movescu, and reports results.

Usage:
  python hope_pacs_agent.py

Environment variables:
  ERP_INTERNAL_URL   Base URL of the ERP internal API (e.g. https://your-erp.replit.app/api/internal)
  INTERNAL_API_KEY   Bearer token matching the ERP's INTERNAL_API_KEY secret
  POLL_INTERVAL_MS   How often to check for new jobs in milliseconds (default: 15000)
  AGENT_ID           Unique identifier for this agent host (default: hostname)
"""

import os
import sys
import time
import socket
import subprocess
import requests
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("hope-pacs-agent")

ERP_URL       = os.environ.get("ERP_INTERNAL_URL", "http://localhost:8080/api/internal")
API_KEY       = os.environ.get("INTERNAL_API_KEY", "")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_MS", "15000")) / 1000
AGENT_ID      = os.environ.get("AGENT_ID", socket.gethostname())

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type":  "application/json",
}


def get_pending_jobs():
    r = requests.get(f"{ERP_URL}/dicom/pull-jobs/pending", headers=HEADERS, timeout=10)
    r.raise_for_status()
    return r.json().get("jobs", [])


def claim_job(job_id: int):
    r = requests.patch(
        f"{ERP_URL}/dicom/pull-jobs/{job_id}/claim",
        json={"agentId": AGENT_ID},
        headers=HEADERS,
        timeout=10,
    )
    return r.status_code == 200, r.json()


def report_job(job_id: int, status: str, studies_found=0, studies_pulled=0, studies_failed=0, error_msg=None):
    payload = {
        "status":         status,
        "studiesFound":   studies_found,
        "studiesPulled":  studies_pulled,
        "studiesFailed":  studies_failed,
        "agentId":        AGENT_ID,
    }
    if error_msg:
        payload["errorMessage"] = error_msg
    r = requests.patch(
        f"{ERP_URL}/dicom/pull-jobs/{job_id}",
        json=payload,
        headers=HEADERS,
        timeout=10,
    )
    return r.status_code == 200


def log_event(message, severity="info", event_type=None, accession=None, modality=None):
    try:
        requests.post(
            f"{ERP_URL}/radiology/dicom-event",
            json={
                "severity":        severity,
                "source":          "hope-pacs-agent",
                "eventType":       event_type,
                "message":         message,
                "accessionNumber": accession,
                "modality":        modality,
            },
            headers=HEADERS,
            timeout=5,
        )
    except Exception:
        pass  # Never let logging block the main flow


def run_findscu(node, query_date_from, query_date_to):
    """Execute C-FIND SCU against the DICOM node. Returns list of study instance UIDs."""
    cmd = [
        "findscu", "-v",
        "-aec", node.get("aeTitle", "CONQUEST"),
        node.get("host", "localhost"),
        str(node.get("port", 104)),
        "-S",
        "-k", "0008,0052=STUDY",
        "-k", f"0008,0020={query_date_from.replace('-','')}-{query_date_to.replace('-','')}",
        "-k", "0020,000D",  # Study Instance UID
        "-k", "0008,0050",  # Accession Number
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        uids = []
        for line in result.stdout.splitlines():
            if "0020,000D" in line:
                parts = line.split("[")
                if len(parts) > 1:
                    uid = parts[1].split("]")[0].strip()
                    if uid:
                        uids.append(uid)
        return uids
    except Exception as e:
        log.error(f"findscu failed: {e}")
        return []


def run_movescu(node, conquest_ae, uid):
    """Execute C-MOVE SCU to pull one study into Conquest."""
    cmd = [
        "movescu",
        "-aec", node.get("aeTitle", "CONQUEST"),
        "-aem", conquest_ae,
        node.get("host", "localhost"),
        str(node.get("port", 104)),
        "-S",
        "-k", "0008,0052=STUDY",
        "-k", f"0020,000D={uid}",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return result.returncode == 0
    except Exception as e:
        log.error(f"movescu failed: {e}")
        return False


def process_job(job):
    job_id = job["id"]
    node = job.get("node") or {}
    conquest_ae = node.get("conquestAeTitle") or os.environ.get("CONQUEST_AE_TITLE", "CONQUEST")

    log.info(f"Processing job {job_id} for node {node.get('aeTitle')} [{job['queryDateFrom']} → {job['queryDateTo']}]")

    ok, claimed = claim_job(job_id)
    if not ok:
        log.warning(f"Job {job_id} already claimed by another agent: {claimed}")
        return

    try:
        uids = run_findscu(node, job["queryDateFrom"], job["queryDateTo"])
        studies_found = len(uids)
        log.info(f"Job {job_id}: found {studies_found} studies")
        log_event(f"C-FIND returned {studies_found} studies", event_type="CFIND_COMPLETE")

        pulled = 0
        failed = 0
        for uid in uids:
            success = run_movescu(node, conquest_ae, uid)
            if success:
                pulled += 1
            else:
                failed += 1

        status = "completed" if failed == 0 else ("partial" if pulled > 0 else "failed")
        report_job(job_id, status, studies_found, pulled, failed)
        log_event(f"Pull job {job_id} {status}: {pulled}/{studies_found} studies", event_type="PULL_JOB_DONE")
        log.info(f"Job {job_id} {status}: pulled={pulled} failed={failed}")

    except Exception as e:
        log.error(f"Job {job_id} failed with exception: {e}")
        report_job(job_id, "failed", error_msg=str(e))
        log_event(f"Pull job {job_id} failed: {e}", severity="error", event_type="PULL_JOB_ERROR")


def main():
    log.info(f"HOPE PACS Agent starting. ERP={ERP_URL} Agent={AGENT_ID} Poll={POLL_INTERVAL}s")
    if not API_KEY:
        log.warning("INTERNAL_API_KEY not set — requests will fail auth")

    while True:
        try:
            jobs = get_pending_jobs()
            if jobs:
                log.info(f"{len(jobs)} pending job(s) found")
                for job in jobs:
                    process_job(job)
            else:
                log.debug("No pending jobs")
        except Exception as e:
            log.error(f"Poll cycle failed: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
