/**
 * Room detection. A "room" is a connected region of non-boundary tiles that
 * does NOT touch the map edge — i.e. fully enclosed by walls and/or doors.
 * Doors always count as boundary here (even when open) so a colony with a
 * single doorway still has a well-defined room.
 *
 * Output: a per-tile `roomId` lookup (0 = exterior-or-boundary, 1+ = room id)
 * and a `Map<id, Room>` keyed by id. Rebuilt via the `rooms` dirty system
 * when the `topology` tag is marked (on wall/door placement or deconstruction).
 *
 * Auto-roof queueing (in src/systems/autoRoof.js) iterates interior tiles per
 * room to post roof BuildSites. Per-tile roof state lives on `tileGrid.roof`
 * directly — lighting + rendering consume it without going through rooms.
 */

/**
 * @typedef {Object} Room
 * @property {number} id
 * @property {number[]} tiles   tile indices (grid.idx(i,j))
 * @property {number} area      tiles.length, cached
 *
 * @typedef {Object} RoomRegistry
 * @property {Uint16Array} roomId           tile-index → room id (0 = none)
 * @property {Map<number, Room>} rooms      id → Room
 * @property {() => void} rebuild
 * @property {(i: number, j: number) => Room | null} getRoomAt
 */

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {RoomRegistry}
 */
export function createRooms(grid) {
  const { W, H } = grid;
  const size = W * H;
  const roomId = new Uint16Array(size);
  /** @type {Map<number, Room>} */
  const rooms = new Map();
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  const scratch = new Int32Array(size);

  /** @param {number} k */
  function isBoundary(k) {
    return grid.wall[k] !== 0 || grid.door[k] !== 0;
  }

  function rebuild() {
    roomId.fill(0);
    rooms.clear();
    visited.fill(0);
    let nextId = 1;

    for (let k0 = 0; k0 < size; k0++) {
      if (visited[k0]) continue;
      if (isBoundary(k0)) {
        visited[k0] = 1;
        continue;
      }
      // BFS the connected non-boundary component. If any tile in it touches
      // the map edge, the component is exterior (not a room).
      let qHead = 0;
      let qTail = 0;
      let tileCount = 0;
      let touchesEdge = false;
      queue[qTail++] = k0;
      visited[k0] = 1;
      while (qHead < qTail) {
        const k = queue[qHead++];
        const i = k % W;
        const j = (k - i) / W;
        scratch[tileCount++] = k;
        if (i === 0 || j === 0 || i === W - 1 || j === H - 1) touchesEdge = true;
        if (i > 0) {
          const nk = k - 1;
          if (!visited[nk] && !isBoundary(nk)) {
            visited[nk] = 1;
            queue[qTail++] = nk;
          }
        }
        if (i < W - 1) {
          const nk = k + 1;
          if (!visited[nk] && !isBoundary(nk)) {
            visited[nk] = 1;
            queue[qTail++] = nk;
          }
        }
        if (j > 0) {
          const nk = k - W;
          if (!visited[nk] && !isBoundary(nk)) {
            visited[nk] = 1;
            queue[qTail++] = nk;
          }
        }
        if (j < H - 1) {
          const nk = k + W;
          if (!visited[nk] && !isBoundary(nk)) {
            visited[nk] = 1;
            queue[qTail++] = nk;
          }
        }
      }
      if (!touchesEdge) {
        const id = nextId++;
        const tiles = new Array(tileCount);
        for (let t = 0; t < tileCount; t++) {
          tiles[t] = scratch[t];
          roomId[scratch[t]] = id;
        }
        rooms.set(id, { id, tiles, area: tileCount });
      }
    }
  }

  /** @param {number} i @param {number} j */
  function getRoomAt(i, j) {
    if (!grid.inBounds(i, j)) return null;
    const id = roomId[grid.idx(i, j)];
    return id > 0 ? (rooms.get(id) ?? null) : null;
  }

  return { roomId, rooms, rebuild, getRoomAt };
}

/**
 * Dirty-tier system that rebuilds rooms when the `topology` tag is set.
 *
 * @param {{ rooms: RoomRegistry, onRebuilt?: () => void }} opts
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeRoomsSystem(opts) {
  const { rooms, onRebuilt } = opts;
  return {
    name: 'rooms',
    tier: 'dirty',
    dirtyTag: 'topology',
    run(_world, ctx) {
      ctx.dirty.consume('topology');
      rooms.rebuild();
      onRebuilt?.();
    },
  };
}
