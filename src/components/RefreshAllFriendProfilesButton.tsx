import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    friendProfileRefreshScopeKey,
    startFriendProfileLoad,
    useFriendProfileRefreshStore
} from '@/services/friendProfileLoadService';
import { toast } from '@/services/toastService';
import { SECOND_MS } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

export function RefreshAllFriendProfilesButton({
    compact = false,
    onBeforeRefresh
}: {
    compact?: boolean;
    onBeforeRefresh?: () => void;
}) {
    const { t } = useTranslation();
    const userId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const loading = useRuntimeStore((state) =>
        ['running', 'cancelling'].includes(state.friendProfileLoad.status)
    );
    const scope = friendProfileRefreshScopeKey(userId, endpoint);
    const remaining = useFriendProfileRefreshStore((state) =>
        Math.max(
            0,
            Math.ceil(((state.cooldowns[scope] ?? 0) - state.now) / SECOND_MS)
        )
    );
    const pending = useFriendProfileRefreshStore((state) => state.pending);

    return (
        <Button
            type="button"
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className={compact ? 'w-full justify-start' : undefined}
            disabled={!userId || loading || pending || remaining > 0}
            title={
                remaining > 0
                    ? t('view.friend_list.refresh_all_cooldown', {
                          count: remaining
                      })
                    : t('view.friend_list.refresh_all_description')
            }
            onClick={() => {
                onBeforeRefresh?.();
                startFriendProfileLoad(true).catch(() => {
                    toast.add({
                        type: 'error',
                        title: t('view.friend_list.refresh_all_failed')
                    });
                });
            }}
        >
            <RefreshCwIcon data-icon="inline-start" />
            {remaining > 0
                ? t('view.friend_list.refresh_all_cooldown_label', {
                      count: remaining
                  })
                : t('view.friend_list.refresh_all')}
        </Button>
    );
}
