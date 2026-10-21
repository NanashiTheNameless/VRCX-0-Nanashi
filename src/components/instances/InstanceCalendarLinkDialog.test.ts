import { describe, expect, it } from 'vitest';

import { linkableCalendarEvents } from './InstanceCalendarLinkDialog';

const HOUR_MS = 60 * 60 * 1000;

describe('linkableCalendarEvents', () => {
    it('keeps events within six hours of now, ordered by start time', () => {
        const nowMs = Date.parse('2026-10-21T12:00:00.000Z');
        const at = (hours: number) =>
            new Date(nowMs + hours * HOUR_MS).toISOString();

        const events = linkableCalendarEvents(
            [
                { id: 'later', startsAt: at(5), endsAt: at(7) },
                { id: 'ongoing', startsAt: at(-1), endsAt: at(1) },
                { id: 'too-far', startsAt: at(7), endsAt: at(8) },
                { id: 'long-past', startsAt: at(-9), endsAt: at(-7) },
                { id: 'recent', startsAt: at(-8), endsAt: at(-5) }
            ],
            nowMs
        );

        expect(events.map((event) => event.id)).toEqual([
            'recent',
            'ongoing',
            'later'
        ]);
    });
});
