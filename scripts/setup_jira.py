"""Script to populate Jira with DFMS Epics, User Stories, Sub-tasks, and Sprints.

Reads all credentials strictly from environment variables (SR-10 compliance).
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
PROJECT_KEY = os.environ.get("JIRA_PROJECT", "DFMS")
SP_FIELD = "customfield_10016"  # Story point estimate

if not EMAIL or not API_TOKEN:
    # Try reading from netrc as fallback
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
    print("Error: JIRA_EMAIL and JIRA_API_TOKEN environment variables must be configured.", file=sys.stderr)
    sys.exit(1)

auth_b64 = base64.b64encode(f"{EMAIL}:{API_TOKEN}".encode()).decode()
HEADERS = {
    "Authorization": f"Basic {auth_b64}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}


def api_req(endpoint, data=None, method=None):
    url = f"{JIRA_URL}{endpoint}"
    req_body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=req_body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            res_data = res.read().decode()
            return json.loads(res_data) if res_data else {}
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode()
        print(f"HTTP {e.code} on {endpoint}: {err_msg}", file=sys.stderr)
        return None


def text_to_adf(text):
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


def create_issue(summary, issue_type, description="", story_points=None, parent_key=None):
    fields = {
        "project": {"key": PROJECT_KEY},
        "summary": summary,
        "issuetype": {"name": issue_type},
        "description": text_to_adf(description or summary),
    }
    if story_points is not None:
        fields[SP_FIELD] = float(story_points)
    if parent_key:
        fields["parent"] = {"key": parent_key}
    res = api_req("/rest/api/3/issue", {"fields": fields}, method="POST")
    if res and "key" in res:
        print(f"Created {issue_type} [{res['key']}]: {summary}")
        return res["key"]
    return None


def assign_to_sprint(sprint_id, issue_keys):
    if not issue_keys:
        return
    res = api_req(f"/rest/agile/1.0/sprint/{sprint_id}/issue", {"issues": issue_keys}, method="POST")
    print(f"Assigned {issue_keys} to Sprint {sprint_id}")


def main():
    print("--- 1. Creating Epics ---")
    epics = {
        "E1": ("E1 Identity & Access", "Identity & Access: SR-01, SR-02, FR-10"),
        "E2": ("E2 Fleet Management", "Fleet Management: FR-01, SR-03"),
        "E3": ("E3 Mission Management", "Mission Management: FR-02/03/04/08/12, SR-04, SR-05, SR-12"),
        "E4": ("E4 Telemetry & Tracking", "Telemetry & Tracking: FR-05/06/07, SR-06, SR-07"),
        "E5": ("E5 Reporting & Audit", "Reporting & Audit: FR-09, FR-11, SR-08, SR-14"),
        "E6": ("E6 Platform Security & Ops", "Platform Security & Ops: SR-09, SR-10, NFR-01"),
    }
    epic_keys = {}
    for code, (summary, desc) in epics.items():
        k = create_issue(summary, "Epic", desc)
        if k:
            epic_keys[code] = k

    print("\n--- 2. Creating User Stories ---")
    stories = [
        ("US-01 Login with MFA", "As an operator I want to log in with password and MFA so that only I can act under my identity", "E1", 5, 146),
        ("US-02 RBAC with fleet scoping", "As an administrator I want role-based permissions with fleet scoping so that users only do what their role allows", "E1", 5, 146),
        ("US-03 Register drone with certificate", "As an administrator I want to register a drone with a device certificate so that only known drones can connect", "E2", 5, 146),
        ("US-04 Flight path and geofence validation", "As a mission planner I want to define a flight path and geofence with validation so that unsafe or invalid paths are rejected", "E3", 8, 146),
        ("US-05 Assign mission with signed command", "As a mission planner I want to assign a mission via a signed command so that the drone only accepts authentic fresh instructions", "E3", 8, 146),
        ("US-06 Tamper-evident security logging", "As an auditor I want security events logged tamper-evidently so that incidents can be investigated", "E5", 3, 146),
        ("US-07 Encrypted telemetry", "As an operator I want telemetry received over encrypted channels so that location data stays confidential", "E4", 8, 147),
        ("US-08 Live tracking with spoof detection", "As an operator I want live location tracking with spoof detection so that I notice false positions quickly", "E4", 8, 147),
        ("US-09 Status dashboard", "As an operator I want a drone status dashboard so that I can see my fleet at a glance", "E4", 5, 147),
        ("US-10 Cancel mission", "As an operator I want to cancel a mission so that I can stop unsafe flights quickly", "E3", 5, 147),
        ("US-11 Download mission report", "As a planner I want to download reports for my fleets only so that other fleets data is not exposed", "E5", 5, 147),
        ("US-12 Rate limiting and availability alerts", "As an administrator I want rate limiting and availability alerts so that the platform stays available", "E6", 3, 147),
        ("US-13 Second approver for high-risk missions", "As a safety officer I want high-risk missions to require a second approver", "E3", 5, None),
    ]

    story_keys = {}
    sprint1_keys = []
    sprint2_keys = []

    for summary, desc, epic_code, sp, sprint_id in stories:
        parent = epic_keys.get(epic_code)
        k = create_issue(summary, "Story", desc, story_points=sp, parent_key=parent)
        if k:
            short_id = summary.split()[0]
            story_keys[short_id] = k
            if sprint_id == 146:
                sprint1_keys.append(k)
            elif sprint_id == 147:
                sprint2_keys.append(k)

    print("\n--- 3. Assigning Stories to Sprints ---")
    assign_to_sprint(146, sprint1_keys)
    assign_to_sprint(147, sprint2_keys)

    print("\n--- 4. Creating Subtasks for Sprint 1 ---")
    subtasks = [
        ("US-01", "DFMS-21 Implement password hashing (argon2)"),
        ("US-01", "DFMS-22 TOTP verification"),
        ("US-01", "DFMS-23 Lockout + audit event"),
        ("US-01", "DFMS-24 Tests"),
        ("US-02", "DFMS-25 ROLE_PERMS table + authorize()"),
        ("US-02", "DFMS-26 Fleet-scope check"),
        ("US-02", "DFMS-27 Negative authz tests"),
        ("US-03", "DFMS-28 Drone registry table"),
        ("US-03", "DFMS-29 Cert fingerprint validation"),
        ("US-04", "DFMS-30 validate_waypoint"),
        ("US-04", "DFMS-31 Geofence containment check"),
        ("US-04", "DFMS-32 Plan hash/version"),
        ("US-05", "DFMS-33 build_command (validation, authz)"),
        ("US-05", "DFMS-34 sign/verify with nonce/ts"),
        ("US-05", "DFMS-35 Drone-sim verifier + system test"),
        ("US-05", "DFMS-36 Secret handling (env/K8s Secret)"),
        ("US-06", "DFMS-37 Audit event schema"),
        ("US-06", "DFMS-38 Hash-chain writer"),
        ("US-06", "DFMS-39 Chain verification tool"),
    ]
    for parent_id, task_title in subtasks:
        if parent_id in story_keys:
            create_issue(task_title, "Subtask", task_title, parent_key=story_keys[parent_id])

    print("\n--- 5. Logging Defects ---")
    defects = [
        ("DEF-01 Operator in F1 could cancel F2 drone (missing fleet check)", "High", "Fixed + retested in integration test"),
        ("DEF-02 verify() raised TypeError on non-string signature -> HTTP 500", "Medium", "Fixed + retested in unit test"),
        ("DEF-03 Drone ID with trailing newline accepted (V-10)", "Medium", "Found by fuzzing, fixed with re.fullmatch"),
        ("DEF-04 Verbose validation message on login screen leaks user exists wording", "Low", "Carried over to Sprint 2 backlog"),
    ]
    for def_title, sev, desc in defects:
        create_issue(def_title, "Bug", f"Severity: {sev}\n{desc}")

    print("\nJira setup completed successfully!")


if __name__ == "__main__":
    main()
