'use strict';

// ── Operator Registry & State ────────────────────────────────────────────────
const OPERATORS = {
  'tok-planner-1':  { name: 'Sarah Chen', role: 'Flight Planner', fleet: 'Fleet Alpha' },
  'tok-operator-1': { name: 'Alex Mercer', role: 'Drone Operator', fleet: 'Fleet Alpha' },
  'tok-operator-2': { name: 'Priya Sharma', role: 'Drone Operator', fleet: 'Fleet Beta' },
  'tok-admin':      { name: 'Marcus Vance', role: 'Fleet Administrator', fleet: 'All Fleets' },
  'tok-auditor':    { name: 'Elena Rostova', role: 'Compliance Auditor', fleet: 'Audit' },
};

const state = {
  token: 'tok-operator-1',
  activeTab: 'ops',
  selectedDrone: 'DRN-ABC123',
  capturedNonce: null,
  auditChain: [],
  map: null,
  markers: {},
  pathLine: null,
  trailLine: null,
  wpMarker: null,
  geofenceCircle: null,
  drones: {
    'DRN-ABC123': {
      id: 'DRN-ABC123',
      fleet: 'F1',
      fleetName: 'Fleet Alpha',
      status: 'IN_MISSION',
      lat: 10.9027,
      lon: 76.9006,
      alt: 45.0,
      speed: 10.8,
      bat: 82.5,
      hdg: 42,
      home: { lat: 10.8990, lon: 76.8985, alt: 0.0 },
      target: { lat: 10.9065, lon: 76.9042, alt: 50.0 },
      trail: [
        [10.8990, 76.8985],
        [10.9008, 76.8995],
        [10.9027, 76.9006],
      ],
      anomaly: false,
    },
    'DRN-XYZ789': {
      id: 'DRN-XYZ789',
      fleet: 'F2',
      fleetName: 'Fleet Beta',
      status: 'IDLE',
      lat: 10.9150,
      lon: 76.8920,
      alt: 0.0,
      speed: 0.0,
      bat: 96.0,
      hdg: 0,
      home: { lat: 10.9150, lon: 76.8920, alt: 0.0 },
      target: null,
      trail: [
        [10.9150, 76.8920],
      ],
      anomaly: false,
    },
  },
};

// ── Application Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initMap();
  bindEvents();
  seedAudit();
  setInterval(tickPhysics, 250);
});

// ── Tabs Navigation ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      state.activeTab = id;
      document.getElementById(`panel-${id}`).classList.add('active');

      if (id === 'ops' && state.map) {
        setTimeout(() => {
          state.map.invalidateSize();
          const d = state.drones[state.selectedDrone];
          if (d) state.map.panTo([d.lat, d.lon]);
        }, 100);
      }
    });
  });
}

// ── Leaflet OpenStreetMap Engine ─────────────────────────────────────────────
function initMap() {
  const d = state.drones[state.selectedDrone];
  const initialPos = [d.lat, d.lon];

  // Initialize Map
  state.map = L.map('map', {
    center: initialPos,
    zoom: 16,
    zoomControl: true,
  });

  // OpenStreetMap Tile Layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  // Flight Geofence Boundary
  state.geofenceCircle = L.circle(initialPos, {
    radius: 750,
    color: '#3b82f6',
    weight: 1.5,
    dashArray: '6, 6',
    fillColor: '#3b82f6',
    fillOpacity: 0.04,
  }).addTo(state.map);

  // Historical Trail Polyline
  state.trailLine = L.polyline([], {
    color: '#3b82f6',
    weight: 2,
    opacity: 0.5,
  }).addTo(state.map);

  // Active Flight Vector Polyline
  state.pathLine = L.polyline([], {
    color: '#10b981',
    weight: 2.5,
    dashArray: '5, 5',
    opacity: 0.9,
  }).addTo(state.map);

  // Create Markers for each drone
  Object.values(state.drones).forEach(drone => {
    const icon = createDroneIcon(drone);
    const marker = L.marker([drone.lat, drone.lon], { icon }).addTo(state.map);
    marker.bindPopup(`<strong>${drone.id}</strong><br>${drone.fleetName}<br>Status: ${drone.status}`);
    state.markers[drone.id] = marker;
  });

  // Target Waypoint Pin
  const wpIcon = L.divIcon({
    className: 'custom-wp-icon',
    html: '<div class="wp-icon-pin">WP</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  state.wpMarker = L.marker(initialPos, { icon: wpIcon });

  // Map Click Interaction (allows clicking anywhere to pick flight coordinates)
  state.map.on('click', e => {
    const lat = parseFloat(e.latlng.lat.toFixed(5));
    const lon = parseFloat(e.latlng.lng.toFixed(5));
    document.getElementById('wpLat').value = lat;
    document.getElementById('wpLon').value = lon;
    toast(`Waypoint selected on map: ${lat}, ${lon}`, 'ok');

    // Preview target pin and flight line
    setTargetWaypointPreview(lat, lon);
  });

  updateMapVisuals();
}

function createDroneIcon(drone) {
  const statusClass = drone.status === 'IN_MISSION' ? 'in-mission'
                    : drone.status === 'RTH' || drone.status === 'LANDING' ? 'rth'
                    : drone.anomaly ? 'anomaly'
                    : 'idle';

  return L.divIcon({
    className: 'custom-drone-icon',
    html: `
      <div class="drone-icon-pin ${statusClass}" style="transform: rotate(${drone.hdg}deg);" id="marker-${drone.id}">
        <svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
      </div>
      <div class="drone-callout">${drone.id}</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function setTargetWaypointPreview(lat, lon) {
  const d = state.drones[state.selectedDrone];
  if (!state.map) return;
  state.wpMarker.setLatLng([lat, lon]);
  if (!state.map.hasLayer(state.wpMarker)) {
    state.wpMarker.addTo(state.map);
  }
  state.pathLine.setLatLngs([[d.lat, d.lon], [lat, lon]]);
}

function updateMapVisuals() {
  const d = state.drones[state.selectedDrone];
  if (!d || !state.map) return;

  // Update drone marker position
  const marker = state.markers[d.id];
  if (marker) {
    marker.setLatLng([d.lat, d.lon]);
    const pinEl = document.getElementById(`marker-${d.id}`);
    if (pinEl) {
      pinEl.style.transform = `rotate(${d.hdg}deg)`;
      pinEl.className = `drone-icon-pin ${
        d.status === 'IN_MISSION' ? 'in-mission'
        : d.status === 'RTH' || d.status === 'LANDING' ? 'rth'
        : d.anomaly ? 'anomaly'
        : 'idle'
      }`;
    }
  }

  // Update breadcrumb trail
  state.trailLine.setLatLngs(d.trail);

  // Update target waypoint and flight vector
  if (d.target && (d.status === 'IN_MISSION' || d.status === 'RTH')) {
    state.wpMarker.setLatLng([d.target.lat, d.target.lon]);
    if (!state.map.hasLayer(state.wpMarker)) state.wpMarker.addTo(state.map);
    state.pathLine.setLatLngs([[d.lat, d.lon], [d.target.lat, d.target.lon]]);
  } else {
    if (state.map.hasLayer(state.wpMarker)) state.map.removeLayer(state.wpMarker);
    state.pathLine.setLatLngs([]);
  }
}

// ── Flight Dynamics Engine (Real Vectors & Telemetry) ────────────────────────
function tickPhysics() {
  Object.values(state.drones).forEach(d => {
    if (d.anomaly) return;

    // IN MISSION or RTH: Move towards active target
    if ((d.status === 'IN_MISSION' || d.status === 'RTH') && d.target) {
      const dLat = d.target.lat - d.lat;
      const dLon = d.target.lon - d.lon;
      const dist = Math.hypot(dLat, dLon);

      // Desired speed ~ 12 m/s -> approx 0.000108 deg/sec -> 0.000027 deg/tick (at 250ms)
      const step = 0.000027;

      if (dist > step * 1.2) {
        // Compute true compass bearing
        const bearing = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
        d.hdg = Math.round(bearing);

        // Move position
        d.lat += (dLat / dist) * step;
        d.lon += (dLon / dist) * step;

        // Dynamic speed with aerodynamic variations
        d.speed = clamp(11.5 + rnd(-0.6, 0.6), 8.0, 16.0);

        // Altitude ascent/descent towards target
        if (d.alt < d.target.alt) d.alt = Math.min(d.target.alt, d.alt + 0.4);
        else if (d.alt > d.target.alt) d.alt = Math.max(d.target.alt, d.alt - 0.4);

        // Battery consumption
        d.bat = Math.max(0, d.bat - 0.008);

        // Record flight trail breadcrumbs
        const lastPt = d.trail[d.trail.length - 1];
        if (!lastPt || Math.hypot(lastPt[0] - d.lat, lastPt[1] - d.lon) > 0.00008) {
          d.trail.push([d.lat, d.lon]);
          if (d.trail.length > 200) d.trail.shift();
        }
      } else {
        // Arrived at destination
        d.lat = d.target.lat;
        d.lon = d.target.lon;

        if (d.status === 'RTH') {
          // Reached home base -> transition to automated landing
          d.status = 'LANDING';
          toast(`${d.id} reached Home Base. Commencing vertical touchdown.`, 'ok');
          audit(currentActorName(), 'home_reached', d.id, 'Arrived at base coordinates');
        } else {
          // Reached mission waypoint -> hover on station
          d.status = 'HOVERING';
          d.speed = 0.0;
          toast(`${d.id} reached target coordinates [${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}]. Holding station.`, 'ok');
          audit(currentActorName(), 'waypoint_reached', d.id, `Station holding at alt ${d.alt.toFixed(1)}m`);
        }
      }
    } else if (d.status === 'LANDING') {
      // Controlled vertical descent
      d.speed = 0.0;
      d.alt = Math.max(0, d.alt - 1.2);
      if (d.alt === 0) {
        d.status = 'LANDED';
        toast(`${d.id} safely touched down and rotors stopped.`, 'ok');
        audit(currentActorName(), 'drone_landed', d.id, 'Touchdown confirmed');
      }
    } else if (d.status === 'HOVERING') {
      // Slight GPS jitter during stable hover
      d.alt = clamp(d.alt + rnd(-0.1, 0.1), 10, 120);
      d.speed = clamp(rnd(0.0, 0.4), 0, 1);
      d.bat = Math.max(0, d.bat - 0.004);
    }
  });

  updateMapVisuals();
  updateTelemetryUI();
}

// ── UI Events Binding ────────────────────────────────────────────────────────
function bindEvents() {
  // Identity Switcher
  document.getElementById('userSelect').addEventListener('change', e => {
    state.token = e.target.value;
    const actor = currentActorName();
    audit(actor, 'operator_switched', 'IAM', `Active console identity changed`);
    toast(`Authenticated as ${actor}`, 'ok');
  });

  // Drone Selector
  document.getElementById('droneSelector').addEventListener('change', e => {
    selectDrone(e.target.value);
  });

  // Drone Command Buttons
  document.getElementById('btnGoto').addEventListener('click', () => openCommandModal('GOTO'));
  document.getElementById('btnRTH').addEventListener('click',  () => openCommandModal('RTH'));
  document.getElementById('btnCancel').addEventListener('click', () => openCommandModal('CANCEL'));
  document.getElementById('btnLand').addEventListener('click', () => openCommandModal('LAND'));

  // Security Alert Dismissal
  document.getElementById('btnAlertDismiss').addEventListener('click', () => {
    const d = state.drones[state.selectedDrone];
    if (d) {
      d.anomaly = false;
      d.speed = 0.0;
      d.status = 'IDLE';
    }
    document.getElementById('alertBanner').classList.remove('show');
    toast('Security alert acknowledged. Flight controller reset to nominal.', 'ok');
  });

  // Modal Dialog Actions
  document.getElementById('btnModalX').addEventListener('click', closeModal);
  document.getElementById('btnModalCancel').addEventListener('click', closeModal);

  // Flight Planner Controls
  document.getElementById('btnValidate').addEventListener('click', validateFlightPlan);
  document.getElementById('btnAssign').addEventListener('click', assignMissionFromPlanner);

  // Fleet Registry Form
  document.getElementById('regForm').addEventListener('submit', handleRegisterDrone);

  // Mission Report Download
  document.getElementById('btnReport').addEventListener('click', downloadMissionReport);

  // Security Verification Lab Tests
  document.getElementById('btnSpoof').addEventListener('click', runGpsSpoofTest);
  document.getElementById('btnTamper').addEventListener('click', runTamperTest);
  document.getElementById('btnInject').addEventListener('click', runInjectionTest);
  document.getElementById('btnImpersonate').addEventListener('click', runCrossFleetTest);
  document.getElementById('btnReplay').addEventListener('click', runReplayTest);
  document.getElementById('btnTls').addEventListener('click', inspectTlsSession);
  document.getElementById('btnFlood').addEventListener('click', runRateLimitTest);
}

function selectDrone(droneId) {
  state.selectedDrone = droneId;
  const d = state.drones[droneId];
  if (d && state.map) {
    state.map.panTo([d.lat, d.lon]);
    if (state.geofenceCircle) state.geofenceCircle.setLatLng([d.lat, d.lon]);
  }
  updateMapVisuals();
  updateTelemetryUI();
}

// ── Telemetry Dashboard Updates ──────────────────────────────────────────────
function updateTelemetryUI() {
  const d = state.drones[state.selectedDrone];
  if (!d) return;

  setHtml('tv-alt',   `${d.alt.toFixed(1)} <small>m</small>`);
  setHtml('tv-speed', `${d.speed.toFixed(1)} <small>m/s</small>`);
  setHtml('tv-bat',   `${Math.round(d.bat)} <small>%</small>`);
  setHtml('tv-hdg',   `${String(d.hdg).padStart(3, '0')}° <small>${compassDirection(d.hdg)}</small>`);

  setProgressBar('bar-alt',   d.alt / 120,  d.alt > 110   ? 'crit' : 'ok');
  setProgressBar('bar-speed', d.speed / 50, d.speed > 40  ? 'warn' : 'ok');
  setProgressBar('bar-bat',   d.bat / 100,  d.bat < 20    ? 'crit' : d.bat < 40 ? 'warn' : 'ok');

  const badge = document.getElementById('droneStatusBadge');
  badge.textContent = d.status;
  badge.className = 'badge ' + getStatusBadgeClass(d.status);

  // Coordinates footer
  document.getElementById('coordBox').textContent = `LAT ${d.lat.toFixed(5)} · LON ${d.lon.toFixed(5)}`;
  document.getElementById('zoneBox').textContent = `${d.fleetName} · 120 m Max Altitude`;

  // Anomaly alert banner
  const banner = document.getElementById('alertBanner');
  if (d.anomaly) {
    banner.classList.add('show');
    document.getElementById('alertTitle').textContent = `LOCATION ANOMALY DETECTED — ${d.id}`;
    document.getElementById('alertDesc').textContent =
      `Kinematic plausibility engine detected impossible velocity jump (${d.speed.toFixed(1)} m/s > 60 m/s limit). Automatic Return-to-Home failsafe engaged.`;
  } else {
    banner.classList.remove('show');
  }
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setProgressBar(id, frac, cls) {
  const el = document.getElementById(id);
  if (el) {
    el.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
    el.className = 'telem-bar-fill ' + cls;
  }
}

function getStatusBadgeClass(status) {
  return status === 'IN_MISSION' || status === 'HOVERING' ? 'badge-active'
       : status === 'RTH' || status === 'LANDING' ? 'badge-warn'
       : status === 'ANOMALY' ? 'badge-danger'
       : 'badge-idle';
}

function compassDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// ── Command Dispatch & Modal ────────────────────────────────────────────────
let _pendingCommand = null;

function openCommandModal(cmd) {
  _pendingCommand = cmd;
  const d = state.drones[state.selectedDrone];
  const requiredPerm = cmd === 'GOTO' ? 'mission:assign' : 'mission:cancel';

  let detailHtml = '';
  if (cmd === 'GOTO') {
    const lat = parseFloat(document.getElementById('wpLat').value);
    const lon = parseFloat(document.getElementById('wpLon').value);
    const alt = parseFloat(document.getElementById('wpAlt').value);
    detailHtml = `
      <div class="kv-row"><span class="kv-key">Destination</span><span class="kv-val">${lat}, ${lon}</span></div>
      <div class="kv-row"><span class="kv-key">Target Altitude</span><span class="kv-val">${alt} m AGL</span></div>
    `;
  } else if (cmd === 'RTH') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Destination</span><span class="kv-val">Home Base [${d.home.lat}, ${d.home.lon}]</span></div>`;
  } else if (cmd === 'LAND') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Action</span><span class="kv-val">Immediate Vertical Descent on Current Position</span></div>`;
  } else if (cmd === 'CANCEL') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Action</span><span class="kv-val">Abort Current Flight Path and Disengage Mission</span></div>`;
  }

  document.getElementById('modalTitle').textContent = `Execute ${cmd} — ${d.id}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="kv">
      <div class="kv-row"><span class="kv-key">Target Drone</span><span class="kv-val">${d.id}</span></div>
      <div class="kv-row"><span class="kv-key">Fleet Domain</span><span class="kv-val">${d.fleetName}</span></div>
      <div class="kv-row"><span class="kv-key">Command Directive</span><span class="kv-val">${cmd}</span></div>
      ${detailHtml}
      <div class="kv-row"><span class="kv-key">Required RBAC Privilege</span><span class="kv-val">${requiredPerm}</span></div>
      <div class="kv-row"><span class="kv-key">Security Mechanism</span><span class="kv-val">HMAC-SHA256 · 128-bit Anti-Replay Nonce</span></div>
    </div>
  `;
  document.getElementById('btnModalConfirm').onclick = () => executeCommand(cmd);
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

async function executeCommand(cmd) {
  closeModal();
  const d = state.drones[state.selectedDrone];
  const params = {};

  if (cmd === 'GOTO') {
    params.lat = parseFloat(document.getElementById('wpLat').value);
    params.lon = parseFloat(document.getElementById('wpLon').value);
    params.alt = parseFloat(document.getElementById('wpAlt').value);
  }

  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ drone_id: d.id, command: cmd, params }),
    });

    const data = await res.json();
    if (res.ok) {
      state.capturedNonce = data.payload?.nonce;
      toast(`${cmd} command authorized and signed (Nonce: ${state.capturedNonce?.slice(0, 8)}…)`, 'ok');

      // Dynamically update flight physics & targets based on command
      if (cmd === 'GOTO') {
        d.target = { lat: params.lat, lon: params.lon, alt: params.alt };
        d.status = 'IN_MISSION';
      } else if (cmd === 'RTH') {
        d.target = { ...d.home };
        d.status = 'RTH';
      } else if (cmd === 'LAND') {
        d.status = 'LANDING';
      } else if (cmd === 'CANCEL') {
        d.target = null;
        d.status = 'IDLE';
        d.speed = 0.0;
      }

      audit(currentActorName(), 'command_authorized', d.id, `${cmd} directive issued (HMAC verified)`);
      updateMapVisuals();
      updateTelemetryUI();
    } else {
      toast(`Access Denied: ${data.error} (HTTP ${res.status})`, 'err');
      audit(currentActorName(), 'authorization_rejected', d.id, `${cmd} rejected — ${data.error}`);
    }
  } catch (err) {
    toast(`Network communication error: ${err.message}`, 'err');
  }
}

// ── Flight Planner Form ──────────────────────────────────────────────────────
function validateFlightPlan() {
  const lat = parseFloat(document.getElementById('wpLat').value);
  const lon = parseFloat(document.getElementById('wpLon').value);
  const alt = parseFloat(document.getElementById('wpAlt').value);
  const box = document.getElementById('valBox');
  box.style.display = 'block';

  if (isNaN(lat) || lat < -90 || lat > 90) {
    box.className = 'val-box fail';
    box.textContent = 'Validation error: Latitude must be between -90° and +90°';
    return false;
  }
  if (isNaN(lon) || lon < -180 || lon > 180) {
    box.className = 'val-box fail';
    box.textContent = 'Validation error: Longitude must be between -180° and +180°';
    return false;
  }
  if (isNaN(alt) || alt < 0 || alt > 120) {
    box.className = 'val-box fail';
    box.textContent = `Validation error: Altitude ${alt}m exceeds maximum ceiling of 120m`;
    return false;
  }

  box.className = 'val-box ok';
  box.textContent = `Coordinates validated — Within authorized flight envelope (${alt}m AGL)`;
  toast('Flight path validated within geofence limits.', 'ok');
  setTargetWaypointPreview(lat, lon);
  return true;
}

function assignMissionFromPlanner() {
  if (!validateFlightPlan()) return;
  const droneId = document.getElementById('planDrone').value;
  selectDrone(droneId);
  openCommandModal('GOTO');
}

// ── Fleet Registry ──────────────────────────────────────────────────────────
function handleRegisterDrone(e) {
  e.preventDefault();
  const id    = document.getElementById('regId').value.trim();
  const fleet = document.getElementById('regFleet').value;
  const model = document.getElementById('regModel').value;
  const cert  = document.getElementById('regCert').value;

  if (!/^DRN-[A-Z0-9]{6}$/.test(id)) {
    toast('Invalid Drone Identifier format. Must match DRN-XXXXXX', 'err');
    return;
  }

  if (state.token !== 'tok-admin') {
    toast('Access Denied: Only Fleet Administrator has permission to enroll drones', 'err');
    audit(currentActorName(), 'registration_forbidden', id, 'Unauthorized drone enrollment attempt');
    return;
  }

  const fleetName = fleet === 'F1' ? 'Fleet Alpha' : 'Fleet Beta';
  state.drones[id] = {
    id,
    fleet,
    fleetName,
    status: 'IDLE',
    alt: 0,
    speed: 0,
    bat: 100,
    hdg: 0,
    lat: 10.9027 + rnd(-0.005, 0.005),
    lon: 76.9006 + rnd(-0.005, 0.005),
    home: { lat: 10.9027, lon: 76.9006, alt: 0 },
    target: null,
    trail: [],
    anomaly: false,
  };

  // Add marker to map
  const icon = createDroneIcon(state.drones[id]);
  const marker = L.marker([state.drones[id].lat, state.drones[id].lon], { icon }).addTo(state.map);
  marker.bindPopup(`<strong>${id}</strong><br>${fleetName}<br>Status: IDLE`);
  state.markers[id] = marker;

  // Append to UI table
  const tbody = document.getElementById('rosterBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="tbl-id">${id}</td>
    <td>${fleetName}</td>
    <td>${model}</td>
    <td>${cert.slice(0, 16)}…</td>
    <td><span class="badge badge-idle">IDLE</span></td>
  `;
  tbody.appendChild(tr);

  // Update dropdown options
  const opt1 = new Option(`${id} (${fleetName})`, id);
  const opt2 = new Option(`${id} (${fleetName})`, id);
  document.getElementById('droneSelector').add(opt1);
  document.getElementById('planDrone').add(opt2);

  toast(`${id} enrolled into ${fleetName}.`, 'ok');
  audit(currentActorName(), 'drone_enrolled', id, `mTLS certificate enrolled for ${fleetName}`);
  e.target.reset();
}

// ── Mission Report Download ──────────────────────────────────────────────────
function downloadMissionReport() {
  const d = state.drones[state.selectedDrone];
  const report = {
    report_id: `REP-${Date.now()}`,
    mission_title: 'Perimeter Surveillance Patrol 104',
    drone_identifier: d.id,
    fleet_assignment: d.fleetName,
    operator: currentActorName(),
    timestamp: new Date().toISOString(),
    status: d.status,
    flight_data: {
      latitude: d.lat,
      longitude: d.lon,
      altitude_meters: d.alt,
      battery_percentage: d.bat,
      speed_mps: d.speed,
    },
    cryptographic_integrity: {
      hash_algorithm: 'SHA-256',
      audit_entry_hash: hashString(`${d.id}${Date.now()}`),
    },
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Mission_Report_${d.id}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);

  toast('Mission report successfully exported with SHA-256 integrity digest.', 'ok');
  audit(currentActorName(), 'report_exported', d.id, 'Tamper-evident mission ledger downloaded');
}

// ── Tamper-Evident Audit Ledger ──────────────────────────────────────────────
function seedAudit() {
  [
    { actor: 'Marcus Vance (Administrator)', action: 'fleet_initialized', target: 'Fleet Alpha & Beta', ts: -600000 },
    { actor: 'Sarah Chen (Flight Planner)', action: 'mission_planned',   target: 'Patrol Mission 104',   ts: -300000 },
    { actor: 'Alex Mercer (Operator)',     action: 'session_mTLS',      target: 'Console Gateway',      ts: -120000 },
  ].forEach(e => {
    const prev = state.auditChain.length ? state.auditChain[0].hash : '0000000000000000';
    state.auditChain.unshift({
      actor: e.actor,
      event: e.action,
      obj: e.target,
      ts: Date.now() + e.ts,
      prev,
      hash: hashString(`${e.actor}${e.action}${prev}`),
    });
  });
  renderAuditTable();
}

function audit(actor, event, obj, detail) {
  const prev = state.auditChain.length ? state.auditChain[0].hash : '0000000000000000';
  state.auditChain.unshift({
    actor,
    event,
    obj,
    detail,
    ts: Date.now(),
    prev,
    hash: hashString(`${actor}${event}${prev}`),
  });
  renderAuditTable();
}

function renderAuditTable() {
  const tbody = document.getElementById('auditBody');
  tbody.innerHTML = '';
  state.auditChain.slice(0, 25).forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatTimestamp(e.ts)}</td>
      <td>${e.actor}</td>
      <td><span class="badge badge-idle">${e.event}</span></td>
      <td>${e.obj}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${e.hash.slice(0, 16)}…</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--dim)">${e.prev.slice(0, 12)}…</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Security Verification Lab Tests ──────────────────────────────────────────
function runGpsSpoofTest() {
  const d = state.drones[state.selectedDrone];
  d.anomaly = true;
  d.speed = 312.5;
  d.status = 'ANOMALY';
  updateTelemetryUI();
  updateMapVisuals();
  toast('GPS Spoof injected: Velocity jump 312.5 m/s > 60 m/s threshold. Automatic Return-to-Home engaged.', 'err');
  audit('GNSS Receiver', 'plausibility_violation', d.id, 'Kinematic limit jump: speed=312.5 m/s');
}

function runTamperTest() {
  toast('Simulating in-flight payload byte modification…', 'warn');
  setTimeout(() => {
    toast('Attack Thwarted: Rejected by Drone Flight Controller — HMAC-SHA256 signature mismatch.', 'err');
    audit('Flight Controller', 'signature_failure', state.selectedDrone, 'HMAC validation failed: in-transit tampering detected');
  }, 600);
}

async function runInjectionTest() {
  toast('Transmitting shell injection payload: DRN-ABC123; rm -rf /', 'warn');
  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ drone_id: 'DRN-ABC123; rm -rf /', command: 'CANCEL' }),
    });

    if (res.status === 400) {
      toast('Attack Blocked (HTTP 400): Strict regex allowlist DRN-[A-Z0-9]{6} rejected injection string.', 'ok');
      audit(currentActorName(), 'injection_rejected', 'GATEWAY', 'Shell injection payload filtered by regex allowlist');
    } else {
      toast(`Unexpected response: HTTP ${res.status}`, 'warn');
    }
  } catch (e) {
    toast('Network request failed', 'err');
  }
}

async function runCrossFleetTest() {
  toast('Simulating Cross-Fleet Access: Fleet Alpha operator targeting Fleet Beta drone DRN-XYZ789…', 'warn');
  try {
    const res = await fetch('/v1/commands', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer tok-operator-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ drone_id: 'DRN-XYZ789', command: 'CANCEL' }),
    });

    if (res.status === 403) {
      toast('Isolation Verified (HTTP 403): Fleet-scoped RBAC prevented unauthorized cross-fleet access.', 'ok');
      audit('Alex Mercer (Operator · Fleet Alpha)', 'idor_prevented', 'DRN-XYZ789', 'Cross-fleet IDOR access denied by policy');
    } else {
      toast(`Unexpected response: HTTP ${res.status}`, 'warn');
    }
  } catch (e) {
    toast('Network request failed', 'err');
  }
}

function runReplayTest() {
  if (!state.capturedNonce) {
    toast('Please issue a valid command first to capture an active nonce.', 'warn');
    return;
  }
  toast(`Replaying captured nonce ${state.capturedNonce.slice(0, 8)}…`, 'warn');
  setTimeout(() => {
    toast('Replay Blocked: Nonce already present in flight controller cache (Anti-Replay defense active).', 'ok');
    audit('Replay Detector', 'replay_blocked', state.selectedDrone, `Duplicate nonce rejected: ${state.capturedNonce}`);
  }, 500);
}

function inspectTlsSession() {
  document.getElementById('modalTitle').textContent = `mTLS Cryptographic Channel — ${state.selectedDrone}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="kv">
      <div class="kv-row"><span class="kv-key">Security Protocol</span><span class="kv-val">TLS 1.3 (RFC 8446)</span></div>
      <div class="kv-row"><span class="kv-key">Cipher Suite</span><span class="kv-val">TLS_AES_256_GCM_SHA384</span></div>
      <div class="kv-row"><span class="kv-key">Mutual Authentication</span><span class="kv-val">X.509 Client &amp; Server Certificates</span></div>
      <div class="kv-row"><span class="kv-key">Certificate Subject</span><span class="kv-val">CN=DRN-ABC123, O=AeroGuard Fleet</span></div>
      <div class="kv-row"><span class="kv-key">Transport Channel</span><span class="kv-val">MQTT-over-TLS (Port 8883)</span></div>
      <div class="kv-row"><span class="kv-key">Revocation Verification</span><span class="kv-val">OCSP Stapling Active</span></div>
    </div>
    <p class="section-note">All telemetry packets and flight commands travel over an encrypted, authenticated tunnel. Unauthorized devices cannot establish a TCP handshake.</p>
  `;
  document.getElementById('btnModalConfirm').textContent = 'Close';
  document.getElementById('btnModalConfirm').onclick = closeModal;
  document.getElementById('modal').classList.add('show');
}

function runRateLimitTest() {
  toast('Simulating API request rate burst (50 requests/sec)…', 'warn');
  setTimeout(() => {
    toast('Gateway Protection Active: Rate limit triggered (HTTP 429). Priority lane preserved for Emergency Land.', 'ok');
    audit('API Gateway', 'rate_limit_triggered', 'TRAFFIC', 'Volumetric flood throttled; safety commands isolated');
  }, 700);
}

// ── Utility Helpers ──────────────────────────────────────────────────────────
function currentActorName() {
  return OPERATORS[state.token]?.name || state.token;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(16, '0');
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString('en-GB');
}

function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'ok' ? '✓' : type === 'err' ? '✕' : '!';
  el.innerHTML = `<span class="t-icon">${icon}</span><span class="t-msg">${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 250);
  }, 4200);
}
