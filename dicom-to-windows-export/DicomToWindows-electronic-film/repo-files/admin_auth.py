"""Lightweight admin authentication for the local Admin UI."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from typing import Optional

import config_store

_LOCK = threading.RLock()
_SESSIONS: dict[str, float] = {}
_LOGIN_ATTEMPTS: dict[str, list[float]] = {}
_SESSION_TTL_SECONDS = 8 * 3600
_MAX_LOGIN_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300
_CSRF_TOKENS: dict[str, str] = {}


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored or not password:
        return False
    try:
        algo, salt, digest_hex = stored.split("$", 2)
        if algo != "pbkdf2_sha256":
            return False
        check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()
        return hmac.compare_digest(check, digest_hex)
    except ValueError:
        return False


def set_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    hashed = _hash_password(password)
    config_store.update({"ADMIN_PASSWORD_HASH": hashed})
    return hashed


def _rate_limited(client_id: str) -> bool:
    now = time.time()
    with _LOCK:
        attempts = _LOGIN_ATTEMPTS.get(client_id, [])
        attempts = [t for t in attempts if now - t < _LOGIN_WINDOW_SECONDS]
        _LOGIN_ATTEMPTS[client_id] = attempts
        return len(attempts) >= _MAX_LOGIN_ATTEMPTS


def _record_attempt(client_id: str) -> None:
    with _LOCK:
        _LOGIN_ATTEMPTS.setdefault(client_id, []).append(time.time())


def login(username: str, password: str, client_id: str = "default") -> Optional[str]:
    if _rate_limited(client_id):
        return None
    expected_user = str(config_store.get("ADMIN_USERNAME") or "admin")
    stored_hash = str(config_store.get("ADMIN_PASSWORD_HASH") or "")
    if username != expected_user:
        _record_attempt(client_id)
        return None
    if not stored_hash:
        # First-time bootstrap: accept any password >= 8 chars and persist hash
        if len(password) < 8:
            _record_attempt(client_id)
            return None
        set_password(password)
        stored_hash = str(config_store.get("ADMIN_PASSWORD_HASH"))
    if not verify_password(password, stored_hash):
        _record_attempt(client_id)
        return None
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    with _LOCK:
        _SESSIONS[token] = time.time()
        _CSRF_TOKENS[token] = csrf
    return token


def logout(token: str) -> None:
    with _LOCK:
        _SESSIONS.pop(token, None)
        _CSRF_TOKENS.pop(token, None)


def validate_session(token: str) -> bool:
    if not token:
        return False
    now = time.time()
    with _LOCK:
        created = _SESSIONS.get(token)
        if created is None:
            return False
        if now - created > _SESSION_TTL_SECONDS:
            _SESSIONS.pop(token, None)
            _CSRF_TOKENS.pop(token, None)
            return False
        return True


def get_csrf(token: str) -> str:
    with _LOCK:
        return _CSRF_TOKENS.get(token, "")


def validate_csrf(token: str, csrf: str) -> bool:
    if not token or not csrf:
        return False
    with _LOCK:
        expected = _CSRF_TOKENS.get(token, "")
        return bool(expected) and hmac.compare_digest(expected, csrf)
