import type { SiteState } from '../model/site/types';

/** Runtime identities survive worker cloning without becoming part of saved documents. */
const revisions = new WeakMap<SiteState, number>();
const requests = new WeakMap<SiteState, number>();
let nextRevision = 0;

export function sourceRevisionOf(site: SiteState): number {
  let revision = revisions.get(site);
  if (revision === undefined) {
    revision = ++nextRevision;
    revisions.set(site, revision);
  }
  return revision;
}

export function registerBuild(site: SiteState, requestId: number): number {
  requests.set(site, requestId);
  return sourceRevisionOf(site);
}

export function latestBuildRequest(site: SiteState): number | undefined {
  return requests.get(site);
}
