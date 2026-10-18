import { portIndexOfUnit, portUnitId } from '../model/site/ids';
import type { SiteResult } from './siteWorkerController';

/*
 * Port picks map between port ids and the unit ids of a build's scene. Unit ids stand for a port's index in
 * the site the build was made from (`result.of`), which may be older than the current site.
 */

/** The unit id the scene of `result` gives port `portId`, or null when that build has no such port. */
export function portUnitFor(result: SiteResult, portId: string): number | null {
  const i = result.of?.ports.findIndex((p) => p.id === portId) ?? -1;
  return i >= 0 && result.build?.ports.some((p) => p.port.id === portId) ? portUnitId(i) : null;
}

/** The id of the port a unit id of `result`'s scene stands for, or null (a group's unit, or no such port). */
export function portIdForUnit(result: SiteResult, unitId: number): string | null {
  const i = portIndexOfUnit(unitId);
  const id = i >= 0 ? result.of?.ports[i]?.id : undefined;
  return id !== undefined && result.build?.ports.some((p) => p.port.id === id) ? id : null;
}
