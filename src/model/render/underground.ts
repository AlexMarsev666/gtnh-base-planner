import type { SceneModel } from './types';
import type { Vec3 } from '../core/types';

/** A view-only cut: the saved project, routing and materials list keep their complete model. */
export function undergroundScene(scene: SceneModel): SceneModel {
  const split = (path: Vec3[]): Vec3[][] => {
    const parts: Vec3[][] = [];
    let part: Vec3[] = [];
    for (const cell of path) {
      if (cell[1] < 0) part.push(cell);
      else if (part.length) {
        parts.push(part);
        part = [];
      }
    }
    if (part.length) parts.push(part);
    return parts;
  };
  return {
    ...scene,
    voxels: scene.voxels.filter((v) => v.pos[1] < 0),
    hatches: scene.hatches.filter((h) => h.cell[1] < 0),
    markers: scene.markers?.filter((m) => m.pos[1] < 0),
    labels: [],
    site: undefined,
    dimensions: undefined,
    pipes:
      scene.pipes?.map((p) => ({
        ...p,
        paths: p.paths.flatMap(split),
        flows: p.flows?.filter(([a, b]) => a[1] < 0 && b[1] < 0),
      })) ?? null,
    bounds: { min: [...scene.bounds.min], max: [scene.bounds.max[0], 0, scene.bounds.max[2]] },
  };
}
