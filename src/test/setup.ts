import { vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    const t = (key: string) => key;
    const i18n = { language: 'en', changeLanguage: () => Promise.resolve() };
    return {
        ...actual,
        useTranslation: () => ({ t, i18n, ready: true })
    };
});

if (typeof window === 'undefined') {
    const values = new Map<string, string>();
    const memoryStorage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, String(value));
        }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: memoryStorage
    });
}
