import type { HatchKind } from './multiblock/types';

/** Default hatch colours (SIMPLE view and legend). */
export const DEFAULT_HATCH_COLORS: Record<HatchKind, string> = {
  itemIn: '#f2a33a',
  itemOut: '#e5533d',
  fluidIn: '#3fa7d6',
  fluidOut: '#2f6fd1',
  energy: '#e8c547',
  dynamo: '#b98ce0',
  maintenance: '#6fbf73',
  muffler: '#8a8f96',
  steamIn: '#c9b99a',
  dataAccess: '#3fc9b0',
};

/** Neutral colour of a pipe junction and of the marker of a site hatch holding several resources. */
export const JUNCTION_COLOR = '#c8c8c8';
