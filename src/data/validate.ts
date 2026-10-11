import type { Dir, HorizontalDir } from '../model/core/types';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import { BLOCKS } from './blocks';

export const HATCH_KINDS: readonly HatchKind[] = [
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

const HORIZONTAL: readonly HorizontalDir[] = ['north', 'south', 'east', 'west'];
const DIRS: readonly Dir[] = [...HORIZONTAL, 'up', 'down'];
const RESERVED = new Set(['~', '-', ' ']);
const ID_RE = /^[a-z0-9-]+$/;

function isHatchKind(k: unknown): k is HatchKind {
  return typeof k === 'string' && (HATCH_KINDS as readonly string[]).includes(k);
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/**
 * Checks a multiblock definition for structural consistency.
 * Returns a list of human-readable problems; an empty list means the def is valid.
 * Pass `fileName` (base name without `.json`) to also check that it matches `def.id`.
 */
export function validateMultiblockDef(def: MultiblockDef, fileName?: string): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  // id / name
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) err(`id "${def.id}" must match ${ID_RE}`);
  if (fileName !== undefined && fileName !== def.id)
    err(`id "${def.id}" does not match file name "${fileName}"`);
  if (typeof def.name !== 'string' || def.name.trim() === '') err('name must be a non-empty string');
  if (def.source !== undefined && !/^https?:\/\//.test(def.source)) err('source must be an http(s) URL');

  // size and layers
  const size = def.size;
  const sizeOk = Array.isArray(size) && size.length === 3 && size.every((n) => isInt(n) && n >= 1);
  if (!sizeOk) {
    err(`size must be three positive integers, got ${JSON.stringify(size)}`);
    return errors;
  }
  const [sx, sy, sz] = size;
  const legend = def.legend ?? {};

  for (const ch of Object.keys(legend)) {
    if (ch.length !== 1) err(`legend key "${ch}" must be a single character`);
    if (RESERVED.has(ch)) err(`legend key "${ch}" is reserved`);
  }

  const controllers: [number, number, number][] = [];
  if (!Array.isArray(def.layers) || def.layers.length !== sy) {
    err(`layers has ${def.layers?.length} entries, expected size[1] = ${sy}`);
  } else {
    def.layers.forEach((layer, y) => {
      if (!Array.isArray(layer) || layer.length !== sz) {
        err(`layer ${y} has ${layer?.length} rows, expected size[2] = ${sz}`);
        return;
      }
      layer.forEach((row, z) => {
        if (typeof row !== 'string' || row.length !== sx) {
          err(`layer ${y} row ${z} has length ${row?.length}, expected size[0] = ${sx}`);
          return;
        }
        [...row].forEach((ch, x) => {
          if (ch === '~') controllers.push([x, y, z]);
          else if (!RESERVED.has(ch) && !(ch in legend))
            err(`unknown char "${ch}" at ${x},${y},${z} (not in legend)`);
        });
      });
    });
  }

  // controller
  const c = def.controller;
  if (!c) {
    err('controller is missing');
  } else {
    if (controllers.length !== 1) err(`expected exactly one "~", found ${controllers.length}`);
    const pos = c.pos;
    const posOk = Array.isArray(pos) && pos.length === 3 && pos.every(isInt);
    if (!posOk) err(`controller.pos must be three integers, got ${JSON.stringify(pos)}`);
    else if (controllers.length === 1) {
      const [x, y, z] = controllers[0];
      if (pos[0] !== x || pos[1] !== y || pos[2] !== z)
        err(`controller.pos ${pos.join(',')} does not match "~" at ${x},${y},${z}`);
    }
    if (!HORIZONTAL.includes(c.facing)) err(`controller.facing "${c.facing}" must be a horizontal direction`);
    else if (posOk) {
      // The cell the controller looks at is open (air, not part of the structure, or outside the box), e.g.
      // the rotor space in front of a Large Turbine or the recess under a Research Station's arm.
      const step = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }[c.facing];
      const [x, y, z] = [pos[0] + step[0], pos[1], pos[2] + step[2]];
      const inside = x >= 0 && x < sx && z >= 0 && z < sz;
      const open = !inside || [' ', '-'].includes([...(def.layers[y]?.[z] ?? '')][x] ?? ' ');
      if (!open) err(`controller at ${pos.join(',')} does not face open space on the ${c.facing} side`);
    }
    if (!BLOCKS[c.blockId]) err(`controller.blockId "${c.blockId}" is not in BLOCKS`);
  }

  // legend entries
  const allowed = new Set<HatchKind>();
  const regions = new Map<string, Set<HatchKind>>();
  for (const [ch, entry] of Object.entries(legend)) {
    if (!BLOCKS[entry.blockId]) err(`legend "${ch}" blockId "${entry.blockId}" is not in BLOCKS`);
    if (entry.hatches !== undefined) {
      if (!Array.isArray(entry.hatches) || entry.hatches.length === 0)
        err(`legend "${ch}" hatches must be a non-empty array when present`);
      else
        for (const k of entry.hatches) {
          if (!isHatchKind(k)) err(`legend "${ch}" has invalid hatch kind "${k}"`);
          else allowed.add(k);
        }
    }
    for (const [k, dirs] of Object.entries(entry.disallowFaces ?? {})) {
      if (!isHatchKind(k) || !entry.hatches?.includes(k))
        err(`legend "${ch}" disallowFaces.${k} but the cell does not allow "${k}"`);
      if (!Array.isArray(dirs) || dirs.some((d) => !DIRS.includes(d)))
        err(`legend "${ch}" disallowFaces.${k} must list directions`);
    }
    if (entry.region !== undefined) {
      if (typeof entry.region !== 'string' || entry.region === '')
        err(`legend "${ch}" region must be a name`);
      else {
        const kinds = regions.get(entry.region) ?? new Set<HatchKind>();
        for (const k of entry.hatches ?? []) kinds.add(k);
        regions.set(entry.region, kinds);
      }
    }
  }

  // hatch blocks
  const hatchBlocks = def.hatchBlocks ?? {};
  for (const [k, id] of Object.entries(hatchBlocks)) {
    if (!isHatchKind(k)) err(`hatchBlocks has invalid hatch kind "${k}"`);
    if (typeof id !== 'string' || !BLOCKS[id]) err(`hatchBlocks.${k} "${id}" is not in BLOCKS`);
  }
  for (const k of allowed)
    if (!hatchBlocks[k]) err(`hatch kind "${k}" is allowed but has no hatchBlocks entry`);

  // hatch kind lists
  const checkList = (name: string, list: unknown) => {
    if (!Array.isArray(list)) {
      err(`${name} must be an array`);
      return [] as HatchKind[];
    }
    const seen = new Set<string>();
    for (const k of list) {
      if (!isHatchKind(k)) err(`${name} has invalid hatch kind "${k}"`);
      else if (!allowed.has(k)) err(`${name} lists "${k}" but no legend cell allows it`);
      if (seen.has(k)) err(`${name} lists "${k}" twice`);
      seen.add(k);
    }
    return list.filter(isHatchKind);
  };
  checkList('shareableHatches', def.shareableHatches);
  const defaults = checkList('defaultHatches', def.defaultHatches);

  // required hatches
  for (const [k, req] of Object.entries(def.requiredHatches ?? {})) {
    if (!isHatchKind(k)) {
      err(`requiredHatches has invalid hatch kind "${k}"`);
      continue;
    }
    if (!allowed.has(k)) err(`requiredHatches.${k} but no legend cell allows it`);
    if (!req || !isInt(req.min) || req.min < 0) err(`requiredHatches.${k}.min must be an integer >= 0`);
    if (req?.max !== undefined && (!isInt(req.max) || req.max < (req.min ?? 0)))
      err(`requiredHatches.${k}.max must be an integer >= min`);
    for (const r of req?.regions ?? []) {
      if (!regions.get(r)?.has(k))
        err(`requiredHatches.${k}.regions lists "${r}" but no cell of it allows "${k}"`);
    }
    if (req?.regions && req.regions.length > (req.max ?? Infinity))
      err(`requiredHatches.${k}.regions needs more hatches than max allows`);
    // Only enabled kinds are placed, so a required kind must be enabled by default.
    if (req && req.min >= 1 && !defaults.includes(k))
      err(`requiredHatches.${k}.min >= 1 but "${k}" is not in defaultHatches`);
  }

  // hatch groups
  if (def.requiredAny !== undefined && !Array.isArray(def.requiredAny)) err('requiredAny must be an array');
  for (const [i, group] of (Array.isArray(def.requiredAny) ? def.requiredAny : []).entries()) {
    const at = `requiredAny[${i}]`;
    if (!Array.isArray(group?.kinds) || group.kinds.length === 0)
      err(`${at}.kinds must be a non-empty array`);
    const seen = new Set<string>();
    for (const k of Array.isArray(group?.kinds) ? group.kinds : []) {
      if (!isHatchKind(k)) err(`${at} has invalid hatch kind "${k}"`);
      else if (!allowed.has(k)) err(`${at} lists "${k}" but no legend cell allows it`);
      if (seen.has(k)) err(`${at} lists "${k}" twice`);
      seen.add(k);
    }
    if (!isInt(group?.min) || group.min < 1) err(`${at}.min must be an integer >= 1`);
  }

  // casing minimums
  if (def.minCasings !== undefined && !Array.isArray(def.minCasings)) err('minCasings must be an array');
  for (const [i, m] of (Array.isArray(def.minCasings) ? def.minCasings : []).entries()) {
    const at = `minCasings[${i}]`;
    const listed = Array.isArray(m?.chars) ? m.chars : [];
    if (listed.length === 0) err(`${at}.chars must be a non-empty array`);
    if (new Set(listed).size !== listed.length) err(`${at}.chars lists a character twice`);
    for (const ch of listed) if (!(ch in legend)) err(`${at}.chars lists "${ch}" which is not a legend key`);
    if (!isInt(m?.min) || m.min < 1) err(`${at}.min must be an integer >= 1`);
    if (m?.perSlab !== undefined && (!isInt(m.perSlab) || m.perSlab < 1 || def.resize === undefined))
      err(`${at}.perSlab must be an integer >= 1 and only on a resizable def`);
    // The minimum must be reachable: the structure itself holds that many such cells (no hatch in them).
    const chars = new Set(listed);
    let cells = 0;
    for (const layer of Array.isArray(def.layers) ? def.layers : [])
      for (const row of Array.isArray(layer) ? layer : [])
        if (typeof row === 'string') for (const ch of row) if (chars.has(ch)) cells++;
    if (isInt(m?.min) && cells < m.min)
      err(`${at}.min ${m.min} but the structure has only ${cells} such cells`);
  }

  // zones
  for (const [region, zone] of Object.entries(def.zones ?? {})) {
    const cellKinds = regions.get(region);
    if (!cellKinds) {
      err(`zones names "${region}" but no legend cell has that region`);
      continue;
    }
    if (!Array.isArray(zone?.kinds) || zone.kinds.length === 0)
      err(`zones.${region}.kinds must be a non-empty array`);
    for (const k of Array.isArray(zone?.kinds) ? zone.kinds : []) {
      if (!isHatchKind(k)) err(`zones.${region} has invalid hatch kind "${k}"`);
      else if (!cellKinds.has(k)) err(`zones.${region} lists "${k}" but no cell of the region allows it`);
    }
    if (zone?.text !== undefined && typeof zone.text !== 'string')
      err(`zones.${region}.text must be a string`);
  }

  if (typeof def.wallshare !== 'boolean') err('wallshare must be a boolean');

  if (def.resize !== undefined) checkResize(def, err, fileName !== undefined);

  return errors;
}

/**
 * A `resize` rule must describe a slab inside the box and sizes the JSON can grow to. A JSON file holds the
 * smallest form; an expanded def (`sizedDef`) keeps the rule at any valid size.
 */
function checkResize(def: MultiblockDef, err: (msg: string) => void, isFile: boolean): void {
  const r = def.resize!;
  const a = { x: 0, y: 1, z: 2 }[r.axis];
  if (a === undefined) {
    err(`resize.axis "${r.axis}" must be x, y or z`);
    return;
  }
  if (!['height', 'length'].includes(r.label)) err(`resize.label "${r.label}" must be height or length`);
  const len = def.size[a];
  if (![r.from, r.to, r.min, r.max, r.default].every(isInt)) {
    err('resize.from, to, min, max and default must be integers');
    return;
  }
  if (r.from < 0 || r.to <= r.from || r.to > len)
    err(`resize slab [${r.from}, ${r.to}) is not inside the box`);
  const t = r.to - r.from;
  if (isFile && r.min !== len) err(`resize.min ${r.min} must equal size along ${r.axis} (${len})`);
  else if (len < r.min || len > r.max || (len - r.min) % t !== 0)
    err(`size along ${r.axis} (${len}) is not a size resize allows`);
  if (r.max < r.min || (r.max - r.min) % t !== 0) err(`resize.max ${r.max} must be min plus whole slabs`);
  if (r.default < r.min || r.default > r.max || (r.default - r.min) % t !== 0)
    err(`resize.default ${r.default} must be a valid size between min and max`);
  const c = def.controller?.pos[a];
  if (c !== undefined && c >= r.from && c < r.to) err('resize slab must not contain the controller');
}
