/**
 * Geometry shared by every part of the model. Domain types live beside their domain: multiblocks in
 * `multiblock/types.ts`, plans and their results in `plan/types.ts`, routes in `routing/routeNet.ts`,
 * what the renderer draws in `render/types.ts`, sites in `site/types.ts`.
 *
 * Coordinate system (same as Minecraft and three.js): X = east, Y = up, Z = south.
 * A `Vec3` is `[x, y, z]` in whole blocks. Local multiblock coords run from 0 to size-1 on each axis.
 */

export type Vec3 = readonly [number, number, number];

/** Face / direction. `north` = -Z, `south` = +Z, `east` = +X, `west` = -X, `up` = +Y, `down` = -Y. */
export type Dir = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export type HorizontalDir = 'north' | 'south' | 'east' | 'west';

/** Quarter turns clockwise around +Y when seen from above (east -> south -> west -> north). */
export type Rotation = 0 | 1 | 2 | 3;

export type ViewMode = 'simple' | 'detailed';

export type CellRole = 'casing' | 'controller' | 'air';

/** GregTech voltage tier, lowest first. Append only: share links store the index. */
export const TIERS = [
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
] as const;

export type Tier = (typeof TIERS)[number];
