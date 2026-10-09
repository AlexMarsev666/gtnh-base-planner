/** Actual planner placements and independent positive/negative native scenarios. */
// Physical aliases from MTEOilCracker/MTEDistillationTower and BlockCasings5 at the pinned RC2 source.
// This conversion is only for the game test world; saved planner block IDs remain unchanged.
const nativeBlock = (id) =>
  ({
    'gt.casing.cleanStainless': 'gregtech:gt.blockcasings4@1',
    'gt.coil.cupronickel': 'gregtech:gt.blockcasings5@0',
    'gt.casing.solidSteel': 'gregtech:gt.blockcasings2@0',
    'gt.casing.assemblyLine': 'gregtech:gt.blockcasings2@5',
    'gt.casing.grate': 'gregtech:gt.blockcasings3@10',
    'gt.casing.assembler': 'gregtech:gt.blockcasings2@9',
    'gt.glass.reinforced': 'gregtech:gt.blockglass1@10',
    // Casings enum at the pinned RC2 source. This map affects only the independent test world.
    'gt.casing.heatProof': 'gregtech:gt.blockcasings@11',
    'gt.casing.frostProof': 'gregtech:gt.blockcasings2@1',
    'gt.casing.chemicallyInert': 'gregtech:gt.blockcasings8@0',
    'gt.casing.ptfePipe': 'gregtech:gt.blockcasings8@1',
    'gt.casing.firebricks': 'gregtech:gt.blockcasings4@15',
    'gt.casing.itemPipeTin': 'gregtech:gt.blockcasings11@0',
    'gt.casing.steelPipe': 'gregtech:gt.blockcasings2@13',
    'gt.casing.stableTitanium': 'gregtech:gt.blockcasings4@2',
    'gt.casing.titaniumPipe': 'gregtech:gt.blockcasings2@14',
  })[id] ?? id;

export function nativePlacement(
  { getMultiblock, buildGroup, sizedDef, unitCells, withStructureGlass },
  id,
  settings,
  height,
  demand = {},
  allowIncomplete = false,
  extraHatches = [],
  selectedHatches,
) {
  let def = getMultiblock(id);
  if (!def) throw new Error(`Unknown controller ${id}`);
  if (def.resize) def = sizedDef(def, height);
  def = withStructureGlass(def, settings.structureGlassTier);
  const enabled = [...new Set([...(selectedHatches ?? def.defaultHatches), ...extraHatches])];
  const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, demand, true, {}, settings);
  if ((!allowIncomplete && (built.unplaced.length || built.missing.length)) || built.units.length !== 1)
    throw new Error(`Incomplete placement for ${id}`);
  const cells = unitCells(built.def, built.units[0]);
  const origin = cells.find((c) => c.role === 'controller').pos;
  const relative = (pos) => pos.map((p, i) => p - origin[i]);
  const hatches = new Map(built.hatches.map((h) => [h.cell.join(','), h]));
  return {
    machine: id,
    source: def.source,
    circuit: settings.manualTransformerMode === 'down' ? 1 : 0,
    ...(settings.dataBankWireless === undefined ? {} : { dataBankWireless: settings.dataBankWireless }),
    controllerFacing: ['north', 'east', 'south', 'west'][
      (['north', 'east', 'south', 'west'].indexOf(built.def.controller.facing) + built.units[0].rotation) % 4
    ],
    expectedStructure: true,
    cells: cells.map((c) => {
      const h = hatches.get(c.pos.join(','));
      if (!h)
        return {
          pos: relative(c.pos),
          block: nativeBlock(c.blockId ?? 'minecraft:air@0'),
          ...(c.facing ? { face: c.facing } : {}),
        };
      const region = built.def.legend[c.char]?.region;
      const regions = built.def.fluidOutputRegions ?? built.def.requiredHatches?.fluidOut?.regions;
      const outputSlot = h.kind === 'fluidOut' ? regions?.indexOf(region) : undefined;
      return {
        pos: relative(c.pos),
        hatch: h.kind,
        tier: h.tier,
        face: h.face,
        resource: h.resource,
        outputSlot: outputSlot >= 0 ? outputSlot : undefined,
        replaces: nativeBlock(c.blockId),
      };
    }),
  };
}

export function nativeCases(model) {
  const cases = [];
  const placement = (...args) => nativePlacement(model, ...args);
  const add = (name, test, patch = {}) => {
    const entry = structuredClone({ ...test, ...patch, name });
    cases.push(entry);
    return entry;
  };
  const bricked = placement('bricked-blast-furnace', { voltageTier: 'LV' });
  {
    const inputKinds = ['computationIn', 'wirelessComputationIn'];
    const outputKinds = ['computationOut', 'wirelessComputationOut'];
    const revert = (cell) => {
      const { pos, replaces } = cell;
      Object.keys(cell).forEach((k) => delete cell[k]);
      Object.assign(cell, { pos, block: replaces });
    };
    const rotate = (test, turn) => {
      test.controllerFacing = ['north', 'east', 'south', 'west'][turn];
      for (const c of test.cells) {
        const [x, y, z] = c.pos;
        c.pos = turn === 0 ? [x, y, z] : turn === 1 ? [-z, y, x] : turn === 2 ? [-x, y, -z] : [z, y, -x];
        const index = ['north', 'east', 'south', 'west'].indexOf(c.face);
        if (index >= 0) c.face = ['north', 'east', 'south', 'west'][(index + turn) % 4];
      }
    };
    for (const id of [
      'dyson-swarm',
      'quantum-computer',
      'weighted-network-switch-with-qos',
      'static-network-switch-with-qos',
    ]) {
      const def = model.sizedDef(model.getMultiblock(id), undefined);
      const good = placement(id, { voltageTier: 'LV' });
      const shape = model
        .unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 })
        .map((c) => ({ ...c, pos: c.pos.map((p, i) => p - def.controller.pos[i]) }));
      const move = (test, kind, pos) => {
        const hatch = test.cells.find((c) => c.hatch === kind);
        const target = test.cells.find((c) => c.pos.join() === pos.join());
        if (target === hatch) return;
        if (target.hatch) {
          const allowed = shape.filter((c) => def.legend[c.char]?.hatches?.includes(target.hatch));
          const free = test.cells.find(
            (c) =>
              c.block && c.pos.join() !== pos.join() && allowed.some((s) => s.pos.join() === c.pos.join()),
          );
          if (!free) throw new Error(`No spare ${target.hatch} cell in ${id}`);
          [target.pos, free.pos] = [free.pos, target.pos];
        }
        const empty = test.cells.find((c) => c.pos.join() === pos.join());
        [empty.pos, hatch.pos] = [hatch.pos, empty.pos];
        // The source casing at the target, rather than its old region, is what this hatch replaces.
        const oldCasing = hatch.replaces;
        hatch.replaces = empty.block;
        empty.block = oldCasing;
      };
      add(`${id}-computational-default`, good);
      for (const input of id === 'quantum-computer' ? [undefined, ...inputKinds] : inputKinds)
        for (const output of id === 'dyson-swarm' ? [undefined] : outputKinds) {
          const selected = def.defaultHatches.filter(
            (k) => !inputKinds.includes(k) && !outputKinds.includes(k),
          );
          if (input) selected.push(input);
          if (output) selected.push(output);
          const test = placement(id, { voltageTier: 'LV' }, undefined, {}, false, [], selected);
          add(`${id}-computation-${input ?? 'none'}-${output ?? 'none'}`, test, {
            expectedHatchCounts: {
              eInputData: input ? 1 : 0,
              ...(output ? { eOutputData: 1 } : {}),
              ...(id === 'quantum-computer' ? { eWirelessComputationOutputs: 0 } : {}),
            },
          });
        }
      for (const kind of good.cells.filter((c) => c.hatch).map((c) => c.hatch)) {
        if (kind !== 'computerRack') {
          const test = add(`${id}-computation-missing-${kind}`, good, { expectedStructure: false });
          revert(test.cells.find((c) => c.hatch === kind));
        }
      }
      const services = good.cells
        .filter(
          (c) =>
            c.hatch &&
            (inputKinds.includes(c.hatch) ||
              outputKinds.includes(c.hatch) ||
              ['computerRack', 'uncertainty'].includes(c.hatch)),
        )
        .map((c) => c.hatch);
      for (const kind of services) {
        const alternatives =
          kind === 'computationIn' ? inputKinds : kind === 'computationOut' ? outputKinds : [kind];
        for (const concrete of alternatives) {
          for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
            const test = add(`${id}-${concrete}-face-${face}`, good);
            const cell = test.cells.find((c) => c.hatch === kind);
            cell.hatch = concrete;
            cell.face = face;
            test.expectedBlockFacings = { [cell.pos.join()]: face };
          }
          const allowed = shape.filter((c) => def.legend[c.char]?.hatches?.includes(kind));
          for (const cell of allowed) {
            const test = add(`${id}-${concrete}-cell-${cell.pos.join()}`, good);
            move(test, kind, cell.pos);
            test.cells.find((c) => c.hatch === kind).hatch = concrete;
          }
          for (const char of [...new Set(shape.map((c) => c.char))].filter(
            (c) => !['~', '-', ' '].includes(c) && !def.legend[c]?.hatches?.includes(kind),
          )) {
            const target = shape.find(
              (c) => c.char === char && good.cells.find((s) => s.pos.join() === c.pos.join())?.block,
            );
            if (!target) continue;
            const test = add(`${id}-${concrete}-forbidden-${char}`, good, { expectedStructure: false });
            move(test, kind, target.pos);
            test.cells.find((c) => c.hatch === kind).hatch = concrete;
          }
        }
      }
      if (id === 'quantum-computer') {
        for (const tier of ['IV', 'ZPM']) {
          const test = add(`quantum-computer-uncertainty-${tier}`, good, {
            expectedHatchCounts: { eUncertainHatches: 1, eRacks: 1 },
          });
          test.cells.find((c) => c.hatch === 'uncertainty').tier = tier;
        }
        const extra = add('quantum-computer-two-uncertainty-resolvers', good, {
          expectedHatchCounts: { eUncertainHatches: 2 },
        });
        const free = extra.cells.find(
          (c) =>
            c.block === 'tectech:gt.blockcasingsTT@1' &&
            shape.find((s) => s.pos.join() === c.pos.join())?.char === 'A',
        );
        Object.assign(free, {
          hatch: 'uncertainty',
          tier: 'ZPM',
          face: 'north',
          replaces: free.block,
          block: undefined,
        });
        const noRack = add('quantum-computer-no-racks-required', good, {
          expectedHatchCounts: { eRacks: 0 },
        });
        revert(noRack.cells.find((c) => c.hatch === 'computerRack'));
      }
      if (def.resize) {
        for (let size = def.resize.min; size <= def.resize.max; size++) {
          const selected = def.defaultHatches.filter(
            (k) => id !== 'quantum-computer' || size > 4 || k !== 'computerRack',
          );
          const test = placement(id, { voltageTier: 'LV' }, size, {}, false, [], selected);
          for (let turn = 0; turn < 4; turn++) {
            const rotated = add(`${id}-length-${size}-turn-${turn}`, test, {
              expectedControllerFields:
                id === 'quantum-computer'
                  ? { eCertainMode: Math.min(Math.floor((size + 1) / 3), 5) }
                  : { length: size - 2 },
            });
            rotate(rotated, turn);
          }
        }
        const largest = placement(id, { voltageTier: 'LV' }, def.resize.max);
        const over = add(`${id}-too-long`, largest, { expectedStructure: false });
        const index = id === 'quantum-computer' ? 2 : 1;
        const slice = structuredClone(over.cells.filter((c) => c.pos[2] === index));
        for (const cell of over.cells) if (cell.pos[2] >= index) cell.pos[2]++;
        over.cells.push(...slice);
      }
    }
  }
  {
    const good = placement('industrial-arc-furnace', { voltageTier: 'LV' }, undefined, {
      electrodeIn: ['operating'],
    });
    const revert = (c) => {
      const { pos, replaces } = c;
      Object.keys(c).forEach((k) => delete c[k]);
      Object.assign(c, { pos, block: replaces });
    };
    const electrode = good.cells.find((c) => c.hatch === 'electrodeIn');
    const steel = good.cells
      .filter((c) => (c.block ?? c.replaces) === 'gregtech:gt.blockcasings2@0')
      .sort((a, b) => a.pos[2] - b.pos[2] || b.pos[1] - a.pos[1] || b.pos[0] - a.pos[0]);
    for (const face of ['north', 'east', 'south', 'west']) {
      const rotation = ['north', 'east', 'south', 'west'].indexOf(face);
      const rotated = add(`industrial-arc-furnace-${face}`, good, {
        controllerFacing: face,
        expectedHatchFields: { electrodeHatch: 'operating' },
        expectedHatchCounts: { electrodeHatch: 1, mInputBusses: 1 },
      });
      for (const cell of rotated.cells) {
        const [x, y, z] = cell.pos;
        cell.pos =
          rotation === 0
            ? [x, y, z]
            : rotation === 1
              ? [-z, y, x]
              : rotation === 2
                ? [-x, y, -z]
                : [z, y, -x];
        if (cell.face && ['north', 'east', 'south', 'west'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (rotation + ['north', 'east', 'south', 'west'].indexOf(cell.face)) % 4
          ];
      }
    }
    for (const target of steel) {
      const test = add(`industrial-arc-furnace-electrode-cell-${target.pos.join(',')}`, good, {
        expectedHatchFields: { electrodeHatch: 'operating' },
      });
      const current = test.cells.find((c) => c.hatch === 'electrodeIn');
      const other = test.cells.find((c) => c.pos.join() === target.pos.join());
      const position = current.pos;
      current.pos = other.pos;
      other.pos = position;
    }
    // Adjacent pairs cover the complete source order, including transitions between axes.
    for (let i = 1; i < steel.length; i++) {
      const test = add(`industrial-arc-furnace-electrode-order-${i}`, good, {
        expectedHatchFields: { electrodeHatch: 'first' },
        expectedHatchCounts: { electrodeHatch: 1, mInputBusses: 2 },
      });
      const positions = [steel[i - 1].pos, steel[i].pos];
      for (const cell of test.cells.filter((c) => c.hatch === 'electrodeIn')) revert(cell);
      for (const [n, pos] of positions.entries()) {
        const cell = test.cells.find((c) => c.pos.join() === pos.join());
        if (cell.hatch) {
          const free = test.cells.find(
            (c) =>
              c.block === 'gregtech:gt.blockcasings2@0' && !positions.some((p) => p.join() === c.pos.join()),
          );
          const spare = free.pos;
          free.pos = cell.pos;
          cell.pos = spare;
        }
        const target = test.cells.find((c) => c.pos.join() === pos.join());
        Object.assign(target, {
          block: undefined,
          hatch: n === 0 ? 'electrodeIn' : 'electrodeBus',
          face: 'north',
          resource: n === 0 ? 'first' : 'later',
          replaces: 'gregtech:gt.blockcasings2@0',
        });
      }
    }
    for (const kind of ['electrodeIn', 'energy', 'maintenance', 'itemIn', 'itemOut']) {
      const test = add(`industrial-arc-furnace-missing-${kind}`, good, { expectedStructure: false });
      revert(test.cells.find((c) => c.hatch === kind));
    }
    for (const kind of ['electrodeIn', 'electrodeBus', 'electrodeDetector'])
      for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
        const test = add(
          `industrial-arc-furnace-${kind}-face-${face}`,
          kind === 'electrodeIn'
            ? good
            : placement(
                'industrial-arc-furnace',
                { voltageTier: 'LV' },
                undefined,
                { electrodeIn: ['operating'] },
                false,
                [kind],
              ),
        );
        test.cells.find((c) => c.hatch === kind).face = face;
      }
    const extras = placement(
      'industrial-arc-furnace',
      { voltageTier: 'LV' },
      undefined,
      { electrodeIn: ['operating'], electrodeBus: ['reserve1', 'reserve2'] },
      false,
      ['electrodeDetector'],
    );
    add('industrial-arc-furnace-extra-electrode-buses', extras, {
      expectedHatchFields: { electrodeHatch: 'operating' },
      expectedHatchCounts: { electrodeHatch: 1, mInputBusses: 3, electrodeDetectorHatch: 1 },
    });
    const only = add('industrial-arc-furnace-second-electrode-satisfies-input', extras, {
      expectedHatchCounts: { electrodeHatch: 1, mInputBusses: 2 },
    });
    revert(only.cells.find((c) => c.hatch === 'itemIn'));
    for (const amount of [9, 10]) {
      const test = add(`industrial-arc-furnace-${amount}-steel-casings`, good, {
        expectedStructure: amount === 10,
        expectedControllerFields: { mCasing: amount },
      });
      for (const cell of test.cells.filter((c) => c.block === 'gregtech:gt.blockcasings2@0').slice(amount))
        Object.assign(cell, { block: undefined, hatch: 'electrodeDetector', face: 'north' });
    }
    for (const kind of ['itemIn', 'itemOut']) {
      const test = add(`industrial-arc-furnace-fluid-${kind}`, good);
      test.cells.find((c) => c.hatch === kind).hatch = kind === 'itemIn' ? 'fluidIn' : 'fluidOut';
    }
    const uniform = add('industrial-arc-furnace-uniform-kanthal', good);
    uniform.cells
      .filter((c) => c.block === 'gregtech:gt.blockcasings5@0')
      .forEach((c) => (c.block = 'gregtech:gt.blockcasings5@1'));
    const mixed = add('industrial-arc-furnace-mixed-coils', good, { expectedStructure: false });
    mixed.cells.find((c) => c.block === 'gregtech:gt.blockcasings5@0').block = 'gregtech:gt.blockcasings5@1';
    const absent = add('industrial-arc-furnace-missing-coil', good, { expectedStructure: false });
    absent.cells.find((c) => c.block === 'gregtech:gt.blockcasings5@0').block = 'minecraft:air@0';
    const durability = [200, 500, 400, 1000, 1600, 900, 900, 1500, 1200, 2000, 2500, 1750, 3500, 5000];
    for (let meta = 0; meta < durability.length; meta++) {
      const test = add(`industrial-arc-furnace-electrode-item-${meta}`, extras, {
        expectedElectrode: {
          gameId: `kubatech:arc_furnace_electrode@${meta}`,
          slotAccepts: true,
          recognizedMeta: meta,
          operatingMeta: meta,
          remainingDurability: durability[meta] - 7,
          maxStack: 1,
          inventorySize: 1,
          detectorRemaining: durability[meta] - 7,
          detectorMaximum: durability[meta],
        },
      });
      Object.assign(
        test.cells.find((c) => c.hatch === 'electrodeIn'),
        { fillItem: `kubatech:arc_furnace_electrode@${meta}`, usedDurability: 7 },
      );
    }
    for (const [id, slotAccepts, maxStack] of [
      ['minecraft:stone@0', false, 64],
      ['kubatech:arc_furnace_electrode@14', true, 1],
    ]) {
      const test = add(`industrial-arc-furnace-invalid-electrode-${id}`, good, {
        expectedElectrode: {
          gameId: id,
          slotAccepts,
          recognizedMeta: -1,
          operatingMeta: -1,
          remainingDurability: 0,
          maxStack,
          inventorySize: 1,
        },
      });
      test.cells.find((c) => c.hatch === 'electrodeIn').fillItem = id;
    }
  }
  for (const frame of ['bronze', 'steel']) {
    const good = placement('water-pump', { voltageTier: 'LV', steamFrameTier: frame }, undefined, {
      steamIn: ['steam'],
      fluidOut: ['water'],
    });
    const fields = { mSetTier: frame === 'bronze' ? 1 : 2, mCountCasing: 9 };
    const filledSpace = add(`water-pump-${frame}-skipped-interior`, good);
    filledSpace.cells.push({ pos: [0, 1, 1], block: 'minecraft:stone@0' });
    const invalidFrame = add(`water-pump-${frame}-unsupported-frame`, good, { expectedStructure: false });
    invalidFrame.cells.find(
      (c) => c.block === `gregtech:gt.blockframes@${frame === 'bronze' ? 300 : 305}`,
    ).block = 'gregtech:gt.blockframes@304';
    const fullOutput = add(`water-pump-${frame}-full-output`, good, {
      expectedProcessing: false,
      processingEnvironment: { humidity: 0.4, dimension: 'Overworld' },
      expectedFluidProcessing: {
        result: 'fluid_output_full',
        duration: 0,
        filled: { steam: 1500, water: 16000 },
        remaining: { steam: 1500, water: 16000 },
        outputs: [],
      },
    });
    Object.assign(
      fullOutput.cells.find((c) => c.hatch === 'steamIn'),
      { fillFluid: 'steam', fillAmount: 1500 },
    );
    Object.assign(
      fullOutput.cells.find((c) => c.hatch === 'fluidOut'),
      { fillFluid: 'water', fillAmount: 16000 },
    );
    for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
      const rotated = add(`water-pump-${frame}-${face}`, good, {
        controllerFacing: face,
        expectedControllerFields: fields,
        expectedHatchFields: { mSteamInputFluids: 'steam', mOutputHatches: 'water' },
      });
      for (const cell of rotated.cells) {
        for (let n = 0; n < turn; n++) {
          const [x, y, z] = cell.pos;
          cell.pos = [-z, y, x];
        }
        if (cell.face && !['up', 'down'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
          ];
      }
    }
    for (const kind of ['steamIn', 'fluidOut']) {
      const missing = add(`water-pump-${frame}-missing-${kind}`, good, { expectedStructure: false });
      const cell = missing.cells.find((c) => c.hatch === kind);
      Object.assign(cell, { hatch: undefined, block: cell.replaces });
      const extra = add(`water-pump-${frame}-extra-${kind}-eight-casings`, good, {
        expectedStructure: false,
      });
      Object.assign(
        extra.cells.find((c) => c.block === 'gregtech:gt.blockcasings9@2'),
        { block: undefined, hatch: kind, tier: 'LV', face: 'north' },
      );
      for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
        const faced = add(`water-pump-${frame}-${kind}-${face}`, good, { expectedControllerFields: fields });
        faced.cells.find((c) => c.hatch === kind).face = face;
      }
    }
    const normal = add(`water-pump-${frame}-ordinary-steam-input-rejected`, good, {
      expectedStructure: false,
    });
    Object.assign(
      normal.cells.find((c) => c.hatch === 'steamIn'),
      { hatch: 'fluidIn', tier: 'LV' },
    );
    const mixed = add(`water-pump-${frame}-mixed-frames`, good, { expectedStructure: false });
    mixed.cells.find((c) => c.block === `gregtech:gt.blockframes@${frame === 'bronze' ? 300 : 305}`).block =
      `gregtech:gt.blockframes@${frame === 'bronze' ? 305 : 300}`;
    for (const [label, input, amount, success] of [
      ['exact', 'steam', 1500, true],
      ['surplus', 'steam', 2000, true],
      ['insufficient', 'steam', 1499, false],
      ['wrong-fluid', 'water', 2000, false],
    ]) {
      const filled = input === 'steam' ? amount : 0;
      const processing = add(`water-pump-${frame}-processing-${label}`, good, {
        expectedProcessing: success,
        processingEnvironment: { humidity: 0.4, dimension: 'Overworld' },
        expectedFluidProcessing: {
          result: success ? 'success' : 'no_recipe',
          duration: success ? 20 : 0,
          filled: { steam: filled },
          remaining: { steam: filled - (success ? 1500 : 0) },
          outputs: success ? [{ fluid: 'water', amount: frame === 'bronze' ? 600 : 1200 }] : [],
        },
      });
      Object.assign(
        processing.cells.find((c) => c.hatch === 'steamIn'),
        { fillFluid: input, fillAmount: amount },
      );
    }
    for (const dimension of ['Overworld', 'Venus', 'Mercury', 'Mars', 'Moon', 'Nether']) {
      const processing = add(`water-pump-${frame}-dry-${dimension}`, good, {
        expectedProcessing: dimension === 'Overworld',
        processingEnvironment: { humidity: 0, dimension },
        expectedFluidProcessing: {
          result: dimension === 'Overworld' ? 'success' : 'fluid_output_full',
          duration: dimension === 'Overworld' ? 20 : 0,
          filled: { steam: 1500 },
          remaining: { steam: dimension === 'Overworld' ? 0 : 1500 },
          outputs: dimension === 'Overworld' ? [{ fluid: 'water', amount: 250 }] : [],
        },
      });
      Object.assign(
        processing.cells.find((c) => c.hatch === 'steamIn'),
        { fillFluid: 'steam', fillAmount: 1500 },
      );
    }
  }
  for (const growth of ['left', 'right'])
    for (let length = 2; length <= 7; length++) {
      const good = placement(
        'circuit-assembly-line',
        { voltageTier: 'LV', structureGlassTier: 'EV', assemblyGrowth: growth },
        length,
      );
      for (const [turn, face] of ['north', 'east', 'south', 'west'].entries())
        for (const tier of ['EV', 'HV']) {
          const candidate = add(`circuit-line-${growth}-${length}-${face}-${tier}`, good, {
            controllerFacing: face,
            expectedStructure: tier === 'EV' || growth === 'right',
          });
          for (const cell of candidate.cells) {
            let [x, y, z] = cell.pos;
            for (let i = 0; i < turn; i++) [x, z] = [-z, x];
            cell.pos = [x, y, z];
            if (cell.face && cell.face !== 'up' && cell.face !== 'down')
              cell.face = ['north', 'east', 'south', 'west'][
                (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
              ];
            if (cell.block === 'bartworks:BW_TieredGlass@1' && tier === 'HV')
              cell.block = 'bartworks:BW_TieredGlass@0';
          }
        }
      for (const kind of ['energy', 'maintenance', 'itemIn', 'itemOut']) {
        const bad = add(`circuit-line-${growth}-${length}-missing-${kind}`, good, {
          expectedStructure: false,
        });
        bad.cells = bad.cells.filter((c) => c.hatch !== kind);
      }
      const extra = add(`circuit-line-${growth}-${length}-extra-energy`, good, { expectedStructure: false });
      Object.assign(
        extra.cells.find((c) => c.block === 'gregtech:gt.blockcasings3@10'),
        { hatch: 'energy', tier: 'LV', face: 'up' },
      );
    }
  const circuit = placement(
    'circuit-assembly-line',
    { voltageTier: 'LV', structureGlassTier: 'EV' },
    3,
    {},
    false,
    [],
    ['energy', 'maintenance', 'itemIn', 'itemOut', 'fluidIn'],
  );
  for (const kind of ['itemIn', 'itemOut', 'fluidIn', 'maintenance', 'energy'])
    for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
      // HatchElementBuilder's side preferences affect survival placement, not its check callback.
      const c = add(`circuit-line-${kind}-face-${face}`, circuit);
      c.cells.find((cell) => cell.hatch === kind).face = face;
    }
  const dataInputs = ['dataAccess', 'assemblyDataIn', 'wirelessAssemblyDataIn'];
  const dataOutputs = ['assemblyDataOut', 'wirelessAssemblyDataOut'];
  for (const input of dataInputs)
    for (const loaded of [false, true])
      for (const wireless of [false, true]) {
        const good = placement(
          'data-bank',
          { voltageTier: 'LuV', dataBankWireless: wireless },
          undefined,
          {},
          false,
          [],
          ['energy', 'maintenance', input, ...dataOutputs],
        );
        for (const cell of good.cells)
          if ([input, ...dataOutputs].includes(cell.hatch)) cell.resource = cell.hatch;
        good.expectedProcessing = true;
        good.expectedControllerFields = { wirelessModeEnabled: wireless, slave: input === 'assemblyDataIn' };
        good.checkRecipeData = {
          loaded,
          expected: {
            readRecipes: loaded ? 1 : 0,
            wiredPackets: loaded ? 1 : 0,
            wirelessPackets: loaded && wireless ? 1 : 0,
            sameRecipes: true,
            wiredReceived: loaded ? 1 : 0,
            wiredReceiverMatches: true,
            wirelessUploaded: loaded && wireless ? 1 : 0,
            wirelessReceived: loaded && wireless ? 1 : 0,
            wirelessReceiverMatches: true,
          },
        };
        add(
          `data-bank-recipe-${input}-${loaded ? 'loaded' : 'empty'}-wireless-${wireless ? 'on' : 'off'}`,
          good,
        );
        if (input === 'dataAccess' && loaded && wireless)
          for (const fault of ['wrongColor', 'wrongFace', 'wrongOwner']) {
            const bad = add(`data-bank-recipe-${fault}`, good);
            bad.checkRecipeData[fault] = true;
            bad.checkRecipeData.expected[fault === 'wrongOwner' ? 'wirelessReceived' : 'wiredReceived'] = 0;
          }
      }
  for (const input of dataInputs)
    for (const output of dataOutputs) {
      const good = placement(
        'data-bank',
        { voltageTier: 'EV' },
        undefined,
        {},
        false,
        [],
        ['energy', 'maintenance', input, output],
      );
      good.cells.find((c) => c.hatch === input).resource = 'data-in';
      good.cells.find((c) => c.hatch === output).resource = 'data-out';
      good.expectedProcessing = true;
      good.expectedControllerFields = {
        slave: input === 'assemblyDataIn',
        mEUt: input === 'assemblyDataIn' ? -32768 : -2048,
        lEUt: input === 'assemblyDataIn' ? -32768 : -2048,
        mMaxProgresstime: 20,
      };
      good.expectedHatchFields = {
        eDataAccessHatches: 'data-in',
        [output === 'assemblyDataOut' ? 'eStacksDataOutputs' : 'eWirelessStacksDataOutputs']: 'data-out',
      };
      for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
        const rotated = add(`data-bank-${input}-${output}-${face}`, good, { controllerFacing: face });
        for (const cell of rotated.cells) {
          for (let n = 0; n < turn; n++) {
            const [x, y, z] = cell.pos;
            cell.pos = [-z, y, x];
          }
          if (cell.face && !['up', 'down'].includes(cell.face))
            cell.face = ['north', 'east', 'south', 'west'][
              (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
            ];
        }
      }
      for (const missingKind of [input, output, 'energy', 'maintenance']) {
        const bad = add(`data-bank-${input}-${output}-missing-${missingKind}`, good, {
          expectedStructure: false,
        });
        delete bad.expectedProcessing;
        delete bad.expectedControllerFields;
        delete bad.expectedHatchFields;
        const cell = bad.cells.find((c) => c.hatch === missingKind);
        bad.cells[bad.cells.indexOf(cell)] = { pos: cell.pos, block: cell.replaces };
      }
      const badCore = add(`data-bank-${input}-${output}-forbidden-core`, good, { expectedStructure: false });
      delete badCore.expectedProcessing;
      delete badCore.expectedControllerFields;
      delete badCore.expectedHatchFields;
      const core = badCore.cells.find((c) => c.pos.join() === '0,0,1');
      const data = badCore.cells.find((c) => c.hatch === input);
      badCore.cells[badCore.cells.indexOf(data)] = { pos: data.pos, block: data.replaces };
      Object.assign(core, { hatch: input, face: 'up', tier: data.tier });
      delete core.block;
    }
  for (const id of ['assembly-line', 'advanced-assembly-line'])
    for (const input of dataInputs.slice(1)) {
      const good = placement(id, { voltageTier: 'LV' }, 5, {}, false, [input]);
      for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
        const allFaces = add(`${id}-${input}-${face}`, good);
        allFaces.cells.find((c) => c.hatch === input).face = face;
      }
      for (const forbidden of ['first', 'excess', 'mixed']) {
        const bad = add(`${id}-${input}-${forbidden}`, good, { expectedStructure: false });
        const data = bad.cells.find((c) => c.hatch === input);
        if (forbidden === 'first') {
          bad.cells[bad.cells.indexOf(data)] = { pos: data.pos, block: data.replaces };
          const first = bad.cells.find((c) => c.pos.join() === '0,0,2');
          Object.assign(first, { hatch: input, face: 'south' });
          delete first.block;
        } else {
          const cell = bad.cells.find((c) => c.block === 'gregtech:gt.blockcasings3@10' && c.pos[0] !== 0);
          Object.assign(cell, {
            hatch: forbidden === 'mixed' ? 'dataAccess' : input,
            tier: forbidden === 'mixed' ? 'EV' : undefined,
            face: 'north',
          });
          delete cell.block;
        }
      }
    }
  let longestLinac;
  for (const length of [17, 19, 83, 85, 135]) {
    const good = placement('linear-accelerator', { voltageTier: 'LV', structureGlassTier: 'LuV' }, length);
    if (length === 135) longestLinac = good;
    for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
      const rotated = add(`linear-accelerator-${length}-${face}`, good, { controllerFacing: face });
      for (const cell of rotated.cells) {
        for (let n = 0; n < turn; n++) {
          const [x, y, z] = cell.pos;
          cell.pos = [-z, y, x];
        }
        if (cell.face && !['up', 'down'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
          ];
      }
    }
    for (const block of ['10503', '10504']) {
      const missing = add(`linear-accelerator-${length}-missing-${block}`, good, {
        expectedStructure: false,
      });
      missing.cells.find((c) => c.block === `gregtech:gt.blockmachines@${block}`).block =
        'gtnhlanth:casing.shielded_accelerator@0';
    }
    for (const kind of ['fluidIn', 'fluidOut']) {
      const missing = add(`linear-accelerator-${length}-missing-${kind}`, good, { expectedStructure: false });
      const cell = missing.cells.find((c) => c.hatch === kind);
      Object.assign(cell, { hatch: undefined, block: 'gtnhlanth:casing.shielded_accelerator@0' });
    }
    const blocked = add(`linear-accelerator-${length}-blocked-air`, good, { expectedStructure: false });
    blocked.cells.find((c) => c.block === 'minecraft:air@0').block =
      'gtnhlanth:casing.shielded_accelerator@0';
  }
  const linac = placement('linear-accelerator', { voltageTier: 'LV', structureGlassTier: 'LuV' });
  const noPower = add('linear-accelerator-no-energy', linac);
  const linacEnergy = noPower.cells.find((c) => c.hatch === 'energy');
  Object.assign(linacEnergy, { hatch: undefined, block: linacEnergy.replaces });
  const noMaintenance = add('linear-accelerator-no-maintenance', linac, { expectedStructure: false });
  const maintenance = noMaintenance.cells.find((c) => c.hatch === 'maintenance');
  Object.assign(maintenance, { hatch: undefined, block: maintenance.replaces });
  for (const [kind, number, valid] of [
    ['energy', 3, false],
    ['maintenance', 2, true],
  ]) {
    const extra = add(`linear-accelerator-${number}-${kind}`, linac, { expectedStructure: valid });
    const cells = extra.cells.filter(
      (c) =>
        c.block === 'gtnhlanth:casing.shielded_accelerator@0' &&
        c.pos[1] === 0 &&
        Math.abs(c.pos[0]) === 3 &&
        c.pos[2] >= 2 &&
        c.pos[2] <= 7,
    );
    for (const cell of cells.slice(0, number - 1))
      Object.assign(cell, {
        block: undefined,
        hatch: kind,
        tier: 'LV',
        face: cell.pos[0] < 0 ? 'west' : 'east',
      });
  }
  for (const kind of ['fluidIn', 'fluidOut']) {
    const same = add(`linear-accelerator-two-${kind}`, linac);
    for (const cell of same.cells.filter((c) => ['fluidIn', 'fluidOut'].includes(c.hatch))) cell.hatch = kind;
  }
  add(
    'linear-accelerator-low-glass',
    placement('linear-accelerator', { voltageTier: 'LV', structureGlassTier: 'HV' }),
    { expectedStructure: false },
  );
  const mixedGlass = add('linear-accelerator-mixed-glass', linac, { expectedStructure: false });
  mixedGlass.cells.find((c) => c.block === 'bartworks:BW_TieredGlass@3').block = 'bartworks:BW_TieredGlass@4';
  add(
    'linear-accelerator-high-energy-with-luv-glass',
    placement('linear-accelerator', { voltageTier: 'UHV', structureGlassTier: 'LuV' }),
  );
  // The source loop stops at 128 without checking an end. Record the RC2 defect independently;
  // the planner offers complete productive forms only and still diagnoses a stored length of 137.
  const endLess = add('linear-accelerator-checker-escape-without-end', longestLinac);
  const lastLayer = endLess.cells
    .filter((c) => c.pos[2] >= 124 && c.pos[2] < 126)
    .map((c) => ({ ...c, pos: [c.pos[0], c.pos[1], c.pos[2] + 2] }));
  endLess.cells = [...endLess.cells.filter((c) => c.pos[2] < 126), ...lastLayer];
  for (const kind of ['itemIn', 'fluidIn']) {
    const getMultiblock = (id) => {
      const def = model.getMultiblock(id);
      return id === 'source-chamber'
        ? { ...def, defaultHatches: [kind, 'itemOut', 'energy', 'maintenance'] }
        : def;
    };
    const good = nativePlacement({ ...model, getMultiblock }, 'source-chamber', { voltageTier: 'LV' });
    for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
      const rotated = add(`source-chamber-${kind}-${face}`, good, { controllerFacing: face });
      for (const cell of rotated.cells) {
        for (let n = 0; n < turn; n++) {
          const [x, y, z] = cell.pos;
          cell.pos = [-z, y, x];
        }
        if (cell.face && !['up', 'down'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
          ];
      }
    }
    for (const missingKind of [kind, 'itemOut', 'energy', 'maintenance']) {
      const missing = add(`source-chamber-${kind}-missing-${missingKind}`, good, {
        expectedStructure: false,
      });
      const cell = missing.cells.find((c) => c.hatch === missingKind);
      Object.assign(cell, { hatch: undefined, block: 'gtnhlanth:casing.shielded_accelerator@0' });
    }
    for (const extraKind of ['energy', 'maintenance']) {
      const extra = add(`source-chamber-${kind}-two-${extraKind}`, good, { expectedStructure: false });
      const cell = extra.cells.find(
        (c) => c.block === 'gtnhlanth:casing.shielded_accelerator@0' && c.pos[1] === 0 && c.pos[2] === 0,
      );
      Object.assign(cell, { block: undefined, hatch: extraKind, tier: 'LV', face: 'north' });
    }
    const beam = add(`source-chamber-${kind}-missing-beam-output`, good, { expectedStructure: false });
    beam.cells.find((c) => c.block === 'gregtech:gt.blockmachines@10504').block =
      'gtnhlanth:casing.shielded_accelerator@0';
    const air = add(`source-chamber-${kind}-blocked-air`, good, { expectedStructure: false });
    air.cells.find((c) => c.block === 'minecraft:air@0').block = 'gtnhlanth:casing.shielded_accelerator@0';
    const wrongBus = add(`source-chamber-${kind}-fluid-output-in-bus-cell`, good, {
      expectedStructure: false,
    });
    wrongBus.cells.find((c) => c.hatch === 'itemOut').hatch = 'fluidOut';
  }
  for (const [id, height] of [
    ['beam-mirror', 5],
    ['beam-mirror', 6],
    ['beam-splitter', undefined],
    ['beam-stabilizer', undefined],
    ['beam-crafter', undefined],
  ]) {
    const good = placement(id, { voltageTier: 'LV' }, height);
    const label = id + (height ? `-${height}` : '');
    for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
      const rotated = add(`${label}-${face}`, good, { controllerFacing: face });
      for (const cell of rotated.cells) {
        for (let n = 0; n < turn; n++) {
          const [x, y, z] = cell.pos;
          cell.pos = [-z, y, x];
        }
        if (cell.face && !['up', 'down'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
          ];
      }
      rotated.expectedBlockFacings = Object.fromEntries(
        rotated.cells
          .filter((c) => c.block?.startsWith('gregtech:gt.blockmachines@') && c.face)
          .map((c) => [c.pos.join(), c.face]),
      );
    }
    const specials = good.cells.filter((c) => c.block?.startsWith('gregtech:gt.blockmachines@') && c.face);
    for (const [i, special] of specials.entries()) {
      const missing = add(`${label}-missing-special-${i}`, good, { expectedStructure: false });
      missing.cells.find((c) => c.pos.join() === special.pos.join()).block =
        'gtnhlanth:casing.shielded_accelerator@0';
    }
    if (id !== 'beam-crafter') {
      const packet = add(`${label}-beam-dispatch`, good, {
        expectedProcessing: true,
        expectedBeamRates: Array.from({ length: specials.length - 1 }, () =>
          id === 'beam-splitter' ? 30 : id === 'beam-stabilizer' ? 100 : 120,
        ),
      });
      packet.cells.find((c) => c.block === 'gregtech:gt.blockmachines@10503').beam = {
        energy: 200,
        rate: 120,
        particle: 0,
        focus: 10,
      };
    }
    if (id === 'beam-splitter') {
      const interior = add(`${label}-free-interior-filled`, good);
      interior.cells.push({ pos: [0, 1, 1], block: 'gregtech:gt.blockcasings2@0' });
      const wrongOutput = add(`${label}-ordinary-beam-output`, good, { expectedStructure: false });
      wrongOutput.cells.find((c) => c.block === 'gregtech:gt.blockmachines@3014').block =
        'gregtech:gt.blockmachines@10504';
    }
    if (id === 'beam-crafter') {
      for (const kind of ['energy', 'itemIn', 'itemOut']) {
        const absent = add(`${label}-missing-${kind}`, good, { expectedStructure: false });
        const hatch = absent.cells.find((c) => c.hatch === kind);
        Object.assign(hatch, { hatch: undefined, block: hatch.replaces });
      }
      const fluid = add(`${label}-fluid-interfaces`, good);
      for (const hatch of fluid.cells.filter((c) => ['itemIn', 'itemOut'].includes(c.hatch)))
        hatch.hatch = hatch.hatch === 'itemIn' ? 'fluidIn' : 'fluidOut';
    }
  }
  for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
    const rotated = add(`bricked-blast-furnace-${face}`, bricked, { controllerFacing: face });
    for (const cell of rotated.cells)
      for (let n = 0; n < turn; n++) {
        const [x, y, z] = cell.pos;
        cell.pos = [-z, y, x];
      }
  }
  const lavaCore = add('bricked-blast-furnace-lava-core', bricked);
  for (const cell of lavaCore.cells.filter((c) => c.block === 'minecraft:air@0' && c.pos[1] < 2))
    cell.block = cell.pos[1] === 0 ? 'minecraft:lava@0' : 'minecraft:flowing_lava@0';
  const chimney = add('bricked-blast-furnace-blocked-chimney', bricked, { expectedStructure: false });
  chimney.cells.find((c) => c.block === 'minecraft:air@0' && c.pos[1] === 2).block = 'minecraft:lava@0';
  const brick = add('bricked-blast-furnace-wrong-brick', bricked, { expectedStructure: false });
  brick.cells.find((c) => c.block === 'gregtech:gt.blockcasings4@15').block = 'gregtech:gt.blockcasings2@0';
  for (const id of ['electric-blast-furnace', 'large-chemical-reactor', 'multi-smelter', 'vacuum-freezer']) {
    const good = placement(id, { voltageTier: 'LV' });
    add(`${id}-standard`, good);
    const missingEnergy = add(`${id}-missing-energy`, good, { expectedStructure: false });
    const input = missingEnergy.cells.find((c) => c.hatch === 'energy');
    Object.assign(input, { hatch: undefined, block: input.replaces });
    const wrong = add(`${id}-wrong-inner-block`, good, { expectedStructure: false });
    const inner = wrong.cells.find(
      (c) => c.block === (id === 'vacuum-freezer' ? 'minecraft:air@0' : 'gregtech:gt.blockcasings5@0'),
    );
    inner.block = 'gregtech:gt.blockcasings@11';
  }
  for (const mode of ['up', 'down']) {
    for (let windings = 1; windings <= 8; windings++) {
      const test = placement(
        'manual-transformer',
        {
          voltageTier: mode === 'up' ? 'LV' : 'UEV',
          manualTransformerMode: mode,
        },
        windings + 2,
      );
      add(`manual-${mode}-${windings}`, test, { expectedProcessing: true });
      const bad = add(`manual-${mode}-${windings}-wrong-output`, test, { expectedProcessing: false });
      bad.cells.find((c) => c.hatch === 'dynamo').tier = 'LV';
    }
  }
  const manual = placement('manual-transformer', { voltageTier: 'HV' }, 3);
  const wrongBase = add('manual-input-on-winding', manual, { expectedStructure: false });
  const energy = wrongBase.cells.find((c) => c.hatch === 'energy');
  const winding = wrongBase.cells.find((c) => c.block === 'bartworks:BW_Machinery_Casings@1');
  [energy.pos, winding.pos] = [winding.pos, energy.pos];
  const missingTop = add('manual-missing-top-output', manual, { expectedStructure: false });
  const dynamo = missingTop.cells.find((c) => c.hatch === 'dynamo');
  Object.assign(dynamo, { hatch: undefined, block: dynamo.replaces });

  for (const glass of ['HV', 'EV', 'IV']) {
    const valid = placement('algae-farm', { voltageTier: glass, structureGlassTier: glass });
    add(`algae-glass-${glass}`, valid);
    const bad = add(`algae-glass-${glass}-energy-too-high`, valid, { expectedStructure: false });
    bad.cells.find((c) => c.hatch === 'energy').tier = 'LuV';
  }
  for (const [id, glass] of [
    ['component-assembly-line', 'UV'],
    ['precise-auto-assembler-mt-3662', 'EV'],
    ['tfft', 'EV'],
  ]) {
    const good = placement(id, { voltageTier: 'LV', structureGlassTier: glass });
    add(`minimum-glass-${id}`, good);
    const highEnergy = add(`minimum-glass-${id}-high-energy`, good);
    highEnergy.cells.find((c) => c.hatch === 'energy').tier = 'UHV';
    const low = add(`minimum-glass-${id}-HV`, good, { expectedStructure: false });
    for (const c of low.cells)
      if (c.block?.startsWith('bartworks:BW_TieredGlass@')) c.block = 'bartworks:BW_TieredGlass@0';
  }
  const tank = placement('tfft', { voltageTier: 'LV', structureGlassTier: 'HV' });
  const zeroCost = add('tfft-T10-zero-cost-HV-glass', tank);
  for (const c of zeroCost.cells)
    if (/^kekztech:kekztech_tfftstoragefield_block@[1-9]$/.test(c.block ?? ''))
      c.block = 'kekztech:kekztech_tfftstoragefield_block@10';
  const mixed = add('tfft-mixed-T1-T10-HV-glass', zeroCost, { expectedStructure: false });
  mixed.cells.find((c) => c.block === 'kekztech:kekztech_tfftstoragefield_block@10').block =
    'kekztech:kekztech_tfftstoragefield_block@1';
  for (const [id, prefix] of [
    ['mega-oil-cracker', 'mega-cracker'],
    ['oil-cracking-unit', 'cracker'],
  ])
    for (const side of ['left', 'right']) {
      const test = placement(
        id,
        {
          voltageTier: 'HV',
          crackingFeedSide: side,
          resourceBindings: [
            { kind: 'fluidIn', resource: 'feed', role: 'feed' },
            { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
          ],
        },
        undefined,
        { fluidIn: ['feed', 'agent'], fluidOut: ['product'] },
      );
      for (const agent of ['steam', 'hydrogen']) {
        const good = add(`${prefix}-${side}-${agent}`, test, { expectedFluids: ['feed', 'agent'] });
        for (const c of good.cells) {
          if (c.resource === 'feed') c.fluid = 'light-fuel';
          if (c.resource === 'agent') c.fluid = agent;
        }
        const swapped = add(`${prefix}-${side}-${agent}-swapped-fluids`, good, { expectedFluids: [] });
        for (const c of swapped.cells) {
          if (c.resource === 'feed') c.fluid = agent;
          if (c.resource === 'agent') c.fluid = 'light-fuel';
        }
      }
      const bad = add(`${prefix}-${side}-output-in-middle`, test, { expectedStructure: false });
      const output = bad.cells.find((c) => c.hatch === 'fluidOut');
      const agent = bad.cells.find((c) => c.resource === 'agent');
      [output.pos, agent.pos] = [agent.pos, output.pos];
    }
  for (const height of [30, 36, 42, 48, 54]) {
    const test = placement('mega-distillation-tower', { voltageTier: 'HV' }, height);
    add(`mega-tower-${height}`, test, { checkOutputSlots: true });
    const bad = add(`mega-tower-${height}-missing-final-output`, test, { expectedStructure: false });
    const last = bad.cells.filter((c) => c.hatch === 'fluidOut').sort((a, b) => b.pos[1] - a.pos[1])[0];
    Object.assign(last, { hatch: undefined, block: last.replaces });
  }
  for (let height = 3; height <= 12; height++) {
    const test = placement('distillation-tower', { voltageTier: 'HV' }, height);
    add(`tower-${height}`, test, { checkOutputSlots: true, outputSlotField: 'mOutputHatchesByLayer' });
    const bad = add(`tower-${height}-missing-final-output`, test, { expectedStructure: false });
    const last = bad.cells.filter((c) => c.hatch === 'fluidOut').sort((a, b) => b.pos[1] - a.pos[1])[0];
    Object.assign(last, { hatch: undefined, block: last.replaces });
  }
  const tower = placement('distillation-tower', { voltageTier: 'HV' }, 5);
  const topUp = add('tower-top-output-up', tower, {
    checkOutputSlots: true,
    outputSlotField: 'mOutputHatchesByLayer',
  });
  topUp.cells.filter((c) => c.hatch === 'fluidOut').sort((a, b) => b.pos[1] - a.pos[1])[0].face = 'up';
  for (const face of ['up', 'down']) {
    const middle = add(`tower-middle-output-${face}`, tower, {
      checkOutputSlots: true,
      outputSlotField: 'mOutputHatchesByLayer',
    });
    middle.cells.find((c) => c.hatch === 'fluidOut' && c.pos[1] === 2).face = face;
  }
  const wrongInput = add('tower-input-above-base', tower, { expectedStructure: false });
  const input = wrongInput.cells.find((c) => c.hatch === 'fluidIn');
  const upper = wrongInput.cells.find((c) => c.pos[1] === 2 && c.block === 'gregtech:gt.blockcasings4@1');
  [input.pos, upper.pos] = [upper.pos, input.pos];
  for (const [id, required] of [
    ['fluid-drilling-rig', 'fluidOut'],
    ['fluid-drilling-rig-ii', 'fluidOut'],
    ['fluid-drilling-rig-iii', 'fluidOut'],
    ['fluid-drilling-rig-iv', 'fluidOut'],
    ['infinite-fluid-drilling-rig', 'fluidOut'],
    ['ore-drilling-plant', 'fluidIn'],
    ['ore-drilling-plant-ii', 'fluidIn'],
    ['ore-drilling-plant-iii', 'fluidIn'],
    ['ore-drilling-plant-iv', 'fluidIn'],
    ['concrete-backfiller', 'fluidIn'],
    ['advanced-concrete-backfiller', 'fluidIn'],
    ['deep-earth-heating-pump', 'fluidIn'],
    ['void-miner-i', 'itemOut'],
    ['void-miner-ii', 'itemOut'],
    ['void-miners', 'itemOut'],
  ]) {
    const def = model.getMultiblock(id);
    const test = placement(id, { voltageTier: def.minimumVoltageTier });
    add(`driller-${id}`, test);
    const missing = add(`driller-${id}-missing-resource-hatch`, test, { expectedStructure: false });
    const hatch = missing.cells.find((c) => c.hatch === required);
    Object.assign(hatch, { hatch: undefined, block: hatch.replaces });
    const low = add(`driller-${id}-low-energy`, test, { expectedStructure: false });
    low.cells.find((c) => c.hatch === 'energy').tier = 'LV';
  }
  for (const [id, required] of [
    ['xl-turbo-steam-turbine', 'fluidOut'],
    ['xl-turbo-hp-steam-turbine', 'fluidOut'],
    ['xl-turbo-sc-steam-turbine', 'fluidOut'],
    ['xl-turbo-plasma-turbine', 'fluidOut'],
    ['xl-turbo-gas-turbine', 'muffler'],
    ['superconductive-strand-splitter', 'fluidIn'],
  ]) {
    const good = placement(id, { voltageTier: 'LV' });
    add(`conditional-hatches-${id}`, good);
    const missing = add(`conditional-hatches-${id}-missing-${required}`, good, { expectedStructure: false });
    const hatch = missing.cells.find((c) => c.hatch === required);
    Object.assign(hatch, { hatch: undefined, block: hatch.replaces });
    if (id.startsWith('xl-turbo')) {
      const noInput = add(`conditional-hatches-${id}-missing-input`, good, { expectedStructure: false });
      const input = noInput.cells.find((c) => c.hatch === 'fluidIn');
      Object.assign(input, { hatch: undefined, block: input.replaces });
    }
    if (id === 'xl-turbo-gas-turbine' || id === 'superconductive-strand-splitter') {
      const extra = add(`conditional-hatches-${id}-excess-${required}`, good, { expectedStructure: false });
      const block =
        id === 'xl-turbo-gas-turbine'
          ? 'miscutils:gtplusplus.blockspecialcasings.1@3'
          : 'gregtech:gt.blockcasings12@1';
      const casing = extra.cells.find((c) => c.block === block);
      Object.assign(casing, {
        block: undefined,
        replaces: block,
        hatch: required,
        tier: 'LV',
        face: 'north',
      });
    }
  }
  for (const id of ['assembly-line', 'advanced-assembly-line']) {
    for (const length of [2, 5, 16])
      for (const tier of ['EV', 'LuV', 'UV']) {
        const key = JSON.stringify([0, 'dataAccess', null, 0]);
        add(
          `${id}-placed-data-access-${length}-${tier}`,
          placement(id, { voltageTier: 'LV', hatchTiers: { [key]: tier } }, length, {}, false, [
            'dataAccess',
          ]),
        );
      }
    for (let length = 2; length <= 16; length++) {
      const good = placement(id, { voltageTier: 'LV' }, length);
      add(`${id}-fixed-buses-${length}`, good);
      const missing = add(`${id}-fixed-buses-${length}-missing-bus`, good, { expectedStructure: false });
      const bus = missing.cells.find((c) => c.pos.join() === '0,-2,1');
      Object.assign(bus, { hatch: undefined, block: 'gregtech:gt.blockcasings2@0' });
    }
    const good = placement(id, { voltageTier: 'LV' }, 5);
    for (const face of ['north', 'east', 'south', 'west', 'up', 'down']) {
      const energy = add(`${id}-energy-facing-${face}`, good);
      energy.cells.find((c) => c.hatch === 'energy').face = face;
      for (const meta of [145, 146, 147]) {
        const data = add(`${id}-data-access-${meta}-${face}`, good);
        Object.assign(
          data.cells.find((c) => c.pos.join() === '-1,0,0'),
          {
            block: `gregtech:gt.blockmachines@${meta}`,
            face,
          },
        );
      }
    }
    for (const number of [1, 2, 3]) {
      const last = add(`${id}-terminal-${number}-output-buses`, good);
      for (const cell of last.cells.filter((c) => ['itemOut', 'maintenance', 'fluidIn'].includes(c.hatch)))
        Object.assign(cell, { hatch: undefined, block: 'gregtech:gt.blockcasings2@0' });
      Object.assign(
        last.cells.find((c) => c.pos.join() === '0,-2,2'),
        {
          block: undefined,
          hatch: 'maintenance',
          face: 'down',
        },
      );
      for (const z of [1, 0, 2].slice(0, number))
        Object.assign(
          last.cells.find((c) => c.pos.join() === `-4,-2,${z}`),
          {
            block: undefined,
            hatch: 'itemOut',
            tier: 'LV',
            face: 'down',
          },
        );
    }
    const laterFluid = add(`${id}-later-centre-fluid-output`, good);
    Object.assign(
      laterFluid.cells.find((c) => c.pos.join() === '-1,-2,1'),
      { hatch: 'fluidOut' },
    );
    const noOutput = add(`${id}-no-output-bus`, good, { expectedStructure: false });
    const output = noOutput.cells.find((c) => c.hatch === 'itemOut');
    Object.assign(output, { hatch: undefined, block: 'gregtech:gt.blockcasings2@0' });
    const twice = add(`${id}-two-data-access`, good, { expectedStructure: false });
    for (const z of [0, 2])
      twice.cells.find((c) => c.pos.join() === `-1,0,${z}`).block = 'gregtech:gt.blockmachines@145';
    const firstData = add(`${id}-first-slice-data-access`, good, { expectedStructure: false });
    firstData.cells.find((c) => c.pos.join() === '0,0,2').block = 'gregtech:gt.blockmachines@145';
    const shortest = placement(id, { voltageTier: 'LV' }, 2);
    for (const count of [1, 4]) {
      const early = add(`${id}-two-slices-${count}-outputs-including-first`, shortest);
      for (const cell of early.cells.filter((c) => ['maintenance', 'fluidIn', 'itemOut'].includes(c.hatch)))
        Object.assign(cell, { hatch: undefined, block: 'gregtech:gt.blockcasings2@0' });
      Object.assign(
        early.cells.find((c) => c.pos.join() === '0,-2,2'),
        { block: undefined, hatch: 'maintenance', face: 'down' },
      );
      for (const pos of ['0,-2,0', '-1,-2,0', '-1,-2,1', '-1,-2,2'].slice(0, count))
        Object.assign(
          early.cells.find((c) => c.pos.join() === pos),
          { block: undefined, hatch: 'itemOut', tier: 'LV', face: 'down' },
        );
    }
  }
  for (const [id, inputs, outputs, fields] of [
    [
      'large-heat-exchanger',
      [
        ['hot', 'hotFluid'],
        ['water', 'water'],
      ],
      [
        ['cooled', 'coldFluid'],
        ['steam', 'steam'],
      ],
      { mInputHotFluidHatch: 'hot', mOutputColdFluidHatch: 'cooled' },
    ],
    [
      'extreme-heat-exchanger',
      [
        ['hot', 'hotFluid'],
        ['water', 'water'],
      ],
      [
        ['cooled', 'coldFluid'],
        ['steam', 'steam'],
      ],
      { mHotFluidHatch: 'hot', mCooledFluidHatch: 'cooled' },
    ],
    [
      'ph-neutralization-purification-unit',
      [
        ['acid', 'acid'],
        ['water', 'water'],
      ],
      [['product', 'product']],
      { acidInputHatch: 'acid', alkalineInputBus: 'sodium' },
    ],
    [
      'extreme-temperature-fluctuation-purification-unit',
      [
        ['coolant', 'coolant'],
        ['plasma', 'plasma'],
        ['water', 'water'],
      ],
      [['product', 'product']],
      { coolantInputHatch: 'coolant', plasmaInputHatch: 'plasma' },
    ],
  ]) {
    const resourceBindings = [
      ...inputs.map(([resource, role]) => ({ kind: 'fluidIn', resource, role })),
      ...outputs.map(([resource, role]) => ({ kind: 'fluidOut', resource, role })),
      ...(id === 'ph-neutralization-purification-unit'
        ? [{ kind: 'itemIn', resource: 'sodium', role: 'alkaline' }]
        : []),
    ];
    const good = placement(id, { voltageTier: 'LV', resourceBindings }, undefined, {
      fluidIn: inputs.map(([r]) => r),
      fluidOut: outputs.map(([r]) => r),
      ...(id === 'ph-neutralization-purification-unit' ? { itemIn: ['sodium'] } : {}),
    });
    add(`${id}-dedicated-roles`, good, { expectedHatchFields: fields });
    for (const kind of ['fluidIn', 'fluidOut']) {
      const missing = add(`${id}-missing-ordinary-${kind}`, good, { expectedStructure: false });
      const resource = kind === 'fluidIn' ? 'water' : id.endsWith('heat-exchanger') ? 'steam' : 'product';
      const hatch = missing.cells.find((c) => c.hatch === kind && c.resource === resource);
      Object.assign(hatch, { hatch: undefined, block: hatch.replaces });
    }
    const swapped = add(`${id}-swapped-dedicated-resources`, good, {
      expectedHatchFields: fields,
      expectedHatchFieldsMatch: false,
    });
    const a = swapped.cells.find((c) => c.resource === inputs[0][0]);
    const b = swapped.cells.find((c) => c.resource === inputs[1][0]);
    [a.resource, b.resource] = [b.resource, a.resource];
    if (id === 'large-heat-exchanger') {
      const bad = add('large-heat-exchanger-too-few-casings', good, { expectedStructure: false });
      for (const cell of bad.cells.filter((c) => c.block === 'gregtech:gt.blockcasings4@2').slice(0, 9))
        Object.assign(cell, { block: undefined, hatch: 'fluidIn', tier: 'LV', face: 'north' });
    }
  }
  const htgrBindings = [
    { kind: 'fluidIn', resource: 'helium', role: 'helium' },
    { kind: 'fluidIn', resource: 'coolant', role: 'coolant' },
    { kind: 'fluidIn', resource: 'water', role: 'water' },
    { kind: 'fluidOut', resource: 'hotCoolant', role: 'hotFluid' },
    { kind: 'fluidOut', resource: 'steam', role: 'steam' },
  ];
  const htgr = placement(
    'high-temperature-gas-cooled-reactor',
    { voltageTier: 'LV', resourceBindings: htgrBindings },
    undefined,
    { fluidIn: ['helium', 'coolant', 'water'], fluidOut: ['hotCoolant', 'steam'] },
  );
  const htgrFields = {
    heliumInputHatch: 'helium',
    coolantInputHatch: 'coolant',
    waterInputHatch: 'water',
    coolantOutputHatch: 'hotCoolant',
    steamOutputHatch: 'steam',
  };
  add('htgr-dedicated-fluid-roles', htgr, { expectedHatchFields: htgrFields });
  for (const resource of ['helium', 'coolant', 'water', 'hotCoolant', 'steam']) {
    const missing = add(`htgr-missing-${resource}`, htgr, { expectedStructure: false });
    const hatch = missing.cells.find((c) => c.resource === resource);
    Object.assign(hatch, { hatch: undefined, block: 'gregtech:gt.blockcasings10@3' });
  }
  for (const kind of ['energy', 'maintenance', 'itemIn', 'itemOut']) {
    const missing = add(`htgr-missing-${kind}`, htgr, { expectedStructure: false });
    const hatch = missing.cells.find((c) => c.hatch === kind);
    Object.assign(hatch, { hatch: undefined, block: 'gregtech:gt.blockcasings10@3' });
  }
  for (const [a, b] of [
    ['helium', 'coolant'],
    ['coolant', 'water'],
    ['hotCoolant', 'steam'],
  ]) {
    const swapped = add(`htgr-swapped-${a}-${b}`, htgr, {
      expectedHatchFields: htgrFields,
      expectedHatchFieldsMatch: false,
    });
    const first = swapped.cells.find((c) => c.resource === a);
    const second = swapped.cells.find((c) => c.resource === b);
    [first.resource, second.resource] = [second.resource, first.resource];
  }
  const targetSettings = {
    voltageTier: 'LuV',
    structureGlassTier: 'LuV',
    resourceBindings: [
      { kind: 'itemIn', resource: 'mask', role: 'mask' },
      { kind: 'itemIn', resource: 'feed', role: 'feed' },
    ],
  };
  const target = placement('target-chamber', targetSettings, undefined, { itemIn: ['mask', 'feed'] });
  const targetFields = { mMaskInputBusses: 'mask', mInputBusses: 'feed' };
  add('target-chamber-dedicated-mask-and-feed', target, { expectedHatchFields: targetFields });
  const swappedTarget = add('target-chamber-swapped-mask-and-feed', target, {
    expectedHatchFields: targetFields,
    expectedHatchFieldsMatch: false,
  });
  for (const cell of swappedTarget.cells.filter((c) => c.hatch === 'itemIn'))
    cell.resource = cell.resource === 'mask' ? 'feed' : 'mask';
  for (const resource of ['mask', 'feed']) {
    const missing = add(`target-chamber-missing-${resource}`, target, { expectedStructure: false });
    const bus = missing.cells.find((c) => c.resource === resource);
    Object.assign(bus, { hatch: undefined, block: 'gtnhlanth:casing.shielded_accelerator@0' });
  }
  for (const kind of ['itemOut', 'energy', 'maintenance']) {
    const missing = add(`target-chamber-missing-${kind}`, target, { expectedStructure: false });
    const hatch = missing.cells.find((c) => c.hatch === kind);
    Object.assign(hatch, { hatch: undefined, block: 'gtnhlanth:casing.shielded_accelerator@0' });
  }
  const noBeam = add('target-chamber-missing-beam-input', target, { expectedStructure: false });
  noBeam.cells.find((c) => c.block === 'gregtech:gt.blockmachines@10503').block =
    'gtnhlanth:casing.shielded_accelerator@0';
  const lowGlass = add('target-chamber-insufficient-glass', target, { expectedStructure: false });
  for (const cell of lowGlass.cells.filter((c) => c.block === 'bartworks:BW_TieredGlass@3'))
    cell.block = 'bartworks:BW_TieredGlass@0';
  add(
    'target-chamber-energy-above-glass',
    placement(
      'target-chamber',
      {
        ...targetSettings,
        voltageTier: 'UHV',
      },
      undefined,
      { itemIn: ['mask', 'feed'] },
    ),
    { expectedHatchFields: targetFields },
  );
  const drone = placement('drone-centre', { voltageTier: 'LV' });
  add('drone-centre-current-form', drone);
  const missingDroneBus = add('drone-centre-current-form-missing-input-bus', drone, {
    expectedStructure: false,
  });
  const droneBus = missingDroneBus.cells.find((c) => c.hatch === 'itemIn');
  Object.assign(droneBus, { hatch: undefined, block: droneBus.replaces });
  for (const id of ['sparge-tower-controller', 'dangote-distillus']) {
    const full = (height) => {
      const count = height - 1;
      const resources = Array.from({ length: count }, (_, i) => `fraction-${i}`);
      return placement(
        id,
        {
          voltageTier: 'LV',
          resourceBindings: resources.map((resource, outputSlot) => ({
            kind: 'fluidOut',
            resource,
            outputSlot,
          })),
        },
        height,
        { fluidOut: resources },
      );
    };
    const heights = id === 'sparge-tower-controller' ? [8] : Array.from({ length: 10 }, (_, i) => i + 3);
    for (const height of heights) {
      const good = full(height);
      add(`${id}-${height}-slots`, good, {
        checkOutputSlots: true,
        outputSlotField: 'mOutputHatchesByLayer',
      });
      const missing = add(`${id}-${height}-missing-final-output`, good, {
        expectedStructure: id === 'sparge-tower-controller',
      });
      const top = missing.cells.find((c) => c.outputSlot === height - 2);
      Object.assign(top, { hatch: undefined, block: top.replaces });
    }
    const good = full(heights[0]);
    for (const face of ['up', 'down']) {
      const vertical = add(`${id}-vertical-output-${face}`, good, {
        checkOutputSlots: true,
        outputSlotField: 'mOutputHatchesByLayer',
      });
      for (const cell of vertical.cells.filter((c) => c.hatch === 'fluidOut')) cell.face = face;
    }
    if (id === 'sparge-tower-controller') {
      const missing = add(`${id}-missing-first-output`, good, { expectedStructure: false });
      const first = missing.cells.find((c) => c.outputSlot === 0);
      Object.assign(first, { hatch: undefined, block: first.replaces });
    }
  }
  for (const id of [
    'helioflare-power-forge',
    'helioflux-melting-core',
    'heliothermal-plasma-fabricator',
    'heliofusion-exoticizer',
  ]) {
    add(`${id}-default`, placement(id, { voltageTier: 'LV' }));
    const standardModel = {
      ...model,
      getMultiblock: (machine) => ({
        ...model.getMultiblock(machine),
        defaultHatches: [
          'itemIn',
          'itemOut',
          'fluidIn',
          'fluidOut',
          'energy',
          'dynamo',
          'maintenance',
          'muffler',
        ],
      }),
    };
    const full = nativePlacement(standardModel, id, { voltageTier: 'LV' });
    add(`${id}-standard-interfaces`, full);
    const bad = add(`${id}-rear-interface`, full, { expectedStructure: false });
    const hatch = bad.cells.find((c) => c.hatch === 'energy');
    const rear = bad.cells.find((c) => c.block === 'tectech:gt.godforgecasing@0' && c.pos[2] === 1);
    [hatch.pos, rear.pos] = [rear.pos, hatch.pos];
    if (id === 'heliofusion-exoticizer')
      for (const kind of ['itemOut', 'fluidOut']) {
        const missing = add(`${id}-missing-${kind}`, full, { expectedStructure: false });
        const output = missing.cells.find((c) => c.hatch === kind);
        Object.assign(output, { hatch: undefined, block: output.replaces });
      }
  }
  for (const [id, kind, fluid, field, method] of [
    ['cryogenic-freezer', 'cryotheumIn', 'cryotheum', 'mCryotheumHatches', 'drainCryotheum'],
    ['volcanus', 'pyrotheumIn', 'pyrotheum', 'mPyrotheumHatches', 'drainPyrotheum'],
  ]) {
    const good = placement(id, { voltageTier: 'LV' }, undefined, { [kind]: ['coolant'] });
    if (id === 'cryogenic-freezer') {
      const interior = add(`${id}-skipped-interior-filled`, good);
      interior.cells.push({ pos: [0, 0, 1], block: 'gregtech:gt.blockcasings2@0' });
    }
    for (const [turn, face] of ['north', 'east', 'south', 'west'].entries()) {
      const rotated = add(`${id}-special-hatch-${face}`, good, {
        controllerFacing: face,
        expectedHatchFields: { [field]: 'coolant' },
      });
      for (const cell of rotated.cells) {
        for (let n = 0; n < turn; n++) {
          const [x, y, z] = cell.pos;
          cell.pos = [-z, y, x];
        }
        if (cell.face && !['up', 'down'].includes(cell.face))
          cell.face = ['north', 'east', 'south', 'west'][
            (['north', 'east', 'south', 'west'].indexOf(cell.face) + turn) % 4
          ];
      }
    }
    for (const missingKind of [kind, 'energy', 'maintenance', 'muffler', 'itemIn', 'itemOut']) {
      const missing = add(`${id}-missing-${missingKind}`, good, { expectedStructure: false });
      const hatch = missing.cells.find((c) => c.hatch === missingKind);
      Object.assign(hatch, { hatch: undefined, block: hatch.replaces });
    }
    const ordinary = add(`${id}-ordinary-coolant-hatch`, good, { expectedStructure: false });
    Object.assign(
      ordinary.cells.find((c) => c.hatch === kind),
      { hatch: 'fluidIn', tier: 'IV' },
    );
    const other = add(`${id}-wrong-special-coolant-hatch`, good, { expectedStructure: false });
    other.cells.find((c) => c.hatch === kind).hatch = kind === 'cryotheumIn' ? 'pyrotheumIn' : 'cryotheumIn';
    const minimum = id === 'cryogenic-freezer' ? 46 : 6;
    const casingBlock =
      id === 'cryogenic-freezer'
        ? 'miscutils:gtplusplus.blockcasings.3@10'
        : 'miscutils:gtplusplus.blockcasings.3@11';
    for (const n of [minimum, minimum - 1]) {
      const counted = add(`${id}-${n}-counted-casings`, good, { expectedStructure: n === minimum });
      const casings = counted.cells.filter((c) => c.block === casingBlock);
      for (const cell of casings.slice(n))
        Object.assign(cell, {
          block: undefined,
          hatch: 'fluidIn',
          tier: 'LV',
          face: 'north',
          replaces: casingBlock,
        });
    }
    const fluidInterfaces = add(`${id}-ordinary-fluid-interfaces`, good);
    for (const cell of fluidInterfaces.cells.filter((c) => ['itemIn', 'itemOut'].includes(c.hatch)))
      cell.hatch = cell.hatch === 'itemIn' ? 'fluidIn' : 'fluidOut';
    for (const [label, inputFluid, quantity, success, filled, remaining] of [
      ['enough', fluid, 100, true, 100, 90],
      ['exact', fluid, 10, true, 10, 0],
      ['insufficient', fluid, 9, false, 9, 0],
      ['wrong-fluid', fluid === 'cryotheum' ? 'pyrotheum' : 'cryotheum', 100, false, 0, 0],
    ]) {
      const drain = add(`${id}-coolant-drain-${label}`, fluidInterfaces, {
        expectedFluidDrain: {
          method,
          amount: 10,
          success,
          filled: { coolant: filled, recipe: 1000 },
          remaining: { coolant: remaining, recipe: 1000 },
        },
      });
      Object.assign(
        drain.cells.find((c) => c.hatch === kind),
        { fillFluid: inputFluid, fillAmount: quantity },
      );
      Object.assign(
        drain.cells.find((c) => c.hatch === 'fluidIn'),
        { resource: 'recipe', fillFluid: fluid, fillAmount: 1000 },
      );
    }
  }
  return cases;
}
