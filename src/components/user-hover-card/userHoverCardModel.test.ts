import { describe, expect, it } from 'vitest';

import {
    activePresence,
    offlinePresence,
    onlinePresence
} from '@/test/presenceFixtures';

import {
    buildUserHoverCardModel,
    normalizeInstanceCounts
} from './userHoverCardModel';

const NOW = 1_700_000_600_000;
const REAL_INSTANCE = 'wrld_12345678-1234-1234-1234-123456789012:99999';

describe('buildUserHoverCardModel', () => {
    it('marks a friend in a real instance', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_1',
                displayName: 'Alice',
                status: 'join me',
                $presence: onlinePresence(REAL_INSTANCE)
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('in-instance');
        expect(model.statusKey).toBe('dialog.user.status.join_me');
        expect(model.displayName).toBe('Alice');
        expect(model.location.isRealInstance).toBe(true);
        expect(model.location.worldId).toBe(
            'wrld_12345678-1234-1234-1234-123456789012'
        );
        expect(model.location.instanceId).toBe('99999');
    });

    it('treats an online friend in a private world as the private variant', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_2',
                status: 'active',
                $presence: onlinePresence('private')
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('private');
        expect(model.statusKey).toBe('dialog.user.status.online');
    });

    it('shows the local game room for a private friend in my instance', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_2',
                status: 'active',
                $presence: onlinePresence('private')
            },
            profile: null,
            localLocation: REAL_INSTANCE,
            nowMs: NOW
        });

        expect(model.variant).toBe('in-instance');
        expect(model.location.tag).toBe(REAL_INSTANCE);
    });

    it('uses the active variant when online with no resolvable instance', () => {
        const seed = {
            id: 'usr_3',
            status: 'active',
            $presence: activePresence()
        };
        const model = buildUserHoverCardModel({
            seed,
            profile: null,
            nowMs: NOW
        });

        expect(model.variant).toBe('active');
        expect(model.statusKey).toBe('dialog.user.status.active');
        expect(model.statusDotClassName).toBe(
            'user-status-indicator online border-[var(--status-online)] bg-background'
        );
    });

    it('computes last-online for offline friends and hides online duration', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_4',
                $presence: offlinePresence,
                last_login: 1_699_999_000_000
            },
            profile: { status: 'active', last_login: 1_699_999_000_000 },
            nowMs: NOW
        });

        expect(model.variant).toBe('offline');
        expect(model.statusKey).toBe('');
        expect(model.statusDotClassName).toBe(
            'user-status-indicator offline bg-[var(--status-offline)]'
        );
        expect(model.lastOnlineAgoMs).toBe(NOW - 1_699_999_000_000);
        expect(model.onlineForMs).toBe(0);
    });

    it('falls back to profile-only when there is no presence seed', () => {
        const model = buildUserHoverCardModel({
            seed: null,
            profile: { id: 'usr_5', displayName: 'Cara', status: 'busy' },
            nowMs: NOW
        });

        expect(model.variant).toBe('profile-only');
        expect(model.statusKey).toBe('');
        expect(model.statusDotClassName).toBe('');
        expect(model.onlineForMs).toBe(0);
    });

    it('estimates online duration from last_login while fully online', () => {
        const model = buildUserHoverCardModel({
            seed: {
                id: 'usr_6',
                status: 'active',
                $presence: onlinePresence(REAL_INSTANCE),
                last_login: 1_700_000_000_000
            },
            profile: null,
            nowMs: NOW
        });

        expect(model.onlineForMs).toBe(NOW - 1_700_000_000_000);
    });
});

describe('normalizeInstanceCounts', () => {
    it('prefers userCount over n_users like the instance action bar', () => {
        expect(
            normalizeInstanceCounts({
                userCount: 32,
                n_users: 33,
                capacity: 32
            })
        ).toEqual({ nUsers: 32, capacity: 32, full: false });
    });

    it('marks the instance full only when VRChat reports no capacity for you', () => {
        expect(
            normalizeInstanceCounts({
                userCount: 32,
                capacity: 32,
                hasCapacityForYou: false
            })
        ).toEqual({ nUsers: 32, capacity: 32, full: true });
    });

    it('defaults capacity to 0 when only occupants are known', () => {
        expect(normalizeInstanceCounts({ n_users: 5 })).toEqual({
            nUsers: 5,
            capacity: 0,
            full: false
        });
    });

    it('returns null when occupant count is missing', () => {
        expect(normalizeInstanceCounts({})).toBeNull();
        expect(normalizeInstanceCounts(null)).toBeNull();
    });
});
