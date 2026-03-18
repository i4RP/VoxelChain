/**
 * WebWorker for chunk mesh generation.
 * Offloads geometry computation from the main thread for better FPS.
 * Supports UV-mapped texture atlas.
 *
 * Messages IN:  { type: "buildMesh", chunkKey, blocks, neighborBlocks, blockDefs, uvMap }
 * Messages OUT: { type: "meshBuilt", chunkKey, opaque: {positions,normals,uvs,colors,indices}, transparent: {...} }
 */

const CHUNK_SIZE = 16;

// Face definitions with UV corner mapping (matching Chunk.js)
const FACES = [
  { dir: [0, 1, 0], verts: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], normal: [0,1,0], face: "top", uvC: [[0,0],[1,0],[1,1],[0,1]] },
  { dir: [0, -1, 0], verts: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], normal: [0,-1,0], face: "bottom", uvC: [[0,0],[1,0],[1,1],[0,1]] },
  { dir: [1, 0, 0], verts: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], normal: [1,0,0], face: "side", uvC: [[0,0],[0,1],[1,1],[1,0]] },
  { dir: [-1, 0, 0], verts: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], normal: [-1,0,0], face: "side", uvC: [[0,0],[0,1],[1,1],[1,0]] },
  { dir: [0, 0, 1], verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], normal: [0,0,1], face: "side", uvC: [[0,0],[1,0],[1,1],[0,1]] },
  { dir: [0, 0, -1], verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], normal: [0,0,-1], face: "side", uvC: [[0,0],[1,0],[1,1],[0,1]] },
];

function isTransparent(blockDefs, blockType) {
  const def = blockDefs[blockType];
  return def ? !!def.transparent : true;
}

/**
 * Build mesh geometry data for a chunk with UV texture atlas support.
 */
function buildMeshData(blocks, neighborBlocks, blockDefs, uvMap) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const tPositions = [], tNormals = [], tUvs = [], tColors = [], tIndices = [];
  let vc = 0, tvc = 0;

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = z * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + x;
        const bt = blocks[idx];
        if (bt === 0) continue;

        const isT = isTransparent(blockDefs, bt);

        for (const face of FACES) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];

          let neighborType;
          if (nx < 0 || nx >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
            const key = `${nx},${ny},${nz}`;
            neighborType = neighborBlocks[key] || 0;
          } else {
            neighborType = blocks[nz * CHUNK_SIZE * CHUNK_SIZE + ny * CHUNK_SIZE + nx];
          }

          const nDef = blockDefs[neighborType];
          if (neighborType !== 0 && nDef && !nDef.transparent) continue;
          if (isT && neighborType === bt) continue;

          // Get UV from atlas map
          const blockUV = uvMap ? uvMap[bt] : null;
          let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
          if (blockUV) {
            const faceUV = blockUV[face.face] || blockUV.side || [0, 0, 1, 1];
            u0 = faceUV[0]; v0 = faceUV[1]; u1 = faceUV[2]; v1 = faceUV[3];
          }

          const ao = face.dir[1] === -1 ? 0.7 : face.dir[1] === 0 ? 0.85 : 1.0;

          const tP = isT ? tPositions : positions;
          const tN = isT ? tNormals : normals;
          const tU = isT ? tUvs : uvs;
          const tC = isT ? tColors : colors;
          const tI = isT ? tIndices : indices;
          const curVc = isT ? tvc : vc;

          for (let vi = 0; vi < 4; vi++) {
            const v = face.verts[vi];
            tP.push(x + v[0], y + v[1], z + v[2]);
            tN.push(face.normal[0], face.normal[1], face.normal[2]);
            const cu = face.uvC[vi][0];
            const cv = face.uvC[vi][1];
            tU.push(u0 + cu * (u1 - u0), v0 + cv * (v1 - v0));
            tC.push(ao, ao, ao);
          }
          tI.push(curVc, curVc + 1, curVc + 2, curVc, curVc + 2, curVc + 3);

          if (isT) tvc += 4;
          else vc += 4;
        }
      }
    }
  }

  return {
    opaque: positions.length > 0
      ? { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
      : null,
    transparent: tPositions.length > 0
      ? { positions: new Float32Array(tPositions), normals: new Float32Array(tNormals), uvs: new Float32Array(tUvs), colors: new Float32Array(tColors), indices: new Uint32Array(tIndices) }
      : null,
  };
}

self.onmessage = function (e) {
  const { type, chunkKey, blocks, neighborBlocks, blockDefs, uvMap } = e.data;
  if (type !== "buildMesh") return;

  const result = buildMeshData(
    new Uint16Array(blocks),
    neighborBlocks || {},
    blockDefs || {},
    uvMap || null
  );

  // Transfer typed arrays for zero-copy performance
  const transferables = [];
  if (result.opaque) {
    transferables.push(
      result.opaque.positions.buffer,
      result.opaque.normals.buffer,
      result.opaque.uvs.buffer,
      result.opaque.colors.buffer,
      result.opaque.indices.buffer
    );
  }
  if (result.transparent) {
    transferables.push(
      result.transparent.positions.buffer,
      result.transparent.normals.buffer,
      result.transparent.uvs.buffer,
      result.transparent.colors.buffer,
      result.transparent.indices.buffer
    );
  }

  self.postMessage({ type: "meshBuilt", chunkKey, ...result }, transferables);
};
