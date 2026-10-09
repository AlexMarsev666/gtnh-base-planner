#!/usr/bin/env node
/**
 * Builds the DETAILED-view texture atlas.
 *
 *   node scripts/build-atlas.mjs          # pack from the committed sources in tools/texture-sources/
 *   node scripts/build-atlas.mjs --fetch  # download missing sources from GT5-Unofficial first
 *
 * Sources are GT5-Unofficial (LGPL-3.0) block icons, see ATTRIBUTION.md. Animated strips are cropped to
 * their first frame; generic machine casings get the default "machine metal" tint the game applies.
 *
 * Outputs (both committed, and rebuilt by `npm run build`, which never needs the network):
 *   public/textures/atlas.png  — every tile below, 16×16 each, packed in a grid
 *   src/render/textures.json   — tile rects + blockId → faces mapping + hatch overlays
 *
 * Adding a block: map its id in HAND_BLOCK_MAP (tile names are keys of HAND_TILES) and rerun the script.
 * Blocks of the generated catalog entries come from tools/game-dump/textures.generated.json (written by
 * tools/game-dump/build.mjs together with their face tiles) and are merged into TILES / BLOCK_MAP.
 * Ids from src/data/blocks.ts and src/data/blocks.generated.json that are not mapped get `{ "flat": true }`
 * (flat colour in DETAILED view).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Build inputs only: kept out of public/ so they are never copied into the deployed site.
const SRC_DIR = join(ROOT, 'tools/texture-sources');
const ATLAS_PNG = join(ROOT, 'public/textures/atlas.png');
const TEXTURES_JSON = join(ROOT, 'src/render/textures.json');
const BLOCKS_TS = join(ROOT, 'src/data/blocks.ts');
const BLOCKS_GENERATED = join(ROOT, 'src/data/blocks.generated.json');
const TEXTURES_GENERATED = join(ROOT, 'tools/game-dump/textures.generated.json');

export const REPO = 'GTNewHorizons/GT5-Unofficial';
export const ICONSETS = 'src/main/resources/assets/gregtech/textures/blocks/iconsets';
const RAW = (ref = 'master') => `https://raw.githubusercontent.com/${REPO}/${ref}/`;

/** Tile size in the atlas. */
export const TILE = 16;
/** Tiles per atlas row. */
const COLUMNS = 16;

/** Client default of `Client.colorModulation.machineMetal` (Dyes.MACHINE_METAL). */
export const MACHINE_METAL = [210, 220, 255];

/**
 * Atlas tiles: name → options. The source is `${ICONSETS}/${name}.png` unless `path` (repo-relative) is given;
 * it is stored as `tools/texture-sources/${name}.png`. `tint` multiplies RGB (the game tints the tiered
 * MACHINE_* casings with MACHINE_METAL and material icons such as frames with the material colour).
 * `ref` is the GT5-Unofficial branch or tag to download from (default `master`).
 */
export const HAND_TILES = {
  COMPUTATION_UNCERTAINTY_FRONT: { derived: true, from: ['assets/gregtech/textures/blocks/iconsets/UC.png'] },
  COMPUTATION_RACK_FRONT: { derived: true, from: ['assets/gregtech/textures/blocks/iconsets/EM_RACK.png'] },
  ELECTRODE_DETECTOR_FRONT: {
    derived: true,
    from: ['assets/gregtech/textures/blocks/iconsets/OVERLAY_HATCH_HEAT_SENSOR.png'],
  },
  RECIPE_DATA_FRONT: {
    derived: true,
    from: [
      'assets/gregtech/textures/blocks/iconsets/OVERLAY_EM_D_SIDES.png',
      'assets/gregtech/textures/blocks/iconsets/EM_DATA_CONN.png',
    ],
  },
  BEAM_OUTPUT_FRONT: {
    derived: true,
    from: [
      'assets/gregtech/textures/blocks/iconsets/OVERLAY_BO_SIDES.png',
      'assets/gregtech/textures/blocks/iconsets/BO_CONN.png',
    ],
  },
  BEAM_INPUT_FRONT: {
    derived: true,
    from: [
      'assets/gregtech/textures/blocks/iconsets/OVERLAY_BI_SIDES.png',
      'assets/gregtech/textures/blocks/iconsets/BI_CONN.png',
    ],
  },
  // Coke Oven (BlockCasings12 meta 0, MTECokeOven, MTEHatchCokeOven)
  COKE_OVEN_CASING: {},
  COKE_OVEN_OVERLAY_INACTIVE: {},
  // Machine casings used by common wall-shareable multiblocks
  MACHINE_HEATPROOFCASING: {},
  MACHINE_CASING_FROST_PROOF: {},
  MACHINE_CASING_SOLID_STEEL: {},
  MACHINE_CASING_CLEAN_STAINLESSSTEEL: {},
  MACHINE_CASING_STABLE_TITANIUM: {},
  MACHINE_CASING_ROBUST_TUNGSTENSTEEL: {},
  MACHINE_CASING_CHEMICALLY_INERT: {},
  MACHINE_CASING_PIPE_POLYTETRAFLUOROETHYLENE: {},
  MACHINE_CASING_PIPE_BRONZE: {},
  MACHINE_CASING_PIPE_STEEL: {},
  MACHINE_CASING_PIPE_TITANIUM: {},
  MACHINE_CASING_PIPE_TUNGSTENSTEEL: {},
  MACHINE_CASING_GEARBOX_BRONZE: {},
  MACHINE_CASING_GEARBOX_STEEL: {},
  MACHINE_CASING_GEARBOX_TITANIUM: {},
  MACHINE_CASING_GEARBOX_TUNGSTENSTEEL: {},
  MACHINE_BRONZEPLATEDBRICKS: {},
  // Bricked Blast Furnace firebricks (BlockCasings4 meta 15) and its controller front
  MACHINE_CASING_DENSEBRICKS: {},
  MACHINE_CASING_BRICKEDBLASTFURNACE_INACTIVE: {},
  // Tin item pipe casing (BlockCasings11 meta 0), reinforced wooden casing (BlockCasings10 meta 15)
  MACHINE_CASING_ITEM_PIPE_TIN: {},
  CASING_REINFORCED_WOOD: {},
  CASING_REINFORCED_WOOD_TOP: {},
  MACHINE_CASING_FIREBOX_BRONZE: {},
  MACHINE_CASING_FIREBOX_BRONZE_TOP: {},
  MACHINE_CASING_FIREBOX_STEEL: {},
  MACHINE_CASING_FIREBOX_STEEL_TOP: {},
  MACHINE_CASING_FIREBOX_TITANIUM: {},
  MACHINE_CASING_FIREBOX_TITANIUM_TOP: {},
  MACHINE_CASING_FIREBOX_TUNGSTENSTEEL: {},
  MACHINE_CASING_FIREBOX_TUNGSTENSTEEL_TOP: {},
  // Tiered machine casings (BlockCasings1 meta 0-4); also the base of generic hatches
  MACHINE_ULV_SIDE: { tint: MACHINE_METAL },
  MACHINE_ULV_TOP: { tint: MACHINE_METAL },
  MACHINE_ULV_BOTTOM: { tint: MACHINE_METAL },
  MACHINE_LV_SIDE: { tint: MACHINE_METAL },
  MACHINE_LV_TOP: { tint: MACHINE_METAL },
  MACHINE_LV_BOTTOM: { tint: MACHINE_METAL },
  MACHINE_MV_SIDE: { tint: MACHINE_METAL },
  MACHINE_MV_TOP: { tint: MACHINE_METAL },
  MACHINE_MV_BOTTOM: { tint: MACHINE_METAL },
  MACHINE_HV_SIDE: { tint: MACHINE_METAL },
  MACHINE_HV_TOP: { tint: MACHINE_METAL },
  MACHINE_HV_BOTTOM: { tint: MACHINE_METAL },
  MACHINE_EV_SIDE: { tint: MACHINE_METAL },
  MACHINE_EV_TOP: { tint: MACHINE_METAL },
  MACHINE_EV_BOTTOM: { tint: MACHINE_METAL },
  // Heating coils
  MACHINE_COIL_CUPRONICKEL: {},
  MACHINE_COIL_KANTHAL: {},
  MACHINE_COIL_NICHROME: {},
  MACHINE_COIL_TUNGSTENSTEEL: {},
  MACHINE_COIL_HSSG: {},
  MACHINE_COIL_HSSS: {},
  MACHINE_COIL_NAQUADAH: {},
  MACHINE_COIL_NAQUADAHALLOY: {},
  // Glass
  REINFORCED_GLASS: {},
  // Steel Frame Box: the generic frame icon tinted with the Steel material colour (0x808080)
  FRAME_STEEL: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [128, 128, 128],
  },
  // Turbine, engine and processing casings (GT:NH 2.9 catalog expansion)
  MACHINE_CASING_TURBINE_STEEL: {},
  MACHINE_CASING_TURBINE_STAINLESSSTEEL: {},
  MACHINE_CASING_TURBINE_TITANIUM: {},
  MACHINE_CASING_TURBINE_TUNGSTENSTEEL: {},
  MACHINE_CASING_PIPE_POLYBENZIMIDAZOLE: {},
  MACHINE_CASING_ENGINE_INTAKE: {},
  MACHINE_CASING_EXTREME_ENGINE_INTAKE: {},
  MACHINE_CASING_GRATE: {},
  MACHINE_CASING_ASSEMBLER: {},
  MACHINE_CASING_AUTOCLAVE: {},
  // Supercritical Fluid Turbine Casing (GoodGenerator block, Casings.SCTurbineCasing)
  SC_TURBINE_CASING: {
    path: 'src/main/resources/assets/goodgenerator/textures/blocks/supercriticalFluidTurbineCasing.png',
  },
  // Frame boxes: the generic frame icon tinted with each material colour (GT Materials RGBA)
  FRAME_BRONZE: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [255, 128, 0],
  },
  FRAME_IRON: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [200, 200, 200],
  },
  FRAME_STAINLESSSTEEL: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [200, 200, 220],
  },
  FRAME_TITANIUM: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [220, 160, 240],
  },
  FRAME_POLYBENZIMIDAZOLE: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [45, 45, 45],
  },
  FRAME_TUNGSTENSTEEL: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [100, 100, 160],
  },
  FRAME_POLYTETRAFLUOROETHYLENE: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [100, 100, 100],
  },
  FRAME_BLACKSTEEL: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [100, 100, 100],
  },
  // Controller front overlays (drawn over the casing on the facing side)
  OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE: {},
  OVERLAY_FRONT_VACUUM_FREEZER: {},
  OVERLAY_FRONT_IMPLOSION_COMPRESSOR: {},
  OVERLAY_FRONT_DISTILLATION_TOWER: {},
  OVERLAY_FRONT_MULTI_SMELTER: {},
  OVERLAY_FRONT_OIL_CRACKER: {},
  OVERLAY_FRONT_LARGE_BOILER: {},
  OVERLAY_FRONT_PYROLYSE_OVEN: {},
  OVERLAY_FRONT_LARGE_CHEMICAL_REACTOR: {},
  // Hatch overlays and mode indicators
  OVERLAY_PIPE_IN: {},
  OVERLAY_PIPE_OUT: {},
  ITEM_IN_SIGN: {},
  ITEM_OUT_SIGN: {},
  FLUID_IN_SIGN: {},
  FLUID_STEAM_IN_SIGN: {},
  FLUID_OUT_SIGN: {},
  OVERLAY_ENERGY_IN_LV: {},
  OVERLAY_ENERGY_OUT_LV: {},
  OVERLAY_MAINTENANCE: {},
  OVERLAY_MUFFLER: {},
  // Industrial Centrifuge (GT:NH 2.9): GT++ Centrifuge Casing (blockCasingsMisc meta 0), Large Sieve Grate
  // (blockCasings2Misc meta 6) and Eglin Steel frame boxes (frame icon tinted with the Eglin Steel colour).
  MACHINE_CASING_CENTRIFUGE: {
    path: 'src/main/resources/assets/miscutils/textures/blocks/TileEntities/MACHINE_CASING_CENTRIFUGE.png',
  },
  LARGE_SIEVE_GRATE: {},
  FRAME_EGLINSTEEL: {
    path: 'src/main/resources/assets/gregtech/textures/blocks/materialicons/NONE/frameGt.png',
    tint: [139, 69, 19],
  },
  // Solenoid Superconductor Coil (sSolenoidCoilCasings = BlockCyclotronCoils; HV tier shown)
  HV_SIDE_CYCLOTRON_SOLENOID: {},
  HV_TOP_CYCLOTRON_SOLENOID: {},
  // Sites: hazard stripes for placeholder multiblocks, and the fronts of boundary ports (Super Chest,
  // Super Tank and the energy output overlay of a battery buffer).
  MACHINE_CASING_STRIPES_A: {},
  OVERLAY_SCHEST: {},
  OVERLAY_STANK: {},
  OVERLAY_ENERGY_OUT: {},
  OVERLAY_DATA_ACCESS: {},
};

/**
 * blockId → faces. `side` is required; `top`/`bottom` default to `side`.
 * `front` is an overlay tile drawn over the side texture on the controller's facing side.
 * Hatches (kind "hatch" in the scene) additionally get the overlay of their hatch kind (HATCH_OVERLAYS).
 */
export const HAND_BLOCK_MAP = {
  'gt.cokeOvenBrick': { side: 'COKE_OVEN_CASING' },
  'gt.cokeOvenController': { side: 'COKE_OVEN_CASING', front: 'COKE_OVEN_OVERLAY_INACTIVE' },
  'gt.cokeOvenHatch': { side: 'COKE_OVEN_CASING' },

  'gt.casing.heatProof': { side: 'MACHINE_HEATPROOFCASING' },
  'gt.casing.frostProof': { side: 'MACHINE_CASING_FROST_PROOF' },
  'gt.casing.solidSteel': { side: 'MACHINE_CASING_SOLID_STEEL' },
  'gt.casing.steelSolid': { side: 'MACHINE_CASING_SOLID_STEEL' },
  'gt.casing.cleanStainless': { side: 'MACHINE_CASING_CLEAN_STAINLESSSTEEL' },
  'gt.casing.stableTitanium': { side: 'MACHINE_CASING_STABLE_TITANIUM' },
  'gt.casing.chemicallyInert': { side: 'MACHINE_CASING_CHEMICALLY_INERT' },
  'gt.casing.ptfePipe': { side: 'MACHINE_CASING_PIPE_POLYTETRAFLUOROETHYLENE' },
  'gt.casing.ulv': { side: 'MACHINE_ULV_SIDE', top: 'MACHINE_ULV_TOP', bottom: 'MACHINE_ULV_BOTTOM' },
  'gt.casing.bronzePlated': { side: 'MACHINE_BRONZEPLATEDBRICKS' },
  'gt.casing.bronzeFirebox': {
    side: 'MACHINE_CASING_FIREBOX_BRONZE',
    top: 'MACHINE_CASING_FIREBOX_BRONZE_TOP',
    bottom: 'MACHINE_CASING_FIREBOX_BRONZE_TOP',
  },
  'gt.casing.steelFirebox': {
    side: 'MACHINE_CASING_FIREBOX_STEEL',
    top: 'MACHINE_CASING_FIREBOX_STEEL_TOP',
    bottom: 'MACHINE_CASING_FIREBOX_STEEL_TOP',
  },
  'gt.casing.robustTungstensteel': { side: 'MACHINE_CASING_ROBUST_TUNGSTENSTEEL' },
  'gt.coil.cupronickel': { side: 'MACHINE_COIL_CUPRONICKEL' },
  'gt.glass.reinforced': { side: 'REINFORCED_GLASS' },
  'gt.casing.firebricks': { side: 'MACHINE_CASING_DENSEBRICKS' },
  'gt.casing.titaniumPipe': { side: 'MACHINE_CASING_PIPE_TITANIUM' },
  'gt.casing.steelPipe': { side: 'MACHINE_CASING_PIPE_STEEL' },
  // Pyrolyse Oven Casing (sBlockCasingsNH meta 2) shows the ULV hull side on every face.
  'gt.casing.pyrolyseOven': { side: 'MACHINE_ULV_SIDE' },
  'gt.casing.itemPipeTin': { side: 'MACHINE_CASING_ITEM_PIPE_TIN' },
  'gt.casing.reinforcedWooden': {
    side: 'CASING_REINFORCED_WOOD',
    top: 'CASING_REINFORCED_WOOD_TOP',
    bottom: 'CASING_REINFORCED_WOOD_TOP',
  },
  'gt.frame.steel': { side: 'FRAME_STEEL' },

  'gt.casing.bronzeGearbox': { side: 'MACHINE_CASING_GEARBOX_BRONZE' },
  'gt.casing.steelGearbox': { side: 'MACHINE_CASING_GEARBOX_STEEL' },
  'gt.casing.titaniumGearbox': { side: 'MACHINE_CASING_GEARBOX_TITANIUM' },
  'gt.casing.bronzePipe': { side: 'MACHINE_CASING_PIPE_BRONZE' },
  'gt.casing.tungstensteelPipe': { side: 'MACHINE_CASING_PIPE_TUNGSTENSTEEL' },
  'gt.casing.pbiPipe': { side: 'MACHINE_CASING_PIPE_POLYBENZIMIDAZOLE' },
  'gt.casing.titaniumFirebox': {
    side: 'MACHINE_CASING_FIREBOX_TITANIUM',
    top: 'MACHINE_CASING_FIREBOX_TITANIUM_TOP',
    bottom: 'MACHINE_CASING_FIREBOX_TITANIUM_TOP',
  },
  'gt.casing.tungstensteelFirebox': {
    side: 'MACHINE_CASING_FIREBOX_TUNGSTENSTEEL',
    top: 'MACHINE_CASING_FIREBOX_TUNGSTENSTEEL_TOP',
    bottom: 'MACHINE_CASING_FIREBOX_TUNGSTENSTEEL_TOP',
  },
  'gt.casing.turbine': { side: 'MACHINE_CASING_TURBINE_STEEL' },
  'gt.casing.turbineStainless': { side: 'MACHINE_CASING_TURBINE_STAINLESSSTEEL' },
  'gt.casing.turbineTitanium': { side: 'MACHINE_CASING_TURBINE_TITANIUM' },
  'gt.casing.turbineTungstensteel': { side: 'MACHINE_CASING_TURBINE_TUNGSTENSTEEL' },
  'gt.casing.turbineSC': { side: 'SC_TURBINE_CASING' },
  'gt.casing.engineIntake': { side: 'MACHINE_CASING_ENGINE_INTAKE' },
  'gt.casing.extremeEngineIntake': { side: 'MACHINE_CASING_EXTREME_ENGINE_INTAKE' },
  'gt.casing.grate': { side: 'MACHINE_CASING_GRATE' },
  'gt.casing.assembler': { side: 'MACHINE_CASING_ASSEMBLER' },
  'gtpp.casing.centrifuge': { side: 'MACHINE_CASING_CENTRIFUGE' },
  'gtpp.casing.largeSieveGrate': { side: 'LARGE_SIEVE_GRATE' },
  'gt.frame.eglinSteel': { side: 'FRAME_EGLINSTEEL' },
  // Assembling Line Casing is sBlockCasings2 meta 5, which GT draws with the tungstensteel gearbox icon.
  'gt.casing.assemblyLine': { side: 'MACHINE_CASING_GEARBOX_TUNGSTENSTEEL' },
  'gt.coil.solenoid': {
    side: 'HV_SIDE_CYCLOTRON_SOLENOID',
    top: 'HV_TOP_CYCLOTRON_SOLENOID',
    bottom: 'HV_TOP_CYCLOTRON_SOLENOID',
  },
  // Pressure Containment Casing (BlockCasings10 meta 3)
  'gt.casing.pressureContainment': { side: 'MACHINE_CASING_AUTOCLAVE' },
  'gt.frame.bronze': { side: 'FRAME_BRONZE' },
  'gt.frame.iron': { side: 'FRAME_IRON' },
  'gt.frame.stainless': { side: 'FRAME_STAINLESSSTEEL' },
  'gt.frame.titanium': { side: 'FRAME_TITANIUM' },
  'gt.frame.pbi': { side: 'FRAME_POLYBENZIMIDAZOLE' },
  'gt.frame.tungstensteel': { side: 'FRAME_TUNGSTENSTEEL' },
  'gt.frame.ptfe': { side: 'FRAME_POLYTETRAFLUOROETHYLENE' },
  'gt.frame.blackSteel': { side: 'FRAME_BLACKSTEEL' },
  // Steam hatches and buses: bronze hull (the steam tier's casing) + kind overlay.
  'gt.hatch.steamInput': { side: 'MACHINE_BRONZEPLATEDBRICKS' },
  'gt.hatch.steamInputBus': { side: 'MACHINE_BRONZEPLATEDBRICKS' },
  'gt.hatch.steamOutputBus': { side: 'MACHINE_BRONZEPLATEDBRICKS' },

  // Generic multiblock controller: solid steel casing + a standard GT multiblock front.
  'gt.controller': { side: 'MACHINE_CASING_SOLID_STEEL', front: 'OVERLAY_FRONT_ELECTRIC_BLAST_FURNACE' },
  'gregtech:gt.blockmachines@10503': {
    side: 'DUMP_CASING_SHIELDED_ACCELERATOR',
    front: 'BEAM_INPUT_FRONT',
  },
  'gregtech:gt.blockmachines@10504': { side: 'DUMP_CASING_SHIELDED_ACCELERATOR', front: 'BEAM_OUTPUT_FRONT' },
  'gregtech:gt.blockmachines@3014': { side: 'DUMP_CASING_SHIELDED_ACCELERATOR', front: 'BEAM_OUTPUT_FRONT' },
  'gregtech:gt.blockmachines@967': {
    side: 'MACHINE_IV_SIDE',
    top: 'MACHINE_IV_TOP',
    bottom: 'MACHINE_IV_BOTTOM',
  },
  'gregtech:gt.blockmachines@968': {
    side: 'MACHINE_IV_SIDE',
    top: 'MACHINE_IV_TOP',
    bottom: 'MACHINE_IV_BOTTOM',
  },
  'gregtech:gt.blockmachines@31040': {
    side: 'MACHINE_ULV_SIDE',
    top: 'MACHINE_ULV_TOP',
    bottom: 'MACHINE_ULV_BOTTOM',
  },
  'gregtech:gt.blockmachines@14203': {
    side: 'MACHINE_IV_SIDE',
    top: 'MACHINE_IV_TOP',
    bottom: 'MACHINE_IV_BOTTOM',
  },
  'gregtech:gt.blockmachines@14204': {
    side: 'MACHINE_IV_SIDE',
    top: 'MACHINE_IV_TOP',
    bottom: 'MACHINE_IV_BOTTOM',
  },

  // Generic hatches: LV hull (the item form of a hatch) + kind overlay on the facing side.
  'gt.hatch.inputBus': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.outputBus': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.inputHatch': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.outputHatch': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.energy': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.dynamo': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.maintenance': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.muffler': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  'gt.hatch.dataAccess': { side: 'MACHINE_EV_SIDE', top: 'MACHINE_EV_TOP', bottom: 'MACHINE_EV_BOTTOM' },
  // Site stand-in for any GT single-block machine: an LV machine hull.
  'site.singleblock': { side: 'MACHINE_LV_SIDE', top: 'MACHINE_LV_TOP', bottom: 'MACHINE_LV_BOTTOM' },
  // Site placeholder for a multiblock that is not transcribed yet: hazard-striped casing.
  'site.placeholder': { side: 'MACHINE_CASING_STRIPES_A' },
  // Site boundary ports: an HV hull with the front of a Super Chest (items), a Super Tank (fluids) or a
  // battery buffer's energy output (power), facing into the site.
  'site.port.item': {
    side: 'MACHINE_HV_SIDE',
    top: 'MACHINE_HV_TOP',
    bottom: 'MACHINE_HV_BOTTOM',
    front: 'OVERLAY_SCHEST',
  },
  'site.port.fluid': {
    side: 'MACHINE_HV_SIDE',
    top: 'MACHINE_HV_TOP',
    bottom: 'MACHINE_HV_BOTTOM',
    front: 'OVERLAY_STANK',
  },
  'site.port.power': {
    side: 'MACHINE_HV_SIDE',
    top: 'MACHINE_HV_TOP',
    bottom: 'MACHINE_HV_BOTTOM',
    front: 'OVERLAY_ENERGY_OUT',
  },
};

// The controller of the Bricked Blast Furnace (a dumped block: the dump has no texture for it, as it is drawn by
// an older class): firebricks with the furnace front.
HAND_BLOCK_MAP['gregtech:gt.blockmachines@140'] = {
  side: 'MACHINE_CASING_DENSEBRICKS',
  front: 'MACHINE_CASING_BRICKEDBLASTFURNACE_INACTIVE',
};

// GT single-block machines of the template view (src/data/single-machines.json): the machine hull with the
// machine's own front overlay. The overlays are copied from the GT5-Unofficial jar by
// tools/game-dump/single-machines.mjs into tools/texture-sources/SINGLE_<ID>.png.
const SINGLE_MACHINES = JSON.parse(readFileSync(join(ROOT, 'src/data/single-machines.json'), 'utf8'));
for (const m of SINGLE_MACHINES) {
  const hull = m.base === 'hv' ? 'HV' : 'LV';
  let front = m.tile;
  if (m.sprite) {
    front = `SINGLE_${m.id.toUpperCase().replaceAll('-', '_')}`;
    HAND_TILES[front] = { path: `src/main/resources/assets/gregtech/textures/blocks/${m.sprite}.png` };
  }
  HAND_BLOCK_MAP[`site.machine.${m.id}`] = {
    side: `MACHINE_${hull}_SIDE`,
    top: `MACHINE_${hull}_TOP`,
    bottom: `MACHINE_${hull}_BOTTOM`,
    front,
  };
}

const VOLTAGE_TIERS = [
  'ULV',
  'LV',
  'MV',
  'HV',
  'EV',
  'IV',
  'LuV',
  'ZPM',
  'UV',
  'UHV',
  'UEV',
  'UIV',
  'UMV',
  'UXV',
  'MAX',
];
for (const [i, tier] of VOLTAGE_TIERS.entries()) {
  for (const face of ['SIDE', 'TOP', 'BOTTOM'])
    HAND_TILES[`MACHINE_${tier}_${face}`] = { tint: MACHINE_METAL };
  for (const prefix of [
    'OVERLAY_ENERGY_IN',
    'OVERLAY_ENERGY_OUT',
    'OVERLAY_ENERGY_IN_MULTI_4A',
    'OVERLAY_ENERGY_OUT_MULTI_4A',
  ])
    HAND_TILES[`${prefix}_${tier}`] = {};
  const hull = { side: `MACHINE_${tier}_SIDE`, top: `MACHINE_${tier}_TOP`, bottom: `MACHINE_${tier}_BOTTOM` };
  HAND_BLOCK_MAP[`site.singleblock.${tier}`] = hull;
  for (const m of SINGLE_MACHINES)
    HAND_BLOCK_MAP[`site.machine.${m.id}.${tier}`] = {
      ...hull,
      front: HAND_BLOCK_MAP[`site.machine.${m.id}`].front,
    };
  for (const id of [
    'inputBus',
    'outputBus',
    'inputHatch',
    'outputHatch',
    'energy',
    'dynamo',
    'muffler',
    'steamInput',
    'steamInputBus',
    'steamOutputBus',
  ])
    HAND_BLOCK_MAP[`gt.hatch.${id}.${tier}`] = hull;
  if (['EV', 'LuV', 'UV'].includes(tier)) HAND_BLOCK_MAP[`gt.hatch.dataAccess.${tier}`] = hull;
  if (i < VOLTAGE_TIERS.length - 1) {
    const high = VOLTAGE_TIERS[i + 1];
    HAND_BLOCK_MAP[`site.transformer.${tier}.down`] = {
      ...hull,
      front: `OVERLAY_ENERGY_IN_${high}`,
      rest: `OVERLAY_ENERGY_OUT_MULTI_4A_${tier}`,
    };
    HAND_BLOCK_MAP[`site.transformer.${tier}.up`] = {
      ...hull,
      front: `OVERLAY_ENERGY_OUT_${high}`,
      rest: `OVERLAY_ENERGY_IN_MULTI_4A_${tier}`,
    };
  }
}

const generated = existsSync(TEXTURES_GENERATED)
  ? JSON.parse(readFileSync(TEXTURES_GENERATED, 'utf8'))
  : { tiles: {}, blocks: {} };

// Canonical RC2 borosilicate variants are selectable in reviewed structures, including EV/IV/UMV/UXV.
const glassVariants = JSON.parse(
  readFileSync(join(ROOT, 'src/data/glass-variants.rc2.generated.json'), 'utf8'),
);
for (const variant of glassVariants.variants) {
  HAND_TILES[variant.tile] = { path: variant.path, ref: 'a3e1e11241a814c9fa0dd0973d5699548428f689' };
  HAND_BLOCK_MAP[variant.id] = { side: variant.tile };
}

/** Every tile: the hand-made ones and those of the generated catalog entries. */
const dataInterfaces = JSON.parse(
  readFileSync(join(ROOT, 'src/data/single-tiers.generated.json'), 'utf8'),
).dataInterfaces;
for (const { meta, tier } of Object.values(dataInterfaces)) {
  const name = [
    'ULV',
    'LV',
    'MV',
    'HV',
    'EV',
    'IV',
    'LuV',
    'ZPM',
    'UV',
    'UHV',
    'UEV',
    'UIV',
    'UMV',
    'UXV',
    'MAX',
  ][tier];
  HAND_BLOCK_MAP[`gregtech:gt.blockmachines@${meta}`] = {
    side: `MACHINE_${name}_SIDE`,
    top: `MACHINE_${name}_TOP`,
    bottom: `MACHINE_${name}_BOTTOM`,
    front: 'RECIPE_DATA_FRONT',
  };
}
const computing = JSON.parse(readFileSync(join(ROOT, 'src/data/computation.rc2.generated.json'), 'utf8'));
for (const [kind, variants] of Object.entries(computing.registrations))
  for (const variant of variants) {
    const tier = VOLTAGE_TIERS[variant.tier];
    const hull = {
      side: `MACHINE_${tier}_SIDE`,
      top: `MACHINE_${tier}_TOP`,
      bottom: `MACHINE_${tier}_BOTTOM`,
    };
    const front =
      kind === 'uncertainty'
        ? 'COMPUTATION_UNCERTAINTY_FRONT'
        : kind === 'computerRack'
          ? 'COMPUTATION_RACK_FRONT'
          : 'RECIPE_DATA_FRONT';
    HAND_BLOCK_MAP[`gregtech:gt.blockmachines@${variant.meta}`] = { ...hull, front };
    if (kind === 'uncertainty') HAND_BLOCK_MAP[`gt.hatch.uncertainty.${tier}`] = hull;
  }
HAND_BLOCK_MAP['gt.hatch.uncertainty'] = HAND_BLOCK_MAP['gt.hatch.uncertainty.IV'];
export const TILES = { ...generated.tiles, ...HAND_TILES };
/** Every block → faces mapping (hand-made entries win). */
export const BLOCK_MAP = { ...generated.blocks, ...HAND_BLOCK_MAP };

/**
 * Hatch kind → overlay tiles drawn (in order) over the hatch's facing side, as in the GT hatch classes
 * (MTEHatchCokeOven, MTEHatchInputBus, MTEHatchOutput, MTEHatchEnergy, …). The mode sign is tinted with
 * the hatch colour at runtime.
 */
export const HATCH_OVERLAYS = {
  computationIn: ['RECIPE_DATA_FRONT'],
  computationOut: ['RECIPE_DATA_FRONT'],
  wirelessComputationIn: ['RECIPE_DATA_FRONT'],
  wirelessComputationOut: ['RECIPE_DATA_FRONT'],
  uncertainty: ['COMPUTATION_UNCERTAINTY_FRONT'],
  computerRack: ['COMPUTATION_RACK_FRONT'],
  electrodeIn: ['OVERLAY_PIPE_IN', 'ITEM_IN_SIGN'],
  electrodeBus: ['OVERLAY_PIPE_IN', 'ITEM_IN_SIGN'],
  electrodeDetector: ['ELECTRODE_DETECTOR_FRONT'],
  itemIn: ['OVERLAY_PIPE_IN', 'ITEM_IN_SIGN'],
  itemOut: ['OVERLAY_PIPE_OUT', 'ITEM_OUT_SIGN'],
  fluidIn: ['OVERLAY_PIPE_IN', 'FLUID_IN_SIGN'],
  fluidOut: ['OVERLAY_PIPE_OUT', 'FLUID_OUT_SIGN'],
  energy: ['OVERLAY_ENERGY_IN_LV'],
  dynamo: ['OVERLAY_ENERGY_OUT_LV'],
  maintenance: ['OVERLAY_MAINTENANCE'],
  muffler: ['OVERLAY_MUFFLER'],
  steamIn: ['OVERLAY_PIPE_IN', 'FLUID_STEAM_IN_SIGN'],
  cryotheumIn: ['OVERLAY_PIPE_IN', 'FLUID_STEAM_IN_SIGN'],
  pyrotheumIn: ['OVERLAY_PIPE_IN', 'FLUID_STEAM_IN_SIGN'],
  dataAccess: ['OVERLAY_DATA_ACCESS'],
  assemblyDataIn: ['RECIPE_DATA_FRONT'],
  assemblyDataOut: ['RECIPE_DATA_FRONT'],
  wirelessAssemblyDataIn: ['RECIPE_DATA_FRONT'],
  wirelessAssemblyDataOut: ['RECIPE_DATA_FRONT'],
};

export function tileSourcePath(name) {
  return TILES[name]?.path ?? `${ICONSETS}/${name}.png`;
}

// ---------------------------------------------------------------------------------------------------------
// PNG decode / encode (zlib only)

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decodes a PNG (any colour type, bit depth 1–16, optionally Adam7-interlaced) to RGBA8. */
export function decodePng(data) {
  const buf = Buffer.from(data);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`bad colour type ${colorType}`);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  const maxV = (1 << Math.min(depth, 8)) - 1;

  // Reads raw sample `ch` of pixel x from an unfiltered scanline (16-bit samples keep full precision).
  const rawSample = (line, x, ch) => {
    const idx = x * channels + ch;
    if (depth === 16) return line.readUInt16BE(idx * 2);
    if (depth === 8) return line[idx];
    const bit = idx * depth;
    return (line[bit >> 3] >> (8 - depth - (bit & 7))) & maxV;
  };
  // Sample scaled to 0..255 (palette indices are returned as-is).
  const sample = (line, x, ch) => {
    const v = rawSample(line, x, ch);
    if (colorType === 3 || depth === 8) return v;
    if (depth === 16) return v >> 8;
    return Math.round((v * 255) / maxV);
  };
  const trnsMatch = (line, x) => {
    if (!trns) return false;
    if (colorType === 0) return rawSample(line, x, 0) === trns.readUInt16BE(0);
    return (
      rawSample(line, x, 0) === trns.readUInt16BE(0) &&
      rawSample(line, x, 1) === trns.readUInt16BE(2) &&
      rawSample(line, x, 2) === trns.readUInt16BE(4)
    );
  };
  const writePixel = (line, x, o) => {
    if (colorType === 3) {
      const i = sample(line, x, 0);
      rgba[o] = palette[i * 3];
      rgba[o + 1] = palette[i * 3 + 1];
      rgba[o + 2] = palette[i * 3 + 2];
      rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
    } else if (colorType === 0 || colorType === 4) {
      const g = sample(line, x, 0);
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
      rgba[o + 3] = colorType === 4 ? sample(line, x, 1) : trnsMatch(line, x) ? 0 : 255;
    } else {
      rgba[o] = sample(line, x, 0);
      rgba[o + 1] = sample(line, x, 1);
      rgba[o + 2] = sample(line, x, 2);
      rgba[o + 3] = colorType === 6 ? sample(line, x, 3) : trnsMatch(line, x) ? 0 : 255;
    }
  };

  // Adam7 passes: [x0, y0, dx, dy]; a non-interlaced image is a single pass over every pixel.
  const passes = interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  let pos2 = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[pos2];
      const line = raw.subarray(pos2 + 1, pos2 + 1 + stride);
      pos2 += stride + 1;
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? out[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
        out[i] = v & 0xff;
      }
      for (let x = 0; x < pw; x++) writePixel(out, x, ((y0 + y * dy) * width + x0 + x * dx) * 4);
      prev = out;
    }
  }
  return { width, height, data: rgba };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA8 pixels as a PNG (colour type 6, filter 0). Deterministic output. */
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------
// Tile processing

/**
 * Takes the first frame of a (possibly animated, vertical strip) icon and resamples it to TILE×TILE
 * (nearest neighbour; GT icons are 16×16 so this is normally a plain crop).
 */
export function firstFrameTile(img, tint) {
  const frame = img.width; // Minecraft animation strips are frames of width×width stacked vertically
  const size = Math.min(frame, img.height);
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const sx = Math.floor(((x + 0.5) * size) / TILE);
      const sy = Math.floor(((y + 0.5) * size) / TILE);
      const s = (sy * img.width + sx) * 4;
      const d = (y * TILE + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[d + c] = tint ? Math.round((img.data[s + c] * tint[c]) / 255) : img.data[s + c];
      }
      out[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Packs tiles (name → TILE×TILE RGBA) into a grid atlas. Returns the image and pixel rects. */
export function packAtlas(tiles) {
  const names = Object.keys(tiles);
  const cols = Math.min(COLUMNS, Math.max(1, names.length));
  const rows = Math.ceil(names.length / cols);
  const width = cols * TILE;
  const height = Math.max(1, rows) * TILE;
  const data = new Uint8Array(width * height * 4);
  const rects = {};
  names.forEach((name, i) => {
    const x0 = (i % cols) * TILE;
    const y0 = Math.floor(i / cols) * TILE;
    const px = tiles[name];
    for (let y = 0; y < TILE; y++) {
      data.set(px.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((y0 + y) * width + x0) * 4);
    }
    rects[name] = [x0, y0, TILE, TILE];
  });
  return { image: { width, height, data }, rects };
}

/**
 * Block ids declared in src/data/blocks.ts (parsed textually so the script stays plain Node) and in
 * src/data/blocks.generated.json.
 */
export function readBlockIds(
  source = readFileSync(BLOCKS_TS, 'utf8'),
  generatedList = existsSync(BLOCKS_GENERATED) ? JSON.parse(readFileSync(BLOCKS_GENERATED, 'utf8')) : [],
) {
  return [...[...source.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]), ...generatedList.map((b) => b.id)];
}

/** Builds the textures.json object. */
export function buildManifest(rects, atlasSize, blockIds) {
  const blocks = {};
  const flat = [];
  for (const id of [...new Set([...blockIds, ...Object.keys(BLOCK_MAP)])].sort()) {
    const faces = BLOCK_MAP[id];
    if (!faces) {
      blocks[id] = { flat: true };
      flat.push(id);
      continue;
    }
    for (const t of Object.values(faces)) if (!rects[t]) throw new Error(`${id}: unknown tile ${t}`);
    // Keep transparency explicit. Near-opaque sprite pixels (e.g. LCR's alpha 250) are solid.
    let holes = 0;
    let partial = 0;
    let pixels = 0;
    const rect = rects[faces.side];
    if (atlasSize.data && rect) {
      const [x, y, w, h] = rect;
      for (let py = y; py < y + h; py++)
        for (let px = x; px < x + w; px++) {
          const alpha = atlasSize.data[(py * atlasSize.width + px) * 4 + 3];
          pixels++;
          if (alpha === 0) holes++;
          else if (alpha < 245) partial++;
        }
    }
    blocks[id] = { ...faces, renderMode: partial > pixels / 4 ? 'transparent' : holes ? 'cutout' : 'opaque' };
  }
  for (const [kind, list] of Object.entries(HATCH_OVERLAYS)) {
    for (const t of list) if (!rects[t]) throw new Error(`hatch ${kind}: unknown tile ${t}`);
  }
  return {
    manifest: {
      $comment: 'Generated by scripts/build-atlas.mjs. Do not edit by hand.',
      atlas: { path: 'textures/atlas.png', width: atlasSize.width, height: atlasSize.height, tile: TILE },
      tiles: rects,
      blocks,
      hatchOverlays: HATCH_OVERLAYS,
    },
    flat,
  };
}

async function fetchSources() {
  mkdirSync(SRC_DIR, { recursive: true });
  for (const name of Object.keys(TILES)) {
    const dest = join(SRC_DIR, `${name}.png`);
    if (existsSync(dest)) continue;
    if (TILES[name].derived)
      throw new Error(`Regenerate ${name} with tools/game-dump/beam-hatch-textures.mjs`);
    const url = RAW(TILES[name].ref) + tileSourcePath(name);
    let body;
    for (let attempt = 1; !body; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        body = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt >= 4) throw e;
        console.warn(`retry ${name}: ${e.message}`);
      }
    }
    writeFileSync(dest, body);
    console.log('fetched', name);
  }
}

async function formatJson(text) {
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(TEXTURES_JSON)) ?? {};
    return await prettier.format(text, { ...options, filepath: TEXTURES_JSON });
  } catch {
    return text;
  }
}

async function main() {
  if (process.argv.includes('--fetch')) await fetchSources();
  const tiles = {};
  for (const [name, opts] of Object.entries(TILES)) {
    const file = join(SRC_DIR, `${name}.png`);
    if (!existsSync(file)) throw new Error(`missing ${file}; run with --fetch`);
    tiles[name] = firstFrameTile(decodePng(readFileSync(file)), opts.tint);
  }
  const { image, rects } = packAtlas(tiles);
  const { manifest, flat } = buildManifest(rects, image, readBlockIds());
  writeFileSync(ATLAS_PNG, encodePng(image));
  writeFileSync(TEXTURES_JSON, await formatJson(JSON.stringify(manifest, null, 2) + '\n'));
  console.log(`atlas ${image.width}×${image.height}, ${Object.keys(rects).length} tiles`);
  if (flat.length) console.log(`flat colour (no texture): ${flat.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
