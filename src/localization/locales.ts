// Separate file, to be importable in `vite.config.mts`.
import builtInLanguageCodes from './languageCodes.json';

const DEFAULT_LANGUAGE_CODE = 'en';

// Fork: English is built in; user language files (Settings > Interface >
// Languages) are registered at runtime, so this list is mutable.
const languageCodes: string[] = [...builtInLanguageCodes];

export { languageCodes };

export function registerLanguageCode(code: string) {
    if (!languageCodes.includes(code)) {
        languageCodes.push(code);
    }
}

export function unregisterLanguageCode(code: string) {
    const index = languageCodes.indexOf(code);
    if (index >= 0 && !builtInLanguageCodes.includes(code)) {
        languageCodes.splice(index, 1);
    }
}

export function normalizeLanguageCode(language: string | null | undefined) {
    const candidate = language?.trim().replace(/_/g, '-') ?? '';
    if (languageCodes.includes(candidate)) {
        return candidate;
    }
    return DEFAULT_LANGUAGE_CODE;
}
