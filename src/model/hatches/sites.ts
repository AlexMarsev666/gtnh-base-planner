import {
  type CellKey,
  controllerFacing,
  defOfUnit,
  localCells,
  outsideAllowedFaces,
  packCell,
  rotateDir,
  rotatedSize,
  rotateLocal,
  step,
} from '../geometry';
import type { Dir, Vec3 } from '../core/types';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import { CLEAR_AHEAD, FACE_ORDER, FLOOD_LIMIT } from './constants';
import { comparePos } from './geometry';
import type { Site } from './types';
import { zoneOfCell } from './zones';

/** Discovering every cell a hatch may take, with its open faces, around a set of placed units. */

/** Dense box of cells (the build's bounding box grown by one block), indexed x fastest, then z, then y. */
interface Box {
  ox: number;
  oy: number;
  oz: number;
  nx: number;
  ny: number;
  nz: number;
}

function boxIndex(b: Box, p: Vec3): number {
  const x = p[0] - b.ox;
  const y = p[1] - b.oy;
  const z = p[2] - b.oz;
  if (x < 0 || y < 0 || z < 0 || x >= b.nx || y >= b.ny || z >= b.nz) return -1;
  return (y * b.nz + z) * b.nx + x;
}

/** Index step of one block in each `FACE_ORDER` direction. */
function boxSteps(b: Box): number[] {
  const { nx, nz } = b;
  return FACE_ORDER.map((d) => {
    const [x, y, z] = step([0, 0, 0], d);
    return (y * nz + z) * nx + x;
  });
}

/**
 * Marks the empty cells of the box that are reachable from outside the build (not a sealed pocket, not
 * underground): a flood fill from a padded corner at ground level. Everything below `ground` (the lowest
 * structure layer) is solid ground.
 */
function outsideCells(b: Box, solid: Uint8Array, ground: number): Uint8Array {
  const { nx, ny, nz } = b;
  const volume = nx * ny * nz;
  const blocked = solid.slice();
  // The padding layer under the build is ground.
  for (let y = 0; y < Math.min(ny, ground - b.oy); y++) blocked.fill(1, y * nx * nz, (y + 1) * nx * nz);
  const outside = new Uint8Array(volume);
  const queue = new Int32Array(volume);
  let head = 0;
  let tail = 0;
  const start = (Math.max(0, ground - b.oy) * nz + 0) * nx + 0; // padded corner at ground level, never solid
  outside[start] = 1;
  queue[tail++] = start;
  const layer = nx * nz;
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx;
    const z = ((i - x) / nx) % nz;
    const y = (i - x - z * nx) / layer;
    if (x > 0 && !blocked[i - 1] && !outside[i - 1]) ((outside[i - 1] = 1), (queue[tail++] = i - 1));
    if (x < nx - 1 && !blocked[i + 1] && !outside[i + 1]) ((outside[i + 1] = 1), (queue[tail++] = i + 1));
    if (z > 0 && !blocked[i - nx] && !outside[i - nx]) ((outside[i - nx] = 1), (queue[tail++] = i - nx));
    if (z < nz - 1 && !blocked[i + nx] && !outside[i + nx]) ((outside[i + nx] = 1), (queue[tail++] = i + nx));
    if (y > 0 && !blocked[i - layer] && !outside[i - layer])
      ((outside[i - layer] = 1), (queue[tail++] = i - layer));
    if (y < ny - 1 && !blocked[i + layer] && !outside[i + layer])
      ((outside[i + layer] = 1), (queue[tail++] = i + layer));
  }
  return outside;
}

const NO_REGIONS: ReadonlyMap<number, string> = new Map();

const NO_ZONES: ReadonlyMap<number, string> = new Map();

const NO_CHARS: ReadonlyMap<number, string> = new Map();

const NO_BLOCKED: ReadonlyMap<HatchKind, Set<Dir>> = new Map();

/** Per def: the rotated local offset of every structure cell, per rotation. */
const offsetCache = new WeakMap<MultiblockDef, Vec3[][]>();

function rotatedOffsets(def: MultiblockDef): Vec3[][] {
  let out = offsetCache.get(def);
  if (!out) {
    const cells = localCells(def);
    out = ([0, 1, 2, 3] as const).map((r) => cells.map((c) => rotateLocal(def, c.local, r)));
    offsetCache.set(def, out);
  }
  return out;
}

/** Per def: the hatch kinds each legend char allows, as one shared set per char. */
const kindsCache = new WeakMap<MultiblockDef, Map<string, ReadonlySet<HatchKind>>>();

function legendKinds(
  def: MultiblockDef,
  char: string,
  allowed: readonly HatchKind[],
): ReadonlySet<HatchKind> {
  let byChar = kindsCache.get(def);
  if (!byChar) kindsCache.set(def, (byChar = new Map()));
  let set = byChar.get(char);
  if (!set) byChar.set(char, (set = new Set(allowed)));
  return set;
}

const NO_KINDS: ReadonlySet<HatchKind> = new Set();

/** Per def: see `groundOnlyKinds`. */
const groundOnlyCache = new WeakMap<MultiblockDef, ReadonlySet<HatchKind>>();

/**
 * The kinds the def requires (`requiredHatches` min) of which one unit alone has fewer hatch cells with a free
 * side than the minimum: the rest of the cells are walled in by the def itself but for the ground (an Advanced
 * Assembly Line's input buses, a Synchrotron's output hatches), and GT still takes a hatch there. Only these
 * kinds get fallback sites (`Site.fromBelow`); a def whose cells all have a free side never does, so a
 * crowded layout is loosened instead of facing its hatches into the ground.
 */
function groundOnlyKinds(def: MultiblockDef): ReadonlySet<HatchKind> {
  let out = groundOnlyCache.get(def);
  if (out) return out;
  const cells = localCells(def);
  const own = new Set(cells.map((c) => c.local.join()));
  const lowest = Math.min(...cells.map((c) => c.local[1]));
  const free = new Map<HatchKind, number>();
  for (const c of cells) {
    if (c.role !== 'casing' || !c.hatches?.length) continue;
    const open = FACE_ORDER.some((dir) => {
      if (dir === 'down' && c.local[1] === lowest) return false;
      return !own.has(step(c.local, dir).join());
    });
    if (open) for (const k of c.hatches) free.set(k, (free.get(k) ?? 0) + 1);
  }
  out = new Set(
    (Object.keys(def.requiredHatches ?? {}) as HatchKind[]).filter(
      (k) => def.requiredHatches![k]!.min > (free.get(k) ?? 0),
    ),
  );
  groundOnlyCache.set(def, out);
  return out;
}

/**
 * All hatch-able structure cells with at least one open face, sorted by position, and a lookup of the
 * open cells around an empty cell (`null` for one outside the build's box, which is always open; cells in
 * front of controllers are not open). Works on a dense box of cells; above `FLOOD_LIMIT` cells (only
 * far-apart manual layouts) it falls back to maps, where any face whose neighbour is not a structure cell
 * counts as open and the lookup is unavailable.
 */
export function findSites(
  def: MultiblockDef,
  units: readonly Unit[],
  below = false,
): {
  sites: Site[];
  openAround: ((k: CellKey) => (CellKey | null)[]) | null;
  /** Whether the cell next to the empty cell `k` towards `dir` is open too (see `openAround`). */
  openToward: ((k: CellKey, dir: Dir) => boolean) | null;
  nearby: ((k: CellKey) => number[]) | null;
  /** Cells in the dense box (keys are indices below it), or 0 for the map fallback. */
  volume: number;
} {
  interface Entry {
    pos: Vec3;
    key: CellKey;
    ids: number[];
    ok: boolean;
    blockId?: string;
    kinds: ReadonlySet<HatchKind>;
    regions: ReadonlyMap<number, string>;
    zones: ReadonlyMap<number, string>;
    blocked: ReadonlyMap<HatchKind, Set<Dir>>;
    disfavored: ReadonlyMap<HatchKind, Set<Dir>>;
    chars: ReadonlyMap<number, string>;
  }
  let lo: [number, number, number] = [Infinity, Infinity, Infinity];
  let hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const u of units) {
    const size = rotatedSize(def, u.rotation);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], u.origin[a]);
      hi[a] = Math.max(hi[a], u.origin[a] + size[a]);
    }
  }
  const box: Box = {
    ox: lo[0] - 1,
    oy: lo[1] - 1,
    oz: lo[2] - 1,
    nx: hi[0] - lo[0] + 2,
    ny: hi[1] - lo[1] + 2,
    nz: hi[2] - lo[2] + 2,
  };
  const volume = box.nx * box.ny * box.nz;
  const dense = Number.isFinite(volume) && volume <= FLOOD_LIMIT;
  const keyOf = dense ? (p: Vec3): CellKey => boxIndex(box, p) : packCell;

  /** Structure cells. */
  const solidDense = dense ? new Uint8Array(volume) : null;
  const solidKeys = dense ? null : new Set<CellKey>();
  /**
   * Cells where every unit covering them allows some hatch. A cell another unit first covered with
   * something else (air, a controller, a casing without hatches) never gets one: no hatch kind is allowed
   * by all of them.
   */
  const byKey = new Map<CellKey, Entry>();
  /** Cells in front of controllers: kept free for the player, so no hatch faces them. */
  const controllerFronts = new Set<CellKey>();
  let ground = Infinity;
  for (const unit of units) {
    const ud = defOfUnit(def, unit);
    const cells = localCells(ud);
    const rotated = rotatedOffsets(ud)[unit.rotation];
    const [ux, uy, uz] = unit.origin;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const off = rotated[ci];
      const pos: Vec3 = [ux + off[0], uy + off[1], uz + off[2]];
      if (pos[1] < ground) ground = pos[1];
      if (cell.role === 'controller') controllerFronts.add(keyOf(step(pos, controllerFacing(def, unit))));
      const k = keyOf(pos);
      const covered = solidDense ? solidDense[k as number] === 1 : solidKeys!.has(k);
      if (solidDense) solidDense[k as number] = 1;
      else solidKeys!.add(k);
      const allowed = cell.role === 'casing' ? (cell.hatches ?? []) : [];
      let entry = byKey.get(k);
      if (allowed.length === 0) {
        if (entry) entry.ok = false;
        continue;
      }
      if (!entry) {
        if (covered) continue;
        entry = {
          pos,
          key: k,
          ids: [unit.id],
          ok: true,
          blockId: cell.blockId,
          kinds: legendKinds(ud, cell.char, allowed),
          regions: NO_REGIONS,
          zones: NO_ZONES,
          blocked: NO_BLOCKED,
          disfavored: NO_BLOCKED,
          chars: NO_CHARS,
        };
        byKey.set(k, entry);
      } else {
        if (!entry.ids.includes(unit.id)) entry.ids.push(unit.id);
        if (cell.blockId !== entry.blockId) entry.ok = false;
        if ([...entry.kinds].some((kind) => !allowed.includes(kind)))
          entry.kinds = new Set([...entry.kinds].filter((kind) => allowed.includes(kind)));
      }
      if (def.minCasings?.length) {
        if (entry.chars === NO_CHARS) entry.chars = new Map();
        (entry.chars as Map<number, string>).set(unit.id, cell.char);
      }
      const legend = ud.legend[cell.char];
      if (legend?.region !== undefined) {
        if (entry.regions === NO_REGIONS) entry.regions = new Map();
        (entry.regions as Map<number, string>).set(unit.id, legend.region);
      }
      const zone = zoneOfCell(ud, cell.local, cell.char);
      if (zone !== undefined) {
        if (entry.zones === NO_ZONES) entry.zones = new Map();
        (entry.zones as Map<number, string>).set(unit.id, zone);
      }
      if (legend?.disallowFaces) {
        if (entry.blocked === NO_BLOCKED) entry.blocked = new Map();
        const blocked = entry.blocked as Map<HatchKind, Set<Dir>>;
        for (const [kind, dirs] of Object.entries(legend.disallowFaces) as [HatchKind, Dir[]][]) {
          let set = blocked.get(kind);
          if (!set) blocked.set(kind, (set = new Set()));
          for (const d of dirs) set.add(rotateDir(d, unit.rotation));
        }
      }
      if (legend?.allowFaces) {
        if (entry.disfavored === NO_BLOCKED) entry.disfavored = new Map();
        const disfavored = entry.disfavored as Map<HatchKind, Set<Dir>>;
        for (const kind of Object.keys(legend.allowFaces) as HatchKind[]) {
          let set = disfavored.get(kind);
          if (!set) disfavored.set(kind, (set = new Set()));
          for (const d of outsideAllowedFaces(legend, kind)) set.add(rotateDir(d, unit.rotation));
        }
      }
    }
  }

  // With connections from below, the layer under the build is open too (a trench for the pipes).
  const lowest = ground;
  if (below) ground -= 1;
  // Solid cells, and which empty ones the outside reaches (the build stands on the ground: nothing opens
  // below its lowest layer, or the layer under it with `below`).
  let solidAt: (p: Vec3, k: CellKey) => boolean;
  let isOutside: (p: Vec3, k: CellKey) => boolean;
  let clearAhead: (p: Vec3, k: CellKey, face: number) => boolean;
  let openAround: ((k: CellKey) => (CellKey | null)[]) | null = null;
  let openToward: ((k: CellKey, dir: Dir) => boolean) | null = null;
  let nearby: ((k: CellKey) => number[]) | null = null;
  if (solidDense) {
    const solid = solidDense;
    const outside = outsideCells(box, solid, ground);
    const steps = boxSteps(box);
    solidAt = (_p, k) => solid[k as number] === 1;
    isOutside = (p, k) => p[1] >= ground && outside[k as number] === 1;
    nearby = (k) => {
      const i = k as number;
      const x = i % box.nx;
      const z = ((i - x) / box.nx) % box.nz;
      const y = (i - x - z * box.nx) / (box.nx * box.nz);
      const out: number[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const [ax, ay, az] = [x + dx, y + dy, z + dz];
            if (ax < 0 || ay < 0 || az < 0 || ax >= box.nx || ay >= box.ny || az >= box.nz) continue;
            out.push((ay * box.nz + az) * box.nx + ax);
          }
      return out;
    };
    openAround = (k) => {
      const i = k as number;
      const x = i % box.nx;
      const z = ((i - x) / box.nx) % box.nz;
      const y = (i - x - z * box.nx) / (box.nx * box.nz);
      const out: (CellKey | null)[] = [];
      for (let face = 0; face < FACE_ORDER.length; face++) {
        const [vx, vy, vz] = step([0, 0, 0], FACE_ORDER[face]);
        const [ax, ay, az] = [x + vx, y + vy, z + vz];
        if (ax < 0 || ay < 0 || az < 0 || ax >= box.nx || ay >= box.ny || az >= box.nz) {
          if (ay + box.oy >= ground) out.push(null);
          continue;
        }
        const n = i + steps[face];
        if (ay + box.oy >= ground && outside[n] === 1 && !controllerFronts.has(n)) out.push(n);
      }
      return out;
    };
    openToward = (k, dir) => {
      const i = k as number;
      const x = i % box.nx;
      const z = ((i - x) / box.nx) % box.nz;
      const y = (i - x - z * box.nx) / (box.nx * box.nz);
      const face = FACE_ORDER.indexOf(dir);
      const [vx, vy, vz] = step([0, 0, 0], dir);
      const [ax, ay, az] = [x + vx, y + vy, z + vz];
      if (ay + box.oy < ground) return false;
      if (ax < 0 || ay < 0 || az < 0 || ax >= box.nx || ay >= box.ny || az >= box.nz) return true;
      const n = i + steps[face];
      return outside[n] === 1 && !controllerFronts.has(n);
    };
    clearAhead = (p, k, face) => {
      const dir = FACE_ORDER[face];
      // Looking down, the ground is as good as a wall.
      if (dir === 'down' && p[1] - (CLEAR_AHEAD - 1) < ground) return false;
      const v = step([0, 0, 0], dir);
      // Cells left inside the box along this direction; beyond it nothing is solid.
      const left =
        v[0] > 0
          ? box.nx - 1 - (p[0] - box.ox)
          : v[0] < 0
            ? p[0] - box.ox
            : v[1] > 0
              ? box.ny - 1 - (p[1] - box.oy)
              : v[1] < 0
                ? p[1] - box.oy
                : v[2] > 0
                  ? box.nz - 1 - (p[2] - box.oz)
                  : p[2] - box.oz;
      const s = steps[face];
      let i = k as number;
      for (let n = 1; n < CLEAR_AHEAD && n <= left; n++) {
        i += s;
        if (solid[i] === 1) return false;
      }
      return true;
    };
  } else {
    const solid = solidKeys!;
    solidAt = (_p, k) => solid.has(k);
    isOutside = (p, k) => p[1] >= ground && !solid.has(k);
    clearAhead = (p, _k, face) => {
      const dir = FACE_ORDER[face];
      if (dir === 'down' && p[1] - (CLEAR_AHEAD - 1) < ground) return false;
      for (let n = 1, q = p; n < CLEAR_AHEAD; n++) {
        q = step(q, dir);
        if (solid.has(packCell(q))) return false;
      }
      return true;
    };
  }

  /** The kinds each unit's def has only walled-in cells for (see `groundOnlyKinds`): none with `below`. */
  const groundOnlyOf = (id: number): ReadonlySet<HatchKind> =>
    below
      ? NO_KINDS
      : groundOnlyKinds(
          defOfUnit(
            def,
            units.find((u) => u.id === id)!,
          ),
        );
  /** Per unit id: the keys of its own structure cells (air included), built when a fallback site needs them. */
  const ownCells = new Map<number, Set<CellKey>>();
  /**
   * Whether every unit on the cell has structure on all four sides and above it: the def itself walls the cell
   * in, not a neighbouring unit (a layout that can be loosened).
   */
  const walledByOwn = (e: Entry): boolean =>
    e.ids.every((id) => {
      let own = ownCells.get(id);
      if (!own) {
        const unit = units.find((u) => u.id === id)!;
        const ud = defOfUnit(def, unit);
        const rotated = rotatedOffsets(ud)[unit.rotation];
        own = new Set(
          rotated.map((o) => keyOf([unit.origin[0] + o[0], unit.origin[1] + o[1], unit.origin[2] + o[2]])),
        );
        ownCells.set(id, own);
      }
      return FACE_ORDER.every((dir) => dir === 'down' || own.has(keyOf(step(e.pos, dir))));
    });
  const sites: Site[] = [];
  for (const e of byKey.values()) {
    if (!e.ok || e.kinds.size === 0) continue;
    const faces: Site['faces'] = [];
    for (let order = 0; order < FACE_ORDER.length; order++) {
      const dir = FACE_ORDER[order];
      const front = step(e.pos, dir);
      const fk = keyOf(front);
      if (solidAt(front, fk) || controllerFronts.has(fk) || !isOutside(front, fk)) continue;
      const clear = clearAhead(front, fk, order);
      faces.push({ dir, front: fk, rank: (clear ? 0 : FACE_ORDER.length) + order });
    }
    let fromBelow = false;
    let kinds = e.kinds;
    if (faces.length === 0 && !below && e.pos[1] === lowest) {
      // Walled in by its own def but for the ground: GT still takes a hatch here, facing down (e.g. an Advanced
      // Assembly Line's input buses). Only for the kinds the def cannot otherwise place enough of.
      const sets = e.ids.map(groundOnlyOf);
      kinds = new Set([...e.kinds].filter((k) => sets.every((s) => s.has(k))));
      if (kinds.size === 0 || !walledByOwn(e)) continue;
      const front = step(e.pos, 'down');
      const order = FACE_ORDER.indexOf('down');
      faces.push({ dir: 'down', front: keyOf(front), rank: FACE_ORDER.length + order });
      fromBelow = true;
    }
    if (faces.length === 0) continue;
    faces.sort((a, b) => a.rank - b.rank);
    sites.push({
      pos: e.pos,
      key: e.key,
      unitIds: e.ids.length > 1 ? [...e.ids].sort((a, b) => a - b) : e.ids,
      kinds,
      faces,
      regions: e.regions,
      zones: e.zones,
      blocked: e.blocked,
      disfavored: e.disfavored,
      chars: e.chars,
      ...(fromBelow ? { fromBelow: true as const } : {}),
    });
  }
  return {
    sites: sites.sort((a, b) => comparePos(a.pos, b.pos)),
    openAround,
    openToward,
    nearby,
    volume: solidDense ? volume : 0,
  };
}
