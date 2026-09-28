import { useCallback, useRef, useState } from 'react';

import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';

type PreferenceAction = () => void;
type PreferenceRollback = void | (() => void);
type AvatarProviderConfigDeps = {
    commit: (
        action: PreferenceAction,
        optimistic?: () => PreferenceRollback
    ) => Promise<boolean>;
};
type AvatarProviderConfig = Awaited<
    ReturnType<typeof avatarSearchProviderRepository.saveConfig>
>;

export type { AvatarProviderConfig };

export function useAvatarProviderConfig({ commit }: AvatarProviderConfigDeps) {
    const [avatarProviderConfig, setAvatarProviderConfig] =
        useState<AvatarProviderConfig>({
            enabled: true,
            providerList: [],
            selectedProvider: '',
            disabledProviders: [],
            activeProviders: []
        });
    const avatarProviderConfigRef = useRef(avatarProviderConfig);
    const avatarProviderSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const avatarProviderSaveSeqRef = useRef(0);

    const applyAvatarProviderConfig = useCallback(
        (nextConfig: AvatarProviderConfig) => {
            avatarProviderConfigRef.current = nextConfig;
            setAvatarProviderConfig(nextConfig);
        },
        []
    );

    async function saveAvatarProviderConfig(nextConfig: AvatarProviderConfig) {
        const saveSeq = avatarProviderSaveSeqRef.current + 1;
        avatarProviderSaveSeqRef.current = saveSeq;
        const saveTask = avatarProviderSaveQueueRef.current
            .catch(() => {})
            .then(() => avatarSearchProviderRepository.saveConfig(nextConfig));

        avatarProviderSaveQueueRef.current = saveTask.then(
            () => undefined,
            () => undefined
        );
        const saved = await saveTask;
        if (saveSeq === avatarProviderSaveSeqRef.current) {
            applyAvatarProviderConfig(saved);
        }
        return saved;
    }

    function updateAvatarProvider(index: number, value: string) {
        setAvatarProviderConfig((current) => ({
            ...current,
            providerList: current.providerList.map((provider, providerIndex) =>
                providerIndex === index ? value : provider
            )
        }));
        avatarProviderConfigRef.current = {
            ...avatarProviderConfigRef.current,
            providerList: avatarProviderConfigRef.current.providerList.map(
                (provider, providerIndex) =>
                    providerIndex === index ? value : provider
            )
        };
    }

    function saveAvatarProviderField(index: number, value: string) {
        const currentConfig = avatarProviderConfigRef.current;
        const providerList = currentConfig.providerList.map(
            (provider, providerIndex) =>
                providerIndex === index ? value : provider
        );
        const nextConfig: AvatarProviderConfig = {
            ...currentConfig,
            enabled:
                currentConfig.enabled &&
                providerList.some((provider) => provider.trim()),
            providerList
        };
        applyAvatarProviderConfig(nextConfig);
        commit(() =>
            saveAvatarProviderConfig({
                ...nextConfig
            })
        );
    }

    function addAvatarProvider() {
        const nextConfig: AvatarProviderConfig = {
            ...avatarProviderConfigRef.current,
            providerList: [...avatarProviderConfigRef.current.providerList, '']
        };
        applyAvatarProviderConfig(nextConfig);
    }

    function removeAvatarProvider(index: number) {
        const currentConfig = avatarProviderConfigRef.current;
        const nextProviderList = currentConfig.providerList.filter(
            (_, providerIndex) => providerIndex !== index
        );
        const nextConfig: AvatarProviderConfig = {
            ...currentConfig,
            enabled: currentConfig.enabled && nextProviderList.length > 0,
            providerList: nextProviderList
        };
        applyAvatarProviderConfig(nextConfig);
        commit(() => saveAvatarProviderConfig(nextConfig));
    }

    return {
        addAvatarProvider,
        applyAvatarProviderConfig,
        avatarProviderConfig,
        avatarProviderConfigRef,
        removeAvatarProvider,
        saveAvatarProviderConfig,
        saveAvatarProviderField,
        updateAvatarProvider
    };
}
