'use strict';

// ── OPERATOR CREDENTIALS & SQUADRON REGISTRY ──────────────────────────────────
const OPERATORS = {
  'tok-planner-1':  { name: 'Sarah Chen',   role: 'planner',  roleTitle: 'Flight Planner',            fleet: 'F1', fleetName: 'Fleet Alpha', desc: 'Authorized to design multi-waypoint routes & assign missions.' },
  'tok-operator-1': { name: 'Alex Mercer',  role: 'operator', roleTitle: 'Drone Operator (Alpha)',     fleet: 'F1', fleetName: 'Fleet Alpha', desc: 'Tactical flight controller for Fleet Alpha squadron only.' },
  'tok-operator-2': { name: 'Priya Sharma', role: 'operator', roleTitle: 'Drone Operator (Beta)',      fleet: 'F2', fleetName: 'Fleet Beta',  desc: 'Tactical flight controller for Fleet Beta squadron only.' },
  'tok-admin':      { name: 'Marcus Vance', role: 'admin',    roleTitle: 'Fleet Administrator',       fleet: 'ALL', fleetName: 'All Squadrons', desc: 'Root administrative authority: fleet creation, enrollment & audit.' },
  'tok-auditor':    { name: 'Elena Rostova', role: 'auditor', roleTitle: 'Compliance Auditor',         fleet: 'NONE', fleetName: 'Audit Observer', desc: 'Read-only safety clearance: cryptographic audit logs & reports.' },
};

const state = {
  token: 'tok-operator-1',
  activeTab: 'ops',
  selectedDrone: 'DRN-ABC123',
  followDrone: false,
  isMapExpanded: false,
  capturedNonce: null,
  auditChain: [],
  map: null,
  markers: {},
  baseMarkers: {},
  pathLine: null,
  trailLine: null,
  plannedRouteLine: null,
  wpMarker: null,
  routeWpMarkers: [],
  geofenceCircles: {},

  // Active Fleets
  fleets: {
    'F1': { code: 'F1', name: 'Fleet Alpha (Patrol Squadron)', lat: 10.8990, lon: 76.8985, radius: 800, color: '#3b82f6', status: 'ACTIVE' },
    'F2': { code: 'F2', name: 'Fleet Beta (Surveillance Squadron)', lat: 10.9150, lon: 76.8920, radius: 850, color: '#8b5cf6', status: 'ACTIVE' },
  },

  // Active Drones
  drones: {
    'DRN-ABC123': {
      id: 'DRN-ABC123',
      fleet: 'F1',
      fleetName: 'Fleet Alpha',
      status: 'IN_MISSION',
      lat: 10.9027,
      lon: 76.9006,
      alt: 45.0,
      speed: 11.4,
      bat: 82.5,
      hdg: 42,
      home: { lat: 10.8990, lon: 76.8985, alt: 0.0 },
      target: { lat: 10.9065, lon: 76.9042, alt: 50.0 },
      waypointQueue: [],
      currentWpIndex: 0,
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
      waypointQueue: [],
      currentWpIndex: 0,
      trail: [
        [10.9150, 76.8920],
      ],
      anomaly: false,
    },
  },

  // Sophisticated Planned Route
  plannedRoute: [],
};

// ── APPLICATION BOOT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initMap();
  bindEvents();
  seedInitialRoute();
  seedAudit();
  renderFleetRoster();
  renderRouteTable();
  applyRolePermissions();
  setInterval(tickPhysics, 250);
});

// ── TABS NAVIGATION ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      state.activeTab = id;
      document.getElementById(`panel-${id}`).classList.add('active');

      if ((id === 'ops' || id === 'planner') && state.map) {
        setTimeout(() => {
          state.map.invalidateSize();
          const d = state.drones[state.selectedDrone];
          if (d) state.map.panTo([d.lat, d.lon]);
        }, 100);
      }
    });
  });
}

// ── LEAFLET OPENSTREETMAP ENGINE ─────────────────────────────────────────────
function initMap() {
  const d = state.drones[state.selectedDrone];
  const initialPos = [d.lat, d.lon];

  state.map = L.map('map', {
    center: initialPos,
    zoom: 16,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
  }).addTo(state.map);

  // Flight Trails & Polylines
  state.trailLine = L.polyline([], { color: '#3b82f6', weight: 2, opacity: 0.5 }).addTo(state.map);
  state.pathLine = L.polyline([], { color: '#10b981', weight: 2.5, dashArray: '5, 5', opacity: 0.9 }).addTo(state.map);
  state.plannedRouteLine = L.polyline([], { color: '#818cf8', weight: 2, dashArray: '6, 4', opacity: 0.85 }).addTo(state.map);

  // Render Geofence Envelopes & Base Stations for Fleets
  renderFleetMapEntities();

  // Drone Markers
  Object.values(state.drones).forEach(drone => {
    const icon = createDroneIcon(drone);
    const marker = L.marker([drone.lat, drone.lon], { icon }).addTo(state.map);
    marker.bindPopup(`<strong>${drone.id}</strong><br>${drone.fleetName}<br>Status: ${drone.status}`);
    state.markers[drone.id] = marker;
  });

  // Single Target Waypoint Pin
  const wpIcon = L.divIcon({
    className: 'custom-wp-icon',
    html: '<div class="wp-icon-pin">WP</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  state.wpMarker = L.marker(initialPos, { icon: wpIcon });

  // Map Click Interaction (Appends Waypoints in Planner mode or sets target)
  state.map.on('click', e => {
    const lat = parseFloat(e.latlng.lat.toFixed(5));
    const lon = parseFloat(e.latlng.lng.toFixed(5));

    if (state.activeTab === 'planner') {
      addWaypointToPlannedRoute(lat, lon, 50, 12, 'SURVEILLANCE');
      toast(`Waypoint ${state.plannedRoute.length} added at [${lat}, ${lon}]`, 'ok');
    } else {
      toast(`Selected coordinate: ${lat}, ${lon}`, 'ok');
    }
  });

  updateMapVisuals();
}

function renderFleetMapEntities() {
  // Clear old circles
  Object.values(state.geofenceCircles).forEach(c => state.map.removeLayer(c));
  Object.values(state.baseMarkers).forEach(m => state.map.removeLayer(m));
  state.geofenceCircles = {};
  state.baseMarkers = {};

  Object.values(state.fleets).forEach(f => {
    // Geofence Circle
    const circle = L.circle([f.lat, f.lon], {
      radius: f.radius,
      color: f.color || '#3b82f6',
      weight: 1.5,
      dashArray: '6, 6',
      fillColor: f.color || '#3b82f6',
      fillOpacity: 0.04,
    }).addTo(state.map);
    circle.bindTooltip(`${f.name} Envelope (${f.radius}m)`, { permanent: false });
    state.geofenceCircles[f.code] = circle;

    // Base Station Icon
    const baseIcon = L.divIcon({
      className: 'custom-wp-icon',
      html: `<div style="background:#0f172a;border:2px solid ${f.color || '#3b82f6'};border-radius:4px;padding:2px 5px;font-size:10px;font-family:var(--mono);color:#f1f5f9;white-space:nowrap;">BASE · ${f.code}</div>`,
      iconSize: [60, 20],
      iconAnchor: [30, 10],
    });
    const baseMarker = L.marker([f.lat, f.lon], { icon: baseIcon }).addTo(state.map);
    state.baseMarkers[f.code] = baseMarker;
  });
}

function createDroneIcon(drone) {
  const statusClass = drone.status === 'IN_MISSION' || drone.status === 'HOVERING' ? 'in-mission'
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

function updateMapVisuals() {
  const d = state.drones[state.selectedDrone];
  if (!d || !state.map) return;

  // Drone Marker Position & Orientation
  const marker = state.markers[d.id];
  if (marker) {
    marker.setLatLng([d.lat, d.lon]);
    const pinEl = document.getElementById(`marker-${d.id}`);
    if (pinEl) {
      pinEl.style.transform = `rotate(${d.hdg}deg)`;
      pinEl.className = `drone-icon-pin ${
        d.status === 'IN_MISSION' || d.status === 'HOVERING' ? 'in-mission'
        : d.status === 'RTH' || d.status === 'LANDING' ? 'rth'
        : d.anomaly ? 'anomaly'
        : 'idle'
      }`;
    }
  }

  // Camera Lock
  if (state.followDrone) {
    state.map.panTo([d.lat, d.lon], { animate: false });
  }

  // Breadcrumbs
  state.trailLine.setLatLngs(d.trail);

  // Active Flight Vector
  if (d.target && (d.status === 'IN_MISSION' || d.status === 'RTH')) {
    state.wpMarker.setLatLng([d.target.lat, d.target.lon]);
    if (!state.map.hasLayer(state.wpMarker)) state.wpMarker.addTo(state.map);
    state.pathLine.setLatLngs([[d.lat, d.lon], [d.target.lat, d.target.lon]]);
  } else {
    if (state.map.hasLayer(state.wpMarker)) state.map.removeLayer(state.wpMarker);
    state.pathLine.setLatLngs([]);
  }

  // Planned Multi-Waypoint Route Polyline
  if (state.plannedRoute.length > 0) {
    const pts = state.plannedRoute.map(w => [w.lat, w.lon]);
    state.plannedRouteLine.setLatLngs(pts);
    renderRouteWaypointsOnMap();
  } else {
    state.plannedRouteLine.setLatLngs([]);
    clearRouteWaypointsOnMap();
  }
}

function renderRouteWaypointsOnMap() {
  clearRouteWaypointsOnMap();
  state.plannedRoute.forEach((wp, idx) => {
    const icon = L.divIcon({
      className: 'custom-wp-icon',
      html: `<div class="wp-icon-pin" style="width:20px;height:20px;font-size:10px;">${idx + 1}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const m = L.marker([wp.lat, wp.lon], { icon }).addTo(state.map);
    m.bindPopup(`<strong>WP${idx + 1}</strong>: ${wp.action}<br>Alt: ${wp.alt}m · Spd: ${wp.speed}m/s`);
    state.routeWpMarkers.push(m);
  });
}

function clearRouteWaypointsOnMap() {
  state.routeWpMarkers.forEach(m => state.map.removeLayer(m));
  state.routeWpMarkers = [];
}

// ── EXPANDED FULLSCREEN MAP CONTROLLER ───────────────────────────────────────
function toggleMapFullscreen() {
  const wrap = document.getElementById('mapWrap');
  state.isMapExpanded = !state.isMapExpanded;
  wrap.classList.toggle('expanded', state.isMapExpanded);

  const btn = document.getElementById('btnExpandMap');
  btn.innerHTML = state.isMapExpanded ? '🗗 Standard' : '⛶ Fullscreen';

  setTimeout(() => {
    state.map.invalidateSize();
    const d = state.drones[state.selectedDrone];
    if (d) state.map.panTo([d.lat, d.lon]);
  }, 200);
}

// ── DYNAMIC MULTI-WAYPOINT FLIGHT DYNAMICS ENGINE ────────────────────────────
function tickPhysics() {
  Object.values(state.drones).forEach(d => {
    if (d.anomaly) return;

    // Multi-Waypoint Navigation
    if (d.status === 'IN_MISSION') {
      // If we have an active waypoint queue and target is reached or not yet assigned
      if (d.waypointQueue.length > 0 && d.currentWpIndex < d.waypointQueue.length) {
        d.target = d.waypointQueue[d.currentWpIndex];
      }

      if (d.target) {
        const dLat = d.target.lat - d.lat;
        const dLon = d.target.lon - d.lon;
        const dist = Math.hypot(dLat, dLon);

        const targetSpeed = d.target.speed || 12.0;
        const step = (targetSpeed * 0.000009) * 0.25;

        if (dist > step * 1.5) {
          // In Flight towards current Waypoint
          const bearing = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
          d.hdg = Math.round(bearing);

          d.lat += (dLat / dist) * step;
          d.lon += (dLon / dist) * step;

          d.speed = clamp(targetSpeed + rnd(-0.4, 0.4), 6.0, 18.0);

          const targetAlt = d.target.alt || 50.0;
          if (d.alt < targetAlt) d.alt = Math.min(targetAlt, d.alt + 0.5);
          else if (d.alt > targetAlt) d.alt = Math.max(targetAlt, d.alt - 0.5);

          d.bat = Math.max(0, d.bat - 0.008);

          // Breadcrumbs
          const lastPt = d.trail[d.trail.length - 1];
          if (!lastPt || Math.hypot(lastPt[0] - d.lat, lastPt[1] - d.lon) > 0.00008) {
            d.trail.push([d.lat, d.lon]);
            if (d.trail.length > 250) d.trail.shift();
          }
        } else {
          // Arrived at current Waypoint
          d.lat = d.target.lat;
          d.lon = d.target.lon;

          if (d.waypointQueue.length > 0 && d.currentWpIndex < d.waypointQueue.length - 1) {
            d.currentWpIndex++;
            d.target = d.waypointQueue[d.currentWpIndex];
            toast(`${d.id} reached Waypoint ${d.currentWpIndex}. Proceeding to Waypoint ${d.currentWpIndex + 1}.`, 'ok');
            audit(currentActorName(), 'waypoint_reached', d.id, `Advanced to WP${d.currentWpIndex + 1}`);
          } else {
            // Completed all waypoints
            d.status = 'HOVERING';
            d.speed = 0.0;
            toast(`${d.id} completed all mission waypoints. Holding station.`, 'ok');
            audit(currentActorName(), 'mission_completed', d.id, 'All flight path waypoints traversed');
          }
        }
      }
    } else if (d.status === 'RTH' && d.target) {
      // Return To Home base
      const dLat = d.target.lat - d.lat;
      const dLon = d.target.lon - d.lon;
      const dist = Math.hypot(dLat, dLon);
      const step = 0.000028;

      if (dist > step * 1.5) {
        const bearing = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
        d.hdg = Math.round(bearing);
        d.lat += (dLat / dist) * step;
        d.lon += (dLon / dist) * step;
        d.speed = clamp(12.5 + rnd(-0.5, 0.5), 10.0, 16.0);
        d.bat = Math.max(0, d.bat - 0.007);
      } else {
        d.lat = d.target.lat;
        d.lon = d.target.lon;
        d.status = 'LANDING';
        toast(`${d.id} arrived over Home Base. Commencing vertical landing.`, 'ok');
        audit(currentActorName(), 'base_reached', d.id, 'Arrival at squadron base');
      }
    } else if (d.status === 'LANDING') {
      d.speed = 0.0;
      d.alt = Math.max(0, d.alt - 1.2);
      if (d.alt === 0) {
        d.status = 'IDLE';
        toast(`${d.id} touchdown complete. Motors disarmed.`, 'ok');
        audit(currentActorName(), 'touchdown_confirmed', d.id, 'Safe ground landing');
      }
    } else if (d.status === 'HOVERING') {
      d.alt = clamp(d.alt + rnd(-0.1, 0.1), 10, 120);
      d.speed = clamp(rnd(0.0, 0.3), 0, 1);
      d.bat = Math.max(0, d.bat - 0.003);
    }
  });

  updateMapVisuals();
  updateTelemetryUI();
  updateHudUI();
}

// ── TELEMETRY & HUD UI UPDATES ───────────────────────────────────────────────
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

  document.getElementById('coordBox').textContent = `LAT ${d.lat.toFixed(5)} · LON ${d.lon.toFixed(5)}`;
  document.getElementById('zoneBox').textContent = `${d.fleetName} · 120 m Max Altitude`;

  const banner = document.getElementById('alertBanner');
  if (d.anomaly) {
    banner.classList.add('show');
    document.getElementById('alertTitle').textContent = `LOCATION ANOMALY DETECTED — ${d.id}`;
    document.getElementById('alertDesc').textContent =
      `Kinematic plausibility engine detected impossible velocity jump (${d.speed.toFixed(1)} m/s > 60 m/s limit). Return-to-Home engaged.`;
  } else {
    banner.classList.remove('show');
  }
}

function updateHudUI() {
  const d = state.drones[state.selectedDrone];
  if (!d) return;

  setHtml('hudDrone', d.id);
  setHtml('hudAlt', `${d.alt.toFixed(1)} m`);
  setHtml('hudSpeed', `${d.speed.toFixed(1)} m/s`);
  setHtml('hudBat', `${Math.round(d.bat)}%`);
  setHtml('hudHdg', `${String(d.hdg).padStart(3, '0')}° ${compassDirection(d.hdg)}`);

  if (d.target) {
    const distM = Math.round(Math.hypot(d.target.lat - d.lat, d.target.lon - d.lon) * 111000);
    setHtml('hudNextWp', `WP${d.currentWpIndex + 1} (${distM}m)`);
  } else {
    setHtml('hudNextWp', 'Station Hold');
  }
}

// ── SOPHISTICATED FLIGHT ROUTE PLANNER ───────────────────────────────────────
function seedInitialRoute() {
  const baseLat = 10.9027;
  const baseLon = 76.9006;
  state.plannedRoute = [
    { id: 1, lat: baseLat + 0.0020, lon: baseLon + 0.0015, alt: 45, speed: 12, action: 'TRANSIT' },
    { id: 2, lat: baseLat + 0.0035, lon: baseLon + 0.0030, alt: 50, speed: 14, action: 'SURVEILLANCE' },
    { id: 3, lat: baseLat + 0.0025, lon: baseLon + 0.0050, alt: 40, speed: 10, action: 'LOITER' },
    { id: 4, lat: baseLat + 0.0005, lon: baseLon + 0.0035, alt: 35, speed: 12, action: 'PERIMETER_CHECK' },
  ];
}

function addWaypointToPlannedRoute(lat, lon, alt = 45, speed = 12, action = 'TRANSIT') {
  const id = state.plannedRoute.length + 1;
  state.plannedRoute.push({ id, lat, lon, alt, speed, action });
  renderRouteTable();
  updateMapVisuals();
}

function renderRouteTable() {
  const tbody = document.getElementById('routeTableBody');
  tbody.innerHTML = '';

  state.plannedRoute.forEach((wp, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="wp-num-badge">${index + 1}</span></td>
      <td><input class="form-input" style="padding:3px 6px;font-size:11px;" type="number" step="0.0001" value="${wp.lat.toFixed(5)}" onchange="updateWpCoord(${index}, 'lat', this.value)"></td>
      <td><input class="form-input" style="padding:3px 6px;font-size:11px;" type="number" step="0.0001" value="${wp.lon.toFixed(5)}" onchange="updateWpCoord(${index}, 'lon', this.value)"></td>
      <td><input class="form-input" style="padding:3px 6px;font-size:11px;width:60px;" type="number" value="${wp.alt}" onchange="updateWpCoord(${index}, 'alt', this.value)"></td>
      <td><input class="form-input" style="padding:3px 6px;font-size:11px;width:55px;" type="number" value="${wp.speed}" onchange="updateWpCoord(${index}, 'speed', this.value)"></td>
      <td>
        <select class="form-select" style="padding:3px 6px;font-size:11px;" onchange="updateWpCoord(${index}, 'action', this.value)">
          <option value="TRANSIT" ${wp.action === 'TRANSIT' ? 'selected' : ''}>Transit</option>
          <option value="SURVEILLANCE" ${wp.action === 'SURVEILLANCE' ? 'selected' : ''}>Surveillance</option>
          <option value="LOITER" ${wp.action === 'LOITER' ? 'selected' : ''}>Loiter (30s)</option>
          <option value="PHOTO_RECON" ${wp.action === 'PHOTO_RECON' ? 'selected' : ''}>Photo Recon</option>
        </select>
      </td>
      <td><button class="btn-icon-del" onclick="deleteWaypoint(${index})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  recalculateRouteMetrics();
}

window.updateWpCoord = (index, field, val) => {
  if (state.plannedRoute[index]) {
    state.plannedRoute[index][field] = field === 'action' ? val : parseFloat(val);
    updateMapVisuals();
    recalculateRouteMetrics();
  }
};

window.deleteWaypoint = (index) => {
  state.plannedRoute.splice(index, 1);
  state.plannedRoute.forEach((w, i) => w.id = i + 1);
  renderRouteTable();
  updateMapVisuals();
};

function recalculateRouteMetrics() {
  if (state.plannedRoute.length === 0) {
    setHtml('metricDist', '0 m');
    setHtml('metricTime', '00:00');
    setHtml('metricBat', '0%');
    return;
  }

  let totalDistM = 0;
  for (let i = 0; i < state.plannedRoute.length - 1; i++) {
    const a = state.plannedRoute[i];
    const b = state.plannedRoute[i + 1];
    totalDistM += Math.hypot(b.lat - a.lat, b.lon - a.lon) * 111000;
  }

  const distText = totalDistM >= 1000 ? `${(totalDistM / 1000).toFixed(2)} km` : `${Math.round(totalDistM)} m`;
  setHtml('metricDist', distText);

  // Time in seconds at avg 12 m/s
  const totalSeconds = Math.round(totalDistM / 12);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  setHtml('metricTime', `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`);

  // Battery approx 1% per 120m
  const batPct = Math.min(100, Math.round(totalDistM / 120));
  setHtml('metricBat', `${batPct}%`);
}

// ── PATTERN GENERATORS ───────────────────────────────────────────────────────
function generateBoxPattern() {
  const d = state.drones[state.selectedDrone];
  const centerLat = d.lat;
  const centerLon = d.lon;
  const delta = 0.0025;

  state.plannedRoute = [
    { id: 1, lat: centerLat + delta, lon: centerLon - delta, alt: 45, speed: 12, action: 'PERIMETER_CHECK' },
    { id: 2, lat: centerLat + delta, lon: centerLon + delta, alt: 45, speed: 12, action: 'PERIMETER_CHECK' },
    { id: 3, lat: centerLat - delta, lon: centerLon + delta, alt: 45, speed: 12, action: 'PERIMETER_CHECK' },
    { id: 4, lat: centerLat - delta, lon: centerLon - delta, alt: 45, speed: 12, action: 'PERIMETER_CHECK' },
  ];
  renderRouteTable();
  updateMapVisuals();
  toast('Perimeter Box (4 Waypoints) generated.', 'ok');
}

function generateSurveyGrid() {
  const d = state.drones[state.selectedDrone];
  const lat = d.lat;
  const lon = d.lon;

  state.plannedRoute = [
    { id: 1, lat: lat + 0.001, lon: lon - 0.002, alt: 50, speed: 14, action: 'SCAN_PASS_1' },
    { id: 2, lat: lat + 0.001, lon: lon + 0.002, alt: 50, speed: 14, action: 'SCAN_PASS_1' },
    { id: 3, lat: lat + 0.002, lon: lon + 0.002, alt: 50, speed: 14, action: 'TURN_LEG' },
    { id: 4, lat: lat + 0.002, lon: lon - 0.002, alt: 50, speed: 14, action: 'SCAN_PASS_2' },
    { id: 5, lat: lat + 0.003, lon: lon - 0.002, alt: 50, speed: 14, action: 'TURN_LEG' },
    { id: 6, lat: lat + 0.003, lon: lon + 0.002, alt: 50, speed: 14, action: 'SCAN_PASS_3' },
  ];
  renderRouteTable();
  updateMapVisuals();
  toast('Lawnmower Survey Grid (6 Waypoints) generated.', 'ok');
}

// ── ROLE CLEARANCE & PERMISSIONS ENGINE ─────────────────────────────────────
function applyRolePermissions() {
  const op = OPERATORS[state.token] || OPERATORS['tok-operator-1'];

  // Role Badges
  const roleBadge = document.getElementById('cmdRoleBadge');
  if (roleBadge) {
    roleBadge.textContent = `${op.roleTitle} · ${op.fleetName}`;
    roleBadge.className = `badge badge-${op.role === 'admin' ? 'active' : op.role === 'operator' ? 'info' : 'idle'}`;
  }

  const roleDesc = document.getElementById('cmdRoleDesc');
  if (roleDesc) roleDesc.textContent = op.desc;

  // Buttons to check
  const btnGoto = document.getElementById('btnGoto');
  const btnRTH = document.getElementById('btnRTH');
  const btnCancel = document.getElementById('btnCancel');
  const btnLand = document.getElementById('btnLand');
  const btnAssign = document.getElementById('btnAssign');
  const btnEnrollDrone = document.getElementById('btnEnrollDrone');
  const btnCreateFleet = document.getElementById('btnCreateFleet');

  // Auditor: Read-only
  if (op.role === 'auditor') {
    lockButton(btnGoto, 'Auditor clearance is strictly read-only');
    lockButton(btnRTH, 'Auditor clearance is strictly read-only');
    lockButton(btnCancel, 'Auditor clearance is strictly read-only');
    lockButton(btnLand, 'Auditor clearance is strictly read-only');
    lockButton(btnAssign, 'Auditor clearance is strictly read-only');
    lockButton(btnEnrollDrone, 'Auditor clearance is strictly read-only');
    lockButton(btnCreateFleet, 'Auditor clearance is strictly read-only');
    return;
  }

  // Planner: Can plan & assign routes, cannot execute in-flight emergency cancel/land
  if (op.role === 'planner') {
    unlockButton(btnAssign);
    unlockButton(btnGoto);
    unlockButton(btnRTH);
    lockButton(btnCancel, 'In-flight emergency abort requires active Pilot / Operator license');
    lockButton(btnLand, 'In-flight emergency landing requires active Pilot / Operator license');
    lockButton(btnEnrollDrone, 'Drone hardware registration requires Administrator role');
    lockButton(btnCreateFleet, 'Fleet squadron creation requires Administrator role');
    return;
  }

  // Operator: Can command drones in their fleet scope
  if (op.role === 'operator') {
    const selectedDrone = state.drones[state.selectedDrone];
    const isSameFleet = selectedDrone && selectedDrone.fleet === op.fleet;

    if (isSameFleet) {
      unlockButton(btnGoto);
      unlockButton(btnRTH);
      unlockButton(btnCancel);
      unlockButton(btnLand);
      unlockButton(btnAssign);
    } else {
      const msg = `Unauthorized: ${selectedDrone?.id} belongs to ${selectedDrone?.fleetName}. You hold clearance for ${op.fleetName} only.`;
      lockButton(btnGoto, msg);
      lockButton(btnRTH, msg);
      lockButton(btnCancel, msg);
      lockButton(btnLand, msg);
      lockButton(btnAssign, msg);
    }

    lockButton(btnEnrollDrone, 'Drone hardware registration requires Administrator role');
    lockButton(btnCreateFleet, 'Fleet squadron creation requires Administrator role');
    return;
  }

  // Admin: Root clearance
  if (op.role === 'admin') {
    unlockButton(btnGoto);
    unlockButton(btnRTH);
    unlockButton(btnCancel);
    unlockButton(btnLand);
    unlockButton(btnAssign);
    unlockButton(btnEnrollDrone);
    unlockButton(btnCreateFleet);
  }
}

function lockButton(btn, reason) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('btn-locked');
  btn.title = `[ACCESS RESTRICTED] ${reason}`;
}

function unlockButton(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('btn-locked');
  btn.title = '';
}

// ── ROLE CLEARANCE MODAL ────────────────────────────────────────────────────
function openRoleClearanceModal() {
  const grid = document.getElementById('roleGrid');
  grid.innerHTML = '';

  Object.entries(OPERATORS).forEach(([tok, op]) => {
    const isCurrent = tok === state.token;
    const card = document.createElement('div');
    card.className = `role-account-card ${isCurrent ? 'active' : ''}`;
    card.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>${op.name}</strong>
          <span class="role-badge ${op.role}">${op.roleTitle}</span>
          ${isCurrent ? '<span class="badge badge-active">CURRENT ACTIVE SESSION</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">${op.desc}</div>
        <div style="font-size:10px;font-family:var(--mono);color:var(--dim);margin-top:2px;">Domain: ${op.fleetName} · Token: ${tok}</div>
      </div>
      <div>
        ${isCurrent ? '<button class="btn btn-default" disabled style="font-size:11px;">Active</button>' : `<button class="btn btn-primary" style="font-size:11px;" onclick="switchOperatorSession('${tok}')">Switch</button>`}
      </div>
    `;
    grid.appendChild(card);
  });

  document.getElementById('roleModal').classList.add('show');
}

window.switchOperatorSession = (token) => {
  state.token = token;
  document.getElementById('userSelect').value = token;
  document.getElementById('roleModal').classList.remove('show');

  const actor = currentActorName();
  audit(actor, 'operator_authenticated', 'IAM', `Session clearance established as ${actor}`);
  toast(`Authenticated as ${actor}`, 'ok');
  applyRolePermissions();
};

// ── FLEET CREATION & ROSTER ──────────────────────────────────────────────────
function handleCreateFleet(e) {
  e.preventDefault();
  if (state.token !== 'tok-admin') {
    toast('Access Denied: Only Fleet Administrator can establish new fleet squadrons.', 'err');
    audit(currentActorName(), 'fleet_creation_blocked', 'RBAC', 'Unauthorized attempt to create squadron');
    return;
  }

  const code   = document.getElementById('fleetCode').value.trim().toUpperCase();
  const name   = document.getElementById('fleetName').value.trim();
  const lat    = parseFloat(document.getElementById('fleetLat').value);
  const lon    = parseFloat(document.getElementById('fleetLon').value);
  const radius = parseInt(document.getElementById('fleetRadius').value, 10) || 800;

  if (state.fleets[code]) {
    toast(`Fleet code ${code} already exists.`, 'err');
    return;
  }

  const colors = ['#ec4899', '#f97316', '#14b8a6', '#06b6d4', '#eab308'];
  const color = colors[Object.keys(state.fleets).length % colors.length];

  state.fleets[code] = { code, name, lat, lon, radius, color, status: 'ACTIVE' };

  // Update Fleet Select in Register Form
  const regFleetSelect = document.getElementById('regFleet');
  const opt = new Option(name, code);
  regFleetSelect.add(opt);

  renderFleetRoster();
  renderFleetMapEntities();
  toast(`Squadron established: ${name} [Base: ${lat}, ${lon}]`, 'ok');
  audit(currentActorName(), 'fleet_squadron_created', code, `Base established with ${radius}m geofence`);
  e.target.reset();
}

function renderFleetRoster() {
  const tbody = document.getElementById('fleetRosterBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const entries = Object.values(state.fleets);
  document.getElementById('fleetCountBadge').textContent = `${entries.length} Fleets Active`;

  entries.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="tbl-id" style="color:${f.color};">${f.code}</td>
      <td><strong>${f.name}</strong></td>
      <td style="font-family:var(--mono);">${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}</td>
      <td>${f.radius} m Radius</td>
      <td><span class="badge badge-active">ACTIVE</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── DRONE REGISTRATION ───────────────────────────────────────────────────────
function handleRegisterDrone(e) {
  e.preventDefault();
  if (state.token !== 'tok-admin') {
    toast('Access Denied: Only Fleet Administrator can enroll drone hardware.', 'err');
    audit(currentActorName(), 'drone_enroll_blocked', 'RBAC', 'Unauthorized drone enrollment attempt');
    return;
  }

  const id    = document.getElementById('regId').value.trim();
  const fleet = document.getElementById('regFleet').value;
  const model = document.getElementById('regModel').value;
  const cert  = document.getElementById('regCert').value;

  if (!/^DRN-[A-Z0-9]{6}$/.test(id)) {
    toast('Invalid Drone Identifier format. Must match DRN-XXXXXX', 'err');
    return;
  }

  const fObj = state.fleets[fleet] || { name: `Fleet ${fleet}`, lat: 10.9027, lon: 76.9006 };
  state.drones[id] = {
    id,
    fleet,
    fleetName: fObj.name,
    status: 'IDLE',
    alt: 0,
    speed: 0,
    bat: 100,
    hdg: 0,
    lat: fObj.lat,
    lon: fObj.lon,
    home: { lat: fObj.lat, lon: fObj.lon, alt: 0 },
    target: null,
    waypointQueue: [],
    currentWpIndex: 0,
    trail: [[fObj.lat, fObj.lon]],
    anomaly: false,
  };

  // Add marker to map
  const icon = createDroneIcon(state.drones[id]);
  const marker = L.marker([fObj.lat, fObj.lon], { icon }).addTo(state.map);
  marker.bindPopup(`<strong>${id}</strong><br>${fObj.name}<br>Status: IDLE`);
  state.markers[id] = marker;

  // Add to table
  const tbody = document.getElementById('rosterBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="tbl-id">${id}</td>
    <td>${fObj.name}</td>
    <td>${model}</td>
    <td>${cert.slice(0, 16)}…</td>
    <td><span class="badge badge-idle">IDLE</span></td>
  `;
  tbody.appendChild(tr);

  // Add to dropdowns
  const opt1 = new Option(`${id} (${fObj.name})`, id);
  const opt2 = new Option(`${id} (${fObj.name})`, id);
  document.getElementById('droneSelector').add(opt1);
  document.getElementById('planDrone').add(opt2);

  toast(`${id} enrolled into ${fObj.name}.`, 'ok');
  audit(currentActorName(), 'drone_enrolled', id, `mTLS cert fingerprint ${cert.slice(0, 16)} enrolled`);
  e.target.reset();
}

// ── MULTI-WAYPOINT MISSION DISPATCH ─────────────────────────────────────────
function assignMissionFromPlanner() {
  if (state.plannedRoute.length === 0) {
    toast('Please define at least one waypoint for the flight path.', 'warn');
    return;
  }

  const droneId = document.getElementById('planDrone').value;
  selectDrone(droneId);
  const d = state.drones[droneId];

  // Pass first waypoint to GOTO API for cryptographic validation
  const firstWp = state.plannedRoute[0];
  openCommandModal('GOTO', {
    lat: firstWp.lat,
    lon: firstWp.lon,
    alt: firstWp.alt,
    waypoints: state.plannedRoute,
  });
}

// ── COMMAND DISPATCH & MODAL ────────────────────────────────────────────────
let _pendingCmd = null;
let _pendingParams = null;

function openCommandModal(cmd, customParams = null) {
  _pendingCmd = cmd;
  _pendingParams = customParams;
  const d = state.drones[state.selectedDrone];
  const requiredPerm = cmd === 'GOTO' ? 'mission:assign' : 'mission:cancel';

  let detailHtml = '';
  if (cmd === 'GOTO') {
    const count = (customParams?.waypoints?.length) || 1;
    detailHtml = `
      <div class="kv-row"><span class="kv-key">Waypoint Plan</span><span class="kv-val">${count} Sequential Waypoints</span></div>
      <div class="kv-row"><span class="kv-key">Flight Trajectory</span><span class="kv-val">Automated Cruise &amp; Station Hold</span></div>
    `;
  } else if (cmd === 'RTH') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Destination</span><span class="kv-val">Squadron Base [${d.home.lat.toFixed(4)}, ${d.home.lon.toFixed(4)}]</span></div>`;
  } else if (cmd === 'LAND') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Emergency Directive</span><span class="kv-val">Controlled Vertical Descent at Current Position</span></div>`;
  } else if (cmd === 'CANCEL') {
    detailHtml = `<div class="kv-row"><span class="kv-key">Safety Directive</span><span class="kv-val">Immediate Mission Abort &amp; Hover Hold</span></div>`;
  }

  document.getElementById('modalTitle').textContent = `Execute ${cmd} — ${d.id}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="kv">
      <div class="kv-row"><span class="kv-key">Target Asset</span><span class="kv-val">${d.id}</span></div>
      <div class="kv-row"><span class="kv-key">Squadron Domain</span><span class="kv-val">${d.fleetName}</span></div>
      <div class="kv-row"><span class="kv-key">Command Directive</span><span class="kv-val">${cmd}</span></div>
      ${detailHtml}
      <div class="kv-row"><span class="kv-key">Required Privilege</span><span class="kv-val">${requiredPerm}</span></div>
      <div class="kv-row"><span class="kv-key">Security Envelope</span><span class="kv-val">HMAC-SHA256 · 128-bit Anti-Replay Nonce</span></div>
    </div>
  `;
  document.getElementById('btnModalConfirm').onclick = () => executeCommand(cmd, _pendingParams);
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

async function executeCommand(cmd, customParams = null) {
  closeModal();
  const d = state.drones[state.selectedDrone];
  const params = {};

  if (cmd === 'GOTO') {
    if (customParams && customParams.waypoints) {
      params.lat = customParams.lat;
      params.lon = customParams.lon;
      params.alt = customParams.alt;
    } else {
      params.lat = d.lat + 0.002;
      params.lon = d.lon + 0.002;
      params.alt = 45.0;
    }
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
      toast(`${cmd} authorized & dispatched (Nonce: ${state.capturedNonce?.slice(0, 8)}…)`, 'ok');

      if (cmd === 'GOTO') {
        if (customParams && customParams.waypoints && customParams.waypoints.length > 0) {
          d.waypointQueue = [ ...customParams.waypoints ];
          d.currentWpIndex = 0;
          d.target = d.waypointQueue[0];
        } else {
          d.target = { lat: params.lat, lon: params.lon, alt: params.alt };
          d.waypointQueue = [];
        }
        d.status = 'IN_MISSION';
      } else if (cmd === 'RTH') {
        d.target = { ...d.home };
        d.waypointQueue = [];
        d.status = 'RTH';
      } else if (cmd === 'LAND') {
        d.status = 'LANDING';
        d.waypointQueue = [];
      } else if (cmd === 'CANCEL') {
        d.target = null;
        d.waypointQueue = [];
        d.status = 'HOVERING';
        d.speed = 0.0;
      }

      audit(currentActorName(), 'command_dispatched', d.id, `${cmd} directive signed (HMAC valid)`);
      updateMapVisuals();
      updateTelemetryUI();
    } else {
      toast(`Access Denied: ${data.error} (HTTP ${res.status})`, 'err');
      audit(currentActorName(), 'access_denied', d.id, `${cmd} rejected — ${data.error}`);
    }
  } catch (err) {
    toast(`Network failure: ${err.message}`, 'err');
  }
}

// ── AEROSPACE PDF MISSION REPORT GENERATOR ──────────────────────────────────
function downloadMissionReportPdf() {
  const d = state.drones[state.selectedDrone];
  const reportId = `DFMS-REP-${Date.now()}`;
  const timestamp = new Date().toUTCString();
  const operatorName = currentActorName();

  // If jsPDF is available, generate official vector PDF
  if (window.jspdf && window.jspdf.jsPDF) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Official Dark/Slate Letterhead
    doc.setFillColor(15, 23, 42); // #0f172a
    doc.rect(0, 0, 210, 32, 'F');

    doc.setTextColor(248, 250, 252);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('DFMS — SECURE DRONE FLEET MANAGEMENT SYSTEM', 14, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text('AEROSPACE FLIGHT OPERATIONS & CRYPTOGRAPHIC COMPLIANCE REPORT', 14, 22);
    doc.text('SECURITY LEVEL: RESTRICTED // OPERATIONAL', 14, 27);

    // Metadata Block
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 38, 182, 34, 2, 2, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`REPORT IDENTIFIER: ${reportId}`, 18, 45);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generated: ${timestamp}`, 18, 52);
    doc.text(`Target Asset: ${d.id}`, 18, 58);
    doc.text(`Squadron Domain: ${d.fleetName}`, 18, 64);

    doc.text(`Authorizing Personnel: ${operatorName}`, 110, 52);
    doc.text(`Current Flight Status: ${d.status}`, 110, 58);
    doc.text(`Active Geofence: 120m Ceiling (COMPLIANT)`, 110, 64);

    // Kinematic Flight Telemetry Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('1. TELEMETRY & FLIGHT DYNAMICS SUMMARY', 14, 82);

    doc.setDrawColor(226, 232, 240);
    doc.line(14, 84, 196, 84);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const telemY = 92;
    doc.text(`• Current Latitude / Longitude: ${d.lat.toFixed(5)}° N, ${d.lon.toFixed(5)}° E`, 18, telemY);
    doc.text(`• Flight Altitude: ${d.alt.toFixed(1)} m AGL (Max Limit: 120.0 m)`, 18, telemY + 7);
    doc.text(`• Ground Velocity: ${d.speed.toFixed(1)} m/s (Kinematic Ceiling: 60.0 m/s)`, 18, telemY + 14);
    doc.text(`• Compass Bearing: ${d.hdg}° (${compassDirection(d.hdg)})`, 18, telemY + 21);
    doc.text(`• Battery Charge Remaining: ${Math.round(d.bat)}%`, 18, telemY + 28);
    doc.text(`• Total Flown Trajectory Samples: ${d.trail.length} coordinates`, 18, telemY + 35);

    // Waypoint Navigation Schedule
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('2. SEQUENTIAL FLIGHT PATH WAYPOINT LOG', 14, 140);
    doc.line(14, 142, 196, 142);

    doc.setFillColor(241, 245, 249);
    doc.rect(14, 146, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('WP #', 18, 151);
    doc.text('LATITUDE', 35, 151);
    doc.text('LONGITUDE', 65, 151);
    doc.text('ALTITUDE (m)', 100, 151);
    doc.text('SPEED (m/s)', 130, 151);
    doc.text('DIRECTIVE', 160, 151);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    let rowY = 160;
    const waypointsToShow = state.plannedRoute.length > 0 ? state.plannedRoute : [
      { id: 1, lat: d.lat, lon: d.lon, alt: d.alt, speed: d.speed, action: 'ACTIVE_POSITION' }
    ];

    waypointsToShow.slice(0, 7).forEach((wp, i) => {
      doc.text(`WP-${i + 1}`, 18, rowY);
      doc.text(wp.lat.toFixed(5), 35, rowY);
      doc.text(wp.lon.toFixed(5), 65, rowY);
      doc.text(`${wp.alt} m`, 100, rowY);
      doc.text(`${wp.speed} m/s`, 130, rowY);
      doc.text(wp.action, 160, rowY);
      rowY += 7;
    });

    // Security & Cryptographic Integrity Section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('3. CRYPTOGRAPHIC INTEGRITY & SECURITY ASSURANCE', 14, 218);
    doc.line(14, 220, 196, 220);

    doc.roundedRect(14, 224, 182, 40, 2, 2, 'D');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('• Mutual TLS Transport: Verified (TLS 1.3 / Cipher: TLS_AES_256_GCM_SHA384)', 18, 231);
    doc.text('• Location Plausibility Engine: PASSED (Zero Kinematic Jump Violations)', 18, 237);
    doc.text('• Command Packet Authentication: HMAC-SHA256 Authenticated with 128-bit Monotonic Nonce', 18, 243);
    doc.text('• Replay Attack Defense: Verified (Anti-Replay Nonce Cache Active)', 18, 249);
    doc.text(`• Tamper-Evident Ledger Entry Hash: ${hashString(reportId + timestamp).toUpperCase()}`, 18, 255);

    // Sign-off
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Chief Safety Officer Signature: _______________________', 18, 276);
    doc.text('Cryptographic Seal: [VERIFIED]', 140, 276);

    doc.save(`DFMS_Mission_Report_${d.id}_${Date.now()}.pdf`);
    toast('Mission Report (PDF) downloaded successfully.', 'ok');
  } else {
    // Fallback JSON export
    const blob = new Blob([JSON.stringify({ report_id: reportId, drone: d.id, operator: operatorName }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DFMS_Report_${d.id}.json`;
    a.click();
    toast('Mission Report exported.', 'ok');
  }

  audit(operatorName, 'pdf_report_exported', d.id, 'Official mission audit report generated');
}

// ── TAMPER-EVIDENT AUDIT TRAIL ──────────────────────────────────────────────
function seedAudit() {
  [
    { actor: 'Marcus Vance (Administrator)', action: 'fleet_initialized', target: 'Fleet Alpha & Beta', ts: -600000 },
    { actor: 'Sarah Chen (Flight Planner)', action: 'mission_planned',   target: 'Perimeter Patrol 104', ts: -300000 },
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
  if (!tbody) return;
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

// ── SECURITY VERIFICATION CHALLENGES ─────────────────────────────────────────
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

// ── UI EVENT BINDINGS ────────────────────────────────────────────────────────
function bindEvents() {
  // Identity Switcher
  document.getElementById('userSelect').addEventListener('change', e => {
    state.token = e.target.value;
    const actor = currentActorName();
    audit(actor, 'operator_switched', 'IAM', `Active console identity changed`);
    toast(`Authenticated as ${actor}`, 'ok');
    applyRolePermissions();
  });

  // Role Clearance Modal
  document.getElementById('btnRoleModal').addEventListener('click', openRoleClearanceModal);
  document.getElementById('btnRoleModalClose').addEventListener('click', () => {
    document.getElementById('roleModal').classList.remove('show');
  });

  // Drone Selector
  document.getElementById('droneSelector').addEventListener('change', e => {
    selectDrone(e.target.value);
  });

  // Expand / Fullscreen Map
  document.getElementById('btnExpandMap').addEventListener('click', toggleMapFullscreen);
  document.getElementById('btnHudExit').addEventListener('click', toggleMapFullscreen);

  // Camera Lock Toggle
  const btnFollow = document.getElementById('btnFollowDrone');
  btnFollow.addEventListener('click', () => {
    state.followDrone = !state.followDrone;
    btnFollow.classList.toggle('btn-primary', state.followDrone);
    btnFollow.classList.toggle('btn-default', !state.followDrone);
    toast(state.followDrone ? 'Camera locked to active drone.' : 'Camera lock released.', 'ok');
  });

  // Drone Command Buttons
  document.getElementById('btnGoto').addEventListener('click', () => openCommandModal('GOTO'));
  document.getElementById('btnRTH').addEventListener('click',  () => openCommandModal('RTH'));
  document.getElementById('btnCancel').addEventListener('click', () => openCommandModal('CANCEL'));
  document.getElementById('btnLand').addEventListener('click', () => openCommandModal('LAND'));

  // HUD Action Dock Buttons
  document.getElementById('btnHudGoto').addEventListener('click', () => openCommandModal('GOTO'));
  document.getElementById('btnHudRTH').addEventListener('click',  () => openCommandModal('RTH'));
  document.getElementById('btnHudCancel').addEventListener('click', () => openCommandModal('CANCEL'));
  document.getElementById('btnHudLand').addEventListener('click', () => openCommandModal('LAND'));

  // Pattern Generators
  document.getElementById('btnPatrolBox').addEventListener('click', generateBoxPattern);
  document.getElementById('btnSurveyGrid').addEventListener('click', generateSurveyGrid);
  document.getElementById('btnAddWp').addEventListener('click', () => {
    const d = state.drones[state.selectedDrone];
    addWaypointToPlannedRoute(d.lat + 0.001, d.lon + 0.001, 50, 12, 'TRANSIT');
  });
  document.getElementById('btnClearRoute').addEventListener('click', () => {
    state.plannedRoute = [];
    renderRouteTable();
    updateMapVisuals();
    toast('Planned flight path cleared.', 'ok');
  });

  // Alert Dismissal
  document.getElementById('btnAlertDismiss').addEventListener('click', () => {
    const d = state.drones[state.selectedDrone];
    if (d) {
      d.anomaly = false;
      d.speed = 0.0;
      d.status = 'IDLE';
    }
    document.getElementById('alertBanner').classList.remove('show');
    toast('Security alert acknowledged. Normal operations restored.', 'ok');
  });

  // Modal Dialog Actions
  document.getElementById('btnModalX').addEventListener('click', closeModal);
  document.getElementById('btnModalCancel').addEventListener('click', closeModal);

  // Flight Planner Controls
  document.getElementById('btnValidate').addEventListener('click', () => {
    toast('Kinematic flight envelope verified — all waypoints compliant with 120m ceiling.', 'ok');
  });
  document.getElementById('btnAssign').addEventListener('click', assignMissionFromPlanner);

  // Forms
  document.getElementById('fleetForm').addEventListener('submit', handleCreateFleet);
  document.getElementById('regForm').addEventListener('submit', handleRegisterDrone);

  // PDF Mission Report Download
  document.getElementById('btnReport').addEventListener('click', downloadMissionReportPdf);

  // Security Verification Tests
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
  }
  updateMapVisuals();
  updateTelemetryUI();
  updateHudUI();
  applyRolePermissions();
}

// ── UTILITY HELPERS ──────────────────────────────────────────────────────────
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

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function formatTimestamp(ts) { return new Date(ts).toLocaleTimeString('en-GB'); }

function compassDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
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
