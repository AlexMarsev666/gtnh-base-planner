import { describe, expect, it } from 'vitest';
import { legendOpen, openOf, props, removeProp, setProp } from './json-text.mjs';

const text = `{
  "id": "t",
  "legend": {
    "A": { "blockId": "a", "hatches": ["itemIn"], "region": "dot1" },
    "\\"": {
      "blockId": "q",
      "hatches": ["energy"]
    },
    "'": { "blockId": "s" }
  },
  "requiredHatches": { "energy": { "min": 1 } },
  "defaultHatches": ["energy"]
}
`;

describe('json-text', () => {
  it('lists the properties of an object', () => {
    expect(props(text, openOf(text, [])).map((p) => p.key)).toEqual([
      'id',
      'legend',
      'requiredHatches',
      'defaultHatches',
    ]);
    expect(openOf(text, ['nothing'])).toBe(-1);
  });

  it('finds legend entries whatever their key', () => {
    for (const ch of ['A', '"', "'"]) expect(text[legendOpen(text, ch)]).toBe('{');
    expect(legendOpen(text, 'Z')).toBe(-1);
  });

  it('inserts a property in an inline entry before a named one, and at the end', () => {
    const before = setProp(
      text,
      legendOpen(text, 'A'),
      'allowFaces',
      { itemIn: ['down'] },
      { before: 'region' },
    );
    expect(before).toContain(
      '"hatches": ["itemIn"], "allowFaces": { "itemIn": [ "down" ] }, "region": "dot1" }',
    );
    expect(JSON.parse(before).legend.A.allowFaces).toEqual({ itemIn: ['down'] });
    const end = setProp(text, legendOpen(text, "'"), 'hatches', ['muffler']);
    expect(JSON.parse(end).legend["'"]).toEqual({ blockId: 's', hatches: ['muffler'] });
  });

  it('inserts a property in an expanded entry on its own line', () => {
    const out = setProp(text, legendOpen(text, '"'), 'allowFaces', { energy: ['up'] });
    expect(out).toContain('      "hatches": ["energy"],\n      "allowFaces": { "energy": [ "up" ] }\n    }');
    expect(JSON.parse(out).legend['"'].allowFaces).toEqual({ energy: ['up'] });
  });

  it('replaces a property in place and leaves the rest of the text alone', () => {
    const out = setProp(text, legendOpen(text, 'A'), 'hatches', ['itemIn', 'dataAccess']);
    expect(out.replace('[ "itemIn", "dataAccess" ]', '["itemIn"]')).toBe(text);
  });

  it('sets a top-level property before another', () => {
    const out = JSON.parse(
      setProp(
        text,
        openOf(text, []),
        'glassTierLimits',
        { chars: ['A'], kinds: ['energy'] },
        { before: 'defaultHatches' },
      ),
    );
    expect(Object.keys(out)).toEqual([
      'id',
      'legend',
      'requiredHatches',
      'glassTierLimits',
      'defaultHatches',
    ]);
  });

  it('removes a property with its comma, and its line', () => {
    const added = setProp(text, legendOpen(text, '"'), 'allowFaces', { energy: ['up'] });
    expect(JSON.parse(removeProp(added, legendOpen(added, '"'), 'allowFaces'))).toEqual(JSON.parse(text));
    expect(removeProp(added, legendOpen(added, '"'), 'allowFaces')).toBe(text);
    const first = removeProp(text, legendOpen(text, 'A'), 'blockId');
    expect(JSON.parse(first).legend.A).toEqual({ hatches: ['itemIn'], region: 'dot1' });
    expect(removeProp(text, legendOpen(text, 'A'), 'missing')).toBe(text);
  });
});
