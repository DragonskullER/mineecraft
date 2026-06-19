// main_opt.js - very low-overhead client tuned for extremely old hardware
// Features:
// - Detects very-low-end devices and falls back to a 2D canvas renderer.
// - Uses worker-based greedy meshing to produce compact BufferGeometry per chunk and transfers ArrayBuffers.
// - Aggressive defaults: low DPR, small canvas, tiny render distance, single material, vertex colors.
// - Batched updates and very low network/load frequency.

import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';

// --- Device capability detection ---
const deviceIsVeryOld = (() => {
  try {
    const mem = navigator.deviceMemory || 0;
    const ua = navigator.userAgent || '';
    const oldGPU = /intel hd|gma|radeon x1600|radeon x1900|nvidia geforce 8600/i.test(ua);
    return mem > 0 ? mem <= 1 || oldGPU : /windows nt 6.0|windows nt 5.1|mac os x 10_5|mac os x 10_6/i.test(ua);
  } catch (e) { return false; }
})();

if (deviceIsVeryOld) {
  startCanvas2DFallback();
} else {
  startThreeOptimized();
}

// ------------------ Canvas2D fallback ------------------
function startCanvas2DFallback() {
  // Extremely low-cost renderer: top-down orthographic colored tiles.
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  canvas.style.width = '640px'; canvas.style.height = '480px';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#87ceeb'; ctx.fillRect(0,0,canvas.width,canvas.height);

  // Simple low-cost pseudo-world: draw heightmap as colored tiles
  const CHUNK = 16; const VISIBLE = 3; const TILE = 8; // small tile size

  function pseudoNoise(x,z) {
    const s = Math.sin(x*12.9898 + z*78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  function draw() {
    ctx.fillStyle = '#87ceeb'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const ox = Math.floor(canvas.width/2 - (CHUNK*VISIBLE*TILE)/2);
    const oz = Math.floor(canvas.height/2 - (CHUNK*VISIBLE*TILE)/2);
    for (let cx=-VISIBLE; cx<=VISIBLE; cx++) {
      for (let cz=-VISIBLE; cz<=VISIBLE; cz++) {
        for (let x=0; x<CHUNK; x++) {
          for (let z=0; z<CHUNK; z++) {
            const wx = (cx*CHUNK)+x;
            const wz = (cz*CHUNK)+z;
            const n = pseudoNoise(wx*0.1, wz*0.1);
            const h = Math.floor(n*6);
            // color by height
            const col = h > 4 ? '#8b7765' : (h>2 ? '#8db360' : '#e0d28c');
            ctx.fillStyle = col;
            const sx = ox + (cx+VISIBLE)*CHUNK*TILE + x*TILE;
            const sy = oz + (cz+VISIBLE)*CHUNK*TILE + z*TILE - h*TILE*0.5;
            ctx.fillRect(sx, sy, TILE, TILE);
          }
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ------------------ Three optimized path ------------------
function startThreeOptimized() {
  // renderer with conservative settings
  const width = 800; const height = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1); // no DPR scaling
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(60, width/height, 0.1, 1000);
  camera.position.set(20, 20, 20);
  camera.lookAt(8,6,8);

  // basic lighting via ambient only
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  // material: single MeshBasicMaterial with vertexColors
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, flatShading: true });

  // chunk management
  const CHUNK = 16; const MAXH = 20; const RENDER_CHUNKS = 2; // tiny view distance
  const chunks = new Map(); // key -> mesh
  const worker = new Worker('./meshWorker.js');

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'mesh') {
      // reconstruct geometry from transferred buffers
      const key = `${msg.cx},${msg.cz}`;
      // dispose existing
      if (chunks.has(key)) {
        const prev = chunks.get(key);
        scene.remove(prev);
      }
      const pos = new Float32Array(msg.position); // transferable
      const norm = new Float32Array(msg.normal);
      const color = new Float32Array(msg.color);
      const idx = (msg.indexBits === 32) ? new Uint32Array(msg.index) : new Uint16Array(msg.index);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(msg.cx*CHUNK, 0, msg.cz*CHUNK);
      scene.add(mesh);
      chunks.set(key, mesh);

      // keep chunks Map small: remove far chunks
      if (chunks.size > (RENDER_CHUNKS*2+1)*(RENDER_CHUNKS*2+1)*2) {
        // naive prune: remove random oldest
        for (const k of chunks.keys()) { if (chunks.size <= (RENDER_CHUNKS*2+1)*(RENDER_CHUNKS*2+1)) break; const m = chunks.get(k); scene.remove(m); chunks.delete(k); }
      }
    }
  };

  // request initial chunks around origin
  for (let cx=-RENDER_CHUNKS; cx<=RENDER_CHUNKS; cx++) {
    for (let cz=-RENDER_CHUNKS; cz<=RENDER_CHUNKS; cz++) {
      worker.postMessage({ cmd:'build', cx, cz, size: CHUNK, maxH: MAXH, seed: 42 });
    }
  }

  // render loop (very cheap)
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}
