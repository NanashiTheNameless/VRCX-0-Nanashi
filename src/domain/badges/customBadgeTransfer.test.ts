import { describe, expect, it } from 'vitest';

import { CUSTOM_BADGE_WARN_COUNT, type CustomBadge } from './customBadges';
import {
    CUSTOM_BADGE_EXPORT_FORMAT,
    exportCustomBadgesJsonc,
    mergeImportedBadges,
    parseCustomBadgesJsonc
} from './customBadgeTransfer';

const ALICE = 'usr_11111111-1111-1111-1111-111111111111';
const GROUP = 'grp_11111111-1111-1111-1111-111111111111';

function badge(overrides: Partial<CustomBadge> = {}): CustomBadge {
    return {
        id: 'b1',
        label: 'Friends */ here',
        icon: 'Star',
        color: '#112233',
        enabled: true,
        operator: 'and',
        rules: [
            { kind: 'friends' },
            {
                kind: 'group',
                operator: 'or',
                negated: true,
                rules: [
                    { kind: 'users', userIds: [ALICE] },
                    {
                        kind: 'vrchatGroup',
                        groupId: GROUP,
                        groupName: 'Group',
                        roleId: '',
                        roleName: '',
                        memberIds: [ALICE],
                        refreshedAt: 1700000000,
                        truncated: true
                    }
                ]
            }
        ],
        ...overrides
    };
}

describe('exportCustomBadgesJsonc', () => {
    it('round-trips badges and leaves fetched member lists out', () => {
        const text = exportCustomBadgesJsonc([badge()]);
        expect(text).toContain(`"format": "${CUSTOM_BADGE_EXPORT_FORMAT}"`);
        expect(text).toContain('// Friends * / here');
        const result = parseCustomBadgesJsonc(text);
        expect(result).toEqual({
            ok: true,
            invalid: 0,
            badges: [
                badge({
                    rules: [
                        { kind: 'friends' },
                        {
                            kind: 'group',
                            operator: 'or',
                            negated: true,
                            rules: [
                                { kind: 'users', userIds: [ALICE] },
                                {
                                    kind: 'vrchatGroup',
                                    groupId: GROUP,
                                    groupName: 'Group',
                                    roleId: '',
                                    roleName: '',
                                    memberIds: [],
                                    refreshedAt: 0,
                                    truncated: false
                                }
                            ]
                        }
                    ]
                })
            ]
        });
    });

    it('exports an empty list that still imports', () => {
        expect(parseCustomBadgesJsonc(exportCustomBadgesJsonc([]))).toEqual({
            ok: true,
            badges: [],
            invalid: 0
        });
    });
});

describe('parseCustomBadgesJsonc', () => {
    it('accepts a single badge, a bare list, comments and trailing commas', () => {
        const single = `// one badge
{ "id": "x", "label": "Me", "rules": [{ "kind": "self" },], }`;
        expect(parseCustomBadgesJsonc(single)).toMatchObject({
            ok: true,
            badges: [{ id: 'x', label: 'Me', rules: [{ kind: 'self' }] }]
        });
        expect(
            parseCustomBadgesJsonc(
                '[{ "id": "a", "label": "A" }, { "id": "" }]'
            )
        ).toMatchObject({ ok: true, invalid: 1, badges: [{ id: 'a' }] });
    });

    it('reports syntax errors, other formats and newer versions', () => {
        expect(parseCustomBadgesJsonc('{ "id": ')).toMatchObject({ ok: false });
        expect(
            parseCustomBadgesJsonc('{ "format": "other", "badges": [] }')
        ).toMatchObject({ ok: false });
        expect(
            parseCustomBadgesJsonc(
                `{ "format": "${CUSTOM_BADGE_EXPORT_FORMAT}", "version": 99, "badges": [] }`
            )
        ).toMatchObject({ ok: false });
        expect(parseCustomBadgesJsonc('"text"')).toMatchObject({ ok: false });
    });
});

describe('mergeImportedBadges', () => {
    it('replaces same-id badges in place, or adds copies with new ids', () => {
        const current = [badge({ id: 'a', label: 'A' }), badge({ id: 'b' })];
        const imported = [badge({ id: 'a', label: 'New A' })];
        const replaced = mergeImportedBadges(current, imported, true);
        expect(replaced).toMatchObject({ added: 0, replaced: 1 });
        expect(replaced.badges.map((entry) => entry.label)).toEqual([
            'New A',
            current[1].label
        ]);
        const copied = mergeImportedBadges(current, imported, false);
        expect(copied).toMatchObject({ added: 1, replaced: 0 });
        expect(copied.badges).toHaveLength(3);
        expect(new Set(copied.badges.map((entry) => entry.id)).size).toBe(3);
    });

    it('keeps adding past the warning count and still replaces', () => {
        const current = Array.from(
            { length: CUSTOM_BADGE_WARN_COUNT },
            (_, i) => badge({ id: `b${i}` })
        );
        const merged = mergeImportedBadges(
            current,
            [badge({ id: 'b0', label: 'Kept' }), badge({ id: 'new' })],
            true
        );
        expect(merged).toMatchObject({ added: 1, replaced: 1 });
        expect(merged.badges).toHaveLength(CUSTOM_BADGE_WARN_COUNT + 1);
        expect(merged.badges[0].label).toBe('Kept');
    });
});
