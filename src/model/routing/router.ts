import { dirBetween, step, unitCells } from '../geometry';
import type { Dir, Vec3 } from '../core/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import type { HatchPlacement } from '../plan/types';
import type { RouteNet } from './routeNet';
import { DEFAULT_TURN_COST, DEFAULT_WALL_COST, MAX_ROUNDS } from './constants';
import { buildGrid, outsideCells, posOf } from './grid';
import { CellHeap } from './heap';
import { PIPE_KINDS, ROUTED_KINDS } from './kinds';
import { negotiateRoutes } from './negotiate';
import { refineTree } from './refine';
import { blockedSides, createKindStates, priceCells, reserveCells, routedHatchesByKind } from './terminals';
import type { Grid, KindState, RouteOptions, Router } from './types';

/**
 * UNIT 4 — Pipe routing.
 *
 * For each routed kind, connect the cells beside all its hatches into one network that never shares a
 * cell with another kind's. Each network is grown from one hatch towards the cheapest unconnected one,
 * where a bend costs `turnCost` extra blocks. Kinds are negotiated (see `MAX_ROUNDS`): networks may first
 * overlap at a price, and contested cells get dearer each round until every kind has its own cells. If
 * the rounds run out, the kinds are routed one after another around the ones already laid, cheapest
 * uncontested cells first.
 * - Pipes never pass through structure cells (including air interiors), another kind's network or the
 *   ground below the build's lowest layer, nor through the cell in front of a controller or of a hatch
 *   that is not routed (mufflers vent there, maintenance needs the player).
 * - The cell in front of each routed hatch's placed face is reserved for its kind; its other open sides
 *   are free for any pipe, and the hatch attaches through whichever side its pipe reaches.
 * - A block off the walls costs `wallCost` more, so pipes follow the build and the ground.
 * - Finished networks are reworked branch by branch (`refineTree`) where a cheaper path joins a hatch.
 * - Search is bounded to the structure bounding box grown by 4 blocks (and to `MAX_GRID_CELLS`).
 * - Reports `connected` / `total` terminals and `length` in pipe blocks.
 * Pure and deterministic. Nets are returned in `ROUTED_KINDS` order.
 */
export function routePipes(
  def: MultiblockDef,
  units: Unit[],
  hatches: HatchPlacement[],
  opts: RouteOptions = {},
): RouteNet[] {
  const byKind = routedHatchesByKind(hatches, opts.kinds ?? PIPE_KINDS);
  if (byKind.size === 0) return [];

  const cellsOf = units.map((u) => unitCells(def, u));
  const solids: Vec3[] = [];
  let ground = Infinity;
  for (const list of cellsOf)
    for (const c of list) {
      solids.push(c.pos);
      ground = Math.min(ground, c.pos[1]);
    }
  for (const h of hatches) solids.push(h.cell);
  const fronts = [...byKind.values()].flat().map((h) => step(h.cell, h.face));
  // With `below`, the ground starts one layer lower: the layer under the build is a trench for pipes.
  const g = opts.below ? buildGrid(solids, fronts, ground - 1, true) : buildGrid(solids, fronts, ground);
  if (!g) {
    return ROUTED_KINDS.flatMap((kind) => {
      const list = byKind.get(kind);
      return list ? [{ kind, paths: [], length: 0, connected: 0, total: list.length }] : [];
    });
  }

  const open = outsideCells(g);
  reserveCells(g, def, units, cellsOf, hatches, byKind);
  const states = createKindStates(g, open, byKind, blockedSides(def, units, cellsOf, hatches));
  const r = createRouter(g, Math.max(0, Math.floor(opts.turnCost ?? DEFAULT_TURN_COST)));
  const wallCost = Math.max(0, opts.wallCost ?? DEFAULT_WALL_COST);
  priceCells(r, hatches, wallCost);

  negotiateRoutes(r, states, Math.max(0, Math.floor(opts.rounds ?? MAX_ROUNDS)));
  if (opts.refine !== false) refineRoutes(r, states, wallCost);
  return states.map((s) => toRouteNet(r, s));
}

/** Fresh scratch state for one routing run over `g`. */
function createRouter(g: Grid, turnCost: number): Router {
  const cells = g.occ.length;
  const dist = new Float64Array(cells);
  return {
    g,
    turnCost,
    used: new Uint16Array(cells),
    pass: new Uint16Array(cells),
    price: new Float32Array(cells).fill(1),
    keep: new Uint8Array(cells),
    target: new Uint16Array(cells),
    dist,
    parent: new Int32Array(cells),
    arrive: new Uint8Array(cells),
    seen: new Uint32Array(cells),
    stamp: 0,
    inNet: new Uint32Array(cells),
    netStamp: 0,
    heap: new CellHeap(dist, new Int32Array(cells).fill(-1)),
  };
}

/** Reworks every network branch by branch at the plain price of a block (no congestion or beside-hatch cost). */
function refineRoutes(r: Router, states: readonly KindState[], wallCost: number): void {
  const { g } = r;
  const base = new Float32Array(g.occ.length).fill(1);
  if (wallCost > 0) for (let i = 0; i < base.length; i++) if (g.wall[i] === 0) base[i] += wallCost;
  for (const s of states) if (s.tree) refineTree(r, s, s.tree, base);
}

/**
 * A kind's network as world paths. Each connected hatch attaches through its placed face when the network
 * passes there, else through the first side of `ATTACH_ORDER` it does pass.
 */
function toRouteNet(r: Router, s: KindState): RouteNet {
  const { kind, terms, via, tree } = s;
  const total = terms.length;
  if (!tree) return { kind, paths: [], length: 0, connected: 0, total };
  const ns = ++r.netStamp;
  for (const i of tree.net) r.inNet[i] = ns;
  const attachments: { cell: Vec3; face: Dir }[] = [];
  terms.forEach((t, ti) => {
    if (via[ti] === -1) return;
    const cell = t.cells.find((c) => r.inNet[c] === ns) ?? via[ti];
    attachments.push({ cell: t.hatch, face: dirBetween(t.hatch, posOf(r.g, cell)) });
  });
  return {
    kind,
    paths: tree.paths.map((p) => p.map((i) => posOf(r.g, i))),
    length: tree.net.length,
    connected: tree.connected,
    total,
    attachments,
  };
}
