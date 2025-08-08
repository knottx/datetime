/**
 * Conversion checks. Run with `npm test` (Node 23.6+ runs TypeScript directly).
 * Timezone-specific checks set process.env.TZ explicitly; Node applies it immediately.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_EPOCH_NS,
  MIN_EPOCH_NS,
  floorDiv,
  formatInstant,
  parseEpoch,
  parseIso,
  parseLocal,
  rangeInUnit,
  toLocalInputValue,
  type Result,
} from '../src/lib/time.ts';

function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(`Expected success, got: ${result.error}`);
  return result.value;
}

function error<T>(result: Result<T>): string {
  if (result.ok) assert.fail(`Expected an error, got: ${String(result.value)}`);
  return result.error;
}

const inZone = (tz: string): void => {
  process.env.TZ = tz;
};

describe('floorDiv', () => {
  it('rounds toward negative infinity', () => {
    assert.equal(floorDiv(7n, 2n), 3n);
    assert.equal(floorDiv(-7n, 2n), -4n);
    assert.equal(floorDiv(-1n, 1_000_000n), -1n);
    assert.equal(floorDiv(-1_000_000n, 1_000_000n), -1n);
    assert.equal(floorDiv(0n, 5n), 0n);
  });
});

describe('reference instant (Asia/Bangkok)', () => {
  const NS = 1794510299737000000n;
  const expected = {
    utc: '2026-11-12T19:04:59.737Z',
    local: '2026-11-13T02:04:59.737+07:00',
    s: '1794510299',
    ms: '1794510299737',
    us: '1794510299737000',
    ns: '1794510299737000000',
  };

  it('formats every output from one instant', () => {
    inZone('Asia/Bangkok');
    const f = formatInstant(NS);
    assert.equal(f.utc, expected.utc);
    assert.equal(f.local, expected.local);
    assert.equal(f.offset, '+07:00');
    assert.equal(f.s, expected.s);
    assert.equal(f.ms, expected.ms);
    assert.equal(f.us, expected.us);
    assert.equal(f.ns, expected.ns);
  });

  it('parses each representation back to the same instant', () => {
    inZone('Asia/Bangkok');
    assert.equal(value(parseIso(expected.utc)), NS);
    assert.equal(value(parseIso(expected.local)), NS);
    assert.equal(value(parseEpoch(expected.ms, 'ms')), NS);
    assert.equal(value(parseEpoch(expected.us, 'us')), NS);
    assert.equal(value(parseEpoch(expected.ns, 'ns')), NS);
    // Seconds drop the milliseconds; local input has millisecond resolution.
    assert.equal(value(parseEpoch(expected.s, 's')), 1794510299000000000n);
    assert.equal(value(parseLocal('2026-11-13T02:04:59.737')).ns, NS);
    assert.equal(toLocalInputValue(NS), '2026-11-13T02:04:59');
  });
});

describe('nanosecond precision', () => {
  it('round-trips 1794510299737123456 ns exactly', () => {
    inZone('UTC');
    const f = formatInstant(1794510299737123456n);
    assert.equal(f.utc, '2026-11-12T19:04:59.737123456Z');
    assert.equal(value(parseIso(f.utc)), 1794510299737123456n);
    assert.equal(value(parseEpoch(f.ns, 'ns')), 1794510299737123456n);
  });

  it('keeps significant digits, at least three', () => {
    inZone('UTC');
    assert.equal(formatInstant(1_000_000_000n).utc, '1970-01-01T00:00:01.000Z');
    assert.equal(formatInstant(120_000n).utc, '1970-01-01T00:00:00.00012Z');
    assert.equal(value(parseIso('1970-01-01T00:00:00.1Z')), 100_000_000n);
    assert.equal(value(parseIso('1970-01-01T00:00:00,5Z')), 500_000_000n);
  });
});

describe('epoch zero and negative instants', () => {
  it('formats epoch zero', () => {
    inZone('UTC');
    const f = formatInstant(0n);
    assert.equal(f.utc, '1970-01-01T00:00:00.000Z');
    assert.equal(f.local, '1970-01-01T00:00:00.000+00:00');
    assert.deepEqual([f.s, f.ms, f.us, f.ns], ['0', '0', '0', '0']);
    assert.equal(value(parseEpoch('0', 's')), 0n);
    assert.equal(value(parseEpoch('-0', 'ms')), 0n);
  });

  it('floors -1 ns into every coarser unit', () => {
    inZone('UTC');
    const f = formatInstant(-1n);
    assert.equal(f.utc, '1969-12-31T23:59:59.999999999Z');
    assert.deepEqual([f.s, f.ms, f.us, f.ns], ['-1', '-1', '-1', '-1']);
    assert.equal(value(parseIso('1969-12-31T23:59:59.999999999Z')), -1n);
  });

  it('splits negative instants with sub-second parts correctly', () => {
    inZone('UTC');
    assert.equal(formatInstant(-1_500_000_000n).utc, '1969-12-31T23:59:58.500Z');
    assert.equal(value(parseEpoch('-1500', 'ms')), -1_500_000_000n);
    assert.equal(value(parseIso('1969-12-31T23:59:58.5Z')), -1_500_000_000n);
  });
});

describe('Unix input validation', () => {
  it('trims whitespace and accepts signs', () => {
    assert.equal(value(parseEpoch('  1794510299 \n', 's')), 1794510299000000000n);
    assert.equal(value(parseEpoch('+1', 's')), 1_000_000_000n);
    assert.equal(value(parseEpoch('-86400', 's')), -86_400_000_000_000n);
  });

  it('uses the selected unit regardless of digit count', () => {
    assert.equal(value(parseEpoch('1794510299', 'ms')), 1794510299n * 1_000_000n);
  });

  it('rejects decimals, exponents, separators, and junk', () => {
    assert.match(error(parseEpoch('1.5', 's')), /whole number/);
    assert.match(error(parseEpoch('1.5', 'ns')), /smallest unit/);
    assert.match(error(parseEpoch('1e9', 's')), /Exponent/);
    assert.match(error(parseEpoch('1,794,510,299', 's')), /separators/);
    assert.match(error(parseEpoch('1 794 510 299', 's')), /separators/);
    assert.match(error(parseEpoch('1_794', 's')), /separators/);
    assert.match(error(parseEpoch('0x10', 's')), /digits only/);
    assert.match(error(parseEpoch('', 's')), /Enter/);
  });

  it('suggests the usual unit when out of range', () => {
    assert.match(error(parseEpoch('1794510299737', 's')), /13 digits usually means milliseconds/);
    assert.match(error(parseEpoch('9'.repeat(30), 'ns')), /Out of range/);
  });
});

describe('supported range boundaries', () => {
  it('accepts both ends', () => {
    inZone('Pacific/Kiritimati'); // +14:00
    assert.equal(formatInstant(MIN_EPOCH_NS).utc, '0001-01-02T00:00:00.000Z');
    assert.equal(formatInstant(MAX_EPOCH_NS).utc, '9999-12-30T23:59:59.999999999Z');
    assert.equal(formatInstant(MAX_EPOCH_NS).local, '9999-12-31T13:59:59.999999999+14:00');
    assert.equal(value(parseIso('0001-01-02T00:00:00Z')), MIN_EPOCH_NS);
    assert.equal(value(parseIso('9999-12-30T23:59:59.999999999Z')), MAX_EPOCH_NS);
    inZone('America/Los_Angeles'); // LMT -07:52:58
    assert.equal(formatInstant(MIN_EPOCH_NS).local, '0001-01-01T16:07:02.000-07:52:58');
  });

  it('rejects one nanosecond past either end', () => {
    assert.throws(() => formatInstant(MIN_EPOCH_NS - 1n), RangeError);
    assert.throws(() => formatInstant(MAX_EPOCH_NS + 1n), RangeError);
    assert.match(error(parseIso('0001-01-01T23:59:59.999999999Z')), /Out of range/);
    assert.match(error(parseIso('9999-12-31T00:00:00Z')), /Out of range/);
    assert.match(error(parseIso('0000-06-01T00:00:00Z')), /Out of range/);
  });

  it('expresses the range in every unit', () => {
    assert.deepEqual(rangeInUnit('s'), { min: -62135510400n, max: 253402214399n });
    assert.equal(value(parseEpoch('-62135510400', 's')), MIN_EPOCH_NS);
    assert.equal(value(parseEpoch('253402214399', 's')), 253402214399n * 1_000_000_000n);
    assert.match(error(parseEpoch('253402214400', 's')), /Out of range/);
    assert.match(error(parseEpoch('-62135510401', 's')), /Out of range/);
  });
});

describe('ISO 8601 input validation', () => {
  it('applies explicit offsets', () => {
    const utc = value(parseIso('2026-11-12T19:04:59.737Z'));
    assert.equal(value(parseIso('2026-11-13T02:04:59.737+07:00')), utc);
    assert.equal(value(parseIso('2026-11-12T13:34:59.737-05:30')), utc);
    assert.equal(value(parseIso('2026-11-12T19:04:59.737-00:00')), utc);
    assert.equal(value(parseIso('2026-11-12t19:04:59.737z')), utc);
  });

  it('rejects impossible dates and clock fields', () => {
    assert.match(error(parseIso('2026-02-29T00:00:00Z')), /February 2026 has 28 days/);
    assert.equal(value(parseIso('2024-02-29T00:00:00Z')), 1709164800000000000n);
    assert.match(error(parseIso('1900-02-29T00:00:00Z')), /28 days/);
    assert.match(error(parseIso('2026-04-31T00:00:00Z')), /30 days/);
    assert.match(error(parseIso('2026-13-01T00:00:00Z')), /Month 13/);
    assert.match(error(parseIso('2026-00-01T00:00:00Z')), /Month 00/);
    assert.match(error(parseIso('2026-11-12T24:00:00Z')), /next day/);
    assert.match(error(parseIso('2026-11-12T19:60:00Z')), /Minute/);
    assert.match(error(parseIso('2026-11-12T19:04:60Z')), /Leap seconds/);
    assert.match(error(parseIso('2026-11-12T19:04:59+24:00')), /Offset/);
    assert.match(error(parseIso('2026-11-12T19:04:59+07:60')), /Offset/);
  });

  it('explains missing or malformed parts', () => {
    assert.match(error(parseIso('2026-11-12T19:04:59')), /Add a timezone/);
    assert.match(error(parseIso('2026-11-12T19:04:59.737')), /Local date & time/);
    assert.match(error(parseIso('2026-11-12')), /Add a time/);
    assert.match(error(parseIso('2026-11-12T19:04Z')), /Add seconds/);
    assert.match(error(parseIso('2026-11-12T19:04:59+0700')), /±HH:MM/);
    assert.match(error(parseIso('20261112T190459Z')), /separators/);
    assert.match(error(parseIso('1794510299')), /Unix timestamp tab/);
    assert.match(error(parseIso('2026-11-12T19:04:59.1234567890Z')), /9 fractional digits/);
  });
});

describe('local date & time: daylight saving (America/New_York)', () => {
  it('rejects a time in the spring-forward gap', () => {
    inZone('America/New_York');
    const message = error(parseLocal('2026-03-08T02:30'));
    assert.match(message, /doesn’t exist in America\/New_York/);
    assert.match(message, /Try 03:30/);
  });

  it('picks the earlier occurrence in the fall-back overlap', () => {
    inZone('America/New_York');
    const result = value(parseLocal('2026-11-01T01:30'));
    assert.equal(result.offset, '-04:00');
    assert.equal(formatInstant(result.ns).utc, '2026-11-01T05:30:00.000Z');
    assert.equal(formatInstant(result.ns).local, '2026-11-01T01:30:00.000-04:00');
    assert.equal(result.laterOccurrence, '2026-11-01T01:30:00.000-05:00');
    // The later occurrence is reachable through ISO 8601 mode.
    assert.equal(formatInstant(value(parseIso('2026-11-01T01:30:00-05:00'))).utc, '2026-11-01T06:30:00.000Z');
  });

  it('converts ordinary times on either side of a transition', () => {
    inZone('America/New_York');
    assert.equal(formatInstant(value(parseLocal('2026-03-08T01:59:59')).ns).utc, '2026-03-08T06:59:59.000Z');
    assert.equal(formatInstant(value(parseLocal('2026-03-08T03:00')).ns).utc, '2026-03-08T07:00:00.000Z');
    assert.equal(value(parseLocal('2026-07-01T12:00')).laterOccurrence, null);
  });

  it('formats the local offset for the displayed instant, not the current one', () => {
    inZone('America/New_York');
    assert.equal(formatInstant(value(parseIso('2026-07-01T12:00:00Z'))).offset, '-04:00');
    assert.equal(formatInstant(value(parseIso('2026-12-01T12:00:00Z'))).offset, '-05:00');
  });
});

describe('local date & time: other zones', () => {
  it('handles Lord Howe half-hour DST overlap', () => {
    inZone('Australia/Lord_Howe');
    const result = value(parseLocal('2026-04-05T01:45'));
    assert.equal(result.offset, '+11:00');
    assert.equal(result.laterOccurrence, '2026-04-05T01:45:00.000+10:30');
  });

  it('formats sub-minute historical offsets', () => {
    inZone('Asia/Bangkok');
    assert.equal(formatInstant(value(parseIso('1900-01-01T00:00:00Z'))).offset, '+06:42:04');
  });
});
