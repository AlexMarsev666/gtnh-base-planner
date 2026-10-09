import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { createSiteBuilder } from './build';
import type { PlacedGroup } from './buildTypes';
import { validateHatchAccess } from './hatchAccess';
import { emptySite } from '../../share/siteCodec';
import { withGroupAdded } from '../../ui/siteActions';

describe('final hatch connection access', () => {
  const site = withGroupAdded(emptySite(), 'vacuum-freezer');
  const built = createSiteBuilder()(site, { pipes: false, cables: false, below: true });
  const group = built.groups[0];
  const make = (resource = 'water'): PlacedGroup => ({
    ...group,
    hatches: [
      {
        kind: 'fluidIn',
        cell: [4, 0, 4],
        face: 'east',
        unitIds: [0],
        resource,
      },
    ],
  });
  it('rejects solid and mandatory air cells and reserved controller access', () => {
    for (const air of [true, false]) {
      const warnings = validateHatchAccess(
        [make()],
        { occ: new Map([['5,0,4', { gi: 1, air }]]) },
        new Set(),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ type: 'error', group: group.group.id });
      expect(warnings[0].type === 'error' && warnings[0].message).toContain('structure or required air');
    }
    const door = validateHatchAccess([make()], { occ: new Map() }, new Set(['5,0,4']));
    expect(door[0].type === 'error' && door[0].message).toContain('controller access');
    expect(validateHatchAccess([make()], { occ: new Map() }, new Set())).toEqual([]);
  });
  it('reports each affected controller when different resources share a front; one resource may join', () => {
    const left = make();
    const right = make('oil');
    right.group = { ...right.group, id: 'right' };
    right.hatches[0] = { ...right.hatches[0], cell: [5, 0, 5], face: 'north' };
    const conflicts = validateHatchAccess([left, right], { occ: new Map() }, new Set());
    expect(conflicts.map((w) => w.type === 'error' && w.group).sort()).toEqual(
      [group.group.id, 'right'].sort(),
    );
    right.hatches[0].resource = 'water';
    expect(validateHatchAccess([left, right], { occ: new Map() }, new Set())).toEqual([]);
  });
  it('allows top outlets while retaining obstruction checks independently of construction hints', () => {
    const tower = { ...make(), def: getMultiblock('sparge-tower-controller')! };
    tower.hatches[0] = { ...tower.hatches[0], kind: 'fluidOut', cell: [0, 7, 0], face: 'up' };
    expect(validateHatchAccess([tower], { occ: new Map() }, new Set())).toEqual([]);
    expect(
      validateHatchAccess([tower], { occ: new Map([['0,8,0', { gi: 1, air: false }]]) }, new Set()),
    ).toHaveLength(1);
  });

  it('allows direct terminals of the same network and one shared pipe front for input/output', () => {
    const left = make();
    left.hatches[0].net = 0;
    const right = make();
    right.hatches[0] = { ...right.hatches[0], kind: 'fluidOut', cell: [5, 0, 4], face: 'west', net: 0 };
    const occupancy = {
      occ: new Map([
        ['4,0,4', { gi: 0, air: false }],
        ['5,0,4', { gi: 1, air: false }],
      ]),
    };
    expect(validateHatchAccess([left, right], occupancy, new Set())).toEqual([]);
    right.hatches[0].net = 1;
    expect(validateHatchAccess([left, right], occupancy, new Set())).toHaveLength(2);
    const port = {
      port: { id: 'water', resource: 'water', dir: 'in' as const },
      cell: [5, 0, 4] as [number, number, number],
      faces: ['west' as const],
    };
    expect(validateHatchAccess([left], occupancy, new Set(), [port])).toEqual([]);
    port.port.resource = 'oil';
    expect(validateHatchAccess([left], occupancy, new Set(), [port])).toHaveLength(1);
    right.hatches[0] = { ...right.hatches[0], cell: [5, 0, 5], face: 'north', net: 0 };
    expect(validateHatchAccess([left, right], { occ: new Map() }, new Set())).toEqual([]);
  });
});
