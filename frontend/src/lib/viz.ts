/**
 * Chart palette and defaults.
 *
 * One validated dark-mode palette drives every chart. Rules this file encodes:
 *   - categorical slots are assigned in a fixed order and never cycled
 *   - credit always takes slot 1, debit always slot 2 — colour follows the entity,
 *     not its rank, so filtering never repaints a series
 *   - magnitude encodings (pie shares, heatmap density) use the single-hue blue
 *     ramp, never a rainbow
 *   - charts whose marks are compared in every direction (pie, bubble) are capped
 *     at the first three slots, which are the ones that clear colour-blind
 *     separation on all pairs
 */
export const VIZ = {
  surface: '#1a1a19',
  surface2: '#20201f',
  plane: '#0d0d0d',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  ink3: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  hairline: 'rgba(255,255,255,0.10)',
} as const;

/** Fixed categorical order. Never generate a 4th hue — fold into "Other". */
export const SERIES = ['#3987e5', '#d95926', '#199e70'] as const;

export const CREDIT_COLOR = SERIES[0];
export const DEBIT_COLOR = SERIES[1];

export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Single-hue sequential ramp, light -> dark. */
export const RAMP = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
] as const;

/**
 * Ordered slice colours for a share-of-total pie: biggest slice takes the
 * brightest step so magnitude reads off lightness as well as arc length.
 */
export function rampSlice(index: number, total: number): string {
  if (total <= 1) return RAMP[6] as string;
  const span = Math.min(total, RAMP.length);
  const position = Math.round((index / (span - 1)) * (RAMP.length - 1));
  return RAMP[RAMP.length - 1 - position] as string;
}

/**
 * Heatmap cell colour. On a dark surface, "nothing happened" must recede into the
 * surface and density must grow brighter, so the ramp is walked upwards.
 */
export function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return VIZ.surface2;
  const steps = ['#184f95', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef', '#cde2fb'];
  const index = Math.min(steps.length - 1, Math.floor((value / max) * steps.length));
  return steps[index] as string;
}

export const AXIS_PROPS = {
  stroke: VIZ.axis,
  tick: { fill: VIZ.ink3, fontSize: 11 },
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: VIZ.grid,
  strokeDasharray: '2 6',
  vertical: false,
} as const;

export const accountStatusTone = (status: string): keyof typeof STATUS_COLORS =>
  status === 'active' ? 'good' : status === 'frozen' ? 'warning' : 'critical';
