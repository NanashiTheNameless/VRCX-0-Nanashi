import { UserIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import type { ImageUser } from '@/shared/utils/entityMedia';
import {
    Avatar,
    AvatarFallback,
    AvatarGroup,
    AvatarImage
} from '@/ui/shadcn/avatar';

export type MutualFriendAvatar = {
    id: string;
    displayName: string;
    imageUrl: string;
};

export function toMutualFriendAvatar(
    id: string,
    user: (ImageUser & { displayName?: unknown }) | null | undefined
): MutualFriendAvatar {
    return {
        id,
        displayName:
            typeof user?.displayName === 'string' && user.displayName
                ? user.displayName
                : id,
        imageUrl: user ? userImage(user, 64) : ''
    };
}

export function MutualFriendAvatars({
    className,
    friends
}: {
    className?: string;
    friends: readonly MutualFriendAvatar[];
}) {
    return (
        <AvatarGroup className={cn('shrink-0 -space-x-1.5', className)}>
            {friends.map((friend) => (
                <Avatar
                    key={friend.id}
                    size="sm"
                    className="size-5"
                    title={friend.displayName}
                >
                    {friend.imageUrl ? (
                        <AvatarImage src={friend.imageUrl} alt="" />
                    ) : null}
                    <AvatarFallback>
                        <UserIcon className="size-3" />
                    </AvatarFallback>
                </Avatar>
            ))}
        </AvatarGroup>
    );
}
