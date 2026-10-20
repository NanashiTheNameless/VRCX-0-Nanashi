import { useCallback, useEffect, useRef, useState } from 'react';

import type { FavoriteKind } from '@/domain/favorites/types';
import { FAVORITES_LAYOUT_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

import type {
    FavoriteGroupView,
    FavoriteSearchMode,
    FavoriteSource
} from './favoritesTypes';

type FavoriteGroupRef = {
    key: string;
    source: FavoriteSource;
};

function parseFavoriteGroupRef(value: unknown): FavoriteGroupRef | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const { key, source } = value as Record<string, unknown>;
    if (
        typeof key === 'string' &&
        key &&
        (source === 'remote' || source === 'local' || source === 'history')
    ) {
        return { key, source };
    }
    return null;
}

export function useFavoritesFilters({ kind }: { kind: FavoriteKind }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<FavoriteSearchMode>('name');
    const [selectedSource, setSelectedSourceState] =
        useState<FavoriteSource>('remote');
    const [selectedGroupKey, setSelectedGroupKeyState] = useState('');
    const [restoreTarget, setRestoreTarget] = useState<FavoriteGroupRef | null>(
        null
    );
    const restorePendingRef = useRef(true);

    useEffect(() => {
        setSearchQuery('');
        setSearchMode('name');
        setSelectedSourceState('remote');
        setSelectedGroupKeyState('');
        setRestoreTarget(null);
        restorePendingRef.current = true;

        let active = true;
        configRepository
            .getObject(FAVORITES_LAYOUT_CONFIG_KEYS.selectedGroup[kind])
            .then((stored) => {
                if (!active || !restorePendingRef.current) {
                    return;
                }
                const target = parseFavoriteGroupRef(stored);
                if (target) {
                    setRestoreTarget(target);
                } else {
                    restorePendingRef.current = false;
                }
            })
            .catch(() => {
                if (active) {
                    restorePendingRef.current = false;
                }
            });
        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        if (restorePendingRef.current || !selectedGroupKey) {
            return;
        }
        void configRepository.setObject(
            FAVORITES_LAYOUT_CONFIG_KEYS.selectedGroup[kind],
            { key: selectedGroupKey, source: selectedSource }
        );
    }, [kind, selectedGroupKey, selectedSource]);

    const setSelectedSource = useCallback((value: FavoriteSource) => {
        restorePendingRef.current = false;
        setRestoreTarget(null);
        setSelectedSourceState(value);
    }, []);

    const setSelectedGroupKey = useCallback((value: string) => {
        restorePendingRef.current = false;
        setRestoreTarget(null);
        setSelectedGroupKeyState(value);
    }, []);

    const autoSelectGroup = useCallback((group: FavoriteGroupRef | null) => {
        if (!group) {
            setSelectedGroupKeyState('');
            return;
        }
        setSelectedSourceState(group.source);
        setSelectedGroupKeyState(group.key);
    }, []);

    const restoreGroup = useCallback(
        (group: FavoriteGroupRef) => {
            restorePendingRef.current = false;
            setRestoreTarget(null);
            autoSelectGroup(group);
        },
        [autoSelectGroup]
    );

    return {
        autoSelectGroup,
        restoreGroup,
        restoreTarget,
        searchMode,
        searchQuery,
        selectedGroupKey,
        selectedSource,
        setSearchMode,
        setSearchQuery,
        setSelectedGroupKey,
        setSelectedSource
    };
}

export function useFavoritesSelectedGroupSync({
    autoSelectGroup,
    avatarHistoryGroups,
    localGroups,
    remoteGroups,
    restoreGroup,
    restoreTarget,
    selectedGroupKey,
    selectedSource
}: {
    autoSelectGroup(group: FavoriteGroupRef | null): void;
    avatarHistoryGroups: FavoriteGroupView[];
    localGroups: FavoriteGroupView[];
    remoteGroups: FavoriteGroupView[];
    restoreGroup(group: FavoriteGroupRef): void;
    restoreTarget: FavoriteGroupRef | null;
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
}) {
    useEffect(() => {
        const groupsBySource = {
            history: avatarHistoryGroups,
            local: localGroups,
            remote: remoteGroups
        };
        if (
            restoreTarget &&
            groupsBySource[restoreTarget.source].some(
                (group) => group.key === restoreTarget.key
            )
        ) {
            restoreGroup(restoreTarget);
            return;
        }
        if (
            groupsBySource[selectedSource].some(
                (group) => group.key === selectedGroupKey
            )
        ) {
            return;
        }

        const nextGroup =
            remoteGroups.find((group) => Number(group.count) > 0) ||
            localGroups.find((group) => Number(group.count) > 0) ||
            avatarHistoryGroups.find((group) => Number(group.count) > 0) ||
            remoteGroups[0] ||
            localGroups[0] ||
            avatarHistoryGroups[0] ||
            null;
        autoSelectGroup(nextGroup);
    }, [
        autoSelectGroup,
        avatarHistoryGroups,
        localGroups,
        remoteGroups,
        restoreGroup,
        restoreTarget,
        selectedGroupKey,
        selectedSource
    ]);
}
