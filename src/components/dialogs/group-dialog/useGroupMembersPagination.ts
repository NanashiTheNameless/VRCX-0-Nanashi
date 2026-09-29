import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupMemberRow } from '@/domain/entities/group';
import type { RemoteTabStatus } from '@/domain/shared/types';
import type { GroupMemberSort } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '@/shared/constants/pagination';

import { useGroupMemberPages } from './useGroupMemberPages';

export interface UseGroupMembersPaginationParams {
    groupId: string;
    endpoint: string;
    enabled: boolean;
    query: string;
    sort: GroupMemberSort;
    roleId: string;
    reloadToken: number;
}

export interface UseGroupMembersPaginationResult {
    rows: GroupMemberRow[];
    status: RemoteTabStatus;
    error: string;
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => Promise<void>;
    removeRow: (userId: string) => void;
}

export function useGroupMembersPagination({
    groupId,
    endpoint,
    enabled,
    query,
    sort,
    roleId,
    reloadToken
}: UseGroupMembersPaginationParams): UseGroupMembersPaginationResult {
    const { t } = useTranslation();
    const trimmedQuery = query.trim();
    const pages = useGroupMemberPages(
        (offset, force) =>
            trimmedQuery
                ? groupProfileRepository.getGroupMembersSearch({
                      groupId,
                      query: trimmedQuery,
                      n: VRCHAT_API_DEFAULT_PAGE_SIZE,
                      offset
                  })
                : groupProfileRepository.getGroupMembers({
                      groupId,
                      n: VRCHAT_API_DEFAULT_PAGE_SIZE,
                      offset,
                      sort,
                      roleId,
                      force
                  }),
        t('dialog.group.members.failed_to_load')
    );
    const { reset, loadFirstPage } = pages;

    useEffect(() => {
        if (!enabled || !groupId) {
            reset();
            return;
        }
        if (trimmedQuery && trimmedQuery.length < 3) {
            reset('ready');
            return;
        }
        reset();
        void loadFirstPage(true);
    }, [
        groupId,
        endpoint,
        enabled,
        trimmedQuery,
        sort,
        roleId,
        reloadToken,
        reset,
        loadFirstPage
    ]);

    return {
        rows: pages.rows,
        status: pages.status,
        error: pages.error,
        hasMore: pages.hasMore,
        loadingMore: pages.loadingMore,
        loadMore: pages.loadMore,
        removeRow: pages.removeRow
    };
}
