import type { Dir } from '../core/types';
import type { HatchKind } from '../multiblock/types';

/** Order and tuning of hatch placement. */

/**
 * Fixed order in which hatch kinds are placed. Rare / restricted kinds go first so that the common
 * item and fluid hatches cannot take the only cells they are allowed on.
 */
export const HATCH_PRIORITY: readonly HatchKind[] = [
  'uncertainty',
  'computerRack',
  'computationIn',
  'computationOut',
  'wirelessComputationIn',
  'wirelessComputationOut',
  'electrodeIn',
  'electrodeBus',
  'electrodeDetector',
  'muffler',
  'maintenance',
  'dataAccess',
  'assemblyDataIn',
  'assemblyDataOut',
  'wirelessAssemblyDataIn',
  'wirelessAssemblyDataOut',
  'energy',
  'dynamo',
  'steamIn',
  'cryotheumIn',
  'pyrotheumIn',
  'itemIn',
  'fluidIn',
  'itemOut',
  'fluidOut',
];

/** Preferred output face when a cell has several open ones: sides first, then top, bottom last. */
export const FACE_ORDER: readonly Dir[] = ['north', 'east', 'south', 'west', 'up', 'down'];

/**
 * A hatch face counts as facing outward when this many cells straight ahead of it are free. Hatches can be
 * turned to any open side in game, so a face looking into a one-block gap between units (or a recess) is
 * only used when the hatch has no outward face.
 */
export const CLEAR_AHEAD = 16;

/**
 * Above this many cells in the (padded) bounding box, the outside flood fill is skipped and any face
 * whose neighbour is not a structure cell counts as open (about 7 bytes a cell below it). The routing
 * grid stops at `MAX_GRID_CELLS`, so any build it can route stays below this; only far-apart manual
 * layouts reach it.
 */
export const FLOOD_LIMIT = 8_000_000;
