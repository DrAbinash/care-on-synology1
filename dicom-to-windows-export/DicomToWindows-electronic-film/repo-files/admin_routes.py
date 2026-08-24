"""Admin UI routes and API handlers."""
from __future__ import annotations

import json
import os
import platform
import socket
import subprocess
import sys
import urllib.request
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable, Optional

import admin_auth
import config_store
import image_profiles
import job_store
from identity_audit import summarize_identity

_CTX: dict[str, Any] = {}


def init(context: dict[str, Any]) -> None:
    global _CTX
    _CTX = context


def _read_admin_ui() -> bytes:
    path = Path(__file__).with_name("admin_ui.html")
    return path.read_bytes()


def _json_response(handler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        pass


def _session_token(handler) -> str:
    cookie = handler.headers.get("Cookie", "")
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("admin_session="):
            return part.split("=", 1)[1].strip()
    return handler.headers.get("X-Admin-Session", "").strip()


def _require_admin(handler) -> bool:
    token = _session_token(handler)
    if admin_auth.validate_session(token):
        handler._admin_token = token  # type: ignore[attr-defined]
        return True
    _json_response(handler, HTTPStatus.UNAUTHORIZED, {"error": "login required"})
    return False


def _require_csrf(handler) -> bool:
    token = getattr(handler, "_admin_token", "")
    csrf = handler.headers.get("X-CSRF-Token", "")
    if admin_auth.validate_csrf(token, csrf):
        return True
    _json_response(handler, HTTPStatus.FORBIDDEN, {"error": "invalid CSRF token"})
    return False


def _lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _git_commit() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=3,
            cwd=str(Path(__file__).parent),
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return os.environ.get("GIT_COMMIT", "unknown")


def dashboard_payload() -> dict[str, Any]:
    printer_status_fn: Callable = _CTX.get("check_printer_status", lambda: ("UNKNOWN", ""))
    status, info = printer_status_fn()
    capture_mode = str(config_store.get("CAPTURE_MODE"))
    erp_url = str(config_store.get("ERP_BRANDING_URL") or "")
    erp_status = "NOT_CONFIGURED"
    erp_last_sync = _CTX.get("erp_last_sync", "")
    if erp_url:
        try:
            with urllib.request.urlopen(erp_url, timeout=3) as resp:
                erp_status = "CONNECTED" if resp.status == 200 else "FAILED"
        except Exception:
            erp_status = "FAILED"
    stats = job_store.storage_stats()
    jobs = job_store.list_jobs(limit=1)
    last_job = jobs[0] if jobs else None
    return {
        "status": _CTX.get("bridge_status", "RUNNING"),
        "aeTitle": config_store.get("DICOM_AET"),
        "dicomPort": config_store.get("DICOM_PORT"),
        "lanIp": _lan_ip(),
        "allowedCallingAes": config_store.get("ALLOWED_CALLING_AETS"),
        "captureMode": capture_mode,
        "httpPort": config_store.get("HTTP_PORT"),
        "erpBrandingUrl": erp_url,
        "erpStatus": erp_status,
        "erpLastSync": erp_last_sync,
        "brandingSource": config_store.get("BRANDING_SOURCE"),
        "outputDir": stats.get("outputDir"),
        "physicalPrinter": {
            "method": config_store.get("PRINT_METHOD"),
            "cupsPrinter": config_store.get("CUPS_PRINTER_NAME"),
            "jetdirectHost": config_store.get("JETDIRECT_HOST"),
            "status": status,
            "info": info,
        },
        "lastAssociation": _CTX.get("last_association"),
        "lastInboundFilm": last_job,
        "lastSuccessfulCapture": _CTX.get("last_successful_capture"),
        "lastPhysicalPrint": _CTX.get("last_physical_print"),
        "lastError": _CTX.get("last_error"),
        "storage": stats,
    }


def diagnostic_report() -> dict[str, Any]:
    stats = job_store.storage_stats()
    printer_status_fn: Callable = _CTX.get("check_printer_status", lambda: ("UNKNOWN", ""))
    status, info = printer_status_fn()
    return {
        "generatedAt": datetime.now().isoformat(),
        "version": _CTX.get("version", "1.1.0"),
        "gitCommit": _git_commit(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "dicom": {
            "aeTitle": config_store.get("DICOM_AET"),
            "port": config_store.get("DICOM_PORT"),
            "listenerStatus": _CTX.get("bridge_status", "RUNNING"),
            "allowedCallingAes": config_store.get("ALLOWED_CALLING_AETS"),
            "recentAssociations": _CTX.get("recent_associations", []),
        },
        "captureMode": config_store.get("CAPTURE_MODE"),
        "careReachability": dashboard_payload().get("erpStatus"),
        "printer": {"status": status, "info": info, "method": config_store.get("PRINT_METHOD")},
        "outputDirWritable": stats.get("writable"),
        "diskUsageBytes": stats.get("diskUsageBytes"),
        "dependencies": {
            "pydicom": _CTX.get("pydicom_version", ""),
            "pynetdicom": _CTX.get("pynetdicom_version", ""),
            "numpy": _CTX.get("numpy_version", ""),
            "opencv": _CTX.get("opencv_version", ""),
            "pillow": _CTX.get("pillow_version", ""),
        },
        "recentErrors": _CTX.get("recent_errors", []),
        "settings": config_store.effective_settings(),
    }


def handle_admin_get(handler, path: str) -> bool:
    if path == "/admin":
        body = _read_admin_ui()
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        try:
            handler.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    if path == "/admin/api/login":
        _json_response(handler, HTTPStatus.METHOD_NOT_ALLOWED, {"error": "use POST"})
        return True

    if path.startswith("/admin/api/"):
        sub = path[len("/admin/api/"):]
        if sub == "dashboard":
            if not _require_admin(handler):
                return True
            _json_response(handler, HTTPStatus.OK, dashboard_payload())
            return True
        if sub == "settings":
            if not _require_admin(handler):
                return True
            _json_response(handler, HTTPStatus.OK, {
                "settings": config_store.effective_settings(),
                "presets": config_store.list_presets(),
            })
            return True
        if sub == "jobs":
            if not _require_admin(handler):
                return True
            _json_response(handler, HTTPStatus.OK, {"jobs": job_store.list_jobs(limit=200)})
            return True
        if sub.startswith("jobs/"):
            if not _require_admin(handler):
                return True
            job_key = sub[len("jobs/"):]
            record = job_store.get_job(job_key)
            if not record:
                _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "unknown job"})
                return True
            _json_response(handler, HTTPStatus.OK, record)
            return True
        if sub == "diagnostics":
            if not _require_admin(handler):
                return True
            _json_response(handler, HTTPStatus.OK, diagnostic_report())
            return True
        if sub == "calibration-preview":
            if not _require_admin(handler):
                return True
            preview = image_profiles.synthetic_grayscale_preview()
            from PIL import Image
            from io import BytesIO
            buf = BytesIO()
            Image.fromarray(preview).save(buf, format="PNG")
            data = buf.getvalue()
            handler.send_response(HTTPStatus.OK)
            handler.send_header("Content-Type", "image/png")
            handler.send_header("Content-Length", str(len(data)))
            handler.end_headers()
            handler.wfile.write(data)
            return True
        if sub.startswith("artifact/"):
            if not _require_admin(handler):
                return True
            name = sub[len("artifact/"):]
            base = Path(config_store.get("OUTPUT_DIR"))
            candidate = (base / name).resolve()
            if not str(candidate).startswith(str(base.resolve())) or not candidate.is_file():
                _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "artifact not found"})
                return True
            data = candidate.read_bytes()
            ctype = "application/pdf" if candidate.suffix.lower() == ".pdf" else "image/png"
            handler.send_response(HTTPStatus.OK)
            handler.send_header("Content-Type", ctype)
            handler.send_header("Content-Length", str(len(data)))
            handler.end_headers()
            handler.wfile.write(data)
            return True
        _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "not found"})
        return True
    return False


def handle_admin_post(handler, path: str, payload: dict) -> bool:
    if path == "/admin/api/login":
        username = str(payload.get("username", ""))
        password = str(payload.get("password", ""))
        client_id = handler.address_string()
        token = admin_auth.login(username, password, client_id)
        if not token:
            _json_response(handler, HTTPStatus.UNAUTHORIZED, {"error": "invalid credentials or rate limited"})
            return True
        csrf = admin_auth.get_csrf(token)
        _json_response(handler, HTTPStatus.OK, {"token": token, "csrf": csrf})
        return True

    if not path.startswith("/admin/api/"):
        return False

    sub = path[len("/admin/api/"):]
    if sub == "logout":
        admin_auth.logout(_session_token(handler))
        _json_response(handler, HTTPStatus.OK, {"ok": True})
        return True

    if not _require_admin(handler):
        return True
    if not _require_csrf(handler):
        return True

    if sub == "settings":
        updates = payload.get("settings", payload)
        if not isinstance(updates, dict):
            _json_response(handler, HTTPStatus.BAD_REQUEST, {"error": "settings must be an object"})
            return True
        if "ADMIN_PASSWORD" in updates and updates["ADMIN_PASSWORD"]:
            admin_auth.set_password(str(updates.pop("ADMIN_PASSWORD")))
        result = config_store.update(updates)
        reload_fn = _CTX.get("reload_live_config")
        if reload_fn:
            reload_fn()
        _json_response(handler, HTTPStatus.OK, result)
        return True

    if sub == "test-listener":
        port = int(config_store.get("DICOM_PORT"))
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=2):
                _json_response(handler, HTTPStatus.OK, {"ok": True, "message": f"DICOM port {port} reachable"})
        except OSError as exc:
            _json_response(handler, HTTPStatus.OK, {"ok": False, "message": str(exc)})
        return True

    if sub == "test-care":
        url = str(payload.get("url") or config_store.get("ERP_BRANDING_URL") or "")
        if not url:
            _json_response(handler, HTTPStatus.BAD_REQUEST, {"error": "ERP URL not configured"})
            return True
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                _json_response(handler, HTTPStatus.OK, {"ok": resp.status == 200, "status": resp.status})
        except Exception as exc:
            _json_response(handler, HTTPStatus.OK, {"ok": False, "error": str(exc)})
        return True

    if sub == "test-printer":
        printer_status_fn: Callable = _CTX.get("check_printer_status", lambda: ("UNKNOWN", ""))
        status, info = printer_status_fn()
        _json_response(handler, HTTPStatus.OK, {
            "ok": status == "NORMAL",
            "status": status,
            "info": info,
            "warning": "This may physically print if you run a separate print test from CUPS.",
        })
        return True

    if sub == "export-settings":
        include_secrets = bool(payload.get("includeSecrets"))
        _json_response(handler, HTTPStatus.OK, config_store.export_settings(include_secrets))
        return True

    if sub == "import-settings":
        include_secrets = bool(payload.get("includeSecrets"))
        result = config_store.import_settings(payload, include_secrets)
        reload_fn = _CTX.get("reload_live_config")
        if reload_fn:
            reload_fn()
        _json_response(handler, HTTPStatus.OK, result)
        return True

    if sub == "apply-preset":
        name = str(payload.get("name", ""))
        try:
            result = config_store.apply_preset(name)
            reload_fn = _CTX.get("reload_live_config")
            if reload_fn:
                reload_fn()
            _json_response(handler, HTTPStatus.OK, result)
        except ValueError as exc:
            _json_response(handler, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        return True

    if sub == "save-preset":
        name = str(payload.get("name", ""))
        try:
            config_store.save_preset(name)
            _json_response(handler, HTTPStatus.OK, {"ok": True})
        except ValueError as exc:
            _json_response(handler, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        return True

    _json_response(handler, HTTPStatus.NOT_FOUND, {"error": "not found"})
    return True
