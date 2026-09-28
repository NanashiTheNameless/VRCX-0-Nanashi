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

function languageCodeKey(code: string) {
    return code.trim().replace(/_/g, '-').toLowerCase();
}

/**
 * Resolves a stored or system language to a registered code. Codes are not
 * limited to BCP-47: custom locales may use forms like `en_pt`, `en_ud`,
 * `enp`, `qes`, `tlh_aa` or `lol_us`, so `_` and `-` are interchangeable and
 * matching ignores case.
 */
export function normalizeLanguageCode(language: string | null | undefined) {
    const candidate = language?.trim() ?? '';
    if (languageCodes.includes(candidate)) {
        return candidate;
    }
    const key = languageCodeKey(candidate);
    return (
        languageCodes.find((code) => languageCodeKey(code) === key) ??
        DEFAULT_LANGUAGE_CODE
    );
}
