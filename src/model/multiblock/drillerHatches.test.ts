import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { validateResourceHatches } from '../site/resourcePlacement';
import { countRules } from './rules';

// Independent literals from the RC2 checkHatches overrides called virtually by MTEDrillerBase.checkMachine.
describe('RC2 inherited driller hatch requirements', () => {
  for (const [id, kind, tier, energyMax] of [
    ['fluid-drilling-rig', 'fluidOut', 'MV', 1],
    ['fluid-drilling-rig-ii', 'fluidOut', 'HV', 1],
    ['fluid-drilling-rig-iii', 'fluidOut', 'EV', 1],
    ['fluid-drilling-rig-iv', 'fluidOut', 'IV', 1],
    ['infinite-fluid-drilling-rig', 'fluidOut', 'UHV', 1],
    ['ore-drilling-plant', 'fluidIn', 'MV', undefined],
    ['ore-drilling-plant-ii', 'fluidIn', 'HV', undefined],
    ['ore-drilling-plant-iii', 'fluidIn', 'EV', undefined],
    ['ore-drilling-plant-iv', 'fluidIn', 'IV', undefined],
    ['concrete-backfiller', 'fluidIn', 'MV', 1],
    ['advanced-concrete-backfiller', 'fluidIn', 'EV', 1],
    ['deep-earth-heating-pump', 'fluidIn', 'HV', undefined],
    ['void-miner-i', 'itemOut', 'LuV', undefined],
    ['void-miner-ii', 'itemOut', 'ZPM', undefined],
    ['void-miners', 'itemOut', 'UV', undefined],
  ] as const) {
    it(`${id}: enables mandatory ${kind} and uses ${tier} for a new plan`, () => {
      const def = getMultiblock(id)!;
      expect(def.requiredHatches?.[kind]?.min).toBe(1);
      expect(def.requiredHatches?.energy?.max).toBe(energyMax);
      expect(countRules(id).some((r) => r.kind === kind && r.min === 1)).toBe(true);
      const plan = { ...defaultPlan(id), count: 1 };
      expect(plan.voltageTier).toBe(tier);
      expect(plan.enabledHatches).toContain(kind);
      const built = createPipeline()(plan, false);
      expect(built.error).toBeNull();
      const missing = built.hatches!.hatches.filter((h) => h.kind !== kind);
      expect(
        validateResourceHatches(def, built.pack!.units, missing).some((e) => e.includes(`${kind} count 0`)),
      ).toBe(true);
      if (id.startsWith('ore-drilling-plant')) expect(def.requiredHatches?.itemOut?.min).toBe(1);
      if (id === 'deep-earth-heating-pump') expect(def.requiredHatches?.fluidOut?.min).toBe(1);
    });
  }
});
