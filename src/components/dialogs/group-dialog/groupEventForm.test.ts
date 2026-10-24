import { afterEach, describe, expect, it } from 'vitest';

import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';

import {
    createGroupEventForm,
    groupEventFormErrors,
    groupEventFormFromEvent,
    groupEventMutation,
    toLocalDateTimeInput
} from './groupEventForm';

afterEach(() => setDisplayTimeZone(''));

const NOW = new Date(2026, 9, 21, 12, 30).getTime();

describe('groupEventForm', () => {
    it('edits and submits epoch seconds in the configured timezone across DST', () => {
        setDisplayTimeZone('America/New_York');
        const form = groupEventFormFromEvent({
            id: 'gcal_1',
            startsAt: '2026-03-08T07:30:00Z',
            endsAt: '2026-03-08T08:30:00Z'
        });
        expect(form.startsAt).toBe('2026-03-08T03:30');
        expect(toLocalDateTimeInput(1772955000)).toBe('2026-03-08T03:30');
        expect(groupEventMutation(form).startsAt).toBe(
            '2026-03-08T07:30:00.000Z'
        );
        form.repeat = 'weekly';
        expect(groupEventMutation(form).recurrence?.timezone).toBe(
            'America/New_York'
        );
        form.startsAt = '2026-03-08T02:30';
        expect(groupEventMutation(form).startsAt).toBe(
            '2026-03-08T07:30:00.000Z'
        );
    });

    it('rounds the default event up in a fixed fractional timezone', () => {
        setDisplayTimeZone('UTC+05:45');
        const form = createGroupEventForm(Date.parse('2026-10-21T12:30:00Z'));
        expect(form.startsAt).toBe('2026-10-21T19:00');
        form.repeat = 'weekly';
        expect(groupEventMutation(form).recurrence?.timezone).toBe(
            Intl.DateTimeFormat().resolvedOptions().timeZone
        );
        expect(groupEventMutation(form).startsAt).toBe(
            '2026-10-21T13:15:00.000Z'
        );
    });

    it('keeps UTC as the named timezone for a new series', () => {
        setDisplayTimeZone('UTC');
        const form = createGroupEventForm(NOW);
        form.repeat = 'weekly';
        expect(groupEventMutation(form).recurrence?.timezone).toBe('UTC');
    });

    it('preserves an existing series timezone and its wall-clock end date', () => {
        setDisplayTimeZone('America/New_York');
        const form = groupEventFormFromEvent({
            id: 'gcal_1',
            startsAt: '2026-10-22T10:00:00Z',
            endsAt: '2026-10-22T12:00:00Z',
            recurrence: {
                frequency: 'weekly',
                timezone: 'Asia/Tokyo',
                end: { type: 'afterDate', date: '2026-12-31T23:59:00' }
            }
        });
        expect(form.repeatEndDate).toBe('2026-12-31T23:59');
        expect(groupEventMutation(form).recurrence).toMatchObject({
            timezone: 'Asia/Tokyo',
            end: { type: 'afterDate', date: '2026-12-31T23:59' }
        });
    });

    it('starts a new event at the next full hour for two hours', () => {
        const form = createGroupEventForm(NOW);

        expect(form.startsAt).toBe(
            toLocalDateTimeInput(new Date(2026, 9, 21, 13, 0))
        );
        expect(form.endsAt).toBe(
            toLocalDateTimeInput(new Date(2026, 9, 21, 15, 0))
        );
        expect(groupEventFormErrors(form, NOW)).toEqual([
            'title',
            'description'
        ]);
    });

    it('rejects past starts only when creating and inverted ranges always', () => {
        const form = {
            ...createGroupEventForm(NOW),
            title: 'Meetup',
            description: 'Hang out',
            startsAt: toLocalDateTimeInput(new Date(2026, 9, 21, 11, 0)),
            endsAt: toLocalDateTimeInput(new Date(2026, 9, 21, 10, 0))
        };

        expect(groupEventFormErrors(form, NOW)).toEqual([
            'date_range',
            'start_in_past'
        ]);
        expect(groupEventFormErrors({ ...form, mode: 'edit' }, NOW)).toEqual([
            'date_range'
        ]);
        expect(
            groupEventFormErrors({ ...form, hostEarlyJoinMinutes: 61 }, NOW)
        ).toContain('minutes');
    });

    it('builds the request body with trimmed text, capped tags and a weekly series', () => {
        const form = {
            ...createGroupEventForm(NOW),
            title: ' Meetup ',
            description: ' Hang out ',
            tags: 'a, b,, c, d, e, f',
            languages: ['eng', 'jpn', 'kor', 'deu'],
            sendCreationNotification: true,
            repeat: 'weekly' as const,
            interval: 2,
            weeklyPattern: 'weekend' as const,
            repeatEnd: 'afterOccurrences' as const,
            occurrenceCount: 4
        };

        const mutation = groupEventMutation(form, 'Asia/Tokyo');

        expect(mutation).toMatchObject({
            title: 'Meetup',
            description: 'Hang out',
            tags: ['a', 'b', 'c', 'd', 'e'],
            languages: ['eng', 'jpn', 'kor'],
            imageId: null,
            sendCreationNotification: true,
            recurrence: {
                frequency: 'weekly',
                interval: 2,
                timezone: 'Asia/Tokyo',
                daysOfWeek: ['SA', 'SU'],
                end: { type: 'afterOccurrences', count: 4 }
            }
        });
        expect(mutation.startsAt).toBe(new Date(form.startsAt).toISOString());
    });

    it('edits an existing occurrence without resending notifications or recurrence', () => {
        const form = groupEventFormFromEvent({
            id: 'gcal_1',
            seriesId: 'gcal_parent',
            title: 'Meetup',
            description: 'Hang out',
            startsAt: '2026-10-22T10:00:00.000Z',
            endsAt: '2026-10-22T12:00:00.000Z',
            accessType: 'public',
            category: 'music',
            tags: ['live'],
            recurrence: { frequency: 'weekly', interval: 1, daysOfWeek: [] }
        });

        expect(form).toMatchObject({
            mode: 'edit',
            eventId: 'gcal_1',
            isSeriesOccurrence: true,
            accessType: 'public',
            category: 'music',
            tags: 'live',
            repeat: 'weekly',
            weeklyPattern: 'every_week'
        });
        const mutation = groupEventMutation(
            { ...form, sendCreationNotification: true },
            'UTC'
        );
        expect(mutation.sendCreationNotification).toBe(false);
        expect(mutation.recurrence).toBeNull();
    });
});
