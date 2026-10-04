import { describe, expect, it } from 'vitest';

import {
    convertFileUrlToImageUrl,
    getNameColour,
    userImage
} from './entityMedia';

describe('entityMedia', () => {
    it('converts VRChat file URLs to image URLs with endpoint normalization', () => {
        expect(
            convertFileUrlToImageUrl(
                'https://api.vrchat.cloud/api/1/file/file_1234abcd-0000-1111-2222-abcdefabcdef/7/file',
                256,
                'https://api.vrchat.cloud/api/1'
            )
        ).toBe(
            'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/7/256'
        );
        expect(
            convertFileUrlToImageUrl(
                'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/7/256',
                1024,
                'https://api.vrchat.cloud/api/1'
            )
        ).toBe(
            'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/7/1024'
        );
        expect(
            convertFileUrlToImageUrl('https://images.example/avatar.png')
        ).toBe('https://images.example/avatar.png');
        expect(convertFileUrlToImageUrl(null)).toBe('');
    });

    it('keeps deterministic name colors for light and dark mode', () => {
        expect(
            getNameColour(
                'usr_00000000-0000-0000-0000-000000000001',
                false,
                'classic'
            )
        ).toBe('#4400b3');
        expect(
            getNameColour(
                'usr_00000000-0000-0000-0000-000000000001',
                true,
                'classic'
            )
        ).toBe('#a066ff');
        expect(getNameColour('', false, 'classic')).toBe('#b300a1');
    });

    it('keeps warm and cool name colors on their side of the hue wheel', () => {
        const userIds = Array.from(
            { length: 64 },
            (_, index) =>
                `usr_00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
        );
        const channels = (hex: string) =>
            [1, 3, 5].map((offset) =>
                Number.parseInt(hex.slice(offset, offset + 2), 16)
            );

        for (const isDarkMode of [false, true]) {
            for (const userId of userIds) {
                const warm = getNameColour(userId, isDarkMode, 'warm');
                const cool = getNameColour(userId, isDarkMode, 'cool');
                const pastel = getNameColour(userId, isDarkMode, 'pastel');
                for (const colour of [warm, cool, pastel]) {
                    expect(colour).toMatch(/^#[0-9a-f]{6}$/);
                }
                const [warmRed, , warmBlue] = channels(warm);
                const [coolRed, , coolBlue] = channels(cool);
                expect(warmRed).toBeGreaterThan(warmBlue);
                expect(coolBlue).toBeGreaterThan(coolRed);
            }
        }
        expect(getNameColour(userIds[0], true, 'pastel')).not.toBe(
            getNameColour(userIds[0], false, 'pastel')
        );
    });

    it('resolves user images from iconUrl at the requested resolution', () => {
        const iconUrl =
            'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/256';
        expect(userImage({ iconUrl }, 64)).toBe(
            'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/64'
        );
        expect(userImage({ iconUrl })).toBe(
            'https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/128'
        );
        expect(userImage({}, 64)).toBe('');
        expect(userImage(null)).toBe('');
    });
});
