"""Per-modality image processing profiles and extended calibration."""
from __future__ import annotations

import json
import os
from typing import Any, Optional

import cv2
import numpy as np

import config_store

MODALITY_ALIASES = {
    "US": "USG", "USG": "USG", "IVUS": "USG",
    "ECHO": "ECHO", "EC": "ECHO",
    "CT": "CT",
    "MR": "MRI", "MRI": "MRI",
    "CR": "XR", "DX": "XR", "XR": "XR", "RG": "XR", "RF": "XR", "XA": "XR",
}


def _parse_profiles() -> dict[str, dict[str, Any]]:
    raw = config_store.get("MODALITY_PROFILES")
    if isinstance(raw, dict):
        return raw
    env = os.environ.get("MODALITY_PROFILES", "")
    if env:
        try:
            parsed = json.loads(env)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    profiles: dict[str, dict[str, Any]] = {}
    for key, value in os.environ.items():
        if not key.startswith("LAYOUT_"):
            continue
        name = key[len("LAYOUT_"):].upper()
        if name in ("ROWS", "COLS"):
            continue
    return profiles


def normalize_modality(modality: str) -> str:
    text = str(modality or "").strip().upper()
    return MODALITY_ALIASES.get(text, text)


def get_profile(modality: str) -> dict[str, Any]:
    profiles = _parse_profiles()
    key = normalize_modality(modality)
    profile = profiles.get(key, {})
    return {
        "brightness": float(profile.get("brightness", config_store.get("BRIGHTNESS"))),
        "contrast": float(profile.get("contrast", config_store.get("CONTRAST"))),
        "gamma": float(profile.get("gamma", config_store.get("GAMMA"))),
        "sharpness": float(profile.get("sharpness", config_store.get("SHARPNESS"))),
        "blackPoint": float(profile.get("blackPoint", config_store.get("CONTRAST_LOW_PERCENTILE"))),
        "whitePoint": float(profile.get("whitePoint", config_store.get("CONTRAST_HIGH_PERCENTILE"))),
        "invert": bool(profile.get("invert", config_store.get("INVERT_POLARITY"))),
        "layoutRows": int(profile.get("layoutRows", config_store.get("LAYOUT_ROWS"))),
        "layoutCols": int(profile.get("layoutCols", config_store.get("LAYOUT_COLS"))),
        "pageSize": str(profile.get("pageSize", config_store.get("PAGE_SIZE"))),
    }


def layout_for_modality(modality: str, default_rows: int, default_cols: int) -> tuple[int, int]:
    profile = get_profile(modality)
    rows = max(1, int(profile.get("layoutRows", default_rows)))
    cols = max(1, int(profile.get("layoutCols", default_cols)))
    return rows, cols


def _percentile_bounds(values: np.ndarray, lo_pct: float, hi_pct: float) -> tuple[float, float]:
    lo, hi = np.percentile(values, [lo_pct, hi_pct])
    if hi <= lo:
        hi = float(values.max())
        lo = 0.0
    if hi <= lo:
        hi = lo + 1.0
    return float(lo), float(hi)


def _apply_sharpness(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0:
        return arr
    amount = min(amount, 2.0)
    blurred = cv2.GaussianBlur(arr, (0, 0), sigmaX=1.0)
    sharpened = cv2.addWeighted(arr, 1.0 + amount, blurred, -amount, 0)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


def calibrate_frame(
    arr: np.ndarray,
    is_color: bool,
    modality: str = "",
    enable: Optional[bool] = None,
) -> np.ndarray:
    """Apply global + per-modality calibration to a frame."""
    if enable is None:
        enable = bool(config_store.get("ENABLE_CALIBRATION"))
    profile = get_profile(modality)
    gamma = max(0.01, profile["gamma"])
    lo_pct = min(max(profile["blackPoint"], 0.0), 49.0)
    hi_pct = min(max(profile["whitePoint"], 51.0), 100.0)
    brightness = float(profile["brightness"])
    contrast = max(0.1, float(profile["contrast"]))
    sharpness = max(0.0, float(profile["sharpness"]))
    invert = bool(profile["invert"])

    if not enable:
        out = arr.astype(np.uint8) if arr.dtype == np.uint8 else np.clip(arr, 0, 255).astype(np.uint8)
    else:
        arr_f = arr.astype(np.float32)
        if is_color and arr_f.ndim == 3:
            luminance = cv2.cvtColor(np.clip(arr_f, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
            lo, hi = _percentile_bounds(luminance, lo_pct, hi_pct)
            stretched = np.clip((arr_f - lo) / (hi - lo), 0.0, 1.0)
            corrected = np.power(stretched, 1.0 / gamma)
            out = np.clip(corrected * 255.0, 0, 255).astype(np.uint8)
        else:
            channel = arr_f if arr_f.ndim == 2 else arr_f[..., 0]
            lo, hi = _percentile_bounds(channel, lo_pct, hi_pct)
            stretched = np.clip((arr_f - lo) / (hi - lo), 0.0, 1.0)
            corrected = np.power(stretched, 1.0 / gamma)
            out = np.clip(corrected * 255.0, 0, 255).astype(np.uint8)

    if brightness != 0:
        out = np.clip(out.astype(np.float32) + brightness * 255.0, 0, 255).astype(np.uint8)
    if contrast != 1.0:
        out = np.clip((out.astype(np.float32) - 127.5) * contrast + 127.5, 0, 255).astype(np.uint8)
    if sharpness > 0:
        out = _apply_sharpness(out, sharpness)
    if invert:
        out = 255 - out
    return out


def synthetic_grayscale_preview(width: int = 512, height: int = 256) -> np.ndarray:
    """Synthetic grayscale ramp for calibration preview — no patient pixels."""
    ramp = np.linspace(0, 255, width, dtype=np.uint8)
    tile = np.tile(ramp, (height, 1))
    # Step wedge patches for calibration preview
    for i, level in enumerate([32, 64, 128, 192]):
        x0 = int(width * (i + 1) / 5)
        x1 = x0 + width // 8
        tile[height // 4: height // 4 + height // 2, x0:x1] = level
    return calibrate_frame(tile, False, modality="", enable=True)
