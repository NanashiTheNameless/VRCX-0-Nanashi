import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getBool: vi.fn(),
    getString: vi.fn(),
    appTranslationTranslate: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appTranslationTranslate: mocks.appTranslationTranslate
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: mocks.getBool,
        getString: mocks.getString
    }
}));

import {
    getTranslationConfig,
    translateTextDetailed
} from './translationService';

describe('translationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('falls back to English and Google for empty or unknown stored config', async () => {
        mocks.getBool.mockImplementation((_key: string, fallback: boolean) =>
            Promise.resolve(fallback)
        );
        mocks.getString.mockImplementation((key: string) =>
            Promise.resolve(key === 'translationAPIType' ? 'bing' : '')
        );

        await expect(getTranslationConfig()).resolves.toEqual({
            enabled: false,
            bioLanguage: 'en',
            type: 'google'
        });
    });

    it('delegates translation to the runtime command', async () => {
        mocks.appTranslationTranslate.mockResolvedValue({
            text: 'こんにちは',
            detectedSourceLanguage: 'en',
            provider: 'deepl'
        });

        const result = await translateTextDetailed('Hello', 'ja');

        expect(mocks.appTranslationTranslate).toHaveBeenCalledWith({
            text: 'Hello',
            targetLanguage: 'ja',
            overrides: null
        });
        expect(result).toEqual({
            text: 'こんにちは',
            detectedSourceLang: 'en'
        });
    });

    it('passes a null target language when none is provided', async () => {
        mocks.appTranslationTranslate.mockResolvedValue({
            text: 'hola',
            detectedSourceLanguage: null,
            provider: 'google'
        });

        await expect(translateTextDetailed('Hello')).resolves.toMatchObject({
            text: 'hola'
        });
        expect(mocks.appTranslationTranslate).toHaveBeenCalledWith({
            text: 'Hello',
            targetLanguage: null,
            overrides: null
        });
    });
});
