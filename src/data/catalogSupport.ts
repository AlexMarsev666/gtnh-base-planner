import support from './catalog-support.generated.json';

export type CatalogSupportReason =
  'liquid-zones' | 'retained-shape' | 'rejected-default' | 'check-exception' | 'no-game-check';

/** UI information from saved RC2 evidence, independent of placement and validation. */
export function catalogSupportReason(id: string): CatalogSupportReason | undefined {
  return Object.hasOwn(support, id)
    ? (support[id as keyof typeof support] as CatalogSupportReason)
    : undefined;
}
