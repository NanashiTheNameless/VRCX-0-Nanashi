// Separate file, to be importable in `vite.config.mts`.
import builtInLanguageCodes from './languageCodes.json';

const DEFAULT_LANGUAGE_CODE = 'en';

// Fork: English is built in; user language files (Settings > Interface >
// Languages) are registered at runtime, so this list is mutable.
const languageCodes: string[] = [...builtInLanguageCodes];
let languageCodesSnapshot: readonly string[] = [...languageCodes];
const languageCodeListeners = new Set<() => void>();

export { languageCodes };

function notifyLanguageCodesChanged() {
    languageCodesSnapshot = [...languageCodes];
    for (const listener of languageCodeListeners) {
        listener();
    }
}

/** Subscribe to registered-language changes (for `useSyncExternalStore`). */
export function subscribeLanguageCodes(listener: () => void) {
    languageCodeListeners.add(listener);
    return () => {
        languageCodeListeners.delete(listener);
    };
}

/** Stable snapshot of the registered codes; replaced on every change. */
export function getLanguageCodesSnapshot(): readonly string[] {
    return languageCodesSnapshot;
}

export function registerLanguageCode(code: string) {
    if (!languageCodes.includes(code)) {
        languageCodes.push(code);
        notifyLanguageCodesChanged();
    }
}

export function unregisterLanguageCode(code: string) {
    const index = languageCodes.indexOf(code);
    if (index >= 0 && !builtInLanguageCodes.includes(code)) {
        languageCodes.splice(index, 1);
        notifyLanguageCodesChanged();
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
