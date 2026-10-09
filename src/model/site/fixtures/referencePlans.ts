import refinery from '../../../../docs/fixtures/reference-01-oil-refinery.json';
import { getMultiblock } from '../../../data/catalog';
import { emptySite, siteFromJson } from '../../../share/siteCodec';
import type { SiteGroup, SiteState } from '../types';

function group(id: string, machine: string, count: number, origin: [number, number]): SiteGroup {
  return {
    id,
    multiblockId: machine,
    count,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [...getMultiblock(machine)!.defaultHatches],
    origin,
    rotation: 0,
    voltageTier: 'HV',
  };
}

function fluid(
  site: SiteState,
  id: string,
  from: { group: string } | { port: string },
  to: { group: string } | { port: string },
) {
  site.resources[id] = { kind: 'fluid', name: id, color: '#5678ab' };
  site.links.push({ id: `l${site.links.length}`, resource: id, from, to });
}

function supply(site: SiteState, id: string, g: string, z: number) {
  site.ports.push({ id: `p-${id}`, dir: 'in', resource: id, pos: [0, z] });
  fluid(site, id, { port: `p-${id}` }, { group: g });
}

function output(site: SiteState, id: string, g: string, z: number) {
  site.ports.push({ id: `p-${id}`, dir: 'out', resource: id, pos: [site.size[0] - 1, z] });
  fluid(site, id, { group: g }, { port: `p-${id}` });
}

export function referencePlans() {
  // The original attachment stays unchanged. Apply only the two assignments approved in item 3.
  const one = siteFromJson(JSON.stringify(refinery));
  for (const b of one.groups.find((g) => g.id === 'g9')!.resourceBindings!)
    if (['fluid:resource', 'fluid:light-steam-cracked-napthta'].includes(b.resource)) b.unitId = 1;

  const two = emptySite();
  two.size = [30, 24];
  two.groups = [
    group('reactor', 'large-chemical-reactor', 1, [5, 8]),
    group('tower', 'distillation-tower', 1, [19, 8]),
  ];
  supply(two, 'feed', 'reactor', 8);
  fluid(two, 'mixture', { group: 'reactor' }, { group: 'tower' });
  output(two, 'product', 'tower', 10);
  two.groups[1].resourceBindings = [
    { kind: 'fluidOut', resource: 'product', role: 'product', outputSlot: 0 },
  ];

  const three = emptySite();
  three.size = [64, 40];
  three.groups = [
    group('pyro', 'pyrolyse-oven', 4, [5, 8]),
    group('ebf', 'electric-blast-furnace', 4, [27, 8]),
    group('tower', 'distillation-tower', 4, [48, 8]),
  ];
  supply(three, 'feed', 'pyro', 10);
  fluid(three, 'gas', { group: 'pyro' }, { group: 'ebf' });
  fluid(three, 'mixture', { group: 'ebf' }, { group: 'tower' });
  output(three, 'product', 'tower', 12);
  three.groups[2].resourceBindings = [
    { kind: 'fluidOut', resource: 'product', role: 'product', outputSlot: 0 },
  ];

  const four = emptySite();
  four.size = [44, 32];
  four.groups = [
    group('crackers', 'oil-cracking-unit', 2, [6, 10]),
    group('towers', 'distillation-tower', 2, [27, 10]),
  ];
  four.groups[0].limits = { x: 1, y: 2, z: 1 };
  four.groups[0].resourceBindings = [
    { kind: 'fluidIn', resource: 'feed-a', role: 'feed' },
    { kind: 'fluidIn', resource: 'feed-b', role: 'feed' },
    { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
  ];
  for (const [i, id] of ['feed-a', 'feed-b', 'agent'].entries()) supply(four, id, 'crackers', 6 + 4 * i);
  for (const [i, id] of ['cracked-a', 'cracked-b'].entries()) {
    fluid(four, id, { group: 'crackers' }, { group: 'towers' });
    output(four, `product-${i}`, 'towers', 8 + 4 * i);
  }
  four.groups[1].resourceBindings = [0, 1].map((outputSlot) => ({
    kind: 'fluidOut',
    resource: `product-${outputSlot}`,
    role: 'product',
    outputSlot,
  }));

  const five = emptySite();
  five.size = [30, 24];
  five.groups = [group('furnaces', 'electric-blast-furnace', 4, [9, 8])];
  five.groups[0].limits = { x: 4, y: 1, z: 1 };
  five.groups[0].limitsLocked = true;
  supply(five, 'feed', 'furnaces', 8);
  output(five, 'product', 'furnaces', 12);

  return [
    {
      id: '01-oil-refinery',
      title: 'Нефтепереработка пользователя, 27 групп, исправлены два назначения g9',
      site: one,
    },
    { id: '02-small', title: 'Малый: химический реактор и башня', site: two },
    { id: '03-medium', title: 'Средний: по четыре Pyrolyse Oven, EBF и DT', site: three },
    { id: '04-crackers-towers', title: 'Два крекера и две башни', site: four },
    { id: '05-wallsharing', title: 'Четыре EBF с общими стенами и жёсткими limits', site: five },
  ];
}
