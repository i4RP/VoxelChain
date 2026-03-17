/**
 * WebWorker for chunk mesh generation.
 * Offloads geometry computation from the main thread for better FPS.
 *
 * Messages IN:  { type: "buildMesh", chunkKey, cx, cy, cz, blocks, neighborBlocks, blockDefs }
 * Messages OUT: { type: "meshBuilt", chunkKey, opaque: {positions,normals,colors,indices}, transparent: {positions,normals,colors,indices} }
 */

const CHUNK_SIZE = 16;

// Face definitions matching Chunk.js
const FACES = [
  { dir: [0, 1, 0], verts: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], normal: [0,1,0], face: "top" },
  { dir: [0, -1, 0], verts: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], normal: [0,-1,0], face: "bottom" },
  { dir: [1, 0, 0], verts: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], normal: [1,0,0], face: "side" },
  { dir: [-1, 0, 0], verts: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], normal: [-1,0,0], face: "side" },
  { dir: [0, 0, 1], verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], normal: [0,0,1], face: "side" },
  { dir: [0, 0, -1], verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], normal: [0,0,-1], face: "side" },
];

/** Convert hex color to [r, g, b] floats */
function hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

function getBlockColor(blockDefs, blockType, faceName) {
  const def = blockDefs[blockType];
  if (!def) return [0.5, 0.5, 0.5];
  let hex;
  if (faceName === "top") hex = def.topColor || def.color || 0x808080;
  else if (faceName === "bottom") hex = def.bottomColor || def.sideColor || def.color || 0x808080;
  else hex = def.sideColor || def.color || 0x808080;
  return hexToRgb(hex);
}

function isTransparent(blockDefs, blockType) {
  const def = blockDefs[blockType];
  return def ? !!def.transparent : true;
}

/**
 * Build mesh geometry data for a chunk.
 * @param {Uint16Array} blocks - Flat array of block types
 * @param {Object} neighborBlocks - Map of "dx,dy,dz" -> block type at boundary
 * @param {Object} blockDefs - Block definitions keyed by type ID
 * @returns {{ opaque, transparent }} geometry data
 */
function buildMeshData(blocks, neighborBlocks, blockDefs) {
  const positions = [], normals = [], colors = [], indices = [];
  const tPositions = [], tNormals = [], tColors = [], tIndices = [];
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
            // Look up from neighbor data
            const key = `${nx},${ny},${nz}`;
            neighborType = neighborBlocks[key] || 0;
          } else {
            neighborType = blocks[nz * CHUNK_SIZE * CHUNK_SIZE + ny * CHUNK_SIZE + nx];
          }

          const nDef = blockDefs[neighborType];
          if (neighborType !== 0 && nDef && !nDef.transparent) continue;
          if (isT && neighborType === bt) continue;

          const [cr, cg, cb] = getBlockColor(blockDefs, bt, face.face);
          const ao = face.dir[1] === -1 ? 0.7 : face.dir[1] === 0 ? 0.85 : 1.0;

          const tP = isT ? tPositions : positions;
          const tN = isT ? tNormals : normals;
          const tC = isT ? tColors : colors;
          const tI = isT ? tIndices : indices;
          const curVc = isT ? tvc : vc;

          for (const v of face.verts) {
            tP.push(x + v[0], y + v[1], z + v[2]);
            tN.push(face.normal[0], face.normal[1], face.normal[2]);
            tC.push(cr * ao, cg * ao, cb * ao);
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
      ? { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
      : null,
    transparent: tPositions.length > 0
      ? { positions: new Float32Array(tPositions), normals: new Float32Array(tNormals), colors: new Float32Array(tColors), indices: new Uint32Array(tIndices) }
      : null,
  };
}

self.onmessage = function (e) {
  const { type, chunkKey, blocks, neighborBlocks, blockDefs } = e.data;
  if (type !== "buildMesh") return;

  const result = buildMeshData(
    new Uint16Array(blocks),
    neighborBlocks || {},
    blockDefs || {}
  );

  // Transfer typed arrays for zero-copy performance
  const transferables = [];
  if (result.opaque) {
    transferables.push(
      result.opaque.positions.buffer,
      result.opaque.normals.buffer,
      result.opaque.colors.buffer,
      result.opaque.indices.buffer
    );
  }
  if (result.transparent) {
    transferables.push(
      result.transparent.positions.buffer,
      result.transparent.normals.buffer,
      result.transparent.colors.buffer,
      result.transparent.indices.buffer
    );
  }

  self.postMessage({ type: "meshBuilt", chunkKey, ...result }, transferables);
};
