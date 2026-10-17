import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HatchRules } from './hatch-rules.mjs';

const root = mkdtempSync(join(tmpdir(), 'hatch-rules-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function checks(sources: Record<string, string>, cls: string) {
  const dir = join(root, 'src/main/java/x');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(sources)) writeFileSync(join(dir, `${name}.java`), body);
  return new HatchRules(root).checksOf(`x.${cls}`);
}

// Shapes of MTEBeamMultiBase (maintenance checks off by default) and MTESourceChamber in 5.09.54.205.
const base = `package x;
public abstract class Base {
    public boolean getDefaultHasMaintenanceChecks() { return false; }
}`;

describe('HatchRules.checksOf maintenance', () => {
  it('reads no maintenance for a class with the checks off that never asks for a hatch', () => {
    const out = checks(
      {
        Base: base,
        Plain: `package x;
public class Plain extends Base {
    public void checkMachine(IGregTechTileEntity te, ItemStack s, List<StructureError> errors) {
        checkOneEnergyHatch(errors);
    }
}`,
      },
      'Plain',
    );
    expect(out.noMaintenance).toBe(true);
    expect(out.kinds.maintenance).toBeUndefined();
  });

  it('keeps an explicit maintenance check that checkMachine always runs', () => {
    const out = checks(
      {
        Base: base,
        Chamber: `package x;
public class Chamber extends Base {
    public void checkMachine(IGregTechTileEntity te, ItemStack s, List<StructureError> errors) {
        checkOneEnergyHatch(errors);
        checkOneMaintenanceHatch(errors);
    }
}`,
      },
      'Chamber',
    );
    expect(out.noMaintenance).toBe(false);
    expect(out.kinds.maintenance).toEqual({ min: 1, max: 1 });
  });

  it('keeps noMaintenance for a check wrapped in a condition that is not a plain true/false method', () => {
    const out = checks(
      {
        Base: base,
        Wrapped: `package x;
public class Wrapped extends Base {
    public void checkMachine(IGregTechTileEntity te, ItemStack s, List<StructureError> errors) {
        if (shouldCheckMaintenance()) {
            checkOneMaintenanceHatch(errors);
        }
    }
}`,
      },
      'Wrapped',
    );
    expect(out.noMaintenance).toBe(true);
    expect(out.kinds.maintenance).toBeUndefined();
  });

  it('reads checkHasMaintenanceHatch as a minimum of 1 with no maximum', () => {
    const out = checks(
      {
        Base: base,
        Reactor: `package x;
public class Reactor extends Base {
    public void checkMachine(IGregTechTileEntity te, ItemStack s, List<StructureError> errors) {
        checkHasMaintenanceHatch(errors);
    }
}`,
      },
      'Reactor',
    );
    // The maximum is not from the check (GT's checkHatchMin has none); build.mjs may add one from the tooltip.
    expect(out.kinds.maintenance).toEqual({ min: 1 });
    expect(out.noMaintenance).toBe(false);
  });
});

describe('HatchRules.checksOf hand-written list checks', () => {
  const machine = (body: string) =>
    checks(
      {
        Base: base,
        Swarm: `package x;
public class Swarm extends Base {
    public void checkMachine(IGregTechTileEntity te, ItemStack s, List<StructureError> errors) {
${body}
    }
}`,
      },
      'Swarm',
    );

  it('reads an empty-list error as a minimum for the first modelled list', () => {
    const out = machine(`
        if (mDynamoHatches.isEmpty() && eDynamoMulti.isEmpty()) {
            errors.add(StructureErrors.hatchCount(ErrorType.TOO_FEW, Dynamo, 0, 1));
        }`);
    expect(out.kinds.dynamo).toEqual({ min: 1 });
  });

  it('reads the size forms and the bare return', () => {
    const out = machine(`
        if (mInputBusses.size() < 2) return false;
        if (mOutputHatches.size() == 0) errors.add(MISSING);`);
    expect(out.kinds.itemIn).toEqual({ min: 2 });
    expect(out.kinds.fluidOut).toEqual({ min: 1 });
  });

  it('ignores a check on a config, an || and a list the planner has no kind for', () => {
    const out = machine(`
        if (mConfig && mDynamoHatches.isEmpty()) errors.add(X);
        if (mEnergyHatches.isEmpty() || mDynamoHatches.isEmpty()) errors.add(X);
        if (eInputData.isEmpty()) errors.add(MISSING_DATA_HATCH);`);
    expect(out.kinds).toEqual({});
  });
});
