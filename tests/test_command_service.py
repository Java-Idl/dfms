import sqlite3
import time

import pytest

from app import command_service as cs

KEY_HEX = "11" * 32


@pytest.fixture(autouse=True)
def signing_key(monkeypatch):
    monkeypatch.setenv("DFMS_SIGNING_KEY", KEY_HEX)


@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE drones (drone_id TEXT PRIMARY KEY, fleet_id TEXT NOT NULL, status TEXT NOT NULL)")
    conn.execute("INSERT INTO drones VALUES ('DRN-ABC123','F1','IDLE')")
    conn.execute("INSERT INTO drones VALUES ('DRN-XYZ789','F2','IDLE')")
    yield conn
    conn.close()


PLANNER_F1 = cs.User("u1", "planner", frozenset({"F1"}))
OPERATOR_F1 = cs.User("u2", "operator", frozenset({"F1"}))
OPERATOR_F2 = cs.User("u3", "operator", frozenset({"F2"}))
AUDITOR = cs.User("u4", "auditor", frozenset())


# ---------------- UNIT TESTS: validation module ----------------
def test_waypoint_valid():
    assert cs.validate_waypoint(10.9027, 76.9006, 50) == (10.9027, 76.9006, 50.0)


@pytest.mark.parametrize("lat,lon,alt", [
    (91, 0, 10), (-91, 0, 10), (0, 181, 10), (0, 0, -1), (0, 0, 121),
    ("nan", 0, 10), ("inf", 0, 10), (None, 0, 10), ("abc", 0, 10), (True, 0, 10),
])
def test_waypoint_rejects_invalid(lat, lon, alt):
    with pytest.raises(cs.ValidationError):
        cs.validate_waypoint(lat, lon, alt)


@pytest.mark.parametrize("bad", [
    "DRN-ABC123\n", "drn-abc123", "DRN-ABC12", "DRN-ABC1234", "DRN-ABC123; rm -rf /",
    "DRN-ABC123' OR '1'='1", "", None, 5,
])
def test_drone_id_rejects_invalid(bad):
    with pytest.raises(cs.ValidationError):
        cs.validate_drone_id(bad)


# ---------------- UNIT TESTS: authorization module ----------------
def test_authorize_role_allows_and_denies():
    cs.authorize(PLANNER_F1, "mission:assign", "F1")
    with pytest.raises(cs.AuthorizationError):
        cs.authorize(OPERATOR_F1, "mission:assign", "F1")       # role lacks permission
    with pytest.raises(cs.AuthorizationError):
        cs.authorize(PLANNER_F1, "mission:assign", "F2")        # wrong fleet
    with pytest.raises(cs.AuthorizationError):
        cs.authorize(AUDITOR, "mission:cancel", "F1")


def test_authorize_unknown_role_denied():
    with pytest.raises(cs.AuthorizationError):
        cs.authorize(cs.User("x", "hacker"), "mission:cancel")


# ---------------- UNIT TESTS: signing module ----------------
def test_sign_verify_roundtrip():
    now = 1_700_000_000
    p = {"drone_id": "DRN-ABC123", "command": "RTH", "args": {}, "nonce": "n1", "ts": now, "seq": 1}
    assert cs.verify(p, cs.sign(p), set(), now=now) is True


def test_verify_rejects_tamper_expiry_replay_and_garbage():
    now = 1_700_000_000
    p = {"drone_id": "DRN-ABC123", "command": "RTH", "args": {}, "nonce": "n2", "ts": now, "seq": 1}
    sig = cs.sign(p)
    tampered = dict(p, command="GOTO")
    assert cs.verify(tampered, sig, set(), now=now) is False          # tamper
    assert cs.verify(p, sig, set(), now=now + 31) is False            # expired
    seen = set()
    assert cs.verify(p, sig, seen, now=now) is True
    assert cs.verify(p, sig, seen, now=now) is False                  # replay
    assert cs.verify(p, 12345, set(), now=now) is False               # DEF-02: non-string signature


# ---------------- INTEGRATION TEST: validation + authz + DB + signing ----------------
def test_integration_build_command_end_to_end_in_service(db):
    cmd = cs.build_command(db, PLANNER_F1, "DRN-ABC123", "GOTO", {"lat": 10.9, "lon": 76.9, "alt": 50})
    assert cs.verify(cmd["payload"], cmd["sig"], set()) is True
    assert cmd["payload"]["args"]["alt"] == 50.0


def test_integration_cross_fleet_and_unknown_drone_denied_identically(db):
    with pytest.raises(cs.AuthorizationError):
        cs.build_command(db, OPERATOR_F1, "DRN-XYZ789", "CANCEL")     # DEF-01 regression
    with pytest.raises(cs.AuthorizationError):
        cs.build_command(db, OPERATOR_F1, "DRN-NOPE00", "CANCEL")     # no enumeration


def test_integration_sql_injection_rejected(db):
    with pytest.raises(cs.ValidationError):
        cs.build_command(db, OPERATOR_F1, "DRN-ABC123' OR '1'='1", "CANCEL")
    assert db.execute("SELECT COUNT(*) FROM drones").fetchone()[0] == 2


# ---------------- SYSTEM / E2E VALIDATION TEST ----------------
class DroneSim:
    """Stand-in for the drone: verifies signature, freshness, replay; then executes."""
    def __init__(self):
        self.seen = set()
        self.state = "IDLE"

    def receive(self, cmd):
        if not cs.verify(cmd["payload"], cmd["sig"], self.seen):
            return "REJECTED"
        self.state = {"GOTO": "IN_MISSION", "RTH": "RTH", "CANCEL": "RTH", "LAND": "LANDING"}[cmd["payload"]["command"]]
        return "ACK"


def test_system_mission_lifecycle(db):
    drone = DroneSim()
    # planner assigns mission
    assign = cs.build_command(db, PLANNER_F1, "DRN-ABC123", "GOTO", {"lat": 10.9, "lon": 76.9, "alt": 60}, seq=1)
    assert drone.receive(assign) == "ACK" and drone.state == "IN_MISSION"
    # attacker replays captured command
    assert drone.receive(assign) == "REJECTED"
    # attacker modifies command in transit
    forged = {"payload": dict(assign["payload"], args={"lat": 0, "lon": 0, "alt": 100}), "sig": assign["sig"]}
    assert drone.receive(forged) == "REJECTED"
    # operator of another fleet cannot cancel
    with pytest.raises(cs.AuthorizationError):
        cs.build_command(db, OPERATOR_F2, "DRN-ABC123", "CANCEL", seq=2)
    # legitimate operator cancels
    cancel = cs.build_command(db, OPERATOR_F1, "DRN-ABC123", "CANCEL", seq=2)
    assert drone.receive(cancel) == "ACK" and drone.state == "RTH"
