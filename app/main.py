"""Minimal HTTP wrapper around the Command Service (lab deployment)."""
import hmac
import json
import logging
import os
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.command_service import (AuthorizationError, User, ValidationError,
                                 build_command, load_signing_key)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("dfms.api")
MAX_BODY = 4096
LOCK = threading.Lock()


def _init_db() -> sqlite3.Connection:
    db = sqlite3.connect(os.environ.get("DFMS_DB", ":memory:"), check_same_thread=False)
    db.execute("CREATE TABLE IF NOT EXISTS drones (drone_id TEXT PRIMARY KEY, "
               "fleet_id TEXT NOT NULL, status TEXT NOT NULL)")
    if os.environ.get("DFMS_SEED") == "1":
        db.execute("INSERT OR IGNORE INTO drones VALUES ('DRN-ABC123','F1','IDLE')")
        db.execute("INSERT OR IGNORE INTO drones VALUES ('DRN-XYZ789','F2','IDLE')")
    db.commit()
    return db


def _load_tokens() -> dict:
    raw = os.environ.get("DFMS_DEMO_TOKENS", "{}")
    tokens = {}
    try:
        tokens = json.loads(raw)
    except Exception:
        import ast
        try:
            val = ast.literal_eval(raw)
            tokens = val if isinstance(val, dict) else {}
        except Exception:
            tokens = {}
    if not tokens and os.environ.get("DFMS_SEED") == "1":
        tokens = {
            "tok-planner-1": {"id": "u1", "role": "planner", "fleets": ["F1"]},
            "tok-operator-1": {"id": "u2", "role": "operator", "fleets": ["F1"]},
            "tok-operator-2": {"id": "u3", "role": "operator", "fleets": ["F2"]},
            "tok-admin": {"id": "admin", "role": "admin", "fleets": ["F1", "F2"]},
        }
    return tokens


DB = _init_db()
TOKENS = _load_tokens()


def _user_from(header):
    if not header or not header.startswith("Bearer "):
        return None
    presented = header[7:].encode()
    for token, info in TOKENS.items():
        if hmac.compare_digest(token.encode(), presented):
            return User(info["id"], info["role"], frozenset(info.get("fleets", [])))
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "dfms"
    sys_version = ""

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, {"status": "ok"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/commands":
            return self._send(404, {"error": "not found"})
        user = _user_from(self.headers.get("Authorization"))
        if user is None:
            return self._send(401, {"error": "unauthenticated"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, {"error": "invalid request"})
        if not 0 < length <= MAX_BODY:
            return self._send(413, {"error": "invalid size"})
        try:
            body = json.loads(self.rfile.read(length))
            with LOCK:
                result = build_command(DB, user, body.get("drone_id"), body.get("command"), body.get("params"))
            return self._send(200, result)
        except ValidationError:
            return self._send(400, {"error": "invalid request"})
        except AuthorizationError:
            return self._send(403, {"error": "forbidden"})
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
            return self._send(400, {"error": "invalid request"})
        except Exception:                      # detail stays server-side (SR-13)
            log.exception("unhandled error")
            return self._send(500, {"error": "internal error"})

    def log_message(self, fmt, *args):
        log.info("http " + fmt, *args)


if __name__ == "__main__":
    load_signing_key()                         # fail closed at startup if key missing
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()  # nosec: B104
