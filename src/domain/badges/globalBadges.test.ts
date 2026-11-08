import { icons } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { isReservedBadgeIcon, normalizeBadgeIcon } from './customBadges';
import {
    type GlobalBadgeCatalog,
    activeAwardsFor,
    AWARD_ANIMATIONS,
    AWARD_ICONS,
    AWARD_STYLES,
    awardAnimations,
    DEFAULT_AWARD_ANIMATION,
    awardIcon,
    awardStyle,
    normalizeHexColor,
    parseAwardDate,
    validateGlobalBadgeFile
} from './globalBadges';

const USER = 'usr_11111111-1111-1111-1111-111111111111';

// Only the fields each test cares about; the rest default like the app's.
function catalog(
    awards: Partial<GlobalBadgeCatalog['awards'][number]>[]
): GlobalBadgeCatalog {
    return {
        revision: 1,
        source: 'embedded',
        badges: [
            {
                id: 'donator',
                label: 'Donator',
                description: '',
                icon: 'HandHeart',
                style: 'ember',
                animation: 'shimmer'
            },
            {
                id: 'beta-tester',
                label: 'Beta Tester',
                description: '',
                icon: 'FlaskConical',
                style: 'sapphire',
                animation: 'breathe'
            }
        ],
        awards
    } as unknown as GlobalBadgeCatalog;
}

describe('award appearance', () => {
    it('only lists icons that exist and reserves all of them', () => {
        const known = icons as Record<string, unknown>;
        for (const icon of AWARD_ICONS) {
            expect(known[icon], icon).toBeTruthy();
            expect(isReservedBadgeIcon(icon), icon).toBe(true);
        }
    });

    it('keeps a reserved icon name so Settings can explain it', () => {
        // The badge still draws the default icon; BadgeIcon refuses reserved
        // names for custom badges.
        expect(normalizeBadgeIcon('ShieldUser')).toBe('ShieldUser');
        expect(isReservedBadgeIcon(normalizeBadgeIcon('ShieldUser'))).toBe(
            true
        );
        expect(normalizeBadgeIcon('not an icon')).toBe('Star');
    });

    it('keeps the code, shield and award icon families', () => {
        for (const icon of [
            'Code',
            'FileCode',
            'SquareCode',
            'Braces',
            'DiamondPlus',
            'BugOff',
            'Sparkles',
            'SparkleSquare',
            'ZapOff',
            'GitPullRequestDraft',
            'FlaskRound',
            'BadgeCheck',
            'LabGemRing',
            'LabCopyCode'
        ]) {
            expect(isReservedBadgeIcon(icon), icon).toBe(true);
        }
        for (const icon of [
            'QrCode',
            'ScanQrCode',
            'WandSparkles',
            'DatabaseZap',
            'Codesandbox',
            'Star',
            'Heart',
            'Music'
        ]) {
            expect(isReservedBadgeIcon(icon), icon).toBe(false);
        }
    });

    it('keeps every shield icon for the VRChat Staff badge', () => {
        for (const icon of [
            'Shield',
            'ShieldUser',
            'ShieldHalf',
            'UserShield'
        ]) {
            expect(isReservedBadgeIcon(icon), icon).toBe(true);
        }
        expect(isReservedBadgeIcon('Heart')).toBe(false);
    });

    it('falls back to defaults for unknown names', () => {
        // Any well-formed icon name is allowed; only malformed ones fall back.
        expect(awardIcon('Skull')).toBe('Skull');
        expect(awardIcon('LabGemRing')).toBe('LabGemRing');
        expect(awardIcon('not an icon')).toBe('Award');
        expect(awardStyle('neon')).toBe('gold');
        expect(awardAnimations('spin')).toEqual(['shimmer']);
        expect(awardStyle(AWARD_STYLES[3])).toBe(AWARD_STYLES[3]);
        expect(awardAnimations(AWARD_ANIMATIONS[0])).toEqual([]);
    });
});

describe('awardAnimations', () => {
    it('reads one effect, several, or none', () => {
        expect(awardAnimations('glow')).toEqual(['glow']);
        expect(awardAnimations(' embers  glow ')).toEqual(['embers', 'glow']);
        expect(awardAnimations('flow flow sparkle')).toEqual([
            'flow',
            'sparkle'
        ]);
        expect(awardAnimations('none')).toEqual([]);
    });

    it('skips unknown names and falls back to the default when none are left', () => {
        expect(awardAnimations('spin flip')).toEqual(['flip']);
        expect(awardAnimations('spin')).toEqual(['shimmer']);
        expect(awardAnimations('')).toEqual(['shimmer']);
    });

    it('matches what apps from before combined effects show for a list', () => {
        // They looked the whole value up as one effect name and fell back to
        // the default, so a list shows as shimmer there.
        const olderApp = (value: string) =>
            AWARD_ANIMATIONS.find((animation) => animation === value) ??
            DEFAULT_AWARD_ANIMATION;
        expect(olderApp('embers glow')).toBe('shimmer');
        expect(DEFAULT_AWARD_ANIMATION).toBe('shimmer');
    });
});

describe('normalizeHexColor', () => {
    it('accepts long and short hex codes with or without #', () => {
        expect(normalizeHexColor('#FF8800')).toBe('#ff8800');
        expect(normalizeHexColor('ff8800')).toBe('#ff8800');
        expect(normalizeHexColor('#f80')).toBe('#ff8800');
        expect(normalizeHexColor(' F80 ')).toBe('#ff8800');
        expect(normalizeHexColor('red')).toBeNull();
        expect(normalizeHexColor('#ff88')).toBeNull();
        expect(normalizeHexColor('')).toBeNull();
    });
});

describe('activeAwardsFor', () => {
    it('shows awards inside their dates, in badge order', () => {
        const list = catalog([
            {
                userId: USER,
                badge: 'beta-tester',
                reason: '',
                since: 100,
                until: 200
            },
            {
                userId: USER,
                badge: 'donator',
                reason: '',
                since: null,
                until: null
            }
        ]);
        expect(activeAwardsFor(list, USER, 150).map((a) => a.badge.id)).toEqual(
            ['donator', 'beta-tester']
        );
        expect(activeAwardsFor(list, USER, 99).map((a) => a.badge.id)).toEqual([
            'donator'
        ]);
        expect(activeAwardsFor(list, USER, 200).map((a) => a.badge.id)).toEqual(
            ['donator']
        );
        expect(activeAwardsFor(list, 'usr_other', 150)).toEqual([]);
        expect(activeAwardsFor(null, USER, 150)).toEqual([]);
    });

    it('builds one-off custom awards from the award itself, after typed ones', () => {
        const overrides = {
            label: 'First Tester',
            description: 'Tested build one',
            icon: 'Rocket',
            style: '',
            animation: '',
            colorFrom: '#123456',
            colorTo: '',
            colorBorder: '',
            colorText: ''
        };
        const list = catalog([
            {
                userId: USER,
                badge: 'custom',
                reason: '',
                since: null,
                until: null,
                overrides
            },
            {
                userId: USER,
                badge: 'custom',
                reason: '',
                since: null,
                until: null,
                overrides: { ...overrides, label: '' }
            },
            {
                userId: USER,
                badge: 'donator',
                reason: '',
                since: null,
                until: null
            }
        ]);
        const awards = activeAwardsFor(list, USER, 150);
        expect(awards.map((a) => a.badge.label)).toEqual([
            'Donator',
            'First Tester'
        ]);
        expect(awards[1].badge).toMatchObject({
            id: 'custom',
            description: 'Tested build one',
            icon: 'Rocket',
            style: 'gold',
            animation: 'shimmer',
            colorFrom: '#123456'
        });
    });
});

describe('validateGlobalBadgeFile', () => {
    const badge = {
        id: 'donator',
        label: 'Donator',
        icon: 'HandHeart',
        style: 'ember',
        animation: 'shimmer'
    };

    it('accepts a correct file', () => {
        expect(
            validateGlobalBadgeFile({
                revision: 2,
                badges: [badge],
                awards: [
                    {
                        userId: USER,
                        badge: 'donator',
                        name: 'Someone',
                        reason: 'Thanks',
                        since: '2026-11-07',
                        until: '2027-11-07T00:00:00Z'
                    },
                    {
                        userId: USER,
                        badge: 'donator',
                        animation: 'embers glow flip'
                    },
                    {
                        userId: USER,
                        badge: 'custom',
                        label: 'First Tester',
                        description: 'Tested build one',
                        icon: 'Rocket',
                        colorFrom: '#123456'
                    }
                ]
            })
        ).toEqual([]);
    });

    it('rejects broken effect lists', () => {
        for (const animation of ['none glow', 'glow glow', 'glow spin', '']) {
            expect(
                validateGlobalBadgeFile({
                    revision: 1,
                    badges: [{ ...badge, animation }],
                    awards: []
                }),
                animation
            ).toEqual([expect.stringContaining('"animation" must be one of')]);
        }
    });

    it('accepts any real icon and rejects names the icon set lacks', () => {
        const iconNames = new Set(['Cat', 'HandHeart', 'LabGemRing']);
        const withIcon = (icon: string) =>
            validateGlobalBadgeFile(
                { revision: 1, badges: [{ ...badge, icon }], awards: [] },
                { iconNames }
            );
        expect(withIcon('Cat')).toEqual([]);
        expect(withIcon('LabGemRing')).toEqual([]);
        expect(withIcon('Sproutt')).toEqual([
            expect.stringContaining('"icon" must be a Lucide icon name')
        ]);
        // Without the icon list only the name's shape is checked.
        expect(
            validateGlobalBadgeFile({
                revision: 1,
                badges: [{ ...badge, icon: 'Sproutt' }],
                awards: []
            })
        ).toEqual([]);
    });

    it('reports every kind of mistake', () => {
        const problems = validateGlobalBadgeFile({
            revision: 0,
            badges: [
                {
                    ...badge,
                    icon: 'not-an-icon',
                    style: 'neon',
                    animation: 'spin',
                    colorFrom: 'orange',
                    extra: 1
                },
                { ...badge, id: 'Bad Id' },
                { ...badge, id: 'custom' },
                { ...badge }
            ],
            awards: [
                { userId: 'nope', badge: 'missing', since: 'yesterday' },
                {
                    userId: USER,
                    badge: 'donator',
                    since: '2026-11-07',
                    until: '2026-11-01'
                },
                { userId: USER, badge: 'donator', since: '2026-11-07T10:00' },
                { userId: USER, badge: 'custom' }
            ]
        });
        const text = problems.join('\n');
        for (const fragment of [
            '"revision"',
            '"icon"',
            '"style"',
            '"animation"',
            'unknown field "extra"',
            '"colorFrom" must be a hex color',
            '"id" must be',
            'used twice',
            '"userId"',
            '"badge" must be',
            '"since" must be epoch seconds',
            '"until" must be after',
            'kept for one-off awards',
            'a custom award needs a "label"'
        ]) {
            expect(text, fragment).toContain(fragment);
        }
    });

    it('reads dates as UTC', () => {
        expect(parseAwardDate('2026-11-07')).toBe(1_794_009_600);
        expect(parseAwardDate('2026-11-07T01:00:00+01:00')).toBe(1_794_009_600);
        expect(parseAwardDate('2026-11-07T10:00')).toBeNull();
        expect(parseAwardDate(1_794_009_600)).toBe(1_794_009_600);
        expect(parseAwardDate(1_794_009_600_000)).toBe(1_794_009_600);
        expect(parseAwardDate(-5)).toBeNull();
    });
});
