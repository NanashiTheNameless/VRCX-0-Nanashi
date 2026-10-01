import { describe, expect, it } from 'vitest';

import { activePresence, onlinePresence } from '@/test/presenceFixtures';

import { mergeCurrentUserPresenceFields } from './currentUserPresence';

describe('mergeCurrentUserPresenceFields', () => {
    it('keeps the realtime presence while a profile response replaces the rest of the user', () => {
        const previousUser = {
            id: 'usr_self',
            status: 'active',
            location: 'wrld_local:1',
            $presence: onlinePresence('wrld_local:1')
        };
        const nextUser = {
            id: 'usr_self',
            status: 'busy',
            statusDescription: 'afk',
            location: '',
            $presence: activePresence()
        };

        expect(mergeCurrentUserPresenceFields(nextUser, previousUser)).toEqual({
            id: 'usr_self',
            status: 'busy',
            statusDescription: 'afk',
            location: 'wrld_local:1',
            $presence: onlinePresence('wrld_local:1')
        });
    });

    it('returns the next user unchanged without a previous user', () => {
        const nextUser = { id: 'usr_self', status: 'busy' };
        expect(mergeCurrentUserPresenceFields(nextUser, null)).toBe(nextUser);
    });
});
