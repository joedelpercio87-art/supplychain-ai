import type { DateRangeInput } from './types.ts';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateRange(input: DateRangeInput): void {
  validateDate(input.startDate, 'startDate');
  validateDate(input.endDate, 'endDate');
  if (input.startDate > input.endDate) {
    throw new TypeError('startDate must be on or before endDate');
  }
}

function validateDate(value: string, field: string): void {
  if (!DATE_PATTERN.test(value)) throw new TypeError(`${field} must use YYYY-MM-DD format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be a valid calendar date`);
  }
}

export function validateOptionalId(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}
