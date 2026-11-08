import { describe, expect, it } from 'vitest';

import {
    FORK_DEVELOPER_USER_ID,
    UPSTREAM_DEVELOPER_USER_ID
} from '@/shared/constants/user';

import {
    BADGE_RULE_OPERATORS,
    CUSTOM_BADGE_GROUP_DEPTH_LIMIT,
    badgeRuleGroupIds,
    badgeUserFactsFrom,
    buildCustomBadgeIndex,
    extractBadgeUserIds,
    isGroupMemberListTruncated,
    isReservedBadgeIcon,
    isUserListedOnBadge,
    isVrchatStaff,
    normalizeCustomBadges,
    normalizeBadgeRule,
    resolveUserCustomBadges,
    setUserListedOnBadge,
    type CustomBadge,
    type CustomBadgeRule
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
    local: Record<string, string[]> = {},
    ownGroups: Record<string, boolean> = {}
) {
    const index = buildCustomBadgeIndex(
        normalizeCustomBadges(badges),
        remote,
        local
    );
    return resolveUserCustomBadges(
        index,
        userId,
        index.needsFacts
            ? badgeUserFactsFrom(
                  fact,
                  isFriend,
                  userId,
                  (groupId) => ownGroups[groupId] ?? null
              )
            : null
    ).map((entry) => entry.id);
}

describe('normalizeCustomBadges', () => {
    it('preserves nested operators and NOT through stored JSON', () => {
        const original = badge({
            assignedUserIds: [BOB],
            operator: 'and',
            rules: [
                { kind: 'friends', negated: true },
                {
                    kind: 'group',
                    operator: 'xand',
                    negated: true,
                    rules: [
                        { kind: 'users', userIds: [ALICE] },
                        { kind: 'supporter' }
                    ]
                }
            ]
        });
        expect(normalizeCustomBadges(JSON.stringify([original]))).toEqual([
            original
        ]);
        expect(
            normalizeCustomBadges(
                JSON.stringify([badge({ rules: [{ kind: 'friends' }] })])
            )[0].operator
        ).toBeUndefined();
    });

    it('rejects malformed expressions without changing their Boolean meaning', () => {
        const malformed = {
            kind: 'group',
            operator: 'nor',
            rules: [{ kind: 'unknown' }]
        };
        expect(normalizeBadgeRule(malformed)).toBeNull();
        expect(
            normalizeBadgeRule({
                kind: 'group',
                operator: 'unknown',
                rules: []
            })
        ).toBeNull();
        expect(
            normalizeCustomBadges([{ ...badge({}), operator: 'unknown' }])
        ).toEqual([]);
        expect(
            normalizeCustomBadges([
                {
                    ...badge({}),
                    operator: 'nand',
                    rules: [{ kind: 'friends' }, malformed]
                }
            ])[0].rules
        ).toEqual([]);
    });

    it('limits group nesting when reading settings', () => {
        let rule: CustomBadgeRule = { kind: 'friends' };
        for (let i = 0; i < CUSTOM_BADGE_GROUP_DEPTH_LIMIT; i++) {
            rule = { kind: 'group', operator: 'and', rules: [rule] };
        }
        expect(normalizeBadgeRule(rule)).toEqual(rule);
        expect(
            normalizeBadgeRule({
                kind: 'group',
                operator: 'and',
                rules: [rule]
            })
        ).toBeNull();
    });

    it('keeps valid profile rules and drops unknown options', () => {
        const [entry] = normalizeCustomBadges([
            badge({
                id: 'a',
                rules: [
                    { kind: 'ageVerified', level: 'adult' },
                    { kind: 'ageVerified', level: 'bogus' },
                    { kind: 'platform', platform: 'ios' },
                    { kind: 'platform', platform: 'web' },
                    { kind: 'status', status: 'busy' },
                    { kind: 'status', status: 'offline' },
                    { kind: 'pronouns', contains: ' she ' },
                    { kind: 'pronouns', contains: '' }
                ] as unknown as CustomBadge['rules']
            })
        ]);
        expect(entry.rules).toEqual([
            { kind: 'ageVerified', level: 'adult' },
            { kind: 'ageVerified', level: 'any' },
            { kind: 'platform', platform: 'ios' },
            { kind: 'status', status: 'busy' },
            { kind: 'pronouns', contains: 'she' }
        ]);
    });

    it('keeps reserved icon names, which draw as the default instead', () => {
        const [
            codeBadge,
            diamondBadge,
            staffBadge,
            donatorBadge,
            awardBadge,
            starBadge
        ] = normalizeCustomBadges([
            badge({ id: 'a', icon: 'CodeXml' }),
            badge({ id: 'b', icon: 'Diamond' }),
            badge({ id: 'd', icon: 'ShieldCheck' }),
            badge({ id: 'e', icon: 'HandHeart' }),
            badge({ id: 'f', icon: 'Rocket' }),
            badge({ id: 'c', icon: 'Music' })
        ]);
        // The names stay so Settings can say why the badge shows the default
        // icon; BadgeIcon refuses to draw them for custom badges.
        for (const entry of [
            codeBadge,
            diamondBadge,
            staffBadge,
            donatorBadge,
            awardBadge
        ]) {
            expect(isReservedBadgeIcon(entry.icon), entry.icon).toBe(true);
        }
        expect(codeBadge.icon).toBe('CodeXml');
        expect(starBadge.icon).toBe('Music');
        expect(isReservedBadgeIcon(starBadge.icon)).toBe(false);
    });

    it('keeps the developer accounts in user lists', () => {
        const [entry] = normalizeCustomBadges([
            badge({
                rules: [
                    {
                        kind: 'users',
                        userIds: [
                            FORK_DEVELOPER_USER_ID,
                            UPSTREAM_DEVELOPER_USER_ID,
                            ALICE
                        ]
                    }
                ]
            })
        ]);
        expect(entry.rules).toEqual([
            {
                kind: 'users',
                userIds: [
                    FORK_DEVELOPER_USER_ID,
                    UPSTREAM_DEVELOPER_USER_ID,
                    ALICE
                ]
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
    it.each([
        ['or', [false, true, true, true]],
        ['and', [false, false, false, true]],
        ['xor', [false, true, true, false]],
        ['nand', [true, true, true, false]],
        ['nor', [true, false, false, false]],
        ['xnor', [true, false, false, true]],
        ['xand', [true, false, false, true]]
    ] as const)(
        'evaluates the %s truth table with static and dynamic rules',
        (operator, expected) => {
            const entry = badge({
                operator,
                rules: [
                    { kind: 'users', userIds: [ALICE] },
                    { kind: 'friends' }
                ]
            });
            const inputs = [
                [BOB, false],
                [BOB, true],
                [ALICE, false],
                [ALICE, true]
            ] as const;
            inputs.forEach(([userId, friend], index) => {
                expect(resolve([entry], userId, null, friend)).toEqual(
                    expected[index] ? ['b1'] : []
                );
                const staticEntry = badge({
                    operator,
                    rules: [
                        entry.rules[0],
                        { kind: 'friendGroup', groupKey: 'local:Close' }
                    ]
                });
                expect(
                    resolve(
                        [staticEntry],
                        userId,
                        null,
                        false,
                        {},
                        { Close: friend ? [userId] : [] }
                    )
                ).toEqual(expected[index] ? ['b1'] : []);
            });
        }
    );

    it('uses odd and even parity for three or more rules', () => {
        const rules: CustomBadgeRule[] = [
            { kind: 'users', userIds: [ALICE] },
            { kind: 'friends' },
            { kind: 'supporter' }
        ];
        const badges = ['xor', 'xnor', 'xand'].map((operator) =>
            badge({
                id: operator,
                operator: operator as 'xor' | 'xnor' | 'xand',
                rules
            })
        );
        expect(
            resolve(badges, ALICE, { tags: ['system_supporter'] }, true)
        ).toEqual(['xor']);
        expect(resolve(badges, ALICE, { tags: [] }, true)).toEqual([
            'xnor',
            'xand'
        ]);
        expect(resolve(badges, BOB, { tags: [] }, false)).toEqual([
            'xnor',
            'xand'
        ]);
    });

    it('combines nested groups, favorite groups and NOT rules', () => {
        const entry = badge({
            operator: 'and',
            rules: [
                { kind: 'friendGroup', groupKey: 'local:Close' },
                { kind: 'supporter', negated: true },
                {
                    kind: 'group',
                    operator: 'or',
                    rules: [
                        { kind: 'platform', platform: 'android' },
                        { kind: 'platform', platform: 'ios' }
                    ]
                }
            ]
        });
        const local = { Close: [ALICE, BOB] };
        expect(
            resolve(
                [entry],
                ALICE,
                { last_platform: 'android' },
                false,
                {},
                local
            )
        ).toEqual(['b1']);
        expect(
            resolve(
                [entry],
                ALICE,
                { last_platform: 'ios', tags: ['system_supporter'] },
                false,
                {},
                local
            )
        ).toEqual([]);
        expect(
            resolve(
                [entry],
                BOB,
                { last_platform: 'standalonewindows' },
                false,
                {},
                local
            )
        ).toEqual([]);
        expect(
            resolve([entry], CAROL, { last_platform: 'ios' }, false, {}, local)
        ).toEqual([]);
    });

    it('evaluates static expressions and their negations without user facts', () => {
        const entry = badge({
            operator: 'and',
            rules: [
                { kind: 'users', userIds: [ALICE, BOB] },
                { kind: 'friendGroup', groupKey: 'group_1', negated: true }
            ]
        });
        const index = buildCustomBadgeIndex([entry], { group_1: [BOB] }, {});
        expect(index.needsFacts).toBe(false);
        expect(resolveUserCustomBadges(index, ALICE, null)).toEqual([entry]);
        expect(resolveUserCustomBadges(index, BOB, null)).toEqual([]);
        expect(resolveUserCustomBadges(index, CAROL, null)).toEqual([]);
        const negated = badge({
            rules: [
                {
                    kind: 'group',
                    operator: 'or',
                    negated: true,
                    rules: [{ kind: 'users', userIds: [ALICE] }]
                }
            ]
        });
        expect(resolve([negated], ALICE)).toEqual([]);
        expect(resolve([negated], BOB)).toEqual(['b1']);
    });

    it('keeps missing profile facts false before applying NOT', () => {
        expect(
            resolve(
                [
                    badge({
                        rules: [
                            { kind: 'platform', platform: 'ios', negated: true }
                        ]
                    })
                ],
                ALICE
            )
        ).toEqual(['b1']);
    });

    it.each(BADGE_RULE_OPERATORS)(
        'never matches an empty badge or empty %s group, including with NOT',
        (operator) => {
            expect(resolve([badge({ operator, rules: [] })], ALICE)).toEqual(
                []
            );
            expect(
                resolve(
                    [
                        badge({
                            rules: [
                                {
                                    kind: 'group',
                                    operator,
                                    rules: [],
                                    negated: true
                                }
                            ]
                        })
                    ],
                    ALICE
                )
            ).toEqual([]);
        }
    );

    it('tracks and resolves VRChat groups inside nested expressions', () => {
        const groupId = 'grp_00000000-0000-0000-0000-000000000001';
        const entry = badge({
            rules: [
                {
                    kind: 'group',
                    operator: 'and',
                    rules: [
                        { kind: 'friends' },
                        {
                            kind: 'vrchatGroup',
                            groupId,
                            groupName: '',
                            roleId: '',
                            roleName: '',
                            memberIds: [ALICE],
                            refreshedAt: 1,
                            truncated: false
                        }
                    ]
                }
            ]
        });
        expect(badgeRuleGroupIds([entry, entry])).toEqual([groupId]);
        expect(resolve([entry], ALICE, null, true)).toEqual(['b1']);
        expect(
            resolve([entry], ALICE, null, true, {}, {}, { [groupId]: false })
        ).toEqual([]);
        expect(
            resolve([entry], BOB, null, true, {}, {}, { [groupId]: true })
        ).toEqual(['b1']);
    });

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
                rules: [
                    { kind: 'users', userIds: [UPSTREAM_DEVELOPER_USER_ID] }
                ]
            })
        ];
        expect(resolve(badges, FORK_DEVELOPER_USER_ID, {}, true)).toEqual([
            'friends'
        ]);
        expect(resolve(badges, UPSTREAM_DEVELOPER_USER_ID, {}, true)).toEqual([
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

    it("trusts the user's own group list over the stored member list", () => {
        const group = 'grp_00000000-0000-0000-0000-000000000001';
        const rule = (memberIds: string[], roleId = '') =>
            badge({
                rules: [
                    {
                        kind: 'vrchatGroup',
                        groupId: group,
                        groupName: 'Group',
                        roleId,
                        roleName: roleId ? 'Role' : '',
                        memberIds,
                        refreshedAt: 1,
                        truncated: false
                    }
                ]
            });
        const own = (member: boolean) => ({ [group]: member });

        // In the user's list but missing from an incomplete member list.
        expect(
            resolve([rule([])], ALICE, null, false, {}, {}, own(true))
        ).toEqual(['b1']);
        // Left the group: their list wins over a stale member list.
        expect(
            resolve([rule([ALICE])], ALICE, null, false, {}, {}, own(false))
        ).toEqual([]);
        // Their list not seen: fall back to the stored member list.
        expect(resolve([rule([ALICE])], ALICE)).toEqual(['b1']);
        // A role needs the role's member list; the group list has no roles.
        const role = 'grol_00000000-0000-0000-0000-000000000001';
        expect(
            resolve([rule([], role)], ALICE, null, false, {}, {}, own(true))
        ).toEqual([]);
        expect(
            resolve(
                [rule([ALICE], role)],
                ALICE,
                null,
                false,
                {},
                {},
                own(true)
            )
        ).toEqual(['b1']);
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

        const bio = [
            badge({ id: 'bio', rules: [{ kind: 'bio', contains: 'Mapper' }] })
        ];
        expect(resolve(bio, ALICE, { bio: 'World mapper, DMs open' })).toEqual([
            'bio'
        ]);
        expect(resolve(bio, ALICE, { bio: '' })).toEqual([]);
        expect(resolve(bio, ALICE, null)).toEqual([]);
    });

    it('matches age verification the way the user dialog shows it', () => {
        const any = [
            badge({ id: 'age', rules: [{ kind: 'ageVerified', level: 'any' }] })
        ];
        const adult = [
            badge({
                id: 'adult',
                rules: [{ kind: 'ageVerified', level: 'adult' }]
            })
        ];
        const shown18 = { ageVerified: true, ageVerificationStatus: '18+' };
        const shown = { ageVerified: true, ageVerificationStatus: 'verified' };
        expect(resolve(any, ALICE, shown18)).toEqual(['age']);
        expect(resolve(any, ALICE, shown)).toEqual(['age']);
        expect(resolve(adult, ALICE, shown18)).toEqual(['adult']);
        expect(resolve(adult, ALICE, shown)).toEqual([]);
        expect(
            resolve(any, ALICE, {
                ageVerified: false,
                ageVerificationStatus: '18+'
            })
        ).toEqual([]);
        expect(resolve(any, ALICE, { ageVerified: true })).toEqual([]);
        expect(resolve(any, ALICE, null)).toEqual([]);
    });

    it('reads age verification from friend list data, which only has the status', () => {
        const adultFriend = [
            badge({
                id: 'adult-friend',
                rules: [
                    {
                        kind: 'group',
                        operator: 'and',
                        rules: [
                            { kind: 'friends' },
                            { kind: 'ageVerified', level: 'adult' }
                        ]
                    }
                ]
            })
        ];
        expect(
            resolve(adultFriend, ALICE, { ageVerificationStatus: '18+' }, true)
        ).toEqual(['adult-friend']);
        expect(
            resolve(adultFriend, ALICE, { ageVerificationStatus: '18+' }, false)
        ).toEqual([]);
        expect(
            resolve(
                adultFriend,
                ALICE,
                { ageVerificationStatus: 'hidden' },
                true
            )
        ).toEqual([]);
        const any = [
            badge({ id: 'age', rules: [{ kind: 'ageVerified', level: 'any' }] })
        ];
        expect(
            resolve(any, ALICE, { ageVerificationStatus: 'verified' })
        ).toEqual(['age']);
    });

    it('matches platform, status and pronouns from user facts', () => {
        const quest = [
            badge({
                id: 'quest',
                rules: [{ kind: 'platform', platform: 'android' }]
            })
        ];
        expect(resolve(quest, ALICE, { last_platform: 'android' })).toEqual([
            'quest'
        ]);
        expect(resolve(quest, ALICE, { platform: 'android' })).toEqual([
            'quest'
        ]);
        expect(
            resolve(quest, ALICE, {
                last_platform: 'standalonewindows',
                platform: 'android'
            })
        ).toEqual([]);

        const joinMe = [
            badge({
                id: 'join',
                rules: [{ kind: 'status', status: 'join me' }]
            })
        ];
        expect(resolve(joinMe, ALICE, { status: 'join me' })).toEqual(['join']);
        expect(resolve(joinMe, ALICE, { status: 'offline' })).toEqual([]);

        const pronouns = [
            badge({
                id: 'they',
                rules: [{ kind: 'pronouns', contains: 'they' }]
            })
        ];
        expect(resolve(pronouns, ALICE, { pronouns: 'They/Them' })).toEqual([
            'they'
        ]);
        expect(resolve(pronouns, ALICE, { pronouns: '' })).toEqual([]);
    });
});

describe('isVrchatStaff', () => {
    it('recognizes staff by developer type or moderator tag', () => {
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
    it('adds manual users with OR while preserving an existing expression', () => {
        const start = badge({
            operator: 'and',
            rules: [{ kind: 'friends' }, { kind: 'supporter' }]
        });
        const added = setUserListedOnBadge(start, ALICE, true);
        expect(added.rules).toEqual(start.rules);
        expect(isUserListedOnBadge(added, ALICE)).toBe(true);
        expect(resolve([added], ALICE)).toEqual(['b1']);
        expect(resolve([added], BOB, {}, true)).toEqual([]);
        expect(
            resolve([added], BOB, { tags: ['system_supporter'] }, true)
        ).toEqual(['b1']);
        const removed = setUserListedOnBadge(added, ALICE, false);
        expect(isUserListedOnBadge(removed, ALICE)).toBe(false);
        expect(resolve([removed], ALICE)).toEqual([]);
        expect(
            resolve([removed], BOB, { tags: ['system_supporter'] }, true)
        ).toEqual(['b1']);
    });

    it('preserves deeply nested rules when assigning users from the menu', () => {
        let rule: CustomBadgeRule = { kind: 'friends' };
        for (let i = 0; i < CUSTOM_BADGE_GROUP_DEPTH_LIMIT; i++) {
            rule = { kind: 'group', operator: 'and', rules: [rule] };
        }
        const original = badge({ operator: 'and', rules: [rule] });
        const assigned = setUserListedOnBadge(original, ALICE, true);
        const [saved] = normalizeCustomBadges(JSON.stringify([assigned]));
        expect(saved.rules).toEqual(original.rules);
        expect(resolve([saved], ALICE)).toEqual(['b1']);
        expect(resolve([saved], BOB)).toEqual([]);
        expect(resolve([saved], BOB, null, true)).toEqual(['b1']);
    });

    it('does not edit negated user lists or turn them into direct assignments', () => {
        const start = badge({
            rules: [{ kind: 'users', userIds: [ALICE], negated: true }]
        });
        expect(isUserListedOnBadge(start, ALICE)).toBe(false);
        const added = setUserListedOnBadge(start, ALICE, true);
        expect(added.rules[0]).toEqual(start.rules[0]);
        expect(resolve([added], ALICE)).toEqual(['b1']);
        const removed = setUserListedOnBadge(added, ALICE, false);
        expect(removed.rules).toEqual(start.rules);
    });

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

describe('enabled conditions', () => {
    function resolveWith(
        badges: CustomBadge[],
        userId: string,
        currentUserId: string | null,
        isFriend = false
    ) {
        const index = buildCustomBadgeIndex(
            normalizeCustomBadges(badges),
            {},
            {}
        );
        return resolveUserCustomBadges(
            index,
            userId,
            badgeUserFactsFrom(null, isFriend, userId, undefined, currentUserId)
        ).map((entry) => entry.id);
    }

    it('ignores the gate when only one condition is enabled', () => {
        const entry = badge({
            operator: 'nor',
            rules: [{ kind: 'friends' }, { kind: 'supporter', enabled: false }]
        });
        expect(resolveWith([entry], ALICE, null, true)).toEqual(['b1']);
        expect(resolveWith([entry], ALICE, null, false)).toEqual([]);
    });

    it('never matches with no enabled conditions, even under NOT', () => {
        const entry = badge({
            rules: [
                {
                    kind: 'group',
                    operator: 'or',
                    negated: true,
                    rules: [{ kind: 'friends', enabled: false }]
                }
            ]
        });
        expect(resolveWith([entry], ALICE, null, true)).toEqual([]);
        expect(resolveWith([entry], ALICE, null, false)).toEqual([]);
    });

    it('leaves disabled conditions out of the gate instead of counting them false', () => {
        const entry = badge({
            operator: 'and',
            rules: [
                { kind: 'friends' },
                { kind: 'supporter', enabled: false },
                { kind: 'users', userIds: [ALICE] }
            ]
        });
        expect(resolveWith([entry], ALICE, null, true)).toEqual(['b1']);
        expect(resolveWith([entry], BOB, null, true)).toEqual([]);
    });

    it('does not index a disabled user list or treat it as an assignment', () => {
        const entry = badge({
            rules: [{ kind: 'users', userIds: [ALICE], enabled: false }]
        });
        expect(resolveWith([entry], ALICE, null)).toEqual([]);
        expect(isUserListedOnBadge(entry, ALICE)).toBe(false);
    });

    it('drops a disabled incomplete condition without discarding the expression', () => {
        const [entry] = normalizeCustomBadges([
            badge({
                operator: 'and',
                rules: [
                    { kind: 'friends' },
                    {
                        kind: 'group',
                        operator: 'or',
                        rules: [
                            { kind: 'supporter' },
                            { kind: 'memo', contains: '', enabled: false }
                        ]
                    },
                    { kind: 'bio', contains: '', enabled: false }
                ] as CustomBadgeRule[]
            })
        ]);
        expect(entry.rules).toEqual([
            { kind: 'friends' },
            { kind: 'group', operator: 'or', rules: [{ kind: 'supporter' }] }
        ]);
        const [broken] = normalizeCustomBadges([
            badge({
                operator: 'and',
                rules: [
                    { kind: 'friends' },
                    { kind: 'bio', contains: '' }
                ] as CustomBadgeRule[]
            })
        ]);
        expect(broken.rules).toEqual([]);
    });
});

describe('Self condition', () => {
    function resolveSelf(
        badges: CustomBadge[],
        userId: string,
        currentUserId: string | null
    ) {
        const index = buildCustomBadgeIndex(
            normalizeCustomBadges(badges),
            {},
            {}
        );
        return resolveUserCustomBadges(
            index,
            userId,
            badgeUserFactsFrom(null, false, userId, undefined, currentUserId)
        ).map((entry) => entry.id);
    }

    it('round-trips through stored settings', () => {
        const entry = badge({
            rules: [{ kind: 'self', negated: true, enabled: false }]
        });
        expect(normalizeCustomBadges(JSON.stringify([entry]))).toEqual([entry]);
    });

    it('matches only the signed-in account without profile data', () => {
        const entry = badge({ rules: [{ kind: 'self' }] });
        expect(resolveSelf([entry], ALICE, ALICE)).toEqual(['b1']);
        expect(resolveSelf([entry], BOB, ALICE)).toEqual([]);
        expect(resolveSelf([entry], BOB, BOB)).toEqual(['b1']);
    });

    it('does not match while signed out or for an empty user id', () => {
        const entry = badge({ rules: [{ kind: 'self' }] });
        expect(resolveSelf([entry], ALICE, null)).toEqual([]);
        expect(badgeUserFactsFrom(null, false, '', undefined, '').isSelf).toBe(
            false
        );
    });

    it('works inside gates, under NOT and when disabled', () => {
        const everyoneElse = badge({
            id: 'others',
            rules: [{ kind: 'self', negated: true }]
        });
        const selfAndListed = badge({
            id: 'both',
            operator: 'and',
            rules: [
                { kind: 'self' },
                {
                    kind: 'group',
                    operator: 'or',
                    rules: [{ kind: 'users', userIds: [ALICE] }]
                }
            ]
        });
        const off = badge({
            id: 'off',
            rules: [{ kind: 'self', enabled: false }]
        });
        const all = [everyoneElse, selfAndListed, off];
        expect(resolveSelf(all, ALICE, ALICE)).toEqual(['both']);
        expect(resolveSelf(all, BOB, ALICE)).toEqual(['others']);
        expect(resolveSelf(all, BOB, BOB)).toEqual([]);
    });
});
