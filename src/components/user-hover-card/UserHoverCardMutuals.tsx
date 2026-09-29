import { LockIcon, UsersRoundIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    MutualFriendAvatars,
    toMutualFriendAvatar
} from '@/components/mutual-friends/MutualFriendAvatars';
import { mutualFriendIdsOf } from '@/lib/mutual-friends/mutualFriendsStrangers';
import { useUserMutualFriends } from '@/lib/mutual-friends/useUserMutualFriends';
import { Skeleton } from '@/ui/shadcn/skeleton';

const HOVER_CARD_MUTUAL_AVATAR_LIMIT = 6;
const HOVER_CARD_MUTUAL_NAME_LIMIT = 3;

export function UserHoverCardMutuals({ userId }: { userId: string }) {
    const { t } = useTranslation();
    const query = useUserMutualFriends(userId, true);
    const rows = query.data;
    const friends = useMemo(() => {
        const rowsById = new Map((rows ?? []).map((row) => [row.id, row]));
        return mutualFriendIdsOf(rows).map((id) =>
            toMutualFriendAvatar(id, rowsById.get(id))
        );
    }, [rows]);

    if (query.isError) {
        return (
            <div className="text-muted-foreground flex items-center gap-1.5 border-t pt-2.5 text-xs">
                <LockIcon className="size-3.5" />
                <span>
                    {t('view.charts.mutual_friend.label.mutuals_unavailable')}
                </span>
            </div>
        );
    }

    if (!rows) {
        return (
            <div className="flex items-center gap-1.5 border-t pt-2.5">
                <UsersRoundIcon className="text-muted-foreground size-3.5" />
                <Skeleton className="h-3 w-24" />
            </div>
        );
    }

    if (!rows.length) {
        return (
            <div className="text-muted-foreground flex items-center gap-1.5 border-t pt-2.5 text-xs">
                <UsersRoundIcon className="size-3.5" />
                <span>{t('user_hover_card.no_mutual_friends')}</span>
            </div>
        );
    }

    const names = friends
        .slice(0, HOVER_CARD_MUTUAL_NAME_LIMIT)
        .map((friend) => friend.displayName)
        .join(t('user_hover_card.name_separator'));

    return (
        <div className="space-y-1.5 border-t pt-2.5 text-xs">
            <div className="text-muted-foreground flex items-center gap-1.5">
                <UsersRoundIcon className="size-3.5" />
                <span>
                    {t('user_hover_card.mutual_friends', {
                        count: rows.length
                    })}
                </span>
            </div>
            {friends.length ? (
                <div className="flex min-w-0 items-center gap-2">
                    <MutualFriendAvatars
                        friends={friends.slice(
                            0,
                            HOVER_CARD_MUTUAL_AVATAR_LIMIT
                        )}
                    />
                    <span className="text-foreground/80 min-w-0 truncate">
                        {names}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
