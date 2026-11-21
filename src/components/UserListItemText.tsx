import type { CSSProperties, ReactNode } from 'react';

import { UserBadges } from '@/components/UserBadges';

export function UserListItemText({
    displayName,
    namePrefix,
    nameSuffix,
    nameStyle,
    subline,
    userId
}: {
    displayName: ReactNode;
    namePrefix?: ReactNode;
    nameSuffix?: ReactNode;
    nameStyle?: CSSProperties;
    subline?: ReactNode;
    userId?: string;
}) {
    return (
        <span className="min-w-0 flex-1 overflow-hidden">
            <span
                className="block truncate text-sm leading-5 font-medium"
                style={nameStyle}
            >
                {namePrefix || nameSuffix || userId ? (
                    <span className="flex min-w-0 items-center gap-x-1">
                        {namePrefix}
                        <span className="max-w-full min-w-0 truncate">
                            {displayName}
                        </span>
                        <UserBadges userId={userId} />
                        {nameSuffix}
                    </span>
                ) : (
                    displayName
                )}
            </span>
            {subline ? (
                <span className="text-content-secondary block truncate text-xs leading-4">
                    {subline}
                </span>
            ) : null}
        </span>
    );
}
