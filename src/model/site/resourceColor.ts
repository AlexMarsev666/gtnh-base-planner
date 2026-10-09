/** A stable, readable colour for a resource without one (hue from a string hash). */
export function fallbackColor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const c = 0.55 * 0.7 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round((0.55 - c) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
