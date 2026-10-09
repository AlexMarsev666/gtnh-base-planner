import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../../data/catalog';
import { buildGroup } from '../site/group';
import { sizedDef } from '../resize';
import { unitCells } from '../geometry';
import { minimumGlassTier, withStructureGlass } from './glass';
import evidence from '../../../tools/game-dump/catalog-results.rc2.json';

const { nativePlacement } = await import(
  /* @vite-ignore */ new URL('../../../tools/game-dump/native-cases.mjs', import.meta.url).href
);
const model = { getMultiblock, buildGroup, sizedDef, unitCells, withStructureGlass };
type Entry = { machine: string; status: string; placementSha256?: string; reason?: string };
const entries = new Map<string, Entry>(evidence.entries.map((entry) => [entry.machine, entry]));

describe('current placements match the bounded native catalog diagnostic', () => {
  it('accounts for every controller and retains the partial audit boundary', () => {
    expect(catalog).toHaveLength(244);
    expect(entries.size).toBe(244);
    expect(evidence.semanticAudit).toBe('partial');
    expect(evidence.formed + evidence.rejected + evidence.exceptions + evidence.unresolved).toBe(244);
  });
  for (const def of catalog)
    it(def.id, () => {
      const entry = entries.get(def.id)!;
      expect(entry).toBeDefined();
      let placement;
      let unresolved;
      try {
        placement = nativePlacement(
          model,
          def.id,
          {
            voltageTier: def.minimumVoltageTier ?? 'LV',
            structureGlassTier: minimumGlassTier(def),
          },
          def.resize?.default,
          {},
          true,
        );
        const unknown = [
          ...new Set<string>(
            placement.cells
              .map((c: { block?: string }) => c.block)
              .filter((b: string | undefined) => b && !b.includes('@')),
          ),
        ];
        if (unknown.length) throw new Error(`Native physical blocks not yet mapped: ${unknown.join(', ')}`);
      } catch (error) {
        unresolved = String(error);
      }
      if (unresolved) {
        expect(entry.status).toBe('unresolved');
        expect(entry.reason).toBe(unresolved);
      } else {
        expect(entry.status).not.toBe('unresolved');
        const cells = JSON.parse(JSON.stringify(placement.cells));
        const hash = createHash('sha256')
          .update(
            JSON.stringify({
              circuit: placement.circuit,
              controllerFacing: placement.controllerFacing,
              cells,
            }),
          )
          .digest('hex');
        expect(
          hash,
          'Catalog placement changed; rerun the diagnostic game pass without discarding failures.',
        ).toBe(entry.placementSha256);
      }
    });
});
