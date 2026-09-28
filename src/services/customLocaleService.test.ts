import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));

import {
    flattenLocaleStrings,
    protectText,
    readPath,
    restoreText,
    writePath
} from './customLocaleService';

describe('custom locale helpers', () => {
    it('flattens nested string tables and skips the language name', () => {
        expect(
            flattenLocaleStrings({
                language: 'English (en)',
                a: { b: 'Hello', c: '' },
                d: 'World'
            })
        ).toEqual([
            { path: 'a.b', text: 'Hello' },
            { path: 'd', text: 'World' }
        ]);
    });

    it('reads and writes dotted paths', () => {
        const table: Record<string, unknown> = {};
        writePath(table, 'view.settings.title', 'Einstellungen');
        expect(readPath(table, 'view.settings.title')).toBe('Einstellungen');
        expect(readPath(table, 'view.missing')).toBeUndefined();
    });

    it('protects placeholders, tags and urls and restores them', () => {
        const { masked, tokens } = protectText(
            'Hi {name}, see <b>docs</b> at https://example.com now'
        );
        expect(masked).toBe('Hi [[0]], see [[1]]docs[[2]] at [[3]] now');
        expect(
            restoreText(
                'Hallo [[0]], siehe [[1]]Doku[[2]] unter [[3]] jetzt',
                tokens
            )
        ).toBe(
            'Hallo {name}, siehe <b>Doku</b> unter https://example.com jetzt'
        );
    });

    it('rejects translations that drop or duplicate a token', () => {
        const { tokens } = protectText('{count} worlds');
        expect(restoreText('Welten', tokens)).toBeNull();
        expect(restoreText('[[0]] [[0]] Welten', tokens)).toBeNull();
    });
});
