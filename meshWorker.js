// meshWorker.js - Greedy meshing worker for voxel chunks
// Receives: { cmd: 'build', cx, cz, size, maxH, seed }
// Responds: { type: 'mesh', cx, cz, position: ArrayBuffer, normal: ArrayBuffer, color: ArrayBuffer, index: ArrayBuffer, indexBits }

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.cmd === 'build') {
    const { cx, cz, size, maxH, seed } = msg;
    const vox = generateVoxels(cx, cz, size, maxH, seed);
    const mesh = greedyMesh(vox, size, maxH);
    // prepare TypedArrays
    const pos = new Float32Array(mesh.positions);
    const norm = new Float32Array(mesh.normals);
    const color = new Float32Array(mesh.colors);
    const index = (mesh.positions.length / 3 > 65535) ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
    const indexBits = (index.BYTES_PER_ELEMENT === 4) ? 32 : 16;
    // post transferable buffers
    self.postMessage({ type: 'mesh', cx, cz, position: pos.buffer, normal: norm.buffer, color: color.buffer, index: index.buffer, indexBits }, [pos.buffer, norm.buffer, color.buffer, index.buffer]);
  }
});

function pseudoNoise(x, z, seed) {
  const s = Math.sin((x * 127.1 + z * 311.7 + seed * 12.9898) * 0.0001);
  const c = Math.cos((x * 269.5 + z * 183.3 + seed * 78.233) * 0.0001);
  return fract(s * 43758.5453) * 0.5 + fract(c * 24634.6345) * 0.5;
}
function fract(x) { return x - Math.floor(x); }

function generateVoxels(cx, cz, size, maxH, seed) {
  // create 3D boolean array as flat typed array [x + y*size + z*size*maxH]
  const w = size, h = maxH, d = size;
  const vox = new Uint8Array(w * h * d);
  let idx = 0;
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const worldX = cx * size + x;
      const worldZ = cz * size + z;
      const n1 = pseudoNoise(worldX * 0.12, worldZ * 0.12, seed);
      const n2 = pseudoNoise(worldX * 0.4, worldZ * 0.4, seed + 1) * 0.5;
      const height = Math.max(1, Math.floor((n1 + n2) * (h * 0.5)));
      for (let y = 0; y < h; y++) {
        const filled = y < height ? 1 : 0;
        vox[x + y*w + z*(w*h)] = filled;
      }
    }
  }
  return { data: vox, size: w, height: h, depth: d };
}

function greedyMesh(voxObj, sizeX, sizeY) {
  const vox = voxObj.data;
  const W = voxObj.size, H = voxObj.height, D = voxObj.depth;
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let vertCount = 0;

  // helper to get voxel
  function V(x,y,z){
    if (x<0||x>=W||y<0||y>=H||z<0||z>=D) return 0;
    return vox[x + y*W + z*(W*H)];
  }

  // For each axis
  // Based on Mikola Lysenko's greedy meshing algorithm
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const dims = [W, H, D];
    const x = [0,0,0];
    const q = [0,0,0];
    q[d] = 1;

    const mask = new Int32Array(dims[u]*dims[v]);

    for (x[d] = -1; x[d] < dims[d]; ) {
      // compute mask
      let n = 0;
      for (x[v]=0; x[v]<dims[v]; x[v]++) {
        for (x[u]=0; x[u]<dims[u]; x[u]++) {
          const a = (x[d] >= 0) ? V(x[0], x[1], x[2]) : 0;
          const b = (x[d] < dims[d]-1) ? V(x[0]+q[0], x[1]+q[1], x[2]+q[2]) : 0;
          // if a and b differ, mask = a?1:-1? but we need material and direction
          if (a !== b) {
            mask[n++] = a ? 1 : -1;
          } else {
            mask[n++] = 0;
          }
        }
      }

      x[d]++;
      // greedy merge on mask
      n = 0;
      for (let j=0;j<dims[v];j++){
        for (let i=0;i<dims[u];) {
          const c = mask[n];
          if (c !== 0) {
            // compute width
            let w=1;
            while (i+w<dims[u] && mask[n+w]===c) w++;
            // compute height
            let h=1; let k=0;
            outer: for (; j+h<dims[v]; h++){
              for (k=0;k<w;k++){
                if (mask[n + k + h*dims[u]] !== c) break outer;
              }
            }
            // create quad
            // x0..x2 are coordinates in 3D; build vertices
            const du = [0,0,0]; du[u] = w;
            const dv = [0,0,0]; dv[v] = h;
            const x0 = [x[0], x[1], x[2]];
            x0[u] = i; x0[v] = j; x0[d] = x[d]-1;

            // depending on c sign, normal direction
            const normal = [0,0,0]; normal[d] = c>0 ? 1 : -1;

            // corners
            const p0 = [x0[0], x0[1], x0[2]];
            const p1 = [x0[0] + du[0], x0[1] + du[1], x0[2] + du[2]];
            const p2 = [x0[0] + du[0] + dv[0], x0[1] + du[1] + dv[1], x0[2] + du[2] + dv[2]];
            const p3 = [x0[0] + dv[0], x0[1] + dv[1], x0[2] + dv[2]];

            // convert to world coords (blocks are unit cubes), shift because quads lie on face
            // For face on positive side, quad should be on x[d] plane at x[d]
            const faceOffset = (c>0) ? 1 : 0; // position face accordingly

            // push vertices (p0..p3) offset by faceOffset along d
            const verts = [p0, p1, p2, p3];
            for (let vi=0; vi<4; vi++){
              const vx = verts[vi][0] + (d===0 ? faceOffset : 0);
              const vy = verts[vi][1] + (d===1 ? faceOffset : 0);
              const vz = verts[vi][2] + (d===2 ? faceOffset : 0);
              // world position
              positions.push(vx, vy, vz);
              normals.push(normal[0], normal[1], normal[2]);
              // color based on height (y)
              const col = colorForHeight(verts[vi][1]);
              colors.push(col[0], col[1], col[2]);
            }
            // indices (two triangles) - note triangle winding depends on normal
            if (c > 0) {
              indices.push(vertCount, vertCount+1, vertCount+2, vertCount, vertCount+2, vertCount+3);
            } else {
              // flipped
              indices.push(vertCount, vertCount+2, vertCount+1, vertCount, vertCount+3, vertCount+2);
            }
            vertCount += 4;

            // zero-out mask
            for (let l=0;l<h;l++){
              for (let k=0;k<w;k++){
                mask[n + k + l*dims[u]] = 0;
              }
            }

            i += w;
            n += w;
          } else {
            i++; n++;
          }
        }
      }
    }
  }

  return { positions, normals, colors, indices };
}

function colorForHeight(y) {
  // simple palette: low = sand, mid = grass, high = rock
  if (y > 12) return [0.54, 0.47, 0.40];
  if (y > 6) return [0.55, 0.7, 0.38];
  return [0.88, 0.83, 0.55];
}
