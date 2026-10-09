/**
 * Standalone page (`detailed-harness.html`) that renders every block with the DETAILED provider, for the
 * e2e screenshot in `e2e/detailed.spec.ts`. Not part of the app UI.
 */
import * as THREE from 'three';
import { BLOCKS } from '../../data/blocks';
import { DEFAULT_HATCH_COLORS } from '../../model/colors';
import type { HatchKind } from '../../model/multiblock/types';
import { createDetailedProvider, TEXTURES } from '../detailed';
import type { BlockVisual } from '../materials';

declare global {
  interface Window {
    __detailedHarness?: { ready: boolean; meshes: number; error?: string };
  }
}

const HATCH_BLOCK: Record<HatchKind, string> = {
  computationIn: 'gregtech:gt.blockmachines@15440',
  computationOut: 'gregtech:gt.blockmachines@15441',
  wirelessComputationIn: 'gregtech:gt.blockmachines@15445',
  wirelessComputationOut: 'gregtech:gt.blockmachines@15444',
  uncertainty: 'gt.hatch.uncertainty.IV',
  computerRack: 'gregtech:gt.blockmachines@15450',
  electrodeIn: 'gregtech:gt.blockmachines@14203',
  electrodeBus: 'gregtech:gt.blockmachines@14203',
  electrodeDetector: 'gregtech:gt.blockmachines@14204',
  itemIn: 'gt.hatch.inputBus',
  itemOut: 'gt.hatch.outputBus',
  fluidIn: 'gt.hatch.inputHatch',
  fluidOut: 'gt.hatch.outputHatch',
  energy: 'gt.hatch.energy',
  dynamo: 'gt.hatch.dynamo',
  maintenance: 'gt.hatch.maintenance',
  muffler: 'gt.hatch.muffler',
  steamIn: 'gt.hatch.steamInput',
  cryotheumIn: 'gregtech:gt.blockmachines@967',
  pyrotheumIn: 'gregtech:gt.blockmachines@968',
  dataAccess: 'gt.hatch.dataAccess',
  assemblyDataIn: 'gregtech:gt.blockmachines@15442',
  assemblyDataOut: 'gregtech:gt.blockmachines@15443',
  wirelessAssemblyDataIn: 'gregtech:gt.blockmachines@15446',
  wirelessAssemblyDataOut: 'gregtech:gt.blockmachines@15447',
};

function rows(): BlockVisual[][] {
  // Every block the app knows plus every block the atlas maps (ids may land in blocks.ts later).
  const ids = [...new Set([...Object.keys(BLOCKS), ...Object.keys(TEXTURES.blocks)])];
  const casings = ids
    .filter((id) => !id.startsWith('gt.hatch.') && !/controller/i.test(id) && id !== 'gt.cokeOvenHatch')
    .map((blockId): BlockVisual => ({ blockId, kind: 'casing' }));
  const controllers = ids
    .filter((id) => /controller/i.test(id))
    .map((blockId): BlockVisual => ({ blockId, kind: 'controller', facing: 'south' }));
  const cokeHatches = (['itemIn', 'itemOut', 'fluidOut'] as const).map((hatchKind): BlockVisual => ({
    blockId: 'gt.cokeOvenHatch',
    kind: 'hatch',
    facing: 'south',
    hatchKind,
  }));
  const hatches = (Object.keys(HATCH_BLOCK) as HatchKind[]).map((hatchKind): BlockVisual => ({
    blockId: HATCH_BLOCK[hatchKind],
    kind: 'hatch',
    facing: 'south',
    hatchKind,
  }));
  const perRow = 8;
  const out: BlockVisual[][] = [];
  for (let i = 0; i < casings.length; i += perRow) out.push(casings.slice(i, i + perRow));
  out.push([...controllers, ...cokeHatches]);
  out.push(hatches);
  return out;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('harness') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#20242a');
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 8, 6);
  scene.add(sun);

  const provider = createDetailedProvider();
  await provider.load();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const visuals = rows().flat();
  const columns = Math.ceil(Math.sqrt(visuals.length));
  const grid = Array.from({ length: Math.ceil(visuals.length / columns) }, (_, i) =>
    visuals.slice(i * columns, (i + 1) * columns),
  );
  let meshes = 0;
  grid.forEach((row, z) => {
    row.forEach((visual, x) => {
      const mesh = new THREE.Mesh(geometry, provider.materials(visual, DEFAULT_HATCH_COLORS));
      mesh.position.set(x * 1.25, 0, z * 2);
      scene.add(mesh);
      meshes++;
    });
  });

  const width = columns * 1.25;
  const depth = grid.length * 2;
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const half = Math.max(width / aspect, depth) * 0.65;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 1000);
  camera.position.set(width / 2 + depth * 0.15, depth * 1.2, depth * 1.1);
  camera.lookAt(width / 2 - 0.6, 0, depth / 2 - 0.6);
  renderer.render(scene, camera);
  window.__detailedHarness = { ready: true, meshes };
}

main().catch((e: unknown) => {
  window.__detailedHarness = { ready: false, meshes: 0, error: String(e) };
  console.error(e);
});
