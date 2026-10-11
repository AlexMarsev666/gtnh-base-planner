import { isSingleBlock, getSiteDef } from '../../data/generic';
import { getSingleMachine, transformerValid } from '../../data/single-machines';
import { TIERS, type Tier } from '../core/types';
import type { HatchKind } from '../multiblock/types';
import { siteResource } from './demand';
import { endNode } from './ids';
import type { SiteGroup, SiteState, TransformerAmps } from './types';

/**
 * Voltage of the power networks of a template. A transformer (a single block with `machine` = `transformer`)
 * takes power on one side and gives it on the other, one tier lower or higher; every other group takes power
 * at its `tier` and a generator gives it at its `tier`. The checks only report (`PowerWarning`); nothing is
 * fixed on its own. A site without transformers, such as one made before they existed, gets none of them
 * apart from tier mismatches between groups that have a `tier`.
 */

export type PowerWarning =
  /** A consumer's tier (`got`) is below the voltage its net carries (`expected`): it would explode in game. */
  | { type: 'powerTier'; resource: string; expected: Tier; got: Tier; group: string }
  /** GT has no transformer of this high-side tier and amperage (Hi-Amp starts at UEV). */
  | { type: 'transformerInvalid'; group: string; tier: Tier; amps: TransformerAmps }
  /** A net with a transformer on it whose voltage cannot be told (a port has no tier): a note, not an error. */
  | { type: 'powerUnknownTier'; resource: string };

/** Whether the group is a transformer: a single block named `transformer`. */
export function isTransformer(group: Pick<SiteGroup, 'multiblockId' | 'machine'>): boolean {
  const def = getSiteDef(group.multiblockId);
  return !!def && isSingleBlock(def) && !!group.machine && !!getSingleMachine(group.machine)?.transformer;
}

/**
 * The tiers a transformer takes power at and gives it at: `tier` is its high side and the low side is one
 * below. A step-down transformer (the default) takes the high side; a step-up one the low side. Undefined
 * without a `tier`.
 */
export function transformerTiers(group: SiteGroup): { input: Tier; output: Tier } | undefined {
  if (!group.tier) return undefined;
  const high = group.tier;
  const low = TIERS[Math.max(0, TIERS.indexOf(high) - 1)];
  return group.step === 'up' ? { input: low, output: high } : { input: high, output: low };
}

/**
 * Whether the hatch of a transformer sits on the front face (true) or on the other five (false): a step-down
 * transformer takes its input (energy hatch) on the front and gives its output (dynamo) on the other faces;
 * a step-up one the other way round. Undefined for any other hatch kind.
 */
export function transformerHatchOnFront(group: SiteGroup, kind: HatchKind): boolean | undefined {
  if (kind !== 'energy' && kind !== 'dynamo') return undefined;
  return (group.step !== 'up') === (kind === 'energy');
}

/** The higher of two tiers. */
const higher = (a: Tier | undefined, b: Tier): Tier => (a && TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b);

interface Net {
  resource: string;
  /** Tier each producing end gives (undefined = unknown) and each consuming group takes. */
  produced: (Tier | undefined)[];
  consumers: { group: string; tier: Tier | undefined; exact: boolean }[];
  /** Whether every consumer is a transformer (and there is one): the net is its input net. */
  transformerInput: boolean;
}

/**
 * Checks the voltage of every power net: a net carries the highest tier its producers give (a transformer's
 * output, a generator's `tier`); a consumer below it, or a transformer whose input side is not that tier, is
 * a `powerTier`. Also reports transformers GT does not make (`transformerInvalid`). Nets whose tier cannot be
 * told are noted (`powerUnknownTier`) only when a transformer is on them. In link order, so deterministic.
 */
export function analysePower(site: SiteState): PowerWarning[] {
  const groupById = new Map(site.groups.map((g) => [g.id, g]));
  const warnings: PowerWarning[] = [];
  for (const g of site.groups)
    if (isTransformer(g) && g.tier && !transformerValid(g.tier, g.amps ?? 4))
      warnings.push({ type: 'transformerInvalid', group: g.id, tier: g.tier, amps: g.amps ?? 4 });

  // Nets: chains of links of one resource joined at a group side or a port, as in `buildSiteNetworks`.
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    const p = parent.get(a) ?? a;
    if (p === a) return a;
    const root = find(p);
    parent.set(a, root);
    return root;
  };
  const power = site.links.filter((l) => siteResource(site, l.resource).kind === 'power');
  for (const l of power)
    parent.set(find(endNode(l.resource, l.to, 'in')), find(endNode(l.resource, l.from, 'out')));
  const nets = new Map<string, Net>();
  for (const l of power) {
    const root = find(endNode(l.resource, l.from, 'out'));
    let net = nets.get(root);
    if (!net)
      nets.set(root, (net = { resource: l.resource, produced: [], consumers: [], transformerInput: false }));
    for (const side of ['out', 'in'] as const) {
      const end = side === 'out' ? l.from : l.to;
      const g = 'group' in end ? groupById.get(end.group) : undefined;
      const tr = g && isTransformer(g);
      const tiers = g && tr ? transformerTiers(g) : undefined;
      if (side === 'out') net.produced.push(tr ? tiers?.output : g?.tier);
      else if (g) net.consumers.push({ group: g.id, tier: tr ? tiers?.input : g.tier, exact: !!tr });
    }
  }

  const seen = new Set<string>();
  for (const net of nets.values()) {
    let tier: Tier | undefined;
    for (const t of net.produced) if (t) tier = higher(tier, t);
    if (!tier) {
      if (net.consumers.length > 0 && net.consumers.every((c) => c.exact) && !seen.has(net.resource)) {
        seen.add(net.resource);
        warnings.push({ type: 'powerUnknownTier', resource: net.resource });
      }
      continue;
    }
    for (const c of net.consumers) {
      if (!c.tier || seen.has(`${net.resource}\u0000${c.group}`)) continue;
      const wrong = c.exact ? c.tier !== tier : TIERS.indexOf(c.tier) < TIERS.indexOf(tier);
      if (!wrong) continue;
      seen.add(`${net.resource}\u0000${c.group}`);
      warnings.push({
        type: 'powerTier',
        resource: net.resource,
        expected: tier,
        got: c.tier,
        group: c.group,
      });
    }
  }
  return warnings;
}
