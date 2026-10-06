import { describe, expect, it } from 'vitest';

import { eventStatus, isCancelledEvent } from './groupEventFormat';

describe('eventStatus', () => {
    const event = {
        startsAt: '2026-10-06T12:00:00.000Z',
        endsAt: '2026-10-06T14:00:00.000Z'
    };

    it('reports upcoming, live and ended around the event window', () => {
        expect(eventStatus(event, Date.parse('2026-10-06T11:00:00.000Z'))).toBe(
            'upcoming'
        );
        expect(eventStatus(event, Date.parse('2026-10-06T13:00:00.000Z'))).toBe(
            'live'
        );
        expect(eventStatus(event, Date.parse('2026-10-06T14:00:00.000Z'))).toBe(
            'ended'
        );
    });

    it('returns null without a valid start', () => {
        expect(eventStatus({ startsAt: 'nope' }, Date.now())).toBeNull();
    });
});

describe('isCancelledEvent', () => {
    it('detects a leading cancelled marker in either spelling and bracket style', () => {
        expect(
            isCancelledEvent({ title: '(CANCELLED) Voice Office Hours' })
        ).toBe(true);
        expect(isCancelledEvent({ title: '[Canceled] Meetup' })).toBe(true);
        expect(isCancelledEvent({ title: 'Cancelled: Movie night' })).toBe(
            true
        );
    });

    it('ignores titles that only mention cancellation later on', () => {
        expect(isCancelledEvent({ title: 'Meetup (not cancelled)' })).toBe(
            false
        );
        expect(isCancelledEvent({ title: 'Cancellation policy Q&A' })).toBe(
            false
        );
    });
});
