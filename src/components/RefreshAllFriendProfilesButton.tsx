import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    type FriendProfileLoadKind,
    friendProfileRefreshScopeKey,
    startFriendProfileLoad,
    useFriendProfileRefreshStore
} from '@/services/friendProfileLoadService';
import { toast } from '@/services/toastService';
import { SECOND_MS } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuItem } from '@/ui/shadcn/dropdown-menu';

/** Whether a friend profile job of this kind can start now, and the seconds left on its cooldown. */
export function useFriendProfileLoadAvailability(kind: FriendProfileLoadKind) {
    const userId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const loading = useRuntimeStore((state) =>
        ['running', 'cancelling'].includes(state.friendProfileLoad.status)
    );
    const scope = friendProfileRefreshScopeKey(userId, endpoint, kind);
    const remaining = useFriendProfileRefreshStore((state) =>
        Math.max(
            0,
            Math.ceil(((state.cooldowns[scope] ?? 0) - state.now) / SECOND_MS)
        )
    );
    const pending = useFriendProfileRefreshStore((state) => state.pending);
    return {
        disabled: !userId || loading || pending || remaining > 0,
        loading,
        remaining
    };
}

function useRefreshAllFriendProfiles(onBeforeRefresh?: () => void) {
    const { t } = useTranslation();
    const { disabled, remaining } = useFriendProfileLoadAvailability('refresh');

    return {
        disabled,
        label:
            remaining > 0
                ? t('view.friend_list.refresh_all_cooldown_label', {
                      count: remaining
                  })
                : t('view.friend_list.refresh_all'),
        description:
            remaining > 0
                ? t('view.friend_list.refresh_all_cooldown', {
                      count: remaining
                  })
                : t('view.friend_list.refresh_all_description'),
        start: () => {
            onBeforeRefresh?.();
            startFriendProfileLoad(true).catch(() => {
                toast.add({
                    type: 'error',
                    title: t('view.friend_list.refresh_all_failed')
                });
            });
        }
    };
}

export function RefreshAllFriendProfilesButton({
    compact = false,
    onBeforeRefresh
}: {
    compact?: boolean;
    onBeforeRefresh?: () => void;
}) {
    const refresh = useRefreshAllFriendProfiles(onBeforeRefresh);

    return (
        <Button
            type="button"
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={compact ? 'w-full justify-start' : undefined}
            disabled={refresh.disabled}
            title={refresh.description}
            onClick={refresh.start}
        >
            <RefreshCwIcon data-icon="inline-start" />
            {refresh.label}
        </Button>
    );
}

export function RefreshAllFriendProfilesMenuItem() {
    const refresh = useRefreshAllFriendProfiles();

    return (
        <DropdownMenuItem
            disabled={refresh.disabled}
            title={refresh.description}
            onClick={refresh.start}
        >
            <RefreshCwIcon data-icon="inline-start" />
            {refresh.label}
        </DropdownMenuItem>
    );
}
