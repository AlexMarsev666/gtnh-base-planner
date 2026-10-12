import { describe, expect, it } from 'vitest';
import { maxOf } from './data-access.mjs';

const chain = (body: string) => [{ name: 'MTETest', body }];

// MTEAssemblyLine, 5.09.54.205.
const AL = `
  public ArrayList<MTEHatchDataAccess> mDataAccessHatches = new ArrayList<>();
  private int checkMachine(boolean leftToRight, List<StructureError> errors) {
      if (mDataAccessHatches.size() > 1) {
          errors.add(StructureErrors.of("GT5U.gui.text.structure_error.al_too_many_data_access_hatch"));
      }
  }
  public boolean addDataAccessToMachineList(IGregTechTileEntity aTileEntity, int aBaseCasingIndex) {
      if (aTileEntity == null) return false;
      IMetaTileEntity aMetaTileEntity = aTileEntity.getMetaTileEntity();
      if (aMetaTileEntity instanceof MTEHatchDataAccess) {
          ((MTEHatch) aMetaTileEntity).updateTexture(aBaseCasingIndex);
          return mDataAccessHatches.add((MTEHatchDataAccess) aMetaTileEntity);
      }
      return false;
  }`;

describe('maxOf', () => {
  it('reads the size check of the list the data access adder fills', () => {
    expect(maxOf(chain(AL))).toBe(1);
    expect(maxOf(chain(AL.replace('size() > 1', 'size() >= 3')))).toBe(2);
  });

  it('is null without a check, and ignores other lists', () => {
    expect(maxOf(chain(AL.replace('mDataAccessHatches.size() > 1', 'true')))).toBeNull();
    expect(maxOf(chain(`${AL}\nif (mOutputBusses.size() > 7) {}`))).toBe(1);
  });
});
