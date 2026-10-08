# Secure Drone Fleet Management System (DFMS)

**Course:** 24CYS401 – Secure Software Engineering (End Semester Lab)  
**Problem Statement:** Problem 15 – Secure Drone Fleet Management System  
**Stack:** Python 3.12 (stdlib), SQLite / PostgreSQL, Docker, Minikube, GitHub Actions, Jira Scrum  

---

## 1. System Overview & Architecture
DFMS is a mission-critical cloud platform for registering drones, assigning flight paths, monitoring real-time telemetry, issuing cryptographically signed commands (GOTO, RTH, LAND, CANCEL), and detecting GPS/GNSS spoofing anomalies.

### Security Highlights
- **Mutual TLS (mTLS):** Drones authenticate via X.509 device certificates.
- **HMAC-SHA256 Signing & Freshness:** Every command includes a cryptographic signature, 128-bit nonce, monotonic sequence number, and timestamp (30-second expiry window to prevent replay attacks).
- **Fleet-Scoped Role-Based Access Control (RBAC):** Complete mediation and least-privilege enforcement across Admins, Planners, Operators, and Auditors.
- **Location Plausibility Engine:** Detects spoofed coordinates using kinematic velocity limits (> 60 m/s), altitude caps (120 m AGL), and geofence containment checks.
- **Container Hardening:** Non-root execution (UID 10001), read-only root filesystems, dropped capabilities (`ALL`), and strict Kubernetes Pod Security Admission (`restricted`).

---

## 2. Quickstart with uv

### Setup Environment
```bash
uv venv --python 3.12
.venv\Scripts\activate   # Windows PowerShell: .venv\Scripts\Activate.ps1
uv pip install -r requirements-dev.txt
```

### Run Tests and Coverage
```bash
uv run pytest -v --cov=app.command_service --cov-report=term-missing
```

### Run Security Static Analysis (Bandit)
```bash
uv run bandit -r app/command_service.py app/main.py -ll
```

### Run Input Boundary Fuzzer
```bash
uv run python fuzz/fuzz_validation.py
```

---

## 3. Container & Kubernetes Deployment

### Docker Build & Run (Hardened)
```bash
docker build -t dfms:1.0.0 .
docker run -d --name dfms --rm -p 8080:8080 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --cpus 0.5 \
  -e DFMS_SIGNING_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  -e DFMS_SEED=1 \
  -e DFMS_DEMO_TOKENS='{"tok-planner-1":{"id":"u1","role":"planner","fleets":["F1"]}}' \
  dfms:1.0.0
```

### Test Service Health & Commands
```bash
curl -s http://localhost:8080/healthz

curl -s -X POST http://localhost:8080/v1/commands \
  -H "Authorization: Bearer tok-planner-1" \
  -H "Content-Type: application/json" \
  -d '{"drone_id":"DRN-ABC123","command":"GOTO","params":{"lat":10.9027,"lon":76.9006,"alt":50}}'
```

### Deploy to Kubernetes / Minikube
```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl -n dfms create secret generic dfms-secrets \
  --from-literal=signing-key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  --from-literal=demo-tokens='{"tok-planner-1":{"id":"u1","role":"planner","fleets":["F1"]}}'
kubectl apply -f k8s/10-deployment.yaml -f k8s/20-service.yaml -f k8s/30-networkpolicy.yaml
```
