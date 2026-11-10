import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { CustomBadgeRule } from '@/domain/badges/customBadges';
import en from '@/localization/en.json';

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

describe('new condition wording', () => {
    const translate = ((key: string, values: Record<string, unknown> = {}) => {
        let node: unknown = en;
        for (const part of key.split('.')) {
            node = (node as Record<string, unknown> | undefined)?.[part];
        }
        if (typeof node !== 'string') {
            throw new Error(`Missing string ${key}`);
        }
        return node.replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
    }) as unknown as TFunction;
    const describe1 = (rule: CustomBadgeRule) =>
        describeCustomBadge({ rules: [rule] }, translate);

    it('reads text conditions by match mode', () => {
        expect(describe1({ kind: 'bio', contains: 'dj' })).toBe(
            'Users who have a bio containing "dj"'
        );
        expect(
            describe1({
                kind: 'displayName',
                contains: 'Al',
                match: 'startsWith'
            })
        ).toBe('Users who have a display name starting with "Al"');
        expect(
            describe1({ kind: 'statusText', contains: 'afk', match: 'exact' })
        ).toBe('Users who have a status text equal to "afk"');
        expect(
            describe1({ kind: 'pronouns', contains: '^she', match: 'regex' })
        ).toBe('Users who have pronouns matching /^she/');
        expect(
            describe1({
                kind: 'memo',
                contains: '',
                match: 'any',
                negated: true
            })
        ).toBe('Users who do not have a memo or note');
    });

    it('reads language, friend number, moderation and offline conditions', () => {
        expect(describe1({ kind: 'language', language: 'eng' })).toBe(
            'Users who speak English (ENG)'
        );
        expect(describe1({ kind: 'friendNumber', min: 1, max: 50 })).toBe(
            'Users who have a friend number of 1 to 50'
        );
        expect(describe1({ kind: 'friendNumber', min: 100, max: 0 })).toBe(
            'Users who have a friend number of 100 or higher'
        );
        expect(
            describe1({ kind: 'moderation', moderation: 'mute', negated: true })
        ).toBe('Users who are not muted by you');
        expect(describe1({ kind: 'status', status: 'offline' })).toBe(
            'Users who have the status Offline'
        );
    });
});
