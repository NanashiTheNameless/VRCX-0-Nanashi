import { useMemo } from 'react';

import {
    fallbackLanguageOptions,
    normalizeLanguageOptionsFromConfig
} from '@/shared/utils/userLanguage';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

export function useSpokenLanguageSelection(selectedKeys: readonly string[]) {
    const vrchatConfig = useVrchatConfigStore((state) => state.snapshot);
    const languageOptions = useMemo(() => {
        const options = normalizeLanguageOptionsFromConfig(vrchatConfig);
        return options.length ? options : fallbackLanguageOptions();
    }, [vrchatConfig]);
    const languageOptionsStatus = vrchatConfig ? 'ready' : 'error';
    const languageOptionsMap = useMemo(
        () => new Map(languageOptions.map((option) => [option.key, option])),
        [languageOptions]
    );
    const languageRows = useMemo(
        () =>
            selectedKeys.map((key) => ({
                key,
                value: languageOptionsMap.get(key)?.value || key.toUpperCase()
            })),
        [languageOptionsMap, selectedKeys]
    );
    const availableLanguageOptions = useMemo(() => {
        const selectedKeySet = new Set(selectedKeys);
        return languageOptions.filter(
            (option) => !selectedKeySet.has(option.key)
        );
    }, [languageOptions, selectedKeys]);

    return {
        languageOptionsMap,
        languageRows,
        availableLanguageOptions,
        languageOptionsStatus
    };
}
