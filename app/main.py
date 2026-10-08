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


STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "static"))
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


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
            "tok-auditor": {"id": "u4", "role": "auditor", "fleets": []},
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

    def _serve_file(self, file_path: str, content_type: str):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)
        except OSError:
            self._send(404, {"error": "file not found"})

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, {"status": "ok"})
        if self.path in ("/", "/index.html"):
            index_path = os.path.join(STATIC_DIR, "index.html")
            return self._serve_file(index_path, "text/html; charset=utf-8")
        if self.path.startswith("/static/"):
            rel_path = self.path[len("/static/"):].split("?")[0].lstrip("/")
            safe_path = os.path.abspath(os.path.join(STATIC_DIR, rel_path))
            if safe_path.startswith(STATIC_DIR) and os.path.isfile(safe_path):
                ext = os.path.splitext(safe_path)[1].lower()
                mime = MIME_TYPES.get(ext, "application/octet-stream")
                return self._serve_file(safe_path, mime)
            return self._send(404, {"error": "static file not found"})
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
    port = int(os.environ.get("PORT", "8080"))
    log.info("Starting DFMS server on port %d", port)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()  # nosec B104
