import { describe, expect, it } from 'vitest';
import { t } from '../i18n/en';
import { emptySite } from '../share/siteCodec';
import { withGroupAdded, withGroupPatched } from './siteActions';
import { endName, groupName, menuName, resName } from './siteNames';

function two() {
  let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
  s = withGroupAdded(s, 'electric-blast-furnace', [12, 3]);
  return s;
}

describe('site names', () => {
  it('names a group by its label, else its machine, else its id', () => {
    const s = two();
    const [a, b] = s.groups;
    expect(groupName(s, a.id)).not.toBe(a.id);
    const labelled = withGroupPatched(s, a.id, { label: 'Smelter' });
    expect(groupName(labelled, a.id)).toBe('Smelter');
    expect(groupName(labelled, b.id)).toBe(groupName(s, b.id));
    expect(groupName(s, 'nope')).toBe('nope');
  });

  it('names resources and falls back to the key', () => {
    const s = { ...emptySite(), resources: { x: { name: 'Steel', kind: 'item' as const, color: '#fff' } } };
    expect(resName(s, 'x')).toBe('Steel');
    expect(resName(s, 'y')).toBe('y');
  });

  it('names link ends: groups and ports', () => {
    const s = {
      ...two(),
      ports: [
        { id: 'p1', dir: 'in' as const, resource: 'x' },
        { id: 'p2', dir: 'out' as const, resource: 'x' },
      ],
    };
    expect(endName(s, { group: s.groups[0].id })).toBe(groupName(s, s.groups[0].id));
    expect(endName(s, { port: 'p1' })).toBe(t.site.inputPort);
    expect(endName(s, { port: 'p2' })).toBe(t.site.outputPort);
  });

  it('tells apart groups of the same machine in menus by their origin', () => {
    const s = two();
    expect(menuName(s, s.groups[0].id)).toBe(`${groupName(s, s.groups[0].id)} (3, 3)`);
    expect(menuName(s, s.groups[1].id)).toBe(`${groupName(s, s.groups[1].id)} (12, 3)`);
    const one = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
    expect(menuName(one, one.groups[0].id)).toBe(groupName(one, one.groups[0].id));
  });
});
