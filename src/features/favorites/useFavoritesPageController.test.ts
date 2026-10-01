import { describe, expect, it } from 'vitest';

import {
    onlinePresence,
    pendingPresence,
    travelingPresence
} from '@/test/presenceFixtures';

import { buildFavoriteGateTarget } from './useFavoritesPageController';

describe('useFavoritesPageController gate target helpers', () => {
    it('builds a gate target from the live instance of a favorite friend', () => {
        expect(
            buildFavoriteGateTarget({
                id: 'usr_friend',
                key: 'remote:group:usr_friend',
                kind: 'friend',
                seedData: { $presence: onlinePresence('wrld_test:12345') }
            })
        ).toEqual({
            key: 'remote:group:usr_friend',
            userId: 'usr_friend',
            location: 'wrld_test:12345',
            presenceKind: 'online',
            isCurrentUser: false
        });
    });

    it('keeps the invite gate for a traveling favorite friend without joining the destination', () => {
        expect(
            buildFavoriteGateTarget({
                id: 'usr_friend',
                key: 'remote:group:usr_friend',
                kind: 'friend',
                seedData: { $presence: travelingPresence('wrld_test:12345') }
            })
        ).toEqual({
            key: 'remote:group:usr_friend',
            userId: 'usr_friend',
            location: '',
            presenceKind: 'online',
            isCurrentUser: false
        });
    });

    it('builds no gate target while a favorite friend is possibly offline', () => {
        expect(
            buildFavoriteGateTarget({
                id: 'usr_friend',
                key: 'remote:group:usr_friend',
                kind: 'friend',
                seedData: { $presence: pendingPresence('wrld_test:12345') }
            })
        ).toBeNull();
    });
});
