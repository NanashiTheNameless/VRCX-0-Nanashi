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
        subline,
        statusDotClassName
    }: {
        subline?: ReactNode;
        statusDotClassName?: string;
    }) => <div data-status-dot={statusDotClassName}>{subline}</div>
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
