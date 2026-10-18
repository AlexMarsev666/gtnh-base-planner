import { describe, expect, it } from 'vitest';
import { glassLimits, kindOfList } from './glass-tier.mjs';

const chain = (body: string) => [{ name: 'MTETest', body }];

// Checks copied from GT5-Unofficial 5.09.54.205.
describe('glassLimits', () => {
  it('reads the loop over the energy hatches (Mega Oil Cracker)', () => {
    const r = glassLimits(
      chain(`
      private int glassTier = -1;
      ... .addElement('g', chainAllGlasses(-1, (te, t) -> te.glassTier = t, te -> te.glassTier))
      public void checkMachine(IGregTechTileEntity base, ItemStack stack, List<StructureError> errors) {
        if (this.glassTier < VoltageIndex.UV) {
            for (MTEHatch hatch : this.mExoticEnergyHatches) {
                if (hatch.getConnectionType() == MTEHatch.ConnectionType.LASER) {
                    errors.add(StructureErrors.glassTierNotEnough(VoltageIndex.UV));
                    return;
                }
            }
        }
        for (MTEHatch mEnergyHatch : this.getExoticAndNormalEnergyHatchList()) {
            if (this.glassTier < mEnergyHatch.getTierForStructure()) {
                errors.add(StructureErrorRegistry.ENERGY_TIER_EXCEED_GLASS);
                break;
            }
        }
      }`),
    );
    expect(r.kinds).toEqual(['energy']);
    // The fixed minimum for laser hatches is not modelled, but listed.
    expect(r.other).toEqual(['MTETest: glassTier < VoltageIndex.UV']);
  });

  it('reads the glass field from the chainAllGlasses setter', () => {
    const r = glassLimits(
      chain(`
      .addElement('A', chainAllGlasses(-1, (te, t) -> te.mGlass = t, te -> te.mGlass))
      for (MTEHatchDynamo d : mDynamoHatches) { if (d.mTier > mGlass) errors.add(x); }`),
    );
    expect(r.kinds).toEqual(['dynamo']);
  });

  it('reads the tier of the energy input (Algae Pond)', () => {
    const r = glassLimits(
      chain(`
      if (!mEnergyHatches.isEmpty()) {
          int inputTier = (int) getInputVoltageTier();
          if (glassTier < inputTier) { errors.add(StructureErrors.glassTierNotEnough(inputTier)); return; }
      }`),
    );
    expect(r).toEqual({ kinds: ['energy'], other: [] });
  });

  it('lists comparisons that gate something else and limits nothing for them', () => {
    const r = glassLimits(
      chain('if (glassTier < VoltageIndex.EV) errors.add(StructureErrors.glassTierNotEnough(EV));'),
    );
    expect(r.kinds).toEqual([]);
    expect(r.other).toHaveLength(1);
  });

  it('ignores a loop that does not compare with the glass', () => {
    const r = glassLimits(
      chain('for (MTEHatchEnergy h : mEnergyHatches) { total += h.getTierForStructure(); }'),
    );
    expect(r.kinds).toEqual([]);
  });
});

describe('kindOfList', () => {
  it('names the kind from the list', () => {
    expect(kindOfList('this.mEnergyHatches')).toBe('energy');
    expect(kindOfList('getExoticAndNormalEnergyHatchList()')).toBe('energy');
    expect(kindOfList('mDynamoHatches')).toBe('dynamo');
    expect(kindOfList('mInputHatches')).toBeNull();
  });
});
