import { afterEach, describe, expect, it } from 'vitest';

import {
    absoluteDateFromValue,
    displayDateParts,
    fixedTimeZoneOffset,
    isValidDisplayTimeZone,
    setDisplayTimeZone
} from './displayTimeZone';

afterEach(() => setDisplayTimeZone(''));

describe('display timezone', () => {
    it('accepts IANA names and fixed offsets and rejects invalid settings', () => {
        for (const zone of [
            '',
            'system',
            'America/Chicago',
            'UTC',
            'UTC+5',
            'UTC+23:59',
            '-03:30',
            '+0530'
        ]) {
            expect(isValidDisplayTimeZone(zone), zone).toBe(true);
        }
        for (const zone of [
            'Nowhere/Invalid',
            'UTC+24',
            'UTC+23:60',
            'UTC+5:99'
        ]) {
            expect(isValidDisplayTimeZone(zone), zone).toBe(false);
        }
        expect(fixedTimeZoneOffset('+0530')).toBe(19800);
    });
    it('uses the offset at each instant across daylight saving changes', () => {
        setDisplayTimeZone('America/New_York');
        expect(displayDateParts(new Date('2026-01-15T12:00:00Z')).hour).toBe(7);
        expect(displayDateParts(new Date('2026-07-15T12:00:00Z')).hour).toBe(8);
    });
    it('handles fixed offsets across midnight and negative epoch seconds', () => {
        setDisplayTimeZone('UTC+05:30');
        expect(
            displayDateParts(new Date('2026-07-15T20:00:00Z'))
        ).toMatchObject({ day: 16, hour: 1, minute: 30 });
        expect(absoluteDateFromValue(-1)?.toISOString()).toBe(
            '1969-12-31T23:59:59.000Z'
        );
        expect(absoluteDateFromValue(0)?.toISOString()).toBe(
            '1970-01-01T00:00:00.000Z'
        );
        expect(absoluteDateFromValue(1784629815)?.getTime()).toBe(
            1784629815000
        );
        expect(absoluteDateFromValue(1784629815250)?.getTime()).toBe(
            1784629815250
        );
    });
});

import { displayDateBoundary, displayLocalToEpoch } from './displayTimeZone';

it('resolves configured-zone input through DST gaps and repeated hours', () => {
    setDisplayTimeZone('America/New_York');
    expect(displayLocalToEpoch('2026-03-08T02:30')).toBe(
        Date.parse('2026-03-08T07:30:00Z') / 1000
    );
    expect(displayLocalToEpoch('2026-11-01T01:30')).toBe(
        Date.parse('2026-11-01T05:30:00Z') / 1000
    );
    expect(
        displayDateBoundary('2026-03-08', 'end')! -
            displayDateBoundary('2026-03-08', 'start')! +
            1
    ).toBe(23 * 3600);
    expect(
        displayDateBoundary('2026-11-01', 'end')! -
            displayDateBoundary('2026-11-01', 'start')! +
            1
    ).toBe(25 * 3600);
});
