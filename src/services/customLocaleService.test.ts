import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));

import { fallbackLocaleMessages } from '@/localization/index';

import {
    LOCALE_META_KEY,
    localeMetaFor,
    readLocaleMeta,
    aiBatchPrompt,
    countMissingLocaleStrings,
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

    it('counts English strings a custom table lacks', () => {
        const sources = flattenLocaleStrings(fallbackLocaleMessages);
        expect(countMissingLocaleStrings({})).toBe(sources.length);

        const table: Record<string, unknown> = {};
        for (const source of sources.slice(1)) {
            writePath(table, source.path, 'x');
        }
        expect(countMissingLocaleStrings(table)).toBe(1);

        writePath(table, sources[0].path, 'x');
        expect(countMissingLocaleStrings(table)).toBe(0);
    });

    it('appends language instructions to the AI prompt only when given', () => {
        const base = aiBatchPrompt();
        expect(aiBatchPrompt('   ')).toBe(base);
        const withExtra = aiBatchPrompt('  Pirate speak.  ');
        expect(withExtra.startsWith(base)).toBe(true);
        expect(withExtra).toContain('Pirate speak.');
        expect(withExtra).not.toContain('  Pirate');
    });

    it('reads language file metadata and ignores malformed fields', () => {
        expect(readLocaleMeta({})).toEqual({
            code: undefined,
            provider: undefined,
            endpointId: undefined,
            model: undefined,
            aiInstructions: undefined
        });
        expect(
            readLocaleMeta({
                [LOCALE_META_KEY]: {
                    code: 'tlh_aa',
                    provider: 'ai',
                    endpointId: 'ep1',
                    model: 'm',
                    aiInstructions: 'Warrior tone.',
                    key: 'secret'
                }
            })
        ).toEqual({
            code: 'tlh_aa',
            provider: 'ai',
            endpointId: 'ep1',
            model: 'm',
            aiInstructions: 'Warrior tone.'
        });
        expect(
            readLocaleMeta({
                [LOCALE_META_KEY]: { provider: 'bogus', model: 3 }
            }).provider
        ).toBeUndefined();
    });

    it('marks AI-only metadata N/A for DeepL and Google files', () => {
        const meta = localeMetaFor('de', { kind: 'deepl', key: 'secret' });
        expect(meta).toEqual({
            code: 'de',
            provider: 'deepl',
            endpointId: 'N/A',
            model: 'N/A',
            aiInstructions: 'N/A'
        });
        expect(JSON.stringify(meta)).not.toContain('secret');
        expect(readLocaleMeta({ [LOCALE_META_KEY]: meta })).toEqual({
            code: 'de',
            provider: 'deepl',
            endpointId: undefined,
            model: undefined,
            aiInstructions: undefined
        });
    });

    it('writes every AI field, with empty instructions when none are given', () => {
        expect(
            localeMetaFor('tlh_aa', {
                kind: 'ai',
                endpointId: 'ep1',
                model: 'm'
            })
        ).toEqual({
            code: 'tlh_aa',
            provider: 'ai',
            endpointId: 'ep1',
            model: 'm',
            aiInstructions: ''
        });
    });

    it('does not treat metadata as translatable strings', () => {
        expect(
            flattenLocaleStrings({
                [LOCALE_META_KEY]: { aiInstructions: 'x' },
                a: 'Hello'
            })
        ).toEqual([{ path: 'a', text: 'Hello' }]);
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
