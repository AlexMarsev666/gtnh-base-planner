# Legacy share fixtures

Frozen plan and site files, `#p=` / `#s=` link texts and their decoded states (`*.expected.json`), checked by
`../fixtures.test.ts`.

- They were generated from branch `cla` at 8d041ce (the share codecs there are identical to 44bf4cb), before the
  tier / mirror / wallshare / assign / routing fields existed.
- `*.expected.json` must never be regenerated from new output. If one of these tests fails, old saves and
  links now decode differently; that needs an explicit decision, not a refreshed snapshot.
- `missing.*` is a template whose group names a multiblock that no longer exists (replaced by a placeholder and
  reported). There is no fixture for a renamed (aliased) id: `MULTIBLOCK_ALIASES` is empty at that commit. Add
  one when the first alias is added.
- `oil-processing.*` is a real template (27 groups, transformers as plain single blocks with separate power
  resources) saved before those fields existed. Its `.json` is the user's file, unchanged. The expected state and
  the link were made once and checked to be identical to what the codec at 44bf4cb decodes and encodes. It is
  also built by `../../model/site/legacyBuild.test.ts` (all 101 terminals connected, groups not moved).
- `user-oil-1cracker.json`, `user-oil-2crackers.json` and `user-titanium.json` are the user's own templates,
  unchanged (27, 27 and 8 groups). They are not decoded snapshots: `../../model/site/footprint.test.ts` builds them
  and checks that a group's footprint is the same as saved and after Arrange (the oil crackers' footprint used to
  change with where the neighbours were, which stopped Optimize).
