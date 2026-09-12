/** Display native carbon deltas at their 0.0001 t resolution without changing report values. */
export const formatCarbonDeltaTons = (value: number, signed = false): string => {
  const digits = Math.abs(value) < 0.1 ? 4 : 1;
  const rounded = Number(value.toFixed(digits));
  const formatted = rounded === 0 ? '0.0' : digits === 1 ? rounded.toFixed(1) : String(rounded);
  return signed && rounded > 0 ? `+${formatted}` : formatted;
};
