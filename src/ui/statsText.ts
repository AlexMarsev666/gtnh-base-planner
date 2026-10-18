import { t } from '../i18n/en';
import { isCable } from '../model/routing/kinds';
import type { PipelineResult } from './pipeline';
import { unitOrientation } from './orientationText';
import { errorCount } from './validityText';

export interface StatsParts {
  main: string[];
  selected: string | null;
}

/** The quiet bottom line: units · blocks · shared walls · hatches · saved (+ conflicts, pipes, cables, selection). */
export function statsParts(r: PipelineResult, selectedIds: number[]): StatsParts {
  const main: string[] = [];
  const units = r.pack?.units ?? [];
  if (r.pack) main.push(t.units(r.pack.placed));
  if (r.stats) {
    main.push(t.blocks(r.stats.totalBlocks));
    main.push(t.sharedWalls(r.stats.sharedWalls.length));
    main.push(t.hatchCount(r.stats.hatches));
    main.push(t.saved(r.stats.savedBlocks));
    if (r.stats.conflicts.length) main.push(t.conflicts(r.stats.conflicts.length));
  }
  const errors = errorCount(r.validity);
  if (errors) main.push(t.validity.wontForm(errors));
  const pipes = r.pipes?.filter((n) => !isCable(n.kind)) ?? [];
  const cables = r.pipes?.filter((n) => isCable(n.kind)) ?? [];
  if (pipes.length) main.push(t.pipeLength(pipes.reduce((s, n) => s + n.length, 0)));
  if (cables.length) main.push(t.cableLength(cables.reduce((s, n) => s + n.length, 0)));

  const flipped = units.filter((u) => unitOrientation(r.def, u.variant)).length;
  if (flipped) main.splice(1, 0, t.flippedUnits(flipped));

  const nums = selectedIds
    .map((id) => units.findIndex((u) => u.id === id) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const one = nums.length === 1 ? units[nums[0] - 1] : undefined;
  const how = one ? unitOrientation(r.def, one.variant) : null;
  return { main, selected: nums.length ? (how ? t.selectedHow(nums, how) : t.selected(nums)) : null };
}
