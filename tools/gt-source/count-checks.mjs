import { stripComments, findCalls, splitArgs } from './java.mjs';
const kinds = {
  InputBus: 'itemIn',
  OutputBus: 'itemOut',
  InputHatch: 'fluidIn',
  OutputHatch: 'fluidOut',
  EnergyHatch: 'energy',
  DynamoHatch: 'dynamo',
  MaintenanceHatch: 'maintenance',
  MufflerHatch: 'muffler',
};

/** Statements outside conditional scopes; do not turn branch-local calls into global requirements. */
function topLevel(body) {
  let depth = 0,
    top = '',
    literal = '',
    escaped = false;
  for (const c of stripComments(body)) {
    if (literal) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === literal) literal = '';
      if (!depth) top += c;
      continue;
    }
    if (c === '"' || c === "'") literal = c;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (!depth) top += '\n';
    } else if (!depth) top += c;
  }
  return top;
}

/** RC2 virtual checkHatches dispatch starts at the controller, even when checkMachine is inherited. */
export function countChecks(chain) {
  const checks = [],
    methods = [],
    visited = new Set();
  function visit(index, name) {
    const item = chain[index];
    const body = item?.methods[name];
    const key = index + ':' + name;
    if (!body || visited.has(key)) return;
    visited.add(key);
    methods.push({ ...item, body });
    const top = topLevel(body);
    for (const helper of ['checkHatch', 'checkHatches']) {
      for (const call of findCalls(top, helper)) {
        if (call.args.trim() !== 'errors') continue;
        const prefix = top.slice(top.lastIndexOf('\n', call.start) + 1, call.start).trim();
        if (!['', 'this.', 'super.'].includes(prefix)) continue;
        const from = prefix === 'super.' ? index + 1 : 0;
        const owner = chain.findIndex((c, i) => i >= from && c.methods[helper]);
        if (owner >= 0) visit(owner, helper);
      }
    }
  }
  for (let i = 0; i < chain.length; i++) {
    const body = chain[i].methods.checkMachine;
    if (!body) continue;
    visit(i, 'checkMachine');
    if (!/super\.checkMachine\s*\(/.test(stripComments(body))) break;
  }
  for (const item of methods) {
    const top = topLevel(item.body);
    for (const [helper, kind] of Object.entries(kinds))
      for (const prefix of ['Has', 'One']) {
        for (const call of findCalls(top, `check${prefix}${helper}`)) {
          if (top.slice(top.lastIndexOf('\n', call.start) + 1, call.start).trim()) continue;
          if (call.args.trim() !== 'errors') continue;
          checks.push({
            kind,
            min: 1,
            ...(prefix === 'One' ? { max: 1 } : {}),
            source: item.path,
            helper: `check${prefix}${helper}`,
          });
        }
      }
    for (const method of ['checkHatchMin', 'checkHatchMax', 'checkHatchExact'])
      for (const call of findCalls(top, method)) {
        if (top.slice(top.lastIndexOf('\n', call.start) + 1, call.start).trim()) continue;
        const args = splitArgs(call.args);
        const kind =
          kinds[
            args[1]?.replace(/^HatchElement\./, '') +
              (['Energy', 'Dynamo', 'Maintenance', 'Muffler'].includes(
                args[1]?.replace(/^HatchElement\./, ''),
              )
                ? 'Hatch'
                : '')
          ];
        if (args[0] !== 'errors' || !kind || !/^\d+$/.test(args[2] ?? '')) continue;
        const n = Number(args[2]);
        checks.push({
          kind,
          ...(method !== 'checkHatchMax' ? { min: n } : {}),
          ...(method !== 'checkHatchMin' ? { max: n } : {}),
          source: item.path,
          helper: method,
        });
      }
    const alternatives = {
      checkHasAnyInput: ['itemIn', 'fluidIn'],
      checkHasAnyOutput: ['itemOut', 'fluidOut'],
      checkHasAnyEnergy: ['energy'],
      checkHasAnyDynamo: ['dynamo'],
      checkOneEnergyHatchMaybeExotic: ['energy'],
    };
    for (const [helper, anyOf] of Object.entries(alternatives))
      for (const call of findCalls(top, helper)) {
        if (
          top.slice(top.lastIndexOf('\n', call.start) + 1, call.start).trim() ||
          call.args.trim() !== 'errors'
        )
          continue;
        checks.push({
          ...(anyOf.length === 1 ? { kind: anyOf[0] } : { anyOf }),
          min: 1,
          ...(helper.startsWith('checkOne') ? { max: 1 } : {}),
          source: item.path,
          helper,
        });
      }
  }
  return checks;
}
