import { getSiteDef } from '../data/generic';
import { t } from '../i18n/en';
import type { Endpoint, SiteState } from '../model/site/types';

/** Display name of a group: its label, else its machine's name. */
export function groupName(site: SiteState, id: string): string {
  const g = site.groups.find((x) => x.id === id);
  if (!g) return id;
  return g.label ?? getSiteDef(g.multiblockId)?.name ?? g.multiblockId;
}

export function resName(site: SiteState, key: string): string {
  return site.resources[key]?.name ?? key;
}

/** Name of one end of a link. */
export function endName(site: SiteState, e: Endpoint): string {
  if ('group' in e) return groupName(site, e.group);
  const p = site.ports.find((x) => x.id === e.port);
  return p?.dir === 'in' ? t.site.inputPort : t.site.outputPort;
}

/** Names in the From / To menus: two groups of the same machine must be told apart. */
export function menuName(site: SiteState, id: string): string {
  const name = groupName(site, id);
  const same = site.groups.filter((g) => groupName(site, g.id) === name);
  if (same.length < 2) return name;
  const g = site.groups.find((x) => x.id === id)!;
  return `${name} (${g.origin[0]}, ${g.origin[1]})`;
}
