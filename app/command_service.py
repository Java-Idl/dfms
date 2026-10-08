"""DFMS Command Service: validate, authorize, sign and verify drone commands."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass, field

log = logging.getLogger("dfms.command")

DRONE_ID_RE = re.compile(r"DRN-[A-Z0-9]{6}")
ALLOWED_COMMANDS = {"GOTO", "RTH", "LAND", "CANCEL"}
MAX_ALT_M = 120.0
MAX_AGE_S = 30

# Single source of truth for authorization (Refactoring R-2).
ROLE_PERMS = {
    "admin": {"drone:register", "user:manage", "audit:read", "mission:create",
              "mission:assign", "mission:cancel", "telemetry:read", "report:download"},
    "planner": {"mission:create", "mission:assign", "telemetry:read", "report:download"},
    "operator": {"mission:cancel", "telemetry:read", "report:download"},
    "auditor": {"audit:read", "report:download"},
}


class ValidationError(ValueError):
    """Client-supplied data is invalid (maps to HTTP 400)."""


class AuthorizationError(PermissionError):
    """Caller is not allowed (maps to HTTP 403)."""


@dataclass(frozen=True)
class User:
    user_id: str
    role: str
    fleet_ids: frozenset = field(default_factory=frozenset)


# ---------- input validation (SR-05) ----------
def validate_drone_id(value) -> str:
    if not isinstance(value, str) or not DRONE_ID_RE.fullmatch(value):   # fullmatch: no trailing "\n"
        raise ValidationError("invalid drone_id")
    return value


def validate_waypoint(lat, lon, alt) -> tuple[float, float, float]:
    if any(isinstance(v, bool) for v in (lat, lon, alt)):
        raise ValidationError("waypoint must be numeric")
    try:
        lat, lon, alt = float(lat), float(lon), float(alt)
    except (TypeError, ValueError):
        raise ValidationError("waypoint must be numeric") from None
    if not all(math.isfinite(v) for v in (lat, lon, alt)):
        raise ValidationError("waypoint must be finite")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= alt <= MAX_ALT_M):
        raise ValidationError("waypoint out of range")
    return lat, lon, alt


# ---------- authorization (SR-02) ----------
def authorize(user: User, permission: str, fleet_id: str | None = None) -> None:
    """Deny by default. Raises AuthorizationError."""
    if permission not in ROLE_PERMS.get(user.role, set()):
        raise AuthorizationError("forbidden")
    if fleet_id is not None and user.role not in ("admin", "auditor") and fleet_id not in user.fleet_ids:
        raise AuthorizationError("forbidden")


# ---------- signing / verification (SR-04, SR-10) ----------
def load_signing_key() -> bytes:
    raw = os.environ.get("DFMS_SIGNING_KEY")          # never hard-coded, never logged
    if not raw:
        raise RuntimeError("DFMS_SIGNING_KEY not configured")
    return bytes.fromhex(raw)


def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def sign(payload: dict, key: bytes | None = None) -> str:
    return hmac.new(key or load_signing_key(), _canonical(payload), hashlib.sha256).hexdigest()


def verify(payload: dict, signature, seen_nonces: set, key: bytes | None = None,
           now: float | None = None) -> bool:
    """Drone-side check: authentic, fresh, not replayed. Never raises on bad input."""
    if not isinstance(signature, str) or not isinstance(payload, dict):
        return False
    if not hmac.compare_digest(sign(payload, key), signature):      # constant-time compare
        return False
    now = time.time() if now is None else now
    ts = payload.get("ts")
    if not isinstance(ts, (int, float)) or abs(now - ts) > MAX_AGE_S:
        return False
    nonce = payload.get("nonce")
    if not isinstance(nonce, str) or nonce in seen_nonces:
        return False
    seen_nonces.add(nonce)
    return True


# ---------- command construction (UC-04, UC-08, UC-15) ----------
def build_command(db: sqlite3.Connection, user: User, drone_id, command, params=None,
                  seq: int = 0, now: float | None = None) -> dict:
    try:
        drone_id = validate_drone_id(drone_id)
        if command not in ALLOWED_COMMANDS:
            raise ValidationError("unsupported command")

        args: dict = {}
        if command == "GOTO":
            params = params if isinstance(params, dict) else {}
            lat, lon, alt = validate_waypoint(params.get("lat"), params.get("lon"), params.get("alt"))
            args = {"lat": lat, "lon": lon, "alt": alt}
        permission = "mission:assign" if command == "GOTO" else "mission:cancel"

        row = db.execute(
            "SELECT fleet_id, status FROM drones WHERE drone_id = ?", (drone_id,)   # parameterized
        ).fetchone()
        if row is None:
            raise AuthorizationError("forbidden")          # same answer as "not yours": no ID enumeration
        authorize(user, permission, fleet_id=row[0])

        payload = {
            "drone_id": drone_id,
            "command": command,
            "args": args,
            "nonce": secrets.token_hex(16),
            "ts": int(time.time() if now is None else now),
            "seq": seq,
        }
        signature = sign(payload)
        log.info("command_issued user=%s drone=%s cmd=%s nonce=%s",
                 user.user_id, drone_id, command, payload["nonce"])
        return {"payload": payload, "sig": signature}
    except AuthorizationError:
        log.warning("authz_denied user=%s drone=%r cmd=%r", user.user_id, drone_id, command)  # %r neutralises log injection
        raise
    except ValidationError:
        log.warning("validation_failed user=%s drone=%r cmd=%r", user.user_id, drone_id, command)
        raise
