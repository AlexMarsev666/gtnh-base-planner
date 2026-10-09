import type { SiteBuild, SiteWarning } from './buildTypes';

/** Routing quality is ranked separately; an obsolete manual assignment is a nonfatal notice. */
export function layoutViolations(build: SiteBuild): SiteWarning[] {
  return build.warnings.filter((w) => w.type !== 'assignment' && w.type !== 'unrouted');
}

/** Aggregated warnings retain the number of missing hatches/controllers they represent. */
export function layoutViolationCount(build: SiteBuild): number {
  return layoutViolations(build).reduce((sum, warning) => sum + violationWeight(warning), 0);
}

/** Same structural error at a moved cell is the same violation. Keep controller IDs and multiplicity. */
export function violationKey(warning: SiteWarning): string {
  if (warning.type === 'error')
    return JSON.stringify({
      ...warning,
      message: warning.message.replace(/(\bat \(?|\bcell )-?\d+(?:, ?-?\d+){2}/g, '$1<cell>'),
    });
  if (warning.type === 'missing') return JSON.stringify({ ...warning, units: undefined });
  if (warning.type === 'unplaced') return JSON.stringify({ ...warning, count: undefined });
  if (warning.type === 'fewer') return JSON.stringify({ ...warning, placed: undefined });
  return JSON.stringify(warning);
}

export function violationWeight(warning: SiteWarning): number {
  if (warning.type === 'missing') return warning.units;
  if (warning.type === 'unplaced') return warning.count;
  if (warning.type === 'fewer') return warning.requested - warning.placed;
  return 1;
}

/** Arrange may remove existing violations, but must not introduce a new one or increase its deficit. */
export function addsLayoutViolations(before: SiteBuild, after: SiteBuild): boolean {
  const available = new Map<string, number>();
  for (const warning of layoutViolations(before)) {
    const key = violationKey(warning);
    available.set(key, (available.get(key) ?? 0) + violationWeight(warning));
  }
  for (const warning of layoutViolations(after)) {
    const key = violationKey(warning);
    const remaining = (available.get(key) ?? 0) - violationWeight(warning);
    if (remaining < 0) return true;
    available.set(key, remaining);
  }
  return false;
}
