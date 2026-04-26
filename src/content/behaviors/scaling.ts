// Talent scaling helpers.
//
// Designers configure effect values as (lv1Value, lv10Value) pairs. The
// helper linearly interpolates between them so that level 1 gives exactly
// lv1Value and level 10 gives exactly lv10Value. Levels outside [1, 10]
// extrapolate linearly (no clamping — alpha stage, fail loud if numbers
// look wrong in content review).
//
// Usage:
//   const chanceFn = fromTo(0.20, 0.60);  // lv1 → 20%, lv10 → 60%
//   chanceFn(1)  === 0.20
//   chanceFn(5)  ≈  0.3778
//   chanceFn(10) === 0.60

/**
 * Linear interpolation from lv1Value at level 1 to lv10Value at level 10.
 * Returns a function (level) => value.
 */
export function fromTo(lv1Value: number, lv10Value: number): (level: number) => number {
  const perLevel = (lv10Value - lv1Value) / 9;
  const base = lv1Value - perLevel; // value at "level 0"
  return (level: number) => base + perLevel * level;
}

/**
 * Square-root interpolation: value = base + factor × √level.
 * Configured as (lv1Value, lv10Value); factor and base derived automatically.
 *   lv1Value  = base + factor × √1  = base + factor
 *   lv10Value = base + factor × √10
 *   → factor = (lv10Value - lv1Value) / (√10 - 1)
 *   → base   = lv1Value - factor
 */
export function fromToSqrt(lv1Value: number, lv10Value: number): (level: number) => number {
  const sqrt10 = Math.sqrt(10);
  const factor = (lv10Value - lv1Value) / (sqrt10 - 1);
  const base = lv1Value - factor;
  return (level: number) => base + factor * Math.sqrt(level);
}

/** Format a 0–1 ratio as an integer percentage string, e.g. 0.15 → "15%". */
export function pctStr(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Format a number to fixed decimal places, e.g. fmtNum(1.342, 2) → "1.34". */
export function fmtNum(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}
