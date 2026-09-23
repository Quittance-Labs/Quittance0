/**
 * Stroop-accurate amount helpers for frontend export and display.
 */

export const STROOP_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Expands JavaScript exponential toString output into plain decimal representation.
 *
 * @param str - Input string possibly containing exponential notation.
 * @returns Decimal representation without exponential tokens.
 */
function expandExponential(str) {
  if (!/[eE]/.test(str)) {
    return str;
  }
  const parts = str.split(/[eE]/);
  if (parts.length !== 2) {
    return str;
  }
  const [mantissa, exponentRaw] = parts;
  const exponent = Number.parseInt(exponentRaw, 10);
  if (
    !Number.isFinite(exponent) ||
    !/^[+-]?\d+$/.test(exponentRaw) ||
    !/^-?\d+(\.\d+)?$/.test(mantissa)
  ) {
    return str;
  }
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const dotIndex = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const dotPosition = dotIndex === -1 ? digits.length : dotIndex;
  const newDot = dotPosition + exponent;
  let expanded;
  if (newDot <= 0) {
    expanded = '0.' + '0'.repeat(-newDot) + digits;
  } else if (newDot >= digits.length) {
    expanded = digits + '0'.repeat(newDot - digits.length);
  } else {
    expanded = digits.slice(0, newDot) + '.' + digits.slice(newDot);
  }
  return (negative ? '-' : '') + expanded;
}

/**
 * Parses a string, number, or bigint amount into integer stroops.
 *
 * @param value - Value to parse.
 * @returns BigInt count of stroops, or null if input is invalid.
 */
export function parseStroops(value) {
  if (value === null || value === undefined || typeof value === 'object') {
    return null;
  }

  let str;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    str = value.toString();
  } else if (typeof value === 'string') {
    str = value.trim();
    if (!str) {
      return null;
    }
  } else if (typeof value === 'bigint') {
    return value < 0n ? null : value;
  } else {
    return null;
  }

  str = expandExponential(str);

  if (!/^\d+(\.\d+)?$/.test(str)) {
    return null;
  }

  const [intPart, fracPart = ''] = str.split('.');
  if (fracPart.length > STROOP_DECIMALS) {
    const frac7 = fracPart.slice(0, STROOP_DECIMALS);
    const eighthDigit = parseInt(fracPart[STROOP_DECIMALS], 10);
    let stroops = BigInt(intPart) * STROOPS_PER_UNIT + BigInt(frac7);
    if (eighthDigit >= 5) {
      stroops += 1n;
    }
    return stroops;
  }

  return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(fracPart.padEnd(STROOP_DECIMALS, '0'));
}

/**
 * Formats integer stroops into a 7-decimal string.
 *
 * @param stroops - Count of stroops to format.
 * @returns Formatted 7-decimal string.
 */
export function formatStroops(stroops) {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const intPart = absStroops / STROOPS_PER_UNIT;
  const fracPart = (absStroops % STROOPS_PER_UNIT).toString().padStart(STROOP_DECIMALS, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/**
 * Converts a raw amount value to its canonical 7-decimal string representation.
 *
 * @param value - Raw amount value.
 * @returns Canonical 7-decimal string, or null when invalid.
 */
export function canonicalAmount(value) {
  const stroops = parseStroops(value);
  return stroops === null ? null : formatStroops(stroops);
}

/**
 * Checks stroop-exact equality between two amount representations.
 *
 * @param expected - Expected amount.
 * @param actual - Actual amount.
 * @returns True if both amounts represent the same stroop count.
 */
export function amountsEqual(expected, actual) {
  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);
  return expectedStroops !== null && actualStroops !== null && expectedStroops === actualStroops;
}
