"""Persisted operator configuration with ENV precedence.

Precedence model (highest wins):
  1. Environment variables (existing docker-compose / Container Manager deployments)
  2. Persisted operator configuration (/data/config/config.json)
  3. Built-in defaults

Settings marked restart_required cannot be changed at runtime without restarting
the container process (DICOM listener bind, HTTP listen port).
"""
from __future__ import annotations

import json
import os
import re
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any, Optional

CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/data/config"))
CONFIG_FILE = CONFIG_DIR / "config.json"
PRESETS_FILE = CONFIG_DIR / "presets.json"

_LOCK = threading.RLock()

# restart_required: DICOM listener + HTTP bind
RESTART_REQUIRED_KEYS = frozenset({
    "DICOM_AET", "DICOM_PORT", "ALLOWED_CALLING_AETS", "HTTP_PORT",
})

# live_apply: reloaded into runtime without restart
LIVE_APPLY_KEYS = frozenset({
    "CAPTURE_MODE", "GAMMA", "CONTRAST_LOW_PERCENTILE", "CONTRAST_HIGH_PERCENTILE",
    "ENABLE_CALIBRATION", "BRIGHTNESS", "CONTRAST", "SHARPNESS", "INVERT_POLARITY",
    "PAGE_SIZE", "PAGE_ORIENTATION", "HONOR_SCU_FILM_SIZE", "DPI", "MARGIN_MM",
    "GUTTER_MM", "LAYOUT_ROWS", "LAYOUT_COLS", "STRETCH_TO_FIT", "AUTO_FIT_LAYOUT",
    "BACKGROUND_COLOR", "BATCH_GROUP_BY", "BATCH_IDLE_TIMEOUT_SECONDS",
    "HONOR_SCU_LAYOUT", "PRESERVE_CONSOLE_LAYOUT",
    "HEADER_LINE1", "HEADER_LINE2", "HEADER_LOGO_PATH", "HEADER_ALIGN", "HEADER_HEIGHT_MM",
    "FOOTER_LINE1", "FOOTER_LINE2", "FOOTER_LOGO_PATH", "FOOTER_ALIGN", "FOOTER_HEIGHT_MM",
    "BANNER_BACKGROUND_COLOR", "SHOW_PATIENT_BANNER", "PATIENT_BANNER_HEIGHT_MM",
    "SHOW_IMAGE_LABELS", "IMAGE_LABEL_HEIGHT_MM", "BRANDING_SOURCE",
    "ERP_BRANDING_URL", "ERP_BRANDING_REFRESH_SECONDS", "ERP_BRANDING_TIMEOUT_SECONDS",
    "CLINIC_NAME", "CLINIC_TAGLINE", "CLINIC_ADDRESS1", "CLINIC_ADDRESS2",
    "CLINIC_CITY", "CLINIC_STATE", "CLINIC_PIN", "CLINIC_PHONE", "CLINIC_ALT_PHONE",
    "CLINIC_EMAIL", "CLINIC_WEBSITE", "CLINIC_LOGO_PATH",
    "OUTPUT_DIR", "OUTPUT_FORMAT", "JOB_RETENTION_DAYS",
    "PRINT_METHOD", "CUPS_SERVER", "CUPS_PRINTER_NAME", "CUPS_MEDIA",
    "JETDIRECT_HOST", "JETDIRECT_PORT", "START_CUPS",
    "HTTP_BRIDGE_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD_HASH",
    "SESSION_TTL_MINUTES", "LOG_LEVEL",
})

SECRET_KEYS = frozenset({
    "HTTP_BRIDGE_SECRET", "ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD",
})

DEFAULTS: dict[str, Any] = {
    "DICOM_AET": "PRINTSCP",
    "DICOM_PORT": 104,
    "ALLOWED_CALLING_AETS": "",
    "CAPTURE_MODE": "CAPTURE_AND_PRINT",
    "GAMMA": 2.0,
    "CONTRAST_LOW_PERCENTILE": 1.0,
    "CONTRAST_HIGH_PERCENTILE": 99.0,
    "ENABLE_CALIBRATION": True,
    "BRIGHTNESS": 0.0,
    "CONTRAST": 1.0,
    "SHARPNESS": 0.0,
    "INVERT_POLARITY": False,
    "PAGE_SIZE": "A4",
    "PAGE_ORIENTATION": "AUTO",
    "HONOR_SCU_FILM_SIZE": False,
    "HONOR_SCU_LAYOUT": True,
    "PRESERVE_CONSOLE_LAYOUT": True,
    "DPI": 300,
    "MARGIN_MM": 5.0,
    "GUTTER_MM": 2.0,
    "LAYOUT_ROWS": 2,
    "LAYOUT_COLS": 3,
    "STRETCH_TO_FIT": False,
    "AUTO_FIT_LAYOUT": True,
    "BACKGROUND_COLOR": "WHITE",
    "BATCH_GROUP_BY": "session",
    "BATCH_IDLE_TIMEOUT_SECONDS": 60,
    "HEADER_LINE1": "",
    "HEADER_LINE2": "",
    "HEADER_LOGO_PATH": "",
    "HEADER_ALIGN": "CENTER",
    "HEADER_HEIGHT_MM": 14.0,
    "FOOTER_LINE1": "",
    "FOOTER_LINE2": "",
    "FOOTER_LOGO_PATH": "",
    "FOOTER_ALIGN": "CENTER",
    "FOOTER_HEIGHT_MM": 10.0,
    "BANNER_BACKGROUND_COLOR": "BLACK",
    "SHOW_PATIENT_BANNER": True,
    "PATIENT_BANNER_HEIGHT_MM": 6.0,
    "SHOW_IMAGE_LABELS": True,
    "IMAGE_LABEL_HEIGHT_MM": 4.5,
    "BRANDING_SOURCE": "LOCAL",
    "ERP_BRANDING_URL": "",
    "ERP_BRANDING_REFRESH_SECONDS": 300,
    "ERP_BRANDING_TIMEOUT_SECONDS": 5,
    "CLINIC_NAME": "",
    "CLINIC_TAGLINE": "",
    "CLINIC_ADDRESS1": "",
    "CLINIC_ADDRESS2": "",
    "CLINIC_CITY": "",
    "CLINIC_STATE": "",
    "CLINIC_PIN": "",
    "CLINIC_PHONE": "",
    "CLINIC_ALT_PHONE": "",
    "CLINIC_EMAIL": "",
    "CLINIC_WEBSITE": "",
    "CLINIC_LOGO_PATH": "",
    "OUTPUT_DIR": "/data/print-jobs",
    "OUTPUT_FORMAT": "pdf",
    "JOB_RETENTION_DAYS": 30,
    "PRINT_METHOD": "cups",
    "CUPS_SERVER": "localhost:631",
    "CUPS_PRINTER_NAME": "",
    "CUPS_MEDIA": "",
    "JETDIRECT_HOST": "",
    "JETDIRECT_PORT": 9100,
    "START_CUPS": True,
    "HTTP_PORT": 8090,
    "HTTP_BRIDGE_SECRET": "",
    "ADMIN_USERNAME": "admin",
    "ADMIN_PASSWORD_HASH": "",
    "SESSION_TTL_MINUTES": 120,
    "LOG_LEVEL": "INFO",
    "MODALITY_PROFILES": {},
}

BUILTIN_PRESETS: dict[str, dict[str, Any]] = {
    "default": {},
    "mri": {
        "LAYOUT_ROWS": 2, "LAYOUT_COLS": 3, "GAMMA": 2.2,
        "MODALITY_PROFILES": {"MRI": {"gamma": 2.2, "brightness": 0.05}},
    },
    "ct": {
        "LAYOUT_ROWS": 2, "LAYOUT_COLS": 4, "GAMMA": 2.0,
        "MODALITY_PROFILES": {"CT": {"gamma": 2.0, "contrast": 1.1}},
    },
    "usg": {
        "LAYOUT_ROWS": 2, "LAYOUT_COLS": 3, "GAMMA": 1.8,
        "MODALITY_PROFILES": {"USG": {"gamma": 1.8, "brightness": 0.1}},
    },
    "xray": {
        "LAYOUT_ROWS": 1, "LAYOUT_COLS": 2, "GAMMA": 2.4,
        "MODALITY_PROFILES": {"XR": {"gamma": 2.4, "contrast": 1.15}},
    },
    "physical_film": {"PAGE_SIZE": "14X17", "HONOR_SCU_FILM_SIZE": True},
    "paper_print": {"PAGE_SIZE": "A4", "PAGE_ORIENTATION": "PORTRAIT"},
}

_persisted: dict[str, Any] = {}
_presets: dict[str, dict[str, Any]] = deepcopy(BUILTIN_PRESETS)


def _coerce(key: str, value: Any) -> Any:
    default = DEFAULTS.get(key)
    if value is None:
        return default
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int) and not isinstance(default, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
    if isinstance(default, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
    if isinstance(default, dict):
        return value if isinstance(value, dict) else default
    return str(value).strip() if value is not None else default


def _env_present(key: str) -> bool:
    return os.environ.get(key) not in (None, "")


def _read_persisted() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_persisted(data: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load() -> None:
    """Load persisted config from disk into memory."""
    global _persisted, _presets
    with _LOCK:
        _persisted = _read_persisted()
        if PRESETS_FILE.exists():
            try:
                raw = json.loads(PRESETS_FILE.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    _presets = {**BUILTIN_PRESETS, **raw}
            except (OSError, json.JSONDecodeError):
                _presets = deepcopy(BUILTIN_PRESETS)
        else:
            _presets = deepcopy(BUILTIN_PRESETS)


def overlay_env_from_persisted() -> None:
    """For keys not set in ENV, overlay persisted values into os.environ at startup."""
    load()
    with _LOCK:
        for key, default in DEFAULTS.items():
            if _env_present(key):
                continue
            if key in _persisted and _persisted[key] not in (None, ""):
                value = _persisted[key]
                if isinstance(value, (dict, list)):
                    os.environ[key] = json.dumps(value)
                else:
                    os.environ[key] = str(value)


def get(key: str) -> Any:
    with _LOCK:
        if _env_present(key):
            return _coerce(key, os.environ.get(key))
        if key in _persisted:
            return _coerce(key, _persisted[key])
        return deepcopy(DEFAULTS.get(key))


def get_source(key: str) -> str:
    with _LOCK:
        if _env_present(key):
            return "ENV"
        if key in _persisted:
            return "CONFIG"
        return "DEFAULT"


def effective_settings(keys: Optional[list[str]] = None) -> list[dict[str, Any]]:
    """Return effective values with metadata for admin UI."""
    target = keys or sorted(set(DEFAULTS.keys()))
    out = []
    for key in target:
        if key not in DEFAULTS:
            continue
        out.append({
            "key": key,
            "value": mask_secret(key, get(key)),
            "effectiveValue": mask_secret(key, get(key)),
            "source": get_source(key),
            "restartRequired": key in RESTART_REQUIRED_KEYS,
            "liveApply": key in LIVE_APPLY_KEYS,
            "isSecret": key in SECRET_KEYS,
        })
    return out


def mask_secret(key: str, value: Any) -> Any:
    if key not in SECRET_KEYS or not value:
        return value
    text = str(value)
    if len(text) <= 4:
        return "****"
    return text[:2] + "****" + text[-2:]


def update(updates: dict[str, Any], from_preset: str = "") -> dict[str, Any]:
    """Persist operator updates. ENV-sourced keys are not overwritten in file."""
    load()
    restart_needed = []
    applied = []
    skipped_env = []
    with _LOCK:
        for key, value in updates.items():
            if key not in DEFAULTS:
                continue
            if _env_present(key):
                skipped_env.append(key)
                continue
            _persisted[key] = value
            applied.append(key)
            if key in RESTART_REQUIRED_KEYS:
                restart_needed.append(key)
            elif key in LIVE_APPLY_KEYS:
                if isinstance(value, (dict, list)):
                    os.environ[key] = json.dumps(value)
                else:
                    os.environ[key] = str(value)
        _write_persisted(_persisted)
    return {
        "applied": applied,
        "skippedEnv": skipped_env,
        "restartRequired": restart_needed,
        "fromPreset": from_preset or None,
    }


def export_settings(include_secrets: bool = False) -> dict[str, Any]:
    load()
    with _LOCK:
        data = deepcopy(_persisted)
        if not include_secrets:
            for key in SECRET_KEYS:
                data.pop(key, None)
                data.pop("ADMIN_PASSWORD", None)
        return {"version": 1, "settings": data, "presets": _presets}


def import_settings(payload: dict[str, Any], include_secrets: bool = False) -> dict[str, Any]:
    settings = payload.get("settings") if isinstance(payload, dict) else None
    if not isinstance(settings, dict):
        raise ValueError("import payload must contain a settings object")
    filtered = {}
    for key, value in settings.items():
        if key not in DEFAULTS:
            continue
        if key in SECRET_KEYS and not include_secrets:
            continue
        filtered[key] = value
    result = update(filtered)
    presets = payload.get("presets")
    if isinstance(presets, dict):
        with _LOCK:
            _presets.update(presets)
            PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
            PRESETS_FILE.write_text(json.dumps(_presets, indent=2) + "\n", encoding="utf-8")
    return result


def list_presets() -> dict[str, dict[str, Any]]:
    load()
    with _LOCK:
        return deepcopy(_presets)


def apply_preset(name: str) -> dict[str, Any]:
    load()
    with _LOCK:
        preset = _presets.get(name)
        if preset is None:
            raise ValueError(f"unknown preset: {name}")
        if name == "default" and not preset:
            # reset to defaults except secrets
            to_clear = [k for k in _persisted.keys() if k not in SECRET_KEYS]
            for k in to_clear:
                _persisted.pop(k, None)
            _write_persisted(_persisted)
            return {"applied": [], "fromPreset": name}
        return update(preset, from_preset=name)


def save_preset(name: str, label: str = "") -> None:
    if name == "default":
        raise ValueError("cannot overwrite built-in default preset")
    if not re.match(r"^[a-z0-9_]+$", name):
        raise ValueError("preset name must be lowercase alphanumeric/underscore")
    load()
    with _LOCK:
        snapshot = {}
        for key in LIVE_APPLY_KEYS:
            if not _env_present(key) and key in _persisted:
                snapshot[key] = _persisted[key]
        _presets[name] = snapshot
        PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PRESETS_FILE.write_text(json.dumps(_presets, indent=2) + "\n", encoding="utf-8")


def validate_ae_title(value: str) -> str:
    text = str(value or "").strip()[:16]
    if not text:
        raise ValueError("AE Title is required")
    if not re.match(r"^[A-Za-z0-9 _]+$", text):
        raise ValueError("AE Title must use A-Z, 0-9, space, underscore only")
    return text


def validate_port(value: Any) -> int:
    port = int(value)
    if port < 1 or port > 65535:
        raise ValueError("port must be between 1 and 65535")
    return port


def validate_allowed_aets(value: str) -> list[str]:
    items = [a.strip()[:16] for a in str(value or "").split(",") if a.strip()]
    for item in items:
        if not re.match(r"^[A-Za-z0-9 _]+$", item):
            raise ValueError(f"invalid calling AE title: {item}")
    return items


def validate_safe_path(path_str: str, base: Path) -> Path:
    candidate = Path(path_str).resolve()
    base_resolved = base.resolve()
    if not str(candidate).startswith(str(base_resolved)):
        raise ValueError("path must stay within the allowed base directory")
    return candidate


# Load on import
load()
