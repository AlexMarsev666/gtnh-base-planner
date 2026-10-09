#!/usr/bin/env node
/**
 * Builds the multiblock catalog from a dump of the running game (see README.md next to this file):
 *
 *   node tools/game-dump/build.mjs --structures <dir> --textures <manifest.json> --jars <dir|jar> ... [--write]
 *
 * `--structures` is the extractor's `<datasetOut>/multiblocks` (one file per controller, every block its
 * `construct()` placed, the hatch kinds each cell accepts), `--textures` its client texture manifest (the
 * layer stack every block face is drawn with) and `--jars` the mod jars the sprites are read from, in
 * priority order. Without `--write` it only reports.
 *
 * With `--write` it replaces:
 *   src/data/multiblocks/<id>.json         one MultiblockDef per controller (`"generated": true`)
 *   src/data/blocks.generated.json         name and flat colour of every block they use
 *   tools/game-dump/textures.generated.json  block faces for scripts/build-atlas.mjs
 *   tools/texture-sources/DUMP_*.png       the composited face tiles
 *   ATTRIBUTION.md                         the sprites those tiles are made from
 *
 * Hand-made catalog entries always win: a controller class an entry without `"generated"` links to in its
 * `source` is not generated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng, TILE } from '../../scripts/build-atlas.mjs';
import { Composer, meanColor, pixelHash } from './compose.mjs';
import { listJars, TextureJars } from './jars.mjs';
import { StaticTextures, staticManifest } from './static-textures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MULTI_DIR = join(ROOT, 'src/data/multiblocks');
const SRC_DIR = join(ROOT, 'tools/texture-sources');
const TEXTURES_OUT = join(ROOT, 'tools/game-dump/textures.generated.json');
const BLOCKS_OUT = join(ROOT, 'src/data/blocks.generated.json');
/** Faces the old source converter (tools/gt-source) wrote; read once to carry over the entries it still owns. */
const OLD_TEXTURES = join(ROOT, 'tools/gt-source/textures.generated.json');
const TAG = '5.09.54.205';
const REPO = `https://github.com/GTNewHorizons/GT5-Unofficial/blob/${TAG}/src/main/java/`;

/** GT `HatchElement` names → planner hatch kinds. Machine-specific kinds (data, laser, ...) are left out. */
const HATCH_KIND = {
  InputBus: 'itemIn',
  OutputBus: 'itemOut',
  InputHatch: 'fluidIn',
  SolidifierHatch: 'fluidIn',
  CryotheumHatch: 'fluidIn',
  PyrotheumHatch: 'fluidIn',
  OutputHatch: 'fluidOut',
  Energy: 'energy',
  ExoticEnergy: 'energy',
  MultiAmpEnergy: 'energy',
  Dynamo: 'dynamo',
  ExoticDynamo: 'dynamo',
  Maintenance: 'maintenance',
  Muffler: 'muffler',
};
const HATCH_ORDER = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'energy',
  'dynamo',
  'maintenance',
  'muffler',
  'steamIn',
];
const HATCH_BLOCKS = {
  itemIn: 'gt.hatch.inputBus',
  itemOut: 'gt.hatch.outputBus',
  fluidIn: 'gt.hatch.inputHatch',
  fluidOut: 'gt.hatch.outputHatch',
  energy: 'gt.hatch.energy',
  dynamo: 'gt.hatch.dynamo',
  maintenance: 'gt.hatch.maintenance',
  muffler: 'gt.hatch.muffler',
  steamIn: 'gt.hatch.steamInput',
};
/**
 * Legend characters in assignment order. Single UTF-16 units only (the layers are indexed per unit), and never
 * the reserved `~`, `-` or space.
 */
const LEGEND_CHARS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+=?@^_|<>(){}[]/\\:;,.\'"`',
  ...Array.from({ length: 0x3a9 - 0x391 + 1 }, (_, i) => String.fromCharCode(0x391 + i)).filter(
    (c) => c !== '΢',
  ),
  ...Array.from({ length: 0x3c9 - 0x3b1 + 1 }, (_, i) => String.fromCharCode(0x3b1 + i)),
  ...Array.from({ length: 0x44f - 0x410 + 1 }, (_, i) => String.fromCharCode(0x410 + i)),
];

const SIDES = ['NORTH', 'SOUTH', 'WEST', 'EAST'];
const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// ------------------------------------------------------------------------------------------------------------
// Helpers

export function slug(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Planner block id of a dumped block: `<registry name>@<meta>`. */
export function blockIdOf(registry, meta) {
  return `${registry}@${meta}`;
}

/** Outer class of a (possibly nested) Java class name, and the name the planner shows for a nested one. */
function classNames(sourceClass) {
  const [outer, ...inner] = sourceClass.split('$');
  return {
    outer: outer.split('.').pop(),
    inner: inner.pop() ?? null,
    file: outer.replace(/\./g, '/') + '.java',
  };
}

function sortKinds(kinds) {
  const set = new Set(kinds);
  return HATCH_ORDER.filter((k) => set.has(k));
}

const vkey = (p) => `${p[0]},${p[1]},${p[2]}`;

/** Catalog entries now in src/data/multiblocks, split into hand-made and generated. */
function readCatalog() {
  const hand = [];
  const generated = [];
  for (const f of readdirSync(MULTI_DIR).filter((n) => n.endsWith('.json'))) {
    const def = JSON.parse(readFileSync(join(MULTI_DIR, f), 'utf8'));
    const sourceClass = /\/(\w+)\.java$/.exec(def.source ?? '')?.[1] ?? null;
    const cls = sourceClass === 'MTESMDProcessorModule' ? 'MTEPartProcessorModule' : sourceClass;
    (def.generated ? generated : hand).push({ id: def.id, name: def.name, cls, def });
  }
  return { hand, generated };
}

/** Parsed dump documents (the `_meta.json` run summary is skipped), by controller meta. */
function readStructures(dir) {
  const docs = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    docs.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return docs.sort((a, b) => a.controller.meta - b.controller.meta);
}

// ------------------------------------------------------------------------------------------------------------
// Structure

/**
 * One dump document → a MultiblockDef (without catalog ids resolved) plus the blocks it uses.
 * Throws with a reason when the structure cannot be shown.
 */
export function convertStructure(doc, { id, name }) {
  const variant = [...doc.variants].sort((a, b) => a.trigger_stack_size - b.trigger_stack_size)[0];
  const ctrl = doc.controller;
  const ctrlBlock =
    variant.blocks.find(
      (b) => b.block === ctrl.registry_name && b.meta === ctrl.meta && vkey(b.d) === '0,0,0',
    ) ?? variant.blocks.find((b) => b.block === ctrl.registry_name && b.meta === ctrl.meta);
  if (!ctrlBlock) throw new Error('controller block not in the scan');

  // Cells: controller-relative position → { blockId?, hatches, special }.
  const cells = new Map();
  // StructureLib 1.4.45's reserved AIR marker is a required empty cell, not a special hatch.
  // Do not infer air from ordinary machine-local hint numbers. A placed block takes precedence
  // where a controller's construct() also populates an optional tree or other non-structural object.
  const placedKeys = new Set(variant.blocks.map((b) => vkey(b.d)));
  const hintKeys = new Set((variant.hints ?? []).map((h) => vkey(h.d)));
  const air = new Map(
    (variant.hints ?? [])
      .filter((h) => h.hint === 13 && !placedKeys.has(vkey(h.d)))
      .map((h) => [vkey(h.d), h.d]),
  );
  const cell = (d) => {
    const k = vkey(d);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { d, blockId: null, hatches: [], special: false }));
    return c;
  };
  for (const b of variant.blocks) {
    if (b === ctrlBlock) continue;
    // A machine block other than the controller is a hatch the structure builds in (EBF muffler, turbine
    // dynamo, ...): the cell holds a hatch, not a block of its own.
    if (b.block === ctrl.registry_name) cell(b.d);
    else cell(b.d).blockId = blockIdOf(b.block, b.meta);
  }
  const dropped = new Set();
  for (const s of variant.hatch_slots ?? []) {
    if (air.has(vkey(s.d))) continue;
    if (vkey(s.d) === vkey(ctrlBlock.d)) continue;
    // Probes can visit absent sections or alternative shapes, including empty cells inside the
    // bounding box (Drone Centre's legacy fallback). Only actual blocks/hints establish a cell in
    // this constructed variant; a bare probe cannot turn free space into a mandatory hatch.
    if (!placedKeys.has(vkey(s.d)) && !hintKeys.has(vkey(s.d))) continue;
    const kinds = [];
    for (const k of s.kinds) {
      if (HATCH_KIND[k]) kinds.push(HATCH_KIND[k]);
      else dropped.add(k);
    }
    const c = cell(s.d);
    if (kinds.length) c.hatches = sortKinds([...c.hatches, ...kinds]);
    else if (!c.blockId) c.special = true;
  }
  // Hint dots with nothing placed: a cell only a machine-specific hatch (data, beamline, ...) may fill.
  for (const h of variant.hints ?? []) {
    const k = vkey(h.d);
    if (air.has(k)) continue;
    if (k !== vkey(ctrlBlock.d) && !cells.has(k)) cell(h.d).special = true;
  }
  // A hatch slot or hint with nothing placed and no block or controller next to it is not part of the structure
  // (the hatch probe or the hologram visited a cell outside it, e.g. high above the Solar Factory).
  const placed = new Set([
    ...[...cells.values()].filter((c) => c.blockId).map((c) => vkey(c.d)),
    vkey(ctrlBlock.d),
  ]);
  for (const [k, c] of cells) {
    if (c.blockId) continue;
    const near = [
      ...NEIGHBOURS,
      [1, 1, 0],
      [-1, 1, 0],
      [0, 1, 1],
      [0, 1, -1],
      [1, -1, 0],
      [-1, -1, 0],
      [0, -1, 1],
      [0, -1, -1],
    ].some(([dx, dy, dz]) => placed.has(vkey([c.d[0] + dx, c.d[1] + dy, c.d[2] + dz])));
    if (!near) cells.delete(k);
  }
  for (const c of cells.values()) {
    if (c.blockId) continue;
    c.blockId = c.hatches.length ? HATCH_BLOCKS[c.hatches[0]] : 'gt.hatch.special';
  }

  // Bounding box → local frame (x east, y up, z south, min corner at 0).
  const all = [...cells.values()].map((c) => c.d).concat([ctrlBlock.d], [...air.values()]);
  const min = [0, 1, 2].map((a) => Math.min(...all.map((p) => p[a])));
  const max = [0, 1, 2].map((a) => Math.max(...all.map((p) => p[a])));
  const size = [0, 1, 2].map((a) => max[a] - min[a] + 1);
  const local = (d) => [d[0] - min[0], d[1] - min[1], d[2] - min[2]];
  const grid = new Map();
  for (const c of cells.values()) grid.set(vkey(local(c.d)), c);
  const ctrlPos = local(ctrlBlock.d);
  const inBox = (p) => p.every((v, a) => v >= 0 && v < size[a]);
  const occupied = (p) => grid.has(vkey(p)) || vkey(p) === vkey(ctrlPos);

  // Empty cells reachable from outside the box are not part of the structure; enclosed ones must stay air.
  const outside = new Set([vkey([-1, -1, -1])]);
  const stack = [[-1, -1, -1]];
  while (stack.length) {
    const p = stack.pop();
    for (const n of NEIGHBOURS) {
      const q = [p[0] + n[0], p[1] + n[1], p[2] + n[2]];
      if (q.some((v, a) => v < -1 || v > size[a])) continue;
      const k = vkey(q);
      if (outside.has(k) || (inBox(q) && occupied(q))) continue;
      outside.add(k);
      stack.push(q);
    }
  }

  // Legend.
  const legend = {};
  const charOf = new Map();
  const legendChar = (c) => {
    const gk = `${c.blockId}|${c.hatches.join(',')}`;
    let ch = charOf.get(gk);
    if (ch === undefined) {
      if (charOf.size >= LEGEND_CHARS.length) throw new Error(`more than ${LEGEND_CHARS.length} cell types`);
      ch = LEGEND_CHARS[charOf.size];
      charOf.set(gk, ch);
      legend[ch] = c.hatches.length ? { blockId: c.blockId, hatches: c.hatches } : { blockId: c.blockId };
    }
    return ch;
  };
  const layers = [];
  for (let y = 0; y < size[1]; y++) {
    const rows = [];
    for (let z = 0; z < size[2]; z++) {
      let row = '';
      for (let x = 0; x < size[0]; x++) {
        const k = vkey([x, y, z]);
        if (k === vkey(ctrlPos)) row += '~';
        else if (grid.has(k)) row += legendChar(grid.get(k));
        else if (air.has(vkey([x + min[0], y + min[1], z + min[2]]))) row += '-';
        else row += outside.has(k) ? ' ' : '-';
      }
      rows.push(row);
    }
    layers.push(rows);
  }

  // The extractor builds every controller facing north. A few have structure right in front (the player
  // stands inside or beside them); then the first open side is used, as the game allows any facing there.
  const dirs = ['north', 'south', 'west', 'east'];
  const facing =
    dirs.find((dir) => facesOpen(layers, size, ctrlPos, dir, true)) ??
    dirs.find((dir) => facesOpen(layers, size, ctrlPos, dir, false));
  if (!facing) throw new Error('the controller has structure on every side');

  // Hatch kinds: a kind whose cells all face only into the structure cannot be placed by the planner.
  const reachable = openCells(layers, size, ctrlPos, facing);
  const used = sortKinds(Object.values(legend).flatMap((e) => e.hatches ?? []));
  const sealed = [];
  const kinds = used.filter((k) => {
    const chars = Object.entries(legend)
      .filter(([, e]) => e.hatches?.includes(k))
      .map(([c]) => c);
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++)
          if (chars.includes(layers[y][z][x]))
            for (const [dx, dy, dz] of NEIGHBOURS)
              if (reachable.has(vkey([x + dx, y + dy, z + dz]))) return true;
    sealed.push(k);
    return false;
  });
  const required = {};
  if (kinds.includes('dynamo')) required.dynamo = { min: 1 };
  else if (kinds.includes('energy')) required.energy = { min: 1 };
  if (kinds.includes('maintenance')) required.maintenance = { min: 1 };
  if (kinds.includes('muffler')) required.muffler = { min: 1 };
  const io = ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'steamIn'].filter((k) => kinds.includes(k));
  const hasItems = kinds.includes('itemIn') || kinds.includes('itemOut');
  const defaults = kinds.filter(
    (k) =>
      ['energy', 'dynamo', 'maintenance', 'muffler', 'itemIn', 'itemOut'].includes(k) ||
      (['fluidIn', 'fluidOut', 'steamIn'].includes(k) && !hasItems),
  );
  const names = classNames(ctrl.source_class);
  const notes = [
    sealed.length ? `The structure has no open face for: ${sealed.join(', ')} (left out of the plan).` : '',
    dropped.size
      ? `Machine-specific hatches (${[...dropped].sort().join(', ')}) are shown as their cells only.`
      : '',
    `Built by the game itself: ${names.inner ?? names.outer} (GT5-Unofficial ${TAG}) placed every block with the` +
      ` hologram's construct() (tools/game-dump). Hatch counts are approximate (energy or dynamo, maintenance and` +
      ` muffler as the structure allows); check the tooltip in game.`,
  ].filter(Boolean);
  const def = {
    id,
    name,
    generated: true,
    source: REPO + names.file,
    size,
    layers,
    legend,
    controller: { pos: ctrlPos, facing, blockId: blockIdOf(ctrl.registry_name, ctrl.meta) },
    hatchBlocks: Object.fromEntries(used.map((k) => [k, HATCH_BLOCKS[k]])),
    shareableHatches: io,
    requiredHatches: required,
    defaultHatches: defaults,
    wallshare: true,
    notes: notes.join(' '),
  };
  const blocks = new Set(Object.values(legend).map((e) => e.blockId));
  blocks.add(def.controller.blockId);
  return { def, blocks, variant, dropped };
}

/** Whether the controller can look `dir`: the cell in front is open, and with `clear` every cell up to the box. */
function facesOpen(layers, [sx, , sz], [cx, cy, cz], dir, clear) {
  const [dx, dz] = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[dir];
  for (let x = cx + dx, z = cz + dz; x >= 0 && x < sx && z >= 0 && z < sz; x += dx, z += dz) {
    if (!' -'.includes(layers[cy][z][x])) return false;
    if (!clear) break;
  }
  return true;
}

/** Empty cells connected to the outside (never below ground, never the cell in front of the controller). */
function openCells(layers, [sx, sy, sz], ctrl, facing) {
  const [fx, fz] = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[facing];
  const blocked = (x, y, z) => {
    if (y < 0) return true;
    if (x === ctrl[0] + fx && y === ctrl[1] && z === ctrl[2] + fz) return true;
    if (x < 0 || x >= sx || y >= sy || z < 0 || z >= sz) return false;
    return layers[y][z][x] !== ' ';
  };
  const inRange = (x, y, z) => x >= -1 && x <= sx && y >= 0 && y <= sy && z >= -1 && z <= sz;
  const seen = new Set(['-1,0,-1']);
  const queue = [[-1, 0, -1]];
  while (queue.length) {
    const [x, y, z] = queue.pop();
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const n = [x + dx, y + dy, z + dz];
      const k = vkey(n);
      if (seen.has(k) || !inRange(...n) || blocked(...n)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen;
}

// ------------------------------------------------------------------------------------------------------------
// Textures

/** The inactive layer stack of one side of a manifest entry, or null. */
function sideLayers(entry, side) {
  const s = entry?.sides?.[side];
  const layers = s?.inactive ?? s?.active ?? null;
  return layers && layers.length ? layers : null;
}

const stackKey = (layers) => JSON.stringify(layers.map((l) => [l.icon, l.rgba?.slice(0, 3)]));

/** The most common horizontal layer stack (casings are the same all round; pillars and logs are not). */
function commonSide(entry, sides = SIDES) {
  const counts = new Map();
  for (const s of sides) {
    const l = sideLayers(entry, s);
    if (!l) continue;
    const k = stackKey(l);
    const c = counts.get(k) ?? { n: 0, l };
    c.n++;
    counts.set(k, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.l ?? null;
}

class TileSet {
  constructor(composer) {
    this.composer = composer;
    /** tile name → pixels */
    this.tiles = new Map();
    /** sprites the tiles are made from */
    this.sprites = new Set();
    /** tile name → the sprites it is made from */
    this.from = new Map();
  }

  /**
   * Composites a stack into a tile and returns its name, or null when a layer cannot be drawn (missing, or from a
   * jar whose textures may not be redistributed: those blocks keep a flat colour).
   */
  add(layers, prefix = 'DUMP') {
    if (!layers || !layers.every((l) => this.composer.allowed(l.icon))) return null;
    const px = this.composer.compose(layers);
    if (!px) return null;
    const drawn = layers.filter((l) => this.composer.sprite(l.icon, l.rgba));
    const used = drawn.map((l) => l.icon);
    for (const icon of used) this.sprites.add(icon);
    const name = this.put(px, `${prefix}_${readableName(drawn)}`);
    this.from.set(name, [...new Set([...(this.from.get(name) ?? []), ...used])].sort());
    return name;
  }

  /**
   * Stores a tile under `name` (a readable name made from its layers). Identical pixels share the first name;
   * different pixels that would get the same name get a numbered one.
   */
  put(px, name) {
    this.byPixels ??= new Map();
    const hash = pixelHash(px);
    const known = this.byPixels.get(hash);
    if (known) return known;
    let out = name;
    for (let i = 2; this.tiles.has(out); i++) out = `${name}_${i}`;
    this.tiles.set(out, px);
    this.byPixels.set(hash, out);
    return out;
  }
}

/**
 * `MACHINE_CASING_SOLID_STEEL`, `FRAMEGT_808080` (a tinted sprite carries its tint), overlays joined with `__`:
 * the tile's sprites by file name, so the files in tools/texture-sources say what they are.
 */
function readableName(layers) {
  const part = (l) => {
    const segs = l.icon.split(/[:/]/);
    // `compactFusionCoil/0`: a bare number says nothing without its folder.
    const base = (segs[segs.length - 1].length <= 2 ? segs.slice(-2).join('_') : segs[segs.length - 1])
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toUpperCase();
    const t = l.rgba?.slice(0, 3);
    const tinted = t && (t[0] !== 255 || t[1] !== 255 || t[2] !== 255);
    return tinted
      ? `${base}_${t
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`
      : base;
  };
  const name = layers.map(part).join('__');
  return name.length > 90 ? name.slice(0, 90).replace(/_+$/, '') : name;
}

/** Faces of a plain block: its side, and its own top and bottom when they differ. */
function blockFaces(tiles, entry) {
  const side = tiles.add(commonSide(entry));
  if (!side) return null;
  const faces = { side };
  const top = tiles.add(sideLayers(entry, 'UP'));
  const bottom = tiles.add(sideLayers(entry, 'DOWN'));
  if (top && top !== side) faces.top = top;
  if (bottom && bottom !== side) faces.bottom = bottom;
  return faces;
}

/**
 * Faces of a controller (the extractor dumps machines facing north): the back is its side, and the north face is
 * baked in full as `front` (the renderer draws `front` over `side`, and the baked tile is opaque).
 */
function controllerFaces(tiles, entry) {
  const side = tiles.add(commonSide(entry, ['SOUTH', 'WEST', 'EAST']));
  if (!side) return null;
  const faces = { side };
  const top = tiles.add(sideLayers(entry, 'UP'));
  const bottom = tiles.add(sideLayers(entry, 'DOWN'));
  if (top && top !== side) faces.top = top;
  if (bottom && bottom !== side) faces.bottom = bottom;
  const front = tiles.add(sideLayers(entry, 'NORTH'));
  if (front && front !== side) faces.front = front;
  return faces;
}

/**
 * The overlays a hatch draws on its front, without its hull: the layers of the north face after the ones it shares
 * with the back. Returns [base overlays, last overlay] as tiles; the renderer tints the last one per hatch kind.
 */
function hatchOverlay(tiles, entry) {
  const front = sideLayers(entry, 'NORTH');
  const back = sideLayers(entry, 'SOUTH');
  if (!front || !back) return null;
  let i = 0;
  while (i < front.length && i < back.length && stackKey([front[i]]) === stackKey([back[i]])) i++;
  const over = front.slice(i);
  if (!over.length) return null;
  const out = [];
  if (over.length > 1) out.push(tiles.add(over.slice(0, -1), 'DUMP_HATCH'));
  out.push(tiles.add(over.slice(-1), 'DUMP_HATCH'));
  return out.filter(Boolean);
}

// ------------------------------------------------------------------------------------------------------------
// Main

function parseArgs(argv) {
  const o = { jars: [], write: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--structures') o.structures = argv[++i];
    else if (a === '--textures') o.textures = argv[++i];
    else if (a === '--gt5u') o.gt5u = argv[++i];
    else if (a === '--jars') while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.jars.push(argv[++i]);
    else if (a === '--write') o.write = true;
    else if (a === '--verbose') o.verbose = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.structures || !(o.textures || o.gt5u) || !o.jars.length)
    throw new Error(
      'usage: build.mjs --structures <dir> (--textures <manifest.json> | --gt5u <checkout>) --jars <dir|jar>... [--write]',
    );
  return o;
}

/** Display names the game reports as raw lang keys get a readable name instead. */
function displayName(doc, fallback) {
  const n = doc.controller.display_name?.trim();
  if (n && !/\.name$|^gt\.|^tile\.|^item\./.test(n)) return n;
  if (fallback) return fallback;
  const { inner, outer } = classNames(doc.controller.source_class);
  return (inner ?? outer)
    .replace(/^(?:MTE|TileEntity|GT_MetaTileEntity_)/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

export async function build(opts) {
  const log = console.log;
  const { hand, generated } = readCatalog();
  // `*Legacy` controllers are the old versions GT keeps so existing worlds load; they cannot be crafted.
  const seen = new Set();
  const docs = readStructures(opts.structures).filter((d) => {
    if (/Legacy$/.test(d.controller.source_class)) return false;
    // One machine registered under two ids (the Drone Centre): keep the first.
    const k = `${d.controller.source_class}|${d.controller.display_name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const jars = new TextureJars(listJars(opts.jars));
  let manifest;
  if (opts.textures) manifest = JSON.parse(readFileSync(opts.textures, 'utf8'));
  else {
    const st = new StaticTextures(opts.gt5u, jars);
    const res = staticManifest(st, docs);
    manifest = { blocks: res.blocks, method: 'static' };
    if (res.gaps.length) log(`static textures: no texture for ${res.gaps.join(', ')}`);
  }
  // Only GT5-Unofficial's textures (LGPL-3.0) go into the atlas; other blocks (vanilla, AE2) keep a flat colour.
  const composer = new Composer(jars, (jar) => /GT5-Unofficial|gregtech-5/i.test(basename(jar)));
  const tiles = new TileSet(composer);

  // --- ids ---------------------------------------------------------------------------------------------------
  const handByClass = new Map();
  for (const h of hand) if (h.cls) handByClass.set(h.cls, [...(handByClass.get(h.cls) ?? []), h]);
  const oldByClass = new Map();
  for (const g of generated) if (g.cls) oldByClass.set(g.cls, [...(oldByClass.get(g.cls) ?? []), g]);
  const taken = new Set(hand.map((h) => h.id));
  const defs = [];
  const skipped = [];
  const covered = [];
  // Several controllers of one class (tiers, nested classes): each claims an old id by name first.
  const claims = new Map();
  const dumpedClasses = new Set(docs.map((d) => classNames(d.controller.source_class).outer));
  // Generated entries of classes the dump could not build (their mods are not in the dump's game) stay as they are.
  const retained = generated.filter((g) => !g.cls || !dumpedClasses.has(g.cls));
  for (const r of retained) taken.add(r.id);
  for (const doc of docs) {
    const { outer } = classNames(doc.controller.source_class);
    const handMade = handByClass.get(outer);
    if (handMade) {
      covered.push({
        doc,
        hand: handMade.find((x) => x.name === doc.controller.display_name) ?? handMade[0],
      });
      continue;
    }
    const olds = (oldByClass.get(outer) ?? []).filter((g) => !claims.has(g.id));
    const old =
      olds.find((g) => g.name === doc.controller.display_name) ?? (olds.length === 1 ? olds[0] : null);
    const name = displayName(doc, old?.name);
    let id = old?.id ?? slug(name);
    if (taken.has(id)) id = `${id}-${doc.controller.meta}`;
    if (old) claims.set(old.id, doc);
    taken.add(id);
    try {
      defs.push({ doc, ...convertStructure(doc, { id, name }) });
    } catch (e) {
      skipped.push({ name, why: e.message });
    }
  }

  // --- blocks and faces -------------------------------------------------------------------------------------------
  const faces = {};
  const blocks = new Map(); // id → { name, color }
  const gaps = [];
  const used = new Set(defs.flatMap((d) => [...d.blocks]));
  // A hand-made entry keeps its own structure but shows its machine's own controller: the dump knows which block
  // that is (by name when several entries share a class, as the turbines do).
  const handControllers = new Map(); // hand entry id -> { blockId, name }
  for (const { doc, hand: h } of covered) {
    const exact = h.name === doc.controller.display_name;
    if (handControllers.has(h.id) && !exact) continue;
    handControllers.set(h.id, {
      blockId: blockIdOf(doc.controller.registry_name, doc.controller.meta),
      name: h.name,
    });
  }
  for (const { blockId } of handControllers.values()) used.add(blockId);
  const controllerName = (id) => {
    const d = defs.find((x) => x.def.controller.blockId === id);
    if (d) return `${d.def.name} Controller`;
    const h = [...handControllers.values()].find((x) => x.blockId === id);
    return h ? `${h.name} Controller` : null;
  };
  // A sprite no jar carries (vanilla, AE2) cannot give a flat colour: the previous run's colour stays.
  const previousColor = new Map(
    (existsSync(BLOCKS_OUT) ? JSON.parse(readFileSync(BLOCKS_OUT, 'utf8')) : []).map((b) => [b.id, b.color]),
  );
  for (const id of [...used].sort()) {
    if (id.startsWith('gt.hatch.')) continue;
    const at = id.lastIndexOf('@');
    const key = `${id.slice(0, at)}|${id.slice(at + 1)}`;
    const entry = manifest.blocks[key];
    const isController = controllerName(id) !== null;
    const f = entry ? (isController ? controllerFaces(tiles, entry) : blockFaces(tiles, entry)) : null;
    if (f) faces[id] = f;
    else gaps.push(id);
    const name = entry?.display_name ?? (isController ? controllerName(id) : null) ?? id;
    const flat = !f && entry ? composer.compose(commonSide(entry) ?? []) : null;
    const color = f ? meanColor(tiles.tiles.get(f.side)) : flat ? meanColor(flat) : null;
    blocks.set(id, { name, color: color ?? previousColor.get(id) ?? '#8f8f8f' });
  }
  // A cell only a machine-specific hatch may fill: an HV machine hull, as those hatches mostly are.
  blocks.set('gt.hatch.special', { name: 'Machine-specific Hatch', color: '#6b7280' });
  const hull = (n) => [{ icon: `gregtech:iconsets/MACHINE_HV_${n}`, rgba: [210, 220, 255, 0] }];
  faces['gt.hatch.special'] = {
    side: tiles.add(hull('SIDE')),
    top: tiles.add(hull('TOP')),
    bottom: tiles.add(hull('BOTTOM')),
  };

  // Retained entries keep the blocks and faces the source converter gave them.
  // (from the source converter's file on the first run, from this script's own output after that).
  const oldFile = [OLD_TEXTURES, TEXTURES_OUT].find((f) => existsSync(f));
  const oldTextures = oldFile ? JSON.parse(readFileSync(oldFile, 'utf8')) : { tiles: {}, blocks: {} };
  const oldBlocks = new Map(
    (existsSync(BLOCKS_OUT) ? JSON.parse(readFileSync(BLOCKS_OUT, 'utf8')) : []).map((b) => [b.id, b]),
  );
  const carriedTiles = {};
  for (const r of retained) {
    const ids = [r.def.controller.blockId, ...Object.values(r.def.legend).map((e) => e.blockId)];
    for (const id of ids) {
      if (blocks.has(id) || !oldBlocks.has(id)) continue;
      const { name, color } = oldBlocks.get(id);
      blocks.set(id, { name, color });
      const f = oldTextures.blocks[id];
      if (!f) continue;
      faces[id] = f;
      for (const t of Object.values(f)) if (oldTextures.tiles[t]) carriedTiles[t] = oldTextures.tiles[t];
    }
  }

  // --- hatches: the real overlays of the LV hatches -------------------------------------------------------------
  const mtes = Object.entries(manifest.blocks).filter(([, e]) => e.kind === 'mte');
  const findMte = (re) => mtes.find(([, e]) => re.test(e.display_name ?? ''))?.[1];
  const HATCH_MTE = {
    itemIn: /^Input Bus \(LV\)$/,
    itemOut: /^Output Bus \(LV\)$/,
    fluidIn: /^Input Hatch \(LV\)$/,
    fluidOut: /^Output Hatch \(LV\)$/,
    energy: /^LV Energy Hatch$/,
    dynamo: /^LV Dynamo Hatch$/,
    maintenance: /^Maintenance Hatch$/,
    muffler: /^Muffler Hatch \(LV\)$/,
    steamIn: /^Input Hatch \(LV\)$/,
  };
  const hatchOverlays = {};
  for (const [kind, re] of Object.entries(HATCH_MTE)) {
    const e = findMte(re);
    const o = e && hatchOverlay(tiles, e);
    if (o?.length) hatchOverlays[kind] = o;
    else if (manifest.method !== 'static') gaps.push(`hatch overlay ${kind}`);
  }
  const special = findMte(/^Data Access Hatch$/) ?? findMte(/Hatch \(HV\)$/);
  if (special) {
    const f = controllerFaces(tiles, special);
    if (f) faces['gt.hatch.special'] = { side: f.side, top: f.top, bottom: f.bottom, front: f.front };
  }

  // --- report --------------------------------------------------------------------------------------------------
  log(
    `controllers ${docs.length}: generated ${defs.length}, hand-made ${covered.length}, skipped ${skipped.length}`,
  );
  for (const s of skipped) log(`  skipped ${s.name}: ${s.why}`);
  log(`blocks ${blocks.size}, tiles ${tiles.tiles.size}, sprites ${tiles.sprites.size}`);
  if (gaps.length) log(`no texture: ${gaps.join(', ')}`);
  if (composer.missing.size) log(`sprites no jar carries: ${[...composer.missing].sort().join(', ')}`);
  const newIds = defs.filter((d) => !generated.some((g) => g.id === d.def.id)).map((d) => d.def.id);
  const goneIds = generated
    .filter((g) => !retained.includes(g) && !defs.some((d) => d.def.id === g.id))
    .map((g) => g.id);
  log(`new entries (${newIds.length}): ${newIds.join(', ')}`);
  log(`entries gone (${goneIds.length}): ${goneIds.join(', ')}`);
  log(`retained source-converted entries (${retained.length}): ${retained.map((r) => r.id).join(', ')}`);

  if (!opts.write) return { defs, skipped, covered, retained };

  // --- write ---------------------------------------------------------------------------------------------------
  for (const g of generated) if (!retained.includes(g)) rmSync(join(MULTI_DIR, `${g.id}.json`));
  for (const { def } of defs)
    await writeFormatted(join(MULTI_DIR, `${def.id}.json`), JSON.stringify(def) + '\n');
  // Hand-made entries that still show the generic controller get their machine's own.
  for (const h of hand) {
    const c = handControllers.get(h.id);
    if (!c || h.def.controller.blockId !== 'gt.controller') continue;
    const def = { ...h.def, controller: { ...h.def.controller, blockId: c.blockId } };
    await writeFormatted(join(MULTI_DIR, `${h.id}.json`), JSON.stringify(def) + '\n');
  }

  // Tiles: the composited ones are written here; carried ones keep their source file and options.
  const before = existsSync(TEXTURES_OUT)
    ? Object.keys(JSON.parse(readFileSync(TEXTURES_OUT, 'utf8')).tiles)
    : [];
  const oldTiles = Object.keys(oldTextures.tiles);
  mkdirSync(SRC_DIR, { recursive: true });
  const { HAND_TILES } = await import(pathToFileURL(join(ROOT, 'scripts/build-atlas.mjs')).href);
  for (const t of [...before, ...oldTiles])
    if (!tiles.tiles.has(t) && !carriedTiles[t] && !HAND_TILES[t])
      rmSync(join(SRC_DIR, `${t}.png`), { force: true });
  for (const [name, px] of tiles.tiles)
    writeFileSync(join(SRC_DIR, `${name}.png`), encodePng({ width: TILE, height: TILE, data: px }));
  if (existsSync(OLD_TEXTURES)) rmSync(OLD_TEXTURES);
  const sortedFaces = Object.fromEntries(Object.entries(faces).sort(([a], [b]) => a.localeCompare(b)));
  const allTiles = {
    ...carriedTiles,
    ...Object.fromEntries(
      [...tiles.tiles.keys()].map((t) => [
        t,
        { from: (tiles.from.get(t) ?? []).map((i) => jars.assetPath(i)) },
      ]),
    ),
  };
  await writeFormatted(
    TEXTURES_OUT,
    JSON.stringify({
      $comment: 'Generated by tools/game-dump/build.mjs. Do not edit by hand.',
      method: manifest.method ?? 'client',
      tiles: Object.fromEntries(Object.entries(allTiles).sort(([a], [b]) => a.localeCompare(b))),
      blocks: sortedFaces,
      ...(Object.keys(hatchOverlays).length ? { hatchOverlays } : {}),
    }) + '\n',
  );
  await writeFormatted(
    BLOCKS_OUT,
    JSON.stringify([...blocks].sort(([a], [b]) => a.localeCompare(b)).map(([id, b]) => ({ id, ...b }))) +
      '\n',
  );
  writeAttribution(
    [...tiles.sprites].sort().map((s) => jars.assetPath(s)),
    [...new Set(Object.values(carriedTiles).map((t) => t.path))].sort(),
  );
  log('written');
  return { defs, skipped, covered };
}

const ATTRIBUTION_START = '<!-- tools/game-dump: generated textures -->';
const ATTRIBUTION_END = '<!-- /tools/game-dump -->';

/** `paths`: sprites in the GT5-Unofficial jar; `carried`: repo paths of the tiles the source converter left. */
function writeAttribution(paths, carried) {
  const file = join(ROOT, 'ATTRIBUTION.md');
  let text = readFileSync(file, 'utf8');
  // The section the old source converter wrote is replaced too.
  text = text.replace(
    /<!-- tools\/gt-source: generated textures -->[\s\S]*?<!-- \/tools\/gt-source -->\n?/,
    '',
  );
  const section = [
    ATTRIBUTION_START,
    '',
    '### Files used by the generated catalog entries',
    '',
    'The face tiles of the generated catalog entries (`tools/texture-sources/DUMP_*.png`, see',
    '[`tools/game-dump/`](tools/game-dump/)) are these block sprites of the GT5-Unofficial `5.09.54.205` jar (the',
    'resources under `src/main/resources/` in the repository), tinted and layered the way the game draws them:',
    '',
    ...paths.map((p) => `- \`src/main/resources/${p}\``),
    '',
    ...(carried.length
      ? [
          'The entries still converted from the sources use these files, copied from the same tag; frame boxes are the',
          'material icon multiplied by the material colour:',
          '',
          ...carried.map((p) => `- \`${p}\``),
          '',
        ]
      : []),
    ATTRIBUTION_END,
  ].join('\n');
  const i = text.indexOf(ATTRIBUTION_START);
  text =
    i >= 0
      ? text.slice(0, i) + section + text.slice(text.indexOf(ATTRIBUTION_END) + ATTRIBUTION_END.length)
      : text.replace(/\n*$/, '\n\n') + section + '\n';
  writeFileSync(file, text);
}

async function writeFormatted(file, text) {
  let out = text;
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    out = await prettier.format(text, { ...options, filepath: file });
  } catch {
    // Prettier missing: plain JSON.
  }
  writeFileSync(file, out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
