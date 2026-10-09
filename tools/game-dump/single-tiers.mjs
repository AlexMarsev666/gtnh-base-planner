#!/usr/bin/env node
/** Extract concrete tier registrations from pinned source names, not an assumed universal tier range. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCalls, splitArgs, stringValue, stripComments } from '../gt-source/java.mjs';
import { readPinnedSource } from '../gt-source/pinned-source.mjs';
const root = process.argv[2];
if (!root) throw new Error('Expected RC2 checkout.');
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const registrations = new Map();
function visit(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) visit(p);
    else if (e.name.endsWith('.java'))
      for (const match of readFileSync(p, 'utf8').matchAll(
        /"(?:basicmachine\.|generator\.)?([a-z0-9_.]+)\.tier\.(\d+)"/g,
      )) {
        const key = normalize(match[1]);
        const tier = Number(match[2]);
        if (tier <= 14) registrations.set(key, new Set([...(registrations.get(key) ?? []), tier]));
      }
  }
}
visit(join(root, 'src/main/java'));
// These registrations have named variants, not a .tier.N suffix. Extract their concrete IDs/tiers
// from the verified loader and enum rather than creating non-existent intervening tiers.
const ids = readPinnedSource(root, 'src/main/java/gregtech/api/enums/MetaTileEntityIDs.java');
const loader = readPinnedSource(root, 'src/main/java/gregtech/loaders/preload/LoaderMetaTileEntities.java');
readPinnedSource(root, 'src/main/java/gregtech/api/metatileentity/implementations/MTEHatchDataAccess.java');
const dataAccess = findCalls(stripComments(loader), 'MTEHatchDataAccess')
  .map((call) => {
    const args = splitArgs(call.args);
    const symbol = args[0].replace(/\.ID$/, '');
    const meta = ids.match(new RegExp(`\\b${symbol}\\((\\d+)\\)`))?.[1];
    const tier = Number(args[3]);
    const name = stringValue(args[2]);
    if (!meta || !name || !Number.isInteger(tier) || tier < 0 || tier > 14)
      throw new Error('Unsupported Data Access registration');
    return { meta: Number(meta), tier, name };
  })
  .sort((a, b) => a.tier - b.tier);
if (dataAccess.length !== 3) throw new Error('Expected all three pinned Data Access variants');
const dataLoader = readPinnedSource(root, 'src/main/java/tectech/loader/thing/MachineLoader.java');
const dataInterfaces = {};
for (const [kind, cls] of Object.entries({
  assemblyDataIn: 'MTEHatchDataItemsInput',
  assemblyDataOut: 'MTEHatchDataItemsOutput',
  wirelessAssemblyDataIn: 'MTEHatchWirelessDataItemsInput',
  wirelessAssemblyDataOut: 'MTEHatchWirelessDataItemsOutput',
})) {
  readPinnedSource(root, `src/main/java/tectech/thing/metaTileEntity/hatch/${cls}.java`);
  const calls = findCalls(stripComments(dataLoader), cls);
  if (calls.length !== 1) throw new Error(`Expected one registered ${cls}`);
  const args = splitArgs(calls[0].args);
  const meta = ids.match(new RegExp(`\\b${args[0].replace(/\.ID$/, '')}\\((\\d+)\\)`))?.[1];
  const tier = Number(args[3]);
  const name = stringValue(args[2]);
  if (!meta || !name || !Number.isInteger(tier) || tier < 0 || tier > 14)
    throw new Error(`Unsupported registration ${cls}`);
  dataInterfaces[kind] = { meta: Number(meta), tier, name };
}
const machines = JSON.parse(readFileSync('src/data/single-machines.json', 'utf8'));
const aliases = {
  'mass-fabricator': 'massfab',
  'electric-furnace': 'efurnace',
  'electric-oven': 'eoven',
  'fluid-canner': 'fluidcanner',
  'forming-press': 'press',
  packager: 'boxinator',
  unpackager: 'unboxinator',
  'mob-replicator': 'mobrep',
};
const out = {};
for (const m of machines) {
  const sprite = m.sprite?.split('/')[1];
  const keys = [aliases[m.id], m.id, sprite, m.name, ...m.names].filter(Boolean).map(normalize);
  const tiers = keys.map((k) => registrations.get(k)).find((t) => t?.size);
  out[m.id] = tiers ? [...tiers].sort((a, b) => a - b) : [];
}
writeFileSync(
  'src/data/single-tiers.generated.json',
  JSON.stringify(
    {
      source: 'GT5-Unofficial 5.09.54.205',
      tiers: out,
      dataAccess,
      dataInterfaces,
      hatches: {
        ...Object.fromEntries(
          Object.entries({
            itemIn: 'inputbus',
            itemOut: 'outputbus',
            fluidIn: 'input',
            fluidOut: 'output',
            energy: 'energy',
            dynamo: 'dynamo',
            muffler: 'muffler',
          }).map(([kind, name]) => [
            kind,
            [...(registrations.get('hatch' + name) ?? [])].sort((a, b) => a - b),
          ]),
        ),
        dataAccess: dataAccess.map((variant) => variant.tier),
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ unresolved: Object.keys(out).filter((k) => !out[k].length) }));
