import { useEffect } from 'react';
import { create } from 'zustand';

import configRepository from '@/repositories/configRepository';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings';
import type {
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from './mutualFriendsTypes';

interface LayoutSettingConfig {
    load: (fallback: number) => Promise<number>;
    persist: (value: number) => void;
    decimals?: number;
}

const layoutSettingConfig: Record<
    MutualFriendsLayoutSettingKey,
    LayoutSettingConfig
> = {
    layoutIterations: {
        load: (fallback) =>
            configRepository.getInt('MutualGraphLayoutIterations', fallback),
        persist: (value) =>
            configRepository.setInt('MutualGraphLayoutIterations', value)
    },
    layoutSpacing: {
        load: (fallback) =>
            configRepository.getInt('MutualGraphLayoutSpacing', fallback),
        persist: (value) =>
            configRepository.setInt('MutualGraphLayoutSpacing', value)
    },
    edgeCurvature: {
        load: (fallback) =>
            configRepository.getFloat('MutualGraphEdgeCurvature', fallback),
        persist: (value) =>
            configRepository.setFloat('MutualGraphEdgeCurvature', value),
        decimals: 2
    },
    communitySeparation: {
        load: (fallback) =>
            configRepository.getFloat(
                'MutualGraphCommunitySeparation',
                fallback
            ),
        persist: (value) =>
            configRepository.setFloat('MutualGraphCommunitySeparation', value),
        decimals: 1
    }
};

const layoutSettingKeys = [
    'layoutIterations',
    'layoutSpacing',
    'edgeCurvature',
    'communitySeparation'
] satisfies MutualFriendsLayoutSettingKey[];

function normalizeLayoutSetting(
    key: MutualFriendsLayoutSettingKey,
    value: number
) {
    const limits = MUTUAL_GRAPH_LAYOUT_LIMITS[key];
    const nextValue = clampMutualGraphNumber(
        value,
        limits.min,
        limits.max,
        MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]
    );
    const decimals = layoutSettingConfig[key].decimals;
    return Number.isInteger(decimals)
        ? Number(nextValue.toFixed(decimals))
        : nextValue;
}

const useLayoutSettingsStore = create<MutualFriendsLayoutSettings>(() => ({
    ...MUTUAL_GRAPH_LAYOUT_DEFAULTS
}));

let hydration: Promise<void> | null = null;

function hydrateLayoutSettings() {
    hydration ??= Promise.all(
        layoutSettingKeys.map(async (key) => {
            const value = await layoutSettingConfig[key].load(
                MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]
            );
            return [key, normalizeLayoutSetting(key, value)] as const;
        })
    )
        .then((entries) => {
            useLayoutSettingsStore.setState(Object.fromEntries(entries));
        })
        .catch(() => {
            hydration = null;
        });
    return hydration;
}

function setLayoutSetting(key: MutualFriendsLayoutSettingKey, value: number) {
    const nextValue = normalizeLayoutSetting(key, value);
    useLayoutSettingsStore.setState({ [key]: nextValue });
    layoutSettingConfig[key].persist(nextValue);
}

function resetLayoutSettings() {
    useLayoutSettingsStore.setState({ ...MUTUAL_GRAPH_LAYOUT_DEFAULTS });
    for (const key of layoutSettingKeys) {
        layoutSettingConfig[key].persist(MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]);
    }
}

export function useMutualFriendsLayoutSettings() {
    const layoutSettings = useLayoutSettingsStore();

    useEffect(() => {
        void hydrateLayoutSettings();
    }, []);

    return {
        layoutSettings,
        resetLayoutSettings,
        setLayoutSetting
    };
}
