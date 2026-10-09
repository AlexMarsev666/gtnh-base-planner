/** Voltage names from GT5-Unofficial 5.09.54.205 GTValues.VN. */
export const VOLTAGE_TIERS = [
  'ULV',
  'LV',
  'MV',
  'HV',
  'EV',
  'IV',
  'LuV',
  'ZPM',
  'UV',
  'UHV',
  'UEV',
  'UIV',
  'UMV',
  'UXV',
  'MAX',
] as const;
export type VoltageTier = (typeof VOLTAGE_TIERS)[number];

export function isVoltageTier(value: unknown): value is VoltageTier {
  return typeof value === 'string' && (VOLTAGE_TIERS as readonly string[]).includes(value);
}

/** Transformers registered by RC2: tier is their lower side, MAX has no higher partner. */
export const TRANSFORMER_TIERS = VOLTAGE_TIERS.slice(0, -1);
