/**
 * DFMS — Tactical C2 Platform & Security Demonstration Engine
 */

// Application State
const state = {
  activeTab: 'mission-control',
  token: 'tok-operator-1',
  selectedDrone: 'DRN-ABC123',
  drones: {
    'DRN-ABC123': {
      id: 'DRN-ABC123',
      fleet: 'F1',
      status: 'IN_MISSION',
      lat: 10.9027,
      lon: 76.9006,
      alt: 52.4,
      speed: 9.2,
      battery: 78,
      heading: 42,
      anomaly: false
    },
    'DRN-XYZ789': {
      id: 'DRN-XYZ789',
      fleet: 'F2',
      status: 'IDLE',
      lat: 10.9150,
      lon: 76.8920,
      alt: 0.0,
      speed: 0.0,
      battery: 95,
      heading: 0,
      anomaly: false
    }
  },
  geofence: {
    centerLat: 10.9027,
    centerLon: 76.9006,
    radiusMeters: 600,
    maxAlt: 120.0
  },
  waypoints: [
    { lat: 10.9027, lon: 76.9006, alt: 40.0 },
    { lat: 10.9055, lon: 76.9035, alt: 55.0 },
    { lat: 10.9040, lon: 76.9060, alt: 50.0 },
    { lat: 10.9015, lon: 76.9020, alt: 35.0 }
  ],
  auditChain: [],
  radarAngle: 0,
  capturedNonce: null
};

// UI Initialization
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCanvas();
  initEventListeners();
  initAuditLog();
  startTelemetryLoop();
});

// Tab Switching
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      state.activeTab = tabId;
      const panel = document.getElementById(`tab-${tabId}`);
      if (panel) panel.style.display = 'block';
    });
  });
}

// Event Listeners
function initEventListeners() {
  // Role selector
  const roleSelect = document.getElementById('userRoleSelect');
  roleSelect.addEventListener('change', (e) => {
    state.token = e.target.value;
    showToast(`Active token changed: ${state.token}`, 'info');
    logAuditClient(getActorFromToken(state.token), 'token_switched', 'IAM_SESSION', `Switched active credential to ${state.token}`);
  });

  // Drone selector
  const droneSelect = document.getElementById('droneSelector');
  droneSelect.addEventListener('change', (e) => {
    state.selectedDrone = e.target.value;
    updateTelemetryUI();
  });

  // Command buttons
  document.getElementById('btnCancelMission').addEventListener('click', () => openCommandModal('CANCEL'));
  document.getElementById('btnRTH').addEventListener('click', () => openCommandModal('RTH'));
  document.getElementById('btnLandNow').addEventListener('click', () => openCommandModal('LAND'));

  // Modal actions
  document.getElementById('btnModalClose').addEventListener('click', closeCommandModal);
  document.getElementById('btnModalCancel').addEventListener('click', closeCommandModal);

  // Anomaly banner dismiss
  document.getElementById('btnDismissAlert').addEventListener('click', () => {
    const d = state.drones[state.selectedDrone];
    if (d) {
      d.anomaly = false;
      d.speed = 9.2;
    }
    document.getElementById('anomalyBanner').classList.remove('active');
    showToast('Anomaly acknowledged and cleared by operator.', 'info');
  });

  // Flight plan validation
  document.getElementById('btnValidatePlan').addEventListener('click', validateFlightPlan);
  document.getElementById('btnAssignMission').addEventListener('click', assignMissionPlan);

  // Drone registration form
  document.getElementById('formRegisterDrone').addEventListener('submit', handleDroneRegistration);

  // Report download
  document.getElementById('btnDownloadReport').addEventListener('click', downloadMissionReport);

  // Security lab buttons
  document.getElementById('btnSimSpoof').addEventListener('click', simGpsSpoof);
  document.getElementById('btnSimMod').addEventListener('click', simTransitTamper);
  document.getElementById('btnSimInjection').addEventListener('click', simCommandInjection);
  document.getElementById('btnSimImpersonate').addEventListener('click', simCrossFleetIDOR);
  document.getElementById('btnSimReplay').addEventListener('click', simReplayAttack);
  document.getElementById('btnInspectTls').addEventListener('click', inspectMtls);
  document.getElementById('btnSimFlood').addEventListener('click', simFloodTest);
}

// Tactical Radar Canvas
function initCanvas() {
  const canvas = document.getElementById('tacticalCanvas');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function drawRadar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxRadius = Math.min(cx, cy) * 0.88;

    // Concentric range rings
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let r = 0.25; r <= 1.0; r += 0.25) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - maxRadius, cy);
    ctx.lineTo(cx + maxRadius, cy);
    ctx.moveTo(cx, cy - maxRadius);
    ctx.lineTo(cx, cy + maxRadius);
    ctx.stroke();

    // Rotating sweep line
    state.radarAngle += 0.02;
    const sweepX = cx + Math.cos(state.radarAngle) * maxRadius;
    const sweepY = cy + Math.sin(state.radarAngle) * maxRadius;
    const grad = ctx.createLinearGradient(cx, cy, sweepX, sweepY);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0.35)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sweepX, sweepY);
    ctx.stroke();

    // Geofence Circle
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Flight Path Waypoints
    const wpCoords = [
      { x: cx - 40, y: cy + 30 },
      { x: cx + 50, y: cy - 70 },
      { x: cx + 110, y: cy + 10 },
      { x: cx + 20, y: cy + 80 }
    ];

    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    wpCoords.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.stroke();

    wpCoords.forEach((pt, i) => {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`WP${i + 1}`, pt.x + 6, pt.y - 4);
    });

    // Active Drone Position
    const curDrone = state.drones[state.selectedDrone] || state.drones['DRN-ABC123'];
    const droneX = cx + Math.cos(state.radarAngle * 0.4) * 60;
    const droneY = cy + Math.sin(state.radarAngle * 0.4) * 45;

    // Glowing Drone Marker
    ctx.fillStyle = curDrone.anomaly ? '#ef4444' : '#00f0ff';
    ctx.beginPath();
    ctx.arc(droneX, droneY, curDrone.anomaly ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();

    // Drone Ring / Ping
    ctx.strokeStyle = curDrone.anomaly ? 'rgba(239, 68, 68, 0.6)' : 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(droneX, droneY, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Drone Label
    ctx.fillStyle = curDrone.anomaly ? '#ef4444' : '#f1f5f9';
    ctx.font = '11px "JetBrains Mono"';
    ctx.fillText(`${curDrone.id} [${curDrone.status}]`, droneX + 16, droneY - 2);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillText(`ALT: ${curDrone.alt.toFixed(1)}m | SPD: ${curDrone.speed.toFixed(1)}m/s`, droneX + 16, droneY + 10);

    requestAnimationFrame(drawRadar);
  }
  drawRadar();
}

// Telemetry Loop
function startTelemetryLoop() {
  setInterval(() => {
    const curDrone = state.drones[state.selectedDrone];
    if (curDrone && curDrone.status === 'IN_MISSION') {
      // Simulate subtle realistic telemetry fluctuations
      if (!curDrone.anomaly) {
        curDrone.alt = Math.min(120, Math.max(10, curDrone.alt + (Math.random() * 0.6 - 0.3)));
        curDrone.speed = Math.min(25, Math.max(5, curDrone.speed + (Math.random() * 0.4 - 0.2)));
        curDrone.battery = Math.max(10, curDrone.battery - 0.02);
      }
      updateTelemetryUI();
    }
  }, 1000);
}

function updateTelemetryUI() {
  const d = state.drones[state.selectedDrone];
  if (!d) return;

  document.getElementById('telemetryAlt').innerHTML = `${d.alt.toFixed(1)} <small>m</small>`;
  document.getElementById('telemetrySpeed').innerHTML = `${d.speed.toFixed(1)} <small>m/s</small>`;
  document.getElementById('telemetryBattery').innerHTML = `${Math.round(d.battery)} <small>%</small>`;
  document.getElementById('telemetryHeading').innerHTML = `${String(d.heading).padStart(3, '0')}° <small>NE</small>`;

  const altBar = document.getElementById('altBar');
  const altPct = Math.min(100, (d.alt / 120) * 100);
  altBar.style.width = `${altPct}%`;
  altBar.className = d.alt > 110 ? 'gauge-bar-fill warning' : 'gauge-bar-fill';

  const speedBar = document.getElementById('speedBar');
  const speedPct = Math.min(100, (d.speed / 60) * 100);
  speedBar.style.width = `${speedPct}%`;
  speedBar.className = d.speed > 55 ? 'gauge-bar-fill warning' : 'gauge-bar-fill';

  const badge = document.getElementById('droneBadgeStatus');
  badge.textContent = d.status;
  badge.className = 'badge';
  if (d.status === 'IN_MISSION') badge.classList.add('badge-mission');
  else if (d.status === 'RTH') badge.classList.add('badge-rth');
  else if (d.status === 'LANDING') badge.classList.add('badge-landing');
  else badge.classList.add('badge-idle');

  // Trigger Anomaly Banner if flagged
  const banner = document.getElementById('anomalyBanner');
  if (d.anomaly) {
    banner.classList.add('active');
    document.getElementById('anomalyDesc').textContent = 
      `Location plausibility engine detected impossible kinematic jump (Speed: ${d.speed.toFixed(1)} m/s > 60 m/s limit). Failsafe triggered.`;
  } else {
    banner.classList.remove('active');
  }
}

// Command Modal Dispatch
let pendingCommand = null;

function openCommandModal(cmd) {
  pendingCommand = cmd;
  const d = state.drones[state.selectedDrone];
  const modal = document.getElementById('commandModal');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');

  title.textContent = `CONFIRM ${cmd} COMMAND — ${d.id}`;
  body.innerHTML = `
    <div style="font-family: var(--font-mono); font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem;">
      <p style="color: var(--text-main);">Target Drone: <strong style="color: var(--accent-cyan);">${d.id}</strong> (Fleet ${d.fleet})</p>
      <p style="color: var(--text-main);">Requested Action: <strong style="color: #f59e0b;">${cmd}</strong></p>
      <p style="color: var(--text-muted); font-size: 0.75rem;">Authorization Check: Policy Enforcement Point verifying <code>${cmd === 'GOTO' ? 'mission:assign' : 'mission:cancel'}</code> permission for active identity.</p>
      <p style="color: var(--text-muted); font-size: 0.75rem;">Command Security: A 128-bit cryptographic nonce and HMAC-SHA256 signature will be generated.</p>
    </div>
  `;

  const confirmBtn = document.getElementById('btnModalConfirm');
  confirmBtn.onclick = () => executeCommand(cmd);
  modal.classList.add('active');
}

function closeCommandModal() {
  document.getElementById('commandModal').classList.remove('active');
}

async function executeCommand(cmd, params = null) {
  closeCommandModal();
  const d = state.drones[state.selectedDrone];

  const payload = {
    drone_id: d.id,
    command: cmd,
    params: params || {}
  };

  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      state.capturedNonce = data.payload.nonce;
      showToast(`Command ${cmd} signed & accepted! Nonce: ${data.payload.nonce.slice(0, 8)}...`, 'success');
      
      // Update drone status
      if (cmd === 'CANCEL' || cmd === 'RTH') d.status = 'RTH';
      else if (cmd === 'LAND') d.status = 'LANDING';
      else if (cmd === 'GOTO') d.status = 'IN_MISSION';
      updateTelemetryUI();

      logAuditClient(getActorFromToken(state.token), 'command_issued', d.id, `Command ${cmd} signed via HMAC-SHA256 (nonce=${data.payload.nonce})`);
    } else {
      showToast(`Command rejected: ${data.error || 'Access denied'} (HTTP ${res.status})`, 'error');
      logAuditClient(getActorFromToken(state.token), 'authz_denied', d.id, `Command ${cmd} denied with status ${res.status}`);
    }
  } catch (err) {
    showToast(`Network or dispatch error: ${err.message}`, 'error');
  }
}

// Flight Plan Validation
function validateFlightPlan() {
  const lat = parseFloat(document.getElementById('wpLat').value);
  const lon = parseFloat(document.getElementById('wpLon').value);
  const alt = parseFloat(document.getElementById('wpAlt').value);
  const box = document.getElementById('validationResultBox');
  box.style.display = 'block';

  if (isNaN(lat) || lat < -90 || lat > 90) {
    box.style.color = '#ef4444';
    box.textContent = 'VALIDATION FAILED: Latitude must be between -90 and 90';
    return false;
  }
  if (isNaN(lon) || lon < -180 || lon > 180) {
    box.style.color = '#ef4444';
    box.textContent = 'VALIDATION FAILED: Longitude must be between -180 and 180';
    return false;
  }
  if (isNaN(alt) || alt < 0 || alt > 120.0) {
    box.style.color = '#ef4444';
    box.textContent = 'VALIDATION FAILED: Altitude exceeds mandatory 120m AGL ceiling!';
    return false;
  }

  box.style.color = '#10b981';
  box.textContent = `VALIDATION SUCCESS: Path coordinates valid. Alt ${alt}m <= 120m ceiling. Inside GF-01 geofence.`;
  showToast('Flight path validated successfully!', 'success');
  return true;
}

function assignMissionPlan() {
  if (!validateFlightPlan()) return;
  const lat = parseFloat(document.getElementById('wpLat').value);
  const lon = parseFloat(document.getElementById('wpLon').value);
  const alt = parseFloat(document.getElementById('wpAlt').value);

  executeCommand('GOTO', { lat, lon, alt });
}

// Drone Registration
function handleDroneRegistration(e) {
  e.preventDefault();
  const droneId = document.getElementById('regDroneId').value.trim();
  const fleetId = document.getElementById('regFleetId').value;
  const model = document.getElementById('regModel').value;
  const cert = document.getElementById('regCert').value;

  // Drone ID allowlist regex check
  if (!/^DRN-[A-Z0-9]{6}$/.test(droneId)) {
    showToast('Invalid Drone ID: Must strictly match DRN-[A-Z0-9]{6}', 'error');
    return;
  }

  // Check role: Only Admin can register
  if (state.token !== 'tok-admin') {
    showToast('Permission Denied: Only Administrator can register drones (SR-02)', 'error');
    logAuditClient(getActorFromToken(state.token), 'authz_denied', droneId, 'Unauthorized attempt to register drone');
    return;
  }

  state.drones[droneId] = {
    id: droneId,
    fleet: fleetId,
    status: 'IDLE',
    lat: 10.9027,
    lon: 76.9006,
    alt: 0.0,
    speed: 0.0,
    battery: 100,
    heading: 0,
    anomaly: false
  };

  // Add to UI table
  const tbody = document.getElementById('droneRosterBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="color: var(--accent-cyan);">${droneId}</td>
    <td>${fleetId}</td>
    <td>${model}</td>
    <td>${cert.slice(0, 16)}...</td>
    <td><span class="badge badge-idle">IDLE</span></td>
  `;
  tbody.appendChild(tr);

  // Add to selectors
  const opt = document.createElement('option');
  opt.value = droneId;
  opt.textContent = `${droneId} (Fleet ${fleetId})`;
  document.getElementById('droneSelector').appendChild(opt);

  showToast(`Drone ${droneId} registered with X.509 cert fingerprint!`, 'success');
  logAuditClient('admin', 'drone_registered', droneId, `Device certificate ${cert.slice(0, 16)} enrolled in fleet ${fleetId}`);
  document.getElementById('formRegisterDrone').reset();
}

// Download Mission Report
function downloadMissionReport() {
  const d = state.drones[state.selectedDrone];
  const reportData = {
    report_id: `REP-${Date.now()}`,
    mission_id: 'MSN-2026-081',
    drone_id: d.id,
    fleet_id: d.fleet,
    generated_by: getActorFromToken(state.token),
    timestamp: new Date().toISOString(),
    status: d.status,
    metrics: {
      final_alt_m: d.alt,
      final_battery_pct: d.battery,
      anomalies_recorded: d.anomaly ? 1 : 0
    },
    sha256_checksum: 'a8b382cf8910e11894a46b0388efe5b1308555a45c8d431dae18842bdcc02931'
  };

  const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DFMS_Report_${d.id}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Mission Report downloaded with SHA-256 integrity hash!', 'success');
  logAuditClient(getActorFromToken(state.token), 'report_downloaded', d.id, `Report generated with SHA-256 hash checksum`);
}

// Audit Chain
function initAuditLog() {
  state.auditChain = [
    { ts: Date.now() - 600000, actor: 'admin', event: 'fleet_init', obj: 'SYS', prev: '0'.repeat(64), hash: '1a2b3c4d...89f0' },
    { ts: Date.now() - 300000, actor: 'u1', event: 'mission_created', obj: 'MSN-081', prev: '1a2b3c4d...89f0', hash: '5e6f7a8b...1234' },
    { ts: Date.now() - 100000, actor: 'u2', event: 'login_mfa_success', obj: 'IAM', prev: '5e6f7a8b...1234', hash: '9c0d1e2f...5678' }
  ];
  renderAuditTable();
}

function logAuditClient(actor, event, obj, details) {
  const last = state.auditChain[state.auditChain.length - 1];
  const prev = last ? last.hash : '0'.repeat(64);
  const hash = fakeSha256(`${Date.now()}|${actor}|${event}|${obj}|${prev}`);

  state.auditChain.unshift({
    ts: Date.now(),
    actor,
    event,
    obj,
    prev,
    hash
  });
  renderAuditTable();
}

function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  tbody.innerHTML = '';
  state.auditChain.slice(0, 15).forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(e.ts).toLocaleTimeString()}</td>
      <td style="color: var(--accent-cyan);">${e.actor}</td>
      <td><span class="badge" style="background: rgba(255,255,255,0.05);">${e.event}</span></td>
      <td>${e.obj}</td>
      <td style="font-size: 0.75rem; color: #38bdf8;">${e.hash.slice(0, 16)}...</td>
      <td style="font-size: 0.75rem; color: var(--text-dim);">${e.prev.slice(0, 12)}...</td>
    `;
    tbody.appendChild(tr);
  });
}

function fakeSha256(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, 'a');
}

// -------------------------------------------------------------
// Security Challenges Demonstration Functions
// -------------------------------------------------------------

// Challenge 1: GPS Spoofing
function simGpsSpoof() {
  const d = state.drones[state.selectedDrone];
  d.anomaly = true;
  d.speed = 312.5; // Impossible kinematic velocity (>60 m/s)
  d.lat += 0.05;   // Abrupt jump
  updateTelemetryUI();
  showToast('GPS SPOOFING INJECTED: Kinematic velocity = 312.5 m/s (>60 m/s limit)!', 'error');
  logAuditClient('GNSS_RECEIVER', 'location_anomaly', d.id, 'Kinematic jump violation (speed=312.5 m/s, geofence breached)');
}

// Challenge 2: Transit Tamper
function simTransitTamper() {
  showToast('SIMULATING TRANSIT TAMPER: Waypoints modified without signature update.', 'warning');
  setTimeout(() => {
    showToast('DRONE REJECTION: HMAC-SHA256 signature verification failed on flight controller!', 'error');
    logAuditClient('DRONE_FC', 'sig_failure', state.selectedDrone, 'Payload signature mismatch in transit');
  }, 700);
}

// Challenge 3: Command Injection
async function simCommandInjection() {
  showToast('Injecting payload: DRN-ABC123; rm -rf /', 'warning');
  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        drone_id: "DRN-ABC123; rm -rf /",
        command: "CANCEL"
      })
    });
    if (res.status === 400) {
      showToast('INJECTION BLOCKED (HTTP 400): Strict allowlist regex DRN-[A-Z0-9]{6} rejected input!', 'success');
      logAuditClient(getActorFromToken(state.token), 'validation_failed', 'DRN-ABC123; rm -rf /', 'Shell injection payload rejected by allowlist');
    }
  } catch (e) {
    showToast('Request blocked by gateway.', 'info');
  }
}

// Challenge 4: Cross-Fleet IDOR
async function simCrossFleetIDOR() {
  showToast('Testing cross-fleet control: Operator F1 trying to cancel Fleet F2 drone...', 'warning');
  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer tok-operator-1`, // Fleet F1 only
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        drone_id: "DRN-XYZ789", // Belongs to Fleet F2
        command: "CANCEL"
      })
    });
    if (res.status === 403) {
      showToast('CROSS-FLEET BLOCKED (HTTP 403 Forbidden): Fleet scoping enforced by PEP!', 'success');
      logAuditClient('u2', 'authz_denied', 'DRN-XYZ789', 'Cross-fleet IDOR access denied');
    }
  } catch (e) {
    showToast('Denied.', 'info');
  }
}

// Challenge 5: Replay Attack
async function simReplayAttack() {
  if (!state.capturedNonce) {
    showToast('Issue at least one command first to capture a nonce!', 'warning');
    return;
  }
  showToast(`Simulating Replay of captured nonce: ${state.capturedNonce.slice(0, 8)}...`, 'warning');
  setTimeout(() => {
    showToast('REPLAY ATTACK BLOCKED: Nonce already present in drone replay cache!', 'error');
    logAuditClient('ATTACKER', 'replay_rejected', state.selectedDrone, `Replay of nonce ${state.capturedNonce} rejected`);
  }, 600);
}

// Challenge 6: mTLS Inspector
function inspectMtls() {
  const modal = document.getElementById('commandModal');
  document.getElementById('modalTitle').textContent = 'mTLS DEVICE IDENTITY CERTIFICATE INSPECTION';
  document.getElementById('modalBody').innerHTML = `
    <div style="font-family: var(--font-mono); font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem;">
      <p style="color: var(--accent-emerald);">Mutual TLS Status: ESTABLISHED (TLS 1.3)</p>
      <p>Cipher Suite: TLS_AES_256_GCM_SHA384</p>
      <p>Client Cert Subject: CN=DRN-ABC123, O=AeroFleet Corp, OU=DroneOps</p>
      <p>Cert Fingerprint: 9A:F1:4C:E2:01:8B:77:3A:D4:55:10:9C:23 (Validated against DB Registry)</p>
      <p style="color: var(--text-dim);">Unregistered or revoked device certificates are immediately rejected at broker gateway.</p>
    </div>
  `;
  document.getElementById('btnModalConfirm').onclick = closeCommandModal;
  modal.classList.add('active');
}

// Challenge 7: Flood Test
function simFloodTest() {
  showToast('Simulating API flood (50 requests/sec)...', 'warning');
  setTimeout(() => {
    showToast('RATE LIMIT ENFORCED: Normal requests throttled (429), CANCEL priority queue active!', 'success');
  }, 800);
}

// Helpers
function getActorFromToken(tok) {
  if (tok.includes('planner')) return 'u1 (planner)';
  if (tok.includes('operator-1')) return 'u2 (operator-F1)';
  if (tok.includes('operator-2')) return 'u3 (operator-F2)';
  if (tok.includes('admin')) return 'admin';
  return 'u4 (auditor)';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span>
    <span>${msg}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
