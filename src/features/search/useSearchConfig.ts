import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS } from '@/repositories/avatarSearchProviderRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import type { AvatarSearchProviderConfig } from '@/repositories/avatarSearchProviderRepository';
import { toast } from '@/services/toastService';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import {
    type LanguageOption,
    normalizeLanguageOptionsFromConfig
} from '@/shared/utils/userLanguage';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { emptyArray } from './searchResults';
import type { SearchWorldCategory } from './searchTypes';

function isWorldCategory(value: unknown): value is SearchWorldCategory {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'index' in value &&
        (typeof value.index === 'string' || typeof value.index === 'number') &&
        (!('name' in value) ||
            value.name === undefined ||
            typeof value.name === 'string') &&
        (!('sortHeading' in value) ||
            value.sortHeading === undefined ||
            typeof value.sortHeading === 'string') &&
        (!('sortOrder' in value) ||
            value.sortOrder === undefined ||
            typeof value.sortOrder === 'string') &&
        (!('sortOwnership' in value) ||
            value.sortOwnership === undefined ||
            typeof value.sortOwnership === 'string') &&
        (!('tag' in value) ||
            value.tag === undefined ||
            typeof value.tag === 'string')
    );
}

export function useSearchConfig() {
    const { t } = useTranslation();
    const vrchatConfig = useVrchatConfigStore((state) => state.snapshot);
    const worldCategories = useMemo(
        () =>
            emptyArray(vrchatConfig?.dynamicWorldRows).filter(isWorldCategory),
        [vrchatConfig]
    );
    const languageOptionsMap = useMemo(
        () =>
            new Map(
                normalizeLanguageOptionsFromConfig(vrchatConfig).map(
                    (option): [string, LanguageOption] => [option.key, option]
                )
            ),
        [vrchatConfig]
    );
    const [avatarProviderEnabled, setAvatarProviderEnabled] = useState(false);
    const [avatarProviderList, setAvatarProviderList] = useState<string[]>([]);
    const [disabledAvatarProviders, setDisabledAvatarProviders] = useState<
        string[]
    >([]);
    const activeAvatarProviders = useMemo(
        () =>
            avatarProviderList.filter(
                (provider) =>
                    provider && !disabledAvatarProviders.includes(provider)
            ),
        [avatarProviderList, disabledAvatarProviders]
    );
    const [isAvatarProviderDialogOpen, setIsAvatarProviderDialogOpen] =
        useState(false);

    function applyAvatarProviderConfig(config: AvatarSearchProviderConfig) {
        setAvatarProviderEnabled(config.enabled);
        setAvatarProviderList(config.providerList);
        setDisabledAvatarProviders(config.disabledProviders);
    }

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(
            AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
            () => {
                avatarSearchProviderRepository
                    .getConfig()
                    .then((config) => {
                        if (active) {
                            applyAvatarProviderConfig(config);
                        }
                    })
                    .catch((error: unknown) => {
                        console.warn(
                            'Failed to refresh avatar providers:',
                            error
                        );
                    });
            }
        );

        avatarSearchProviderRepository
            .getConfig()
            .then((config) => {
                if (!active) {
                    return;
                }

                applyAvatarProviderConfig(config);
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.search.toast.failed_to_load_avatar_providers'
                              )
                });
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [t]);

    function enableAvatarSearch() {
        avatarSearchProviderRepository
            .saveConfig({ enabled: true, providerList: avatarProviderList })
            .then(applyAvatarProviderConfig)
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.search.toast.failed_to_save_avatar_provider'
                              )
                });
            });
    }

    function handleAvatarProviderToggle(provider: string, enabled: boolean) {
        setDisabledAvatarProviders((current) =>
            enabled
                ? current.filter((entry) => entry !== provider)
                : [...new Set([...current, provider])]
        );
        avatarSearchProviderRepository
            .setProviderEnabled(provider, enabled)
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.search.toast.failed_to_save_avatar_provider'
                              )
                });
            });
    }

    return {
        activeAvatarProviders,
        applyAvatarProviderConfig,
        avatarProviderEnabled,
        avatarProviderList,
        disabledAvatarProviders,
        enableAvatarSearch,
        handleAvatarProviderToggle,
        isAvatarProviderDialogOpen,
        languageOptionsMap,
        setIsAvatarProviderDialogOpen,
        worldCategories
    };
}
