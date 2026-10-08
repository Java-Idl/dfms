"""DFMS Insecure Command Service v0 (Demonstration of Seeded Vulnerabilities)."""
import hashlib
import os

SECRET = "dfms-secret-123"                                   # (1) hard-coded secret (V-03 / B105)

def send_command(db, user, drone_id, cmd, params):
    # (2) SQL built by string formatting (V-01 / B608)
    row = db.execute("SELECT * FROM drones WHERE drone_id='%s'" % drone_id).fetchone()
    if not row:
        raise Exception("Drone %s not found in table drones" % drone_id)   # (3) verbose error (V-08)
    # (4) shell command built from user input; (5) no authorization check at all (V-02, V-05 / B605)
    os.system("dronectl %s %s %s" % (drone_id, cmd, params))
    # (6) weak, replayable "signature": MD5, no nonce, no timestamp (V-04 / B324)
    return {"cmd": cmd, "sig": hashlib.md5((SECRET + cmd).encode()).hexdigest()}
