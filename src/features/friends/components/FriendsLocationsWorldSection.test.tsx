// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { usePreferencesStore } from '@/state/preferencesStore';
import { onlinePresence } from '@/test/presenceFixtures';

import { FriendsLocationsFriendChips } from './FriendsLocationsWorldSection';

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: { children: ReactNode }) => children
}));
vi.mock('@/services/entityMediaService', () => ({ userImage: () => '' }));
vi.mock('@/components/ProfileDecorations', () => ({
    ProfileAvatarFrame: ({ templateId }: { templateId: string }) => (
        <span data-avatar-frame={templateId} />
    ),
    ProfileNameplate: ({ templateId }: { templateId: string }) => (
        <span data-nameplate={templateId} />
    ),
    useDecorationHover: () => ({ active: false, hoverProps: {} })
}));

const friend: FriendRecord = {
    id: 'usr_friend',
    displayName: 'Friend',
    iconFrame: 'invt_frame',
    nameplateEffect: 'invt_plate',
    tags: [],
    $presence: onlinePresence('wrld_test:123'),
    $trustLevel: '',
    $friendNumber: 0,
    $trustClass: '',
    $trustSortNum: 0,
    $isModerator: false,
    $isTroll: false,
    $isProbableTroll: false,
    $platform: ''
};

function renderChips() {
    return render(
        <FriendsLocationsFriendChips
            friends={[friend]}
            favoriteIds={new Set()}
            twoLine={false}
            onOpenUser={vi.fn()}
        />
    ).container.innerHTML;
}

describe('FriendsLocationsFriendChips profile decorations', () => {
    afterEach(() => {
        cleanup();
        usePreferencesStore.setState({
            showFriendsLocationsWorldsAvatarFrame: false,
            showFriendsLocationsWorldsNameplate: false
        });
    });

    it('hides the avatar frame and nameplate by default', () => {
        const html = renderChips();
        expect(html).not.toContain('data-avatar-frame');
        expect(html).not.toContain('data-nameplate');
    });

    it('follows the worlds view decoration preferences independently', () => {
        usePreferencesStore.setState({
            showFriendsLocationsWorldsAvatarFrame: true,
            showFriendsLocationsWorldsNameplate: false
        });
        const frameOnly = renderChips();
        cleanup();
        expect(frameOnly).toContain('data-avatar-frame="invt_frame"');
        expect(frameOnly).not.toContain('data-nameplate');

        usePreferencesStore.setState({
            showFriendsLocationsWorldsAvatarFrame: false,
            showFriendsLocationsWorldsNameplate: true
        });
        const nameplateOnly = renderChips();
        expect(nameplateOnly).not.toContain('data-avatar-frame');
        expect(nameplateOnly).toContain('data-nameplate="invt_plate"');
    });
});
