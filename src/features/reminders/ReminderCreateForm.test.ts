import { describe, expect, it } from 'vitest';

import { buildReminderTrigger } from './ReminderCreateForm';

const base = {
    friendId: '',
    friendName: '',
    worldId: '',
    localTime: '',
    repeatMinutes: 0
};

describe('buildReminderTrigger', () => {
    it('needs a friend for friend triggers', () => {
        expect(buildReminderTrigger('friendOnline', base)).toBeNull();
        expect(
            buildReminderTrigger('friendOnline', {
                ...base,
                friendId: 'usr_1',
                friendName: 'Alice'
            })
        ).toEqual({
            kind: 'friendOnline',
            userId: 'usr_1',
            displayName: 'Alice'
        });
    });

    it('keeps an optional world for location triggers', () => {
        expect(
            buildReminderTrigger('friendLocation', {
                ...base,
                friendId: 'usr_1',
                friendName: 'Alice',
                worldId: ' wrld_1 '
            })
        ).toEqual({
            kind: 'friendLocation',
            userId: 'usr_1',
            displayName: 'Alice',
            worldId: 'wrld_1'
        });
    });

    it('converts a local time to UTC and clamps the repeat', () => {
        const trigger = buildReminderTrigger('time', {
            ...base,
            localTime: '2026-10-01T09:30',
            repeatMinutes: -5
        });

        expect(trigger).toEqual({
            kind: 'time',
            at: new Date('2026-10-01T09:30').toISOString(),
            repeatMinutes: 0
        });
        expect(buildReminderTrigger('time', base)).toBeNull();
    });
});
