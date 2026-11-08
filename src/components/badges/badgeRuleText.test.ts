import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { describeCustomBadge, usesAdvancedBadgeLogic } from './badgeRuleText';

const P = 'view.settings.appearance.user_badges.';
const strings: Record<string, string> = {
    'summary.lead': 'Users who {expression}',
    'summary.nobody': 'Nobody',
    'summary.and': ' and ',
    'summary.or': ' or ',
    'summary.not_group': 'do not match ({item})',
    'summary.users': '{count} listed',
    'summary.assigned': '{count} assigned, plus users who {expression}',
    'summary.wrap.nor': 'match none of ({items})',
    'phrase.friends': 'are your friends',
    'phrase_not.friends': 'are not your friends',
    'phrase.platform': 'were last on',
    'phrase.status': 'have the status',
    'phrase.self': 'are you',
    'platform_option.standalonewindows': 'PC',
    'status_option.join_me': 'Join Me',
    'status_option.active': 'Online'
};
const t = ((key: string, values: Record<string, unknown> = {}) =>
    (strings[key.replace(P, '')] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
        String(values[name])
    )) as unknown as TFunction;

describe('describeCustomBadge', () => {
    it('reads a nested expression as plain words', () => {
        expect(
            describeCustomBadge(
                {
                    operator: 'and',
                    rules: [
                        { kind: 'friends' },
                        { kind: 'platform', platform: 'standalonewindows' },
                        {
                            kind: 'group',
                            operator: 'or',
                            rules: [
                                { kind: 'status', status: 'join me' },
                                { kind: 'status', status: 'active' }
                            ]
                        }
                    ]
                },
                t
            )
        ).toBe(
            'Users who are your friends and were last on PC and (have the status Join Me or have the status Online)'
        );
    });

    it('skips disabled conditions and the gate of a single enabled one', () => {
        expect(
            describeCustomBadge(
                {
                    operator: 'nor',
                    rules: [
                        { kind: 'friends', negated: true },
                        { kind: 'self', enabled: false }
                    ]
                },
                t
            )
        ).toBe('Users who are not your friends');
        expect(
            describeCustomBadge(
                { rules: [{ kind: 'self', enabled: false }] },
                t
            )
        ).toBe('Nobody');
    });

    it('wraps other gates and negated groups, and mentions assigned users', () => {
        expect(
            describeCustomBadge(
                {
                    operator: 'nor',
                    assignedUserIds: ['usr_1'],
                    rules: [
                        { kind: 'self' },
                        {
                            kind: 'group',
                            operator: 'or',
                            negated: true,
                            rules: [{ kind: 'friends' }, { kind: 'self' }]
                        }
                    ]
                },
                t
            )
        ).toBe(
            '1 assigned, plus users who match none of (are you, do not match (are your friends or are you))'
        );
    });
});

describe('usesAdvancedBadgeLogic', () => {
    it('detects advanced operators anywhere in the tree', () => {
        expect(usesAdvancedBadgeLogic('and', [{ kind: 'friends' }])).toBe(
            false
        );
        expect(
            usesAdvancedBadgeLogic('or', [
                { kind: 'group', operator: 'xnor', rules: [] }
            ])
        ).toBe(true);
    });
});
