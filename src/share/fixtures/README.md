# Historical document fixtures

The JSON structures are reconstructed from the released validators, rather than speculative formats:

- `plan-initial-v1.json`: `9352ce4`, `src/share/codec.ts` and `persist.ts` (manual unit IDs and rotations).
- `site-initial-v1.json`: `e4505a1`, `src/share/siteCodec.ts`, plus resizable height from `58e21d0`.

The exporter history uses version 1 throughout. Later additions remain optional in version 1:
icons (`5bc7684`), elevation and machine appearance (`a22534f`), locked limits (`b4596c9`).
`site-features-v1.json` exercises those optional fields together; `plan-resizable-v1.json`
exercises the height field and a non-sequential manual unit ID.
No released unversioned own-document format was found. Such JSON is not guessed.
GTNH Planner exports are a different format, covered by the importer's existing fixtures and tests.
