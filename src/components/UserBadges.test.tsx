// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { normalizeGlobalBadgeCatalog } from '@/domain/badges/globalBadges';
import {
    FORK_DEVELOPER_USER_ID,
    UPSTREAM_DEVELOPER_USER_ID,
    VRCHAT_STAFF_GROUP_ID
} from '@/shared/constants/user';
import { useCustomBadgeStore } from '@/state/customBadgeStore';
import { useGlobalBadgeStore } from '@/state/globalBadgeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import {
    recordUserGroups,
    resetUserGroupMembershipStoreForTests
} from '@/state/userGroupMembershipStore';

import {
    CustomBadgeFolder,
    DeveloperBadge,
    developerBadgeKind,
    UserBadges
} from './UserBadges';

describe('developerBadgeKind', () => {
    it('distinguishes the fork maintainer from the upstream developer', () => {
        expect(developerBadgeKind(FORK_DEVELOPER_USER_ID)).toBe('fork');
        expect(developerBadgeKind(UPSTREAM_DEVELOPER_USER_ID)).toBe('upstream');
        expect(developerBadgeKind('usr_someone-else')).toBeNull();
        expect(developerBadgeKind('')).toBeNull();
        expect(developerBadgeKind(undefined)).toBeNull();
    });
});

describe('DeveloperBadge', () => {
    afterEach(cleanup);

    it('renders the fork badge with its text label at full size', () => {
        const { container } = render(
            <DeveloperBadge userId={FORK_DEVELOPER_USER_ID} size="full" />
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
            <DeveloperBadge userId={FORK_DEVELOPER_USER_ID} />
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
        render(
            <DeveloperBadge userId={UPSTREAM_DEVELOPER_USER_ID} size="full" />
        );
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
                        { kind: 'users', userIds: [FORK_DEVELOPER_USER_ID] }
                    ]
                }
            ]
        });
        const { container } = render(
            <UserBadges userId={FORK_DEVELOPER_USER_ID} />
        );
        const labels = Array.from(
            container.querySelectorAll('[role="img"]'),
            (node) => node.getAttribute('aria-label')
        );
        expect(labels).toEqual(['dialog.user.badges.fork_developer', 'Artist']);
    });

    it('shows global badges after the built-in ones', () => {
        const awardee = 'usr_66666666-6666-6666-6666-666666666666';
        useGlobalBadgeStore.setState({
            catalog: normalizeGlobalBadgeCatalog({
                revision: 1,
                source: 'embedded',
                badges: [
                    {
                        id: 'donator',
                        label: 'Donator',
                        description: 'Supported the fork',
                        icon: 'HandHeart',
                        style: 'ember',
                        animation: 'shimmer'
                    }
                ],
                awards: [
                    {
                        userId: awardee,
                        badge: 'donator',
                        reason: 'Thanks',
                        since: null,
                        until: null
                    },
                    {
                        userId: FORK_DEVELOPER_USER_ID,
                        badge: 'donator',
                        reason: '',
                        since: null,
                        until: null
                    }
                ]
            })
        });
        try {
            render(<UserBadges userId={awardee} size="full" />);
            const chip = screen.getByRole('img', { name: 'Donator' });
            expect(chip.classList.contains('global-badge--ember')).toBe(true);
            expect(chip.classList.contains('global-badge--anim-shimmer')).toBe(
                true
            );
            cleanup();
            const { container } = render(
                <UserBadges userId={FORK_DEVELOPER_USER_ID} />
            );
            expect(
                Array.from(container.querySelectorAll('[role="img"]'), (node) =>
                    node.getAttribute('aria-label')
                )
            ).toEqual(['dialog.user.badges.fork_developer', 'Donator']);
        } finally {
            useGlobalBadgeStore.setState({ catalog: null });
        }
    });

    it('gives every combined effect its own layer or icon wrapper', () => {
        const awardee = 'usr_88888888-8888-8888-8888-888888888888';
        useGlobalBadgeStore.setState({
            catalog: normalizeGlobalBadgeCatalog({
                revision: 1,
                source: 'embedded',
                badges: [
                    {
                        id: 'donator',
                        label: 'Donator',
                        description: 'Supported the fork',
                        icon: 'HandHeart',
                        style: 'ember',
                        animation: 'flow embers wiggle flip'
                    }
                ],
                awards: [{ userId: awardee, badge: 'donator' }]
            })
        });
        try {
            render(<UserBadges userId={awardee} size="full" />);
            const chip = screen.getByRole('img', { name: 'Donator' });
            expect(
                Array.from(
                    chip.querySelectorAll('.global-badge-fx'),
                    (layer) => layer.className
                )
            ).toEqual([
                'global-badge-fx global-badge-fx--flow global-badge-fx--n1',
                'global-badge-fx global-badge-fx--embers global-badge-fx--n1',
                'global-badge-fx global-badge-fx--embers global-badge-fx--n2',
                'global-badge-fx global-badge-fx--embers global-badge-fx--n3'
            ]);
            // Icon wrappers nest in list order, the icon innermost.
            const wrappers = Array.from(
                chip.querySelectorAll('.global-badge-icon-fx'),
                (wrapper) => wrapper.className.split('--')[1]
            );
            expect(wrappers).toEqual(['flicker', 'wiggle', 'flip']);
            expect(
                chip.querySelector(
                    '.global-badge-icon-fx--flip > :not(.global-badge-icon-fx)'
                )
            ).toBeTruthy();
            // Embers stay inside the badge; only glow draws past its edge.
            expect(chip.classList.contains('global-badge--spill')).toBe(false);
        } finally {
            useGlobalBadgeStore.setState({ catalog: null });
        }
    });

    it('shows the global badge tooltip when an award has no reason', async () => {
        const awardee = 'usr_77777777-7777-7777-7777-777777777777';
        useGlobalBadgeStore.setState({
            catalog: normalizeGlobalBadgeCatalog({
                revision: 1,
                source: 'embedded',
                badges: [
                    {
                        id: 'early-supporter',
                        label: 'Early Supporter',
                        description: 'Supported the fork from early on',
                        icon: 'HandHeart',
                        style: 'ember',
                        animation: 'shimmer'
                    }
                ],
                awards: [{ userId: awardee, badge: 'early-supporter' }]
            })
        });
        try {
            render(<UserBadges userId={awardee} size="full" />);
            fireEvent.focus(
                screen.getByRole('img', { name: 'Early Supporter' })
            );
            const description = await screen.findByText(
                'Supported the fork from early on'
            );
            expect(description.parentElement?.textContent).toBe(
                'Early SupporterSupported the fork from early on'
            );
        } finally {
            useGlobalBadgeStore.setState({ catalog: null });
        }
    });

    it('shows the staff badge for members of the VRChat staff group', () => {
        const memberId = 'usr_55555555-5555-5555-5555-555555555555';
        recordUserGroups(memberId, [VRCHAT_STAFF_GROUP_ID]);
        render(<UserBadges userId={memberId} />);
        expect(
            screen.getByRole('img', { name: 'dialog.user.badges.vrchat_staff' })
        ).toBeTruthy();
        resetUserGroupMembershipStoreForTests();
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
