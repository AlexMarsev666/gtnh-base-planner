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
