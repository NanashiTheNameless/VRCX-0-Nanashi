import { UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { UserStatusDot } from '@/components/UserStatusDot';
import { cn } from '@/lib/utils';

export function UserStatusAvatar({
    imageUrl = '',
    statusDotClassName = '',
    className = '',
    frame
}: {
    imageUrl?: string;
    statusDotClassName?: string;
    className?: string;
    frame?: ReactNode;
}) {
    return (
        <span
            className={cn(
                'relative flex size-9 shrink-0 items-center justify-center overflow-visible',
                className
            )}
        >
            <span className="bg-muted relative z-0 flex size-full items-center justify-center overflow-hidden rounded-full border">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        className="size-full object-cover"
                        fallback={
                            <UserIcon
                                data-icon="inline-start"
                                className="text-muted-foreground"
                            />
                        }
                    />
                ) : (
                    <UserIcon
                        data-icon="inline-start"
                        className="text-muted-foreground"
                    />
                )}
            </span>
            {frame}
            <UserStatusDot
                statusDotClassName={statusDotClassName}
                className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
            />
        </span>
    );
}
