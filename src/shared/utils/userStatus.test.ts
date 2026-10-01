import { describe, expect, it } from 'vitest';

import {
    activePresence,
    offlinePresence,
    onlinePresence,
    pendingPresence
} from '@/test/presenceFixtures';

import {
    resolveUserPresenceStatus,
    userStatusLabelKey,
    userStatusSortRank
} from './userStatus';

describe('userStatus', () => {
    it('normalizes legacy compact status strings', () => {
        expect(resolveUserPresenceStatus('joinme')).toBe('join me');
        expect(resolveUserPresenceStatus('askme')).toBe('ask me');
        expect(resolveUserPresenceStatus('offline:offline')).toBe('offline');
        expect(resolveUserPresenceStatus('private:private')).toBe('private');
        expect(resolveUserPresenceStatus('traveling:traveling')).toBe(
            'traveling'
        );
    });

    it('treats pending offline and offline presence as offline', () => {
        expect(
            resolveUserPresenceStatus({
                $presence: pendingPresence(),
                status: 'join me'
            })
        ).toBe('offline');
        expect(resolveUserPresenceStatus({ $presence: offlinePresence })).toBe(
            'offline'
        );
    });

    it('prioritizes explicit social status before active location', () => {
        expect(
            resolveUserPresenceStatus({
                status: 'join me',
                $presence: onlinePresence('wrld_123:1')
            })
        ).toBe('join me');
        expect(
            resolveUserPresenceStatus({
                status: 'ask me',
                $presence: onlinePresence('wrld_123:1')
            })
        ).toBe('ask me');
        expect(
            resolveUserPresenceStatus({
                status: 'busy',
                $presence: onlinePresence('wrld_123:1')
            })
        ).toBe('busy');
        expect(
            resolveUserPresenceStatus({
                $presence: onlinePresence('wrld_123:1')
            })
        ).toBe('active');
    });

    it('keeps state active distinct from online active for presence ordering', () => {
        expect(resolveUserPresenceStatus({ $presence: activePresence() })).toBe(
            'state-active'
        );
        expect(resolveUserPresenceStatus({ $presence: onlinePresence() })).toBe(
            'active'
        );
    });

    it('orders statuses by joinability and availability', () => {
        expect(userStatusSortRank('joinme')).toBe(0);
        expect(userStatusSortRank('active')).toBe(1);
        expect(userStatusSortRank('askme')).toBe(2);
        expect(userStatusSortRank('busy')).toBe(3);
        expect(userStatusSortRank('private')).toBe(4);
        expect(userStatusSortRank('offline')).toBe(5);
    });

    it('resolves from the presence view before raw presence fields', () => {
        expect(
            resolveUserPresenceStatus({
                state: 'online',
                location: 'offline',
                $presence: onlinePresence()
            })
        ).toBe('active');
        expect(
            resolveUserPresenceStatus({
                status: 'join me',
                $presence: pendingPresence()
            })
        ).toBe('offline');
        expect(
            resolveUserPresenceStatus({
                status: 'join me',
                $presence: activePresence()
            })
        ).toBe('join me');
        expect(resolveUserPresenceStatus({ $presence: activePresence() })).toBe(
            'state-active'
        );
        expect(
            resolveUserPresenceStatus({
                status: 'busy',
                $presence: onlinePresence()
            })
        ).toBe('busy');
    });

    it('labels an active user as active and a leaving user as offline', () => {
        expect(
            userStatusLabelKey({
                status: 'join me',
                $presence: activePresence()
            })
        ).toBe('dialog.user.status.active');
        expect(
            userStatusLabelKey({
                status: 'join me',
                $presence: pendingPresence()
            })
        ).toBe('dialog.user.status.offline');
        expect(
            userStatusLabelKey({
                status: 'join me',
                $presence: onlinePresence()
            })
        ).toBe('dialog.user.status.join_me');
    });
});
