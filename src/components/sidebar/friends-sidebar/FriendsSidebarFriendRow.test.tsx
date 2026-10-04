import type { PropsWithChildren, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/friends/FriendInstanceTimer', () => ({
    FriendInstanceTimer: () => <span data-instance-timer />,
    FriendLocationTimer: ({
        location,
        userId
    }: {
        location: string;
        userId: string;
    }) => <span data-location={location} data-user-id={userId} />
}));

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: PropsWithChildren) => children
}));

vi.mock('@/components/UserDetailTile', () => ({
    UserDetailContent: ({
        avatarFrame,
        subline,
        statusDotClassName
    }: {
        avatarFrame?: ReactNode;
        subline?: ReactNode;
        statusDotClassName?: string;
    }) => (
        <div data-status-dot={statusDotClassName}>
            {avatarFrame}
            {subline}
        </div>
    )
}));

vi.mock('@/components/sidebar/SidebarProfileDecorations', () => ({
    SidebarAvatarFrame: ({ templateId }: { templateId: string }) => (
        <span data-avatar-frame={templateId} />
    ),
    SidebarNameplate: ({ templateId }: { templateId: string }) => (
        <span data-nameplate={templateId} />
    ),
    useSidebarDecorationHover: () => ({ active: false, hoverProps: {} })
}));

vi.mock('@/ui/shadcn/context-menu', () => ({
    ContextMenu: ({ children }: PropsWithChildren) => children,
    ContextMenuCheckboxItem: () => null,
    ContextMenuContent: () => null,
    ContextMenuGroup: () => null,
    ContextMenuItem: () => null,
    ContextMenuSeparator: () => null,
    ContextMenuSub: () => null,
    ContextMenuSubContent: () => null,
    ContextMenuSubTrigger: () => null,
    ContextMenuTrigger: ({ render }: { render: ReactNode }) => render
}));

vi.mock('./FriendsSidebarActionItems', () => ({
    CurrentUserActionItems: () => null,
    FriendActionItems: () => null
}));

import { activePresence } from '@/test/presenceFixtures';

import { FriendRow } from './FriendsSidebarFriendRow';

describe('FriendsSidebarFriendRow instance timer', () => {
    it('times a remote friend in a grouped instance by that instance location', () => {
        const html = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_a',
                    displayName: 'usr_a',
                    state: 'online',
                    location: 'wrld_friends:1'
                }}
                rowModel={{
                    isGroupByInstance: true,
                    instanceLocation: 'wrld_friends:1'
                }}
            />
        );

        expect(html).toContain('data-user-id="usr_a"');
        expect(html).toContain('data-location="wrld_friends:1"');
    });

    it('shows the status dot for the current user even though VRChat marks the self record as not a friend', () => {
        const html = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_self',
                    displayName: 'Self',
                    status: 'active',
                    isFriend: false,
                    $presence: activePresence()
                }}
                rowModel={{ isCurrentUser: true }}
            />
        );

        expect(html).toContain('data-status-dot="user-status-indicator');
    });
});

describe('FriendsSidebarFriendRow profile decorations', () => {
    const friend = {
        id: 'usr_a',
        displayName: 'Friend',
        iconFrame: 'invt_frame',
        nameplateEffect: 'invt_plate'
    };

    it('renders the avatar frame and nameplate independently when enabled', () => {
        const frameOnly = renderToStaticMarkup(
            <FriendRow friend={friend} appearance={{ showAvatarFrame: true }} />
        );
        const nameplateOnly = renderToStaticMarkup(
            <FriendRow friend={friend} appearance={{ showNameplate: true }} />
        );

        expect(frameOnly).toContain('data-avatar-frame="invt_frame"');
        expect(frameOnly).not.toContain('data-nameplate');
        expect(nameplateOnly).toContain('data-nameplate="invt_plate"');
        expect(nameplateOnly).not.toContain('data-avatar-frame');
    });

    it('renders no decorations by default', () => {
        const html = renderToStaticMarkup(<FriendRow friend={friend} />);

        expect(html).not.toContain('data-avatar-frame');
        expect(html).not.toContain('data-nameplate');
    });
});
