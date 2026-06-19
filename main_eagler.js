// main_eagler.js — Eagler-inspired browser client (original code)
// Small, self-contained 3D client that uses meshWorker.js for greedy meshing
// and eagler-ui.js for HUD/controls/webGUI integration.

import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import './eagler-ui.js'; // registers window.EaglerUI helper

// conservative renderer for broad compatibility
const WIDTH = 800, HEIGHT = 600;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(WIDTH, HEIGHT);
document.body.appendChild(renderer.domElement);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(75, WIDTH / HEIGHT, 0.1, 1000);
camera.position.set(24, 24, 24);
camera.lookAt(8, 6, 8);

// ambient-only lighting for low cost
scene.add(new THREE.AmbientLight(0xffffff, 0.95));

// tiny texture atlas generated at runtime (32x32) — avoids adding binary files
function createTinyAtlas() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  // 4 tiles (2x2): grass, dirt, stone, sand
  const tile = 16;
  // grass
  ctx.fillStyle = '#6fa84f'; ctx.fillRect(0, 0, tile, tile);
  // dirt
  ctx.fillStyle = '#7a4f2b'; ctx.fillRect(tile, 0, tile, tile);
  // stone
  ctx.fillStyle = '#6b6b6b'; ctx.fillRect(0, tile, tile, tile);
  // sand
  ctx.fillStyle = '#e0d28c'; ctx.fillRect(tile, tile, tile, tile);
  return new THREE.CanvasTexture(c);
}
const atlas = createTinyAtlas();
atlas.magFilter = THREE.NearestFilter; atlas.minFilter = THREE.NearestMipmapNearestFilter;

const material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });

// worker-based greedy meshing
const worker = new Worker('./meshWorker.js');
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'mesh') return;
  const pos = new Float32Array(m.position);
  const norm = new Float32Array(m.normal);
  const col = new Float32Array(m.color);
  const idx = (m.indexBits === 32) ? new Uint32Array(m.index) : new Uint16Array(m.index);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.computeBoundingSphere();
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(m.cx * 16, 0, m.cz * 16);
  scene.add(mesh);
};

// request a small 3x3 area of chunks centered at origin for demo
const CHUNK = 16, MAXH = 20;
for (let cx=-1; cx<=1; cx++) for (let cz=-1; cz<=1; cz++) worker.postMessage({ cmd: 'build', cx, cz, size: CHUNK, maxH: MAXH, seed: 42 });

// HUD & controls (Eagler-inspired minimal)
// EaglerUI is provided by eagler-ui.js which exposes EaglerUI.init(options)
if (window.EaglerUI && typeof window.EaglerUI.init === 'function') {
  window.EaglerUI.init({ onToggleUltraLow: () => applyUltraLow() });
}

function applyUltraLow() {
  // lower rendering cost: reduce canvas size, turn off lighting, reduce chunks
  renderer.setSize(640, 480);
  camera.aspect = 640 / 480; camera.updateProjectionMatrix();
  // optionally remove some scene elements, here we simply cap frame rate
  throttleFPS = true;
}

let throttleFPS = false;
let lastFrame = 0;
function animate(t) {
  if (throttleFPS) {
    if (t - lastFrame < 1000/20) { requestAnimationFrame(animate); return; } // 20 FPS
    lastFrame = t;
  }
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
