import { describe, expect, it } from 'vitest';

import {
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    USER_STATUS_INDICATOR_CLASS_NAMES
} from '@/shared/utils/friendStatus';
import { parseLocation } from '@/shared/utils/location';
import {
    activePresence,
    onlinePresence,
    pendingPresence
} from '@/test/presenceFixtures';

import {
    presenceDotClassName,
    presencePlace,
    presenceSection,
    resolveFriendPresenceLocation,
    type PresenceView
} from './presence';

const place = {
    location: parseLocation('wrld_a:1'),
    travelingTo: null
};

const online: PresenceView = {
    kind: 'online',
    place,
    platform: 'android',
    onlineSinceMs: null
};
const pending: PresenceView = {
    kind: 'pendingOffline',
    place,
    platform: 'android',
    onlineSinceMs: null,
    target: 'offline',
    deadlineMs: 5_000
};

describe('presence', () => {
    it('keeps pending friends in the online section with their held place', () => {
        expect(presenceSection(online)).toBe('online');
        expect(presenceSection(pending)).toBe('online');
        expect(presenceSection({ kind: 'active', platform: 'web' })).toBe(
            'active'
        );
        expect(presenceSection({ kind: 'offline' })).toBe('offline');

        expect(presencePlace(pending)).toBe(place);
        expect(presencePlace({ kind: 'offline' })).toBeNull();
    });

    it('derives the status dot from presence and the chosen status', () => {
        const active: PresenceView = { kind: 'active', platform: 'web' };
        expect(presenceDotClassName(online, 'join me')).toBe(
            SOLID_USER_STATUS_DOT_CLASS_NAMES['join me']
        );
        expect(presenceDotClassName(online, 'active')).toBe(
            SOLID_USER_STATUS_DOT_CLASS_NAMES.active
        );
        expect(presenceDotClassName(online, '')).toBe('');
        expect(presenceDotClassName(pending, 'join me')).toBe(
            SOLID_USER_STATUS_DOT_CLASS_NAMES.offline
        );
        expect(presenceDotClassName({ kind: 'offline' }, 'busy')).toBe(
            SOLID_USER_STATUS_DOT_CLASS_NAMES.offline
        );
        expect(presenceDotClassName(active, 'ask me')).toBe(
            `${USER_STATUS_INDICATOR_CLASS_NAMES['ask me']} border-[var(--status-askme)] bg-background`
        );
        expect(presenceDotClassName(active, '')).toBe(
            `${USER_STATUS_INDICATOR_CLASS_NAMES.active} border-[var(--status-online)] bg-background`
        );
        expect(presenceDotClassName(undefined, 'active')).toBe('');
    });
});

describe('resolveFriendPresenceLocation with presence views', () => {
    const traveling: PresenceView = {
        kind: 'online',
        place: {
            location: parseLocation('traveling'),
            travelingTo: parseLocation('wrld_dest:2')
        },
        platform: 'android',
        onlineSinceMs: null
    };

    it('reads the place from the presence view instead of raw fields', () => {
        expect(
            resolveFriendPresenceLocation(
                {
                    location: 'offline',
                    $presence: onlinePresence('wrld_a:1')
                },
                { preferTraveling: true }
            )
        ).toBe('wrld_a:1');
        expect(
            resolveFriendPresenceLocation(
                {
                    $presence: pendingPresence('wrld_a:1')
                },
                { preferTraveling: true }
            )
        ).toBe('wrld_a:1');
        expect(
            resolveFriendPresenceLocation(
                { $presence: activePresence() },
                { preferTraveling: true }
            )
        ).toBe('offline');
        expect(
            resolveFriendPresenceLocation(
                { $presence: activePresence() },
                { preferTraveling: true, requireInstance: true }
            )
        ).toBe('');
        expect(
            resolveFriendPresenceLocation(
                {
                    $presence: onlinePresence('private')
                },
                { preferTraveling: true }
            )
        ).toBe('private');
        expect(
            resolveFriendPresenceLocation(
                { $presence: traveling },
                { preferTraveling: true }
            )
        ).toBe('wrld_dest:2');
        expect(
            resolveFriendPresenceLocation(
                { $presence: traveling },
                { preferTraveling: false }
            )
        ).toBe('traveling');
    });
});
