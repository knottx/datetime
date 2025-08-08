/**
 * Timestamp parsing and formatting. Pure functions, no DOM access.
 *
 * The canonical instant is an integer count of nanoseconds since 1970-01-01T00:00:00Z, stored as a BigInt.
 * Unit conversions stay in integer arithmetic and round toward negative infinity (floor), so -1 ns is
 * -1 ms / -1 µs / -1 s and formats as 1969-12-31T23:59:59.999999999Z.
 *
 * Local time means the browser's timezone. It is read through `Date`'s local getters, which follow the
 * IANA rules of the runtime (and the TZ environment variable in Node, which the tests rely on).
 */

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const EPOCH_UNITS: readonly EpochUnit[] = ['s', 'ms', 'us', 'ns'];

export const UNIT_NS: Readonly<Record<EpochUnit, bigint>> = {
  s: 1_000_000_000n,
  ms: 1_000_000n,
  us: 1_000n,
  ns: 1n,
};

export const UNIT_SYMBOL: Readonly<Record<EpochUnit, string>> = { s: 's', ms: 'ms', us: 'µs', ns: 'ns' };
export const UNIT_NAME: Readonly<Record<EpochUnit, string>> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
};

const NS_PER_MS = 1_000_000n;
const NS_PER_S = 1_000_000_000n;
const MS_PER_DAY = 86_400_000;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/** Integer division rounding toward negative infinity (BigInt `/` truncates toward zero). */
export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** Epoch milliseconds for proleptic Gregorian UTC fields. Unlike `Date.UTC`, years 0–99 are taken literally. */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getTime();
}

/* ---------- supported range ---------- */

/**
 * 0001-01-02T00:00:00Z through 9999-12-30T23:59:59.999999999Z.
 * One day inside years 0001–9999 at each end, so local time in every timezone (offsets are under 24 hours)
 * still has a four-digit year, and every value converts safely to a `Date` (limit ±8.64e15 ms).
 */
export const MIN_EPOCH_NS = BigInt(utcMs(1, 1, 2)) * NS_PER_MS;
export const MAX_EPOCH_NS = BigInt(utcMs(9999, 12, 31)) * NS_PER_MS - 1n;
export const RANGE_TEXT = '0001-01-02T00:00:00Z to 9999-12-30T23:59:59.999999999Z';

export const isInRange = (ns: bigint): boolean => ns >= MIN_EPOCH_NS && ns <= MAX_EPOCH_NS;

/** Range limits expressed in a unit (rounded inward so both ends are representable). */
export function rangeInUnit(unit: EpochUnit): { min: bigint; max: bigint } {
  const size = UNIT_NS[unit];
  return { min: -floorDiv(-MIN_EPOCH_NS, size), max: floorDiv(MAX_EPOCH_NS, size) };
}

/* ---------- local timezone ---------- */

/** The browser's IANA timezone ID, e.g. "Asia/Bangkok", or null when unavailable. */
export function timeZoneId(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Local UTC offset in milliseconds at an instant (may include seconds for historical local mean time). */
function localOffsetMs(epochMs: number): number {
  const d = new Date(epochMs);
  const wall = utcMs(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
  return wall - epochMs;
}

/* ---------- formatting ---------- */

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

function utcFields(epochMs: number): Fields {
  const d = new Date(epochMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const formatDateTime = (f: Fields): string =>
  `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}`;

/** Nanoseconds within a second → at least 3 digits, keeping further significant digits up to 9. */
function formatFraction(nanos: bigint): string {
  const trimmed = nanos.toString().padStart(9, '0').replace(/0+$/, '');
  return trimmed.padEnd(3, '0');
}

/** ±HH:MM, or ±HH:MM:SS when the offset has a seconds part (pre-standard local mean time). */
export function formatOffset(offsetMs: number): string {
  const total = Math.round(Math.abs(offsetMs) / 1000);
  const sign = offsetMs < 0 ? '-' : '+';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${sign}${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ''}`;
}

export interface Formatted {
  utc: string;
  local: string;
  /** Local offset at this instant, e.g. "+07:00". */
  offset: string;
  s: string;
  ms: string;
  us: string;
  ns: string;
  /** Epoch milliseconds (floored) for `Date`/`Intl` display helpers. */
  epochMs: number;
}

/** Formats an in-range instant. Throws RangeError otherwise, so callers must validate first. */
export function formatInstant(ns: bigint): Formatted {
  if (!isInRange(ns)) throw new RangeError(`Instant outside ${RANGE_TEXT}`);

  const seconds = floorDiv(ns, NS_PER_S);
  const fraction = formatFraction(ns - seconds * NS_PER_S); // always 0..999 999 999, even for negative instants
  const wholeMs = Number(seconds) * 1000; // safe: the range check bounds this far inside ±8.64e15
  const offsetMs = localOffsetMs(wholeMs);
  const offset = formatOffset(offsetMs);

  return {
    utc: `${formatDateTime(utcFields(wholeMs))}.${fraction}Z`,
    local: `${formatDateTime(utcFields(wholeMs + offsetMs))}.${fraction}${offset}`,
    offset,
    s: seconds.toString(),
    ms: floorDiv(ns, UNIT_NS.ms).toString(),
    us: floorDiv(ns, UNIT_NS.us).toString(),
    ns: ns.toString(),
    epochMs: Number(floorDiv(ns, UNIT_NS.ms)),
  };
}

/** Value for an `<input type="datetime-local" step="1">`: local wall time, whole seconds. */
export function toLocalInputValue(ns: bigint): string {
  const wholeMs = Number(floorDiv(ns, NS_PER_S)) * 1000;
  return formatDateTime(utcFields(wholeMs + localOffsetMs(wholeMs)));
}

/* ---------- now ---------- */

/** The browser clock at millisecond precision, as epoch nanoseconds. */
export const nowNs = (): bigint => BigInt(Date.now()) * NS_PER_MS;

/* ---------- Unix timestamp input ---------- */

/** The unit a timestamp's digit count usually implies (10 → s, 13 → ms, 16 → µs, 19 → ns). */
export function typicalUnit(digits: number): EpochUnit {
  if (digits <= 11) return 's';
  if (digits <= 14) return 'ms';
  if (digits <= 17) return 'us';
  return 'ns';
}

/** Number of digits in an integer string, ignoring sign and leading zeros. */
export function digitCount(raw: string): number {
  return raw.trim().replace(/^[+-]/, '').replace(/^0+(?=\d)/, '').length;
}

export function parseEpoch(input: string, unit: EpochUnit): Result<bigint> {
  const raw = input.trim();
  if (raw === '') return fail('Enter a Unix timestamp, such as 1794510299.');

  if (!/^[+-]?\d+$/.test(raw)) {
    if (/^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(raw)) {
      return fail('Exponent notation isn’t supported. Enter every digit, such as 1794510299000.');
    }
    if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(raw)) {
      return fail(
        unit === 'ns'
          ? 'Enter a whole number. Nanoseconds are the smallest unit.'
          : 'Enter a whole number. For fractions of a second, pick a smaller unit and remove the decimal point.',
      );
    }
    if (/^[+-]?\d+([,_ '’  .]\d+)+$/.test(raw)) {
      return fail('Remove the commas, spaces, or other separators between digits.');
    }
    return fail('Use digits only, with an optional leading minus sign.');
  }

  const ns = BigInt(raw) * UNIT_NS[unit];
  if (isInRange(ns)) return ok(ns);

  const { min, max } = rangeInUnit(unit);
  const suggested = typicalUnit(digitCount(raw));
  const tip =
    suggested !== unit && isInRange(BigInt(raw) * UNIT_NS[suggested])
      ? ` ${digitCount(raw)} digits usually means ${UNIT_NAME[suggested]}. Try the ${UNIT_SYMBOL[suggested]} unit.`
      : '';
  return fail(`Out of range for ${UNIT_NAME[unit]} (${min} to ${max}).${tip}`);
}

/* ---------- ISO 8601 input ---------- */

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?([Zz]|[+-]\d{2}:\d{2})?$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number): number =>
  m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

/** Checks calendar and clock fields. Returns an error message or null. */
function validateFields(f: Fields): string | null {
  if (f.month < 1 || f.month > 12) return `Month ${pad(f.month)} doesn’t exist. Use 01 to 12.`;
  const days = daysInMonth(f.year, f.month);
  if (f.day < 1 || f.day > days) {
    return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)} doesn’t exist. ${MONTHS[f.month - 1]} ${pad(f.year, 4)} has ${days} days.`;
  }
  if (f.hour === 24) return 'Use 00:00:00 on the next day instead of 24:00:00.';
  if (f.hour > 23) return 'Hour must be 00 to 23.';
  if (f.minute > 59) return 'Minute must be 00 to 59.';
  if (f.second === 60) return 'Leap seconds (:60) aren’t supported. Unix time doesn’t count them.';
  if (f.second > 59) return 'Second must be 00 to 59.';
  return null;
}

function diagnoseIso(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Add a time and timezone, such as 2026-11-12T19:04:59Z.';
  if (/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}([Zz]|[+-]\d{2}:?\d{2})?$/.test(raw)) {
    return 'Add seconds to the time, such as 19:04:00.';
  }
  if (/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}([.,]\d+)?[+-]\d{2}(\d{2})?$/.test(raw)) {
    return 'Write the offset as ±HH:MM, such as +07:00.';
  }
  if (/^\d{8}[Tt]\d{6}/.test(raw)) return 'Use separators: YYYY-MM-DDTHH:mm:ss, such as 2026-11-12T19:04:59Z.';
  if (/^[+-]?\d+$/.test(raw)) return 'This looks like a Unix timestamp. Use the Unix timestamp tab.';
  return 'Use YYYY-MM-DDTHH:mm:ss with Z or an offset, such as 2026-11-12T19:04:59.737Z.';
}

export function parseIso(input: string): Result<bigint> {
  const raw = input.trim();
  if (raw === '') return fail('Enter an ISO 8601 date and time, such as 2026-11-12T19:04:59.737Z.');

  const match = ISO_PATTERN.exec(raw);
  if (!match) return fail(diagnoseIso(raw));

  const [, y, mo, d, h, mi, s, frac = '', zone] = match;
  const fields: Fields = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };

  if (frac.length > 9) return fail('Use at most 9 fractional digits (nanosecond precision).');
  if (zone === undefined) {
    return fail(
      'Add a timezone: Z for UTC or an offset such as +07:00. For a time in your own timezone, use Local date & time.',
    );
  }
  const invalid = validateFields(fields);
  if (invalid) return fail(invalid);

  let offsetSeconds = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return fail('Offset must be between -23:59 and +23:59.');
    offsetSeconds = (zone[0] === '-' ? -1 : 1) * (offsetHours * 3600 + offsetMinutes * 60);
  }

  const wallMs = utcMs(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second);
  const ns = BigInt(wallMs) * NS_PER_MS + BigInt(frac.padEnd(9, '0')) - BigInt(offsetSeconds) * NS_PER_S;
  return isInRange(ns) ? ok(ns) : fail(`Out of range. Supported: ${RANGE_TEXT}.`);
}

/* ---------- local date & time input ---------- */

export interface LocalConversion {
  ns: bigint;
  /** Offset used for the conversion, e.g. "-04:00". */
  offset: string;
  /** Set when the wall time occurs twice (DST fall-back): the later occurrence, as an ISO string. */
  laterOccurrence: string | null;
}

/** Formats a whole-second local wall time for messages, e.g. "2026-03-08 02:30". */
const describeWall = (f: Fields): string =>
  `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)} ${pad(f.hour)}:${pad(f.minute)}${f.second ? `:${pad(f.second)}` : ''}`;

/**
 * Converts a wall-clock time in the browser's timezone, as produced by `<input type="datetime-local">`
 * (YYYY-MM-DDTHH:mm, optionally :ss and .sss). Nonexistent times (DST gaps) are rejected; repeated
 * times (DST overlaps) resolve to the earlier occurrence.
 */
export function parseLocal(input: string): Result<LocalConversion> {
  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input.trim());
  if (!match) return fail('Pick a date and time.');

  const [, y, mo, d, h, mi, s = '0', frac = ''] = match;
  const fields: Fields = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  const invalid = validateFields(fields);
  if (invalid) return fail(invalid);
  if (fields.year < 1 || fields.year > 9999) return fail(`Out of range. Supported: ${RANGE_TEXT}.`);

  const millis = Number(frac.padEnd(3, '0'));
  const wall = utcMs(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second, millis);

  // Any offset that applies to this wall time is in effect within a day of it.
  const offsets = new Set([localOffsetMs(wall - MS_PER_DAY), localOffsetMs(wall), localOffsetMs(wall + MS_PER_DAY)]);
  const instants = [...offsets]
    .map((offset) => wall - offset)
    .filter((t) => wall - t === localOffsetMs(t))
    .sort((a, b) => a - b);

  const zone = timeZoneId() ?? 'your timezone';
  const earliest = instants[0];
  if (earliest === undefined) {
    // Clocks skipped this wall time. Suggest where the same elapsed time lands after the jump.
    const suggestion = toLocalInputValue(BigInt(wall - localOffsetMs(wall - MS_PER_DAY)) * NS_PER_MS);
    return fail(
      `${describeWall(fields)} doesn’t exist in ${zone} because clocks move forward for daylight saving time. Try ${suggestion.slice(11, 16)} instead.`,
    );
  }

  const ns = BigInt(earliest) * NS_PER_MS;
  if (!isInRange(ns)) return fail(`Out of range. Supported: ${RANGE_TEXT}.`);

  const later = instants.length > 1 ? instants[instants.length - 1] : undefined;
  return ok({
    ns,
    offset: formatOffset(localOffsetMs(earliest)),
    laterOccurrence: later === undefined ? null : formatInstant(BigInt(later) * NS_PER_MS).local,
  });
}
