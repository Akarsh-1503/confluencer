import { AppError } from '../errors/AppError.js';

/**
 * Money is stored and computed as an integer number of minor units (paise/cents).
 * Floating point never touches a balance: the API parses the decimal input once, works
 * in integers, and formats back to a decimal only on the way out.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/** 1 trillion major units — a guard rail against overflow and typo-sized amounts. */
export const MAX_AMOUNT_MINOR = 100_000_000_000_000;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function toMinorUnits(
  input: unknown,
  field = 'amount',
): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw AppError.validation('Amount must be a finite number', [
        { field, message: 'Amount must be a finite number' },
      ]);
    }
    return toMinorUnits(input.toFixed(10).replace(/0+$/, '').replace(/\.$/, ''), field);
  }

  if (typeof input !== 'string' || !DECIMAL_PATTERN.test(input.trim())) {
    throw AppError.validation('Amount must be a decimal number with at most 2 decimal places', [
      { field, message: 'Amount must be a decimal number with at most 2 decimal places' },
    ]);
  }

  const trimmed = input.trim();
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > 2) {
    throw AppError.validation('Amount supports a maximum of 2 decimal places', [
      { field, message: 'Amount supports a maximum of 2 decimal places' },
    ]);
  }

  const negative = whole.startsWith('-');
  const wholeDigits = negative ? whole.slice(1) : whole;
  const paddedFraction = fraction.padEnd(2, '0');
  const minor = Number(wholeDigits) * MINOR_UNITS_PER_MAJOR + Number(paddedFraction);

  if (!Number.isSafeInteger(minor)) {
    throw AppError.validation('Amount is too large', [{ field, message: 'Amount is too large' }]);
  }

  return negative ? -minor : minor;
}

/** Parses a user supplied amount and enforces the "> 0" and upper bound rules. */
export function parsePositiveAmount(input: unknown, field = 'amount'): number {
  const minor = toMinorUnits(input, field);
  if (minor <= 0) {
    throw AppError.validation('Amount must be greater than 0', [
      { field, message: 'Amount must be greater than 0' },
    ]);
  }
  if (minor > MAX_AMOUNT_MINOR) {
    throw AppError.validation('Amount exceeds the maximum supported value', [
      { field, message: `Amount must be at most ${MAX_AMOUNT_MINOR / MINOR_UNITS_PER_MAJOR}` },
    ]);
  }
  return minor;
}

/** Minor units -> number with 2 decimal places, safe for JSON and charting. */
export function toMajorUnits(minor: number): number {
  return Math.round(minor) / MINOR_UNITS_PER_MAJOR;
}

/** Minor units -> fixed string, used wherever exact text output matters. */
export function formatMajorUnits(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(minor));
  const whole = Math.floor(absolute / MINOR_UNITS_PER_MAJOR);
  const fraction = String(absolute % MINOR_UNITS_PER_MAJOR).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}
