import { describe, expect, it } from 'vitest';

import {
    CUSTOM_BADGE_LABEL_MAX,
    DEFAULT_CUSTOM_BADGE_COLOR,
    isReservedBadgeIcon
} from '@/domain/badges/customBadges';

import {
    useVrcxCustomTagStore,
    vrcxCustomTagBadge,
    vrcxCustomTagHexColor,
    vrcxCustomTagIcon,
    VRCX_TAG_BADGE_ICON
} from './vrcxCustomTagStore';

describe('VRCX IPC tags as custom badges', () => {
    it('turns the colors programs send into badge colors', () => {
        expect(vrcxCustomTagHexColor('#ABCDEF')).toBe('#abcdef');
        expect(vrcxCustomTagHexColor('#f0a')).toBe('#ff00aa');
        expect(vrcxCustomTagHexColor('#f0a8')).toBe('#ff00aa');
        expect(vrcxCustomTagHexColor('#11223344')).toBe('#112233');
        expect(vrcxCustomTagHexColor(' ')).toBe(DEFAULT_CUSTOM_BADGE_COLOR);
        expect(vrcxCustomTagHexColor('not a color')).toBe(
            DEFAULT_CUSTOM_BADGE_COLOR
        );
    });

    it('makes a round custom badge with an unreserved icon', () => {
        const badge = vrcxCustomTagBadge({
            userId: 'usr_a',
            id: '',
            tag: `  ${'x'.repeat(CUSTOM_BADGE_LABEL_MAX + 5)}  `,
            colour: '#00ff00',
            icon: ''
        });
        expect(badge).toMatchObject({
            id: 'vrcx-ipc:usr_a:',
            icon: VRCX_TAG_BADGE_ICON,
            color: '#00ff00',
            enabled: true,
            rules: []
        });
        expect(badge.label).toHaveLength(CUSTOM_BADGE_LABEL_MAX);
        expect(isReservedBadgeIcon(VRCX_TAG_BADGE_ICON)).toBe(false);
    });

    it('takes the icons custom badges may use', () => {
        expect(vrcxCustomTagIcon('Star')).toBe('Star');
        expect(vrcxCustomTagIcon('LabBurger')).toBe('LabBurger');
        expect(vrcxCustomTagIcon('CodeXml')).toBe(VRCX_TAG_BADGE_ICON);
        expect(vrcxCustomTagIcon('ShieldCheck')).toBe(VRCX_TAG_BADGE_ICON);
        expect(vrcxCustomTagIcon('not an icon')).toBe(VRCX_TAG_BADGE_ICON);
        expect(vrcxCustomTagIcon('')).toBe(VRCX_TAG_BADGE_ICON);
    });

    it('keeps several tags per user and drops empty ones', () => {
        useVrcxCustomTagStore.getState().setTags([
            { userId: 'usr_a', id: '', tag: 'One', colour: '', icon: '' },
            { userId: 'usr_a', id: 'b', tag: 'Two', colour: '', icon: '' },
            { userId: 'usr_b', id: '', tag: ' ', colour: '', icon: '' }
        ]);
        const { tagsByUserId } = useVrcxCustomTagStore.getState();
        expect(tagsByUserId.usr_a?.map((tag) => tag.tag)).toEqual([
            'One',
            'Two'
        ]);
        expect(tagsByUserId.usr_b).toBeUndefined();
    });
});
