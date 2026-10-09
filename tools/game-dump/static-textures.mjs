/**
 * Face textures of dumped blocks worked out from the GT5-Unofficial sources, for when no client texture dump is
 * at hand. Produces the same shape as the extractor's client manifest (`blocks["<registry>|<meta>"].sides[SIDE]
 * .inactive = [{ icon, rgba }]`), so build.mjs reads either.
 *
 * Every block is looked up the way the game registers it: GT casings by the name their class passes to `super`,
 * other mods by `GameRegistry.registerBlock` names and the texture names their constructors list; material blocks
 * (frames, sheetmetal, storage blocks, BartWorks material casings) by material id, tinted with the material colour;
 * vanilla blocks by a small table. Controllers are their hatch casing with the front overlay GT's `getTexture` draws.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findCalls, methodBody, splitArgs, stripComments } from '../gt-source/java.mjs';
import { Registry } from '../gt-source/registry.mjs';

const SIDES = ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'];
const WHITE = [255, 255, 255, 0];

/** `src/main/resources/assets/<mod>/textures/blocks/<path>.png` → `<mod>:<path>`. */
function iconOfPath(p) {
  const m = /assets\/([^/]+)\/textures\/blocks\/(.+)\.png$/.exec(p ?? '');
  return m ? `${m[1]}:${m[2]}` : null;
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Vanilla blocks the multiblocks use: meta → { side, top?, bottom?, tint? } (sprite names in `minecraft`). */
const VANILLA = {
  planks: (m) => ({ side: `planks_${['oak', 'spruce', 'birch', 'jungle', 'acacia', 'big_oak'][m % 6]}` }),
  log: (m) => {
    const wood = ['oak', 'spruce', 'birch', 'jungle'][m & 3];
    return { side: `log_${wood}`, top: `log_${wood}_top`, bottom: `log_${wood}_top` };
  },
  leaves: (m) => ({ side: `leaves_${['oak', 'spruce', 'birch', 'jungle'][m & 3]}`, tint: [72, 181, 24] }),
  dirt: () => ({ side: 'dirt' }),
  farmland: () => ({ side: 'dirt', top: 'farmland_dry' }),
  brick_block: () => ({ side: 'brick' }),
  hardened_clay: () => ({ side: 'hardened_clay' }),
  water: () => ({ side: 'water_still', tint: [63, 118, 228] }),
  flowing_water: () => ({ side: 'water_flow', tint: [63, 118, 228] }),
  lava: () => ({ side: 'lava_still' }),
  flowing_lava: () => ({ side: 'lava_flow' }),
  redstone_lamp: () => ({ side: 'redstone_lamp_off' }),
  lit_redstone_lamp: () => ({ side: 'redstone_lamp_on' }),
  iron_block: () => ({ side: 'iron_block' }),
  gold_block: () => ({ side: 'gold_block' }),
  diamond_block: () => ({ side: 'diamond_block' }),
  glass: () => ({ side: 'glass' }),
  stone: () => ({ side: 'stone' }),
  cobblestone: () => ({ side: 'cobblestone' }),
  stonebrick: () => ({ side: 'stonebrick' }),
  obsidian: () => ({ side: 'obsidian' }),
  glowstone: () => ({ side: 'glowstone' }),
  anvil: () => ({ side: 'anvil_base', top: 'anvil_top_damaged_0' }),
  grass: () => ({ side: 'grass_side', top: 'grass_top', bottom: 'dirt', tint: null }),
  sand: () => ({ side: 'sand' }),
  clay: () => ({ side: 'clay' }),
  wool: (m) => ({
    side: `wool_colored_${['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'][m & 15]}`,
  }),
};

/**
 * Blocks whose icons are registered in code the source reader does not follow (arrays filled in
 * `registerBlockIcons`, per-meta fields): registry name → meta → { side, top?, bottom? } sprite names, read from
 * the classes named in the comments.
 */
const MANUAL = {
  // BlockCasingDysonSwarm: `dysonSwarm/<name>_Side` on the sides, `dysonSwarm/<name>` on top and bottom.
  'gtnhintergalactic:dysonswarmparts': (m) => {
    const n = [
      'ReceiverCasing',
      'ReceiverDish',
      'DeploymentUnitCasing',
      'DeploymentUnitCore',
      'DeploymentUnitMagnet',
      'ControlCasing',
      'ControlPrimary',
      'ControlSecondary',
      'ControlToroid',
      'Floor',
    ][m];
    return n && { side: `gtnhintergalactic:dysonSwarm/${n}_Side`, top: `gtnhintergalactic:dysonSwarm/${n}` };
  },
  'gtnhintergalactic:gassiphoncasing': () => ({ side: 'gtnhintergalactic:gasSiphon/SiphonCasing' }),
  // BlockDEFCCasing: `casing/defc_<meta - 7>`, metas 7 to 12.
  'kubatech:defc.casing': (m) => ({ side: `kubatech:casing/defc_${Math.max(0, m - 7)}` }),
  // BlockLapotronicEnergyUnit: meta → icon pair.
  'kekztech:kekztech_lapotronicenergyunit_block': (m) => {
    const base =
      {
        0: 'LSCBase',
        1: 'LapotronicEnergyUnit1',
        2: 'LapotronicEnergyUnit2',
        3: 'LapotronicEnergyUnit3',
        4: 'LapotronicEnergyUnit4',
        5: 'UltimateEnergyUnit',
        6: 'LapotronicEnergyUnit6',
        7: 'LapotronicEnergyUnit7',
        8: 'UltimateExtremeEnergyUnit',
        9: 'UltimateInsaneEnergyUnit',
        10: 'UltimateMegaEnergyUnit',
      }[m] ?? 'LSCBase';
    return { side: `kekztech:${base}_side`, top: `kekztech:${base}_top` };
  },
  // BlockTFFTStorageField: `TFFTCasing` for meta 0, `TFFTStorageFieldBlock<meta>` after.
  'kekztech:kekztech_tfftstoragefield_block': (m) => ({
    side: m === 0 ? 'kekztech:TFFTCasing' : `kekztech:TFFTStorageFieldBlock${m}`,
  }),
  'kekztech:kekztech_gdcceramicelectrolyteunit_block': () => ({ side: 'kekztech:GDCCeramicElectrolyteUnit' }),
  'kekztech:kekztech_yszceramicelectrolyteunit_block': () => ({ side: 'kekztech:YSZCeramicElectrolyteUnit' }),
  'tectech:tile.spatiallyTranscendentGravitationalLens': () => ({
    side: 'tectech:blockSpatiallyTranscendentGravitationalLens',
  }),
  // BlockGTCasingsBA0 (Tesla Tower parts): windings, base, toroid, EOH casings.
  'tectech:gt.blockcasingsBA0': (m) => {
    const pair = (n) => ({ side: `gregtech:iconsets/${n}_SIDES`, top: `gregtech:iconsets/${n}_TOP_BOTTOM` });
    if (m <= 5)
      return {
        side: `gregtech:iconsets/TM_TESLA_WINDING_PRIMARY_SIDES_${m}`,
        top: `gregtech:iconsets/TM_TESLA_WINDING_PRIMARY_TOP_BOTTOM_${m}`,
      };
    if (m === 6) return pair('TM_TESLA_BASE');
    if (m === 7) return { side: 'gregtech:iconsets/TM_TESLA_TOROID' };
    if (m === 8) return pair('TM_TESLA_WINDING_SECONDARY');
    if (m === 9)
      return {
        side: 'gregtech:iconsets/TM_TESLA_WINDING_PRIMARY_SIDES_6',
        top: 'gregtech:iconsets/TM_TESLA_WINDING_PRIMARY_TOP_BOTTOM_6',
      };
    return {
      side: `gregtech:iconsets/${['EM_INNER_SPACETIME_REINFORCED_EOH_CASING', 'EM_OUTER_SPACETIME_REINFORCED_EOH_CASING', 'EM_INFINITE_SPACETIME_REINFORCED_EOH_CASING'][m - 10] ?? 'MACHINE_CASING_SOLID_STEEL'}`,
    };
  },
  // GregtechMetaSpecialMultiCasings meta 15: TexturesGtBlock.Turbine_SC_Material_Casing.
  'miscutils:gtplusplus.blockspecialcasings.1': (m) =>
    m === 15 ? { side: 'miscutils:iconsets/SC_TURBINE' } : null,
  // BartWorks' bio fluid in the BioVat: a still liquid.
  'bartworks:coloredFluidBlock': () => ({ side: 'minecraft:water_still', tint: [120, 190, 90] }),
};

export class StaticTextures {
  /**
   * @param {string} checkout GT5-Unofficial checkout or extracted source archive
   * @param {import('./jars.mjs').TextureJars} jars sprites, to check which files exist
   */
  constructor(checkout, jars) {
    const textureList = readdirSync(join(checkout, 'src/main/resources/assets'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(checkout, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
      .filter((path) => /\/textures\/blocks\/.+\.png$/.test(path))
      .sort();
    this.checkout = checkout;
    this.jars = jars;
    this.reg = new Registry(checkout, textureList);
    this.byUnloc = new Map();
    for (const field of this.reg.blockClass.keys()) {
      const info = this.reg.blockInfo(field);
      if (info?.unloc && !this.byUnloc.has(info.unloc)) this.byUnloc.set(info.unloc, field);
    }
    this.indexRegistrations();
    this.indexMaterials();
  }

  /** `GameRegistry.registerBlock(expr, ..., "name")` and `new X("name", new String[] { ... })` across the sources. */
  indexRegistrations() {
    /** registered name → texture names given to the block's constructor */
    this.ctorTextures = new Map();
    /** registered name → field */
    this.registered = new Map();
    // Block classes that pass their registry name to `super(...)` further down than their first `super` call
    // (an inner ItemBlock class comes first in GT++'s casing blocks).
    const fieldOfClass = new Map();
    for (const [field, cls] of this.reg.blockClass) if (!fieldOfClass.has(cls)) fieldOfClass.set(cls, field);
    for (const [cls, field] of fieldOfClass) {
      const src = this.reg.classSrc(cls);
      if (!src) continue;
      for (const c of findCalls(src, 'super'))
        for (const a of splitArgs(c.args)) {
          const v = /^"([\w.]+)"$/.exec(a.trim())?.[1];
          if (v && v.includes('.') && !this.byUnloc.has(v)) this.byUnloc.set(v, field);
        }
    }
    this.fieldOfClass = fieldOfClass;
    // `sBlockReinforced = new BlockReinforced("gt.blockreinforced")`: a field built with its registry name.
    for (const [field, args] of this.reg.blockInit) {
      const v = /^\s*"([\w.]+)"/.exec(args)?.[1];
      if (v && !this.byUnloc.has(v)) this.byUnloc.set(v, field);
    }
    for (const [path, src] of this.reg.allSources()) {
      if (src.includes('registerBlock(')) {
        const cls = /(\w+)\.java$/.exec(path)?.[1];
        for (const c of findCalls(src, 'GameRegistry.registerBlock')) {
          const args = splitArgs(c.args);
          const last = args[args.length - 1]?.trim() ?? '';
          // `registerBlock(this, ItemX.class, blockName)` with `final String blockName = "x";` nearby.
          const name =
            /^"([^"]+)"$/.exec(last)?.[1] ??
            (/^\w+$/.test(last) ? new RegExp(`\\b${last}\\s*=\\s*"([^"]+)"`).exec(src)?.[1] : undefined);
          const first = args[0]?.trim() ?? '';
          const field =
            first === 'this' ? fieldOfClass.get(cls) : /(?:^|\.)(\w+)(?:\[\d+\])?$/.exec(first)?.[1];
          if (name && field && !this.registered.has(name)) this.registered.set(name, field);
        }
      }
      for (const m of src.matchAll(
        /new\s+\w+\s*\(\s*"([\w.]+)"\s*,\s*new\s+String\s*\[\s*\]\s*\{([^}]*)\}/g,
      )) {
        const items = splitArgs(m[2]).map((a) => {
          const parts = [...a.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
          const lit = parts.join('');
          // `MOD_ID + ":X"`: the domain comes from the registry name at lookup time.
          return /^:/.test(lit) ? `*${lit}` : lit;
        });
        if (items.length && !this.ctorTextures.has(m[1])) this.ctorTextures.set(m[1], items);
      }
    }
  }

  /** GT material ids (MaterialsIDMap) → { name, set, color } from MaterialsInit, and BartWorks werkstoffs. */
  indexMaterials() {
    this.materialById = new Map();
    const idMap = this.reg.classSrc('MaterialsIDMap') ?? '';
    const init = this.reg.classSrc('MaterialsInit') ?? '';
    const byField = new Map();
    for (const m of init.matchAll(/Materials\.(\w+)\s*=\s*(load\w+)\(\)/g)) {
      const body = methodBody(init, m[2]) ?? '';
      const set = /setIconSet\(\s*TextureSet\.SET_(\w+)/.exec(body)?.[1] ?? 'NONE';
      const argb = /setARGB\(\s*0x([0-9a-fA-F]{6,8})/.exec(body);
      const rgb = /setRGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(body);
      const color = argb ? hexRgb(argb[1].slice(-6)) : rgb ? [+rgb[1], +rgb[2], +rgb[3]] : [255, 255, 255];
      const name = /setDefaultLocalName\(\s*"([^"]+)"/.exec(body)?.[1] ?? m[1];
      byField.set(m[1], { name, set, color });
    }
    for (const m of idMap.matchAll(/r\(\s*(\d+)\s*,\s*Materials\.(\w+)\s*\)/g)) {
      const mat = byField.get(m[2]);
      if (mat) this.materialById.set(Number(m[1]), { field: m[2], ...mat });
    }
    // GT++ materials by normalised field name (`EGLIN_STEEL` → `eglinsteel`).
    this.gtppMaterials = new Map();
    for (const [name, color] of this.reg.materials)
      this.gtppMaterials.set(name.replace(/_/g, '').toLowerCase(), hexRgb(color));
    // BartWorks werkstoffs: `new Werkstoff(new short[] { r, g, b, ... }, "Name", ..., id, TextureSet.SET_X ...)`.
    this.werkstoffById = new Map();
    for (const [, src] of this.reg.allSources()) {
      if (!src.includes('new Werkstoff(')) continue;
      for (const c of findCalls(src, 'new Werkstoff')) {
        const args = splitArgs(c.args);
        const rgb = /new\s+short\s*\[\s*\]\s*\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(args[0] ?? '');
        const name = /^"([^"]+)"$/.exec(args[1]?.trim() ?? '')?.[1];
        const id = args.map((a) => a.trim()).find((a, i) => i > 1 && /^\d+$/.test(a));
        const set = /TextureSet\.SET_(\w+)/.exec(c.args)?.[1] ?? 'METALLIC';
        if (rgb && name && id)
          this.werkstoffById.set(Number(id), { name, set, color: [+rgb[1], +rgb[2], +rgb[3]] });
      }
    }
  }

  /** A sprite of a material icon set, falling back to NONE as GT's texture sets do. */
  materialIcon(set, suffix) {
    for (const s of [set, 'NONE']) {
      const icon = `gregtech:materialicons/${s}/${suffix}`;
      if (this.jars.get(icon)) return icon;
    }
    return null;
  }

  /** Faces `{ side, top?, bottom? }` (each a layer list) of a plain block, plus a display name, or null. */
  plain(registry, meta) {
    const i = registry.indexOf(':');
    const mod = registry.slice(0, i);
    const name = registry.slice(i + 1);
    const one = (icon, rgba = WHITE) => (icon ? [{ icon, rgba }] : null);

    if (mod === 'minecraft') {
      const v = VANILLA[name]?.(meta);
      if (!v) return null;
      const rgba = v.tint ? [...v.tint, 0] : WHITE;
      return {
        side: one(`minecraft:${v.side}`, rgba),
        top: v.top ? one(`minecraft:${v.top}`, name === 'grass' ? [124, 189, 107, 0] : rgba) : null,
        bottom: v.bottom ? one(`minecraft:${v.bottom}`, WHITE) : null,
      };
    }
    const manual = MANUAL[registry]?.(meta);
    if (manual) {
      const rgba = manual.tint ? [...manual.tint, 0] : WHITE;
      const ok = (icon) => (icon && this.jars.get(icon) ? icon : null);
      if (ok(manual.side))
        return {
          side: one(manual.side, rgba),
          top: ok(manual.top) ? one(manual.top, rgba) : null,
          bottom: ok(manual.bottom ?? manual.top) ? one(manual.bottom ?? manual.top, rgba) : null,
        };
    }
    // Storage blocks: `new BlockMetal("gt.blockmetal4", new Materials[] { ... }, OrePrefixes.block, STORAGE_BLOCKS4)`.
    const metal = this.metalBlocks().get(name);
    if (metal) {
      const icon = iconOfPath(this.reg.iconTexture(`BlockIcons.${metal}[${meta}]`));
      if (icon && this.jars.get(icon)) return { side: one(icon) };
    }
    if (registry === 'gregtech:gt.blockframes') {
      const mat = this.materialById.get(meta);
      const icon = this.materialIcon(mat?.set ?? 'NONE', 'frameGt');
      return (
        icon && {
          side: one(icon, [...(mat?.color ?? [255, 255, 255]), 0]),
          name: mat && `${mat.name} Frame Box`,
        }
      );
    }
    if (registry === 'gregtech:gt.sheetmetal') {
      const mat = this.materialById.get(meta);
      const icon = this.materialIcon(mat?.set ?? 'NONE', 'sheetmetal');
      return (
        icon && {
          side: one(icon, [...(mat?.color ?? [255, 255, 255]), 0]),
          name: mat && `${mat.name} Sheetmetal`,
        }
      );
    }
    const gtppFrame = /^blockFrameGt(\w+)$/.exec(name);
    if (mod === 'miscutils' && gtppFrame) {
      const color = this.gtppMaterials.get(gtppFrame[1].toLowerCase()) ?? [200, 200, 200];
      const icon = this.materialIcon('METALLIC', 'frameGt');
      const pretty = gtppFrame[1].replace(/([a-z])([A-Z0-9])/g, '$1 $2');
      return icon && { side: one(icon, [...color, 0]), name: `${pretty} Frame Box` };
    }
    const werk = /^bw\.werkstoffblockscasing(advanced)?\.01$/.exec(name);
    if (werk) {
      const w = this.werkstoffById.get(meta);
      const icon =
        this.materialIcon(w?.set ?? 'METALLIC', werk[1] ? 'blockCasingAdvanced' : 'blockCasing') ??
        (this.jars.get(`gregtech:materialicons/${werk[1] ? 'blockCasingAdvanced' : 'blockCasing'}`)
          ? `gregtech:materialicons/${werk[1] ? 'blockCasingAdvanced' : 'blockCasing'}`
          : null);
      return (
        icon && {
          side: one(icon, [...(w?.color ?? [200, 200, 200]), 0]),
          name: w && `${w.name} ${werk[1] ? 'Robust ' : ''}Machine Casing`,
        }
      );
    }

    // GT-style blocks: the class that registers under this name, and its getIcon(side, meta).
    const field = this.byUnloc.get(name) ?? this.registered.get(name) ?? this.literalOwner(name);
    if (field) {
      const info = this.reg.blockInfo(field);
      if (info) {
        const tex =
          this.reg.iconTexture(info.icon(meta), info.iconSrc) ??
          this.reg.iconTexture(info.initIcon(meta)) ??
          this.reg.namedTexture(info.initName);
        const side = iconOfPath(tex);
        if (side && this.jars.get(side)) {
          const face = (f) => {
            const t = this.reg.iconTexture(info.icon(meta), info.iconSrc, f);
            const icon = t && t !== tex ? iconOfPath(t) : null;
            return icon && this.jars.get(icon) ? one(icon) : null;
          };
          return { side: one(side), top: face('top'), bottom: face('bottom'), name: info.name(meta) };
        }
      }
    }
    // Blocks built with their texture names: `new BlockCasing("name", new String[] { MOD_ID + ":tex0", ... })`.
    const list = this.ctorTextures.get(name);
    if (list) {
      const t = list[Math.min(meta, list.length - 1)].replace(/^\*/, mod);
      const icon = t.includes(':') ? t : `${mod}:${t}`;
      for (const k of [icon, icon.toLowerCase()]) if (this.jars.get(k)) return { side: one(k) };
    }
    // Named after their texture file.
    const bare = name.replace(/^tile\./, '');
    for (const cand of [
      `${mod}:${bare}`,
      `${mod}:${bare}${meta}`,
      `${mod}:${bare}_${meta}`,
      `${mod}:${bare}/${meta}`,
      `${mod}:${bare.replace(/\./g, '/')}`,
      `${mod}:${bare.replace(/\./g, '/')}_${meta}`,
    ]) {
      if (this.jars.get(cand)) return { side: one(cand) };
      const lower = cand.toLowerCase();
      const hit = this.findIcon(lower);
      if (hit) return { side: one(hit) };
    }
    return null;
  }

  /** `gt.blockmetalN` → the icon array its BlockMetal is given. */
  metalBlocks() {
    if (!this.metals) {
      this.metals = new Map();
      for (const [, src] of this.reg.allSources()) {
        if (!src.includes('new BlockMetal(')) continue;
        for (const c of findCalls(src, 'new BlockMetal')) {
          const args = splitArgs(c.args);
          const name = /^"([^"]+)"$/.exec(args[0]?.trim() ?? '')?.[1];
          const arr = /(\w+)\s*$/.exec(args[args.length - 1] ?? '')?.[1];
          if (name && arr) this.metals.set(name, arr);
        }
      }
    }
    return this.metals;
  }

  /** The block field whose class is the only block class naming `"name"` in its source (`setBlockName("x")`, ...). */
  literalOwner(name) {
    const hits = [];
    for (const [cls, field] of this.fieldOfClass) {
      const src = this.reg.classSrc(cls);
      if (src && src.includes(`"${name}"`)) hits.push(field);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /** Case-insensitive sprite lookup. */
  findIcon(lowerKey) {
    if (!this.lowerIndex) {
      this.lowerIndex = new Map();
      for (const k of this.jars.files.keys())
        if (!this.lowerIndex.has(k.toLowerCase())) this.lowerIndex.set(k.toLowerCase(), k);
    }
    return this.lowerIndex.get(lowerKey) ?? null;
  }

  /** The class source of a controller and its parents (most derived first). */
  classChain(sourceClass) {
    const outer = sourceClass.split('$')[0].split('.').pop();
    const inner = sourceClass.includes('$') ? sourceClass.split('$').pop() : null;
    const out = [];
    let src = this.reg.classSrc(outer);
    if (!src) return out;
    if (inner) {
      // A nested controller: its own body first, then the outer class it extends.
      const m = new RegExp(`class\\s+${inner}\\b[^{]*\\{`).exec(src);
      if (m) out.push(src.slice(m.index));
    }
    out.push(src);
    for (let s = src, guard = 0; guard < 8; guard++) {
      const ext = /class\s+\w+(?:<[^{]*?>)?\s+extends\s+(\w+)/.exec(s);
      const p = ext && this.reg.classSrc(ext[1]);
      if (!p) break;
      out.push(p);
      s = p;
    }
    return out;
  }

  /** Front overlay sprite of an idle controller, or null. */
  controllerFront(sourceClass) {
    const chain = this.classChain(sourceClass).map(stripComments);
    const t = this.reg.controllerFront(chain) ?? this.reg.controllerFront(chain, { allowActive: true });
    const icon = iconOfPath(t);
    return icon && this.jars.get(icon) ? icon : null;
  }
}

/**
 * A manifest-shaped object for the blocks the dumped structures use. `hosts` maps a controller block key to the
 * key of the casing its hatches go on (its sides); controllers get that casing with their front overlay on north.
 */
export function staticManifest(st, docs) {
  const blocks = {};
  const gaps = [];
  const plainKeys = new Set();
  const controllers = new Map();
  for (const doc of docs) {
    const v = [...doc.variants].sort((a, b) => a.trigger_stack_size - b.trigger_stack_size)[0];
    for (const b of v.blocks)
      if (b.block !== 'gregtech:gt.blockmachines') plainKeys.add(`${b.block}|${b.meta}`);
    // Host casing: the block most often in a cell that takes the usual hatches.
    const at = new Map(v.blocks.map((b) => [b.d.join(','), `${b.block}|${b.meta}`]));
    const count = new Map();
    for (const s of v.hatch_slots ?? []) {
      const k = at.get(s.d.join(','));
      if (k && !k.startsWith('gregtech:gt.blockmachines|')) count.set(k, (count.get(k) ?? 0) + 1);
    }
    let host = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!host) {
      const all = new Map();
      for (const b of v.blocks)
        if (b.block !== 'gregtech:gt.blockmachines')
          all.set(`${b.block}|${b.meta}`, (all.get(`${b.block}|${b.meta}`) ?? 0) + 1);
      host = [...all].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    controllers.set(`${doc.controller.registry_name}|${doc.controller.meta}`, { doc, host });
  }
  const sidesOf = (f) => {
    const sides = {};
    for (const s of SIDES) {
      const l = s === 'UP' ? (f.top ?? f.side) : s === 'DOWN' ? (f.bottom ?? f.side) : f.side;
      sides[s] = { inactive: l };
    }
    return sides;
  };
  for (const key of [...plainKeys].sort()) {
    const [registry, meta] = key.split('|');
    const f = st.plain(registry, Number(meta));
    if (!f?.side) {
      gaps.push(key);
      continue;
    }
    blocks[key] = { kind: 'block', display_name: f.name ?? undefined, sides: sidesOf(f) };
  }
  for (const [key, { doc, host }] of controllers) {
    const base = host && blocks[host];
    if (!base) {
      gaps.push(`${key} (${doc.controller.display_name})`);
      continue;
    }
    const sides = structuredClone(base.sides);
    const front = st.controllerFront(doc.controller.source_class);
    if (front) sides.NORTH = { inactive: [...sides.NORTH.inactive, { icon: front, rgba: WHITE }] };
    blocks[key] = { kind: 'mte', display_name: `${doc.controller.display_name}`, sides };
  }
  return { blocks, gaps };
}

export { SIDES };
