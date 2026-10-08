"""Script to manage Jira Sprints (start, complete, view burndown & velocity metrics).

All credentials are read from environment variables or ~/.netrc (SR-10 compliant).
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

JIRA_URL = os.environ.get("JIRA_URL", "https://javagar.atlassian.net")
EMAIL = os.environ.get("JIRA_EMAIL")
API_TOKEN = os.environ.get("JIRA_API_TOKEN")

if not EMAIL or not API_TOKEN:
    try:
        import netrc
        netrc_file = os.path.expanduser("~/.netrc")
        if not os.path.exists(netrc_file):
            netrc_file = os.path.expanduser("~/_netrc")
        if os.path.exists(netrc_file):
            auth_info = netrc.netrc(netrc_file).authenticators("javagar.atlassian.net")
            if auth_info:
                EMAIL = EMAIL or auth_info[0]
                API_TOKEN = API_TOKEN or auth_info[2]
    except Exception:
        pass

if not EMAIL or not API_TOKEN:
    print("Error: JIRA_EMAIL and JIRA_API_TOKEN environment variables or ~/.netrc required.", file=sys.stderr)
    sys.exit(1)

auth_b64 = base64.b64encode(f"{EMAIL}:{API_TOKEN}".encode()).decode()
HEADERS = {
    "Authorization": f"Basic {auth_b64}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def api_call(endpoint, data=None, method="GET"):
    url = f"{JIRA_URL}{endpoint}"
    req_body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=req_body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            res_data = res.read().decode()
            return json.loads(res_data) if res_data else {}
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {endpoint}: {e.read().decode()}", file=sys.stderr)
        return None


def list_sprints(board_id=135):
    res = api_call(f"/rest/agile/1.0/board/{board_id}/sprint")
    if res and "values" in res:
        print(f"{'ID':<6} {'NAME':<16} {'STATE':<10} {'START DATE':<24} {'END DATE':<24}")
        print("-" * 80)
        for s in res["values"]:
            print(f"{s['id']:<6} {s['name']:<16} {s['state']:<10} {s.get('startDate',''):<24} {s.get('endDate',''):<24}")
    return res


def start_sprint_2(sprint_id=147):
    payload = {
        "name": "DFMS Sprint 2",
        "startDate": "2026-10-08T09:00:00.000Z",
        "endDate": "2026-10-21T18:00:00.000Z",
        "goal": "An operator can securely monitor drones (encrypted telemetry, spoof detection), cancel a mission within 3 s, and download fleet-scoped reports, while the platform withstands basic overload.",
        "state": "active",
    }
    res = api_call(f"/rest/agile/1.0/sprint/{sprint_id}", payload, method="PUT")
    if res:
        print(f"Sprint 2 ({sprint_id}) started successfully: {res.get('state')}")
    return res


def print_burndown_summary():
    print("""
================================================================================
                    SPRINT 1 BURNDOWN & VELOCITY REPORT
================================================================================
Committed:        34 Story Points (US-01 to US-06)
Completed:        31 Story Points (US-01: 5, US-02: 5, US-03: 5, US-04: 8, US-05: 8)
Carried Over:      3 Story Points (US-06, in TESTING)
Velocity Ratio:   91% (31/34 pts)

Day-by-Day Slanted Burndown Timeline:
Day  0 (Sep 24): 34 pts remaining (Sprint Planning, Day 0 baseline)
Day  1 (Sep 25): 34 pts remaining (Architecture baseline, TDD setup)
Day  2 (Sep 26): 29 pts remaining (US-01 Login with MFA completed, -5 pts)
Day  3 (Sep 27): 29 pts remaining (RBAC & fleet scope development)
Day  4 (Sep 28): 24 pts remaining (US-02 RBAC with fleet scope completed, -5 pts)
Day  5 (Sep 29): 24 pts remaining (Drone registry & cert validation)
Day  6 (Sep 30): 19 pts remaining (US-03 Drone Registration completed, -5 pts)
Day  7 (Oct 01): 11 pts remaining (US-04 Flight path validation completed, -8 pts)
Day  8 (Oct 02): 11 pts remaining (Command signing, nonce/ts, replay tests)
Day  9 (Oct 03):  3 pts remaining (US-05 Signed Commands completed, -8 pts)
Day 10 (Oct 07):  3 pts remaining (US-06 in TESTING, carried over to Sprint 2)
================================================================================
""")


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action == "status":
        list_sprints()
    elif action == "start-sprint-2":
        start_sprint_2()
    elif action == "report":
        print_burndown_summary()
    else:
        print("Usage: python manage_sprints.py [status|start-sprint-2|report]")


if __name__ == "__main__":
    main()
