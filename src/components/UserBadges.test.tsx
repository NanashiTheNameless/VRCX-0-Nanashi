// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
    FORK_MAINTAINER_USER_ID,
    OWNER_USER_ID
} from '@/shared/constants/user';
import { useCustomBadgeStore } from '@/state/customBadgeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import {
    CustomBadgeFolder,
    DeveloperBadge,
    developerBadgeKind,
    UserBadges
} from './UserBadges';

describe('developerBadgeKind', () => {
    it('distinguishes the fork maintainer from the upstream developer', () => {
        expect(developerBadgeKind(FORK_MAINTAINER_USER_ID)).toBe('fork');
        expect(developerBadgeKind(OWNER_USER_ID)).toBe('upstream');
        expect(developerBadgeKind('usr_someone-else')).toBeNull();
        expect(developerBadgeKind('')).toBeNull();
        expect(developerBadgeKind(undefined)).toBeNull();
    });
});

describe('DeveloperBadge', () => {
    afterEach(cleanup);

    it('renders the fork badge with its text label at full size', () => {
        const { container } = render(
            <DeveloperBadge userId={FORK_MAINTAINER_USER_ID} size="full" />
        );
        const badge = screen.getByRole('img', {
            name: 'dialog.user.badges.fork_developer'
        });
        expect(badge.classList.contains('fork-dev-badge')).toBe(true);
        expect(container.textContent).toContain(
            'dialog.user.badges.fork_developer_short'
        );
    });

    it('renders the fork badge without a text label when compact', () => {
        const { container } = render(
            <DeveloperBadge userId={FORK_MAINTAINER_USER_ID} />
        );
        const badge = screen.getByRole('img', {
            name: 'dialog.user.badges.fork_developer'
        });
        expect(badge.classList.contains('fork-dev-badge--compact')).toBe(true);
        expect(container.textContent).not.toContain(
            'dialog.user.badges.fork_developer_short'
        );
    });

    it('renders the upstream badge with its own style', () => {
        render(<DeveloperBadge userId={OWNER_USER_ID} size="full" />);
        const badge = screen.getByRole('img', {
            name: 'dialog.user.badges.upstream_developer'
        });
        expect(badge.classList.contains('upstream-dev-badge')).toBe(true);
        expect(badge.classList.contains('fork-dev-badge')).toBe(false);
        expect(badge.textContent).toBe(
            'dialog.user.badges.upstream_developer_short'
        );
    });

    it('renders nothing for other users', () => {
        const { container } = render(
            <DeveloperBadge userId="usr_someone-else" />
        );
        expect(container.innerHTML).toBe('');
    });
});

describe('UserBadges', () => {
    const userId = 'usr_11111111-1111-1111-1111-111111111111';

    afterEach(() => {
        cleanup();
        useCustomBadgeStore.setState({ badges: [], loaded: false });
    });

    function setBadges() {
        useCustomBadgeStore.setState({
            loaded: true,
            badges: [
                {
                    id: 'a',
                    label: 'Artist',
                    icon: 'Palette',
                    color: '#ff0000',
                    enabled: true,
                    rules: [{ kind: 'users', userIds: [userId] }]
                },
                {
                    id: 'b',
                    label: 'DJ',
                    icon: 'Music',
                    color: '#00ff00',
                    enabled: true,
                    rules: [{ kind: 'users', userIds: [userId] }]
                }
            ]
        });
    }

    it('shows every matching custom badge for a user', () => {
        setBadges();
        render(<UserBadges userId={userId} />);
        expect(screen.getByRole('img', { name: 'Artist' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'DJ' })).toBeTruthy();
    });

    it('adds custom badges after the developer badge', () => {
        useCustomBadgeStore.setState({
            loaded: true,
            badges: [
                {
                    id: 'a',
                    label: 'Artist',
                    icon: 'Palette',
                    color: '#ff0000',
                    enabled: true,
                    rules: [
                        { kind: 'users', userIds: [FORK_MAINTAINER_USER_ID] }
                    ]
                }
            ]
        });
        const { container } = render(
            <UserBadges userId={FORK_MAINTAINER_USER_ID} />
        );
        const labels = Array.from(
            container.querySelectorAll('[role="img"]'),
            (node) => node.getAttribute('aria-label')
        );
        expect(labels).toEqual(['dialog.user.badges.fork_developer', 'Artist']);
    });

    it('shows the staff badge for VRChat staff', () => {
        const staffId = 'usr_44444444-4444-4444-4444-444444444444';
        useUserFactsStore
            .getState()
            .replaceUserFacts([{ id: staffId, developerType: 'internal' }]);
        render(<UserBadges userId={staffId} size="full" />);
        expect(
            screen.getByRole('img', { name: 'dialog.user.badges.vrchat_staff' })
        ).toBeTruthy();
    });

    it('renders nothing for users without badges', () => {
        const { container } = render(
            <UserBadges userId="usr_99999999-9999-9999-9999-999999999999" />
        );
        expect(container.innerHTML).toBe('');
    });
});

describe('CustomBadgeFolder', () => {
    afterEach(cleanup);

    it('opens a tooltip listing every collapsed badge', async () => {
        const badges = [
            'Artist',
            'DJ',
            'Event host',
            'Close friend',
            'Mod'
        ].map((label, index) => ({
            id: String(index),
            label,
            icon: 'Star',
            color: '#336699',
            enabled: true,
            rules: []
        }));
        render(<CustomBadgeFolder badges={badges} />);
        const folder = screen.getByRole('img', {
            name: 'Artist, DJ, Event host, Close friend, Mod'
        });
        fireEvent.focus(folder);
        expect(
            await screen.findByText(
                'Artist, DJ, Event host, Close friend, Mod',
                {
                    selector: ':not([role="img"])'
                }
            )
        ).toBeTruthy();
    });
});
