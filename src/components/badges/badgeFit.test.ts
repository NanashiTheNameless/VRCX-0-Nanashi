import { describe, expect, it } from 'vitest';

import { chooseBadgeLevel } from './badgeFit';

const levels = [
    { level: 'full' as const, width: 120 },
    { level: 'icons' as const, width: 60 },
    { level: 'folder' as const, width: 18 }
];

describe('chooseBadgeLevel', () => {
    it('keeps full badges when the name and badges fit', () => {
        expect(
            chooseBadgeLevel({
                available: 300,
                others: 150,
                builtin: 0,
                gap: 4,
                innerGap: 4,
                levels
            })
        ).toBe('full');
    });

    it('steps down to icons, then the folder, as room runs out', () => {
        const base = { builtin: 0, gap: 4, innerGap: 4, levels };
        expect(chooseBadgeLevel({ ...base, available: 220, others: 150 })).toBe(
            'icons'
        );
        expect(chooseBadgeLevel({ ...base, available: 180, others: 150 })).toBe(
            'folder'
        );
    });

    it('counts the built-in badges, which always stay', () => {
        expect(
            chooseBadgeLevel({
                available: 230,
                others: 150,
                builtin: 20,
                gap: 4,
                innerGap: 4,
                levels
            })
        ).toBe('folder');
    });

    it('falls back to the folder when nothing fits', () => {
        expect(
            chooseBadgeLevel({
                available: 100,
                others: 150,
                builtin: 0,
                gap: 4,
                innerGap: 4,
                levels
            })
        ).toBe('folder');
    });
});
