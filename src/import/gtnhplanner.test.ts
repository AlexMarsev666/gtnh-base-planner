import { describe, expect, it } from 'vitest';
import { catalog } from '../data/catalog';
import { multiblockForName } from '../data/gtnhplanner-machines';
import { createSiteBuilder } from '../model/site/build';
import { validateSiteState } from '../share/siteCodec';
import fixture from './__fixtures__/gtnhplanner-titanium.json';
import {
  IMPORT_LIMITS,
  ImportError,
  arrangeOnFloors,
  buildSiteFromGtnh,
  fallbackColor,
  importRows,
  parseGtnhProject,
  proposeChoice,
  squareLimits,
} from './gtnhplanner';
import { getSiteDef } from '../data/generic';

const text = JSON.stringify(fixture);

describe('parseGtnhProject', () => {
  it('reads recipes, nodes, storages and edges and skips malformed entries', () => {
    const p = parseGtnhProject(text);
    expect(p.name).toBe('Titanium line (test fixture)');
    expect(p.recipes.size).toBe(8);
    expect(p.nodes).toHaveLength(9);
    expect(p.storages).toHaveLength(3);
    expect(p.edges).toHaveLength(13);
    expect(p.skipped).toBe(1);
    const cr = p.recipes.get('gt:chem:ticl4')!;
    expect(cr.inputs[3].consumed).toBe(false);
    expect(cr.handlers.map((h) => h.label)).toEqual(['Chemical Reactor', 'Large Chemical Reactor']);
  });

  it('explains what is wrong with other input', () => {
    expect(() => parseGtnhProject('')).toThrow(ImportError);
    expect(() => parseGtnhProject('{"a":')).toThrow(/not JSON/);
    expect(() => parseGtnhProject('{"nodes": 3}')).toThrow(/does not look like/);
    // A community download wraps the project.
    expect(parseGtnhProject(JSON.stringify({ plan: fixture })).nodes).toHaveLength(9);
  });

  it('refuses oversized sections before reading them, and skips oversized recipes', () => {
    for (const section of ['recipes', 'nodes', 'storages', 'edges'] as const) {
      const big = { ...fixture, [section]: new Array(IMPORT_LIMITS[section] + 1).fill(0) };
      expect(() => parseGtnhProject(JSON.stringify(big)), section).toThrow(/Too many/);
    }
    const stack = { kind: 'item', id: 'x' };
    const recipe = {
      id: 'huge',
      machineType: 'Mixer',
      inputs: new Array(IMPORT_LIMITS.stacks + 1).fill(stack),
    };
    const p = parseGtnhProject(JSON.stringify({ ...fixture, recipes: [...fixture.recipes, recipe] }));
    expect(p.recipes.has('huge')).toBe(false);
    expect(p.skipped).toBe(2);
  });

  it('flags files from a newer export format', () => {
    expect(parseGtnhProject(JSON.stringify({ ...fixture, schemaVersion: 1 })).newerSchema).toBe(false);
    expect(parseGtnhProject(JSON.stringify({ ...fixture, schemaVersion: 2 })).newerSchema).toBe(true);
    expect(parseGtnhProject(JSON.stringify({ ...fixture, schemaVersion: undefined })).newerSchema).toBe(
      false,
    );
  });
});

describe('machine mapping', () => {
  it('matches catalog names and aliases', () => {
    for (const d of catalog) expect(multiblockForName(d.name)).toBe(d.id);
    expect(multiblockForName('Blast Furnace')).toBe('electric-blast-furnace');
    expect(multiblockForName('LCR')).toBe('large-chemical-reactor');
    expect(multiblockForName('Oil Cracker')).toBe('oil-cracking-unit');
    expect(multiblockForName('Multiblock Electrolyzer')).toBe('industrial-electrolyzer');
    expect(multiblockForName('Multiblock Centrifuge')).toBe('industrial-centrifuge');
  });

  it('finds multiblocks by the machine type GT gives them, but not single-block machines', () => {
    const node = { id: 'n', recipeId: 'r', machineCount: 1, enabled: true };
    const recipe = (machineType: string) => ({
      id: 'r',
      name: 'x',
      machineType,
      inputs: [],
      outputs: [],
      handlers: [],
      generator: false,
    });
    const choice = (name: string) => proposeChoice(node, recipe(name));
    expect(choice('Vacuum Furnace')).toEqual({ type: 'multiblock', id: 'utupu-tanuri' });
    expect(choice('Chemical Plant')).toEqual({ type: 'multiblock', id: 'exxonmobil-chemical-plant' });
    expect(choice('Flotation Cell')).toEqual({ type: 'multiblock', id: 'flotation-cell-regulator' });
    expect(choice('Milling')).toEqual({ type: 'multiblock', id: 'isamill-grinding-machine' });
    expect(choice('Ozonation')).toEqual({ type: 'multiblock', id: 'ozonation-purification-unit' });
    // Also a GT++ machine type, but first of all a single-block machine.
    expect(choice('Electrolyzer')).toEqual({ type: 'single' });
    expect(choice('Something Unknown')).toEqual({ type: 'placeholder' });
    // Generators and tanks are machines of their own, not placeholders.
    expect(choice('Gas Turbine')).toEqual({ type: 'single' });
    expect(choice('Tank')).toEqual({ type: 'single' });
    expect(choice('Solid-Oxide Fuel Cell Mk I')).toEqual({
      type: 'multiblock',
      id: 'solid-oxide-fuel-cell-mk-i',
    });
  });

  it('gives an imported single-block machine the look of its machine', () => {
    const data = JSON.parse(text);
    const { site } = buildSiteFromGtnh(parseGtnhProject(JSON.stringify(data)));
    const electrolyzer = site.groups.find((g) => g.multiblockId === 'single-block')!;
    expect(electrolyzer.machine).toBe('electrolyzer');
    // Multiblocks have no machine look.
    for (const g of site.groups.filter((x) => x.multiblockId !== 'single-block'))
      expect(g.machine).toBeUndefined();
  });

  it('retains fluid IDs and source order when assigning Mega Oil Cracker roles', () => {
    const data = JSON.parse(text);
    const recipe = data.recipes.find((r: { id: string }) => r.id === 'gt:chem:ticl4');
    recipe.inputs = [
      { kind: 'fluid', id: 'heavy_oil', amount: 1000, displayName: 'Feed' },
      { kind: 'fluid', id: 'hydrogen', amount: 1000, displayName: 'Agent' },
    ];
    data.nodes = data.nodes.filter((n: { id: string }) => n.id === 'n1');
    data.storages = [];
    data.edges = [];
    const { site } = buildSiteFromGtnh(
      parseGtnhProject(JSON.stringify(data)),
      new Map([['n1', { type: 'multiblock', id: 'mega-oil-cracker' }]]),
    );
    expect(site.groups[0].resourceBindings).toEqual([
      { kind: 'fluidIn', resource: 'fluid:heavy_oil', role: 'feed' },
      { kind: 'fluidIn', resource: 'fluid:hydrogen', role: 'catalyst' },
    ]);
  });

  it('sizes Mega DT for native paired fractions and merges only consecutive overflow chunks', () => {
    const data = JSON.parse(text);
    const recipe = data.recipes.find((r: { id: string }) => r.id === 'gt:chem:ticl4');
    recipe.outputs = [
      { kind: 'fluid', id: 'a', amount: 2147483647 },
      { kind: 'fluid', id: 'a', amount: 1000 }, // Same native fraction, an overflow chunk.
      { kind: 'fluid', id: 'a', amount: 1000 }, // New native fraction, previous amount is not MAX_INT.
      { kind: 'fluid', id: 'b', amount: 1000 },
      { kind: 'fluid', id: 'c', amount: 1000 },
    ];
    data.nodes = data.nodes.filter((n: { id: string }) => n.id === 'n1');
    data.storages = [];
    data.edges = [];
    const project = parseGtnhProject(JSON.stringify(data));
    expect(project.recipes.get('gt:chem:ticl4')!.outputs[0].amount).toBe(2147483647);
    const build = (id: string) => buildSiteFromGtnh(project, new Map([['n1', { type: 'multiblock', id }]]));
    const { site } = build('mega-distillation-tower');
    expect(site.groups[0].size).toBe(36); // Two middle sections provide five slots.
    expect(site.groups[0].resourceBindings).toEqual([
      { kind: 'fluidOut', resource: 'fluid:a', role: 'product', outputSlot: 0 },
      { kind: 'fluidOut', resource: 'fluid:a', role: 'product', outputSlot: 1 },
      { kind: 'fluidOut', resource: 'fluid:b', role: 'product', outputSlot: 2 },
      { kind: 'fluidOut', resource: 'fluid:c', role: 'product', outputSlot: 3 },
    ]);
    const small = build('distillation-tower').site.groups[0];
    expect(small.resourceBindings).toHaveLength(5);
    expect(small.size).toBe(6); // The small tower dispatches every original array slot.
  });

  it('shows machines missing from the catalog as placeholders', () => {
    const data = JSON.parse(text);
    data.recipes.find((r: { id: string }) => r.id === 'gt:centrifuge:co').machineType = 'Mega Blast Furnace';
    const p = parseGtnhProject(JSON.stringify(data));
    expect(importRows(p).find((r) => r.node.id === 'n5')!.proposed).toEqual({ type: 'placeholder' });
    const { site, report } = buildSiteFromGtnh(p);
    expect(report.placeholders).toEqual(['Mega Blast Furnace']);
    expect(site.groups.find((g) => g.multiblockId === 'placeholder')?.label).toBe('Mega Blast Furnace');
  });

  it('proposes a machine per node', () => {
    const rows = importRows(parseGtnhProject(text));
    const by = Object.fromEntries(rows.map((r) => [r.node.id, r]));
    expect(by.n0.proposed).toEqual({ type: 'port' });
    // The node picked the Large Chemical Reactor handler.
    expect(by.n1.proposed).toEqual({ type: 'multiblock', id: 'large-chemical-reactor' });
    expect(by.n1.count).toBe(2);
    expect(by.n2.proposed).toEqual({ type: 'multiblock', id: 'electric-blast-furnace' });
    expect(by.n2.count).toBe(3);
    expect(by.n3.count).toBe(1);
    expect(by.n4.proposed).toEqual({ type: 'single' });
    expect(by.n5.proposed).toEqual({ type: 'multiblock', id: 'industrial-centrifuge' });
    expect(by.n6.proposed).toEqual({ type: 'skip' });
    expect(by.n7).toBeUndefined();
    expect(by.n8.proposed).toEqual({ type: 'multiblock', id: 'large-gas-turbine' });
  });
});

describe('buildSiteFromGtnh', () => {
  it('turns the chain into a valid, arranged site with ports for what enters and leaves', () => {
    const { site, report } = buildSiteFromGtnh(parseGtnhProject(text));
    expect(() => validateSiteState(site)).not.toThrow();
    expect(report).toMatchObject({
      groups: 6,
      aspects: 1,
      placeholders: [],
      truncated: false,
    });
    expect(site.groups.map((g) => g.multiblockId)).toEqual([
      'large-chemical-reactor',
      'electric-blast-furnace',
      'vacuum-freezer',
      'single-block',
      'industrial-centrifuge',
      'large-gas-turbine',
    ]);
    const name = (k: string) => site.resources[k]?.name;
    const ports = site.ports.map((p) => `${p.dir} ${name(p.resource)}${p.void ? ' (void)' : ''}`).sort();
    expect(ports).toEqual(['in Benzene', 'in Rutile Dust', 'out Oxygen (void)', 'out Titanium Ingot']);
    // The chlorine buffer is passed through: electrolyzer -> LCR directly.
    const chlorine = site.links.find((l) => l.resource === 'fluid:chlorine')!;
    expect(chlorine.from).toEqual({ group: 'g4' });
    expect(chlorine.to).toEqual({ group: 'g1' });
    expect(chlorine.rate).toBe(240);
    // Power from the turbine to the furnaces.
    expect(site.links.find((l) => l.resource === 'power:eu')).toMatchObject({
      from: { group: 'g6' },
      to: { group: 'g2' },
    });
    // Non-consumed inputs (programmed circuits) get no port.
    expect(Object.values(site.resources).some((r) => r.name === 'Programmed Circuit')).toBe(false);
  });

  it('builds and routes the imported site without overlaps', () => {
    const { site } = buildSiteFromGtnh(parseGtnhProject(text));
    const b = createSiteBuilder()(site, { pipes: true, cables: true });
    expect(
      b.warnings.filter(
        (w) =>
          w.type === 'overlap' || w.type === 'outside' || (w.type === 'error' && w.code !== 'electrical'),
      ),
    ).toEqual([]);
    const connected = b.nets.reduce((s, n) => s + (n.route?.connected ?? 0), 0);
    const total = b.nets.reduce((s, n) => s + (n.route?.total ?? 0), 0);
    expect(connected / total).toBeGreaterThan(0.9);
  });

  it('routes new imports within their three-block underground depth', () => {
    const { site } = buildSiteFromGtnh(parseGtnhProject(text), new Map(), { below: true });
    const b = createSiteBuilder()(site, { pipes: true, cables: true, below: true });
    const connected = b.nets.reduce((s, n) => s + (n.route?.connected ?? 0), 0);
    const total = b.nets.reduce((s, n) => s + (n.route?.total ?? 0), 0);
    expect(connected / total).toBeGreaterThan(0.9);
    for (const n of b.nets)
      for (const c of n.route?.paths.flat() ?? []) expect(c[1]).toBeGreaterThanOrEqual(-3);
  });

  it('sizes the site to the chain, smaller as well as larger, unless told not to', () => {
    const p = parseGtnhProject(text);
    const fitted = buildSiteFromGtnh(p, new Map(), { size: [128, 128] });
    expect(fitted.report.fits).toBe(true);
    expect(Math.max(...fitted.site.size)).toBeLessThan(80);
    const kept = buildSiteFromGtnh(p, new Map(), { size: [128, 128], fit: false });
    expect(kept.site.size).toEqual([128, 128]);
  });

  it('keeps a size it is given and builds on floors what does not fit its ground', () => {
    const p = parseGtnhProject(text);
    const { site, report } = buildSiteFromGtnh(p, new Map(), { size: [20, 20], fit: false });
    expect(site.size).toEqual([20, 20]);
    expect(report.floors).toBeGreaterThan(1);
    expect(report.fits).toBe(true);
    expect(site.groups.some((g) => (g.elevation ?? 0) > 0)).toBe(true);
    expect(() => validateSiteState(site)).not.toThrow();
    const b = createSiteBuilder()(site, { pipes: true, cables: true });
    expect(b.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
    const connected = b.nets.reduce((s, n) => s + (n.route?.connected ?? 0), 0);
    const total = b.nets.reduce((s, n) => s + (n.route?.total ?? 0), 0);
    expect(connected / total).toBeGreaterThan(0.9);
  });

  it('arranges a big template inside the size it already has, on floors, without growing it', () => {
    const p = parseGtnhProject(text);
    for (const n of p.nodes) n.machineCount *= 12;
    const builder = createSiteBuilder();
    // Imported at the size its chain wants, then squeezed into a smaller plot, as the Arrange button does.
    const { site: big, report } = buildSiteFromGtnh(p, new Map(), {}, builder);
    expect(report.floors).toBe(1);
    const small = { ...big, size: [24, 24] as [number, number] };
    const r = arrangeOnFloors(small, builder);
    expect(r.site.size).toEqual([24, 24]);
    expect(r.arranged.fits).toBe(true);
    expect(r.arranged.floors).toBeGreaterThan(1);
    const b = builder(r.site, { pipes: true, cables: true });
    expect(b.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
    // A plot that already holds it stays flat.
    const roomy = arrangeOnFloors({ ...big, size: [128, 128] }, builder);
    expect(roomy.arranged.floors).toBe(1);
    expect(roomy.site.groups.every((g) => g.elevation === undefined)).toBe(true);
  }, 15000); // Full routing of the 132-unit regression includes underground layers and structure validation.

  it('sizes to the chain by default and then needs no floors', () => {
    const { site, report } = buildSiteFromGtnh(parseGtnhProject(text));
    expect(report.floors).toBe(1);
    expect(site.groups.every((g) => g.elevation === undefined)).toBe(true);
  });

  it('stacks the machines of a group that is bigger than the ground itself', () => {
    const p = parseGtnhProject(text);
    for (const n of p.nodes) n.machineCount *= 12;
    const { site, report } = buildSiteFromGtnh(p, new Map(), { size: [24, 24], fit: false });
    expect(site.size).toEqual([24, 24]);
    expect(site.groups.some((g) => (g.limits.y ?? 1) > 1)).toBe(true);
    expect(report.floors).toBeGreaterThan(1);
  });

  it('never stacks a group whose limits are locked', () => {
    const p = parseGtnhProject(text);
    for (const n of p.nodes) n.machineCount *= 12;
    const builder = createSiteBuilder();
    const { site: big } = buildSiteFromGtnh(p, new Map(), {}, builder);
    const plain = arrangeOnFloors({ ...big, size: [24, 24] }, builder).site;
    const stacked = plain.groups.filter(
      (g) => JSON.stringify(g.limits) !== JSON.stringify(big.groups.find((x) => x.id === g.id)!.limits),
    );
    expect(stacked.length).toBeGreaterThan(0);
    const keep = new Set(stacked.map((g) => g.id));
    const pinned = {
      ...big,
      size: [24, 24] as [number, number],
      groups: big.groups.map((g) => (keep.has(g.id) ? { ...g, limitsLocked: true } : g)),
    };
    const r = arrangeOnFloors(pinned, builder);
    for (const g of r.site.groups.filter((x) => keep.has(x.id)))
      expect(g.limits).toEqual(big.groups.find((x) => x.id === g.id)!.limits);
  });

  it('stacks groups of several machines when that saves ground', () => {
    const p = parseGtnhProject(text);
    for (const n of p.nodes) n.machineCount *= 6;
    const { site } = buildSiteFromGtnh(p);
    const b = createSiteBuilder()(site, { pipes: false, cables: false });
    const stacked = site.groups.filter((g) => (g.limits.y ?? 1) > 1);
    expect(stacked.length).toBeGreaterThan(0);
    for (const g of stacked) {
      const pg = b.groups.find((x) => x.group.id === g.id)!;
      expect(new Set(pg.units.map((u) => u.origin[1])).size).toBe(g.limits.y);
      expect(pg.build!.size[1]).toBeLessThanOrEqual(24);
    }
    expect(site.groups.find((g) => g.multiblockId === 'single-block')!.limits.y).toBe(1);
    expect(
      b.warnings.filter(
        (w) =>
          ['overlap', 'outside', 'error', 'fewer', 'unplaced'].includes(w.type) &&
          !(w.type === 'error' && w.code === 'electrical'),
      ),
    ).toEqual([]);
  });

  it('follows overrides and grows a small site', () => {
    const p = parseGtnhProject(text);
    const { site, report } = buildSiteFromGtnh(
      p,
      new Map([
        ['n4', { type: 'skip' }],
        ['n5', { type: 'single' }],
      ]),
      { size: [12, 12] },
    );
    expect(site.groups.map((g) => g.multiblockId)).not.toContain('industrial-centrifuge');
    expect(report.skipped).toBe(3); // n4 by choice, n6 (Thaumcraft) and n7 (disabled)
    expect(site.size[0]).toBeGreaterThan(12);
    // With the electrolyzer skipped, magnesium enters and magnesium chloride leaves through ports.
    const names = site.ports.map((x) => site.resources[x.resource].name);
    expect(names).toContain('Magnesium Dust');
    expect(names).toContain('Magnesiumchloride Dust');
  });

  it('keeps GTNH Planner icon paths and drops anything else', () => {
    const p = parseGtnhProject(text);
    const { site } = buildSiteFromGtnh(p);
    expect(site.resources['fluid:chlorine'].icon).toMatch(/^\/datasets\/gtnh\/.+\/chlorine-[0-9a-f]+\.png$/);
    expect(site.resources['power:eu'].icon).toBeUndefined();
    const hostile = JSON.parse(text);
    hostile.recipes[1].inputs[0].iconPath = 'https://evil.example/pixel.png';
    const q = parseGtnhProject(JSON.stringify(hostile));
    expect(q.recipes.get('gt:chem:ticl4')!.inputs[0].iconPath).toBeUndefined();
  });

  it('packs a large group into a block instead of a strip', () => {
    const def = getSiteDef('solid-oxide-fuel-cell-mk-i')!;
    const limits = squareLimits(def, 107);
    expect(limits.x).not.toBeNull();
    const b = createSiteBuilder()(
      {
        v: 1,
        kind: 'site',
        size: [128, 128],
        corridor: 2,
        groups: [
          {
            id: 'g',
            multiblockId: def.id,
            count: 107,
            limits,
            enabledHatches: [],
            origin: [0, 0],
            rotation: 0,
          },
        ],
        links: [],
        ports: [],
        resources: {},
        colors: {},
      },
      { pipes: false, cables: false },
    );
    const size = b.groups[0].build!.size;
    expect(b.groups[0].units).toHaveLength(107);
    expect(Math.max(size[0], size[2])).toBeLessThan(64);
    // Small groups are packed as usual.
    expect(squareLimits(def, 4)).toEqual({ x: null, y: 1, z: null });
  });

  it('skips repeated node ids', () => {
    const data = JSON.parse(text);
    data.nodes.push({ ...data.nodes[1] });
    const p = parseGtnhProject(JSON.stringify(data));
    expect(p.nodes).toHaveLength(9);
    expect(p.skipped).toBe(2);
  });

  it('makes stable fallback colours', () => {
    expect(fallbackColor('item:x')).toMatch(/^#[0-9a-f]{6}$/);
    expect(fallbackColor('item:x')).toBe(fallbackColor('item:x'));
    expect(fallbackColor('item:x')).not.toBe(fallbackColor('item:y'));
  });
});
