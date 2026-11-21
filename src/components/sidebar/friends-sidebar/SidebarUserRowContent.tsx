import type { CSSProperties, ReactNode } from 'react';

import { UserBadges } from '@/components/UserBadges';
import { UserStatusAvatar } from '@/components/UserStatusAvatar';
import { cn } from '@/lib/utils';

export function sidebarFriendRowHeight(compact: boolean) {
    return compact ? 41 : 53;
}

export function sidebarAvatarSkeletonClassName(compact: boolean) {
    return compact ? 'size-8' : 'size-10';
}

export function SidebarUserRowContent({
    compact = false,
    imageUrl = '',
    statusDotClassName = '',
    avatarFrame,
    displayName,
    nameStyle,
    subline,
    userId
}: {
    compact?: boolean;
    imageUrl?: string;
    statusDotClassName?: string;
    avatarFrame?: ReactNode;
    displayName: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
    userId?: string;
}) {
    return (
        <>
            <UserStatusAvatar
                imageUrl={imageUrl}
                statusDotClassName={statusDotClassName}
                size={compact ? 'sm' : 'lg'}
                frame={avatarFrame}
            />
            <span className="min-w-0 flex-1 overflow-hidden">
                <span
                    className={cn(
                        'block truncate font-medium',
                        compact ? 'text-[13px] leading-[18px]' : 'leading-5'
                    )}
                    style={nameStyle}
                >
                    {userId ? (
                        <span className="flex min-w-0 items-center gap-x-1">
                            <span className="max-w-full min-w-0 truncate">
                                {displayName}
                            </span>
                            <UserBadges userId={userId} />
                        </span>
                    ) : (
                        displayName
                    )}
                </span>
                {subline ? (
                    <span
                        className={cn(
                            'text-content-secondary block truncate',
                            compact ? 'text-[11px] leading-[14px]' : 'text-xs'
                        )}
                    >
                        {subline}
                    </span>
                ) : null}
            </span>
        </>
    );
}
