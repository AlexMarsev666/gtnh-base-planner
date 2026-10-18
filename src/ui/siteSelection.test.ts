import { describe, expect, it } from 'vitest';
import { portUnitId } from '../model/site/ids';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import { portIdForUnit, portUnitFor } from './siteSelection';
import type { SiteResult } from './siteWorkerController';

const port = (id: string) => ({ id }) as never;
const siteWith = (...ids: string[]): SiteState => ({ ...emptySite(), ports: ids.map(port) });
const built = (of: SiteState, placed: string[]): SiteResult => ({
  build: { ports: placed.map((id) => ({ port: { id } })) } as unknown as SiteBuild,
  error: null,
  of,
});

describe('port picks', () => {
  it('maps port ids to unit ids and back', () => {
    const r = built(siteWith('a', 'b'), ['a', 'b']);
    expect(portUnitFor(r, 'b')).toBe(portUnitId(1));
    expect(portIdForUnit(r, portUnitId(1))).toBe('b');
    expect(portIdForUnit(r, 5)).toBeNull();
  });

  it('uses the build, not the current site: a stale build keeps its own numbering', () => {
    // The build was made before port 'a' was added in front: 'b' was index 0 then.
    const stale = built(siteWith('b'), ['b']);
    expect(portUnitFor(stale, 'b')).toBe(portUnitId(0));
    expect(portIdForUnit(stale, portUnitId(0))).toBe('b');
    expect(portUnitFor(stale, 'a')).toBeNull();
    expect(portIdForUnit(stale, portUnitId(1))).toBeNull();
  });

  it('ignores ports the build did not place', () => {
    const r = built(siteWith('a', 'b'), ['b']);
    expect(portUnitFor(r, 'a')).toBeNull();
    expect(portIdForUnit(r, portUnitId(0))).toBeNull();
    expect(portUnitFor({ build: null, error: null }, 'a')).toBeNull();
  });
});
