import { describe, expect, it } from 'vitest';

import {
    FORK_MAINTAINER_USER_ID,
    OWNER_USER_ID
} from '@/shared/constants/user';

import {
    badgeUserFactsFrom,
    buildCustomBadgeIndex,
    DEFAULT_CUSTOM_BADGE_ICON,
    extractBadgeUserIds,
    isGroupMemberListTruncated,
    isUserListedOnBadge,
    isVrchatStaff,
    normalizeCustomBadges,
    resolveUserCustomBadges,
    setUserListedOnBadge,
    type CustomBadge
} from './customBadges';

const ALICE = 'usr_11111111-1111-1111-1111-111111111111';
const BOB = 'usr_22222222-2222-2222-2222-222222222222';
const CAROL = 'usr_33333333-3333-3333-3333-333333333333';

function badge(overrides: Partial<CustomBadge>): CustomBadge {
    return {
        id: 'b1',
        label: 'Badge',
        icon: 'Star',
        color: '#112233',
        enabled: true,
        rules: [],
        ...overrides
    };
}

function resolve(
    badges: CustomBadge[],
    userId: string,
    fact: Record<string, unknown> | null = null,
    isFriend = false,
    remote: Record<string, string[]> = {},
    local: Record<string, string[]> = {}
) {
    const index = buildCustomBadgeIndex(
        normalizeCustomBadges(badges),
        remote,
        local
    );
    return resolveUserCustomBadges(
        index,
        userId,
        index.needsFacts ? badgeUserFactsFrom(fact, isFriend) : null
    ).map((entry) => entry.id);
}

describe('normalizeCustomBadges', () => {
    it('refuses the icons reserved for the built-in badges', () => {
        const [codeBadge, diamondBadge, staffBadge, starBadge] =
            normalizeCustomBadges([
                badge({ id: 'a', icon: 'CodeXml' }),
                badge({ id: 'b', icon: 'Diamond' }),
                badge({ id: 'd', icon: 'ShieldCheck' }),
                badge({ id: 'c', icon: 'Rocket' })
            ]);
        expect(codeBadge.icon).toBe(DEFAULT_CUSTOM_BADGE_ICON);
        expect(diamondBadge.icon).toBe(DEFAULT_CUSTOM_BADGE_ICON);
        expect(staffBadge.icon).toBe(DEFAULT_CUSTOM_BADGE_ICON);
        expect(starBadge.icon).toBe('Rocket');
    });

    it('keeps the developer accounts in user lists', () => {
        const [entry] = normalizeCustomBadges([
            badge({
                rules: [
                    {
                        kind: 'users',
                        userIds: [FORK_MAINTAINER_USER_ID, OWNER_USER_ID, ALICE]
                    }
                ]
            })
        ]);
        expect(entry.rules).toEqual([
            {
                kind: 'users',
                userIds: [FORK_MAINTAINER_USER_ID, OWNER_USER_ID, ALICE]
            }
        ]);
    });

    it('reads a stored JSON string and skips invalid entries', () => {
        const badges = normalizeCustomBadges(
            JSON.stringify([
                { id: 'x', label: '' },
                {
                    id: 'y',
                    label: 'Ok',
                    color: 'red',
                    rules: [{ kind: 'nope' }]
                }
            ])
        );
        expect(badges).toHaveLength(1);
        expect(badges[0]).toMatchObject({
            id: 'y',
            color: '#3b82f6',
            rules: []
        });
        expect(normalizeCustomBadges('not json')).toEqual([]);
    });
});

describe('extractBadgeUserIds', () => {
    it('pulls user ids out of pasted links and text', () => {
        expect(
            extractBadgeUserIds(
                `https://vrchat.com/home/user/${ALICE}\n${BOB} ${ALICE}`
            )
        ).toEqual([ALICE, BOB]);
    });
});

describe('resolveUserCustomBadges', () => {
    it('gives one user several badges in list order', () => {
        const badges = [
            badge({
                id: 'first',
                rules: [{ kind: 'users', userIds: [ALICE] }]
            }),
            badge({ id: 'other', rules: [{ kind: 'users', userIds: [BOB] }] }),
            badge({
                id: 'second',
                rules: [{ kind: 'users', userIds: [ALICE] }]
            })
        ];
        expect(resolve(badges, ALICE)).toEqual(['first', 'second']);
        expect(resolve(badges, CAROL)).toEqual([]);
    });

    it('skips disabled badges', () => {
        expect(
            resolve(
                [
                    badge({
                        enabled: false,
                        rules: [{ kind: 'users', userIds: [ALICE] }]
                    })
                ],
                ALICE
            )
        ).toEqual([]);
    });

    it('applies custom badges to the developer accounts too', () => {
        const badges = [
            badge({ id: 'friends', rules: [{ kind: 'friends' }] }),
            badge({
                id: 'listed',
                rules: [{ kind: 'users', userIds: [OWNER_USER_ID] }]
            })
        ];
        expect(resolve(badges, FORK_MAINTAINER_USER_ID, {}, true)).toEqual([
            'friends'
        ]);
        expect(resolve(badges, OWNER_USER_ID, {}, true)).toEqual([
            'friends',
            'listed'
        ]);
    });

    it('matches remote and local favorite friend groups', () => {
        const badges = [
            badge({
                id: 'remote',
                rules: [{ kind: 'friendGroup', groupKey: 'group_1' }]
            }),
            badge({
                id: 'local',
                rules: [{ kind: 'friendGroup', groupKey: 'local:Close' }]
            })
        ];
        const remote = { group_1: [ALICE] };
        const local = { Close: [BOB] };
        expect(resolve(badges, ALICE, null, false, remote, local)).toEqual([
            'remote'
        ]);
        expect(resolve(badges, BOB, null, false, remote, local)).toEqual([
            'local'
        ]);
    });

    it('matches saved VRChat group members', () => {
        const badges = [
            badge({
                rules: [
                    {
                        kind: 'vrchatGroup',
                        groupId: 'grp_00000000-0000-0000-0000-000000000001',
                        groupName: 'Group',
                        roleId: '',
                        roleName: '',
                        memberIds: [CAROL],
                        refreshedAt: 1,
                        truncated: false
                    }
                ]
            })
        ];
        expect(resolve(badges, CAROL)).toEqual(['b1']);
        expect(resolve(badges, ALICE)).toEqual([]);
    });

    it('matches friends, supporters, trust rank and memos from user facts', () => {
        const friends = [
            badge({ id: 'friends', rules: [{ kind: 'friends' }] })
        ];
        expect(resolve(friends, ALICE, null, true)).toEqual(['friends']);
        expect(resolve(friends, ALICE, null, false)).toEqual([]);

        const supporter = [
            badge({ id: 'vrc', rules: [{ kind: 'supporter' }] })
        ];
        expect(
            resolve(supporter, ALICE, { tags: ['system_supporter'] })
        ).toEqual(['vrc']);
        expect(resolve(supporter, ALICE, { tags: [] })).toEqual([]);

        const trusted = [
            badge({
                id: 'trusted',
                rules: [{ kind: 'trust', trustKey: 'trusted' }]
            })
        ];
        expect(
            resolve(trusted, ALICE, { $trustClass: 'x-tag-trusted' })
        ).toEqual(['trusted']);
        const visitors = [
            badge({
                id: 'visitor',
                rules: [{ kind: 'trust', trustKey: 'untrusted' }]
            })
        ];
        expect(resolve(visitors, ALICE, null)).toEqual([]);

        const memo = [
            badge({ id: 'memo', rules: [{ kind: 'memo', contains: 'DJ' }] })
        ];
        expect(resolve(memo, ALICE, { memo: 'great dj' })).toEqual(['memo']);
        expect(resolve(memo, ALICE, { memo: 'artist' })).toEqual([]);
    });
});

describe('isVrchatStaff', () => {
    it('recognises staff by developer type or moderator tag', () => {
        expect(isVrchatStaff({ developerType: 'internal' })).toBe(true);
        expect(isVrchatStaff({ tags: ['admin_moderator'] })).toBe(true);
        expect(isVrchatStaff({ $isModerator: true })).toBe(true);
    });

    it('does not mark regular or unknown users as staff', () => {
        expect(isVrchatStaff({ developerType: 'none', tags: [] })).toBe(false);
        expect(isVrchatStaff({ tags: ['system_supporter'] })).toBe(false);
        expect(isVrchatStaff(null)).toBe(false);
    });
});

describe('setUserListedOnBadge', () => {
    it('adds a user list rule when the badge has none', () => {
        const next = setUserListedOnBadge(
            badge({ rules: [{ kind: 'friends' }] }),
            ALICE,
            true
        );
        expect(next.rules).toEqual([
            { kind: 'friends' },
            { kind: 'users', userIds: [ALICE] }
        ]);
        expect(isUserListedOnBadge(next, ALICE)).toBe(true);
    });

    it('appends to the existing user list once', () => {
        const start = badge({ rules: [{ kind: 'users', userIds: [BOB] }] });
        const next = setUserListedOnBadge(
            setUserListedOnBadge(start, ALICE, true),
            ALICE,
            true
        );
        expect(next.rules).toEqual([{ kind: 'users', userIds: [BOB, ALICE] }]);
    });

    it('removes the user and drops a user list left empty', () => {
        const start = badge({
            rules: [{ kind: 'users', userIds: [ALICE] }, { kind: 'supporter' }]
        });
        const next = setUserListedOnBadge(start, ALICE, false);
        expect(next.rules).toEqual([{ kind: 'supporter' }]);
        expect(isUserListedOnBadge(next, ALICE)).toBe(false);
    });
});

describe('isGroupMemberListTruncated', () => {
    it('flags a fetch that reached the member limit', () => {
        expect(isGroupMemberListTruncated(5000, 0, false)).toBe(true);
        expect(isGroupMemberListTruncated(5000, 0, true)).toBe(true);
    });

    it('flags a whole group bigger than the limit', () => {
        expect(isGroupMemberListTruncated(4800, 20000, false)).toBe(true);
    });

    it('ignores the group total when only one role was fetched', () => {
        expect(isGroupMemberListTruncated(120, 20000, true)).toBe(false);
    });

    it('does not flag a complete small group', () => {
        expect(isGroupMemberListTruncated(300, 310, false)).toBe(false);
    });
});
