// main.js - client with improved networking (delta updates, interpolation/extrapolation, interest culling)
// and polished controls + webGUI cheats integrated into controls menu with keybind remapping stored in localStorage.

import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js';

// ---- Scene setup (same lightweight scene) ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(24, 20, 24);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(8, 4, 8);
controls.update();
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(100, 200, 100);
scene.add(sun);
const grid = new THREE.GridHelper(128, 128, 0x000000, 0x000000);
grid.material.opacity = 0.15; grid.material.transparent = true;
scene.add(grid);

// ---- Local player state ----
const localPlayer = {
  id: null,
  pos: new THREE.Vector3(12, 6, 12),
  vel: new THREE.Vector3(),
  health: 100,
  cheats: { fly: false, speed: 1.0, god: false },
  lastSentPos: new THREE.Vector3(),
  seq: 0,
};

// Other players: store history for interpolation
const otherPlayers = new Map(); // id -> {mesh, history: [{t,x,y,z}], health, cheats}
function createPlayerMesh(color = 0xff0000) {
  const g = new THREE.BoxGeometry(0.8, 1.6, 0.8);
  const m = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(0, 1.0, 0);
  return mesh;
}
const localMesh = createPlayerMesh(0x0066ff);
scene.add(localMesh);

// ---- Controls UI, keybinding remapping, and webGUI integration ----
const storageKey = 'mineecraft_controls_v1';
const defaultBindings = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', attack: 'Mouse0' };
let bindings = loadBindings();

function loadBindings() {
  try { const s = localStorage.getItem(storageKey); if (s) return JSON.parse(s); } catch (e) {}
  localStorage.setItem(storageKey, JSON.stringify(defaultBindings));
  return Object.assign({}, defaultBindings);
}
function saveBindings() { localStorage.setItem(storageKey, JSON.stringify(bindings)); }

// Controls menu
const controlsMenu = document.createElement('div');
controlsMenu.style.cssText = 'position:fixed; right:8px; top:8px; width:260px; background:rgba(0,0,0,0.45); color:#fff; padding:10px; border-radius:8px; font-family:sans-serif; font-size:13px;';
controlsMenu.innerHTML = `
  <div style="font-weight:600;margin-bottom:6px">Controls</div>
  <div id="bindingsList" style="margin-bottom:8px"></div>
  <button id="remapBtn" style="width:100%;margin-bottom:6px">Remap Keys</button>
  <button id="webGUIBtn" style="width:100%">webGUI (cheats)</button>
  <div style="font-size:11px; opacity:0.85; margin-top:8px;">webGUI is allowed; toggles are sent to the server.</div>
`;
document.body.appendChild(controlsMenu);

const bindingsList = controlsMenu.querySelector('#bindingsList');
function renderBindings() {
  bindingsList.innerHTML = Object.entries(bindings).map(([k,v]) => `<div style="display:flex;justify-content:space-between"><div>${k}</div><div>${v}</div></div>`).join('');
}
renderBindings();

let remapping = false;
document.getElementById('remapBtn').addEventListener('click', () => {
  remapping = !remapping;
  document.getElementById('remapBtn').textContent = remapping ? 'Press a key for action (Esc to cancel)' : 'Remap Keys';
  if (remapping) {
    window.addEventListener('keydown', onRemapKey);
  } else {
    window.removeEventListener('keydown', onRemapKey);
  }
});
function onRemapKey(e) {
  if (e.code === 'Escape') { remapping = false; window.removeEventListener('keydown', onRemapKey); document.getElementById('remapBtn').textContent = 'Remap Keys'; return; }
  // For demo, remap the first action (forward) -> rotates through actions for simplicity
  // In a complete UI you'd ask which action to set; here we set 'forward' for demo convenience
  bindings.forward = e.code;
  saveBindings();
  renderBindings();
  remapping = false;
  window.removeEventListener('keydown', onRemapKey);
  document.getElementById('remapBtn').textContent = 'Remap Keys';
}

// webGUI modal (cheats)
const webGUIModal = document.createElement('div');
webGUIModal.style.cssText = 'position:fixed; right:8px; top:220px; width:300px; max-width:90%; background:rgba(20,20,20,0.95); color:#fff; padding:12px; border-radius:8px; font-family:sans-serif; font-size:13px; display:none; z-index:9999;';
webGUIModal.innerHTML = `
  <div style="font-weight:700;margin-bottom:8px">webGUI — Cheats</div>
  <label><input type="checkbox" id="cheatFly"> Fly (toggle)</label><br>
  <label style="display:block;margin-top:6px">Speed: <input id="cheatSpeed" type="range" min="0.5" max="4" step="0.1" value="1"></label>
  <label style="display:block;margin-top:6px"><input type="checkbox" id="cheatGod"> Godmode</label>
  <div style="margin-top:10px;text-align:right"><button id="closeWebGUI">Close</button></div>
  <div style="font-size:11px;opacity:0.8;margin-top:8px;">Cheats are allowed on servers that accept them. Use responsibly.</div>
`;
document.body.appendChild(webGUIModal);
controlsMenu.querySelector('#webGUIBtn').addEventListener('click', () => webGUIModal.style.display = 'block');
document.getElementById('closeWebGUI').addEventListener('click', () => webGUIModal.style.display = 'none');

const cheatFlyEl = webGUIModal.querySelector('#cheatFly');
const cheatSpeedEl = webGUIModal.querySelector('#cheatSpeed');
const cheatGodEl = webGUIModal.querySelector('#cheatGod');

function applyCheatStateAndNotify() {
  localPlayer.cheats.fly = cheatFlyEl.checked;
  localPlayer.cheats.speed = parseFloat(cheatSpeedEl.value);
  localPlayer.cheats.god = cheatGodEl.checked;
  sendMessage({ type: 'cheat', cheats: localPlayer.cheats });
}
cheatFlyEl.addEventListener('change', applyCheatStateAndNotify);
cheatSpeedEl.addEventListener('input', applyCheatStateAndNotify);
cheatGodEl.addEventListener('change', applyCheatStateAndNotify);

// ---- Networking: WebSocket with delta updates and interest culling ----
const WS_URL = 'ws://localhost:8080'; // change when deploying
let ws = null;
let pingStart = 0;
let latency = 100; // ms estimate
let serverOffset = 0; // serverTime = Date.now() + serverOffset

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    console.log('WS open');
    sendMessage({ type: 'join', name: 'player_' + Math.floor(Math.random() * 1000), interestRadius: 48 });
    ping();
    setInterval(ping, 5000);
  };
  ws.onmessage = (evt) => { const msg = JSON.parse(evt.data); handleServerMessage(msg); };
  ws.onclose = () => { console.log('WS closed, reconnect in 2s'); setTimeout(connectWS, 2000); };
  ws.onerror = (e) => console.warn('WS error', e);
}
connectWS();

function ping() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  pingStart = Date.now();
  ws.send(JSON.stringify({ type: 'ping', t: pingStart }));
}

function sendMessage(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

// Delta-position sending: send only when moved > threshold or at least every 200ms
let lastSentAt = 0;
const SEND_INTERVAL = 200; // ms
const MOVE_THRESHOLD = 0.05; // units
function trySendPosition() {
  const now = Date.now();
  const moved = localPlayer.pos.distanceTo(localPlayer.lastSentPos) > MOVE_THRESHOLD;
  if (moved || (now - lastSentAt) > SEND_INTERVAL) {
    localPlayer.seq += 1;
    sendMessage({ type: 'pos', x: localPlayer.pos.x, y: localPlayer.pos.y, z: localPlayer.pos.z, seq: localPlayer.seq, t: now });
    localPlayer.lastSentPos.copy(localPlayer.pos);
    lastSentAt = now;
  }
}
setInterval(trySendPosition, 50);

// ---- Server messages and interpolation/extrapolation ----
function handleServerMessage(msg) {
  if (msg.type === 'welcome') {
    localPlayer.id = msg.id; localPlayer.health = msg.health;
    console.log('Welcome', msg);
  } else if (msg.type === 'pong') {
    const now = Date.now();
    const rtt = now - (msg.t || pingStart);
    latency = rtt / 2;
    serverOffset = (msg.serverTime || now) - now + latency; // serverTime - clientNow + latency
  } else if (msg.type === 'state') {
    // msg: {t: serverTime, players: [{id,x,y,z,health,cheats,vel?}]}
    const serverTime = msg.t || Date.now();
    for (const p of msg.players) {
      if (p.id === localPlayer.id) continue;
      let entry = otherPlayers.get(p.id);
      if (!entry) {
        const mesh = createPlayerMesh(Math.random() * 0xffffff);
        scene.add(mesh);
        entry = { mesh, history: [], health: p.health, cheats: p.cheats || {} };
        otherPlayers.set(p.id, entry);
      }
      // push to history with estimated client receive time
      const serverTs = p.t || serverTime;
      entry.history.push({ t: serverTs, x: p.x, y: p.y, z: p.z });
      // cap history
      if (entry.history.length > 10) entry.history.shift();
      entry.health = p.health;
      entry.cheats = p.cheats || {};
    }
    // prune players not present
    const ids = new Set(msg.players.map(p => p.id));
    for (const id of Array.from(otherPlayers.keys())) {
      if (!ids.has(id)) {
        const e = otherPlayers.get(id); scene.remove(e.mesh); otherPlayers.delete(id);
      }
    }
  } else if (msg.type === 'damage') {
    if (msg.target === localPlayer.id) {
      if (!localPlayer.cheats.god) {
        localPlayer.health = Math.max(0, localPlayer.health - msg.amount);
        if (localPlayer.health <= 0) { localPlayer.pos.set(12,6,12); localPlayer.health = 100; sendMessage({type:'respawn'}); }
      }
    }
  }
}

// Interpolate other players based on buffered history and estimated server time
function updateOtherPlayerPositions() {
  const now = Date.now();
  const renderServerTime = now + serverOffset - 100; // 100ms render delay for interpolation
  for (const entry of otherPlayers.values()) {
    const h = entry.history;
    if (h.length === 0) continue;
    // find two samples surrounding renderServerTime
    let a = null, b = null;
    for (let i = 0; i < h.length - 1; i++) {
      if (h[i].t <= renderServerTime && h[i+1].t >= renderServerTime) { a = h[i]; b = h[i+1]; break; }
    }
    if (!a || !b) {
      // extrapolate from last known
      const last = h[h.length - 1];
      entry.mesh.position.set(last.x, last.y + 0.8, last.z);
    } else {
      const alpha = (renderServerTime - a.t) / (b.t - a.t);
      const ix = a.x + (b.x - a.x) * alpha;
      const iy = a.y + (b.y - a.y) * alpha;
      const iz = a.z + (b.z - a.z) * alpha;
      entry.mesh.position.set(ix, iy + 0.8, iz);
    }
  }
}

// ---- PvP: click to attack (send attack request), server handles damage application and respects cheats as configured on server ----
renderer.domElement.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return;
  const mouse = new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, camera);
  const meshes = Array.from(otherPlayers.values()).map(v => v.mesh);
  const intersects = ray.intersectObjects(meshes, true);
  if (intersects.length > 0) {
    const hit = intersects[0].object;
    for (const [id, entry] of otherPlayers.entries()) {
      if (entry.mesh === hit) {
        sendMessage({ type: 'attack', target: id, t: Date.now() });
        break;
      }
    }
  }
});

// ---- Simple local movement for demo (WASD) ----
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);
function localMovementStep() {
  const speed = 0.08 * (localPlayer.cheats.speed || 1);
  const dir = new THREE.Vector3();
  if (keys[bindings.forward]) dir.z -= 1;
  if (keys[bindings.back]) dir.z += 1;
  if (keys[bindings.left]) dir.x -= 1;
  if (keys[bindings.right]) dir.x += 1;
  dir.normalize();
  dir.multiplyScalar(speed);
  localPlayer.pos.add(dir);
  if (keys[bindings.jump] && localPlayer.cheats.fly) { localPlayer.pos.y += 0.12; }
  else if (!localPlayer.cheats.fly) { localPlayer.pos.y = Math.max(1, localPlayer.pos.y - 0.04); }
  localMesh.position.copy(localPlayer.pos).add(new THREE.Vector3(0,0.8,0));
}
setInterval(localMovementStep, 16);

// ---- Main render loop ----
function animate() {
  requestAnimationFrame(animate);
  updateOtherPlayerPositions();
  renderer.render(scene, camera);
}
animate();

// ---- Periodic broadcasts from server (server will broadcast at server-defined intervals). Send periodic lightweight heartbeat if needed ----
setInterval(() => { trySendPosition(); }, 200);

// ---- handle server pong for latency estimation ----
// server message 'pong' handled above

// ---- cleanup on unload ----
window.addEventListener('beforeunload', () => { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); });
