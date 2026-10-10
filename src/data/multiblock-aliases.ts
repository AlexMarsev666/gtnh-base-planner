import { getSiteDef } from './generic';

/**
 * Multiblock ids that plans, templates and share links may still carry although the catalog no longer has
 * them. Most catalog entries are regenerated from the game dump, so an id can be renamed or removed.
 *
 * When a multiblock is renamed: add `old-id: 'new-id'` to MULTIBLOCK_ALIASES. Old data then loads with the
 * new id. When one is removed for good: list its id in REMOVED_MULTIBLOCK_IDS (templates show such groups
 * as placeholders, plans refuse to load). Then keep `multiblock-ids.snapshot.json` as it is: the test in
 * `multiblock-aliases.test.ts` compares it with the catalog. Add new ids to the snapshot, never drop old ones.
 * A live catalog id always wins over an alias of the same name. Aliases are one hop (no chains).
 */
export const MULTIBLOCK_ALIASES: Readonly<Record<string, string>> = Object.freeze({});

/** Ids that existed once and are gone without a replacement. */
export const REMOVED_MULTIBLOCK_IDS: readonly string[] = Object.freeze([]);

/** The current id for `id`: itself if it is live, else its alias, else unchanged. */
export function resolveMultiblockId(
  id: string,
  aliases: Readonly<Record<string, string>> = MULTIBLOCK_ALIASES,
): string {
  if (getSiteDef(id)) return id;
  return Object.hasOwn(aliases, id) ? aliases[id]! : id;
}
