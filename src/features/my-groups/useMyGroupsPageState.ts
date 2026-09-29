import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    groupIdForRow,
    sortUserGroupRows
} from '@/components/dialogs/user-dialog/userDialogGroupRows';
import type { UserDialogGroupSort } from '@/components/dialogs/user-dialog/userDialogListOptions';
import type { GroupProfileRecord } from '@/domain/entities/group';
import type { LoadStatus } from '@/domain/shared/types';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { toast } from '@/services/toastService';
import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { moveGroupInOrder, normalizeGroupOrder } from './myGroupsOrder';
import {
    useMyGroupsSectionPreferences,
    type MyGroupsSectionKey
} from './useMyGroupsSectionPreferences';

export type MyGroupRow = GroupProfileRecord;

export interface MyGroupsSection {
    key: MyGroupsSectionKey;
    groups: MyGroupRow[];
    open: boolean;
}

export function isOwnGroup(
    group: MyGroupRow,
    currentUserId: string | null | undefined
) {
    return Boolean(group.ownerId) && group.ownerId === currentUserId;
}

function matchesSearch(group: MyGroupRow, query: string) {
    if (!query) {
        return true;
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    return (
        (group.name || '').toLowerCase().includes(needle) ||
        (group.shortCode || '').toLowerCase().includes(needle)
    );
}

export function useMyGroupsPageState() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const registryPrefs = useRuntimeStore(
        (state) => state.hostCapabilities.registryPrefs
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );

    const [groups, setGroups] = useState<MyGroupRow[]>([]);
    const [status, setStatus] = useState<LoadStatus>('idle');
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSortValue] = useState<UserDialogGroupSort>(() =>
        registryPrefs.available ? 'inGame' : 'alphabetical'
    );
    const [editMode, setEditMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [inGameOrder, setInGameOrder] = useState<string[]>([]);
    const [orderSaving, setOrderSaving] = useState(false);
    const { openSections, toggleSection } = useMyGroupsSectionPreferences();
    const loadSequenceRef = useRef(0);
    const orderRefreshSequenceRef = useRef(0);
    const sortManuallyChangedRef = useRef(false);

    const orderCapable = registryPrefs.available;

    useEffect(() => {
        if (orderCapable && !sortManuallyChangedRef.current) {
            setSortValue('inGame');
        }
    }, [orderCapable]);

    const load = useCallback(
        async (force = false) => {
            if (!currentUserId) {
                setGroups([]);
                setStatus('idle');
                return;
            }
            const sequence = loadSequenceRef.current + 1;
            loadSequenceRef.current = sequence;
            setStatus('running');
            setError('');
            try {
                const rows = await groupProfileRepository.getUserGroups({
                    userId: currentUserId,
                    force
                });
                if (loadSequenceRef.current !== sequence) {
                    return;
                }
                setGroups(rows);
                setStatus('ready');
            } catch (loadError) {
                if (loadSequenceRef.current !== sequence) {
                    return;
                }
                setError(
                    userFacingErrorMessage(
                        loadError,
                        t('common.error.failed_to_load_data')
                    )
                );
                setStatus('error');
            }
        },
        [currentUserId, t]
    );

    const groupsRevision = useMyGroupsRevisionStore((state) => state.revision);

    useEffect(() => {
        void load(groupsRevision > 0);
    }, [load, groupsRevision]);

    useEffect(() => {
        setEditMode(false);
        setSelectedIds(new Set());
    }, [currentUserId]);

    const groupIds = useMemo(
        () => groups.map((group) => groupIdForRow(group)).filter(Boolean),
        [groups]
    );

    const refreshInGameOrder = useCallback(async () => {
        const sequence = orderRefreshSequenceRef.current + 1;
        orderRefreshSequenceRef.current = sequence;
        if (!orderCapable) {
            setInGameOrder([]);
            return;
        }
        try {
            const order = await commands.appVrchatGroupOrderGet();
            if (orderRefreshSequenceRef.current !== sequence) {
                return;
            }
            setInGameOrder(order);
        } catch {
            if (orderRefreshSequenceRef.current !== sequence) {
                return;
            }
            setInGameOrder([]);
        }
    }, [orderCapable]);

    useEffect(() => {
        void refreshInGameOrder();
    }, [refreshInGameOrder]);

    const normalizedOrder = useMemo(
        () => normalizeGroupOrder(inGameOrder, groupIds),
        [groupIds, inGameOrder]
    );

    const orderEditable = editMode && orderCapable;

    const visibleGroups = useMemo(() => {
        const filtered = groups.filter((group) => matchesSearch(group, search));
        return sortUserGroupRows(
            filtered,
            sort,
            normalizedOrder
        ) as MyGroupRow[];
    }, [groups, normalizedOrder, search, sort]);

    const sections = useMemo(() => {
        const ownGroups: MyGroupRow[] = [];
        const joinedGroups: MyGroupRow[] = [];
        for (const group of visibleGroups) {
            if (isOwnGroup(group, currentUserId)) {
                ownGroups.push(group);
            } else {
                joinedGroups.push(group);
            }
        }
        const nextSections: MyGroupsSection[] = [
            { key: 'own', groups: ownGroups, open: openSections.own },
            { key: 'joined', groups: joinedGroups, open: openSections.joined }
        ];
        return nextSections.filter((section) => section.groups.length > 0);
    }, [currentUserId, openSections, visibleGroups]);

    const selectableIds = useMemo(
        () =>
            visibleGroups.map((group) => groupIdForRow(group)).filter(Boolean),
        [visibleGroups]
    );

    const allSelected =
        selectableIds.length > 0 &&
        selectableIds.every((groupId) => selectedIds.has(groupId));

    function toggleSelected(groupId: string) {
        if (!groupId) {
            return;
        }
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }

    function toggleSelectAll() {
        setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
    }

    function clearSelection() {
        setSelectedIds(new Set());
    }

    function setSort(nextSort: UserDialogGroupSort) {
        sortManuallyChangedRef.current = true;
        setSortValue(nextSort);
    }

    function enterEditMode() {
        if (orderCapable) {
            setSearch('');
            setSortValue('inGame');
        }
        setEditMode(true);
        void refreshInGameOrder();
    }

    function exitEditMode() {
        setEditMode(false);
        clearSelection();
    }

    async function moveGroup(groupId: string, overGroupId: string) {
        if (!orderEditable || orderSaving) {
            return;
        }
        const toIndex = normalizedOrder.indexOf(overGroupId);
        const nextOrder = moveGroupInOrder(normalizedOrder, groupId, toIndex);
        if (!nextOrder) {
            return;
        }
        const previousOrder = inGameOrder;
        orderRefreshSequenceRef.current += 1;
        setInGameOrder(nextOrder);
        setOrderSaving(true);
        try {
            await commands.appVrchatGroupOrderSet(nextOrder);
        } catch (saveError) {
            setInGameOrder(previousOrder);
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    saveError,
                    t('view.my_groups.order_save_failed')
                )
            });
        } finally {
            setOrderSaving(false);
        }
    }

    return {
        allSelected,
        clearSelection,
        currentUserId,
        editMode,
        enterEditMode,
        error,
        exitEditMode,
        groups,
        isGameRunning,
        load,
        moveGroup,
        normalizedOrder,
        orderCapable,
        orderEditable,
        orderSaving,
        registryPrefs,
        search,
        sections,
        selectedIds,
        setSearch,
        setSort,
        sort,
        status,
        toggleSelectAll,
        toggleSection,
        toggleSelected,
        visibleGroups
    };
}
