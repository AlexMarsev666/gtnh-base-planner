import type { HatchKind } from '../multiblock/types';

/** Hatch kinds that routing connects with pipes or cables. */

/** Hatch kinds that get pipe/conveyor networks. */
const LEGACY_PIPE_KINDS = ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'steamIn'] as const;
const LOCKED_PIPE_KINDS = ['cryotheumIn', 'pyrotheumIn'] as const;
const ELECTRODE_PIPE_KINDS = ['electrodeIn', 'electrodeBus'] as const;
export const PIPE_KINDS = [...LEGACY_PIPE_KINDS, ...LOCKED_PIPE_KINDS, ...ELECTRODE_PIPE_KINDS] as const;

/** Hatch kinds that get cable networks (energy in, dynamo out). */
export const CABLE_KINDS = ['energy', 'dynamo'] as const;

/** Every kind routing can connect, in routing order: pipes first, then cables. */
export const ROUTED_KINDS = [
  ...LEGACY_PIPE_KINDS,
  ...CABLE_KINDS,
  ...LOCKED_PIPE_KINDS,
  ...ELECTRODE_PIPE_KINDS,
] as const;
export const ROUTED_MASK = (1 << ROUTED_KINDS.length) - 1;

export type RoutedKind = (typeof ROUTED_KINDS)[number];

/** Whether a routed kind is a cable (drawn thinner) rather than a pipe. */
export function isCable(kind: HatchKind): boolean {
  return (CABLE_KINDS as readonly HatchKind[]).includes(kind);
}

export function isRoutable(kind: HatchKind): kind is RoutedKind {
  return (ROUTED_KINDS as readonly HatchKind[]).includes(kind);
}
