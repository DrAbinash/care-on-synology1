#!/usr/bin/env python3
"""
DICOM Print SCP -> Windows/CUPS printer bridge.

Listens as a DICOM Print Management SCP (Basic Grayscale + Basic Color Print
Management Meta SOP Classes), calibrates incoming frames for glossy photo
paper, tiles them onto an A4/A5 page at 300 DPI, and spools the result to a
network printer via CUPS (including Windows-shared printers over SMB) or a
raw JetDirect (port 9100) socket.

All behaviour is controlled by environment variables (see the table below).
None of them are required to start the process, but PRINT_METHOD's matching
target (CUPS_PRINTER_NAME or JETDIRECT_HOST) must be set before a real print
job can be spooled.

  DICOM_AET                      SCP AE Title                         PRINTSCP
  DICOM_PORT                     SCP listen port                      104
  ALLOWED_CALLING_AETS           comma-separated allow-list, empty=any (none)

  GAMMA                          gamma correction exponent             2.0
  CONTRAST_LOW_PERCENTILE        black-point percentile for stretch    1.0
  CONTRAST_HIGH_PERCENTILE       white-point percentile for stretch    99.0
  ENABLE_CALIBRATION             apply gamma/contrast at all           true

  PAGE_SIZE                      sheet/film size                        A4
           A5 | A4 | A3 | A3PLUS (Super A3 / A3 Wide / 13x19in glossy PET
           film), plus the radiology film sizes 8X10, 8_5X11, 10X12, 10X14,
           11X14, 11X17, 14X14, 14X17, 24CMX24CM and 24CMX30CM. DICOM Film
           Size ID spellings (14INX17IN, 8INX10IN, ...) and "A3+" are accepted.
  HONOR_SCU_FILM_SIZE            let the Film Box pick the size         false
           Off by default: a department that stocks one film size wants every
           sheet on that stock whatever the modality asks for. Turn it on to
           obey the Film Box's Film Size ID when it names a size we know.
  CUPS_MEDIA                     lp -o media= value              (from PAGE_SIZE)
           Needed for sizes whose CUPS name is driver-specific - A3+ above all,
           which PPDs variously call SuperA3, A3.Wide, Super_A3_B or 13x19.
           Check `lpoptions -p <queue> -l` and set it to what the driver lists.
  SHOW_IMAGE_LABELS              caption each frame                     true
           Series description and image number under each image, when the
           modality sends them.
  IMAGE_LABEL_HEIGHT_MM          height of that caption strip           4.5
  PAGE_ORIENTATION               AUTO | SCU | PORTRAIT | LANDSCAPE      AUTO
           AUTO turns the sheet whichever way prints the images largest: a
           3-column grid of 4:3 frames on an upright A4 gets cells twice as
           tall as they are wide, so each frame prints at about half the size
           it would landscape. SCU echoes the Film Box's Film Orientation
           (the previous AUTO behaviour); PORTRAIT/LANDSCAPE pin the sheet.
  DPI                            render resolution                     300
  MARGIN_MM                      outer page margin                     5.0
  GUTTER_MM                      spacing between tiles                  2.0
  LAYOUT_ROWS / LAYOUT_COLS      max images per page grid               2 / 3
  LAYOUT_<MODALITY>              per-modality grid, e.g. LAYOUT_USG=2x3 (none)
           ROWSxCOLS, overriding LAYOUT_ROWS/LAYOUT_COLS when the images carry
           a matching Modality. DICOM defined terms are mapped onto the names,
           so US->LAYOUT_USG, MR->LAYOUT_MRI and CR/DX/XA/RF->LAYOUT_XR.
  SHOW_PATIENT_BANNER            print the patient ID line on the film  true
  PATIENT_BANNER_HEIGHT_MM       height of that line                    6.0
  STRETCH_TO_FIT                 distort images to fill their cell     false
  AUTO_FIT_LAYOUT                shrink the grid to fit a partial batch true
  BACKGROUND_COLOR               WHITE | BLACK                          WHITE

  BATCH_GROUP_BY                 auto | session                         auto
  BATCH_IDLE_TIMEOUT_SECONDS     print a partial batch after this long  60

  HEADER_LINE1 / HEADER_LINE2    clinic letterhead text (top band)      (empty = no header)
  HEADER_LOGO_PATH               path to a logo image for the header    (none)
  HEADER_ALIGN                   LEFT | CENTER | RIGHT                  CENTER
  HEADER_HEIGHT_MM               header band height                    14.0
  FOOTER_LINE1 / FOOTER_LINE2    clinic address/footer text (bottom)    (empty = no footer)
  FOOTER_LOGO_PATH               path to a logo image for the footer    (none)
  FOOTER_ALIGN                   LEFT | CENTER | RIGHT                  CENTER
  FOOTER_HEIGHT_MM               footer band height                    10.0
  BANNER_BACKGROUND_COLOR        BLACK | WHITE (header/footer band)     BLACK

  ERP_BRANDING_URL               pull the letterhead from the ERP       (none)
           e.g. http://192.168.1.137:3000/api/clinic-settings/branding - the
           ERP's public clinic-settings endpoint. Set it and the clinic name,
           tagline, address, phone, email and logo all come from the ERP's
           settings page, so films and ERP-initiated prints share one source
           and nobody has to re-type any of it here. The HEADER_*/FOOTER_*
           values below stay as the fallback for whatever the ERP leaves
           blank, and for whenever it is unreachable.
  ERP_BRANDING_REFRESH_SECONDS   how often to re-read it                 300
  ERP_BRANDING_TIMEOUT_SECONDS   per-request timeout                       5

  auto:    a single-image print (e.g. a GE "P1" button per frame) is held
           and combined with the next ones from the same patient (if the
           modality tags Patient ID/Name) or the same calling AE Title
           within BATCH_IDLE_TIMEOUT_SECONDS of each other, until the page
           grid is full (prints immediately) or the timeout elapses
           (prints whatever arrived, reflowed to fit if AUTO_FIT_LAYOUT).
  session: legacy behaviour - each Film Box prints on its own the moment
           it receives its N-ACTION, exactly as sent (no cross-session
           combining). Use this for a modality that already sends every
           image for a full page within a single Film Box/Film Session.

  OUTPUT_DIR                     rendered-page + audit trail folder    /data/print-jobs
  OUTPUT_FORMAT                  pdf | png                              pdf
  JOB_RETENTION_DAYS             delete old files after N days (0=off) 30

  PRINT_METHOD                   cups | jetdirect                       cups
  CUPS_SERVER                    host:port of the CUPS daemon           localhost:631
  CUPS_PRINTER_NAME              CUPS queue name to print to            (none)
  JETDIRECT_HOST / JETDIRECT_PORT raw socket target                    (none) / 9100

  SESSION_TTL_MINUTES             GC sessions idle longer than this     120
  LOG_LEVEL                       DEBUG | INFO | WARNING | ERROR        INFO

  HTTP_PORT                       print-from-app HTTP API listen port   8090
  HTTP_BRIDGE_SECRET              bearer secret required to use it      (none - API refuses all requests until set)
  HTTP_MAX_BODY_BYTES             request body size cap                 60000000
  HTTP_MAX_IMAGES_PER_JOB         image count cap per request            200

  In addition to the DICOM Print SCP, this process runs a small HTTP API so a
  hospital/ERP web app can print directly (no modality involved):

    GET  /api/v1/health          -> {"printerStatus": ..., "printerInfo": ...}
    POST /api/v1/print-jobs      -> body: {
                                       "images": ["data:image/jpeg;base64,..." | "<base64>", ...],
                                       "copies": 1,
                                       "orientation": "PORTRAIT" | "LANDSCAPE",
                                       "layout": {"rows": 2, "cols": 3},        # optional
                                       "header": {"line1": "...", "line2": "...",
                                                  "logo": "data:image/png;base64,...",
                                                  "align": "CENTER"},          # optional
                                       "footer": {...},                        # optional
                                       "patient": {"name": "...", "id": "...",
                                                   "studyDate": "20260725",
                                                   "modality": "US"},          # optional
                                       "labels": ["PLAX  #1", "PSAX  #2", ...],# optional
                                       "pageSize": "A3PLUS"                    # optional
                                     }
                                  "labels" captions the frames in order (shown only
                                  when SHOW_IMAGE_LABELS is on); "pageSize" overrides
                                  PAGE_SIZE for this job.
                                  "patient" prints the same identification line a
                                  DICOM film gets. Send it only when every image in
                                  the request belongs to that one patient - the
                                  bridge prints what it is given and cannot tell.
                                  Requires "Authorization: Bearer <HTTP_BRIDGE_SECRET>".
                                  Images beyond one page's worth (rows*cols) spill onto
                                  additional pages instead of being dropped - unlike a
                                  DICOM Film Box, an explicit print request has no
                                  "die out past the grid" ambiguity to resolve.
                                  Responds 202 immediately with {"jobKey": ...}; rendering/
                                  printing happens in the background exactly like a DICOM
                                  print job - poll the endpoint below for the outcome.
    GET  /api/v1/print-jobs/{jobKey} -> {"status": "queued" | "processing" |
                                       "completed" | "failed", "pages": N, "images": N,
                                       "error": "..." | null, "createdAt": ..., "updatedAt": ...}
                                  Requires the same bearer token as POST above. 404 if
                                  jobKey is unknown (never issued, or its record has aged
                                  out - job records are kept for about an hour).
"""

from __future__ import annotations

import config_store as _config_store
_config_store.overlay_env_from_persisted()

import base64
import binascii
import hmac
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
import urllib.request
from urllib.parse import unquote

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from pynetdicom import AE, evt
from pynetdicom.sop_class import (
    BasicColorImageBox,
    BasicColorPrintManagementMeta,
    BasicFilmBox,
    BasicFilmSession,
    BasicGrayscaleImageBox,
    BasicGrayscalePrintManagementMeta,
    PrintJob,
    Printer,
    PrinterConfigurationRetrieval,
    PrinterInstance,
    Verification,
)

import admin_routes
import identity_audit
import image_profiles
import job_store
from job_store import ElectronicFilmJob

# =============================================================================
# Configuration
# =============================================================================

def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    try:
        return int(value)
    except ValueError:
        logging.getLogger("dicom-print-scp").warning(
            "Invalid integer for %s=%r, using default %s", name, value, default
        )
        return default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except ValueError:
        logging.getLogger("dicom-print-scp").warning(
            "Invalid number for %s=%r, using default %s", name, value, default
        )
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


AE_TITLE = _env_str("DICOM_AET", "PRINTSCP").strip()[:16] or "PRINTSCP"
DICOM_PORT = _env_int("DICOM_PORT", 104)
ALLOWED_CALLING_AETS = [
    a.strip()[:16] for a in _env_str("ALLOWED_CALLING_AETS", "").split(",") if a.strip()
]

GAMMA = max(0.01, _env_float("GAMMA", 2.0))
CONTRAST_LOW_PCT = min(max(_env_float("CONTRAST_LOW_PERCENTILE", 1.0), 0.0), 49.0)
CONTRAST_HIGH_PCT = min(max(_env_float("CONTRAST_HIGH_PERCENTILE", 99.0), 51.0), 100.0)
ENABLE_CALIBRATION = _env_bool("ENABLE_CALIBRATION", True)
CAPTURE_MODE = _env_str("CAPTURE_MODE", "CAPTURE_AND_PRINT").strip().upper()
if CAPTURE_MODE not in ("CAPTURE_ONLY", "CAPTURE_AND_PRINT", "PRINT_ONLY"):
    CAPTURE_MODE = "CAPTURE_AND_PRINT"
BRIGHTNESS = _env_float("BRIGHTNESS", 0.0)
CONTRAST = max(0.1, _env_float("CONTRAST", 1.0))
SHARPNESS = max(0.0, _env_float("SHARPNESS", 0.0))
INVERT_POLARITY = _env_bool("INVERT_POLARITY", False)
HONOR_SCU_LAYOUT = _env_bool("HONOR_SCU_LAYOUT", True)
PRESERVE_CONSOLE_LAYOUT = _env_bool("PRESERVE_CONSOLE_LAYOUT", True)
BRANDING_SOURCE = _env_str("BRANDING_SOURCE", "LOCAL").strip().upper()

PAGE_SIZE = _env_str("PAGE_SIZE", "A4").strip().upper()
# Validated against _PAGE_SIZES_MM once that table is defined, below.
HONOR_SCU_FILM_SIZE = _env_bool("HONOR_SCU_FILM_SIZE", False)
# AUTO turns the sheet whichever way prints the images largest (see
# choose_orientation); SCU keeps the old behaviour of echoing the Film Box's
# Film Orientation. PORTRAIT/LANDSCAPE pin it.
PAGE_ORIENTATION = _env_str("PAGE_ORIENTATION", "AUTO").strip().upper()
if PAGE_ORIENTATION not in ("AUTO", "SCU", "PORTRAIT", "LANDSCAPE"):
    PAGE_ORIENTATION = "AUTO"
DPI = max(72, _env_int("DPI", 300))
MARGIN_MM = max(0.0, _env_float("MARGIN_MM", 5.0))
GUTTER_MM = max(0.0, _env_float("GUTTER_MM", 2.0))

LAYOUT_ROWS = max(1, _env_int("LAYOUT_ROWS", 2))
LAYOUT_COLS = max(1, _env_int("LAYOUT_COLS", 3))
STRETCH_TO_FIT = _env_bool("STRETCH_TO_FIT", False)
AUTO_FIT_LAYOUT = _env_bool("AUTO_FIT_LAYOUT", True)
BACKGROUND_COLOR = _env_str("BACKGROUND_COLOR", "WHITE").strip().upper()

BATCH_GROUP_BY = _env_str("BATCH_GROUP_BY", "auto").strip().lower()
if BATCH_GROUP_BY not in ("auto", "session"):
    BATCH_GROUP_BY = "auto"
BATCH_IDLE_TIMEOUT_SECONDS = max(5, _env_int("BATCH_IDLE_TIMEOUT_SECONDS", 60))

def _env_align(name: str, default: str = "CENTER") -> str:
    value = _env_str(name, default).strip().upper()
    return value if value in ("LEFT", "CENTER", "RIGHT") else default


HEADER_LINE1 = _env_str("HEADER_LINE1", "").strip()
HEADER_LINE2 = _env_str("HEADER_LINE2", "").strip()
HEADER_LOGO_PATH = _env_str("HEADER_LOGO_PATH", "").strip()
HEADER_ALIGN = _env_align("HEADER_ALIGN")
HEADER_HEIGHT_MM = max(0.0, _env_float("HEADER_HEIGHT_MM", 14.0))

FOOTER_LINE1 = _env_str("FOOTER_LINE1", "").strip()
FOOTER_LINE2 = _env_str("FOOTER_LINE2", "").strip()
FOOTER_LOGO_PATH = _env_str("FOOTER_LOGO_PATH", "").strip()
FOOTER_ALIGN = _env_align("FOOTER_ALIGN")
FOOTER_HEIGHT_MM = max(0.0, _env_float("FOOTER_HEIGHT_MM", 10.0))

BANNER_BACKGROUND_COLOR = _env_str("BANNER_BACKGROUND_COLOR", "BLACK").strip().upper()

# Pull the clinic letterhead from the ERP instead of duplicating it here.
# The ERP's clinic settings page is where someone actually maintains the
# clinic's name, address and logo; without this they have to be re-typed into
# this container's env as well, and the two drift apart the first time
# anything changes. Empty = disabled, and the HEADER_*/FOOTER_* values below
# are used exactly as before.
ERP_BRANDING_URL = _env_str("ERP_BRANDING_URL", "").strip()
ERP_BRANDING_REFRESH_SECONDS = max(30, _env_int("ERP_BRANDING_REFRESH_SECONDS", 300))
ERP_BRANDING_TIMEOUT_SECONDS = max(1, _env_int("ERP_BRANDING_TIMEOUT_SECONDS", 5))

SHOW_PATIENT_BANNER = _env_bool("SHOW_PATIENT_BANNER", True)
PATIENT_BANNER_HEIGHT_MM = max(0.0, _env_float("PATIENT_BANNER_HEIGHT_MM", 6.0))

# Per-frame caption (series description / image number) under each tile.
SHOW_IMAGE_LABELS = _env_bool("SHOW_IMAGE_LABELS", True)
IMAGE_LABEL_HEIGHT_MM = max(0.0, _env_float("IMAGE_LABEL_HEIGHT_MM", 4.5))

# Per-modality page grids, e.g. LAYOUT_USG=2x3 (ROWSxCOLS, matching
# LAYOUT_ROWS/LAYOUT_COLS). Anything not listed falls back to
# LAYOUT_ROWS/LAYOUT_COLS.
MODALITY_ALIASES = {
    "US": "USG", "USG": "USG", "IVUS": "USG",
    "ECHO": "ECHO", "EC": "ECHO",
    "CT": "CT",
    "MR": "MRI", "MRI": "MRI",
    "CR": "XR", "DX": "XR", "XR": "XR", "RG": "XR", "RF": "XR", "XA": "XR",
}


def _parse_modality_layouts() -> dict:
    """Read LAYOUT_<NAME>=ROWSxCOLS variables into {NAME: (rows, cols)}."""
    layouts = {}
    for key, value in os.environ.items():
        if not key.startswith("LAYOUT_"):
            continue
        name = key[len("LAYOUT_"):].upper()
        if name in ("ROWS", "COLS"):  # the existing global settings
            continue
        match = re.match(r"^\s*(\d+)\s*[xX*]\s*(\d+)\s*$", str(value))
        if not match:
            logging.getLogger("dicom-print-scp").warning(
                "Ignoring %s=%r - expected a ROWSxCOLS value such as 2x3", key, value
            )
            continue
        rows, cols = int(match.group(1)), int(match.group(2))
        if rows >= 1 and cols >= 1:
            layouts[name] = (rows, cols)
    return layouts


MODALITY_LAYOUTS = _parse_modality_layouts()

OUTPUT_DIR = Path(_env_str("OUTPUT_DIR", "/data/print-jobs"))
OUTPUT_FORMAT = _env_str("OUTPUT_FORMAT", "pdf").strip().lower()
if OUTPUT_FORMAT not in ("pdf", "png"):
    OUTPUT_FORMAT = "pdf"
JOB_RETENTION_DAYS = _env_int("JOB_RETENTION_DAYS", 30)

PRINT_METHOD = _env_str("PRINT_METHOD", "cups").strip().lower()
CUPS_SERVER = _env_str("CUPS_SERVER", "localhost:631").strip()
CUPS_PRINTER_NAME = _env_str("CUPS_PRINTER_NAME", "").strip()
# CUPS media name passed as `lp -o media=...`. Left empty it is derived from
# PAGE_SIZE, which is right for the standard A-series names. Sizes whose CUPS
# name is driver-specific - A3+ above all, which PPDs variously call SuperA3,
# A3.Wide, Super_A3_B or 13x19 - need this set explicitly to whatever
# `lpoptions -p <queue> -l` reports.
CUPS_MEDIA = _env_str("CUPS_MEDIA", "").strip()
JETDIRECT_HOST = _env_str("JETDIRECT_HOST", "").strip()
JETDIRECT_PORT = _env_int("JETDIRECT_PORT", 9100)

SESSION_TTL_MINUTES = max(5, _env_int("SESSION_TTL_MINUTES", 120))
LOG_LEVEL = _env_str("LOG_LEVEL", "INFO").strip().upper()

HTTP_PORT = max(1, _env_int("HTTP_PORT", 8090))
HTTP_BRIDGE_SECRET = _env_str("HTTP_BRIDGE_SECRET", "").strip()
HTTP_MAX_BODY_BYTES = max(1_000_000, _env_int("HTTP_MAX_BODY_BYTES", 60_000_000))
HTTP_MAX_IMAGES_PER_JOB = max(1, _env_int("HTTP_MAX_IMAGES_PER_JOB", 200))
HTTP_MAX_COPIES_PER_JOB = 20  # sanity ceiling; not user-configurable - nobody legitimately prints more per job

MAX_IMAGES_PER_PAGE = LAYOUT_ROWS * LAYOUT_COLS
ABSOLUTE_MAX_IMAGE_BOXES = 400  # hard safety ceiling against a runaway ImageDisplayFormat request

_PAGE_SIZES_MM = {
    # Metric sheet stock
    "A5":     (148.0, 210.0),
    "A4":     (210.0, 297.0),
    "A3":     (297.0, 420.0),
    "A3PLUS": (329.0, 483.0),   # Super A3 / A3 Wide / 13x19in — glossy PET film
    # Imperial radiology film sizes
    "8X10":   (203.2, 254.0),
    "8_5X11": (215.9, 279.4),   # US Letter
    "10X12":  (254.0, 304.8),
    "10X14":  (254.0, 355.6),
    "11X14":  (279.4, 355.6),
    "11X17":  (279.4, 431.8),
    "14X14":  (355.6, 355.6),
    "14X17":  (355.6, 431.8),
    # Metric radiology film sizes
    "24CMX24CM": (240.0, 240.0),
    "24CMX30CM": (240.0, 300.0),
}

# DICOM Film Size ID (2010,0050) defined terms, plus the spellings people
# actually type into an env var, mapped onto _PAGE_SIZES_MM keys.
_PAGE_SIZE_ALIASES = {
    "8INX10IN": "8X10",
    "8_5INX11IN": "8_5X11", "85X11": "8_5X11", "LETTER": "8_5X11",
    "10INX12IN": "10X12",
    "10INX14IN": "10X14",
    "11INX14IN": "11X14",
    "11INX17IN": "11X17",
    "14INX14IN": "14X14",
    "14INX17IN": "14X17",
    "SUPERA3": "A3PLUS", "A3WIDE": "A3PLUS", "13X19": "A3PLUS",
    "13INX19IN": "A3PLUS", "SUPER_A3": "A3PLUS", "A3B": "A3PLUS",
}


def normalize_page_size(value, fallback: str = "") -> str:
    """Resolve a page size name (env value or DICOM Film Size ID) to a key.

    Returns "" when nothing recognisable was given, so callers can decide
    whether that means "use the configured default" or "use A4".
    """
    text = str(value or "").strip().upper()
    if not text:
        return fallback
    # "A3+" must not collapse to "A3" when the punctuation is stripped.
    text = text.replace("+", "PLUS")
    text = re.sub(r"[^A-Z0-9_]", "", text)
    if text in _PAGE_SIZES_MM:
        return text
    if text in _PAGE_SIZE_ALIASES:
        return _PAGE_SIZE_ALIASES[text]
    # 24CMX30CM-style terms survive the strip; anything else is unknown.
    stripped = text.replace("_", "")
    for key in _PAGE_SIZES_MM:
        if key.replace("_", "") == stripped:
            return key
    if stripped in {k.replace("_", "") for k in _PAGE_SIZE_ALIASES}:
        for alias, target in _PAGE_SIZE_ALIASES.items():
            if alias.replace("_", "") == stripped:
                return target
    return fallback


# PAGE_SIZE is read before the table above exists, so it is validated here.
_configured_page_size = normalize_page_size(PAGE_SIZE)
if not _configured_page_size:
    logging.getLogger("dicom-print-scp").warning(
        "Unknown PAGE_SIZE=%r; falling back to A4. Known sizes: %s",
        PAGE_SIZE, ", ".join(sorted(_PAGE_SIZES_MM)),
    )
    _configured_page_size = "A4"
PAGE_SIZE = _configured_page_size


def cups_media_for(page_size: str) -> str:
    """The `lp -o media=` value for a page size.

    CUPS_MEDIA wins when set, because the name for anything outside the
    A-series is decided by the printer's PPD rather than by us.
    """
    if CUPS_MEDIA:
        return CUPS_MEDIA
    return {
        "A5": "A5", "A4": "A4", "A3": "A3",
        "A3PLUS": "SuperA3",
        "8X10": "8x10", "8_5X11": "Letter", "10X12": "10x12",
        "10X14": "10x14", "11X14": "11x14", "11X17": "11x17",
        "14X14": "14x14", "14X17": "14x17",
        "24CMX24CM": "A4", "24CMX30CM": "A4",
    }.get(page_size, page_size)


# =============================================================================
# Logging
# =============================================================================

logging.basicConfig(
    stream=sys.stdout,
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("dicom-print-scp")

# Runtime diagnostics / admin dashboard context (PHI-safe)
RECENT_ASSOCIATIONS: list[dict] = []
RECENT_ERRORS: list[str] = []
LAST_ASSOCIATION: Optional[dict] = None
LAST_SUCCESSFUL_CAPTURE: Optional[dict] = None
LAST_PHYSICAL_PRINT: Optional[dict] = None
LAST_ERROR: Optional[str] = None
ERP_LAST_SYNC: str = ""
BRIDGE_STATUS = "RUNNING"
IDENTITY_AUDIT_BUFFER: list[dict] = []


def reload_live_config() -> None:
    """Reload live-apply settings from config_store into module globals."""
    global GAMMA, CONTRAST_LOW_PCT, CONTRAST_HIGH_PCT, ENABLE_CALIBRATION
    global CAPTURE_MODE, BRIGHTNESS, CONTRAST, SHARPNESS, INVERT_POLARITY
    global PAGE_SIZE, PAGE_ORIENTATION, HONOR_SCU_FILM_SIZE, HONOR_SCU_LAYOUT, PRESERVE_CONSOLE_LAYOUT
    global DPI, MARGIN_MM, GUTTER_MM, LAYOUT_ROWS, LAYOUT_COLS, STRETCH_TO_FIT, AUTO_FIT_LAYOUT
    global BACKGROUND_COLOR, BATCH_GROUP_BY, BATCH_IDLE_TIMEOUT_SECONDS, BRANDING_SOURCE
    global HEADER_LINE1, HEADER_LINE2, HEADER_LOGO_PATH, HEADER_ALIGN, HEADER_HEIGHT_MM
    global FOOTER_LINE1, FOOTER_LINE2, FOOTER_LOGO_PATH, FOOTER_ALIGN, FOOTER_HEIGHT_MM
    global BANNER_BACKGROUND_COLOR, SHOW_PATIENT_BANNER, PATIENT_BANNER_HEIGHT_MM
    global SHOW_IMAGE_LABELS, IMAGE_LABEL_HEIGHT_MM, ERP_BRANDING_URL
    global ERP_BRANDING_REFRESH_SECONDS, ERP_BRANDING_TIMEOUT_SECONDS
    global OUTPUT_DIR, OUTPUT_FORMAT, JOB_RETENTION_DAYS, PRINT_METHOD, CUPS_SERVER
    global CUPS_PRINTER_NAME, CUPS_MEDIA, JETDIRECT_HOST, JETDIRECT_PORT, HTTP_BRIDGE_SECRET
    global MAX_IMAGES_PER_PAGE, MODALITY_LAYOUTS

    GAMMA = max(0.01, float(_config_store.get("GAMMA")))
    CONTRAST_LOW_PCT = min(max(float(_config_store.get("CONTRAST_LOW_PERCENTILE")), 0.0), 49.0)
    CONTRAST_HIGH_PCT = min(max(float(_config_store.get("CONTRAST_HIGH_PERCENTILE")), 51.0), 100.0)
    ENABLE_CALIBRATION = bool(_config_store.get("ENABLE_CALIBRATION"))
    CAPTURE_MODE = str(_config_store.get("CAPTURE_MODE")).upper()
    BRIGHTNESS = float(_config_store.get("BRIGHTNESS"))
    CONTRAST = max(0.1, float(_config_store.get("CONTRAST")))
    SHARPNESS = max(0.0, float(_config_store.get("SHARPNESS")))
    INVERT_POLARITY = bool(_config_store.get("INVERT_POLARITY"))
    PAGE_SIZE = normalize_page_size(str(_config_store.get("PAGE_SIZE")), "A4")
    PAGE_ORIENTATION = str(_config_store.get("PAGE_ORIENTATION")).upper()
    HONOR_SCU_FILM_SIZE = bool(_config_store.get("HONOR_SCU_FILM_SIZE"))
    HONOR_SCU_LAYOUT = bool(_config_store.get("HONOR_SCU_LAYOUT"))
    PRESERVE_CONSOLE_LAYOUT = bool(_config_store.get("PRESERVE_CONSOLE_LAYOUT"))
    DPI = max(72, int(_config_store.get("DPI")))
    MARGIN_MM = max(0.0, float(_config_store.get("MARGIN_MM")))
    GUTTER_MM = max(0.0, float(_config_store.get("GUTTER_MM")))
    LAYOUT_ROWS = max(1, int(_config_store.get("LAYOUT_ROWS")))
    LAYOUT_COLS = max(1, int(_config_store.get("LAYOUT_COLS")))
    STRETCH_TO_FIT = bool(_config_store.get("STRETCH_TO_FIT"))
    AUTO_FIT_LAYOUT = bool(_config_store.get("AUTO_FIT_LAYOUT"))
    BACKGROUND_COLOR = str(_config_store.get("BACKGROUND_COLOR")).upper()
    BATCH_GROUP_BY = str(_config_store.get("BATCH_GROUP_BY")).lower()
    BATCH_IDLE_TIMEOUT_SECONDS = max(5, int(_config_store.get("BATCH_IDLE_TIMEOUT_SECONDS")))
    BRANDING_SOURCE = str(_config_store.get("BRANDING_SOURCE")).upper()
    HEADER_LINE1 = str(_config_store.get("HEADER_LINE1") or "").strip()
    HEADER_LINE2 = str(_config_store.get("HEADER_LINE2") or "").strip()
    HEADER_LOGO_PATH = str(_config_store.get("HEADER_LOGO_PATH") or "").strip()
    HEADER_ALIGN = str(_config_store.get("HEADER_ALIGN")).upper()
    HEADER_HEIGHT_MM = max(0.0, float(_config_store.get("HEADER_HEIGHT_MM")))
    FOOTER_LINE1 = str(_config_store.get("FOOTER_LINE1") or "").strip()
    FOOTER_LINE2 = str(_config_store.get("FOOTER_LINE2") or "").strip()
    FOOTER_LOGO_PATH = str(_config_store.get("FOOTER_LOGO_PATH") or "").strip()
    FOOTER_ALIGN = str(_config_store.get("FOOTER_ALIGN")).upper()
    FOOTER_HEIGHT_MM = max(0.0, float(_config_store.get("FOOTER_HEIGHT_MM")))
    BANNER_BACKGROUND_COLOR = str(_config_store.get("BANNER_BACKGROUND_COLOR")).upper()
    SHOW_PATIENT_BANNER = bool(_config_store.get("SHOW_PATIENT_BANNER"))
    PATIENT_BANNER_HEIGHT_MM = max(0.0, float(_config_store.get("PATIENT_BANNER_HEIGHT_MM")))
    SHOW_IMAGE_LABELS = bool(_config_store.get("SHOW_IMAGE_LABELS"))
    IMAGE_LABEL_HEIGHT_MM = max(0.0, float(_config_store.get("IMAGE_LABEL_HEIGHT_MM")))
    ERP_BRANDING_URL = str(_config_store.get("ERP_BRANDING_URL") or "").strip()
    ERP_BRANDING_REFRESH_SECONDS = max(30, int(_config_store.get("ERP_BRANDING_REFRESH_SECONDS")))
    ERP_BRANDING_TIMEOUT_SECONDS = max(1, int(_config_store.get("ERP_BRANDING_TIMEOUT_SECONDS")))
    OUTPUT_DIR = Path(str(_config_store.get("OUTPUT_DIR")))
    OUTPUT_FORMAT = str(_config_store.get("OUTPUT_FORMAT")).lower()
    JOB_RETENTION_DAYS = int(_config_store.get("JOB_RETENTION_DAYS"))
    PRINT_METHOD = str(_config_store.get("PRINT_METHOD")).lower()
    CUPS_SERVER = str(_config_store.get("CUPS_SERVER"))
    CUPS_PRINTER_NAME = str(_config_store.get("CUPS_PRINTER_NAME") or "").strip()
    CUPS_MEDIA = str(_config_store.get("CUPS_MEDIA") or "").strip()
    JETDIRECT_HOST = str(_config_store.get("JETDIRECT_HOST") or "").strip()
    JETDIRECT_PORT = int(_config_store.get("JETDIRECT_PORT"))
    HTTP_BRIDGE_SECRET = str(_config_store.get("HTTP_BRIDGE_SECRET") or "").strip()
    MODALITY_LAYOUTS = _parse_modality_layouts()
    MAX_IMAGES_PER_PAGE = LAYOUT_ROWS * LAYOUT_COLS


def _record_error(message: str) -> None:
    global LAST_ERROR
    LAST_ERROR = message[:500]
    RECENT_ERRORS.append(f"{datetime.now().isoformat()} {message[:200]}")
    if len(RECENT_ERRORS) > 50:
        RECENT_ERRORS.pop(0)
    _sync_bridge_runtime()


# =============================================================================
# Data model
# =============================================================================

@dataclass
class PatientInfo:
    """Best-effort patient identification for the film's ID line.

    Print SCUs are not required to send patient tags at all, so every field
    is optional and the label degrades to whatever is actually present.
    """
    name: str = ""
    patient_id: str = ""
    study_date: str = ""
    modality: str = ""

    def merged_with(self, other: "PatientInfo") -> "PatientInfo":
        """`other`'s non-empty fields win; used to enrich as tags arrive."""
        return PatientInfo(
            name=other.name or self.name,
            patient_id=other.patient_id or self.patient_id,
            study_date=other.study_date or self.study_date,
            modality=other.modality or self.modality,
        )

    def label(self) -> str:
        parts = []
        if self.name:
            parts.append(self.name.replace("^", " ").strip())
        if self.patient_id:
            parts.append(f"ID: {self.patient_id}")
        if self.study_date:
            parts.append(_format_dicom_date(self.study_date))
        if self.modality:
            parts.append(self.modality)
        return "   |   ".join(p for p in parts if p)


def _format_dicom_date(value: str) -> str:
    """YYYYMMDD -> DD/MM/YYYY; anything else is passed through unchanged."""
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[6:8]}/{text[4:6]}/{text[0:4]}"
    return text


@dataclass
class ImageBoxRecord:
    sop_instance_uid: str
    film_box_uid: str
    position: int
    is_color: bool = False
    array: Optional[np.ndarray] = None
    set_at: Optional[datetime] = None
    patient: Optional[PatientInfo] = None
    label: str = ""


@dataclass
class FilmBoxRecord:
    sop_instance_uid: str
    film_session_uid: str
    rows: int
    cols: int
    orientation: str
    film_size_id: str
    created_at: datetime
    image_box_uids: list = field(default_factory=list)
    patient_key: Optional[str] = None


@dataclass
class FilmSessionRecord:
    sop_instance_uid: str
    number_of_copies: int
    label: str
    created_at: datetime
    calling_ae: str = ""
    patient_key: Optional[str] = None
    film_box_uids: list = field(default_factory=list)


@dataclass
class BatchImage:
    array: np.ndarray
    is_color: bool
    label: str = ""


@dataclass
class PrintBatchRecord:
    """One page's worth of images, possibly accumulated across several
    separate Film Sessions/associations (e.g. a GE "P1" press per image).
    """
    batch_key: str
    ae_title: str
    patient_key: Optional[str]
    is_color: bool
    copies: int
    orientation_hint: str
    last_activity: datetime
    images: list = field(default_factory=list)  # list[BatchImage]
    patient: PatientInfo = field(default_factory=PatientInfo)
    max_rows: int = 0  # 0 = fall back to LAYOUT_ROWS/LAYOUT_COLS
    max_cols: int = 0
    page_size: str = ""  # "" = fall back to PAGE_SIZE

    @property
    def capacity(self) -> int:
        rows = self.max_rows or LAYOUT_ROWS
        cols = self.max_cols or LAYOUT_COLS
        return rows * cols


# All access to the registries below must hold _STATE_LOCK. It's an RLock so
# the N-DELETE cascade (session -> its film boxes -> their image boxes) can
# re-enter it from a helper already called with the lock held.
_STATE_LOCK = threading.RLock()
FILM_SESSIONS: dict[str, FilmSessionRecord] = {}
FILM_BOXES: dict[str, FilmBoxRecord] = {}
IMAGE_BOXES: dict[str, ImageBoxRecord] = {}
BATCHES: dict[str, PrintBatchRecord] = {}

# Rendering + printing happens off the DIMSE thread: a Print SCP is allowed
# (and expected, per the DICOM Print Management workflow) to complete the
# actual print job after the N-ACTION response and even after the
# association has been released.
_PRINT_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="print-job")


@dataclass
class PrintJobStatusRecord:
    """Tracks one process_print_job() call's outcome so a caller can poll
    GET /api/v1/print-jobs/{jobKey} instead of the fire-and-forget 202
    response being the last word on whether a job actually printed.

    Populated uniformly for BOTH print paths (DICOM batches and HTTP
    print-jobs requests), since process_print_job is their shared entry
    point - only the HTTP path currently hands its job_key back to a caller
    that can poll it, but there's no reason to track the two paths
    differently.
    """
    job_key: str
    status: str  # "queued" | "processing" | "completed" | "failed"
    created_at: datetime
    updated_at: datetime
    pages: int = 0
    images: int = 0
    copies: int = 1
    error: Optional[str] = None


# Separate from _STATE_LOCK: job-status tracking is orthogonal to DICOM Film
# Session/Box/Image Box state.
_JOB_STATUS_LOCK = threading.Lock()
PRINT_JOB_STATUS: dict[str, PrintJobStatusRecord] = {}
JOB_STATUS_RETENTION_SECONDS = 3600  # expire finished job records after an hour


def _mark_job_queued(job_key: str, pages: int, images: int, copies: int) -> None:
    """Seeds a record BEFORE _PRINT_EXECUTOR.submit() so a poll arriving the
    instant after the HTTP handler's 202 response always finds something,
    even if both worker threads are still busy with earlier jobs."""
    now = datetime.now()
    with _JOB_STATUS_LOCK:
        PRINT_JOB_STATUS[job_key] = PrintJobStatusRecord(
            job_key=job_key, status="queued", created_at=now, updated_at=now,
            pages=pages, images=images, copies=copies,
        )


def _mark_job_processing(job_key: str, pages: int, images: int, copies: int) -> None:
    now = datetime.now()
    with _JOB_STATUS_LOCK:
        existing = PRINT_JOB_STATUS.get(job_key)
        created_at = existing.created_at if existing else now
        PRINT_JOB_STATUS[job_key] = PrintJobStatusRecord(
            job_key=job_key, status="processing", created_at=created_at, updated_at=now,
            pages=pages, images=images, copies=copies,
        )


def _mark_job_completed(job_key: str) -> None:
    with _JOB_STATUS_LOCK:
        record = PRINT_JOB_STATUS.get(job_key)
        if record is not None:
            record.status = "completed"
            record.updated_at = datetime.now()


def _mark_job_failed(job_key: str, error: str) -> None:
    now = datetime.now()
    with _JOB_STATUS_LOCK:
        record = PRINT_JOB_STATUS.get(job_key)
        if record is not None:
            record.status = "failed"
            record.error = error[:500]
            record.updated_at = now
        else:
            PRINT_JOB_STATUS[job_key] = PrintJobStatusRecord(
                job_key=job_key, status="failed", created_at=now, updated_at=now, error=error[:500],
            )


# =============================================================================
# Image calibration (contrast stretch + gamma)
# =============================================================================

def _percentile_bounds(values: np.ndarray, lo_pct: float, hi_pct: float) -> tuple[float, float]:
    lo, hi = np.percentile(values, [lo_pct, hi_pct])
    if hi <= lo:
        hi = float(values.max())
        lo = 0.0
    if hi <= lo:
        hi = lo + 1.0
    return float(lo), float(hi)


def calibrate_grayscale(arr: np.ndarray, gamma: float, lo_pct: float, hi_pct: float) -> np.ndarray:
    """Percentile contrast-stretch then gamma-brighten a single-channel frame."""
    arr_f = arr.astype(np.float32)
    lo, hi = _percentile_bounds(arr_f, lo_pct, hi_pct)
    stretched = np.clip((arr_f - lo) / (hi - lo), 0.0, 1.0)
    corrected = np.power(stretched, 1.0 / gamma)
    return np.clip(corrected * 255.0, 0, 255).astype(np.uint8)


def calibrate_color(arr: np.ndarray, gamma: float, lo_pct: float, hi_pct: float) -> np.ndarray:
    """Same as calibrate_grayscale, but the stretch bounds come from luminance
    and are applied identically to R/G/B so hue/white-balance isn't shifted.
    """
    arr_f = arr.astype(np.float32)
    luminance = cv2.cvtColor(np.clip(arr_f, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    lo, hi = _percentile_bounds(luminance, lo_pct, hi_pct)
    stretched = np.clip((arr_f - lo) / (hi - lo), 0.0, 1.0)
    corrected = np.power(stretched, 1.0 / gamma)
    return np.clip(corrected * 255.0, 0, 255).astype(np.uint8)


def normalize_bit_depth(arr: np.ndarray) -> np.ndarray:
    """Flatten any bit depth down to uint8 without touching contrast (used when calibration is disabled)."""
    if arr.dtype == np.uint8:
        return arr
    info = np.iinfo(arr.dtype)
    span = float(info.max) - float(info.min) or 1.0
    scaled = (arr.astype(np.float32) - info.min) / span
    return np.clip(scaled * 255.0, 0, 255).astype(np.uint8)


# =============================================================================
# DICOM pixel decoding
# =============================================================================

def _ybr_full_to_rgb(arr: np.ndarray) -> np.ndarray:
    # DICOM YBR_FULL stores samples as (Y, Cb, Cr); OpenCV's YCrCb2RGB expects
    # (Y, Cr, Cb), so the chroma channels are swapped before conversion.
    swapped = arr[..., [0, 2, 1]].astype(np.uint8)
    return cv2.cvtColor(swapped, cv2.COLOR_YCrCb2RGB)


def decode_image_box_pixels(item: Dataset) -> tuple[np.ndarray, bool]:
    """Decode an Image Box's Image Pixel Module into an (H, W) or (H, W, 3) array.

    Returns (array, is_color).
    """
    rows = int(item.Rows)
    cols = int(item.Columns)
    samples = int(getattr(item, "SamplesPerPixel", 1) or 1)
    bits_allocated = int(getattr(item, "BitsAllocated", 8) or 8)
    bits_stored = int(getattr(item, "BitsStored", bits_allocated) or bits_allocated)
    pixel_repr = int(getattr(item, "PixelRepresentation", 0) or 0)
    planar_config = int(getattr(item, "PlanarConfiguration", 0) or 0)
    photometric = str(getattr(item, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2").upper().strip()

    raw = getattr(item, "PixelData", None)
    if not raw:
        raise ValueError("Image Box has no Pixel Data")
    raw = bytes(raw)

    if photometric == "YBR_FULL_422":
        raise ValueError(
            "YBR_FULL_422 (chroma-subsampled) pixel data is not supported; "
            "configure the modality to send RGB or YBR_FULL instead"
        )

    if bits_allocated > 8:
        dtype = np.dtype(np.int16 if pixel_repr == 1 else np.uint16)
    else:
        dtype = np.dtype(np.int8 if pixel_repr == 1 else np.uint8)

    expected = rows * cols * samples
    # DICOM pads Pixel Data to an even length, so 16-bit data can arrive with a
    # trailing odd byte. np.frombuffer rejects any buffer that isn't a whole
    # number of samples, with a message that says nothing about DICOM - trim
    # the remainder so a genuinely short buffer reports as such below.
    remainder = len(raw) % dtype.itemsize
    if remainder:
        raw = raw[:-remainder]
    flat = np.frombuffer(raw, dtype=dtype)
    if flat.size < expected:
        raise ValueError(f"Pixel data too short: got {flat.size} samples, expected {expected}")
    flat = flat[:expected]

    if samples == 1:
        arr = flat.reshape(rows, cols)
        if photometric == "MONOCHROME1":
            max_val = (1 << bits_stored) - 1
            arr = (max_val - arr.astype(np.int32)).clip(0, max_val).astype(dtype)
        return arr, False

    if planar_config == 1:
        arr = flat.reshape(samples, rows, cols).transpose(1, 2, 0)
    else:
        arr = flat.reshape(rows, cols, samples)

    if photometric.startswith("YBR"):
        arr = _ybr_full_to_rgb(arr)
    elif photometric != "RGB":
        log.warning("Unrecognized PhotometricInterpretation %r for a color Image Box; treating as RGB", photometric)

    return arr, True


# =============================================================================
# Layout engine
# =============================================================================

def _mm_to_px(mm: float, dpi: int) -> int:
    return max(0, round(mm / 25.4 * dpi))


def _page_size_px(page_size: str, orientation: str, dpi: int) -> tuple[int, int]:
    width_mm, height_mm = _PAGE_SIZES_MM.get(page_size, _PAGE_SIZES_MM["A4"])
    if orientation == "LANDSCAPE":
        width_mm, height_mm = height_mm, width_mm
    return _mm_to_px(width_mm, dpi), _mm_to_px(height_mm, dpi)


def layout_for_modality(modality: str) -> tuple[int, int]:
    """(rows, cols) for a DICOM Modality, or the global LAYOUT_ROWS/COLS.

    The DICOM defined terms are mapped through MODALITY_ALIASES, so "US"
    picks up LAYOUT_USG, "MR" picks up LAYOUT_MRI and "CR"/"DX" pick up
    LAYOUT_XR.
    """
    key = (modality or "").strip().upper()
    if key:
        if key in MODALITY_LAYOUTS:
            return MODALITY_LAYOUTS[key]
        alias = MODALITY_ALIASES.get(key)
        if alias and alias in MODALITY_LAYOUTS:
            return MODALITY_LAYOUTS[alias]
    return LAYOUT_ROWS, LAYOUT_COLS


def _cell_fill_fraction(cell_aspect: float, image_aspect: float) -> float:
    """How much of a grid cell an image covers once fitted into it.

    Fitting preserves the aspect ratio, so whichever dimension runs out first
    caps the result and the covered fraction reduces to the smaller aspect
    over the larger - 1.0 when the cell matches the image exactly.
    """
    if cell_aspect <= 0 or image_aspect <= 0:
        return 0.0
    return min(cell_aspect, image_aspect) / max(cell_aspect, image_aspect)


def choose_orientation(
    images: list, max_rows: int, max_cols: int, banner_mm: float = 0.0,
    page_size: str = "",
) -> str:
    """Turn the sheet whichever way prints the images largest.

    A 3-column grid of 4:3 frames on an upright A4 leaves cells twice as tall
    as they are wide, so each frame prints at about half the size it would on
    a landscape sheet. Comparing the cell aspect against the images' own
    aspect picks the better sheet instead of always assuming portrait.
    """
    aspects = []
    for arr in images:
        if arr is None or getattr(arr, "ndim", 0) < 2:
            continue
        height, width = arr.shape[0], arr.shape[1]
        if height > 0 and width > 0:
            aspects.append(width / height)
    if not aspects:
        return "PORTRAIT"

    aspects.sort()  # median, so one odd frame can't swing the whole page
    mid = len(aspects) // 2
    image_aspect = (aspects[mid] if len(aspects) % 2
                    else (aspects[mid - 1] + aspects[mid]) / 2.0)

    width_mm, height_mm = _PAGE_SIZES_MM.get(
        normalize_page_size(page_size, PAGE_SIZE), _PAGE_SIZES_MM["A4"]
    )
    scores = {}
    for name, (page_w, page_h) in (
        ("PORTRAIT", (width_mm, height_mm)),
        ("LANDSCAPE", (height_mm, width_mm)),
    ):
        rows, cols = (
            _best_fit_grid(len(aspects), max_rows, max_cols)
            if AUTO_FIT_LAYOUT else (max_rows, max_cols)
        )
        usable_w = page_w - 2 * MARGIN_MM - (cols - 1) * GUTTER_MM
        usable_h = page_h - 2 * MARGIN_MM - banner_mm - (rows - 1) * GUTTER_MM
        if usable_w <= 0 or usable_h <= 0:
            scores[name] = 0.0
            continue
        cell_aspect = (usable_w / cols) / (usable_h / rows)
        scores[name] = _cell_fill_fraction(cell_aspect, image_aspect)

    # Ties go to portrait - the conventional default for a film sheet.
    best = "LANDSCAPE" if scores["LANDSCAPE"] > scores["PORTRAIT"] else "PORTRAIT"
    log.debug(
        "Auto orientation: %s (image aspect %.2f, portrait fill %.0f%%, landscape fill %.0f%%)",
        best, image_aspect, scores["PORTRAIT"] * 100, scores["LANDSCAPE"] * 100,
    )
    return best


def _page_orientation_for(hint: str) -> str:
    """Resolve PAGE_ORIENTATION for a page that carries no images to measure."""
    if PAGE_ORIENTATION in ("AUTO", "SCU"):
        return "LANDSCAPE" if str(hint).upper() == "LANDSCAPE" else "PORTRAIT"
    return PAGE_ORIENTATION


def _best_fit_grid(n: int, max_rows: int, max_cols: int) -> tuple[int, int]:
    """Smallest (rows, cols) within the configured max that holds n images.

    Tries shrinking rows (keeping the configured column count) and shrinking
    columns (keeping the configured row count), and keeps whichever wastes
    fewer cells - so a partial batch (e.g. 4 of a configured 2x3) fills the
    page instead of leaving a visibly empty row or column.
    """
    if n <= 0:
        return 1, 1
    if n >= max_rows * max_cols:
        return max_rows, max_cols

    cols_a = max_cols
    rows_a = min(max_rows, -(-n // cols_a))
    waste_a = rows_a * cols_a - n

    rows_b = max_rows
    cols_b = min(max_cols, -(-n // rows_b))
    waste_b = rows_b * cols_b - n

    if waste_b < waste_a:
        return rows_b, cols_b
    return rows_a, cols_a


def _fit_into_cell(arr: np.ndarray, cell_w: int, cell_h: int, stretch: bool) -> np.ndarray:
    h, w = arr.shape[:2]
    if stretch:
        new_w, new_h = cell_w, cell_h
    else:
        src_ratio = w / h
        cell_ratio = cell_w / cell_h
        if src_ratio > cell_ratio:
            new_w = cell_w
            new_h = max(1, round(cell_w / src_ratio))
        else:
            new_h = cell_h
            new_w = max(1, round(cell_h * src_ratio))
    shrinking = new_w < w or new_h < h
    interpolation = cv2.INTER_AREA if shrinking else cv2.INTER_CUBIC
    return cv2.resize(arr, (new_w, new_h), interpolation=interpolation)


_FONT_REGULAR_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
_FONT_BOLD_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _load_font(paths: list[str], size: int):
    key = (paths[0] if paths else "", size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    for path in paths:
        if Path(path).exists():
            try:
                font = ImageFont.truetype(path, size)
                _FONT_CACHE[key] = font
                return font
            except OSError:
                continue
    font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def _text_block_size(draw: ImageDraw.ImageDraw, lines_fonts: list[tuple[str, object]]) -> tuple[int, int]:
    width = 0
    height = 0
    for text, font in lines_fonts:
        bbox = draw.textbbox((0, 0), text, font=font)
        width = max(width, bbox[2] - bbox[0])
        height += bbox[3] - bbox[1]
    return width, height


# =============================================================================
# Clinic letterhead pulled from the ERP
# =============================================================================

# Last good response. Kept until a later fetch succeeds, so a page still
# carries the clinic's letterhead while the ERP is restarting or unreachable —
# a print must never fail, or come out blank, because a branding lookup did.
_ERP_BRANDING: dict = {}
_ERP_BRANDING_LOCK = threading.Lock()


def fetch_erp_branding(url: str, timeout: int) -> dict:
    """Read the clinic letterhead from the ERP's public branding endpoint.

    Returns {} on any failure — the caller keeps whatever it had.
    """
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("branding response was not a JSON object")
    return erp_branding_to_banners(payload)


def erp_branding_to_banners(payload: dict) -> dict:
    """Map the ERP's clinic settings onto this bridge's header/footer shape.

    Mirrors how the ERP itself builds the header/footer it sends with an HTTP
    print job, so a film and an ERP-initiated sheet carry the same letterhead.
    """
    def text(key: str) -> str:
        value = payload.get(key)
        return str(value).strip() if value not in (None, "") else ""

    logo = b""
    logo_value = payload.get("logoDataUrl")
    if logo_value:
        try:
            logo = _decode_data_url_or_b64(str(logo_value))
        except Exception as exc:
            log.warning("Ignoring unusable logo from the ERP branding endpoint: %s", exc)

    footer_line2 = "  |  ".join(p for p in (text("phone"), text("email")) if p)
    return {
        "header": {
            "line1": text("tagline"),
            "line2": text("name"),
            "logo": logo,
            "align": HEADER_ALIGN,
        },
        "footer": {
            "line1": text("address"),
            "line2": footer_line2,
            "logo": b"",
            "align": FOOTER_ALIGN,
        },
    }


def get_erp_branding() -> dict:
    with _ERP_BRANDING_LOCK:
        return dict(_ERP_BRANDING)


def refresh_erp_branding(log_success: bool = False) -> bool:
    if not ERP_BRANDING_URL:
        return False
    try:
        banners = fetch_erp_branding(ERP_BRANDING_URL, ERP_BRANDING_TIMEOUT_SECONDS)
    except Exception as exc:
        # Debug, not warning: on a per-5-minute poll an ERP that is down would
        # otherwise fill the log with identical lines. The startup attempt logs
        # loudly (below) because that one is worth noticing.
        log.debug("Could not refresh clinic branding from %s: %s", ERP_BRANDING_URL, exc)
        return False
    with _ERP_BRANDING_LOCK:
        _ERP_BRANDING.clear()
        _ERP_BRANDING.update(banners)
    global ERP_LAST_SYNC
    ERP_LAST_SYNC = datetime.now().isoformat()
    _sync_bridge_runtime()
    if log_success:
        log.info(
            "Clinic branding loaded from the ERP: header=%r/%r, logo=%s, footer=%r",
            banners["header"]["line2"], banners["header"]["line1"],
            "yes" if banners["header"]["logo"] else "no",
            banners["footer"]["line1"],
        )
    return True


def _erp_branding_loop() -> None:
    while True:
        time.sleep(ERP_BRANDING_REFRESH_SECONDS)
        try:
            refresh_erp_branding()
        except Exception:
            log.exception("Clinic branding refresh failed")


def start_erp_branding_thread() -> None:
    if not ERP_BRANDING_URL:
        return
    if refresh_erp_branding(log_success=True):
        pass
    else:
        log.warning(
            "Could not reach the ERP branding endpoint at %s on startup; "
            "falling back to the HEADER_*/FOOTER_* settings until it responds",
            ERP_BRANDING_URL,
        )
    threading.Thread(target=_erp_branding_loop, name="erp-branding", daemon=True).start()


def render_banner(
    width_px: int, height_px: int, line1: str, line2: str, logo, align: str, bg_rgb: tuple, text_rgb: tuple
) -> Image.Image:
    """A clinic letterhead band (logo + up to two lines of text) for the top or bottom of a page.

    `logo` may be a filesystem path (str, from HEADER_LOGO_PATH/FOOTER_LOGO_PATH) or raw
    image bytes (from a logo uploaded inline through the HTTP print API).
    """
    band = Image.new("RGB", (width_px, height_px), bg_rgb)
    if not line1 and not line2 and not logo:
        return band
    draw = ImageDraw.Draw(band)
    pad = max(4, height_px // 10)

    logo_img = None
    if logo:
        try:
            source = BytesIO(logo) if isinstance(logo, (bytes, bytearray)) else logo
            logo_img = Image.open(source).convert("RGBA")
            target_h = max(1, height_px - 2 * pad)
            ratio = target_h / logo_img.height
            logo_img = logo_img.resize((max(1, round(logo_img.width * ratio)), target_h), Image.LANCZOS)
        except (OSError, ValueError) as exc:
            log.warning("Could not load banner logo: %s", exc)
            logo_img = None

    font1 = _load_font(_FONT_REGULAR_PATHS, max(11, height_px // 4))
    font2 = _load_font(_FONT_BOLD_PATHS, max(14, height_px // 3))
    lines_fonts = [(t, f) for t, f in ((line1, font1), (line2, font2)) if t]

    text_w, text_h = _text_block_size(draw, lines_fonts) if lines_fonts else (0, 0)
    logo_w = logo_img.width if logo_img else 0
    gap = pad * 2 if (logo_img and lines_fonts) else 0
    block_w = logo_w + gap + text_w

    if align == "LEFT":
        x = pad
    elif align == "RIGHT":
        x = max(pad, width_px - pad - block_w)
    else:
        x = max(pad, (width_px - block_w) // 2)

    if logo_img:
        band.paste(logo_img, (x, (height_px - logo_img.height) // 2), logo_img)
        x += logo_w + gap

    y = (height_px - text_h) // 2
    for text, font in lines_fonts:
        bbox = draw.textbbox((0, 0), text, font=font)
        line_h = bbox[3] - bbox[1]
        draw.text((x, y - bbox[1]), text, font=font, fill=text_rgb)
        y += line_h

    return band


def render_page(
    images: list[np.ndarray],
    color_flags: list[bool],
    orientation_hint: str = "PORTRAIT",
    header: Optional[dict] = None,
    footer: Optional[dict] = None,
    max_rows: Optional[int] = None,
    max_cols: Optional[int] = None,
    patient_label: str = "",
    labels: Optional[list[str]] = None,
    page_size: str = "",
    modality: str = "",
) -> Image.Image:
    """Render one page. `header`/`footer` (keys: line1, line2, logo, align) override the
    HEADER_*/FOOTER_* env config for this page only - used by the HTTP print API so an ERP
    can supply its own clinic branding per request instead of relying on this container's
    static config. `max_rows`/`max_cols` likewise override LAYOUT_ROWS/LAYOUT_COLS for this
    page only. `patient_label` is the identification line printed under the header on a
    DICOM film; the HTTP path leaves it empty (the ERP supplies its own branding).
    """
    grid_max_rows = max_rows or LAYOUT_ROWS
    grid_max_cols = max_cols or LAYOUT_COLS

    page_size = normalize_page_size(page_size, PAGE_SIZE)
    if PAGE_ORIENTATION == "AUTO":
        orientation = choose_orientation(
            images, grid_max_rows, grid_max_cols,
            banner_mm=HEADER_HEIGHT_MM + FOOTER_HEIGHT_MM,
            page_size=page_size,
        )
    else:
        orientation = _page_orientation_for(orientation_hint)
    page_w, page_h = _page_size_px(page_size, orientation, DPI)
    margin_px = _mm_to_px(MARGIN_MM, DPI)
    gutter_px = _mm_to_px(GUTTER_MM, DPI)

    rows, cols = (
        _best_fit_grid(len(images), grid_max_rows, grid_max_cols) if AUTO_FIT_LAYOUT else (grid_max_rows, grid_max_cols)
    )

    bg = (0, 0, 0) if BACKGROUND_COLOR == "BLACK" else (255, 255, 255)
    canvas = Image.new("RGB", (page_w, page_h), bg)

    banner_bg = (0, 0, 0) if BANNER_BACKGROUND_COLOR == "BLACK" else (255, 255, 255)
    banner_text = (255, 255, 255) if BANNER_BACKGROUND_COLOR == "BLACK" else (0, 0, 0)

    # Letterhead precedence: what this job explicitly carries (the HTTP print
    # API), then whatever the ERP last told us, then this container's own
    # HEADER_*/FOOTER_* settings.
    erp = get_erp_branding()
    erp_header = erp.get("header") or {}
    erp_footer = erp.get("footer") or {}

    def pick(override, erp_value, env_value, key):
        if override and key in override:
            return override[key]
        if erp_value.get(key):
            return erp_value[key]
        return env_value

    header_line1 = pick(header, erp_header, HEADER_LINE1, "line1")
    header_line2 = pick(header, erp_header, HEADER_LINE2, "line2")
    header_logo = pick(header, erp_header, HEADER_LOGO_PATH, "logo")
    header_align = pick(header, erp_header, HEADER_ALIGN, "align")

    footer_line1 = pick(footer, erp_footer, FOOTER_LINE1, "line1")
    footer_line2 = pick(footer, erp_footer, FOOTER_LINE2, "line2")
    footer_logo = pick(footer, erp_footer, FOOTER_LOGO_PATH, "logo")
    footer_align = pick(footer, erp_footer, FOOTER_ALIGN, "align")

    header_h = _mm_to_px(HEADER_HEIGHT_MM, DPI) if (header_line1 or header_line2 or header_logo) else 0
    footer_h = _mm_to_px(FOOTER_HEIGHT_MM, DPI) if (footer_line1 or footer_line2 or footer_logo) else 0

    if header_h:
        banner = render_banner(page_w, header_h, header_line1, header_line2, header_logo,
                                header_align, banner_bg, banner_text)
        canvas.paste(banner, (0, 0))
    if footer_h:
        banner = render_banner(page_w, footer_h, footer_line1, footer_line2, footer_logo,
                                footer_align, banner_bg, banner_text)
        canvas.paste(banner, (0, page_h - footer_h))

    # Patient identification line, printed on the sheet itself between the
    # header band and the images. A film that leaves the department with no
    # name or ID on it cannot be matched back to a patient.
    patient_h = 0
    if patient_label and SHOW_PATIENT_BANNER and PATIENT_BANNER_HEIGHT_MM > 0:
        patient_h = _mm_to_px(PATIENT_BANNER_HEIGHT_MM, DPI)
        patient_text = (255, 255, 255) if BACKGROUND_COLOR == "BLACK" else (0, 0, 0)
        draw = ImageDraw.Draw(canvas)
        font = _load_font(_FONT_BOLD_PATHS, max(10, int(patient_h * 0.62)))
        bbox = draw.textbbox((0, 0), patient_label, font=font)
        text_w = bbox[2] - bbox[0]
        if header_align == "LEFT":
            text_x = margin_px
        elif header_align == "RIGHT":
            text_x = max(margin_px, page_w - margin_px - text_w)
        else:
            text_x = max(margin_px, (page_w - text_w) // 2)
        text_y = header_h + (patient_h - (bbox[3] - bbox[1])) // 2
        draw.text((text_x, text_y - bbox[1]), patient_label, font=font, fill=patient_text)

    label_h = _mm_to_px(IMAGE_LABEL_HEIGHT_MM, DPI) if (SHOW_IMAGE_LABELS and labels) else 0
    label_ink = (255, 255, 255) if BACKGROUND_COLOR == "BLACK" else (0, 0, 0)

    usable_w = page_w - 2 * margin_px
    usable_h = page_h - 2 * margin_px - header_h - footer_h - patient_h
    cell_w = max(1, (usable_w - (cols - 1) * gutter_px) // cols)
    cell_h = max(1, (usable_h - (rows - 1) * gutter_px) // rows)
    grid_top = margin_px + header_h + patient_h

    # Images beyond the grid are never handed to this function (the N-ACTION
    # handler / batch flush already caps the list at MAX_IMAGES_PER_PAGE),
    # but the row-bounds check below is kept as a last line of defense.
    for index, (arr, is_color) in enumerate(zip(images, color_flags)):
        row, col = divmod(index, cols)
        if row >= rows:
            break

        if ENABLE_CALIBRATION:
            calibrated = image_profiles.calibrate_frame(
                arr, is_color, modality=modality, enable=True,
            )
        else:
            calibrated = normalize_bit_depth(arr)

        # Reserve a strip under the frame for its caption, so the label never
        # overlaps the image or the row below it.
        caption = (labels[index] if labels and index < len(labels) else "") or ""
        caption_h = label_h if caption else 0

        resized = _fit_into_cell(calibrated, cell_w, cell_h - caption_h, STRETCH_TO_FIT)
        tile = Image.fromarray(resized).convert("RGB")

        cell_x = margin_px + col * (cell_w + gutter_px)
        cell_y = grid_top + row * (cell_h + gutter_px)
        x = cell_x + (cell_w - tile.width) // 2
        y = cell_y + (cell_h - caption_h - tile.height) // 2
        canvas.paste(tile, (x, y))

        if caption:
            draw = ImageDraw.Draw(canvas)
            font = _load_font(_FONT_REGULAR_PATHS, max(9, int(caption_h * 0.62)))
            # Trim to the cell using real font metrics rather than a character
            # estimate, so a long series description degrades instead of
            # bleeding into the neighbouring tile.
            text = caption
            while text and draw.textbbox((0, 0), text, font=font)[2] > cell_w - 4:
                text = text[:-1]
            if text:
                bbox = draw.textbbox((0, 0), text, font=font)
                draw.text(
                    (cell_x + 2, cell_y + cell_h - caption_h + (caption_h - (bbox[3] - bbox[1])) // 2 - bbox[1]),
                    text, font=font, fill=label_ink,
                )

    return canvas


def save_pages(canvases: list[Image.Image], out_path: Path) -> list[Path]:
    """Save one or more rendered pages, returning the file(s) actually written.

    Multi-page PDFs use Pillow's native multi-page support (a single file).
    PNG has no multi-page concept, so a multi-page PNG job (OUTPUT_FORMAT=png)
    gets one file per page instead, suffixed _p1, _p2, ...
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT_FORMAT == "pdf":
        canvases[0].save(str(out_path), "PDF", resolution=float(DPI), save_all=True, append_images=canvases[1:])
        return [out_path]
    if len(canvases) == 1:
        canvases[0].save(str(out_path), dpi=(DPI, DPI))
        return [out_path]
    paths = []
    for index, canvas in enumerate(canvases, start=1):
        page_path = out_path.with_name(f"{out_path.stem}_p{index}{out_path.suffix}")
        canvas.save(str(page_path), dpi=(DPI, DPI))
        paths.append(page_path)
    return paths


# =============================================================================
# Printing backends (CUPS / raw JetDirect)
# =============================================================================

def print_via_cups(path: Path, copies: int, page_size: str = "") -> None:
    if not CUPS_PRINTER_NAME:
        raise RuntimeError("CUPS_PRINTER_NAME is not set; cannot submit the print job")
    # Without an explicit media the printer uses its default tray size, so an
    # A3/A3+ page would be fitted down onto whatever is loaded - the sheet
    # would come out the right shape but the wrong size.
    media = cups_media_for(page_size or PAGE_SIZE)
    cmd = [
        "lp", "-h", CUPS_SERVER,
        "-d", CUPS_PRINTER_NAME,
        "-n", str(max(1, copies)),
        "-o", f"media={media}",
        "-o", "fit-to-page",
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError(f"lp exited {result.returncode}: {(result.stderr or result.stdout).strip()}")
    log.info("CUPS accepted the job: %s", result.stdout.strip())


def print_via_jetdirect(path: Path, copies: int) -> None:
    if not JETDIRECT_HOST:
        raise RuntimeError("JETDIRECT_HOST is not set; cannot open a raw print socket")
    data = path.read_bytes()
    for copy_number in range(1, max(1, copies) + 1):
        with socket.create_connection((JETDIRECT_HOST, JETDIRECT_PORT), timeout=30) as sock:
            sock.sendall(data)
        log.info("Sent copy %d/%d to %s:%d via raw JetDirect", copy_number, copies, JETDIRECT_HOST, JETDIRECT_PORT)


def spool_print_job(path: Path, copies: int, page_size: str = "") -> None:
    if PRINT_METHOD == "jetdirect":
        print_via_jetdirect(path, copies)
    else:
        print_via_cups(path, copies, page_size)


def check_printer_status() -> tuple[str, str]:
    """Best-effort printer health probe for the Printer SOP Class N-GET response."""
    if PRINT_METHOD == "jetdirect":
        if not JETDIRECT_HOST:
            return "FAILURE", "JETDIRECT_HOST is not configured"
        try:
            with socket.create_connection((JETDIRECT_HOST, JETDIRECT_PORT), timeout=3):
                return "NORMAL", f"{JETDIRECT_HOST}:{JETDIRECT_PORT} is reachable"
        except OSError as exc:
            return "FAILURE", f"Cannot reach {JETDIRECT_HOST}:{JETDIRECT_PORT} ({exc})"

    if not CUPS_PRINTER_NAME:
        return "FAILURE", "CUPS_PRINTER_NAME is not configured"
    try:
        result = subprocess.run(
            ["lpstat", "-h", CUPS_SERVER, "-p", CUPS_PRINTER_NAME],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return "FAILURE", (result.stderr.strip() or "Printer queue not found in CUPS")
        if "disabled" in result.stdout.lower():
            return "FAILURE", result.stdout.strip()
        return "NORMAL", result.stdout.strip()
    except Exception as exc:
        # This is a best-effort health probe called from inside a DIMSE
        # handler; it must report a status, never raise.
        return "WARNING", f"Could not query CUPS: {exc}"


# =============================================================================
# Background print-job worker
# =============================================================================

def process_print_job(
    job_key: str,
    page_groups: list[list[np.ndarray]],
    color_flag_groups: list[list[bool]],
    copies: int,
    orientation_hint: str,
    header: Optional[dict] = None,
    footer: Optional[dict] = None,
    max_rows: Optional[int] = None,
    max_cols: Optional[int] = None,
    patient_label: str = "",
    image_labels: Optional[list[list[str]]] = None,
    page_size: str = "",
    source: str = "ERP",
    source_calling_ae: str = "",
    film_session_uid: str = "",
    film_box_uids: Optional[list[str]] = None,
    identity_audits: Optional[list[dict]] = None,
    patient_info: Optional[PatientInfo] = None,
    modality: str = "",
) -> None:
    """Render and print one job. `page_groups`/`color_flag_groups` are lists of
    per-page image lists - the DICOM print path always submits a single page
    (`[images]`/`[color_flags]`); the HTTP print API can submit several pages
    at once for a job with more images than fit in one layout.

    Records its own outcome in PRINT_JOB_STATUS (queryable via
    GET /api/v1/print-jobs/{jobKey}) so a fire-and-forget 202 isn't the last
    word on whether a job actually printed.
    """
    total_images = sum(len(page) for page in page_groups)
    _mark_job_queued(job_key, pages=len(page_groups), images=total_images, copies=copies)
    _mark_job_processing(job_key, pages=len(page_groups), images=total_images, copies=copies)

    identity_summary = identity_audit.summarize_identity(identity_audits or [])
    ef_job = ElectronicFilmJob(
        jobKey=job_key,
        source=source,
        sourceCallingAE=source_calling_ae,
        filmSessionUID=film_session_uid,
        filmBoxUIDs=film_box_uids or [],
        imageCount=total_images,
        layoutRows=max_rows or LAYOUT_ROWS,
        layoutCols=max_cols or LAYOUT_COLS,
        filmSize=normalize_page_size(page_size, PAGE_SIZE),
        filmOrientation=orientation_hint,
        artifactFormat=OUTPUT_FORMAT,
        captureStatus="pending",
        physicalPrintStatus="skipped" if CAPTURE_MODE == "CAPTURE_ONLY" else "pending",
        copies=copies,
        pages=len(page_groups),
        identityAudit=identity_audits or [],
        identitySummary=identity_summary,
        modality=modality or (patient_info.modality if patient_info else ""),
        patientId=patient_info.patient_id if patient_info else "",
        patientName=patient_info.name if patient_info else "",
    )
    job_store.create_job(ef_job)

    try:
        log.info(
            "Rendering print job %s: %d page(s), %d image(s) total, %d cop%s (mode=%s)",
            job_key, len(page_groups), total_images, copies, "y" if copies == 1 else "ies", CAPTURE_MODE,
        )
        page_size_eff = normalize_page_size(page_size, PAGE_SIZE)
        canvases = [
            render_page(images, flags, orientation_hint, header=header, footer=footer,
                        max_rows=max_rows, max_cols=max_cols, patient_label=patient_label,
                        labels=(image_labels[index] if image_labels and index < len(image_labels) else None),
                        page_size=page_size_eff, modality=modality)
            for index, (images, flags) in enumerate(zip(page_groups, color_flag_groups))
        ]

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        suffix = re.sub(r"[^A-Za-z0-9]", "", job_key)[-10:]
        out_path = OUTPUT_DIR / f"print_{timestamp}_{suffix}.{OUTPUT_FORMAT}"
        out_paths = save_pages(canvases, out_path)
        log.info("Saved %d rendered page file(s): %s", len(out_paths), ", ".join(p.name for p in out_paths))

        global LAST_SUCCESSFUL_CAPTURE
        LAST_SUCCESSFUL_CAPTURE = {
            "jobKey": job_key,
            "at": datetime.now().isoformat(),
            "artifacts": [str(p) for p in out_paths],
        }
        job_store.update_job(
            job_key,
            captureStatus="captured",
            artifactPaths=[str(p) for p in out_paths],
            pages=len(out_paths),
        )
        _mark_job_completed(job_key)

        if CAPTURE_MODE == "CAPTURE_ONLY":
            log.info("Capture-only mode: electronic film saved for job %s (no physical print)", job_key)
            return

        print_error = None
        for page_path in out_paths:
            try:
                spool_print_job(page_path, copies, page_size_eff)
            except Exception as exc:
                print_error = str(exc)
                log.exception("Physical print failed for %s", page_path)
                break

        if print_error:
            job_store.update_job(job_key, physicalPrintStatus="failed", physicalPrintError=print_error[:500])
            _record_error(f"Physical print failed for {job_key}: {print_error}")
            if CAPTURE_MODE == "PRINT_ONLY":
                _mark_job_failed(job_key, print_error)
            else:
                log.warning("Physical print failed but electronic film captured for %s", job_key)
        else:
            global LAST_PHYSICAL_PRINT
            LAST_PHYSICAL_PRINT = {"jobKey": job_key, "at": datetime.now().isoformat()}
            job_store.update_job(job_key, physicalPrintStatus="printed")
            log.info("Print job %s dispatched successfully (%d file(s) sent to the printer)", job_key, len(out_paths))
    except Exception as exc:
        log.exception("Print job %s failed", job_key)
        job_store.update_job(job_key, captureStatus="failed", captureError=str(exc)[:500])
        _mark_job_failed(job_key, str(exc))
        _record_error(f"Job {job_key} failed: {exc}")


# =============================================================================
# DICOM N-service handlers
# =============================================================================

BRIDGE_RUNTIME: dict[str, Any] = {
    "bridge_status": "RUNNING",
    "last_association": None,
    "last_successful_capture": None,
    "last_physical_print": None,
    "last_error": None,
    "erp_last_sync": "",
    "recent_associations": [],
    "recent_errors": [],
}


def _sync_bridge_runtime() -> None:
    BRIDGE_RUNTIME.update({
        "bridge_status": BRIDGE_STATUS,
        "last_association": LAST_ASSOCIATION,
        "last_successful_capture": LAST_SUCCESSFUL_CAPTURE,
        "last_physical_print": LAST_PHYSICAL_PRINT,
        "last_error": LAST_ERROR,
        "erp_last_sync": ERP_LAST_SYNC,
        "recent_associations": list(RECENT_ASSOCIATIONS),
        "recent_errors": list(RECENT_ERRORS),
    })


def handle_assoc_accepted(event) -> int:
    global LAST_ASSOCIATION
    caller = str(event.assoc.requestor.ae_title or "").strip()
    entry = {
        "at": datetime.now().isoformat(),
        "callingAE": caller,
        "calledAE": AE_TITLE,
    }
    LAST_ASSOCIATION = entry
    RECENT_ASSOCIATIONS.append(entry)
    if len(RECENT_ASSOCIATIONS) > 20:
        RECENT_ASSOCIATIONS.pop(0)
    _sync_bridge_runtime()
    log.info("Association accepted from calling AE %s", caller or "?")
    return 0x0000


def handle_echo(event) -> int:
    return 0x0000


def _new_uid(requested) -> str:
    return str(requested) if requested else generate_uid()


def _session_is_color(event) -> bool:
    abstract = str(event.context.abstract_syntax)
    if abstract == str(BasicColorPrintManagementMeta):
        return True
    if abstract == str(BasicGrayscalePrintManagementMeta):
        return False
    # Some SCUs negotiate the constituent SOP Classes directly instead of the
    # Meta SOP Class; fall back to whichever Image Box class the association
    # actually accepted.
    accepted = {str(cx.abstract_syntax) for cx in event.assoc.accepted_contexts}
    return str(BasicColorImageBox) in accepted


def _extract_patient_key(attrs: Dataset) -> Optional[str]:
    """Best-effort patient identity from an N-CREATE Attribute List.

    Patient tags aren't part of the Film Session/Box modules, but some
    modalities include them anyway; when present this is a far more
    reliable batching key than the AE-title/timing fallback.
    """
    patient_id = getattr(attrs, "PatientID", None)
    if patient_id:
        return f"pid:{str(patient_id).strip()}"
    patient_name = getattr(attrs, "PatientName", None)
    if patient_name:
        return f"pname:{str(patient_name).strip()}"
    return None


def _extract_patient_info(*datasets) -> PatientInfo:
    """Collect patient identification from any datasets that carry it.

    Later datasets enrich earlier ones. Patient tags are not part of the Film
    Session/Box modules, so they turn up inconsistently - on the Attribute
    List, on the Image Box modification list, or on the image item itself.
    """
    info = PatientInfo()
    for ds in datasets:
        if ds is None:
            continue

        def text(tag: str) -> str:
            value = getattr(ds, tag, None)
            return str(value).strip() if value not in (None, "") else ""

        info = info.merged_with(PatientInfo(
            name=text("PatientName"),
            patient_id=text("PatientID"),
            study_date=text("StudyDate"),
            modality=text("Modality").upper(),
        ))
    return info


def _extract_image_label(*datasets) -> str:
    """Per-frame caption: series description and image number, when sent.

    Like the patient tags these are optional on a print job, so the caption is
    whatever turned up - "PLAX  #3", just "PLAX", just "#3", or nothing.
    """
    description = ""
    number = ""
    for ds in datasets:
        if ds is None:
            continue
        for tag in ("SeriesDescription", "StudyDescription", "ImageComments"):
            value = getattr(ds, tag, None)
            if value and not description:
                description = str(value).strip()
        value = getattr(ds, "InstanceNumber", None)
        if value not in (None, "") and not number:
            number = f"#{str(value).strip()}"
    return "  ".join(p for p in (description, number) if p)


def _parse_image_display_format(value) -> tuple[int, int]:
    text = str(value or "").strip()
    tail = text.split("\\")[-1]
    parts = tail.split(",")
    if len(parts) == 2:
        try:
            rows, cols = int(parts[0].strip()), int(parts[1].strip())
            if rows >= 1 and cols >= 1:
                return rows, cols
        except ValueError:
            pass
    return LAYOUT_ROWS, LAYOUT_COLS


def handle_create(event):
    req = event.request
    sop_class = str(req.AffectedSOPClassUID)
    uid = _new_uid(req.AffectedSOPInstanceUID)
    attrs = event.attribute_list

    if sop_class == str(BasicFilmSession):
        calling_ae = str(event.assoc.requestor.ae_title or "").strip()
        return _create_film_session(uid, attrs, calling_ae)
    if sop_class == str(BasicFilmBox):
        return _create_film_box(event, uid, attrs)

    log.warning("N-CREATE for unsupported SOP Class %s", sop_class)
    return 0x0110, None


def _create_film_session(uid: str, attrs: Dataset, calling_ae: str):
    copies = 1
    try:
        copies = max(1, int(getattr(attrs, "NumberOfCopies", 1) or 1))
    except (TypeError, ValueError):
        pass

    with _STATE_LOCK:
        FILM_SESSIONS[uid] = FilmSessionRecord(
            sop_instance_uid=uid,
            number_of_copies=copies,
            label=str(getattr(attrs, "FilmSessionLabel", "") or ""),
            created_at=datetime.now(),
            calling_ae=calling_ae,
            patient_key=_extract_patient_key(attrs),
        )
    session_audit = identity_audit.audit_film_session(attrs, calling_ae)
    IDENTITY_AUDIT_BUFFER.append(session_audit)
    log.info("Film Session identity audit: %s", json.dumps(session_audit.get("tags", [])[:3]))
    log.info("Film Session created: %s (copies=%d, calling AE=%s)", uid, copies, calling_ae or "?")

    resp = Dataset()
    resp.SOPClassUID = BasicFilmSession
    resp.SOPInstanceUID = uid
    resp.AffectedSOPInstanceUID = uid
    return 0x0000, resp


def _create_film_box(event, uid: str, attrs: Dataset):
    session_uid = None
    ref_seq = getattr(attrs, "ReferencedFilmSessionSequence", None)
    if ref_seq:
        session_uid = str(getattr(ref_seq[0], "ReferencedSOPInstanceUID", "") or "")

    with _STATE_LOCK:
        session = FILM_SESSIONS.get(session_uid)
        if session is None:
            log.warning("Film Box %s references unknown Film Session %s", uid, session_uid)
            return 0x0110, None

        rows, cols = _parse_image_display_format(getattr(attrs, "ImageDisplayFormat", ""))
        box_count = min(rows * cols, ABSOLUTE_MAX_IMAGE_BOXES)
        if rows * cols > ABSOLUTE_MAX_IMAGE_BOXES:
            log.warning(
                "Film Box %s requested a %dx%d grid; capping instance creation at %d boxes",
                uid, rows, cols, ABSOLUTE_MAX_IMAGE_BOXES,
            )

        is_color = _session_is_color(event)
        image_box_class = BasicColorImageBox if is_color else BasicGrayscaleImageBox

        box = FilmBoxRecord(
            sop_instance_uid=uid,
            film_session_uid=session_uid,
            rows=rows,
            cols=cols,
            orientation=str(getattr(attrs, "FilmOrientation", "PORTRAIT") or "PORTRAIT"),
            film_size_id=str(getattr(attrs, "FilmSizeID", "") or ""),
            created_at=datetime.now(),
            patient_key=_extract_patient_key(attrs),
        )

        ref_image_boxes = []
        for position in range(1, box_count + 1):
            image_uid = generate_uid()
            IMAGE_BOXES[image_uid] = ImageBoxRecord(
                sop_instance_uid=image_uid,
                film_box_uid=uid,
                position=position,
                is_color=is_color,
            )
            box.image_box_uids.append(image_uid)

            ref_item = Dataset()
            ref_item.ReferencedSOPClassUID = image_box_class
            ref_item.ReferencedSOPInstanceUID = image_uid
            ref_image_boxes.append(ref_item)

        FILM_BOXES[uid] = box
        session.film_box_uids.append(uid)

    box_audit = identity_audit.audit_film_box(attrs)
    IDENTITY_AUDIT_BUFFER.append(box_audit)

    log.info(
        "Film Box created: %s (%dx%d grid, %d image box(es), FilmSizeID=%s, session=%s)",
        uid, rows, cols, box_count, box.film_size_id or "(none)", session_uid,
    )

    resp = Dataset()
    resp.SOPClassUID = BasicFilmBox
    resp.SOPInstanceUID = uid
    resp.AffectedSOPInstanceUID = uid
    resp.ReferencedImageBoxSequence = ref_image_boxes
    return 0x0000, resp


def handle_set(event):
    req = event.request
    uid = str(req.RequestedSOPInstanceUID)
    mods = event.modification_list

    with _STATE_LOCK:
        image_box = IMAGE_BOXES.get(uid)
        film_box_exists = uid in FILM_BOXES

    if image_box is not None:
        return _set_image_box(image_box, mods)

    if film_box_exists:
        # Film Box level N-SET (e.g. changing an attribute post-creation) isn't
        # needed for this bridge's workflow, but conformant SCUs may still probe it.
        resp = Dataset()
        resp.SOPClassUID = BasicFilmBox
        resp.SOPInstanceUID = uid
        return 0x0000, resp

    log.warning("N-SET for unrecognised SOP Instance %s", uid)
    return 0x0112, None


def _set_image_box(image_box: ImageBoxRecord, mods: Dataset):
    seq_item = None
    is_color = image_box.is_color

    grayscale_seq = getattr(mods, "BasicGrayscaleImageSequence", None)
    color_seq = getattr(mods, "BasicColorImageSequence", None)
    if grayscale_seq:
        seq_item, is_color = grayscale_seq[0], False
    elif color_seq:
        seq_item, is_color = color_seq[0], True
    else:
        # Tolerate a non-conformant layout (seen in some SCU implementations
        # copied from older sample code) that places the Image Pixel Module
        # directly under this tag instead of Basic Grayscale/Color Image Sequence.
        legacy_seq = getattr(mods, "ReferencedImageBoxSequence", None)
        if legacy_seq:
            seq_item = legacy_seq[0]
            is_color = int(getattr(seq_item, "SamplesPerPixel", 1) or 1) > 1

    if seq_item is None:
        log.warning("Image Box N-SET for %s carried no pixel data sequence", image_box.sop_instance_uid)
        return 0x0106, None

    try:
        array, decoded_is_color = decode_image_box_pixels(seq_item)
    except Exception as exc:
        log.warning("Failed to decode pixel data for Image Box %s: %s", image_box.sop_instance_uid, exc)
        return 0x0106, None

    position = image_box.position
    try:
        position = int(getattr(mods, "ImageBoxPosition", position) or position)
    except (TypeError, ValueError):
        pass

    patient = _extract_patient_info(seq_item, mods)
    label = _extract_image_label(seq_item, mods)
    img_audit = identity_audit.audit_image_box(mods, seq_item)
    IDENTITY_AUDIT_BUFFER.append(img_audit)

    with _STATE_LOCK:
        image_box.array = array
        image_box.is_color = decoded_is_color or is_color
        image_box.position = position
        image_box.set_at = datetime.now()
        image_box.patient = patient
        image_box.label = label

    log.info(
        "Image Box %s received %dx%d %s pixel data (position %d)",
        image_box.sop_instance_uid, array.shape[1], array.shape[0],
        "color" if image_box.is_color else "grayscale", position,
    )

    resp = Dataset()
    resp.SOPClassUID = BasicColorImageBox if image_box.is_color else BasicGrayscaleImageBox
    resp.SOPInstanceUID = image_box.sop_instance_uid
    return 0x0000, resp


def handle_action(event):
    req = event.request
    uid = str(req.RequestedSOPInstanceUID)
    action_type = event.action_type

    with _STATE_LOCK:
        film_box = FILM_BOXES.get(uid)
        session = FILM_SESSIONS.get(uid)

    if film_box is not None:
        return _print_film_box(film_box, action_type)
    if session is not None:
        return _print_film_session(session, action_type)

    log.warning("N-ACTION for unrecognised SOP Instance %s", uid)
    return 0x0112, None


def _find_or_create_batch_locked(
    ae_title: str, patient_key: Optional[str], is_color: bool, copies: int, orientation_hint: str,
    max_rows: int = 0, max_cols: int = 0,
) -> PrintBatchRecord:
    """Caller must hold _STATE_LOCK."""
    now = datetime.now()
    for batch in BATCHES.values():
        if batch.ae_title != ae_title or batch.is_color != is_color:
            # Never mix grayscale and color frames onto the same page, even
            # if they'd otherwise match on AE Title/patient/timing.
            continue
        if patient_key:
            if batch.patient_key == patient_key:
                return batch
        elif batch.patient_key is None and (now - batch.last_activity).total_seconds() <= BATCH_IDLE_TIMEOUT_SECONDS:
            # AE-title/timing fallback: only ever joins another anonymous
            # (no patient key) batch that's still within its idle window -
            # never merges into a patient-keyed batch, and never revives one
            # that's already gone quiet (that one is about to be flushed as
            # a separate, earlier page).
            return batch

    key = f"{ae_title or 'UNKNOWN'}:{'color' if is_color else 'gray'}:{patient_key or generate_uid()}"
    batch = PrintBatchRecord(
        batch_key=key,
        ae_title=ae_title,
        patient_key=patient_key,
        is_color=is_color,
        copies=copies,
        orientation_hint=orientation_hint,
        last_activity=now,
        max_rows=max_rows,
        max_cols=max_cols,
    )
    BATCHES[key] = batch
    return batch


def _print_film_box(film_box: FilmBoxRecord, action_type: Optional[int]):
    if action_type != 1:
        log.warning("Film Box %s: unsupported Action Type ID %r", film_box.sop_instance_uid, action_type)
        return 0x0123, None

    with _STATE_LOCK:
        session = FILM_SESSIONS.get(film_box.film_session_uid)
        if session is None:
            return 0x0110, None

        boxes = sorted(
            (IMAGE_BOXES[u] for u in film_box.image_box_uids if u in IMAGE_BOXES),
            key=lambda b: b.position,
        )
        filled = [b for b in boxes if b.array is not None]

        if not filled:
            log.warning("Film Box %s has no Image Box pixel data to print", film_box.sop_instance_uid)
            return 0x0000, None

        patient = PatientInfo()
        for box in filled:
            if box.patient:
                patient = patient.merged_with(box.patient)

        if PRESERVE_CONSOLE_LAYOUT or HONOR_SCU_LAYOUT:
            page_rows, page_cols = film_box.rows, film_box.cols
        else:
            page_rows, page_cols = layout_for_modality(patient.modality)

        film_size = ""
        if HONOR_SCU_FILM_SIZE and film_box.film_size_id:
            film_size = normalize_page_size(film_box.film_size_id)
            if not film_size:
                log.warning(
                    "Film Box %s requested unknown FilmSizeID=%r; using %s",
                    film_box.sop_instance_uid, film_box.film_size_id, PAGE_SIZE,
                )

        use_auto_batch = BATCH_GROUP_BY == "auto" and not PRESERVE_CONSOLE_LAYOUT

        if use_auto_batch:
            page_capacity = page_rows * page_cols
            patient_key = film_box.patient_key or session.patient_key
            is_color = filled[0].is_color
            batch = _find_or_create_batch_locked(
                session.calling_ae, patient_key, is_color, session.number_of_copies, film_box.orientation,
                max_rows=page_rows, max_cols=page_cols,
            )
            batch.patient = batch.patient.merged_with(patient)
            room_left = batch.capacity - len(batch.images)
            to_add = filled[: max(0, room_left)]
            dropped = len(filled) - len(to_add)
            if dropped > 0:
                log.warning(
                    "Batch %s: %d overflow image(s) from Film Box %s will print on a follow-on page",
                    batch.batch_key, dropped, film_box.sop_instance_uid,
                )
                overflow = filled[len(to_add):]
                for box in overflow:
                    overflow_key = f"{batch.batch_key}:overflow:{film_box.sop_instance_uid}"
                    overflow_batch = _find_or_create_batch_locked(
                        session.calling_ae, patient_key, is_color, session.number_of_copies,
                        film_box.orientation, max_rows=page_rows, max_cols=page_cols,
                    )
                    overflow_batch.images.append(
                        BatchImage(array=box.array.copy(), is_color=box.is_color, label=box.label)
                    )
            for box in to_add:
                batch.images.append(
                    BatchImage(array=box.array.copy(), is_color=box.is_color, label=box.label)
                )
            batch.last_activity = datetime.now()
            batch.copies = session.number_of_copies
            batch.orientation_hint = film_box.orientation
            if film_size:
                batch.page_size = film_size
            if len(batch.images) < batch.capacity:
                return 0x0000, None
            images_snapshot = [im.array for im in batch.images]
            color_flags = [im.is_color for im in batch.images]
            labels = [im.label for im in batch.images]
            job_key = batch.batch_key
            copies = batch.copies
            orientation_hint = batch.orientation_hint
            batch_rows, batch_cols = batch.max_rows, batch.max_cols
            patient_label = batch.patient.label()
            job_page_size = batch.page_size
            page_groups = [images_snapshot]
            color_groups = [color_flags]
            label_groups = [labels]
            del BATCHES[batch.batch_key]
        else:
            page_capacity = max(1, page_rows * page_cols)
            all_images = [b.array.copy() for b in filled]
            all_colors = [b.is_color for b in filled]
            all_labels = [b.label for b in filled]
            page_groups, color_groups, label_groups = [], [], []
            for start in range(0, len(all_images), page_capacity):
                page_groups.append(all_images[start:start + page_capacity])
                color_groups.append(all_colors[start:start + page_capacity])
                label_groups.append(all_labels[start:start + page_capacity])
            job_key = f"dicom:{film_box.sop_instance_uid}"
            copies = session.number_of_copies
            orientation_hint = film_box.orientation
            batch_rows, batch_cols = page_rows, page_cols
            patient_label = patient.label()
            job_page_size = film_size

        audits = list(IDENTITY_AUDIT_BUFFER)
        IDENTITY_AUDIT_BUFFER.clear()
        calling_ae = session.calling_ae
        session_uid = session.sop_instance_uid
        box_uid = film_box.sop_instance_uid

    _PRINT_EXECUTOR.submit(
        process_print_job, job_key, page_groups, color_groups, copies, orientation_hint,
        max_rows=batch_rows, max_cols=batch_cols, patient_label=patient_label,
        image_labels=label_groups, page_size=job_page_size,
        source="DICOM", source_calling_ae=calling_ae,
        film_session_uid=session_uid, film_box_uids=[box_uid],
        identity_audits=audits, patient_info=patient, modality=patient.modality,
    )
    return 0x0000, None


def _print_film_session(session: FilmSessionRecord, action_type: Optional[int]):
    if action_type != 1:
        return 0x0123, None

    with _STATE_LOCK:
        box_uids = list(session.film_box_uids)

    for box_uid in box_uids:
        with _STATE_LOCK:
            film_box = FILM_BOXES.get(box_uid)
        if film_box is not None:
            _print_film_box(film_box, 1)

    return 0x0000, None


def handle_delete(event) -> int:
    req = event.request
    uid = str(req.RequestedSOPInstanceUID)

    with _STATE_LOCK:
        if uid in FILM_BOXES:
            _delete_film_box_locked(uid)
            log.info("Film Box %s deleted", uid)
            return 0x0000
        if uid in FILM_SESSIONS:
            _delete_film_session_locked(uid)
            log.info("Film Session %s deleted", uid)
            return 0x0000

    log.warning("N-DELETE for unrecognised SOP Instance %s", uid)
    return 0x0112


def _delete_film_box_locked(uid: str) -> None:
    """Caller must hold _STATE_LOCK."""
    box = FILM_BOXES.pop(uid, None)
    if box is None:
        return
    for image_uid in box.image_box_uids:
        IMAGE_BOXES.pop(image_uid, None)
    session = FILM_SESSIONS.get(box.film_session_uid)
    if session and uid in session.film_box_uids:
        session.film_box_uids.remove(uid)


def _delete_film_session_locked(uid: str) -> None:
    """Caller must hold _STATE_LOCK."""
    session = FILM_SESSIONS.pop(uid, None)
    if session is None:
        return
    for box_uid in list(session.film_box_uids):
        _delete_film_box_locked(box_uid)


def _to_code_string(value: str, max_len: int = 16) -> str:
    """Coerce free text into a conformant CS VR value (A-Z, 0-9, space, underscore only)."""
    cleaned = re.sub(r"[^A-Za-z0-9 _]", "_", value or "").strip().upper()
    return cleaned[:max_len] or "UNKNOWN"


def handle_get(event):
    req = event.request
    sop_class = str(req.RequestedSOPClassUID)

    if sop_class == str(Printer):
        status, info = check_printer_status()
        resp = Dataset()
        resp.SOPClassUID = Printer
        resp.SOPInstanceUID = PrinterInstance
        resp.PrinterStatus = status
        resp.PrinterStatusInfo = _to_code_string(info)
        resp.PrinterName = f"{AE_TITLE} bridge ({PRINT_METHOD})"
        return 0x0000, resp

    if sop_class == str(PrinterConfigurationRetrieval):
        resp = Dataset()
        resp.SOPClassUID = PrinterConfigurationRetrieval
        resp.SOPInstanceUID = str(req.RequestedSOPInstanceUID)
        return 0x0000, resp

    log.warning("N-GET for unsupported SOP Class %s", sop_class)
    return 0x0110, None


# =============================================================================
# Housekeeping (idle-batch flush + idle-session GC + output-folder retention)
# =============================================================================

def _flush_idle_batches() -> None:
    """Print any batch that's gone quiet for BATCH_IDLE_TIMEOUT_SECONDS,
    even though it never filled the page - e.g. a patient who only needed
    4 of a configured 6-image layout.
    """
    now = datetime.now()
    to_flush = []
    with _STATE_LOCK:
        for key, batch in list(BATCHES.items()):
            if (now - batch.last_activity).total_seconds() >= BATCH_IDLE_TIMEOUT_SECONDS:
                to_flush.append(batch)
                del BATCHES[key]

    for batch in to_flush:
        log.info(
            "Batch %s idle for %ds with %d/%d image(s); printing now instead of waiting for more",
            batch.batch_key, BATCH_IDLE_TIMEOUT_SECONDS, len(batch.images), MAX_IMAGES_PER_PAGE,
        )
        images_snapshot = [im.array for im in batch.images]
        color_flags = [im.is_color for im in batch.images]
        _PRINT_EXECUTOR.submit(
            process_print_job, batch.batch_key, [images_snapshot], [color_flags], batch.copies,
            batch.orientation_hint,
            max_rows=batch.max_rows or None, max_cols=batch.max_cols or None,
            patient_label=batch.patient.label(),
            image_labels=[[im.label for im in batch.images]],
            page_size=batch.page_size,
        )


def _batch_flush_loop() -> None:
    # A short cadence relative to BATCH_IDLE_TIMEOUT_SECONDS keeps a partial
    # batch's actual print delay close to the configured timeout.
    while True:
        time.sleep(5)
        try:
            _flush_idle_batches()
        except Exception:
            log.exception("Batch flush sweep failed")


def start_batch_flush_thread() -> None:
    threading.Thread(target=_batch_flush_loop, name="batch-flush", daemon=True).start()


def _sweep_expired_sessions() -> None:
    cutoff = datetime.now() - timedelta(minutes=SESSION_TTL_MINUTES)
    with _STATE_LOCK:
        expired = [uid for uid, s in FILM_SESSIONS.items() if s.created_at < cutoff]
        for uid in expired:
            log.info(
                "Garbage-collecting stale Film Session %s (idle past %d minutes; "
                "the SCU likely never released the association or sent N-DELETE)",
                uid, SESSION_TTL_MINUTES,
            )
            _delete_film_session_locked(uid)


def _sweep_expired_job_statuses() -> None:
    """Finished (completed/failed) job records older than
    JOB_STATUS_RETENTION_SECONDS are dropped so PRINT_JOB_STATUS can't grow
    unbounded on a busy bridge. A "queued"/"processing" record is never swept
    here regardless of age - if a job is somehow stuck, that's diagnostic
    information worth keeping visible, not something to silently discard.
    """
    cutoff = datetime.now() - timedelta(seconds=JOB_STATUS_RETENTION_SECONDS)
    with _JOB_STATUS_LOCK:
        expired = [
            key for key, record in PRINT_JOB_STATUS.items()
            if record.status in ("completed", "failed") and record.updated_at < cutoff
        ]
        for key in expired:
            del PRINT_JOB_STATUS[key]


def _cleanup_old_output_files() -> None:
    if JOB_RETENTION_DAYS <= 0:
        return
    cutoff = time.time() - JOB_RETENTION_DAYS * 86400
    try:
        for path in OUTPUT_DIR.glob(f"print_*.{OUTPUT_FORMAT}"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink()
                    log.info("Removed expired print job file %s (older than %d days)", path.name, JOB_RETENTION_DAYS)
            except OSError:
                continue
    except OSError:
        pass


def _gc_loop() -> None:
    while True:
        time.sleep(300)
        try:
            _sweep_expired_sessions()
            _cleanup_old_output_files()
            _sweep_expired_job_statuses()
        except Exception:
            log.exception("Housekeeping sweep failed")


def start_housekeeping_thread() -> None:
    threading.Thread(target=_gc_loop, name="housekeeping", daemon=True).start()


# =============================================================================
# HTTP print API (for an ERP / hospital web app to print directly, without a
# DICOM modality involved at all)
# =============================================================================

def _decode_data_url_or_b64(value: str) -> bytes:
    """Accept either a bare base64 string or a `data:...;base64,...` data URL."""
    text = value.strip()
    if text.startswith("data:"):
        comma = text.find(",")
        if comma == -1:
            raise ValueError("malformed data URL (missing comma separator)")
        text = text[comma + 1:]
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64 data: {exc}") from exc


def _image_bytes_to_array(raw: bytes) -> tuple[np.ndarray, bool]:
    """Decode a standard PNG/JPEG image (as sent by an HTTP print-jobs request)
    into the same (array, is_color) shape used by the DICOM Image Box decoder.
    """
    with Image.open(BytesIO(raw)) as img:
        if img.mode == "L":
            return np.asarray(img), False
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            flattened = Image.new("RGB", rgba.size, (255, 255, 255))
            flattened.paste(rgba, mask=rgba.split()[-1])
            return np.asarray(flattened), True
        return np.asarray(img.convert("RGB")), True


def _chunk(seq: list, size: int):
    """Split seq into consecutive slices of at most `size` items each."""
    size = max(1, size)
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _banner_override_from_json(data) -> dict:
    if not isinstance(data, dict):
        raise ValueError("header/footer must be a JSON object")
    align = str(data.get("align", "CENTER") or "CENTER").strip().upper()
    if align not in ("LEFT", "CENTER", "RIGHT"):
        align = "CENTER"
    logo_value = data.get("logo")
    logo = _decode_data_url_or_b64(logo_value) if logo_value else b""
    return {
        "line1": str(data.get("line1", "") or "").strip(),
        "line2": str(data.get("line2", "") or "").strip(),
        "logo": logo,
        "align": align,
    }


class _PrintBridgeHTTPHandler(BaseHTTPRequestHandler):
    """Minimal stdlib-only HTTP API: GET /api/v1/health, POST /api/v1/print-jobs,
    GET /api/v1/print-jobs/{jobKey}.

    No web framework is used (nor a new pip dependency) since this is a
    handful of small, fully-controlled endpoints behind a shared-secret
    bearer token, intended to be called from a trusted backend (e.g. the
    ERP's API server), not exposed directly to end-user browsers.
    """

    server_version = "DicomPrintBridge/1.0"
    timeout = 60  # bound how long a slow/stalled client can hold a worker thread

    def log_message(self, format: str, *args) -> None:
        log.info("HTTP %s - %s", self.address_string(), format % args)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _authorized(self) -> bool:
        if not HTTP_BRIDGE_SECRET:
            return False
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        token = header[len("Bearer "):].strip()
        return hmac.compare_digest(token, HTTP_BRIDGE_SECRET)

    def do_GET(self) -> None:
        path = self.path.split("?")[0].rstrip("/")

        if path == "/admin" or path.startswith("/admin/api/"):
            if admin_routes.handle_admin_get(self, path):
                return

        if path == "/api/v1/health":
            status, info = check_printer_status()
            self._send_json(200, {
                "service": "dicom-print-bridge",
                "printerStatus": status,
                "printerInfo": info,
                "printMethod": PRINT_METHOD,
                "captureMode": CAPTURE_MODE,
                "layout": {"rows": LAYOUT_ROWS, "cols": LAYOUT_COLS},
                "httpApiEnabled": bool(HTTP_BRIDGE_SECRET),
                "bridgeStatus": BRIDGE_STATUS,
            })
            return

        if path == "/api/v1/print-jobs":
            if not HTTP_BRIDGE_SECRET or not self._authorized():
                self._send_json(401, {"error": "missing or invalid Authorization bearer token"})
                return
            self._send_json(200, {"jobs": job_store.list_jobs(limit=100)})
            return

        if path.startswith("/api/v1/print-jobs/"):
            if not HTTP_BRIDGE_SECRET or not self._authorized():
                self._send_json(401, {"error": "missing or invalid Authorization bearer token"})
                return
            remainder = unquote(path[len("/api/v1/print-jobs/"):])
            if remainder.endswith("/artifact"):
                job_key = remainder[:-len("/artifact")]
                record = job_store.get_job(job_key)
                if not record or not record.get("artifactPaths"):
                    self._send_json(404, {"error": "artifact not found"})
                    return
                artifact = Path(record["artifactPaths"][0])
                if not artifact.is_file():
                    self._send_json(404, {"error": "artifact file missing"})
                    return
                data = artifact.read_bytes()
                ctype = "application/pdf" if artifact.suffix.lower() == ".pdf" else "image/png"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            job_key = remainder
            persistent = job_store.get_job(job_key)
            with _JOB_STATUS_LOCK:
                record = PRINT_JOB_STATUS.get(job_key)
            if persistent is None and record is None:
                self._send_json(404, {"error": "unknown job key"})
                return
            payload = {"jobKey": job_key}
            if persistent:
                payload.update(persistent)
            if record:
                payload.update({
                    "status": record.status,
                    "pages": record.pages,
                    "images": record.images,
                    "copies": record.copies,
                    "error": record.error,
                    "createdAt": record.created_at.isoformat(),
                    "updatedAt": record.updated_at.isoformat(),
                })
            self._send_json(200, payload)
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?")[0].rstrip("/")
        if path == "/admin/api/login" or (path.startswith("/admin/api/") and path != "/admin/api/login"):
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(raw_body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                payload = {}
            if admin_routes.handle_admin_post(self, path, payload):
                return

        if path != "/api/v1/print-jobs":
            self._send_json(404, {"error": "not found"})
            return

        if not HTTP_BRIDGE_SECRET:
            log.warning("Rejected HTTP print request: HTTP_BRIDGE_SECRET is not configured")
            self._send_json(503, {"error": "the print bridge HTTP API is disabled (HTTP_BRIDGE_SECRET is not set)"})
            return
        if not self._authorized():
            self._send_json(401, {"error": "missing or invalid Authorization bearer token"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = -1
        if content_length <= 0:
            self._send_json(400, {"error": "missing or invalid Content-Length"})
            return
        if content_length > HTTP_MAX_BODY_BYTES:
            self._send_json(413, {"error": f"request body exceeds the {HTTP_MAX_BODY_BYTES}-byte limit"})
            return

        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "body is not valid JSON"})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "body must be a JSON object"})
            return

        images_field = payload.get("images")
        if not isinstance(images_field, list) or not images_field:
            self._send_json(400, {"error": "'images' must be a non-empty array"})
            return
        if len(images_field) > HTTP_MAX_IMAGES_PER_JOB:
            self._send_json(400, {"error": f"'images' exceeds the {HTTP_MAX_IMAGES_PER_JOB}-image limit per job"})
            return

        decoded_images: list[np.ndarray] = []
        color_flags: list[bool] = []
        for index, raw_value in enumerate(images_field):
            if not isinstance(raw_value, str) or not raw_value:
                self._send_json(400, {"error": f"images[{index}] must be a non-empty base64/data-URL string"})
                return
            try:
                array, is_color = _image_bytes_to_array(_decode_data_url_or_b64(raw_value))
            except Exception as exc:
                self._send_json(400, {"error": f"images[{index}] could not be decoded: {exc}"})
                return
            decoded_images.append(array)
            color_flags.append(is_color)

        try:
            copies = max(1, int(payload.get("copies", 1)))
        except (TypeError, ValueError):
            copies = 1
        copies = min(copies, HTTP_MAX_COPIES_PER_JOB)

        orientation_hint = str(payload.get("orientation", "PORTRAIT") or "PORTRAIT").strip().upper()
        if orientation_hint not in ("PORTRAIT", "LANDSCAPE"):
            orientation_hint = "PORTRAIT"

        max_rows = max_cols = None
        layout = payload.get("layout")
        if isinstance(layout, dict) and layout.get("rows") and layout.get("cols"):
            try:
                max_rows = max(1, int(layout["rows"]))
                max_cols = max(1, int(layout["cols"]))
            except (TypeError, ValueError):
                max_rows = max_cols = None

        try:
            header = _banner_override_from_json(payload["header"]) if payload.get("header") else None
            footer = _banner_override_from_json(payload["footer"]) if payload.get("footer") else None
        except Exception as exc:
            self._send_json(400, {"error": f"invalid header/footer: {exc}"})
            return

        # Optional patient identification, formatted exactly as on a DICOM
        # film. The caller owns the decision of whether these images all
        # belong to one patient - the bridge prints what it is given.
        patient_label = ""
        patient_field = payload.get("patient")
        erp_patient: Optional[PatientInfo] = None
        erp_modality = ""
        if isinstance(patient_field, dict):
            def _field(name: str) -> str:
                value = patient_field.get(name)
                return str(value).strip() if value not in (None, "") else ""

            erp_patient = PatientInfo(
                name=_field("name"),
                patient_id=_field("id"),
                study_date=_field("studyDate"),
                modality=_field("modality").upper(),
            )
            erp_modality = erp_patient.modality
            patient_label = erp_patient.label()

        # Unlike the DICOM path (where extra images past the grid are dropped -
        # a physical modality's button presses are inherently ambiguous about
        # whether they're "more of this patient" or "the next patient"), an
        # explicit HTTP request has no such ambiguity: the caller asked for
        # exactly these N images, so they spill onto additional pages instead.
        page_capacity = (max_rows * max_cols) if (max_rows and max_cols) else MAX_IMAGES_PER_PAGE
        page_groups = list(_chunk(decoded_images, page_capacity))
        color_flag_groups = list(_chunk(color_flags, page_capacity))

        job_id = payload.get("jobId")
        if not isinstance(job_id, str) or not job_id.strip():
            job_id = generate_uid()
        job_key = f"http:{job_id}"

        # Seeded here, synchronously, BEFORE submit - so a caller polling
        # GET /api/v1/print-jobs/{jobKey} the instant after this 202 response
        # always finds a record, even if both worker threads are still busy
        # with earlier jobs and process_print_job hasn't started yet.
        _mark_job_queued(job_key, pages=len(page_groups), images=len(decoded_images), copies=copies)

        # Optional per-frame captions and an optional page size, both aligned
        # with what a DICOM film gets.
        label_field = payload.get("labels")
        label_groups = None
        if isinstance(label_field, list):
            flat = [str(v).strip() if v not in (None, "") else "" for v in label_field]
            flat += [""] * max(0, len(decoded_images) - len(flat))
            label_groups = list(_chunk(flat[:len(decoded_images)], page_capacity))

        req_page_size = normalize_page_size(payload.get("pageSize"), PAGE_SIZE)

        _PRINT_EXECUTOR.submit(
            process_print_job, job_key, page_groups, color_flag_groups, copies, orientation_hint,
            header, footer, max_rows, max_cols, patient_label, label_groups, req_page_size,
            source="ERP", patient_info=erp_patient, modality=erp_modality,
        )

        log.info(
            "HTTP print job %s accepted: %d image(s) across %d page(s), %d cop%s",
            job_key, len(decoded_images), len(page_groups), copies, "y" if copies == 1 else "ies",
        )
        self._send_json(202, {
            "status": "accepted",
            "jobKey": job_key,
            "pages": len(page_groups),
            "images": len(decoded_images),
        })


def start_http_server() -> None:
    if not HTTP_BRIDGE_SECRET:
        log.warning(
            "HTTP_BRIDGE_SECRET is not set - the print-from-app HTTP API will listen on port %d "
            "but refuse every request. Set HTTP_BRIDGE_SECRET to let an ERP/integrator print through it.",
            HTTP_PORT,
        )
    httpd = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), _PrintBridgeHTTPHandler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, name="http-bridge", daemon=True).start()
    log.info(
        "HTTP print API listening on port %d (POST /api/v1/print-jobs, GET /api/v1/health)", HTTP_PORT
    )


# =============================================================================
# AE bootstrap / main
# =============================================================================

def build_ae() -> tuple[AE, list]:
    ae = AE(ae_title=AE_TITLE)

    for sop_class in (
        Verification,
        BasicGrayscalePrintManagementMeta,
        BasicColorPrintManagementMeta,
        BasicFilmSession,
        BasicFilmBox,
        BasicGrayscaleImageBox,
        BasicColorImageBox,
        Printer,
        PrintJob,
        PrinterConfigurationRetrieval,
    ):
        ae.add_supported_context(sop_class)

    if ALLOWED_CALLING_AETS:
        ae.require_calling_aet = ALLOWED_CALLING_AETS

    ae.maximum_pdu_size = 0  # unlimited; print images can be several MB each
    ae.network_timeout = 120
    ae.acse_timeout = 60
    ae.dimse_timeout = 90
    ae.maximum_associations = 8

    handlers = [
        (evt.EVT_ACCEPTED, handle_assoc_accepted),
        (evt.EVT_C_ECHO, handle_echo),
        (evt.EVT_N_CREATE, handle_create),
        (evt.EVT_N_SET, handle_set),
        (evt.EVT_N_ACTION, handle_action),
        (evt.EVT_N_DELETE, handle_delete),
        (evt.EVT_N_GET, handle_get),
    ]
    return ae, handlers


def _log_startup_banner() -> None:
    log.info("=" * 72)
    log.info("DICOM Print SCP  |  AE Title=%s  Port=%d", AE_TITLE, DICOM_PORT)
    if ALLOWED_CALLING_AETS:
        log.info("Accepting calling AE Titles: %s", ", ".join(ALLOWED_CALLING_AETS))
    else:
        log.info("Accepting associations from any calling AE Title")
    log.info(
        "Layout: max %dx%d images per page (%d) on %s %s @ %d DPI (auto-fit %s)",
        LAYOUT_ROWS, LAYOUT_COLS, MAX_IMAGES_PER_PAGE, PAGE_SIZE, PAGE_ORIENTATION, DPI,
        "ON" if AUTO_FIT_LAYOUT else "OFF",
    )
    if BATCH_GROUP_BY == "auto":
        log.info(
            "Batching: combining single-image print jobs (e.g. GE 'P1') by patient/AE title, "
            "printing a partial page after %ds idle", BATCH_IDLE_TIMEOUT_SECONDS,
        )
    else:
        log.info("Batching: OFF (BATCH_GROUP_BY=session) - each Film Box prints alone, immediately")
    log.info(
        "Calibration: %s (gamma=%.2f, percentiles=%.1f-%.1f)",
        "ON" if ENABLE_CALIBRATION else "OFF", GAMMA, CONTRAST_LOW_PCT, CONTRAST_HIGH_PCT,
    )
    has_header = bool(HEADER_LINE1 or HEADER_LINE2 or HEADER_LOGO_PATH)
    has_footer = bool(FOOTER_LINE1 or FOOTER_LINE2 or FOOTER_LOGO_PATH)
    log.info(
        "Letterhead: header=%s footer=%s patient-line=%s image-labels=%s",
        "ON" if has_header else "off", "ON" if has_footer else "off",
        "ON" if SHOW_PATIENT_BANNER else "off",
        "ON" if SHOW_IMAGE_LABELS else "off",
    )
    if ERP_BRANDING_URL:
        log.info(
            "Letterhead source: the ERP at %s (refreshed every %ds; the "
            "HEADER_*/FOOTER_* settings above are the fallback)",
            ERP_BRANDING_URL, ERP_BRANDING_REFRESH_SECONDS,
        )
    if PRINT_METHOD == "cups":
        log.info(
            "Media: %s (%.0fx%.0f mm), CUPS media name '%s'%s",
            PAGE_SIZE, *_PAGE_SIZES_MM[PAGE_SIZE], cups_media_for(PAGE_SIZE),
            "; SCU Film Size ID honoured" if HONOR_SCU_FILM_SIZE else "",
        )
    if MODALITY_LAYOUTS:
        log.info(
            "Per-modality layouts: %s",
            ", ".join(f"{name}={r}x{c}" for name, (r, c) in sorted(MODALITY_LAYOUTS.items())),
        )
    log.info("Print method: %s", PRINT_METHOD.upper())
    if PRINT_METHOD == "cups":
        log.info("  CUPS server=%s printer=%s", CUPS_SERVER, CUPS_PRINTER_NAME or "(not set!)")
    else:
        log.info("  JetDirect target=%s:%d", JETDIRECT_HOST or "(not set!)", JETDIRECT_PORT)
    log.info("Output directory: %s (%s, retained %d days)", OUTPUT_DIR, OUTPUT_FORMAT.upper(), JOB_RETENTION_DAYS)
    log.info(
        "HTTP print API: %s on port %d | Admin UI: http://<host>:%d/admin",
        "enabled" if HTTP_BRIDGE_SECRET else "listening but DISABLED (set HTTP_BRIDGE_SECRET to enable)",
        HTTP_PORT, HTTP_PORT,
    )
    log.info("Capture mode: %s | Preserve console layout: %s", CAPTURE_MODE, PRESERVE_CONSOLE_LAYOUT)
    log.info("=" * 72)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    Path(_config_store.CONFIG_DIR).mkdir(parents=True, exist_ok=True)
    _sync_bridge_runtime()
    admin_routes.init({
        **BRIDGE_RUNTIME,
        "check_printer_status": check_printer_status,
        "reload_live_config": reload_live_config,
        "version": "1.1.0",
        "pydicom_version": __import__("pydicom").__version__,
        "pynetdicom_version": __import__("pynetdicom").__version__,
        "numpy_version": np.__version__,
        "opencv_version": cv2.__version__,
        "pillow_version": Image.__version__,
    })
    _log_startup_banner()

    if PRINT_METHOD == "cups" and not CUPS_PRINTER_NAME:
        log.warning("CUPS_PRINTER_NAME is not set - printing will fail until a printer queue is configured")
    if PRINT_METHOD == "jetdirect" and not JETDIRECT_HOST:
        log.warning("JETDIRECT_HOST is not set - printing will fail until a target printer IP is configured")

    start_housekeeping_thread()
    start_batch_flush_thread()
    start_erp_branding_thread()
    start_http_server()

    ae, handlers = build_ae()
    try:
        ae.start_server(("0.0.0.0", DICOM_PORT), evt_handlers=handlers, block=True)
    except PermissionError:
        log.error(
            "Permission denied binding to port %d. Ports below 1024 need root inside "
            "the container (this image runs as root by default).", DICOM_PORT,
        )
        sys.exit(1)
    except OSError as exc:
        log.error("Could not start the DICOM listener on port %d: %s", DICOM_PORT, exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
