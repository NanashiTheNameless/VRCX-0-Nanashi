import { useSyncExternalStore } from 'react';

import { getLanguageCodesSnapshot, subscribeLanguageCodes } from './locales';

/** Registered UI language codes, re-rendering when custom files come and go. */
export function useLanguageCodes(): readonly string[] {
    return useSyncExternalStore(
        subscribeLanguageCodes,
        getLanguageCodesSnapshot
    );
}
