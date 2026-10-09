import support from './catalog-support.generated.json';

export type CatalogSupportReason =
  'liquid-zones' | 'retained-shape' | 'rejected-default' | 'check-exception' | 'no-game-check';

/** UI information from saved RC2 evidence, independent of placement and validation. */
export function catalogSupportReason(id: string): CatalogSupportReason | undefined {
  return Object.hasOwn(support, id)
    ? (support[id as keyof typeof support].reason as CatalogSupportReason)
    : undefined;
}

export function catalogSupportStatus(id: string): 'limited' | 'known-problem' | 'unverified' | undefined {
  return Object.hasOwn(support, id)
    ? (support[id as keyof typeof support].status as 'limited' | 'known-problem' | 'unverified')
    : undefined;
}
