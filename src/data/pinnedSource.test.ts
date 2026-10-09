import { describe, expect, it } from 'vitest';

// Offline .mjs tools are tested without requiring a downloaded game checkout in CI.
import hashes from '../../tools/gt-source/rc2-source-hashes.json';
const { verifySourceHash } = await import(
  /* @vite-ignore */ new URL('../../tools/gt-source/pinned-source.mjs', import.meta.url).href
);

describe('RC2 source identity before rule extraction', () => {
  const source = 'class Example {}\n';
  const expected = { 'Example.java': '07175f0178d5390536a1ba6d3d0ef76909ee71eb1aeb81d525cca7f8b397e8cb' };

  it('accepts matching bytes and rejects another revision before parsing', () => {
    expect(verifySourceHash('Example.java', source, expected)).toBe(source);
    expect(() => verifySourceHash('Example.java', 'class Example { int newer; }\n', expected)).toThrow(
      /Source differs from GT5U RC2/,
    );
    expect(() => verifySourceHash('Other.java', source, expected)).toThrow(/source is not pinned/);
  });

  it('pins nested-controller owners, inherited structural checks and glass registration', () => {
    expect(hashes.commit).toBe('a3e1e11241a814c9fa0dd0973d5699548428f689');
    for (const path of [
      'src/main/java/bwcrossmod/galacticgreg/MTEVoidMiners.java',
      'src/main/java/gregtech/common/tileentities/machines/multi/MTEDrillerBase.java',
      'src/main/java/gregtech/api/metatileentity/implementations/MTEHatch.java',
      'src/main/java/gregtech/api/util/GlassTier.java',
      'src/main/java/bartworks/common/loaders/ItemRegistry.java',
      'src/main/java/gregtech/api/enums/MetaTileEntityIDs.java',
      'src/main/java/gregtech/loaders/preload/LoaderMetaTileEntities.java',
      'src/main/java/gregtech/api/metatileentity/implementations/MTEHatchDataAccess.java',
      'src/main/java/tectech/loader/thing/MachineLoader.java',
      'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchDataConnector.java',
      'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchDataItemsInput.java',
      'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchDataItemsOutput.java',
      'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchWirelessDataItemsInput.java',
      'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchWirelessDataItemsOutput.java',
      'src/main/java/tectech/thing/metaTileEntity/multi/base/TTMultiblockBase.java',
      'src/main/java/tectech/thing/metaTileEntity/multi/MTEDataBank.java',
      ...[
        'MTEHatchDataInput',
        'MTEHatchDataOutput',
        'MTEHatchWirelessComputationInput',
        'MTEHatchWirelessComputationOutput',
        'MTEHatchUncertainty',
        'MTEHatchRack',
      ].map((name) => `src/main/java/tectech/thing/metaTileEntity/hatch/${name}.java`),
      ...['MTEQuantumComputer', 'MTENetworkSwitch', 'MTENetworkSwitchAdv'].map(
        (name) => `src/main/java/tectech/thing/metaTileEntity/multi/${name}.java`,
      ),
      'src/main/java/gtnhintergalactic/tile/multi/TileEntityDysonSwarm.java',
    ])
      expect((hashes.files as Record<string, string>)[path]).toMatch(/^[0-9a-f]{64}$/);
  });
});
