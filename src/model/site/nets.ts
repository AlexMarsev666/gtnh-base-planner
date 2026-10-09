import { isSingleBlock } from '../../data/generic';
import { controllerFacing, step } from '../geometry';
import type { Dir } from '../core/types';
import type { HatchKind } from '../multiblock/types';
import type { NetTerminalInfo, PlacedGroup, PlacedPort, SiteNet, SiteWarning } from './buildTypes';
import { siteResource } from './demand';
import { IN_KINDS, OUT_KINDS, type SiteHatch } from './group';
import { endNode } from './ids';
import type { SiteOccupancy } from './occupancy';
import { routeNets, type RouteTerminal } from './router';
import type { ResourceKind, SiteState } from './types';

/** Resource networks of a site: which hatches and ports each link chain connects, and their routes. */

/** Faces tried after a hatch's placed face: sides first, then top, then bottom. */
const ATTACH_ORDER: readonly Dir[] = ['north', 'east', 'south', 'west', 'up', 'down'];

/** Representative hatch kind of a net (fallback colour and pipe vs cable width in the renderer). */
export function netKind(kind: ResourceKind): HatchKind {
  return kind === 'power' ? 'energy' : kind === 'fluid' ? 'fluidOut' : 'itemOut';
}

/** Disjoint sets of string nodes; the smaller key of a set is its root. */
export class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p !== a) {
      p = this.find(p);
      this.parent.set(a, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
  }
}

/**
 * One net per chain of links carrying the same resource (joined where they share a group side or a port),
 * with its terminals: the placed ports, and the group hatches that carry the resource on that side. Each
 * hatch belongs to one net at most (`hatchNet`).
 */
export function buildSiteNetworks(
  site: SiteState,
  groups: readonly PlacedGroup[],
  ports: readonly PlacedPort[],
): { nets: SiteNet[]; hatchNet: Map<SiteHatch, number> } {
  const groupIndex = new Map(site.groups.map((g, i) => [g.id, i]));
  const portById = new Map(site.ports.map((p) => [p.id, p]));
  const placedPort = new Map(ports.map((p) => [p.port.id, p]));
  const uf = new UnionFind();
  for (const l of site.links) uf.union(endNode(l.resource, l.from, 'out'), endNode(l.resource, l.to, 'in'));
  const comps = new Map<string, { resource: string; links: string[]; nodes: Set<string>; rate?: number }>();
  for (const l of site.links) {
    const a = endNode(l.resource, l.from, 'out');
    const root = uf.find(a);
    let c = comps.get(root);
    if (!c) comps.set(root, (c = { resource: l.resource, links: [], nodes: new Set() }));
    c.links.push(l.id);
    c.nodes.add(a);
    c.nodes.add(endNode(l.resource, l.to, 'in'));
    if (l.rate !== undefined) c.rate = (c.rate ?? 0) + l.rate;
  }
  const nets: SiteNet[] = [];
  const hatchNet = new Map<SiteHatch, number>();
  for (const c of comps.values()) {
    const res = siteResource(site, c.resource);
    const terminals: NetTerminalInfo[] = [];
    for (const node of c.nodes) {
      const [, type, id, side] = node.split('\u0000');
      if (type === 'p') {
        const pp = placedPort.get(id);
        if (pp)
          terminals.push({
            role: portById.get(id)!.dir === 'in' ? 'source' : 'sink',
            port: id,
            cell: pp.cell,
          });
        continue;
      }
      const pg = groups[groupIndex.get(id) ?? -1];
      if (!pg) continue;
      const kinds = side === 'out' ? OUT_KINDS : IN_KINDS;
      for (const h of pg.hatches) {
        if (h.resource !== c.resource || !kinds.includes(h.kind) || hatchNet.has(h)) continue;
        hatchNet.set(h, nets.length);
        terminals.push({ role: side === 'out' ? 'source' : 'sink', group: id, hatch: h, cell: h.cell });
      }
    }
    nets.push({
      id: nets.length,
      resource: c.resource,
      kind: res.kind,
      links: c.links,
      terminals,
      route: null,
      rate: c.rate,
    });
  }
  return { nets, hatchNet };
}

/**
 * Routes the nets that are switched on (`pipes` for items and fluids, `cables` for power) and sets their
 * `route`. Fronts of hatches no routed net uses stay free (mufflers vent there, maintenance needs the
 * player, an unrouted energy hatch takes its cable there). Afterwards every hatch of a net carries the
 * net's id and turns to the side its pipe reaches it from (the groups' `hatches` are replaced). Returns
 * the routed nets and a warning per net that could not connect every terminal.
 */
export function routeSiteNetworks(
  site: SiteState,
  groups: PlacedGroup[],
  ports: readonly PlacedPort[],
  nets: readonly SiteNet[],
  hatchNet: ReadonlyMap<SiteHatch, number>,
  occupancy: SiteOccupancy,
  opts: { pipes: boolean; cables: boolean; below?: boolean; turnCost?: number },
): { routed: SiteNet[]; warnings: SiteWarning[] } {
  const [w, d] = site.size;
  const { solids, keepFree } = occupancy;
  const groupIndex = new Map(site.groups.map((g, i) => [g.id, i]));
  const placedPort = new Map(ports.map((p) => [p.port.id, p]));
  /** Faces a pipe may use for each terminal. */
  const termFaces = (t: NetTerminalInfo): Dir[] => {
    if (t.port) return placedPort.get(t.port)!.faces;
    const h = t.hatch!;
    const pg = groups[groupIndex.get(t.group!)!];
    if (h.allowedFaces) return h.allowedFaces;
    const single = pg.def && isSingleBlock(pg.def);
    const unit = single ? pg.units.find((u) => u.id === h.unitIds[0]) : undefined;
    const front = unit && pg.def ? controllerFacing(pg.def, unit) : null;
    const no = new Set<Dir>([
      ...(h.blocked ?? []),
      ...(front ? [front] : []),
      ...(front && !opts.below ? ['down' as Dir] : []),
    ]);
    return [h.face, ...ATTACH_ORDER.filter((f) => f !== h.face)].filter((f) => !no.has(f));
  };

  const routed = nets.filter((n) => (n.kind === 'power' ? opts.cables : opts.pipes));
  const routedHatches = new Set<SiteHatch>();
  for (const n of routed) for (const t of n.terminals) if (t.hatch) routedHatches.add(t.hatch);
  for (const pg of groups) {
    if (pg.def && isSingleBlock(pg.def)) continue;
    for (const h of pg.hatches) if (!routedHatches.has(h)) keepFree.push(step(h.cell, h.face));
  }
  const height = Math.max(4, ...groups.map((g) => g.max[1] + 3));
  const neat = site.routing?.mode === 'neat';
  const depth = neat ? site.routing!.depth : opts.below ? 1 : 0;
  const results = routed.length
    ? routeNets({
        // One layer under the ground for pipes that come from below.
        box: { min: [0, -depth, 0], max: [w, height, d] },
        trenchBelow: !neat && opts.below ? 0 : undefined,
        neat: neat
          ? {
              y: -depth,
              x: groups.map((g) => g.min[0] - Math.max(1, site.corridor)),
              z: groups.map((g) => g.min[2] - Math.max(1, site.corridor)),
            }
          : undefined,
        solids,
        keepFree,
        nets: routed.map((n) => ({
          terminals: n.terminals.map((t): RouteTerminal => ({
            cell: t.cell,
            faces: termFaces(t),
            role: t.role,
          })),
        })),
        turnCost: opts.turnCost ?? (neat ? 8 : undefined),
      })
    : [];
  routed.forEach((n, i) => (n.route = results[i]));

  // Hatches turn to the side their pipe reaches them from.
  const finalFace = new Map<SiteHatch, Dir>();
  for (const n of routed)
    n.terminals.forEach((t, ti) => {
      const f = n.route?.attach[ti];
      if (t.hatch && f) finalFace.set(t.hatch, f);
    });
  for (const pg of groups)
    pg.hatches = pg.hatches.map((h) => {
      const net = hatchNet.get(h);
      const face = finalFace.get(h);
      if (net === undefined && !face) return h;
      const out: SiteHatch = { ...h, face: face ?? h.face };
      if (net !== undefined) out.net = net;
      return out;
    });
  const warnings: SiteWarning[] = [];
  for (const n of routed) {
    const r = n.route!;
    if (r.connected < r.total)
      warnings.push({ type: 'unrouted', resource: n.resource, connected: r.connected, total: r.total });
  }
  return { routed, warnings };
}
